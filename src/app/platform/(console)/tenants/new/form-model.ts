/**
 * The create-tenant form's logic without React (docs/tenant-management.md §9.3):
 * the two credential modes and the switch between them, the client-side
 * validation and its per-section summary, and the FormData sent to
 * `createTenantAction`. Pure (no `server-only`, no DOM beyond `FormData`,
 * `File` and `crypto.getRandomValues`), so it is unit-tested directly.
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

/** The same in both modes. */
export type SharedValues = {
  fullName: string;
  phone: string;
  email: string;
  customDomain: string;
};

/** Everything the owner types in Manual entry; never overwritten by a preview once typed. */
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
  mode: CredentialMode;
  shared: SharedValues;
  /** The latest server preview (Auto generate); null until one arrived. */
  generated: PreviewValues | null;
  manual: ManualValues;
  /** Whether the first switch to Manual entry has filled empty fields from a preview. */
  prefilledFromPreview: boolean;
};

export type SharedField = keyof SharedValues;
export type ManualField = Exclude<keyof ManualValues, "databaseMode">;

/** The identifiers a preview generates, in the order the form shows them. */
export const GENERATED_FIELDS = ["username", "subdomain", "databaseName", "databaseUser"] as const;
export type GeneratedField = (typeof GENERATED_FIELDS)[number];

/** Fields whose meaning depends on the credential mode; their errors go when it changes. */
const MODE_DEPENDENT_FIELDS: readonly CreateTenantField[] = [
  ...GENERATED_FIELDS,
  "masterPassword",
  "databaseMode",
  "databasePassword",
  "databasePort",
];

/** Fields a "Test connection" result depends on: changing one clears the result. */
export const CONNECTION_FIELDS = [
  "databaseName",
  "databaseUser",
  "databasePassword",
  "databasePort",
] as const satisfies readonly (keyof TestConnectionInput)[];

export function initialFormValues(defaultPort: number): FormValues {
  return {
    mode: "auto",
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
    prefilledFromPreview: false,
  };
}

// ---------------------------------------------------------------------------
// Modes

export type ModeSwitch = {
  values: FormValues;
  /** The manual fields that were empty and now hold the generated value. */
  prefilled: GeneratedField[];
};

/**
 * Only changes which set of values is shown and submitted. On the first
 * switch to Manual entry with a preview at hand, manual identifiers that are
 * still empty take the generated value; nothing typed is ever replaced, and
 * passwords are never copied (they are not in a preview at all).
 */
export function switchCredentialMode(values: FormValues, next: CredentialMode): ModeSwitch {
  if (values.mode === next) return { values, prefilled: [] };
  if (next === "auto" || values.prefilledFromPreview || values.generated === null) {
    return { values: { ...values, mode: next }, prefilled: [] };
  }
  const manual = { ...values.manual };
  const prefilled: GeneratedField[] = [];
  for (const field of GENERATED_FIELDS) {
    if (manual[field].trim() === "") {
      manual[field] = values.generated[field];
      prefilled.push(field);
    }
  }
  return { values: { ...values, mode: next, manual, prefilledFromPreview: true }, prefilled };
}

/** An existing database can only be attached in Manual entry (§8.1 step 3). */
export function effectiveDatabaseMode(values: FormValues): DatabaseMode {
  return values.mode === "manual" ? values.manual.databaseMode : "provisioned";
}

/** The identifiers that would be submitted in the current mode. */
export function currentIdentifiers(values: FormValues): Record<GeneratedField, string> {
  const source = values.mode === "manual" ? values.manual : values.generated;
  return {
    username: source?.username ?? "",
    subdomain: source?.subdomain ?? "",
    databaseName: source?.databaseName ?? "",
    databaseUser: source?.databaseUser ?? "",
  };
}

/** Field errors that still apply after the credential mode changed. */
export function errorsAfterModeSwitch(errors: CreateTenantFieldErrors): CreateTenantFieldErrors {
  return withoutFields(errors, MODE_DEPENDENT_FIELDS);
}

export function withoutFields(
  errors: CreateTenantFieldErrors,
  fields: readonly CreateTenantField[],
): CreateTenantFieldErrors {
  const next = { ...errors };
  for (const field of fields) delete next[field];
  return next;
}

/** After a failed create: only a password the server rejected has to be typed again. */
export function clearRejectedPasswords(
  values: FormValues,
  fieldErrors: CreateTenantFieldErrors,
): FormValues {
  const manual = { ...values.manual };
  if (fieldErrors.masterPassword) manual.masterPassword = "";
  if (fieldErrors.databasePassword) manual.databasePassword = "";
  return { ...values, manual };
}

/** After a successful create no typed password stays in memory. */
export function clearPasswords(values: FormValues): FormValues {
  return { ...values, manual: { ...values.manual, masterPassword: "", databasePassword: "" } };
}

// ---------------------------------------------------------------------------
// FormData for createTenantAction

/**
 * The form's field names as `createTenantAction` reads them (action-types.ts).
 * A Record over the union, so a field added on the server fails the type check here.
 */
const FIELD_SECTIONS: Record<CreateTenantField, FormSectionId> = {
  credentialMode: "credentials",
  fullName: "profile",
  phone: "profile",
  profileImage: "profile",
  username: "login",
  email: "login",
  masterPassword: "login",
  databaseMode: "database",
  databaseName: "database",
  databaseUser: "database",
  databasePassword: "database",
  databasePort: "database",
  subdomain: "domain",
  customDomain: "domain",
};

export const CREATE_TENANT_FIELDS = Object.keys(FIELD_SECTIONS) as CreateTenantField[];

/**
 * In Auto generate the passwords and the port are generated on the server,
 * so they are not sent at all: a value typed in Manual entry never leaves the
 * browser unless Manual entry is what is submitted.
 */
export function buildCreateFormData(values: FormValues, profileImage: File | null): FormData {
  const data = new FormData();
  const set = (field: CreateTenantField, value: string | File) => data.append(field, value);

  set("credentialMode", values.mode);
  set("databaseMode", effectiveDatabaseMode(values));
  set("fullName", values.shared.fullName);
  set("phone", values.shared.phone);
  set("email", values.shared.email);
  set("customDomain", values.shared.customDomain);

  const identifiers = currentIdentifiers(values);
  for (const field of GENERATED_FIELDS) set(field, identifiers[field]);

  if (values.mode === "manual") {
    set("masterPassword", values.manual.masterPassword);
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

const NOT_GENERATED_YET =
  "The generated values aren't ready. Select Regenerate, or switch to Manual entry.";

function errorOf(result: { ok: true } | { ok: false; error: string }): string | undefined {
  return result.ok ? undefined : result.error;
}

/** The client-side error of one field in the current mode, or undefined. */
export function validateField(
  field: CreateTenantField,
  values: FormValues,
  ctx: ValidationContext,
): string | undefined {
  const { shared, manual } = values;
  const manualMode = values.mode === "manual";

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
    case "credentialMode":
      return undefined;
    case "databaseMode":
      return undefined;
    case "username":
      if (!manualMode) {
        // One message for the whole generated set, shown at its first field.
        if (values.generated !== null || !validateFullName(shared.fullName).ok) return undefined;
        return NOT_GENERATED_YET;
      }
      return errorOf(validateTenantUsername(manual.username));
    case "subdomain":
      return manualMode ? errorOf(validateSubdomainLabel(manual.subdomain)) : undefined;
    case "databaseName":
      return manualMode
        ? errorOf(validateDatabaseIdentifier(manual.databaseName, "database", NO_RESERVED_NAMES))
        : undefined;
    case "databaseUser":
      return manualMode
        ? errorOf(validateDatabaseIdentifier(manual.databaseUser, "user", NO_RESERVED_NAMES))
        : undefined;
    case "masterPassword":
      return manualMode
        ? errorOf(validateMasterPassword(manual.masterPassword, manual.username))
        : undefined;
    case "databasePassword":
      if (!manualMode) return undefined;
      return errorOf(
        manual.databaseMode === "existing"
          ? validateExistingDatabasePassword(manual.databasePassword)
          : validateNewDatabasePassword(manual.databasePassword),
      );
    case "databasePort":
      return manualMode ? errorOf(parsePort(manual.databasePort, ctx.defaultPort)) : undefined;
  }
}

/** Every client-side error at once, as the server returns them. */
export function validateForm(values: FormValues, ctx: ValidationContext): CreateTenantFieldErrors {
  const errors: CreateTenantFieldErrors = {};
  for (const field of CREATE_TENANT_FIELDS) {
    const error = validateField(field, values, ctx);
    if (error) errors[field] = error;
  }
  return errors;
}

/** The "Test connection" input after the same checks the server runs first. */
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

// Enough for every signature sniffImage knows (WebP needs 12 bytes).
const IMAGE_HEAD_BYTES = 16;

/**
 * The server's checks on a chosen file, before it is uploaded: the size, and
 * the type from the file's first bytes (never its name or claimed type).
 * Null when the file is acceptable.
 */
export async function checkProfileImageFile(file: Blob): Promise<string | null> {
  if (file.size === 0) return "The file is empty. Choose an image file.";
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    return "The image is larger than 2 MB. Choose a smaller image.";
  }
  const head = new Uint8Array(await file.slice(0, IMAGE_HEAD_BYTES).arrayBuffer());
  const result = validateProfileImage(head);
  return result.ok ? null : result.error;
}

// ---------------------------------------------------------------------------
// Error summary

export type FormSectionId = "credentials" | "profile" | "login" | "database" | "domain";

/** In the order the form shows them; fields in their visual order within each. */
export const FORM_SECTIONS: readonly { id: FormSectionId; title: string }[] = [
  { id: "credentials", title: "Credentials" },
  { id: "profile", title: "Tenant profile" },
  { id: "login", title: "Tenant admin login" },
  { id: "database", title: "Database" },
  { id: "domain", title: "Domain" },
];

export type SectionSummary = {
  id: FormSectionId;
  title: string;
  /** The field the summary link focuses. */
  firstField: CreateTenantField;
  count: number;
};

/** One entry per section with problems, pointing at its first invalid field. */
export function summarizeErrors(errors: CreateTenantFieldErrors): SectionSummary[] {
  return FORM_SECTIONS.flatMap((section) => {
    const fields = CREATE_TENANT_FIELDS.filter(
      (field) => FIELD_SECTIONS[field] === section.id && errors[field],
    );
    const [firstField] = fields;
    return firstField ? [{ ...section, firstField, count: fields.length }] : [];
  });
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
const PASSWORD_ALPHABET = PASSWORD_CLASSES.join("");
const MASTER_PASSWORD_LENGTH = 20;
const DATABASE_PASSWORD_BYTES = 32;

/** A uniform integer in [0, max): rejection sampling, so there is no modulo bias. */
function randomIndex(max: number): number {
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buffer = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    const value = buffer[0] as number;
    if (value < limit) return value % max;
  }
}

function randomCharacter(alphabet: string): string {
  return alphabet[randomIndex(alphabet.length)] as string;
}

/** 20 characters, one of each class at least, never containing the user name. */
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

/** 32 random bytes as base64url: 43 printable ASCII characters, as on the server. */
export function generateDatabasePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(DATABASE_PASSWORD_BYTES));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
