import "server-only";
/**
 * The values shown in the create form's Auto generate mode
 * (docs/tenant-management.md §8.1, `previewGeneratedValues`).
 *
 * Each value is free at preview time; the create call checks again, since
 * someone may take a name in between. No passwords: those are generated only
 * when the tenant is created.
 */
import { validateSubdomainLabel } from "@/lib/domains/rules";
import { getEnv } from "@/lib/env";
import { describeError } from "@/lib/platform-auth/session";
import { consumeRateLimit } from "@/lib/rate-limit";
import {
  generateDatabaseIdentifiers,
  nameCandidates,
  pickAvailable,
  slugBase,
} from "@/lib/tenants/generate";
import {
  FULL_NAME_MAX_LENGTH,
  normalizeFullName,
  TENANT_USERNAME_MAX_LENGTH,
  validateTenantUsername,
} from "@/lib/tenants/rules";
import { takenInControlPlane, takenOnServer } from "./availability";
import { type ServiceFailure, type TenantActor, UNAVAILABLE_MESSAGE } from "./common";

export type PreviewValues = {
  username: string;
  subdomain: string;
  databaseName: string;
  databaseUser: string;
  port: number;
  /** PLATFORM_BASE_DOMAIN, for the subdomain field's `.<base>` addon. */
  baseDomain: string;
};

export type PreviewResult =
  | { ok: true; values: PreviewValues }
  | ServiceFailure<"rate_limited" | "unavailable">;

const PREVIEW_LIMIT        = { limit: 60, windowSeconds: 5 * 60 };
const SUBDOMAIN_MAX_LENGTH = 63;

/**
 * Description: Generate free values for the create form's Auto-Generate sections.
 * Input: The typed full name and the acting owner.
 * Output: A free username, subdomain, database name/user, the port and the base
 *   domain; or a rate-limit (60 per 5 minutes) or unavailable message. Each
 *   value is free now; the create call checks again. No passwords here.
 * Use case: The create form's debounced preview and Regenerate.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function previewGeneratedValues(
  fullName: string,
  actor: TenantActor,
): Promise<PreviewResult> {
  const limit = await consumeRateLimit({ key: `tenant-preview:${actor.ownerId}`, ...PREVIEW_LIMIT });
  if (limit === "limited") {
    return {
      ok: false,
      reason: "rate_limited",
      message: "Too many previews in a short time. Wait a few minutes, or switch to Manual entry.",
    };
  }
  if (limit === "unavailable") {
    return { ok: false, reason: "unavailable", message: UNAVAILABLE_MESSAGE };
  }

  const { postgres, platformBaseDomain } = getEnv();
  const base = slugBase(normalizeFullName(fullName.slice(0, FULL_NAME_MAX_LENGTH * 2)));

  try {
    const [username, subdomain, database] = await Promise.all([
      pickAvailable(
        nameCandidates(
          base,
          (value) => validateTenantUsername(value).ok,
          TENANT_USERNAME_MAX_LENGTH,
        ),
        async (value) => (await takenInControlPlane({ username: value })).has("username"),
      ),
      pickAvailable(
        nameCandidates(base, (value) => validateSubdomainLabel(value).ok, SUBDOMAIN_MAX_LENGTH),
        async (value) => (await takenInControlPlane({ subdomain: value })).has("subdomain"),
      ),
      pickAvailable(
        () => generateDatabaseIdentifiers(base).databaseName,
        async (databaseName) => {
          const databaseUser = `${databaseName}_app`;
          const [controlPlane, server] = await Promise.all([
            takenInControlPlane({ databaseName, databaseUser }),
            takenOnServer(databaseName, databaseUser, postgres.port),
          ]);
          return controlPlane.size > 0 || server.databaseName || server.databaseUser;
        },
      ),
    ]);
    return {
      ok: true,
      values: {
        username,
        subdomain,
        databaseName: database,
        databaseUser: `${database}_app`,
        port: postgres.port,
        baseDomain: platformBaseDomain,
      },
    };
  } catch (error) {
    // Exhausted candidates (very unlikely) or the database cannot be asked.
    console.error(`[tenants] preview failed: ${describeError(error)}`);
    return {
      ok: false,
      reason: "unavailable",
      message: "Values could not be generated right now. Try again, or switch to Manual entry.",
    };
  }
}
