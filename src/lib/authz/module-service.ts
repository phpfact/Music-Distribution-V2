import "server-only";
/**
 * Central module switches of the Platform Owner
 * (.vibe/memory/role-privilege-management.md, "Module availability" and
 * "Module switches").
 *
 *   - Platform modules are switched platform-wide (`platform_module_settings`).
 *   - Tenant and customer panel modules are switched per tenant
 *     (`tenant_module_settings`, control plane).
 *   - An absent row means "enabled". Core modules (roles, users / sub-users,
 *     platform modules) can never be switched off, so nobody is locked out.
 *
 * The effect is immediate: loadPlatformAccess and loadDisabledTenantModules
 * read these tables on every request, so the next request of every affected
 * user already resolves without the module's privileges.
 *
 * The Server Actions authorize first (authorizePlatformAction); this service
 * re-validates every argument and re-checks the privilege inside its own
 * transaction (defence in depth: the privilege may be revoked in between).
 */
import type { Prisma } from "@/generated/prisma/control/client";
import { recordAudit, type AuditAction, type AuditMetadata } from "@/lib/audit";
import { getControlDb, type ControlDb } from "@/lib/db/control";
import { describeError } from "@/lib/platform-auth/session";
import { isUuid } from "@/lib/uuid";
import {
  getModule,
  modulesOfDomain,
  permissionsOfDomain,
  type CatalogModule,
  type PlatformPermissionKey,
} from "./catalog";
import { recordAuthzDenial } from "./denials";
import {
  MODULE_INVALID_MESSAGE,
  MODULE_TENANT_NOT_FOUND_MESSAGE,
  MODULE_UNAVAILABLE_MESSAGE,
  type ModuleScope,
  type ModuleStateView,
  type ModuleToggleResult,
  type TenantModuleGroups,
} from "./module-model";
import { loadPlatformAccess } from "./platform-access";
import { forbiddenMessage, type RoleState } from "./resolver";

/** Who switches a module: the platform owner of the verified session. */
export type ModuleActor = {
  /** From authorizePlatformAction's session, never from the request. */
  ownerId: string;
};

// The privilege each switch board needs.
const SCOPE_PRIVILEGES = {
  platform: "platform.modules.manage",
  tenant:   "platform.tenant_modules.manage",
} as const satisfies Record<ModuleScope, PlatformPermissionKey>;

// The catalog domains each switch board may change.
const SCOPE_DOMAINS: Record<ModuleScope, readonly CatalogModule["domain"][]> = {
  platform: ["platform"],
  tenant:   ["tenant", "customer"],
};

// First key of the two-key advisory lock that serializes switches of one module.
const MODULE_LOCK_NAMESPACE = "module_settings";

// ---------------------------------------------------------------------------
// Views

/**
 * Description: Build the view of one catalog module with its current state.
 * Input: The catalog module and the stored `enabled` value (undefined when no row exists).
 * Output: The module view; an absent row means enabled and a core module is
 *   always reported enabled (the resolver ignores rows of core modules too).
 * Use case: listPlatformModules, listTenantModules and the switch results.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function moduleView(catalogModule: CatalogModule, storedEnabled: boolean | undefined): ModuleStateView {
  // The module's privileges, in catalog order (display text only).
  const privileges = permissionsOfDomain(catalogModule.domain)
    .filter((permission) => permission.module === catalogModule.key)
    .map((permission) => ({ key: permission.key, label: permission.label, description: permission.description }));

  return {
    key: catalogModule.key,
    domain: catalogModule.domain,
    label: catalogModule.label,
    description: catalogModule.description,
    core: catalogModule.core,
    // Core modules are always on; otherwise an absent row means enabled.
    enabled: catalogModule.core ? true : (storedEnabled ?? true),
    privileges,
  };
}

/**
 * Description: List the platform modules with their platform-wide state.
 * Input: The control database client (or a transaction).
 * Output: Every platform-domain catalog module in display order, with label,
 *   description, core flag, enabled state and its privileges.
 * Use case: /platform/settings/modules.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function listPlatformModules(db: Pick<ControlDb, "platformModuleSetting">): Promise<ModuleStateView[]> {
  // Step 1: the stored switches (few rows: one per switched platform module).
  const rows   = await db.platformModuleSetting.findMany({ select: { moduleKey: true, enabled: true } });
  const stored = new Map(rows.map((row) => [row.moduleKey, row.enabled]));

  // Step 2: every platform module of the catalog with its state.
  return modulesOfDomain("platform").map((catalogModule) => moduleView(catalogModule, stored.get(catalogModule.key)));
}

/**
 * Description: List the tenant and customer panel modules of one tenant with their state.
 * Input: The control database client (or a transaction) and the tenant id
 *   (the caller has already loaded the tenant; a malformed id lists the defaults).
 * Output: `{ tenant, customer }`: each panel's catalog modules in display order
 *   with label, description, core flag, enabled state and privileges.
 * Use case: The "Module access" section of the tenant details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function listTenantModules(
  db: Pick<ControlDb, "tenantModuleSetting">,
  tenantId: string,
): Promise<TenantModuleGroups> {
  // Step 1: this tenant's stored switches (a malformed id never reaches the uuid column).
  const rows = isUuid(tenantId)
    ? await db.tenantModuleSetting.findMany({ where: { tenantId }, select: { moduleKey: true, enabled: true } })
    : [];
  const stored = new Map(rows.map((row) => [row.moduleKey, row.enabled]));

  // Step 2: both panels' modules with their state.
  return {
    tenant: modulesOfDomain("tenant").map((catalogModule) => moduleView(catalogModule, stored.get(catalogModule.key))),
    customer: modulesOfDomain("customer").map((catalogModule) => moduleView(catalogModule, stored.get(catalogModule.key))),
  };
}

// ---------------------------------------------------------------------------
// Switching

/** One validated switch request. */
type SwitchRequest = {
  scope: ModuleScope;
  actor: ModuleActor;
  /** Set for a per-tenant switch only. */
  tenantId: string | null;
  catalogModule: CatalogModule;
  enabled: boolean;
  ipAddress: string | null;
};

/** What the transaction decided (audits are written after it ends). */
type SwitchOutcome =
  | { kind: "done"; changed: boolean; module: ModuleStateView }
  | { kind: "forbidden"; roleState: RoleState }
  | { kind: "not_found" };

/**
 * Description: Audit a tampered switch request (unknown, cross-domain or core module key).
 * Input: The scope, actor, tenant id (per-tenant switch) or null, the submitted
 *   key (truncated to the column size) and why it was refused.
 * Output: Nothing. Writes `authz.escalation_blocked`; never throws (a failed
 *   audit write is logged and the request stays refused).
 * Use case: setPlatformModuleEnabled and setTenantModuleEnabled.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function auditTamperedRequest(
  scope: ModuleScope,
  actor: ModuleActor,
  tenantId: string | null,
  submittedKey: string,
  attempt: "unknown_module" | "other_domain_module" | "core_module",
): Promise<void> {
  console.warn(`[modules] blocked ${attempt} switch (${scope}) by owner ${actor.ownerId}`);
  try {
    await recordAudit(getControlDb(), {
      actorType: "super_admin",
      actorId: actor.ownerId,
      tenantId,
      action: "authz.escalation_blocked",
      targetType: "module",
      // target_id is VARCHAR(100); a submitted key is untrusted and may be longer.
      targetId: submittedKey.slice(0, 100),
      metadata: { attempt, scope },
    });
  } catch (error) {
    console.error(`[modules] audit "authz.escalation_blocked" not written: ${describeError(error)}`);
  }
}

/**
 * Description: Validate the module key and target state of a switch request.
 * Input: The scope, actor, tenant id (or null) and the untrusted key and state.
 * Output: The catalog module and boolean state, or a refusal. Unknown keys, keys
 *   of another panel and core modules can only come from a tampered request:
 *   they are refused with one neutral message and audited as escalation attempts.
 * Use case: setPlatformModuleEnabled and setTenantModuleEnabled.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function validateSwitch(
  scope: ModuleScope,
  actor: ModuleActor,
  tenantId: string | null,
  moduleKey: unknown,
  enabled: unknown,
): Promise<{ ok: true; catalogModule: CatalogModule; enabled: boolean } | { ok: false; result: ModuleToggleResult }> {
  const invalid = { ok: false as const, result: { ok: false as const, reason: "invalid" as const, error: MODULE_INVALID_MESSAGE } };

  // Step 1: plain type checks (a malformed request, not an escalation attempt).
  if (typeof moduleKey !== "string" || moduleKey === "" || typeof enabled !== "boolean") return invalid;

  // Step 2: the key must be a catalog module of this switch board, and not core.
  const catalogModule = getModule(moduleKey);
  if (!catalogModule) {
    await auditTamperedRequest(scope, actor, tenantId, moduleKey, "unknown_module");
    return invalid;
  }
  if (!SCOPE_DOMAINS[scope].includes(catalogModule.domain)) {
    await auditTamperedRequest(scope, actor, tenantId, moduleKey, "other_domain_module");
    return invalid;
  }
  if (catalogModule.core) {
    await auditTamperedRequest(scope, actor, tenantId, moduleKey, "core_module");
    return invalid;
  }
  return { ok: true, catalogModule, enabled };
}

/**
 * Description: Read, compare and store one module switch inside a transaction.
 * Input: The transaction and the validated request.
 * Output: The outcome: done (changed or already in that state, with the new
 *   view), forbidden (privilege missing on the fresh re-read) or not_found
 *   (per-tenant switch of a tenant that no longer exists).
 * Use case: switchModule.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function switchInTransaction(tx: Prisma.TransactionClient, request: SwitchRequest): Promise<SwitchOutcome> {
  const { scope, actor, tenantId, catalogModule, enabled } = request;

  // Step 1: serialize switches of this module (per tenant), so "changed" and
  // the audit trail stay exact when two owners click at the same time.
  const lockKey = tenantId ? `${tenantId}:${catalogModule.key}` : catalogModule.key;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${MODULE_LOCK_NAMESPACE}), hashtext(${lockKey}))`;

  // Step 2: the actor's privilege, re-read fresh inside the transaction.
  const access = await loadPlatformAccess(tx, actor.ownerId);
  if (!access.can(SCOPE_PRIVILEGES[scope])) return { kind: "forbidden", roleState: access.roleState };

  // Step 3: the current state (absent row = enabled).
  let current: boolean;
  if (tenantId) {
    // The tenant must still exist (its settings cascade with it).
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) return { kind: "not_found" };
    const row = await tx.tenantModuleSetting.findUnique({
      where: { tenantId_moduleKey: { tenantId, moduleKey: catalogModule.key } },
      select: { enabled: true },
    });
    current = row?.enabled ?? true;
  } else {
    const row = await tx.platformModuleSetting.findUnique({ where: { moduleKey: catalogModule.key }, select: { enabled: true } });
    current = row?.enabled ?? true;
  }

  // Step 4: already in the requested state → nothing to write or audit.
  if (current === enabled) return { kind: "done", changed: false, module: moduleView(catalogModule, enabled) };

  // Step 5: store the new state with who changed it.
  if (tenantId) {
    await tx.tenantModuleSetting.upsert({
      where: { tenantId_moduleKey: { tenantId, moduleKey: catalogModule.key } },
      create: { tenantId, moduleKey: catalogModule.key, enabled, updatedById: actor.ownerId },
      update: { enabled, updatedById: actor.ownerId },
    });
  } else {
    await tx.platformModuleSetting.upsert({
      where: { moduleKey: catalogModule.key },
      create: { moduleKey: catalogModule.key, enabled, updatedById: actor.ownerId },
      update: { enabled, updatedById: actor.ownerId },
    });
  }
  return { kind: "done", changed: true, module: moduleView(catalogModule, enabled) };
}

/**
 * Description: Run one validated switch: transaction, then refusal or success audit.
 * Input: The validated request.
 * Output: The switch result; database failures become a friendly "unavailable"
 *   result (details in the server log). The success audit is written after the
 *   commit and never turns a committed switch into a failure.
 * Use case: setPlatformModuleEnabled and setTenantModuleEnabled.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function switchModule(request: SwitchRequest): Promise<ModuleToggleResult> {
  const { scope, actor, tenantId, catalogModule, enabled, ipAddress } = request;

  // Step 1: the change itself, in one transaction.
  let outcome: SwitchOutcome;
  try {
    outcome = await getControlDb().$transaction((tx) => switchInTransaction(tx, request));
  } catch (error) {
    console.error(`[modules] could not switch ${catalogModule.key} (${scope}): ${describeError(error)}`);
    return { ok: false, reason: "unavailable", error: MODULE_UNAVAILABLE_MESSAGE };
  }

  // Step 2: refusals found inside the transaction.
  if (outcome.kind === "forbidden") {
    await recordAuthzDenial({
      actorType: "super_admin",
      actorId: actor.ownerId,
      tenantId,
      permission: SCOPE_PRIVILEGES[scope],
      roleState: outcome.roleState,
      ipAddress,
    });
    return { ok: false, reason: "forbidden", error: forbiddenMessage({ roleState: outcome.roleState }) };
  }
  if (outcome.kind === "not_found") {
    return { ok: false, reason: "not_found", error: MODULE_TENANT_NOT_FOUND_MESSAGE };
  }

  // Step 3: audit a real change after the commit (no row for a no-op).
  if (outcome.changed) {
    const action: AuditAction = scope === "platform"
      ? (enabled ? "platform_module.enabled" : "platform_module.disabled")
      : (enabled ? "tenant_module.enabled" : "tenant_module.disabled");
    const metadata: AuditMetadata = { moduleKey: catalogModule.key };
    try {
      await recordAudit(getControlDb(), {
        actorType: "super_admin",
        actorId: actor.ownerId,
        tenantId,
        action,
        targetType: "module",
        targetId: catalogModule.key,
        metadata,
        ipAddress,
      });
    } catch (error) {
      console.error(`[modules] audit "${action}" not written: ${describeError(error)}`);
    }
    console.info(`[modules] ${action} ${catalogModule.key}${tenantId ? ` (tenant ${tenantId})` : ""} by owner ${actor.ownerId}`);
  }

  return { ok: true, module: outcome.module, changed: outcome.changed };
}

/**
 * Description: Switch one platform module on or off for every Platform Owner.
 * Input: The actor (owner id from authorizePlatformAction("platform.modules.manage")),
 *   the untrusted module key and target state, and the client address for audits.
 * Output: `{ ok: true, module, changed }` or `{ ok: false, reason, error }` with a
 *   friendly message. Unknown keys, non-platform keys and core modules are
 *   refused and audited as `authz.escalation_blocked`; a missing privilege
 *   (re-checked in the transaction) as `authz.denied`; a real change as
 *   `platform_module.enabled|disabled` after the commit.
 * Use case: setPlatformModuleAction (/platform/settings/modules).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setPlatformModuleEnabled(
  actor: ModuleActor,
  moduleKey: unknown,
  enabled: unknown,
  ipAddress: string | null = null,
): Promise<ModuleToggleResult> {
  // Step 1: validate the request (tampering is audited).
  const checked = await validateSwitch("platform", actor, null, moduleKey, enabled);
  if (!checked.ok) return checked.result;

  // Step 2: switch it.
  return switchModule({ scope: "platform", actor, tenantId: null, catalogModule: checked.catalogModule, enabled: checked.enabled, ipAddress });
}

/**
 * Description: Switch one tenant or customer panel module on or off for one tenant.
 * Input: The actor (owner id from authorizePlatformAction("platform.tenant_modules.manage")),
 *   the untrusted tenant id, module key and target state, and the client address.
 * Output: `{ ok: true, module, changed }` or `{ ok: false, reason, error }`. The
 *   tenant id must be a UUID of an existing tenant; only non-core `tenant.*` /
 *   `customer.*` modules can be switched (others are audited as
 *   `authz.escalation_blocked`); a real change is audited as
 *   `tenant_module.enabled|disabled` with the tenant id after the commit.
 * Use case: setTenantModuleAction (tenant details page, "Module access").
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function setTenantModuleEnabled(
  actor: ModuleActor,
  tenantId: unknown,
  moduleKey: unknown,
  enabled: unknown,
  ipAddress: string | null = null,
): Promise<ModuleToggleResult> {
  // Step 1: the tenant id (never let a malformed id reach a uuid column).
  if (!isUuid(tenantId)) return { ok: false, reason: "invalid", error: MODULE_INVALID_MESSAGE };

  // Step 2: validate the module and state (tampering is audited with the tenant).
  const checked = await validateSwitch("tenant", actor, tenantId, moduleKey, enabled);
  if (!checked.ok) return checked.result;

  // Step 3: switch it (the tenant's existence is checked inside the transaction).
  return switchModule({ scope: "tenant", actor, tenantId, catalogModule: checked.catalogModule, enabled: checked.enabled, ipAddress });
}
