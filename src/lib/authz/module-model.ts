/**
 * Client-safe shapes and texts of the central module switches
 * (.vibe/memory/role-privilege-management.md, "Module switches").
 *
 * The module service (module-service.ts, server-only) produces these views and
 * results; the Server Actions return them and the client switch list renders
 * them. No `server-only`, no database access: client components import it.
 */

/** Which switch board a module belongs to. */
export type ModuleScope = "platform" | "tenant";

/** One privilege of a module, shown as a small muted list under the module. */
export type ModulePrivilegeView = {
  key: string;
  /** Display text only. */
  label: string;
  /** Display text only. */
  description: string;
};

/** One module with its current state (absent setting row = enabled). */
export type ModuleStateView = {
  /** Stable catalog key, e.g. `platform.tenants`. */
  key: string;
  /** The panel the module belongs to. */
  domain: "platform" | "tenant" | "customer";
  label: string;
  description: string;
  /** Core modules can never be switched off (shown locked, always on). */
  core: boolean;
  enabled: boolean;
  privileges: ModulePrivilegeView[];
};

/** The tenant and customer panel modules of one tenant, grouped by panel. */
export type TenantModuleGroups = {
  tenant: ModuleStateView[];
  customer: ModuleStateView[];
};

/** Why a switch request was refused. */
export type ModuleToggleProblem = "forbidden" | "invalid" | "not_found" | "unavailable";

/** The outcome of switching one module on or off. */
export type ModuleToggleResult =
  | {
      ok: true;
      /** The module's state after the request. */
      module: ModuleStateView;
      /** False when the module was already in the requested state (nothing written). */
      changed: boolean;
    }
  | { ok: false; reason: ModuleToggleProblem; error: string };

/** Shown for any tampered or malformed switch request (never reveals why). */
export const MODULE_INVALID_MESSAGE = "This module cannot be switched. Refresh the page and try again.";
/** Shown when the tenant of a per-tenant switch does not exist (any more). */
export const MODULE_TENANT_NOT_FOUND_MESSAGE = "This tenant no longer exists. Refresh the page.";
/** Shown when the database could not save the switch (details are in the log). */
export const MODULE_UNAVAILABLE_MESSAGE = "The module could not be switched. Please try again.";

/**
 * The warning shown before a module is switched off, per panel. Turning a
 * module off removes its privileges from every role of that panel at once,
 * including the master role, so the confirmation says exactly that.
 */
export const MODULE_DISABLE_WARNINGS: Record<ModuleStateView["domain"], string> = {
  platform: "Every role, including Master Platform, loses these privileges immediately.",
  tenant:   "Every tenant role, including Master Tenant, loses these privileges immediately.",
  customer: "Every customer role, including Master Customer, loses these privileges immediately.",
};

/**
 * Description: Build the success message of a module switch.
 * Input: The module's label and its new state.
 * Output: A short sentence for the success notice.
 * Use case: The module switch list after a confirmed change.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function moduleSwitchedMessage(label: string, enabled: boolean): string {
  return enabled
    ? `${label} is on. Its privileges are available again to the roles that hold them.`
    : `${label} is off. Its privileges were removed from every role.`;
}
