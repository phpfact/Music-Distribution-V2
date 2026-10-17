/**
 * The create-tenant form's pure logic (src/app/platform/(console)/tenants/new/form-model.ts):
 * the per-section Auto-Generate / Manual switches, the FormData sent to
 * createTenantAction, the client-side validation and its summary, and the
 * browser-side generators.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreviewValues } from "@/app/platform/(console)/tenants/action-types";
import {
  buildCreateFormData,
  checkProfileImageFile,
  clearPasswords,
  clearRejectedPasswords,
  CREATE_TENANT_FIELDS,
  currentIdentifiers,
  effectiveDatabaseMode,
  errorsAfterModeSwitch,
  type FormValues,
  generateDatabasePassword,
  generatedSummary,
  generateMasterPassword,
  hasUnsavedInput,
  initialFormValues,
  NOT_GENERATED_YET,
  sectionOfField,
  summarizeErrors,
  switchSectionMode,
  validateConnection,
  validateField,
  validateForm,
} from "@/app/platform/(console)/tenants/new/form-model";
import {
  validateMasterPassword,
  validateNewDatabasePassword,
} from "@/lib/tenants/rules";
import { PROJECT_ROOT } from "./support/process";

const PORT = 5432;
const CTX = { baseDomain: "localhost", defaultPort: PORT, imageError: null };

const PREVIEW: PreviewValues = {
  username: "acme-music",
  subdomain: "acme-music",
  databaseName: "t_acme_music_a1b2c3",
  databaseUser: "t_acme_music_a1b2c3_app",
  port: PORT,
  baseDomain: "localhost",
};

const MASTER = "Correct-Horse-42";
const DB_PASSWORD = "0123456789abcdefXYZ";

function withPreview(values: FormValues = initialFormValues(PORT)): FormValues {
  return { ...values, generated: PREVIEW };
}

function filled(values: FormValues): FormValues {
  return {
    ...values,
    shared: {
      fullName: "Acme Music",
      phone: "9876543210",
      email: "admin@acme.example.com",
      customDomain: "",
    },
  };
}

/** A complete, valid form with every section on Manual. */
function manualForm(): FormValues {
  const values = filled(initialFormValues(PORT));
  return {
    ...values,
    modes: { login: "manual", database: "manual", domain: "manual" },
    manual: {
      username: "acme",
      subdomain: "acme",
      masterPassword: MASTER,
      databaseMode: "provisioned",
      databaseName: "acme_db",
      databaseUser: "acme_app",
      databasePassword: DB_PASSWORD,
      databasePort: "5432",
    },
  };
}

function entries(data: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(data.entries());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("initialFormValues", () => {
  it("starts every section on Auto-Generate with nothing generated and the default port for Manual", () => {
    const values = initialFormValues(PORT);
    expect(values.modes).toEqual({ login: "auto", database: "auto", domain: "auto" });
    expect(values.prefilledFromPreview).toEqual({ login: false, database: false, domain: false });
    expect(values.generated).toBeNull();
    expect(values.manual.databaseMode).toBe("provisioned");
    expect(values.manual.databasePort).toBe("5432");
    expect(values.manual.masterPassword).toBe("");
    expect(values.manual.databasePassword).toBe("");
  });
});

describe("switchSectionMode", () => {
  it("moves only the switched section and fills only ITS empty identifiers on the first switch", () => {
    const start = withPreview();
    const typed: FormValues = {
      ...start,
      manual: { ...start.manual, databaseName: "my_own_db", databaseUser: "  " },
    };
    const { values, prefilled } = switchSectionMode(typed, "database", "manual");

    expect(values.modes).toEqual({ login: "auto", database: "manual", domain: "auto" });
    expect(values.manual.databaseName).toBe("my_own_db");
    expect(values.manual.databaseUser).toBe(PREVIEW.databaseUser);
    // Other sections' drafts are untouched.
    expect(values.manual.username).toBe("");
    expect(values.manual.subdomain).toBe("");
    expect(prefilled).toEqual(["databaseUser"]);
    expect(values.prefilledFromPreview).toEqual({ login: false, database: true, domain: false });
  });

  it("prefills the login and domain sections from the preview on their own switches", () => {
    const login = switchSectionMode(withPreview(), "login", "manual");
    expect(login.prefilled).toEqual(["username"]);
    expect(login.values.manual.username).toBe(PREVIEW.username);
    const domain = switchSectionMode(login.values, "domain", "manual");
    expect(domain.prefilled).toEqual(["subdomain"]);
    expect(domain.values.manual.subdomain).toBe(PREVIEW.subdomain);
  });

  it("never copies or invents passwords, and keeps the manual port", () => {
    let values = withPreview();
    values = switchSectionMode(values, "login", "manual").values;
    values = switchSectionMode(values, "database", "manual").values;
    expect(values.manual.masterPassword).toBe("");
    expect(values.manual.databasePassword).toBe("");
    expect(values.manual.databasePort).toBe("5432");
  });

  it("prefills a section only once: a field emptied later stays empty on the next switch", () => {
    const first = switchSectionMode(withPreview(), "login", "manual").values;
    const emptied: FormValues = { ...first, manual: { ...first.manual, username: "" } };
    const backToAuto = switchSectionMode(emptied, "login", "auto").values;
    const regenerated: FormValues = { ...backToAuto, generated: { ...PREVIEW, username: "other" } };
    const second = switchSectionMode(regenerated, "login", "manual");

    expect(second.prefilled).toEqual([]);
    expect(second.values.manual.username).toBe("");
  });

  it("without a preview fills nothing, and a later switch with a preview still can", () => {
    const early = switchSectionMode(initialFormValues(PORT), "domain", "manual");
    expect(early.prefilled).toEqual([]);
    expect(early.values.prefilledFromPreview.domain).toBe(false);

    const back = switchSectionMode(early.values, "domain", "auto").values;
    const later = switchSectionMode(withPreview(back), "domain", "manual");
    expect(later.prefilled).toEqual(["subdomain"]);
  });

  it("restores every typed manual value after a round trip through Auto-Generate", () => {
    const typed = withPreview(manualForm());
    let values = typed;
    for (const section of ["login", "database", "domain"] as const) {
      values = switchSectionMode(switchSectionMode(values, section, "auto").values, section, "manual").values;
    }
    expect(values.manual).toEqual(typed.manual);
    expect(values.shared).toEqual(typed.shared);
  });

  it("keeps the shared fields whatever the switches say", () => {
    const typed = manualForm();
    const auto = switchSectionMode(typed, "login", "auto").values;
    expect(auto.shared).toEqual(typed.shared);
  });

  it("does nothing when the section is already in that mode", () => {
    const values = withPreview();
    expect(switchSectionMode(values, "database", "auto")).toEqual({ values, prefilled: [] });
  });
});

describe("effectiveDatabaseMode", () => {
  it("allows an existing database only with the Database section on Manual", () => {
    const manual = manualForm();
    const existing: FormValues = { ...manual, manual: { ...manual.manual, databaseMode: "existing" } };
    expect(effectiveDatabaseMode(existing)).toBe("existing");
    expect(effectiveDatabaseMode({ ...existing, modes: { ...existing.modes, database: "auto" } })).toBe(
      "provisioned",
    );
    // The other sections' switches do not matter.
    expect(
      effectiveDatabaseMode({ ...existing, modes: { login: "auto", database: "manual", domain: "auto" } }),
    ).toBe("existing");
  });
});

describe("currentIdentifiers", () => {
  it("takes each identifier from its own section's source", () => {
    const values: FormValues = {
      ...withPreview(manualForm()),
      modes: { login: "auto", database: "manual", domain: "auto" },
    };
    expect(currentIdentifiers(values)).toEqual({
      username: PREVIEW.username,
      subdomain: PREVIEW.subdomain,
      databaseName: "acme_db",
      databaseUser: "acme_app",
    });
  });
});

describe("generatedSummary", () => {
  it("lists only the identifiers of sections on Auto-Generate, with the full subdomain host", () => {
    const allAuto = withPreview(filled(initialFormValues(PORT)));
    expect(generatedSummary(allAuto, "example.com")).toEqual({
      username: PREVIEW.username,
      subdomainHost: `${PREVIEW.subdomain}.example.com`,
      databaseName: PREVIEW.databaseName,
      databaseUser: PREVIEW.databaseUser,
    });

    const mixed: FormValues = { ...withPreview(manualForm()), modes: { login: "manual", database: "auto", domain: "manual" } };
    expect(generatedSummary(mixed, "example.com")).toEqual({
      databaseName: PREVIEW.databaseName,
      databaseUser: PREVIEW.databaseUser,
    });
    expect(generatedSummary(manualForm(), "example.com")).toEqual({});
  });
});

describe("buildCreateFormData", () => {
  it("uses exactly the field names createTenantAction reads", async () => {
    const source = await readFile(
      path.join(PROJECT_ROOT, "src/app/platform/(console)/tenants/actions.ts"),
      "utf8",
    );
    const createAction = source.slice(source.indexOf("export async function createTenantAction"));
    const body = createAction.slice(0, createAction.indexOf("export async function", 10));
    const read = new Set([...body.matchAll(/(?:field|formData\.get)\("(\w+)"\)/g)].map((m) => m[1]));

    expect([...read].sort()).toEqual([...CREATE_TENANT_FIELDS].sort());

    const file = new File([new Uint8Array([1])], "a.png");
    for (const values of [manualForm(), withPreview(filled(initialFormValues(PORT)))]) {
      for (const name of buildCreateFormData(values, file).keys()) {
        expect(CREATE_TENANT_FIELDS).toContain(name);
      }
    }
  });

  it("submits the typed values with every section on Manual", () => {
    const data = entries(buildCreateFormData(manualForm(), null));
    expect(data).toEqual({
      loginMode: "manual",
      databaseCredentialMode: "manual",
      subdomainMode: "manual",
      databaseMode: "provisioned",
      fullName: "Acme Music",
      phone: "9876543210",
      email: "admin@acme.example.com",
      customDomain: "",
      username: "acme",
      subdomain: "acme",
      databaseName: "acme_db",
      databaseUser: "acme_app",
      masterPassword: MASTER,
      databasePassword: DB_PASSWORD,
      databasePort: "5432",
    });
  });

  it("with every section on Auto submits the previewed identifiers and never a typed password or port", () => {
    let values = withPreview(manualForm());
    for (const section of ["login", "database", "domain"] as const) {
      values = switchSectionMode(values, section, "auto").values;
    }
    const data = buildCreateFormData(values, null);

    expect(data.get("loginMode")).toBe("auto");
    expect(data.get("databaseCredentialMode")).toBe("auto");
    expect(data.get("subdomainMode")).toBe("auto");
    expect(data.get("databaseMode")).toBe("provisioned");
    expect(data.get("username")).toBe(PREVIEW.username);
    expect(data.get("subdomain")).toBe(PREVIEW.subdomain);
    expect(data.get("databaseName")).toBe(PREVIEW.databaseName);
    expect(data.get("databaseUser")).toBe(PREVIEW.databaseUser);
    expect(data.has("masterPassword")).toBe(false);
    expect(data.has("databasePassword")).toBe(false);
    expect(data.has("databasePort")).toBe(false);
    const all = [...data.values()].map(String).join("\n");
    expect(all).not.toContain(MASTER);
    expect(all).not.toContain(DB_PASSWORD);
  });

  it("mixes sources per section: generated login, typed database, generated subdomain", () => {
    const values: FormValues = {
      ...withPreview(manualForm()),
      modes: { login: "auto", database: "manual", domain: "auto" },
    };
    const data = buildCreateFormData(values, null);

    expect(data.get("loginMode")).toBe("auto");
    expect(data.get("databaseCredentialMode")).toBe("manual");
    expect(data.get("subdomainMode")).toBe("auto");
    expect(data.get("username")).toBe(PREVIEW.username);
    expect(data.get("subdomain")).toBe(PREVIEW.subdomain);
    expect(data.get("databaseName")).toBe("acme_db");
    // The login's typed password stays in the browser; the database's is sent.
    expect(data.has("masterPassword")).toBe(false);
    expect(data.get("databasePassword")).toBe(DB_PASSWORD);
    expect(data.get("databasePort")).toBe("5432");
  });

  it("sends the master password only with the login on Manual", () => {
    const values: FormValues = {
      ...withPreview(manualForm()),
      modes: { login: "manual", database: "auto", domain: "auto" },
    };
    const data = buildCreateFormData(values, null);
    expect(data.get("masterPassword")).toBe(MASTER);
    expect(data.has("databasePassword")).toBe(false);
    expect(data.has("databasePort")).toBe(false);
  });

  it("sends an existing database only with the Database section on Manual", () => {
    const manual = manualForm();
    const existing: FormValues = { ...manual, manual: { ...manual.manual, databaseMode: "existing" } };
    expect(buildCreateFormData(existing, null).get("databaseMode")).toBe("existing");
    expect(
      buildCreateFormData(
        { ...withPreview(existing), modes: { ...existing.modes, database: "auto" } },
        null,
      ).get("databaseMode"),
    ).toBe("provisioned");
  });

  it("adds the profile image as the File itself, and nothing without one", () => {
    const file = new File([new Uint8Array([0x89, 0x50])], "logo.png", { type: "image/png" });
    expect(buildCreateFormData(manualForm(), file).get("profileImage")).toBe(file);
    expect(buildCreateFormData(manualForm(), null).has("profileImage")).toBe(false);
  });
});

describe("validateForm", () => {
  it("accepts a complete manual form", () => {
    expect(validateForm(manualForm(), CTX)).toEqual({});
  });

  it("reports every missing required field at once", () => {
    const errors = validateForm(
      { ...initialFormValues(PORT), modes: { login: "manual", database: "manual", domain: "manual" } },
      CTX,
    );
    expect(Object.keys(errors).sort()).toEqual(
      [
        "databaseName",
        "databasePassword",
        "databaseUser",
        "email",
        "fullName",
        "masterPassword",
        "subdomain",
        "username",
      ].sort(),
    );
  });

  it("with every section on Auto only asks for the preview (once per section), never for passwords", () => {
    const named = filled(initialFormValues(PORT));
    const errors = validateForm(named, CTX);
    expect(Object.keys(errors)).toEqual(["username", "databaseName", "subdomain"]);
    expect(errors.username).toBe(NOT_GENERATED_YET);
    expect(validateForm(withPreview(named), CTX)).toEqual({});
    // Without a valid name the full name's own error says what to do.
    expect(validateForm(initialFormValues(PORT), CTX).username).toBeUndefined();
  });

  it("validates only the Manual sections' typed values in a mixed form", () => {
    const named = withPreview(filled(initialFormValues(PORT)));
    const mixed: FormValues = { ...named, modes: { login: "auto", database: "manual", domain: "auto" } };
    // The database section is on Manual with nothing typed: only its fields are reported.
    expect(Object.keys(validateForm(mixed, CTX)).sort()).toEqual(
      ["databaseName", "databasePassword", "databaseUser"].sort(),
    );
  });

  it("applies the new-database password rule only to a new database", () => {
    const manual = manualForm();
    const short: FormValues = { ...manual, manual: { ...manual.manual, databasePassword: "short" } };
    expect(validateField("databasePassword", short, CTX)).toMatch(/16–128/);
    const existing: FormValues = { ...short, manual: { ...short.manual, databaseMode: "existing" } };
    expect(validateField("databasePassword", existing, CTX)).toBeUndefined();
  });

  it("checks the master password against the policy and the user name", () => {
    const manual = manualForm();
    const containsName: FormValues = {
      ...manual,
      manual: { ...manual.manual, masterPassword: "xx-ACME-password-1" },
    };
    expect(validateField("masterPassword", containsName, CTX)).toMatch(/user name/);
  });

  it("validates the port, the phone and the custom domain", () => {
    const manual = manualForm();
    expect(validateField("databasePort", { ...manual, manual: { ...manual.manual, databasePort: "70000" } }, CTX)).toMatch(
      /1 to 65535/,
    );
    expect(validateField("phone", { ...manual, shared: { ...manual.shared, phone: "12" } }, CTX)).toBeDefined();
    // Indian mobile numbers only: 10 digits starting with 6–9.
    expect(validateField("phone", { ...manual, shared: { ...manual.shared, phone: "+442079460958" } }, CTX)).toBeDefined();
    expect(validateField("phone", { ...manual, shared: { ...manual.shared, phone: "9876543210" } }, CTX)).toBeUndefined();
    const domain = (customDomain: string) =>
      validateField("customDomain", { ...manual, shared: { ...manual.shared, customDomain } }, CTX);
    expect(domain("")).toBeUndefined();
    expect(domain("music.example.com")).toBeUndefined();
    expect(domain("acme.localhost")).toBeDefined();
    // Internationalized names are converted to punycode on the server only.
    expect(domain("müsik.de")).toBeUndefined();
  });

  it("includes the profile image's inline error", () => {
    expect(validateForm(manualForm(), { ...CTX, imageError: "Use a PNG, JPEG or WebP image." })).toEqual({
      profileImage: "Use a PNG, JPEG or WebP image.",
    });
  });
});

describe("validateConnection", () => {
  it("checks the four database fields with the existing-login rules", () => {
    const manual = manualForm();
    const existing: FormValues = {
      ...manual,
      manual: { ...manual.manual, databaseMode: "existing", databasePassword: "pw" },
    };
    expect(validateConnection(existing, CTX)).toEqual({
      ok: true,
      input: { databaseName: "acme_db", databaseUser: "acme_app", databasePassword: "pw", databasePort: "5432" },
    });
    const broken: FormValues = { ...existing, manual: { ...existing.manual, databaseName: "Bad", databasePassword: "" } };
    const result = validateConnection(broken, CTX);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["databaseName", "databasePassword"]);
  });
});

describe("summarizeErrors", () => {
  it("lists the sections with problems in form order, each pointing at its first invalid field", () => {
    expect(
      summarizeErrors({
        customDomain: "x",
        databasePort: "x",
        databaseName: "x",
        email: "x",
        fullName: "x",
      }),
    ).toEqual([
      {
        id: "profile",
        title: "Personal Information",
        firstField: "fullName",
        fields: [{ field: "fullName", label: "Full name" }],
      },
      {
        id: "login",
        title: "Login Information",
        firstField: "email",
        fields: [{ field: "email", label: "Email" }],
      },
      {
        id: "database",
        title: "Database Information",
        firstField: "databaseName",
        // Every invalid field is named (no bare counts), in page order.
        fields: [
          { field: "databaseName", label: "Database name" },
          { field: "databasePort", label: "Port" },
        ],
      },
      {
        id: "domain",
        title: "Domain Information",
        firstField: "customDomain",
        fields: [{ field: "customDomain", label: "Custom domain" }],
      },
    ]);
    expect(summarizeErrors({})).toEqual([]);
  });

  it("puts each section's switch in that section", () => {
    expect(sectionOfField("loginMode")).toBe("login");
    expect(sectionOfField("databaseCredentialMode")).toBe("database");
    expect(sectionOfField("subdomainMode")).toBe("domain");
  });

  it("places every form field in a section", () => {
    const all = Object.fromEntries(CREATE_TENANT_FIELDS.map((field) => [field, "x"]));
    const total = summarizeErrors(all).reduce((sum, section) => sum + section.fields.length, 0);
    expect(total).toBe(CREATE_TENANT_FIELDS.length);
  });
});

describe("errors and passwords after a result", () => {
  it("drops only the switched section's mode-dependent errors", () => {
    const errors = { fullName: "a", email: "b", username: "c", masterPassword: "d", databasePort: "e", subdomain: "f" };
    expect(errorsAfterModeSwitch(errors, "login")).toEqual({ fullName: "a", email: "b", databasePort: "e", subdomain: "f" });
    expect(errorsAfterModeSwitch(errors, "database")).toEqual({
      fullName: "a",
      email: "b",
      username: "c",
      masterPassword: "d",
      subdomain: "f",
    });
    expect(errorsAfterModeSwitch({ ...errors, customDomain: "g" }, "domain")).toEqual({
      fullName: "a",
      email: "b",
      username: "c",
      masterPassword: "d",
      databasePort: "e",
      customDomain: "g",
    });
  });

  it("clears only a password the server rejected", () => {
    const values = manualForm();
    const afterMaster = clearRejectedPasswords(values, { masterPassword: "rejected", email: "taken" });
    expect(afterMaster.manual.masterPassword).toBe("");
    expect(afterMaster.manual.databasePassword).toBe(DB_PASSWORD);
    expect(afterMaster.shared).toEqual(values.shared);

    const afterDb = clearRejectedPasswords(values, { databasePassword: "rejected" });
    expect(afterDb.manual.masterPassword).toBe(MASTER);
    expect(afterDb.manual.databasePassword).toBe("");

    expect(clearRejectedPasswords(values, { username: "taken" })).toEqual(values);
  });

  it("clears both passwords after a successful create", () => {
    const cleared = clearPasswords(manualForm());
    expect(cleared.manual.masterPassword).toBe("");
    expect(cleared.manual.databasePassword).toBe("");
    expect(cleared.manual.username).toBe("acme");
  });
});

describe("password generators", () => {
  it("use the CSPRNG, never Math.random", () => {
    const random = vi.spyOn(Math, "random");
    const csprng = vi.spyOn(crypto, "getRandomValues");
    generateMasterPassword("acme");
    generateDatabasePassword();
    expect(random).not.toHaveBeenCalled();
    expect(csprng).toHaveBeenCalled();
  });

  it("generate master passwords that pass the policy and differ", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const password = generateMasterPassword("acme");
      expect(password).toHaveLength(20);
      expect(validateMasterPassword(password, "acme").ok).toBe(true);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
  });

  it("generate database passwords of 43 base64url characters that pass the new-database rule", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const password = generateDatabasePassword();
      expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(validateNewDatabasePassword(password).ok).toBe(true);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
  });
});

describe("checkProfileImageFile", () => {
  const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d];

  it("accepts a complete supported image whatever its name, and rejects headers alone", async () => {
    const { VALID_PNG } = await import("./support/image-fixtures");
    expect(await checkProfileImageFile(new Blob([Uint8Array.from(VALID_PNG)]))).toBeNull();
    expect(await checkProfileImageFile(new File([Uint8Array.from(VALID_PNG)], "logo.txt"))).toBeNull();
    expect(await checkProfileImageFile(new Blob([new Uint8Array(PNG_HEAD)]))).toContain("incomplete");
  });

  it("rejects other content, an empty file and a file over 2 MB", async () => {
    expect(await checkProfileImageFile(new File(["<svg/>"], "logo.png", { type: "image/png" }))).toBe(
      "Use a PNG, JPEG or WebP image.",
    );
    expect(await checkProfileImageFile(new Blob([]))).toBe("The file is empty. Choose an image file.");
    const big = new Uint8Array(2_097_153);
    big.set(PNG_HEAD);
    expect(await checkProfileImageFile(new Blob([big]))).toBe(
      "The image is larger than 2 MB. Choose a smaller image.",
    );
  });
});

describe("hasUnsavedInput", () => {
  it("is false for the untouched form, also after a preview arrived", () => {
    const initial = initialFormValues(PORT);
    expect(hasUnsavedInput(initial, initial, false)).toBe(false);
    expect(hasUnsavedInput(withPreview(initial), initial, false)).toBe(false);
  });

  it("is true for typed values, a moved switch or a chosen image", () => {
    const initial = initialFormValues(PORT);
    expect(hasUnsavedInput(filled(initial), initial, false)).toBe(true);
    expect(hasUnsavedInput({ ...initial, modes: { ...initial.modes, domain: "manual" } }, initial, false)).toBe(true);
    expect(hasUnsavedInput(initial, initial, true)).toBe(true);
  });
});
