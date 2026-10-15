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
import { CountDetails } from "@/app/platform/(console)/_components/count-details";
import { EmptyState } from "@/app/platform/(console)/_components/empty-state";
import { SectionedLayout } from "@/app/platform/(console)/_components/secondary-menu";
import { SensitiveInput } from "@/app/platform/(console)/_components/sensitive-input";
import { SensitiveValue } from "@/app/platform/(console)/_components/sensitive-value";
import { StatCard } from "@/app/platform/(console)/_components/stat-card";
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

// CLAUDE.md compliance contracts (2026-10-15): secondary menu, masking,
// clickable counts and the shared empty state.
describe("CLAUDE.md shared components", () => {
  it("renders the secondary menu as in-page links in section order", () => {
    const layoutProps = {
      items: [
        { id: "personal", label: "Personal Information" },
        { id: "login", label: "Login Information" },
      ],
      label: "Form sections",
      children: createElement("section", { id: "personal" }, "A"),
    };
    const html = renderToStaticMarkup(createElement(SectionedLayout, layoutProps));
    expect(html).toContain('aria-label="Form sections"');
    expect(html.indexOf('href="#personal"')).toBeLessThan(html.indexOf('href="#login"'));
    // The first section is active before the browser measures anything.
    expect(html).toMatch(/aria-current="location"[^>]*>[^<]*Personal Information|href="#personal"[^>]*aria-current="location"/);
  });

  it("masks a sensitive value by default and never puts it in the markup", () => {
    const html = renderToStaticMarkup(
      createElement(SensitiveValue, { value: "owner@example.com", noun: "email", monospace: false }),
    );
    expect(html).not.toContain("owner@example.com");
    expect(html).toContain('aria-label="Show email"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("masks a sensitive input with CSS while keeping its value and text type", () => {
    const html = renderToStaticMarkup(
      createElement(SensitiveInput, { id: "phone", noun: "phone number", defaultValue: "9876543210" }),
    );
    expect(html).toContain('type="text"');
    expect(html).toContain("[-webkit-text-security:disc]");
    expect(html).toContain('aria-label="Show phone number"');
  });

  it("makes a count a button that opens its details", () => {
    const countProps = {
      label: "Active tenants: 5. Show the records behind this figure.",
      title: "Active tenants",
      calculation: "Tenants whose status is Active.",
      records: createElement("p", null, "records"),
      children: "5",
    };
    const html = renderToStaticMarkup(createElement(CountDetails, countProps));
    expect(html).toContain("<button");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Active tenants: 5. Show the records behind this figure."');
    // The records mount only when the dialog opens.
    expect(html).not.toContain("records</p>");
  });

  it("shows a summary figure as a count button only when it has details", () => {
    const withDetails = renderToStaticMarkup(
      createElement(
        "dl",
        null,
        createElement(StatCard, {
          label: "Total tenants",
          icon: "building-2",
          value: 1234,
          details: { title: "All tenants", calculation: "All of them.", records: null },
        }),
      ),
    );
    expect(withDetails).toContain("<button");
    expect(withDetails).toContain("1,234");
    const withoutFigure = renderToStaticMarkup(
      createElement("dl", null, createElement(StatCard, { label: "Plans", icon: "credit-card", value: null })),
    );
    expect(withoutFigure).not.toContain("<button");
    expect(withoutFigure).toContain("No data");
  });

  it("renders an empty state with illustration, heading, description and action", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        icon: "building-2",
        title: "No tenants yet",
        description: "Create the first tenant.",
        action: createElement("a", { href: "/platform/tenants/new" }, "Create tenant"),
      }),
    );
    expect(html).toContain("<svg");
    expect(html).toContain("No tenants yet");
    expect(html).toContain("Create the first tenant.");
    expect(html).toContain('href="/platform/tenants/new"');
  });
});
