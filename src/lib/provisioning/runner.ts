import "server-only";
/**
 * The provisioning runner (docs/tenant-management.md §6.5).
 *
 * One run at a time per tenant, enforced by a session-level advisory lock held
 * on a dedicated control-plane connection for the whole run. If the process
 * dies, PostgreSQL drops the connection and with it the lock, so a run row
 * still `running` while nobody holds the lock is known to be dead and is
 * marked `interrupted` by the next run.
 *
 * Steps already recorded in `tenant_provisioning_steps` are skipped; every
 * step is idempotent as well. The tenant becomes `active` only in the same
 * transaction that closes a run in which every step of its plan is recorded.
 */
import { Client } from "pg";
import type { ProvisioningStep } from "@/generated/prisma/control/client";
import { recordAudit } from "../audit";
import { getControlDb } from "../db/control";
import type { TenantDatabase } from "../db/tenant";
import type { DnsResolver } from "../domains/dns";
import { getEnv } from "../env";
import { loadTenantDatabase, TenantDatabaseConfigError } from "../tenants/database-target";
import {
  connectionError,
  describeForLog,
  ProvisioningError,
  type ProvisioningErrorCode,
  stepError,
} from "./errors";
import { provisioningPlan, STEP_ACTIVITY, STEPS, type StepContext } from "./steps";
import { UUID_PATTERN } from "@/lib/uuid";

export type ProvisioningActor =
  | { type: "super_admin"; ownerId: string; ipAddress: string | null }
  | { type: "system" };

export type ProvisioningOutcome =
  | { status: "succeeded" }
  | { status: "failed"; code: ProvisioningErrorCode; message: string }
  | { status: "already_running" }
  | { status: "invalid_state"; tenantStatus: string };

/** For tests only. */
export type ProvisioningOptions = {
  hooks?: { beforeStep?(step: ProvisioningStep): void | Promise<void> };
  dnsResolver?: DnsResolver;
};

const LOCK_NAMESPACE     = "md:tenant-provisioning";
const STARTABLE_STATUSES = ["pending", "failed", "provisioning"] as const;

const INTERRUPTED_MESSAGE =
  "Setup was interrupted before it finished (the server stopped or lost its connection). Retry setup to continue.";

/**
 * Description: Write one provisioning progress line to the server log.
 * Input: The tenant id, the attempt number and the text (no secrets).
 * Output: Nothing.
 * Use case: Every step of runLocked.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function log(tenantId: string, attempt: number, text: string): void {
  console.info(`[provisioning] tenant ${tenantId} attempt ${attempt} ${text}`);
}

// ---------------------------------------------------------------------------
// The per-tenant lock

type ProvisioningLock = {
  /** Throws `interrupted` when the lock's connection is gone (and with it the lock). */
  assertHeld(): Promise<void>;
  release(): Promise<void>;
};

/**
 * Description: Create a dedicated control-plane connection for an advisory lock.
 * Input: None.
 * Output: An unconnected pg Client (the lock lives as long as this session).
 * Use case: tryLock.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function controlPlaneClient(): Client {
  const { postgres } = getEnv();
  const client = new Client({
    host: postgres.host,
    port: postgres.port,
    database: postgres.database,
    user: postgres.user,
    password: postgres.password,
    connectionTimeoutMillis: 5_000,
    application_name: "md-provisioning-lock",
  });
  // Losing the connection is detected by assertHeld(); the event must not crash the process.
  client.on("error", () => undefined);
  return client;
}

/**
 * Description: Try to take the tenant's provisioning lock on a new connection.
 * Input: The tenant id.
 * Output: The lock (assertHeld/release), or null when another session holds it (the
 *   connection is then closed again).
 * Use case: runProvisioning and isProvisioningRunning.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function tryLock(tenantId: string): Promise<ProvisioningLock | null> {
  const { postgres } = getEnv();
  const client = controlPlaneClient();
  try {
    await client.connect();
  } catch (error) {
    await client.end().catch(() => undefined);
    throw connectionError(error, {
      login: "admin",
      host: postgres.host,
      user: postgres.user,
      database: postgres.database,
      port: postgres.port,
    });
  }
  const keys = [LOCK_NAMESPACE, tenantId];
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked",
      keys,
    );
    locked = result.rows[0]?.locked === true;
  } finally {
    if (!locked) await client.end().catch(() => undefined);
  }
  if (!locked) return null;

  return {
    async assertHeld() {
      try {
        await client.query("SELECT 1");
      } catch (error) {
        throw new ProvisioningError(
          "interrupted",
          "Setup stopped because its connection to the control-plane database was lost. Retry setup.",
          { cause: error },
        );
      }
    },
    async release() {
      try {
        await client.query("SELECT pg_advisory_unlock(hashtext($1), hashtext($2))", keys);
      } catch {
        // Closing the session below releases it as well.
      } finally {
        await client.end().catch(() => undefined);
      }
    },
  };
}

/**
 * Description: Tell whether a run holds the tenant's lock right now.
 * Input: The tenant id.
 * Output: True while another session provisions the tenant.
 * Use case: The details page (whether Retry setup is offered).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function isProvisioningRunning(tenantId: string): Promise<boolean> {
  const lock = await tryLock(tenantId);
  if (!lock) return true;
  await lock.release();
  return false;
}

// ---------------------------------------------------------------------------
// Running

/**
 * Description: Provision (or continue provisioning) a tenant.
 * Input: The tenant id, the actor and options (test hooks, DNS resolver).
 * Output: The outcome: succeeded, failed (code and safe message) or invalid state.
 *   Never throws for a failed step: the run, the tenant row and the audit log
 *   record what happened. Only one run per tenant at a time (advisory lock).
 * Use case: startProvisioning (after a create or a retry).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function runProvisioning(
  tenantId: string,
  actor: ProvisioningActor,
  options: ProvisioningOptions = {},
): Promise<ProvisioningOutcome> {
  if (!UUID_PATTERN.test(tenantId)) return { status: "invalid_state", tenantStatus: "not_found" };

  let lock: ProvisioningLock | null;
  try {
    lock = await tryLock(tenantId);
  } catch (error) {
    const failure = stepError(error, "starting the setup");
    console.error(`[provisioning] tenant ${tenantId} could not start: ${describeForLog(error)}`);
    return { status: "failed", code: failure.code, message: failure.safeMessage };
  }
  if (!lock) return { status: "already_running" };

  try {
    return await runLocked(tenantId, actor, options, lock);
  } catch (error) {
    // The bookkeeping itself failed (e.g. the control plane went away). A run
    // row left `running` is marked interrupted by the next run.
    const failure = stepError(error, "recording the setup's progress");
    console.error(`[provisioning] tenant ${tenantId} run aborted: ${describeForLog(error)}`);
    return { status: "failed", code: failure.code, message: failure.safeMessage };
  } finally {
    await lock.release();
  }
}

type RunRecord = { id: string; attempt: number };

/**
 * Description: Run the remaining steps of the tenant's plan while holding its lock.
 * Input: The tenant id, the actor, the options and the held lock.
 * Output: The outcome. Interrupted runs are closed first; finished steps are skipped;
 *   each step is recorded after it succeeds; a failure closes the run as failed
 *   with a safe message (details redacted in the log).
 * Use case: runProvisioning.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function runLocked(
  tenantId: string,
  actor: ProvisioningActor,
  options: ProvisioningOptions,
  lock: ProvisioningLock,
): Promise<ProvisioningOutcome> {
  const control = getControlDb();

  // We hold the lock, so whoever left these behind is gone.
  await control.tenantProvisioningRun.updateMany({
    where: { tenantId, status: "running" },
    data: {
      status: "failed",
      errorCode: "interrupted",
      errorMessage: INTERRUPTED_MESSAGE,
      finishedAt: new Date(),
    },
  });

  const tenant = await control.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      status: true,
      adminUsername: true,
      contactEmail: true,
      databaseMode: true,
    },
  });
  if (!tenant) return { status: "invalid_state", tenantStatus: "not_found" };
  if (!(STARTABLE_STATUSES as readonly string[]).includes(tenant.status)) {
    return { status: "invalid_state", tenantStatus: tenant.status };
  }

  const previousRun = await control.tenantProvisioningRun.findFirst({
    where: { tenantId },
    orderBy: { attempt: "desc" },
    select: { status: true, step: true },
  });
  const run = await startRun(tenantId, actor);
  if (!run) {
    // Changed between the read above and the conditional update.
    const current = await control.tenant.findUnique({ where: { id: tenantId }, select: { status: true } });
    return { status: "invalid_state", tenantStatus: current?.status ?? "not_found" };
  }
  log(tenantId, run.attempt, `started (${tenant.databaseMode} database)`);

  const secrets: string[] = [];
  const plan = provisioningPlan(tenant.databaseMode);
  let current: ProvisioningStep | null = null;

  try {
    const done = new Set(
      (await control.tenantProvisioningStep.findMany({ where: { tenantId }, select: { step: true } })).map(
        (row) => row.step,
      ),
    );
    const context: StepContext = {
      tenant,
      runId: run.id,
      previousRun,
      target: lazyTarget(tenantId, secrets),
      ...(options.dnsResolver ? { dnsResolver: options.dnsResolver } : {}),
    };

    for (const step of plan) {
      if (done.has(step)) {
        log(tenantId, run.attempt, `step ${step} skipped (done earlier)`);
        continue;
      }
      current = step;
      await lock.assertHeld();
      await control.tenantProvisioningRun.update({ where: { id: run.id }, data: { step } });
      await options.hooks?.beforeStep?.(step);
      await STEPS[step](context);
      await control.tenantProvisioningStep.createMany({
        data: [{ tenantId, step, runId: run.id }],
        skipDuplicates: true,
      });
      log(tenantId, run.attempt, `step ${step} ok`);
    }

    current = null;
    await lock.assertHeld();
    await finishSucceeded(tenantId, run, plan);
    log(tenantId, run.attempt, "succeeded: tenant active");
    return { status: "succeeded" };
  } catch (error) {
    const failure = stepError(error, current ? STEP_ACTIVITY[current] : "activating the tenant");
    console.error(
      `[provisioning] tenant ${tenantId} attempt ${run.attempt} step ${current ?? "finish"} failed (${failure.code}): ${describeForLog(error, secrets)}`,
    );
    await finishFailed(tenantId, run, current, failure);
    return { status: "failed", code: failure.code, message: failure.safeMessage };
  }
}

/**
 * Description: Read and decrypt the tenant's database target once, on first use.
 * Input: The tenant id and the list collecting secrets to redact.
 * Output: A loader returning the same target every time; configuration problems
 *   become invalid-state ProvisioningErrors with safe messages.
 * Use case: runLocked (steps that need the tenant database).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function lazyTarget(tenantId: string, secrets: string[]): () => Promise<TenantDatabase> {
  let loaded: Promise<TenantDatabase> | undefined;
  return () => {
    loaded ??= loadTenantDatabase(tenantId).then(
      (target) => {
        secrets.push(target.password);
        return target;
      },
      (error: unknown) => {
        if (error instanceof TenantDatabaseConfigError) {
          throw new ProvisioningError(
            "invalid_state",
            error.problem === "secret_unavailable"
              ? "The tenant's stored database password cannot be read (missing, or encrypted with another TENANT_SECRETS_KEY)."
              : "The tenant's database settings are incomplete.",
            { cause: error },
          );
        }
        throw error;
      },
    );
    return loaded;
  };
}

/**
 * Description: Open a provisioning run.
 * Input: The tenant id and the actor.
 * Output: The run (id and attempt number), or null when the tenant left the
 *   startable states meanwhile. Attempt number, status provisioning and the
 *   audit event are written all or nothing.
 * Use case: runLocked.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function startRun(tenantId: string, actor: ProvisioningActor): Promise<RunRecord | null> {
  return getControlDb().$transaction(async (tx) => {
    const updated = await tx.tenant.updateMany({
      where: { id: tenantId, status: { in: [...STARTABLE_STATUSES] } },
      data: { status: "provisioning", statusReason: null },
    });
    if (updated.count !== 1) return null;

    const latest = await tx.tenantProvisioningRun.aggregate({
      where: { tenantId },
      _max: { attempt: true },
    });
    const attempt = (latest._max.attempt ?? 0) + 1;
    const run = await tx.tenantProvisioningRun.create({
      data: { tenantId, attempt, status: "running" },
      select: { id: true, attempt: true },
    });
    await recordAudit(tx, {
      ...(actor.type === "super_admin"
        ? { actorType: "super_admin", actorId: actor.ownerId, ipAddress: actor.ipAddress }
        : { actorType: "system", actorId: null }),
      tenantId,
      action: attempt === 1 ? "tenant.provisioning_started" : "tenant.provisioning_retried",
      targetType: "tenant",
      targetId: tenantId,
      metadata: { attempt, runId: run.id },
    });
    return run;
  });
}

/**
 * Description: Close a successful run and activate the tenant.
 * Input: The tenant id, the run and the plan.
 * Output: Nothing. In one transaction: every step must be recorded (never active
 *   with a step missing), the run closes as succeeded, the tenant becomes active
 *   and tenant.provisioned is audited.
 * Use case: runLocked.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function finishSucceeded(
  tenantId: string,
  run: RunRecord,
  plan: readonly ProvisioningStep[],
): Promise<void> {
  await getControlDb().$transaction(async (tx) => {
    // The rule that matters most: never active with a step missing.
    const recorded = new Set(
      (await tx.tenantProvisioningStep.findMany({ where: { tenantId }, select: { step: true } })).map(
        (row) => row.step,
      ),
    );
    const missing = plan.filter((step) => !recorded.has(step));
    if (missing.length > 0) {
      throw new ProvisioningError(
        "internal",
        `Setup cannot finish: step ${missing.join(", ")} has not completed. Retry setup.`,
      );
    }

    const closed = await tx.tenantProvisioningRun.updateMany({
      where: { id: run.id, status: "running" },
      data: { status: "succeeded", step: null, finishedAt: new Date() },
    });
    if (closed.count !== 1) {
      throw new ProvisioningError("interrupted", INTERRUPTED_MESSAGE);
    }

    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { activatedAt: true } });
    const activated = await tx.tenant.updateMany({
      where: { id: tenantId, status: "provisioning" },
      data: { status: "active", statusReason: null, activatedAt: tenant?.activatedAt ?? new Date() },
    });
    if (activated.count !== 1) {
      throw new ProvisioningError("invalid_state", "The tenant's status changed while setup was running.");
    }

    await recordAudit(tx, {
      actorType: "system",
      actorId: null,
      tenantId,
      action: "tenant.provisioned",
      targetType: "tenant",
      targetId: tenantId,
      metadata: { attempt: run.attempt, runId: run.id },
    });
  });
}

/**
 * Description: Close a failed run and mark the tenant failed.
 * Input: The tenant id, the run, the failed step and the error.
 * Output: Nothing. In one transaction: the run gets the step, code and safe message,
 *   the tenant becomes failed with that reason and tenant.provisioning_failed is audited.
 * Use case: runLocked.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
async function finishFailed(
  tenantId: string,
  run: RunRecord,
  step: ProvisioningStep | null,
  failure: ProvisioningError,
): Promise<void> {
  await getControlDb().$transaction(async (tx) => {
    await tx.tenantProvisioningRun.updateMany({
      where: { id: run.id, status: "running" },
      data: {
        status: "failed",
        // The step that failed; the run row keeps the last started one otherwise.
        ...(step ? { step } : {}),
        errorCode: failure.code,
        errorMessage: failure.safeMessage,
        finishedAt: new Date(),
      },
    });
    await tx.tenant.updateMany({
      where: { id: tenantId, status: "provisioning" },
      data: { status: "failed", statusReason: failure.safeMessage },
    });
    await recordAudit(tx, {
      actorType: "system",
      actorId: null,
      tenantId,
      action: "tenant.provisioning_failed",
      targetType: "tenant",
      targetId: tenantId,
      metadata: { attempt: run.attempt, runId: run.id, step, code: failure.code },
    });
  });
}
