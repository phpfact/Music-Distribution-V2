/**
 * The edit-tenant form's pure logic (src/app/platform/(console)/tenants/[id]/edit/edit-model.ts):
 * initial values, client-side validation and its summary, the FormData sent
 * to updateTenantAction, and the URL a successful save goes to.
 */
import { describe, expect, it } from "vitest";
import {
  buildUpdateFormData,
  EDIT_FIELDS,
  type EditValues,
  hasUnsavedEdits,
  initialEditValues,
  savedTenantHref,
  summarizeEditErrors,
  validateEditField,
  validateEditForm,
} from "@/app/platform/(console)/tenants/[id]/edit/edit-model";
import type { TenantForEdit } from "@/lib/tenants/service";

const TENANT: TenantForEdit = {
  id: "0b8e9a52-4f0c-4a8e-9d55-1f8f0b4b6c11",
  status: "active",
  fullName: "Acme Records",
  phone: null,
  email: "admin@acme.io",
  username: "acme",
  subdomain: "acme",
  customDomain: null,
  hasProfileImage: true,
  adminAccountExists: true,
  baseDomain: "musicdist.local",
};

const CTX = { baseDomain: "musicdist.local" };

function values(overrides: Partial<EditValues> = {}): EditValues {
  return { ...initialEditValues(TENANT), ...overrides };
}

describe("initialEditValues", () => {
  it("prefills the persisted values, missing ones as empty text", () => {
    expect(initialEditValues(TENANT)).toEqual({
      fullName: "Acme Records",
      phone: "",
      username: "acme",
      email: "admin@acme.io",
      subdomain: "acme",
      customDomain: "",
    });
  });

  it("keeps a phone and a custom domain", () => {
    const edited = initialEditValues({ ...TENANT, phone: "+442079460958", customDomain: "music.acme.io" });
    expect(edited.phone).toBe("+442079460958");
    expect(edited.customDomain).toBe("music.acme.io");
  });
});

describe("validateEditForm", () => {
  it("accepts the persisted values", () => {
    expect(validateEditForm(values(), CTX)).toEqual({});
  });

  it("reports every invalid field at once", () => {
    const errors = validateEditForm(
      values({ fullName: " ", phone: "12", username: "A!", email: "nope", subdomain: "www", customDomain: "localhost" }),
      CTX,
    );
    expect(Object.keys(errors).sort()).toEqual(
      ["customDomain", "email", "fullName", "phone", "subdomain", "username"].sort(),
    );
  });

  it("allows an empty custom domain (removes it) and leaves non-ASCII names to the server", () => {
    expect(validateEditField("customDomain", values({ customDomain: "" }), CTX)).toBeUndefined();
    expect(validateEditField("customDomain", values({ customDomain: "müsik.de" }), CTX)).toBeUndefined();
  });

  it("refuses a custom domain under the base domain", () => {
    expect(validateEditField("customDomain", values({ customDomain: "x.musicdist.local" }), CTX)).toEqual(
      expect.any(String),
    );
  });

  it("reports the chosen image's error", () => {
    expect(validateEditForm(values(), { ...CTX, imageError: "Too big" })).toEqual({ profileImage: "Too big" });
  });
});

describe("summarizeEditErrors", () => {
  it("lists the sections with problems in form order, pointing at the first field", () => {
    expect(summarizeEditErrors({ customDomain: "x", email: "y", username: "z", phone: "w" })).toEqual([
      {
        id: "profile",
        title: "Personal Information",
        firstField: "phone",
        fields: [{ field: "phone", label: "Phone" }],
      },
      {
        id: "login",
        title: "Login Information",
        firstField: "username",
        // Every invalid field is named (no bare counts), in page order.
        fields: [
          { field: "username", label: "Username" },
          { field: "email", label: "Email" },
        ],
      },
      {
        id: "domain",
        title: "Domain Information",
        firstField: "customDomain",
        fields: [{ field: "customDomain", label: "Custom domain" }],
      },
    ]);
  });

  it("is empty without errors", () => {
    expect(summarizeEditErrors({})).toEqual([]);
  });

  it("covers every field", () => {
    expect(EDIT_FIELDS).toHaveLength(7);
  });
});

describe("buildUpdateFormData", () => {
  it("sends every text field and keeps the image by default", () => {
    const data = buildUpdateFormData(values(), { action: "keep", file: null });
    expect(Object.fromEntries(data.entries())).toEqual({
      fullName: "Acme Records",
      phone: "",
      username: "acme",
      email: "admin@acme.io",
      subdomain: "acme",
      customDomain: "",
      profileImageAction: "keep",
    });
  });

  it("sends a replacement with its file", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
    const data = buildUpdateFormData(values(), { action: "replace", file });
    expect(data.get("profileImageAction")).toBe("replace");
    expect(data.get("profileImage")).toBeInstanceOf(File);
  });

  it("never sends a replacement without a file", () => {
    const data = buildUpdateFormData(values(), { action: "replace", file: null });
    expect(data.get("profileImageAction")).toBe("keep");
    expect(data.has("profileImage")).toBe(false);
  });

  it("sends a removal without a file", () => {
    const data = buildUpdateFormData(values(), { action: "remove", file: null });
    expect(data.get("profileImageAction")).toBe("remove");
    expect(data.has("profileImage")).toBe(false);
  });
});

describe("savedTenantHref", () => {
  it("goes to the details page with the matching notice", () => {
    expect(savedTenantHref(TENANT.id, false)).toBe(`/platform/tenants/${TENANT.id}?notice=updated`);
    expect(savedTenantHref(TENANT.id, true)).toBe(`/platform/tenants/${TENANT.id}?notice=updated-dns`);
  });
});

describe("hasUnsavedEdits", () => {
  it("is false while every value is the saved one and the image is kept", () => {
    expect(hasUnsavedEdits(values(), values(), { action: "keep", file: null })).toBe(false);
  });

  it("is true for a changed field or a replaced/removed image", () => {
    expect(hasUnsavedEdits(values({ phone: "9876543210" }), values(), { action: "keep", file: null })).toBe(true);
    expect(hasUnsavedEdits(values(), values(), { action: "remove", file: null })).toBe(true);
    const file = new File([new Uint8Array([1])], "logo.png", { type: "image/png" });
    expect(hasUnsavedEdits(values(), values(), { action: "replace", file })).toBe(true);
  });
});
