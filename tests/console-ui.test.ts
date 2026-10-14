import { describe, expect, it } from "vitest";
import { FOCUS_RING } from "@/app/platform/(console)/_components/styles";
import {
  buttonClass,
  inputClass,
  selectClass,
  textareaClass,
} from "@/app/platform/(console)/_components/ui";
import {
  DOMAIN_STATUS_LABELS,
  PROVISIONING_STEP_LABELS,
  TENANT_STATUS_LABELS,
} from "@/app/platform/(console)/tenants/labels";

const classes = (value: string): string[] => value.split(/\s+/);

describe("buttonClass", () => {
  it("gives every variant the shared shape, focus ring and disabled style", () => {
    for (const variant of ["primary", "secondary", "danger", "ghost"] as const) {
      const value = buttonClass(variant);
      expect(value).toContain(FOCUS_RING);
      expect(classes(value)).toEqual(
        expect.arrayContaining(["inline-flex", "items-center", "gap-2", "rounded-lg", "font-medium"]),
      );
      expect(classes(value)).toContain("disabled:opacity-60");
    }
  });

  it("colours each variant", () => {
    expect(classes(buttonClass("primary"))).toEqual(expect.arrayContaining(["bg-accent", "text-accent-fg"]));
    expect(classes(buttonClass("secondary"))).toEqual(
      expect.arrayContaining(["border", "border-line", "hover:bg-surface-2"]),
    );
    expect(classes(buttonClass("danger"))).toEqual(expect.arrayContaining(["bg-red-600", "dark:bg-red-400"]));
  });

  it("is md by default and sm on request", () => {
    expect(classes(buttonClass("primary"))).toEqual(expect.arrayContaining(["h-10", "px-4", "text-sm"]));
    expect(classes(buttonClass("primary", "sm"))).toEqual(expect.arrayContaining(["h-8", "px-3", "text-sm"]));
    expect(classes(buttonClass("primary", "sm"))).not.toContain("h-10");
  });
});

describe("form control classes", () => {
  it("use the line border normally and a red one for an error", () => {
    expect(classes(inputClass(false))).toContain("border-line");
    expect(classes(inputClass(false))).not.toContain("border-red-600");
    expect(classes(inputClass(true))).toEqual(expect.arrayContaining(["border-red-600", "dark:border-red-500"]));
    expect(classes(inputClass(true))).not.toContain("border-line");
  });

  it("add extra classes and keep the read-only look", () => {
    const value = classes(inputClass(false, "pr-16"));
    expect(value).toEqual(expect.arrayContaining(["h-10", "pr-16", "read-only:bg-surface-2", "rounded-lg"]));
  });

  it("size selects like inputs and let textareas grow", () => {
    expect(classes(selectClass(false))).toContain("h-10");
    expect(classes(textareaClass(false))).not.toContain("h-10");
    expect(classes(textareaClass(true))).toContain("border-red-600");
  });
});

describe("tenant labels", () => {
  it("name every tenant status", () => {
    expect(Object.keys(TENANT_STATUS_LABELS).sort()).toEqual(
      ["active", "deprovisioning", "failed", "pending", "provisioning", "suspended"].sort(),
    );
    expect(TENANT_STATUS_LABELS.provisioning).toBe("Setting up");
    expect(TENANT_STATUS_LABELS.failed).toBe("Setup failed");
  });

  it("name every provisioning step, in run order", () => {
    expect(Object.keys(PROVISIONING_STEP_LABELS)).toEqual([
      "create_database_user",
      "create_database",
      "check_database",
      "grant_privileges",
      "apply_migrations",
      "create_initial_admin",
      "register_domain",
      "verify",
    ]);
    expect(PROVISIONING_STEP_LABELS.apply_migrations).toBe("Install schema");
  });

  it("name every domain status", () => {
    expect(DOMAIN_STATUS_LABELS).toEqual({
      pending: "Pending verification",
      active: "Active",
      failed: "Failed",
    });
  });

  it("never leave a label empty", () => {
    for (const labels of [TENANT_STATUS_LABELS, PROVISIONING_STEP_LABELS, DOMAIN_STATUS_LABELS]) {
      for (const label of Object.values(labels)) expect(label.trim()).not.toBe("");
    }
  });
});
