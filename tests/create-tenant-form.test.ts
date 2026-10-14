/**
 * The create-tenant form's pure logic (src/app/platform/(console)/tenants/new/form-model.ts):
 * the two credential modes, the FormData sent to createTenantAction, the
 * client-side validation and its summary, and the browser-side generators.
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
  effectiveDatabaseMode,
  errorsAfterModeSwitch,
  type FormValues,
  generateDatabasePassword,
  generateMasterPassword,
  initialFormValues,
  summarizeErrors,
  switchCredentialMode,
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
      phone: "+44 20 7946 0958",
      email: "admin@acme.example.com",
      customDomain: "",
    },
  };
}

/** A complete, valid manual form. */
function manualForm(): FormValues {
  const values = filled(initialFormValues(PORT));
  return {
    ...values,
    mode: "manual",
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
  it("starts in Auto generate with nothing generated and the default port for Manual entry", () => {
    const values = initialFormValues(PORT);
    expect(values.mode).toBe("auto");
    expect(values.generated).toBeNull();
    expect(values.manual.databaseMode).toBe("provisioned");
    expect(values.manual.databasePort).toBe("5432");
    expect(values.manual.masterPassword).toBe("");
    expect(values.manual.databasePassword).toBe("");
  });
});

describe("switchCredentialMode", () => {
  it("fills only the EMPTY manual identifiers from the preview on the first switch", () => {
    const start = withPreview();
    const typed: FormValues = {
      ...start,
      manual: { ...start.manual, username: "my-own-name", databaseName: "  " },
    };
    const { values, prefilled } = switchCredentialMode(typed, "manual");

    expect(values.mode).toBe("manual");
    expect(values.manual.username).toBe("my-own-name");
    expect(values.manual.subdomain).toBe(PREVIEW.subdomain);
    expect(values.manual.databaseName).toBe(PREVIEW.databaseName);
    expect(values.manual.databaseUser).toBe(PREVIEW.databaseUser);
    expect(prefilled).toEqual(["subdomain", "databaseName", "databaseUser"]);
  });

  it("never copies or invents passwords, and keeps the manual port", () => {
    const { values } = switchCredentialMode(withPreview(), "manual");
    expect(values.manual.masterPassword).toBe("");
    expect(values.manual.databasePassword).toBe("");
    expect(values.manual.databasePort).toBe("5432");
  });

  it("prefills only once: a field emptied later stays empty on the next switch", () => {
    const first = switchCredentialMode(withPreview(), "manual").values;
    const emptied: FormValues = { ...first, manual: { ...first.manual, username: "" } };
    const backToAuto = switchCredentialMode(emptied, "auto").values;
    const regenerated: FormValues = { ...backToAuto, generated: { ...PREVIEW, username: "other" } };
    const second = switchCredentialMode(regenerated, "manual");

    expect(second.prefilled).toEqual([]);
    expect(second.values.manual.username).toBe("");
  });

  it("without a preview fills nothing, and a later switch with a preview still can", () => {
    const early = switchCredentialMode(initialFormValues(PORT), "manual");
    expect(early.prefilled).toEqual([]);
    expect(early.values.prefilledFromPreview).toBe(false);

    const later = switchCredentialMode(withPreview(switchCredentialMode(early.values, "auto").values), "manual");
    expect(later.prefilled).toEqual(["username", "subdomain", "databaseName", "databaseUser"]);
  });

  it("restores every typed manual value after a round trip through Auto generate", () => {
    const typed = withPreview(manualForm());
    const roundTrip = switchCredentialMode(switchCredentialMode(typed, "auto").values, "manual").values;
    expect(roundTrip.manual).toEqual(typed.manual);
    expect(roundTrip.shared).toEqual(typed.shared);
  });

  it("keeps the shared fields in both modes", () => {
    const typed = manualForm();
    const auto = switchCredentialMode(typed, "auto").values;
    expect(auto.shared).toEqual(typed.shared);
  });

  it("does nothing when the mode does not change", () => {
    const values = withPreview();
    expect(switchCredentialMode(values, "auto")).toEqual({ values, prefilled: [] });
  });
});

describe("effectiveDatabaseMode", () => {
  it("allows an existing database only in Manual entry", () => {
    const manual = manualForm();
    const existing: FormValues = { ...manual, manual: { ...manual.manual, databaseMode: "existing" } };
    expect(effectiveDatabaseMode(existing)).toBe("existing");
    expect(effectiveDatabaseMode({ ...existing, mode: "auto" })).toBe("provisioned");
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

  it("submits the typed values in Manual entry", () => {
    const data = entries(buildCreateFormData(manualForm(), null));
    expect(data).toEqual({
      credentialMode: "manual",
      databaseMode: "provisioned",
      fullName: "Acme Music",
      phone: "+44 20 7946 0958",
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

  it("in Auto generate submits the previewed identifiers and never a typed password or port", () => {
    const typed = withPreview(manualForm());
    const auto = switchCredentialMode(typed, "auto").values;
    const data = buildCreateFormData(auto, null);

    expect(data.get("credentialMode")).toBe("auto");
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

  it("sends an existing database only from Manual entry", () => {
    const manual = manualForm();
    const existing: FormValues = { ...manual, manual: { ...manual.manual, databaseMode: "existing" } };
    expect(buildCreateFormData(existing, null).get("databaseMode")).toBe("existing");
    expect(buildCreateFormData({ ...withPreview(existing), mode: "auto" }, null).get("databaseMode")).toBe(
      "provisioned",
    );
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
    const errors = validateForm({ ...initialFormValues(PORT), mode: "manual" }, CTX);
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

  it("in Auto generate only asks for the preview, never for passwords", () => {
    const named = filled(initialFormValues(PORT));
    expect(Object.keys(validateForm(named, CTX))).toEqual(["username"]);
    expect(validateForm(withPreview(named), CTX)).toEqual({});
    // Without a valid name the full name's own error says what to do.
    expect(validateForm(initialFormValues(PORT), CTX).username).toBeUndefined();
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
      { id: "profile", title: "Tenant profile", firstField: "fullName", count: 1 },
      { id: "login", title: "Tenant admin login", firstField: "email", count: 1 },
      { id: "database", title: "Database", firstField: "databaseName", count: 2 },
      { id: "domain", title: "Domain", firstField: "customDomain", count: 1 },
    ]);
    expect(summarizeErrors({})).toEqual([]);
  });

  it("places every form field in a section", () => {
    const all = Object.fromEntries(CREATE_TENANT_FIELDS.map((field) => [field, "x"]));
    const total = summarizeErrors(all).reduce((sum, section) => sum + section.count, 0);
    expect(total).toBe(CREATE_TENANT_FIELDS.length);
  });
});

describe("errors and passwords after a result", () => {
  it("drops the mode-dependent errors on a mode switch and keeps the shared ones", () => {
    expect(
      errorsAfterModeSwitch({ fullName: "a", email: "b", username: "c", masterPassword: "d", databasePort: "e" }),
    ).toEqual({ fullName: "a", email: "b" });
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

  it("accepts an image recognised from its first bytes, whatever its name", async () => {
    expect(await checkProfileImageFile(new Blob([new Uint8Array(PNG_HEAD)]))).toBeNull();
    expect(await checkProfileImageFile(new File([new Uint8Array(PNG_HEAD)], "logo.txt"))).toBeNull();
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
