/**
 * The edit-tenant form's logic without React (docs/tenant-management.md §9.5):
 * the initial values, the client-side validation with the shared rules and its
 * per-section summary, the FormData sent to `updateTenantAction` and where a
 * successful save goes. Pure (no `server-only`, no DOM beyond `FormData` and
 * `File`), so it is unit-tested directly. The server stays authoritative.
 */
import { validateCustomDomain, validateSubdomainLabel } from "@/lib/domains/rules";
import type { TenantForEdit } from "@/lib/tenants/service";
import { validateEmail, validateFullName, validatePhone, validateTenantUsername } from "@/lib/tenants/rules";
import type { ProfileImageAction, UpdateTenantField, UpdateTenantFieldErrors } from "../../action-types";
import { TENANTS_PATH } from "../../list-query";

/** The text fields of the edit form; the profile image is handled on its own. */
export type EditValues = {
  fullName: string;
  phone: string;
  username: string;
  email: string;
  subdomain: string;
  customDomain: string;
};

export type EditTextField = keyof EditValues;

/** The profile image change: keep the stored one, remove it, or replace it with `file`. */
export type EditImage = { action: ProfileImageAction; file: File | null };

/** The persisted values, as the form starts with them. */
export function initialEditValues(tenant: TenantForEdit): EditValues {
  return {
    fullName: tenant.fullName,
    phone: tenant.phone ?? "",
    username: tenant.username,
    email: tenant.email,
    subdomain: tenant.subdomain,
    customDomain: tenant.customDomain ?? "",
  };
}

type FormSectionId = "profile" | "login" | "domain";

/** Every field with its section, in the order the form shows them. */
const FIELD_SECTIONS: Record<UpdateTenantField, FormSectionId> = {
  fullName: "profile",
  phone: "profile",
  profileImage: "profile",
  username: "login",
  email: "login",
  subdomain: "domain",
  customDomain: "domain",
};

export const EDIT_FIELDS = Object.keys(FIELD_SECTIONS) as UpdateTenantField[];

const SECTIONS: readonly { id: FormSectionId; title: string }[] = [
  { id: "profile", title: "Profile" },
  { id: "login", title: "Login" },
  { id: "domain", title: "Domain" },
];

export type EditValidationContext = {
  baseDomain: string;
  /** The inline error of the chosen profile image, if any. */
  imageError?: string | null;
};

function errorOf(result: { ok: true } | { ok: false; error: string }): string | undefined {
  return result.ok ? undefined : result.error;
}

/** The client-side error of one field, or undefined. */
export function validateEditField(
  field: UpdateTenantField,
  values: EditValues,
  ctx: EditValidationContext,
): string | undefined {
  switch (field) {
    case "fullName":
      return errorOf(validateFullName(values.fullName));
    case "phone":
      return errorOf(validatePhone(values.phone));
    case "profileImage":
      return ctx.imageError ?? undefined;
    case "username":
      return errorOf(validateTenantUsername(values.username));
    case "email":
      return errorOf(validateEmail(values.email));
    case "subdomain":
      return errorOf(validateSubdomainLabel(values.subdomain));
    case "customDomain": {
      const domain = values.customDomain.trim();
      // Empty removes the domain; an internationalized name is converted to
      // punycode on the server only, so only the server can judge it.
      if (domain === "" || !/^[\x00-\x7f]*$/.test(domain)) return undefined;
      return errorOf(validateCustomDomain(domain, ctx.baseDomain));
    }
  }
}

/** Every client-side error at once, as the server returns them. */
export function validateEditForm(values: EditValues, ctx: EditValidationContext): UpdateTenantFieldErrors {
  const errors: UpdateTenantFieldErrors = {};
  for (const field of EDIT_FIELDS) {
    const error = validateEditField(field, values, ctx);
    if (error) errors[field] = error;
  }
  return errors;
}

export type EditSectionSummary = {
  id: FormSectionId;
  title: string;
  /** The field the summary link focuses. */
  firstField: UpdateTenantField;
  count: number;
};

/** One entry per section with problems, pointing at its first invalid field. */
export function summarizeEditErrors(errors: UpdateTenantFieldErrors): EditSectionSummary[] {
  return SECTIONS.flatMap((section) => {
    const fields = EDIT_FIELDS.filter((field) => FIELD_SECTIONS[field] === section.id && errors[field]);
    const [firstField] = fields;
    return firstField ? [{ ...section, firstField, count: fields.length }] : [];
  });
}

/**
 * The fields `updateTenantAction` reads. A replacement without a file is sent
 * as `keep`, so a half-finished choice never removes the stored image.
 */
export function buildUpdateFormData(values: EditValues, image: EditImage): FormData {
  const data = new FormData();
  for (const field of Object.keys(values) as EditTextField[]) data.append(field, values[field]);
  if (image.action === "replace" && image.file) {
    data.append("profileImageAction", "replace");
    data.append("profileImage", image.file);
  } else {
    data.append("profileImageAction", image.action === "remove" ? "remove" : "keep");
  }
  return data;
}

/** The details page after a save, with the notice that fits it. */
export function savedTenantHref(tenantId: string, dnsPending: boolean): string {
  const notice = dnsPending ? "updated-dns" : "updated";
  return `${TENANTS_PATH}/${encodeURIComponent(tenantId)}?notice=${notice}`;
}
