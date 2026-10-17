/**
 * The create-tenant form's logic without React (docs/tenant-management.md §9.3):
 * the per-section Auto-Generate / Manual switches and the change between them,
 * the client-side validation and its per-section summary, and the FormData
 * sent to `createTenantAction`. Pure (no `server-only`, no DOM beyond
 * `FormData`, `File` and `crypto.getRandomValues`), so it is unit-tested directly.
 *
 * The server stays authoritative: these checks only give instant feedback,
 * with the same rule functions the server uses.
 */
import { validateCustomDomain, validateSubdomainLabel } from "@/lib/domains/rules";
import { MAX_PROFILE_IMAGE_BYTES, validateProfileImage } from "@/lib/storage/image";
import {
  checkMasterPassword,
  parsePort,
  validateDatabaseIdentifier,
  validateEmail,
  validateExistingDatabasePassword,
  validateFullName,
  validateMasterPassword,
  validateNewDatabasePassword,
  validatePhone,
  validateTenantUsername,
} from "@/lib/tenants/rules";
import type {
  CreateTenantField,
  CreateTenantFieldErrors,
  PreviewValues,
  TestConnectionInput,
} from "../action-types";

export type CredentialMode = "auto" | "manual";
export type DatabaseMode = "provisioned" | "existing";

/** The form's sections, in the order the form shows them. */
export type FormSectionId = "profile" | "login" | "database" | "domain";

/**
 * The sections that have their own Auto-Generate / Manual switch. The tenant
 * profile has nothing that could be generated, so it has none.
 */
export type ModeSection = Exclude<FormSectionId, "profile">;

/** The switch position of every section that has one. */
export type SectionModes = Record<ModeSection, CredentialMode>;

/** The order the switchable sections appear in on the page. */
export const MODE_SECTIONS: readonly ModeSection[] = ["login", "database", "domain"];

/** The same whatever the switches say. */
export type SharedValues = {
  fullName: string;
  phone: string;
  email: string;
  customDomain: string;
};

/** Everything the owner types in a Manual section; never overwritten by a preview once typed. */
export type ManualValues = {
  username: string;
  subdomain: string;
  masterPassword: string;
  databaseMode: DatabaseMode;
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
  databasePort: string;
};

export type FormValues = {
  /** Auto-Generate or Manual, per section. */
  modes: SectionModes;
  shared: SharedValues;
  /** The latest server preview (used by Auto sections); null until one arrived. */
  generated: PreviewValues | null;
  manual: ManualValues;
  /** Per section: whether its first switch to Manual has filled empty fields from a preview. */
  prefilledFromPreview: Record<ModeSection, boolean>;
};

export type SharedField = keyof SharedValues;
export type ManualField = Exclude<keyof ManualValues, "databaseMode">;

/** The identifiers a preview generates. */
export const GENERATED_FIELDS = ["username", "subdomain", "databaseName", "databaseUser"] as const;
export type GeneratedField = (typeof GENERATED_FIELDS)[number];

/**
 * The previewed identifiers each switchable section owns, in the order the
 * section lists them. Auto submits these from the preview, Manual from the inputs.
 */
export const SECTION_GENERATED_FIELDS: Record<ModeSection, readonly GeneratedField[]> = {
  login: ["username"],
  database: ["databaseName", "databaseUser"],
  domain: ["subdomain"],
};

/** The FormData / server field that carries each section's switch. */
export const SECTION_MODE_FIELD: Record<ModeSection, CreateTenantField> = {
  login: "loginMode",
  database: "databaseCredentialMode",
  domain: "subdomainMode",
};

/**
 * Fields whose meaning depends on a section's switch: their errors go when
 * that switch changes. Fields that are always typed (email, custom domain)
 * are not listed, so their errors survive a switch.
 */
const SECTION_MODE_DEPENDENT_FIELDS: Record<ModeSection, readonly CreateTenantField[]> = {
  login: ["loginMode", "username", "masterPassword"],
  database: [
    "databaseCredentialMode",
    "databaseMode",
    "databaseName",
    "databaseUser",
    "databasePassword",
    "databasePort",
  ],
  domain: ["subdomainMode", "subdomain"],
};

/** Fields a "Test connection" result depends on: changing one clears the result. */
export const CONNECTION_FIELDS = [
  "databaseName",
  "databaseUser",
  "databasePassword",
  "databasePort",
] as const satisfies readonly (keyof TestConnectionInput)[];

/**
 * Description: Build the empty create-form state.
 * Input: The configured default database port (POSTGRES_PORT).
 * Output: Every section on Auto-Generate, nothing generated, empty manual drafts.
 * Use case: First render of the create form and "Create another tenant".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function initialFormValues(defaultPort: number): FormValues {
  return {
    // Auto-Generate is the default everywhere: the owner only types a name and email.
    modes: { login: "auto", database: "auto", domain: "auto" },
    shared: { fullName: "", phone: "", email: "", customDomain: "" },
    generated: null,
    manual: {
      username: "",
      subdomain: "",
      masterPassword: "",
      databaseMode: "provisioned",
      databaseName: "",
      databaseUser: "",
      databasePassword: "",
      databasePort: String(defaultPort),
    },
    prefilledFromPreview: { login: false, database: false, domain: false },
  };
}

// ---------------------------------------------------------------------------
// Modes

/**
 * Description: Find the section whose switch decides where a generated identifier comes from.
 * Input: One previewable identifier.
 * Output: Its section ("login", "database" or "domain").
 * Use case: Per-field decisions (submit, validate) that depend on the section's switch.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function sectionOfGeneratedField(field: GeneratedField): ModeSection {
  // Each identifier belongs to exactly one section; the lookup is by membership.
  const section = MODE_SECTIONS.find((id) => SECTION_GENERATED_FIELDS[id].includes(field));
  return section as ModeSection;
}

/**
 * Description: Tell whether at least one section is on Auto-Generate.
 * Input: The current form values.
 * Output: True when some section still needs the server preview.
 * Use case: Request a preview only when something actually uses it (saves the rate limit).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function anySectionAuto(values: FormValues): boolean {
  return MODE_SECTIONS.some((section) => values.modes[section] === "auto");
}

export type ModeSwitch = {
  values: FormValues;
  /** The manual fields of the switched section that were empty and now hold the generated value. */
  prefilled: GeneratedField[];
};

/**
 * Description: Move one section between Auto-Generate and Manual.
 * Input: The current values, the section and the requested mode.
 * Output: The new values, and which of the section's empty fields were prefilled.
 * Use case: The owner clicks a section's Auto-Generate / Manual switch.
 *
 * Only that section changes. On its first switch to Manual with a preview at
 * hand, the section's identifiers that are still empty take the generated
 * value; nothing typed is ever replaced, and passwords are never copied (they
 * are not in a preview at all).
 *
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function switchSectionMode(
  values: FormValues,
  section: ModeSection,
  next: CredentialMode,
): ModeSwitch {
  // Step 1: nothing to do when the switch is already in that position.
  if (values.modes[section] === next) return { values, prefilled: [] };
  const modes = { ...values.modes, [section]: next };

  // Step 2: to Auto, or to Manual when there is nothing (left) to prefill:
  // only the switch moves; every typed value is kept for a later switch back.
  if (next === "auto" || values.prefilledFromPreview[section] || values.generated === null) {
    return { values: { ...values, modes }, prefilled: [] };
  }

  // Step 3: first switch to Manual with a preview: fill only the empty fields.
  const manual = { ...values.manual };
  const prefilled: GeneratedField[] = [];
  for (const field of SECTION_GENERATED_FIELDS[section]) {
    if (manual[field].trim() === "") {
      manual[field] = values.generated[field];
      prefilled.push(field);
    }
  }
  return {
    values: {
      ...values,
      modes,
      manual,
      prefilledFromPreview: { ...values.prefilledFromPreview, [section]: true },
    },
    prefilled,
  };
}

/**
 * Description: The database mode that would be submitted.
 * Input: The current form values.
 * Output: The chosen mode in Manual; always "provisioned" in Auto.
 * Use case: An existing database can only be attached with the Database section on Manual (§8.1 step 3).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function effectiveDatabaseMode(values: FormValues): DatabaseMode {
  return values.modes.database === "manual" ? values.manual.databaseMode : "provisioned";
}

/**
 * Description: The identifiers that would be submitted, each from its own section's source.
 * Input: The current form values.
 * Output: Username, subdomain, database name and user: typed (Manual) or previewed (Auto).
 * Use case: Building the FormData and the success panel's list of generated values.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function currentIdentifiers(values: FormValues): Record<GeneratedField, string> {
  /**
   * Description: Read one identifier from its section's source.
   * Input: The identifier.
   * Output: The typed value (Manual) or the previewed value (Auto, "" before a preview).
   * Use case: currentIdentifiers.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  const pick = (field: GeneratedField): string =>
    values.modes[sectionOfGeneratedField(field)] === "manual"
      ? values.manual[field]
      : (values.generated?.[field] ?? "");
  return {
    username: pick("username"),
    subdomain: pick("subdomain"),
    databaseName: pick("databaseName"),
    databaseUser: pick("databaseUser"),
  };
}

/**
 * The values the platform generated for the owner, as the success panel
 * lists them. A key is present only when its section was on Auto-Generate:
 * values the owner typed are not repeated back.
 */
export type GeneratedSummary = {
  username?: string;
  /** The full host, e.g. "acme-music.example.com". */
  subdomainHost?: string;
  databaseName?: string;
  databaseUser?: string;
};

/**
 * Description: Collect the generated (Auto section) identifiers that are about to be submitted.
 * Input: The current form values and PLATFORM_BASE_DOMAIN.
 * Output: Only the identifiers of sections on Auto-Generate; typed ones are left out.
 * Use case: Captured at submit so the success panel can show the owner what was
 *   generated, because the Auto sections never displayed those values.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function generatedSummary(values: FormValues, baseDomain: string): GeneratedSummary {
  const identifiers = currentIdentifiers(values);
  const summary: GeneratedSummary = {};
  if (values.modes.login === "auto") summary.username = identifiers.username;
  if (values.modes.database === "auto") {
    summary.databaseName = identifiers.databaseName;
    summary.databaseUser = identifiers.databaseUser;
  }
  if (values.modes.domain === "auto") summary.subdomainHost = `${identifiers.subdomain}.${baseDomain}`;
  return summary;
}

/**
 * Description: Field errors that still apply after one section's switch changed.
 * Input: The current errors and the switched section.
 * Output: The errors without that section's mode-dependent fields.
 * Use case: A switch must not leave errors about values that are no longer submitted.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function errorsAfterModeSwitch(
  errors: CreateTenantFieldErrors,
  section: ModeSection,
): CreateTenantFieldErrors {
  return withoutFields(errors, SECTION_MODE_DEPENDENT_FIELDS[section]);
}

/**
 * Description: Remove the given fields from an error map.
 * Input: The current errors and the fields to drop.
 * Output: A new error map without those fields (the input is not changed).
 * Use case: Clearing errors of edited fields, of a switched section and after a new preview.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function withoutFields(
  errors: CreateTenantFieldErrors,
  fields: readonly CreateTenantField[],
): CreateTenantFieldErrors {
  const next = { ...errors };
  for (const field of fields) delete next[field];
  return next;
}

/**
 * Description: Clear only the passwords the server rejected after a failed create.
 * Input: The current values and the server's field errors.
 * Output: The values with a rejected master or database password emptied; everything else kept.
 * Use case: After a failed create (CLAUDE.md: never clear input unnecessarily; a rejected secret must be retyped).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function clearRejectedPasswords(
  values: FormValues,
  fieldErrors: CreateTenantFieldErrors,
): FormValues {
  const manual = { ...values.manual };
  if (fieldErrors.masterPassword) manual.masterPassword = "";
  if (fieldErrors.databasePassword) manual.databasePassword = "";
  return { ...values, manual };
}

/**
 * Description: Forget every typed password after a successful create.
 * Input: The current values.
 * Output: The values with both passwords emptied.
 * Use case: After a successful create, so no secret stays in component state.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function clearPasswords(values: FormValues): FormValues {
  return { ...values, manual: { ...values.manual, masterPassword: "", databasePassword: "" } };
}

// ---------------------------------------------------------------------------
// FormData for createTenantAction

/**
 * The form's field names as `createTenantAction` reads them (action-types.ts),
 * in the order the page shows them within each section (a section's switch is
 * in its header, so it comes first). A Record over the union, so a field
 * added on the server fails the type check here.
 */
const FIELD_SECTIONS: Record<CreateTenantField, FormSectionId> = {
  fullName: "profile",
  phone: "profile",
  profileImage: "profile",
  loginMode: "login",
  username: "login",
  email: "login",
  masterPassword: "login",
  databaseCredentialMode: "database",
  databaseMode: "database",
  databaseName: "database",
  databaseUser: "database",
  databasePassword: "database",
  databasePort: "database",
  subdomainMode: "domain",
  subdomain: "domain",
  customDomain: "domain",
};

export const CREATE_TENANT_FIELDS = Object.keys(FIELD_SECTIONS) as CreateTenantField[];

/**
 * Description: The section a form field is shown in.
 * Input: One create-form field name.
 * Output: Its section id.
 * Use case: Focusing a section's switch when the field itself is hidden (Auto).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function sectionOfField(field: CreateTenantField): FormSectionId {
  return FIELD_SECTIONS[field];
}

/**
 * Description: Build the exact payload `createTenantAction` reads.
 * Input: The current form values and the chosen profile image (or null).
 * Output: FormData with the three section switches, the identifiers and, per Manual section, its secrets.
 * Use case: Submitting the create form.
 *
 * Secrets of a section on Auto are generated on the server, so they are not
 * sent at all: a password typed earlier in Manual never leaves the browser
 * unless that section is on Manual when the form is submitted.
 *
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function buildCreateFormData(values: FormValues, profileImage: File | null): FormData {
  const data = new FormData();
  /**
   * Description: Append one field to the FormData.
   * Input: The field name and its value.
   * Output: Nothing.
   * Use case: buildCreateFormData.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  const set = (field: CreateTenantField, value: string | File) => data.append(field, value);

  // Step 1: the switches and the database mode.
  for (const section of MODE_SECTIONS) set(SECTION_MODE_FIELD[section], values.modes[section]);
  set("databaseMode", effectiveDatabaseMode(values));

  // Step 2: the values that are always typed.
  set("fullName", values.shared.fullName);
  set("phone", values.shared.phone);
  set("email", values.shared.email);
  set("customDomain", values.shared.customDomain);

  // Step 3: the identifiers, each from its own section's source.
  const identifiers = currentIdentifiers(values);
  for (const field of GENERATED_FIELDS) set(field, identifiers[field]);

  // Step 4: secrets only for the sections the owner fills in by hand.
  if (values.modes.login === "manual") {
    set("masterPassword", values.manual.masterPassword);
  }
  if (values.modes.database === "manual") {
    set("databasePassword", values.manual.databasePassword);
    set("databasePort", values.manual.databasePort);
  }
  if (profileImage) set("profileImage", profileImage);
  return data;
}

// ---------------------------------------------------------------------------
// Client-side validation

export type ValidationContext = {
  baseDomain: string;
  defaultPort: number;
  /** The inline error of the chosen profile image, if any. */
  imageError?: string | null;
};

// Only the server knows the control-plane database and the admin login; it
// rejects those names itself.
const NO_RESERVED_NAMES = { reservedNames: [] as string[] };

export const NOT_GENERATED_YET =
  "The generated values aren't ready. Select Regenerate, or switch this section to Manual.";

/**
 * Description: Turn a rule result into an optional error message.
 * Input: A rule result.
 * Output: The error message, or undefined when the rule passed.
 * Use case: validateField.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function errorOf(result: { ok: true } | { ok: false; error: string }): string | undefined {
  return result.ok ? undefined : result.error;
}

/**
 * Description: The "not generated yet" error for an Auto section, when it applies.
 * Input: The current form values.
 * Output: NOT_GENERATED_YET when a valid name has no preview yet, else undefined.
 * Use case: Submitting before the preview arrived (or after it failed).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function notGeneratedYet(values: FormValues): string | undefined {
  // Without a valid full name, the full name's own error already says what to do.
  if (values.generated !== null || !validateFullName(values.shared.fullName).ok) return undefined;
  return NOT_GENERATED_YET;
}

/**
 * Description: The client-side error of one field under the current switches.
 * Input: The field, the current form values and the validation context.
 * Output: The error message, or undefined when the field is fine (or not submitted).
 * Use case: Blur validation, submit validation and "Test connection".
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateField(
  field: CreateTenantField,
  values: FormValues,
  ctx: ValidationContext,
): string | undefined {
  const { shared, manual, modes } = values;
  const loginManual    = modes.login === "manual";
  const databaseManual = modes.database === "manual";
  const domainManual   = modes.domain === "manual";

  switch (field) {
    case "fullName":
      return errorOf(validateFullName(shared.fullName));
    case "phone":
      return errorOf(validatePhone(shared.phone));
    case "email":
      return errorOf(validateEmail(shared.email));
    case "customDomain": {
      const domain = shared.customDomain.trim();
      // An internationalized name is converted to punycode on the server
      // (node:url), so only the server can judge it.
      if (domain === "" || !/^[\x00-\x7f]*$/.test(domain)) return undefined;
      return errorOf(validateCustomDomain(domain, ctx.baseDomain));
    }
    case "profileImage":
      return ctx.imageError ?? undefined;
    // The switches and the database mode are radio groups: always a valid choice.
    case "loginMode":
    case "databaseCredentialMode":
    case "subdomainMode":
    case "databaseMode":
      return undefined;
    // Auto sections: one "not ready" message per section, at its first identifier.
    case "username":
      return loginManual ? errorOf(validateTenantUsername(manual.username)) : notGeneratedYet(values);
    case "subdomain":
      return domainManual ? errorOf(validateSubdomainLabel(manual.subdomain)) : notGeneratedYet(values);
    case "databaseName":
      return databaseManual
        ? errorOf(validateDatabaseIdentifier(manual.databaseName, "database", NO_RESERVED_NAMES))
        : notGeneratedYet(values);
    case "databaseUser":
      return databaseManual
        ? errorOf(validateDatabaseIdentifier(manual.databaseUser, "user", NO_RESERVED_NAMES))
        : undefined;
    // Secrets: checked only when the owner types them (Manual).
    case "masterPassword":
      return loginManual
        ? errorOf(validateMasterPassword(manual.masterPassword, manual.username))
        : undefined;
    case "databasePassword":
      if (!databaseManual) return undefined;
      return errorOf(
        manual.databaseMode === "existing"
          ? validateExistingDatabasePassword(manual.databasePassword)
          : validateNewDatabasePassword(manual.databasePassword),
      );
    case "databasePort":
      return databaseManual ? errorOf(parsePort(manual.databasePort, ctx.defaultPort)) : undefined;
  }
}

/**
 * Description: Validate the whole create form at once.
 * Input: The current values and the validation context.
 * Output: Every client-side error, keyed by field, as the server returns them.
 * Use case: The submit handler: an invalid form is never sent.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateForm(values: FormValues, ctx: ValidationContext): CreateTenantFieldErrors {
  const errors: CreateTenantFieldErrors = {};
  for (const field of CREATE_TENANT_FIELDS) {
    const error = validateField(field, values, ctx);
    if (error) errors[field] = error;
  }
  return errors;
}

/**
 * Description: Check the existing-database fields before Test connection.
 * Input: The current values and the validation context.
 * Output: The connection input when valid, otherwise the field errors.
 * Use case: The Test connection button (Manual database section, existing database).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function validateConnection(
  values: FormValues,
  ctx: ValidationContext,
): { ok: true; input: TestConnectionInput } | { ok: false; errors: CreateTenantFieldErrors } {
  const errors: CreateTenantFieldErrors = {};
  for (const field of CONNECTION_FIELDS) {
    const error = validateField(field, values, ctx);
    if (error) errors[field] = error;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const { databaseName, databaseUser, databasePassword, databasePort } = values.manual;
  return { ok: true, input: { databaseName, databaseUser, databasePassword, databasePort } };
}

// ---------------------------------------------------------------------------
// Profile image

/**
 * Description: Run the server's image checks on a chosen file before it is uploaded.
 * Input: The chosen file.
 * Output: null when acceptable; otherwise the message: empty file, larger than 2 MB,
 *   or an unsupported/incomplete PNG/JPEG/WebP container. The server additionally
 *   decodes all pixels before storage; file names and claimed MIME are untrusted.
 * Use case: The profile image pickers of the create and edit forms (shown with an instant preview).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export async function checkProfileImageFile(file: Blob): Promise<string | null> {
  if (file.size === 0) return "The file is empty. Choose an image file.";
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    return "The image is larger than 2 MB. Choose a smaller image.";
  }
  const bytes  = new Uint8Array(await file.arrayBuffer());
  const result = validateProfileImage(bytes);
  return result.ok ? null : result.error;
}

// ---------------------------------------------------------------------------
// Error summary

/**
 * The form's categories (CLAUDE.md category-wise organization) in page order.
 * `title` is the section heading, the secondary menu label and the error
 * summary label; `anchor` is the section's DOM id for the secondary menu.
 */
export const FORM_SECTIONS: readonly { id: FormSectionId; title: string; anchor: string }[] = [
  { id: "profile", title: "Personal Information", anchor: "create-tenant-personal-information" },
  { id: "login", title: "Login Information", anchor: "create-tenant-login-information" },
  { id: "database", title: "Database Information", anchor: "create-tenant-database-information" },
  { id: "domain", title: "Domain Information", anchor: "create-tenant-domain-information" },
];

/** The label of every field as the error summary names it. */
export const FIELD_LABELS: Readonly<Record<CreateTenantField, string>> = {
  fullName: "Full name",
  phone: "Phone",
  profileImage: "Profile image",
  loginMode: "Login values",
  username: "Username",
  email: "Email",
  masterPassword: "Master password",
  databaseCredentialMode: "Database values",
  databaseMode: "Database mode",
  databaseName: "Database name",
  databaseUser: "Database user",
  databasePassword: "Database password",
  databasePort: "Port",
  subdomainMode: "Subdomain value",
  subdomain: "SaaS subdomain",
  customDomain: "Custom domain",
};

export type SectionSummary = {
  id: FormSectionId;
  title: string;
  /** The field the section link focuses. */
  firstField: CreateTenantField;
  /** Every invalid field of the section, in page order, with its label. */
  fields: { field: CreateTenantField; label: string }[];
};

/**
 * Description: Summarize the current errors per form section.
 * Input: The current field errors.
 * Output: One entry per section with problems: its title, its first invalid
 *   field and every invalid field with its label (no bare counts).
 * Use case: The error summary above the form: each field name is a link that
 *   focuses that field (CLAUDE.md: no count without its details).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function summarizeErrors(errors: CreateTenantFieldErrors): SectionSummary[] {
  return FORM_SECTIONS.flatMap((section) => {
    // The section's invalid fields, in the order the page shows them.
    const invalid = CREATE_TENANT_FIELDS.filter(
      (field) => FIELD_SECTIONS[field] === section.id && errors[field],
    );
    const [firstField] = invalid;
    if (!firstField) return [];
    return [
      {
        id: section.id,
        title: section.title,
        firstField,
        fields: invalid.map((field) => ({ field, label: FIELD_LABELS[field] })),
      },
    ];
  });
}

/**
 * Description: Tell whether the owner has entered anything that leaving the page would lose.
 * Input: The current values, the initial values and whether an image is chosen.
 * Output: True when a typed value, a section switch, the database mode or the
 *   image differs from the empty form.
 * Use case: Cancel asks for confirmation only when there is something to lose
 *   (CLAUDE.md: confirm risky actions).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function hasUnsavedInput(
  values: FormValues,
  initial: FormValues,
  hasImage: boolean,
): boolean {
  /**
   * Description: Reduce the form values to what the owner entered.
   *   Note: The preview is generated, not typed: it is not compared.
   * Input: The form values.
   * Output: The switches, shared values and manual drafts as JSON (the preview is left out).
   * Use case: hasUnsavedInput.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  const typed = (form: FormValues) => JSON.stringify({ modes: form.modes, shared: form.shared, manual: form.manual });
  return hasImage || typed(values) !== typed(initial);
}

// ---------------------------------------------------------------------------
// "Generate" buttons (browser CSPRNG, never Math.random)

// The server's alphabet (src/lib/tenants/generate.ts): no look-alikes, nothing
// that needs quoting in a shell or a .env file.
const PASSWORD_CLASSES = [
  "abcdefghjkmnpqrstuvwxyz",
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "23456789",
  "!#%*+-=?@^_~",
];
const PASSWORD_ALPHABET       = PASSWORD_CLASSES.join("");
const MASTER_PASSWORD_LENGTH  = 20;
const DATABASE_PASSWORD_BYTES = 32;

/**
 * Description: Pick a uniform random integer in [0, max) with the browser CSPRNG.
 * Input: The exclusive upper bound.
 * Output: The integer; rejection sampling, so there is no modulo bias.
 * Use case: generateMasterPassword.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function randomIndex(max: number): number {
  const limit  = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] as number;
    if (value < limit) return value % max;
  }
}

/**
 * Description: Pick one random character of an alphabet.
 * Input: The alphabet.
 * Output: One character, uniformly chosen.
 * Use case: generateMasterPassword.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function randomCharacter(alphabet: string): string {
  return alphabet[randomIndex(alphabet.length)] as string;
}

/**
 * Description: Generate a master password in the browser.
 * Input: The username it must not contain.
 * Output: 20 characters with at least one of each class, shuffled, never containing
 *   the user name (checked with the same rule as the server).
 * Use case: The Generate button of the Manual login section.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function generateMasterPassword(username: string): string {
  for (;;) {
    const characters = [
      ...PASSWORD_CLASSES.map(randomCharacter),
      ...Array.from({ length: MASTER_PASSWORD_LENGTH - PASSWORD_CLASSES.length }, () =>
        randomCharacter(PASSWORD_ALPHABET),
      ),
    ];
    // Fisher-Yates, so the guaranteed classes are not always in front.
    for (let i = characters.length - 1; i > 0; i -= 1) {
      const j = randomIndex(i + 1);
      [characters[i], characters[j]] = [characters[j] as string, characters[i] as string];
    }
    const password = characters.join("");
    if (checkMasterPassword(password, username).valid) return password;
  }
}

/**
 * Description: Generate a database password in the browser.
 * Input: None.
 * Output: 32 random bytes as base64url: 43 printable ASCII characters, as on the server.
 * Use case: The Generate button of the Manual database section (new database).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function generateDatabasePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(DATABASE_PASSWORD_BYTES));
  let binary  = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
