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

/**
 * Description: Prefill the edit form with the tenant's saved values.
 * Input: The tenant as loaded for editing.
 * Output: The text values (an absent phone or custom domain becomes "").
 * Use case: First render of the edit form (CLAUDE.md: edit forms are prefilled).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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

export type EditSectionId = "profile" | "login" | "domain";
type FormSectionId = EditSectionId;

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

/**
 * The form's categories (CLAUDE.md category-wise organization) in page order.
 * `title` is the section heading, the secondary menu label and the error
 * summary label; `anchor` is the section's DOM id for the secondary menu.
 */
export const EDIT_SECTIONS: readonly { id: FormSectionId; title: string; anchor: string }[] = [
  { id: "profile", title: "Personal Information", anchor: "edit-tenant-personal-information" },
  { id: "login", title: "Login Information", anchor: "edit-tenant-login-information" },
  { id: "domain", title: "Domain Information", anchor: "edit-tenant-domain-information" },
];

/** The label of every field as the error summary names it. */
export const EDIT_FIELD_LABELS: Readonly<Record<UpdateTenantField, string>> = {
  fullName: "Full name",
  phone: "Phone",
  profileImage: "Profile image",
  username: "Username",
  email: "Email",
  subdomain: "SaaS subdomain",
  customDomain: "Custom domain",
};

export type EditValidationContext = {
  baseDomain: string;
  /** The inline error of the chosen profile image, if any. */
  imageError?: string | null;
};

/**
 * Description: Turn a rule result into an optional error message.
 * Input: A rule result.
 * Output: The error message, or undefined when the rule passed.
 * Use case: validateEditField.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function errorOf(result: { ok: true } | { ok: false; error: string }): string | undefined {
  return result.ok ? undefined : result.error;
}

/**
 * Description: Validate one edit-form field with the shared tenant rules.
 * Input: The field, the current values and the validation context.
 * Output: The field's error message, or undefined when it is fine.
 * Use case: Blur validation, re-validation while typing and the submit check.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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

/**
 * Description: Validate the whole edit form at once.
 * Input: The current values and the validation context.
 * Output: Every client-side error, keyed by field, as the server returns them.
 * Use case: The submit handler: an invalid form is never sent.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
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
  /** The field the section link focuses. */
  firstField: UpdateTenantField;
  /** Every invalid field of the section, in page order, with its label. */
  fields: { field: UpdateTenantField; label: string }[];
};

/**
 * Description: Summarize the current errors per form section.
 * Input: The current field errors.
 * Output: One entry per section with problems: its title, its first invalid
 *   field and every invalid field with its label (no bare counts).
 * Use case: The error summary above the edit form; each field name is a link
 *   that focuses that field (CLAUDE.md: no count without its details).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function summarizeEditErrors(errors: UpdateTenantFieldErrors): EditSectionSummary[] {
  return EDIT_SECTIONS.flatMap((section) => {
    // The section's invalid fields, in the order the page shows them.
    const invalid = EDIT_FIELDS.filter((field) => FIELD_SECTIONS[field] === section.id && errors[field]);
    const [firstField] = invalid;
    if (!firstField) return [];
    return [
      {
        id: section.id,
        title: section.title,
        firstField,
        fields: invalid.map((field) => ({ field, label: EDIT_FIELD_LABELS[field] })),
      },
    ];
  });
}

/**
 * Description: Tell whether the owner changed anything that leaving the page would lose.
 * Input: The current values, the saved (initial) values and the image choice.
 * Output: True when a text value differs or the image is replaced or removed.
 * Use case: Cancel asks for confirmation only when there are unsaved changes
 *   (CLAUDE.md: confirm risky actions).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function hasUnsavedEdits(values: EditValues, initial: EditValues, image: EditImage): boolean {
  if (image.action !== "keep") return true;
  return (Object.keys(values) as EditTextField[]).some((field) => values[field] !== initial[field]);
}

/**
 * Description: Build the exact payload `updateTenantAction` reads.
 * Input: The current text values and the image choice.
 * Output: FormData with every text field and `profileImageAction` (plus the file for
 *   a replacement). A replacement without a file is sent as `keep`, so a
 *   half-finished choice never removes the stored image.
 * Use case: Submitting the edit form.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
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

/**
 * Description: Build the details-page URL to open after a save.
 * Input: The tenant id and whether a changed domain still waits for DNS.
 * Output: `/platform/tenants/<id>?notice=updated` or `…=updated-dns`.
 * Use case: The edit form's navigation after a successful save.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function savedTenantHref(tenantId: string, dnsPending: boolean): string {
  const notice = dnsPending ? "updated-dns" : "updated";
  return `${TENANTS_PATH}/${encodeURIComponent(tenantId)}?notice=${notice}`;
}
