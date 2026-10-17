/**
 * Field rules of the sub-user forms: Sub-Platform Owners, Sub-Tenants and
 * Sub-Customers (.vibe/memory/role-privilege-management.md, "Sub-users" and
 * "UI specs" → "Sub-user form").
 *
 * Nothing new is invented here: every person rule is the existing, shared rule
 * (full name, email, username, password from src/lib/tenants/rules.ts; account
 * type from src/lib/workspace/rules.ts), composed per form variant so the
 * client form and the server services check exactly the same thing.
 *
 * Client-safe: no `server-only`, no `node:` imports, no database access.
 */
import {
  validateEmail,
  validateFullName,
  validateMasterPassword,
  validateTenantUsername,
} from "@/lib/tenants/rules";
import { isUuid } from "@/lib/uuid";
import { validateAccountType } from "@/lib/workspace/rules";

/** Which panel's sub-user the form is for. */
export type SubUserVariant = "platform" | "tenant" | "customer";

/** Create a new sub-user, or edit an existing one. */
export type SubUserMode = "create" | "edit";

/** Every field a sub-user form can have (each variant/mode uses a subset). */
export type SubUserFields = {
  fullName: string;
  accountType: string;
  username: string;
  email: string;
  password: string;
  confirmPassword: string;
  roleId: string;
};

export type SubUserFieldName   = keyof SubUserFields;
export type SubUserFieldErrors = Partial<Record<SubUserFieldName, string>>;

/** The page order of the fields (the first invalid one gets the focus). */
export const SUB_USER_FIELD_ORDER: readonly SubUserFieldName[] = [
  "fullName",
  "accountType",
  "username",
  "email",
  "password",
  "confirmPassword",
  "roleId",
];

/** Fields whose surrounding spaces are meaningless (trimmed on blur and submit). */
export const SUB_USER_TRIMMED_FIELDS: readonly SubUserFieldName[] = ["fullName", "username", "email"];

/**
 * Description: List the fields a sub-user form shows and validates.
 * Input: The variant (platform / tenant / customer) and the mode (create / edit).
 * Output: The field names in page order. Create: full name, account type
 *   (customer only), username, email (tenant and customer only), password,
 *   confirmation, role. Edit: full name, password + confirmation (optional
 *   "Set a new password") and role; username, email and account type are
 *   read-only on edit (business rule "Edit: full name, role, optional new password").
 * Use case: The sub-user form (which inputs to render) and the services
 *   (which submitted fields to read).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function subUserFieldsFor(variant: SubUserVariant, mode: SubUserMode): SubUserFieldName[] {
  return SUB_USER_FIELD_ORDER.filter((name) => {
    // Platform owners have no email and no account type.
    if (name === "email") return variant !== "platform" && mode === "create";
    if (name === "accountType") return variant === "customer" && mode === "create";
    // The username never changes after creation.
    if (name === "username") return mode === "create";
    return true;
  });
}

/**
 * Description: Check one field of a sub-user form.
 * Input: The field, every current value (the password rule needs the username,
 *   the confirmation needs the password), the mode, and on edit the stored
 *   username (the password must not contain it).
 * Output: The error message for that field, or undefined when it is valid.
 *   Edit mode: the password pair is optional, but once either is filled both
 *   must be valid.
 * Use case: Live (typing/blur) validation and validateSubUserFields.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function subUserFieldError(
  name: SubUserFieldName,
  fields: SubUserFields,
  mode: SubUserMode,
  existingUsername = "",
): string | undefined {
  if (name === "fullName") {
    // The shared rule speaks about "the tenant"; here the person is the sub-user.
    if (fields.fullName.trim().length === 0) return "Enter the full name.";
    const result = validateFullName(fields.fullName);
    return result.ok ? undefined : result.error;
  }
  if (name === "accountType") {
    const result = validateAccountType(fields.accountType);
    return result.ok ? undefined : "Choose the account type.";
  }
  if (name === "username") {
    const result = validateTenantUsername(fields.username);
    return result.ok ? undefined : result.error;
  }
  if (name === "email") {
    const result = validateEmail(fields.email);
    return result.ok ? undefined : result.error;
  }
  if (name === "roleId") {
    // Exactly one role id, a UUID (the server re-checks it is assignable).
    return isUuid(fields.roleId.trim()) ? undefined : "Choose a role.";
  }

  // Password and confirmation: optional on edit until something is typed.
  const passwordOptional = mode === "edit" && fields.password === "" && fields.confirmPassword === "";
  if (passwordOptional) return undefined;

  if (name === "password") {
    // The password must not contain the (normalized) username.
    const username = (mode === "edit" ? existingUsername : fields.username).trim().toLowerCase();
    const result   = validateMasterPassword(fields.password, username);
    return result.ok ? undefined : result.error;
  }
  // confirmPassword: required and identical to the password.
  if (fields.confirmPassword.length === 0) return "Confirm the password.";
  if (fields.confirmPassword !== fields.password) return "The passwords do not match.";
  return undefined;
}

/**
 * Description: Check every field a sub-user form shows.
 * Input: The values, the variant, the mode and (edit) the stored username.
 * Output: One message per invalid field (empty object when the form is valid).
 * Use case: Sub-user form submit (client) and the sub-user services (server).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function validateSubUserFields(
  fields: SubUserFields,
  variant: SubUserVariant,
  mode: SubUserMode,
  existingUsername = "",
): SubUserFieldErrors {
  const errors: SubUserFieldErrors = {};
  for (const name of subUserFieldsFor(variant, mode)) {
    const error = subUserFieldError(name, fields, mode, existingUsername);
    if (error) errors[name] = error;
  }
  return errors;
}
