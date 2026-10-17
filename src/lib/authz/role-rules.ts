/**
 * Field rules of the role editor (.vibe/memory/role-privilege-management.md,
 * "Business rules" → "Delegation ceiling" and "UI specs" → "Role editor").
 *
 * The server applies these as the source of truth; the role editor imports the
 * same functions for instant feedback. So this module must stay pure: no
 * `server-only`, no `node:` imports, no environment or database access.
 *
 * What lives elsewhere (reused here, never duplicated):
 *   - the master role names and the `requires` closure → `./catalog`
 *     (`MASTER_ROLE_NAMES`, `dependencyClosure`, `validatePermissionSelection`);
 *   - uniqueness per scope → the role services (database).
 */
import type { RuleResult } from "@/lib/tenants/rules";
import { CATALOG_PERMISSIONS, dependencyClosure, MASTER_ROLE_NAMES } from "./catalog";

export type { RuleResult };

// ---------------------------------------------------------------------------
// Limits (also passed to the editor as maxLength attributes)

export const ROLE_NAME_MIN_LENGTH        = 3;
export const ROLE_NAME_MAX_LENGTH        = 100;
export const ROLE_DESCRIPTION_MAX_LENGTH = 500;

// Letters (any script, with their combining marks), digits, spaces and - _ & ( ) . '
const ROLE_NAME_PATTERN = /^[\p{L}\p{M}\p{Nd} \-_&().']+$/u;

/** The allowed characters in plain words, for hints and error messages. */
export const ROLE_NAME_ALLOWED_TEXT = "letters, digits, spaces and - _ & ( ) . '";

// Control characters (tabs, newlines, …) are never part of a name or description.
const CONTROL_CHARACTER = /[\p{Cc}]/u;

// Line breaks and tabs a description may contain (it is a textarea).
const DESCRIPTION_ALLOWED_WHITESPACE = /[\n\r\t]/g;

/**
 * Description: Wrap a valid, normalized value in a successful rule result.
 * Input: The value the rule accepted.
 * Output: `{ ok: true, value }`.
 * Use case: Every validator in this module.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function ok<T>(value: T): RuleResult<T> {
  return { ok: true, value };
}

/**
 * Description: Wrap a user-facing error message in a failed rule result.
 * Input: The message shown under the field.
 * Output: `{ ok: false, error }`.
 * Use case: Every validator in this module.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function fail<T>(error: string): RuleResult<T> {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// Role name

/**
 * Description: Bring a typed role name into its stored form.
 * Input: The raw text from the form.
 * Output: The text trimmed, with every run of inner spaces collapsed to one.
 * Use case: Validation, the value written to the database and comparisons.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function normalizeRoleName(input: string): string {
  // Only ordinary spaces are collapsed; tabs/newlines stay and are rejected below.
  return input.trim().replace(/ {2,}/g, " ");
}

/**
 * Description: Build the key two role names are compared by.
 * Input: A role name as typed or stored.
 * Output: The normalized name in lower case (Unicode-aware), e.g. "  Sales  Team " → "sales team".
 * Use case: Case-insensitive uniqueness per scope (services) and the reserved
 *   master-name check, so "master   PLATFORM" counts as "Master Platform".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function roleNameComparisonKey(input: string): string {
  return normalizeRoleName(input).toLocaleLowerCase("en-US");
}

/**
 * Description: Tell whether a name is one of the master role names.
 * Input: A role name (any spacing or case).
 * Output: True for "Master Platform", "Master Tenant" and "Master Customer"
 *   (from the catalog's MASTER_ROLE_NAMES), compared case-insensitively.
 * Use case: Custom roles may never take a master role's name (names grant
 *   nothing, but a look-alike name would mislead people).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function isReservedRoleName(input: string): boolean {
  const key = roleNameComparisonKey(input);
  return Object.values(MASTER_ROLE_NAMES).some((name) => roleNameComparisonKey(name) === key);
}

/**
 * Description: Check a custom role's name against the business rules.
 * Input: The raw text from the form (trimmed and collapsed here).
 * Output: The normalized name, or the message for the first broken rule.
 *   Rules, in order: required (whitespace-only is empty); no control
 *   characters; only letters, digits, spaces and - _ & ( ) . '; 3–100
 *   characters; not a master role name.
 * Use case: Role editor (live feedback) and the role services (authoritative;
 *   they add the per-scope uniqueness check).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function validateRoleName(input: string): RuleResult<string> {
  // Step 1: the stored form decides the length and the characters.
  const name = normalizeRoleName(input);

  // Step 2: required; a whitespace-only entry is empty after trimming.
  if (name.length === 0) return fail("Enter a role name.");

  // Step 3: control characters (pasted tabs or line breaks) are never part of a name.
  if (CONTROL_CHARACTER.test(name)) return fail("Remove the tabs or line breaks from the role name.");

  // Step 4: the allowed characters only.
  if (!ROLE_NAME_PATTERN.test(name)) return fail(`Use only ${ROLE_NAME_ALLOWED_TEXT} in the role name.`);

  // Step 5: the length limits of the column and the business rule.
  if (name.length < ROLE_NAME_MIN_LENGTH || name.length > ROLE_NAME_MAX_LENGTH) {
    return fail(`Use ${ROLE_NAME_MIN_LENGTH}–${ROLE_NAME_MAX_LENGTH} characters for the role name.`);
  }

  // Step 6: master role names are reserved for the system roles.
  if (isReservedRoleName(name)) return fail("This name is reserved for a system role. Choose another name.");
  return ok(name);
}

// ---------------------------------------------------------------------------
// Role description

/**
 * Description: Check a role's optional description.
 * Input: The raw text from the textarea.
 * Output: The trimmed description, null when empty (whitespace-only counts as
 *   empty), or the error message (more than 500 characters, or control
 *   characters other than line breaks and tabs).
 * Use case: Role editor (live feedback and the counter) and the role services.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function validateRoleDescription(input: string): RuleResult<string | null> {
  // Step 1: surrounding spaces are meaningless; an empty description is stored as null.
  const description = input.trim();
  if (description.length === 0) return ok(null);

  // Step 2: line breaks are allowed in a textarea, other control characters are not.
  if (CONTROL_CHARACTER.test(description.replace(DESCRIPTION_ALLOWED_WHITESPACE, ""))) return fail("Remove the unsupported characters from the description.");

  // Step 3: the length limit.
  if (description.length > ROLE_DESCRIPTION_MAX_LENGTH) {
    return fail(`Use at most ${ROLE_DESCRIPTION_MAX_LENGTH} characters for the description.`);
  }
  return ok(description);
}

// ---------------------------------------------------------------------------
// Role status

/** The two states a custom role can be saved with. */
export type RoleStatus = "active" | "disabled";

/** The status options in the order the editor shows them. */
export const ROLE_STATUS_OPTIONS: readonly { value: RoleStatus; label: string; description: string }[] = [
  { value: "active",   label: "Active",   description: "Users with this role get its privileges." },
  { value: "disabled", label: "Disabled", description: "Users with this role lose all protected access until it is enabled again." },
];

/**
 * Description: Check a submitted role status.
 * Input: The raw value from the form.
 * Output: "active" or "disabled", or the error message.
 * Use case: Role editor submit and the role services.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function validateRoleStatus(input: string): RuleResult<RoleStatus> {
  return input === "active" || input === "disabled" ? ok(input) : fail("Choose the role's status.");
}

// ---------------------------------------------------------------------------
// Privilege selection (`requires` dependencies)

// Who requires a privilege directly: key → the privileges listing it in `requires`.
const DIRECT_DEPENDENTS = new Map<string, string[]>();
for (const permission of CATALOG_PERMISSIONS) {
  for (const required of permission.requires) {
    const dependents = DIRECT_DEPENDENTS.get(required) ?? [];
    dependents.push(permission.key);
    DIRECT_DEPENDENTS.set(required, dependents);
  }
}

/**
 * Description: List every privilege that (directly or transitively) requires a privilege.
 * Input: A privilege key.
 * Output: The keys of all its dependents (never the key itself); empty for an
 *   unknown key or a privilege nobody requires.
 * Use case: clearDependents; the "needed by" hints of the role editor.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function dependentsOf(key: string): Set<string> {
  const dependents = new Set<string>();
  // Walk the reverse `requires` edges until nothing new is found.
  const pending = [...(DIRECT_DEPENDENTS.get(key) ?? [])];
  while (pending.length > 0) {
    const next = pending.pop() as string;
    if (dependents.has(next) || next === key) continue;
    dependents.add(next);
    pending.push(...(DIRECT_DEPENDENTS.get(next) ?? []));
  }
  return dependents;
}

/**
 * Description: Remove a privilege and everything that depends on it from a selection.
 * Input: The current selection and the key being cleared.
 * Output: A NEW set without the key and without every privilege requiring it
 *   (e.g. clearing "View tenants" also clears "Edit tenants").
 * Use case: Role editor: un-ticking a required privilege keeps the selection
 *   valid for `validatePermissionSelection` on the server.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function clearDependents(selected: Iterable<string>, key: string): Set<string> {
  const removed = dependentsOf(key);
  removed.add(key);
  return new Set([...selected].filter((candidate) => !removed.has(candidate)));
}

/**
 * Description: Apply one tick or un-tick to a privilege selection.
 * Input: The current selection, the key, whether it is now checked, and the
 *   keys the actor may assign (the editor's checkboxes).
 * Output: A NEW set. Checked: the key plus its `requires` closure (catalog
 *   `dependencyClosure`), limited to assignable keys. Un-checked: the key and
 *   all its dependents removed (clearDependents).
 * Use case: Role editor per-privilege checkbox and the module header checkbox.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function toggleSelection(
  selected: Iterable<string>,
  key: string,
  checked: boolean,
  assignable: ReadonlySet<string>,
): Set<string> {
  // Un-ticking: remove the key and everything that needs it.
  if (!checked) return clearDependents(selected, key);

  // Ticking: add the key and its requirements, but never a key the actor cannot grant.
  const next = new Set(selected);
  for (const required of dependencyClosure([key])) {
    if (assignable.has(required)) next.add(required);
  }
  return next;
}
