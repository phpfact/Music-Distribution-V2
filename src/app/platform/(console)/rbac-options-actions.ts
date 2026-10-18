"use server";
/** Scoped, paginated role choices; every request rechecks its exact current privilege. */
import type { RecordsResult, RoleOptionView, RoleOptionsPurpose } from "@/components/rbac/types";
import { handleLoadRoleOptions } from "@/lib/authz/management-actions";
import { authorizePlatformActor } from "./rbac-actor";

/**
 * Description: Search eligible roles for one panel and explicitly authorized purpose.
 * Input: Purpose, search text, page and optional excluded role (all untrusted).
 * Output: A scoped database page of twenty choices or a friendly refusal.
 * Use case: Assignment/replacement pickers and the sub-user directory role filter.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export async function loadRoleOptionsAction(purpose: RoleOptionsPurpose, search: string, page: number, excludeRoleId?: string): Promise<RecordsResult<RoleOptionView>> {
  // Unknown browser purposes never fall through to a weaker privilege.
  switch (purpose) {
    case "create": return handleLoadRoleOptions(() => authorizePlatformActor("platform.users.create"), purpose, search, page, excludeRoleId);
    case "edit": return handleLoadRoleOptions(() => authorizePlatformActor("platform.users.edit"), purpose, search, page, excludeRoleId);
    case "delete": return handleLoadRoleOptions(() => authorizePlatformActor("platform.roles.delete"), purpose, search, page, excludeRoleId);
    case "filter": return handleLoadRoleOptions(() => authorizePlatformActor("platform.users.view"), purpose, search, page, excludeRoleId);
    default: return { ok: false, error: "Choose a valid role search." };
  }
}
