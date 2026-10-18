"use client";

import type { Ref } from "react";
import { SearchableSelect, type SearchableSelectOption } from "@/components/shared";
import { privilegeCountText } from "./format";
import { MasterBadge } from "./role-badges";
import type { LoadRoleOptions, RoleOptionView } from "./types";

/** The helper text the spec requires under every role picker. */
export const ROLE_PICKER_HINT = "Exactly one role. It takes effect on the user's next request.";

type RolePickerProps = {
  /** The trigger's id (Field htmlFor points at it). */
  id: string;
  /** Hidden input name; always "roleId" unless a dialog needs another key. */
  name?: string;
  /** Only active roles the actor may assign (the server re-checks). */
  roles: readonly RoleOptionView[];
  /** Searches/paginates eligible roles on the server when the list is opened. */
  loadRoles?: LoadRoleOptions;
  value?: string;
  defaultValue?: string;
  onValueChange?: (roleId: string) => void;
  /** Roles that must not be offered (e.g. the role being deleted). */
  excludeIds?: readonly string[];
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  "aria-describedby"?: string;
  required?: boolean;
  placeholder?: string;
  ref?: Ref<HTMLButtonElement>;
  onBlur?: () => void;
};

/**
 * Description: Turn role views into SearchableSelect options.
 * Input: The roles and the ids to leave out.
 * Output: One option per role: name, "Master" badge for master roles, and the
 *   privilege count ("All privileges" / "N privileges") as meta.
 * Use case: RolePicker.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function toOptions(roles: readonly RoleOptionView[], excludeIds: readonly string[]): SearchableSelectOption[] {
  return roles
    .filter((role) => !excludeIds.includes(role.id))
    .map((role) => ({
      value: role.id,
      label: role.name,
      meta: privilegeCountText(role.privilegeCount),
      badge: role.isMaster ? <MasterBadge /> : undefined,
    }));
}

/**
 * Description: Pick exactly one role for a user (searchable, single value).
 * Input: The trigger id, the assignable roles, the (default) value, change
 *   callback, ids to exclude, disabled/loading/invalid state, aria wiring.
 * Output: A SearchableSelect that submits ONE `roleId` (hidden input) and lists
 *   each role with "All privileges" / "N privileges" and a "Master" badge.
 *   Put it inside a `Field` with `hint={ROLE_PICKER_HINT}`.
 * Use case: Access section of the sub-user forms; replacement role of the
 *   "Delete and reassign" dialog.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RolePicker({
  id,
  name = "roleId",
  roles,
  loadRoles,
  value,
  defaultValue,
  onValueChange,
  excludeIds = [],
  disabled,
  loading,
  invalid,
  "aria-describedby": ariaDescribedBy,
  required = true,
  placeholder = "Choose a role",
  ref,
  onBlur,
}: RolePickerProps) {
  return (
    <SearchableSelect
      ref={ref}
      id={id}
      name={name}
      options={toOptions(roles, excludeIds)}
      loadOptions={loadRoles ? async (search, page) => {
        const result = await loadRoles(search, page, excludeIds[0]);
        return result.ok ? { ok: true, options: toOptions(result.page.rows, excludeIds), page: result.page.page, pageCount: result.page.pageCount } : result;
      } : undefined}
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      placeholder={placeholder}
      searchPlaceholder="Search roles…"
      emptyText="No role matches. Only active roles you are allowed to assign are listed."
      disabled={disabled}
      loading={loading}
      invalid={invalid}
      aria-describedby={ariaDescribedBy}
      required={required}
      onBlur={onBlur}
    />
  );
}
