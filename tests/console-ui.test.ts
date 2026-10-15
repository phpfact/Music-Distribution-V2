import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/app/platform/(console)/_components/password-input";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Field, describedBy } from "@/app/platform/(console)/_components/field";
import { Notice } from "@/app/platform/(console)/_components/notice";
import { Spinner } from "@/app/platform/(console)/_components/spinner";
import {
  DOMAIN_STATUS_LABELS,
  PROVISIONING_STEP_LABELS,
  TENANT_STATUS_LABELS,
} from "@/app/platform/(console)/tenants/labels";

// Test the form/announcement contracts preserved by the component migration,
// rather than coupling the suite to a duplicated set of Tailwind class strings.
describe("shared shadcn application contracts", () => {
  it("keeps password toggle space when a screen customizes input padding", () => {
    const html = renderToStaticMarkup(
      createElement(PasswordInput, {
        id: "login-password",
        name: "password",
        autoComplete: "current-password",
        className: "h-12 px-3.5 text-base",
      }),
    );
    expect(html).toContain("pr-12");
    expect(html).toContain('type="password"');
    expect(html).toContain('aria-controls="login-password"');
    expect(html).toContain('aria-label="Show password"');
  });

  it("retains successful native input names, values and validation attributes", () => {
    const html = renderToStaticMarkup(
      createElement(Input, {
        id: "contact",
        name: "contactEmail",
        type: "email",
        defaultValue: "owner@example.com",
        required: true,
        readOnly: true,
        "aria-invalid": true,
        "aria-describedby": "contact-error",
      }),
    );
    for (const attribute of [
      'name="contactEmail"',
      'type="email"',
      'value="owner@example.com"',
      'required=""',
      'readOnly=""',
      'aria-invalid="true"',
      'aria-describedby="contact-error"',
    ]) {
      expect(html).toContain(attribute);
    }
  });

  it("composes links without nested buttons and preserves pending submit semantics", () => {
    const link = renderToStaticMarkup(
      createElement(
        Button,
        { asChild: true, variant: "outline" },
        createElement("a", { href: "/platform/tenants" }, "Tenants"),
      ),
    );
    expect(link).toContain('href="/platform/tenants"');
    expect(link).not.toContain("<button");
    const pending = renderToStaticMarkup(
      createElement(
        Button,
        { type: "submit", disabled: true, "aria-busy": true },
        "Saving…",
      ),
    );
    expect(pending).toContain('type="submit"');
    expect(pending).toContain('disabled=""');
    expect(pending).toContain('aria-busy="true"');
  });

  it("preserves browser-native select payload and saved option selection", () => {
    const html = renderToStaticMarkup(
      createElement(
        NativeSelect,
        {
          name: "status",
          defaultValue: "active",
          "aria-label": "Tenant status",
        },
        createElement(
          NativeSelectOption,
          { key: "all", value: "" },
          "All statuses",
        ),
        createElement(
          NativeSelectOption,
          { key: "active", value: "active" },
          "Active",
        ),
      ),
    );
    expect(html).toContain('name="status"');
    expect(html).toMatch(/value="active"[^>]*selected=""/);
    expect(html).toContain('aria-label="Tenant status"');
  });

  it("keeps field label, hint and backend error associated with the input", () => {
    const aria = describedBy("contact", { hint: true, error: true });
    const fieldProps = {
      label: "Contact email",
      htmlFor: "contact",
      required: true,
      hint: "Use the admin address.",
      error: "This email is already registered.",
      children: createElement(Input, {
        id: "contact",
        name: "contactEmail",
        ...aria,
      }),
    };
    const html = renderToStaticMarkup(createElement(Field, fieldProps));
    expect(html).toContain('for="contact"');
    expect(html).toContain('aria-describedby="contact-hint contact-error"');
    expect(html).toContain('id="contact-hint"');
    expect(html).toContain('id="contact-error"');
    expect(html).toContain("This email is already registered.");
    expect(html).toContain("(required)");
  });

  it("announces errors assertively and actual non-error results politely", () => {
    const error = renderToStaticMarkup(
      createElement(Notice, { variant: "error" }, "Could not save."),
    );
    const success = renderToStaticMarkup(
      createElement(Notice, { variant: "success" }, "Saved."),
    );
    expect(error).toContain('role="alert"');
    expect(success).toContain('role="status"');
    expect(success).not.toContain('role="alert"');
  });

  it("does not duplicate loading announcements in labeled pending buttons", () => {
    const html = renderToStaticMarkup(createElement(Spinner));
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain('aria-label="Loading"');
  });
});

describe("tenant labels", () => {
  it("name every tenant status", () => {
    expect(Object.keys(TENANT_STATUS_LABELS).sort()).toEqual(
      [
        "active",
        "deprovisioning",
        "failed",
        "pending",
        "provisioning",
        "suspended",
      ].sort(),
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
    for (const labels of [
      TENANT_STATUS_LABELS,
      PROVISIONING_STEP_LABELS,
      DOMAIN_STATUS_LABELS,
    ]) {
      for (const label of Object.values(labels))
        expect(label.trim()).not.toBe("");
    }
  });
});
