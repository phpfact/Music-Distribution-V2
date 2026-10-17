/**
 * UI contracts of the shared RBAC components (src/components/rbac/ and
 * src/components/shared/searchable-select.tsx): ARIA semantics, submitted
 * field names, one role id, locked privileges never rendered as checkboxes,
 * required markers and password eye toggles. Rendered to static markup, like
 * tests/console-ui.test.ts, so the suite does not couple to class strings.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The client components call useRouter(); outside Next's app router it has no context.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const { SearchableSelect } = await import("@/components/shared/searchable-select");
const { RoleEditor } = await import("@/components/rbac/role-editor");
const { RolePicker } = await import("@/components/rbac/role-picker");
const { SubUserForm } = await import("@/components/rbac/sub-user-form");
const { PrivilegeList } = await import("@/components/rbac/privilege-list");

const ROLE_A = "0b9c1a7e-2f4d-4c1b-9a3e-5d6f7a8b9c0d";
const ROLE_B = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";

/** Count the occurrences of a substring. */
function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/** A Server Action stand-in (never called while rendering). */
async function noopAction() {
  return { status: "idle" } as const;
}

describe("SearchableSelect", () => {
  it("renders an ARIA combobox trigger and exactly one hidden value", () => {
    const html = renderToStaticMarkup(
      createElement(SearchableSelect, {
        id: "role",
        name: "roleId",
        options: [
          { value: ROLE_A, label: "Editors" },
          { value: ROLE_B, label: "Viewers" },
        ],
        defaultValue: ROLE_B,
        invalid: true,
        required: true,
        "aria-describedby": "role-error",
      }),
    );
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-describedby="role-error"');
    expect(html).toContain("Viewers");
    // One hidden input, one value.
    expect(count(html, 'name="roleId"')).toBe(1);
    expect(html).toMatch(new RegExp(`type="hidden" name="roleId" value="${ROLE_B}"`));
  });

  it("shows Loading… and stays disabled while loading", () => {
    const html = renderToStaticMarkup(
      createElement(SearchableSelect, { id: "role", name: "roleId", options: [], loading: true }),
    );
    expect(html).toContain("Loading…");
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });

  it("submits nothing chosen as an empty value and omits the input without a name", () => {
    const named = renderToStaticMarkup(createElement(SearchableSelect, { id: "r", name: "roleId", options: [] }));
    expect(named).toContain('type="hidden" name="roleId" value=""');
    const unnamed = renderToStaticMarkup(createElement(SearchableSelect, { id: "r", options: [] }));
    expect(unnamed).not.toContain('type="hidden"');
  });
});

describe("RolePicker", () => {
  it("submits one roleId and shows privilege counts and the Master badge", () => {
    const html = renderToStaticMarkup(
      createElement(RolePicker, {
        id: "picker",
        roles: [
          { id: ROLE_A, name: "Master Tenant", isMaster: true, privilegeCount: null },
          { id: ROLE_B, name: "Support", isMaster: false, privilegeCount: 3 },
        ],
        defaultValue: ROLE_A,
      }),
    );
    expect(count(html, 'name="roleId"')).toBe(1);
    expect(html).toContain(`value="${ROLE_A}"`);
    expect(html).toContain("Master Tenant");
    expect(html).toContain("Master");
  });
});

describe("RoleEditor", () => {
  const modules = [
    {
      key: "tenant.users",
      label: "Sub-Tenants",
      description: "The tenant's team accounts.",
      privileges: [
        { key: "tenant.users.view", label: "View sub-tenants", description: "Open the list.", requires: [] },
        { key: "tenant.users.edit", label: "Edit sub-tenants", description: "Change details.", requires: ["tenant.users.view"] },
      ],
    },
  ];
  const locked = [
    { key: "tenant.registrations.review", label: "Approve and reject registrations", moduleLabel: "Customer Registrations", reason: "outside_privileges" as const },
    { key: "tenant.appearance.manage_workspace", label: "Manage workspace appearance", moduleLabel: "Workspace Appearance", reason: "module_disabled" as const },
  ];

  function render(mode: "create" | "edit") {
    return renderToStaticMarkup(
      createElement(RoleEditor, {
        mode,
        modules,
        locked,
        initial: mode === "edit" ? { name: "Support", description: "Helps customers", status: "active", privileges: ["tenant.users.view", "tenant.registrations.review"] } : undefined,
        affectedUserCount: 4,
        action: noopAction,
        cancelHref: "/tenant/roles",
      }),
    );
  }

  it("never renders locked privileges as checkboxes", () => {
    const html = render("create");
    // Assignable privileges are checkboxes (2 privileges + 1 module header).
    expect(count(html, 'role="checkbox"')).toBe(3);
    expect(html).toContain('value="tenant.users.view"');
    expect(html).toContain('value="tenant.users.edit"');
    // Locked ones are listed with their reason, but never as a control.
    expect(html).toContain("Not assignable");
    expect(html).toContain("Approve and reject registrations");
    expect(html).toContain("Outside your privileges");
    expect(html).toContain("Module disabled by the Platform Owner");
    expect(html).not.toContain('value="tenant.registrations.review"');
    expect(html).not.toContain('value="tenant.appearance.manage_workspace"');
  });

  it("renders the field names, required markers, counter, needs-hint and sections", () => {
    const html = render("create");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="description"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain(" (required)");
    expect(html).toContain("0 / 500");
    expect(html).toContain("Needs View sub-tenants");
    for (const id of ['id="role-details"', 'id="role-privileges"', 'id="role-review"']) expect(html).toContain(id);
    expect(html).toContain("Create role");
  });

  it("prefills an edit form, ignores non-assignable stored keys and shows affected users", () => {
    const html = render("edit");
    expect(html).toContain('value="Support"');
    expect(html).toContain("Helps customers");
    expect(html).toContain("4 users affected");
    expect(html).toContain("Save role");
    // tenant.users.view is ticked; the header is indeterminate (1 of 2).
    expect(html).toContain('aria-checked="mixed"');
    expect(html).toMatch(/>1<\/span> <span[^>]*>privilege selected</);
  });
});

describe("PrivilegeList", () => {
  it("marks privileges of disabled modules and shows an empty state without privileges", () => {
    const html = renderToStaticMarkup(
      createElement(PrivilegeList, {
        modules: [
          {
            key: "tenant.appearance",
            label: "Workspace Appearance",
            description: "",
            privileges: [{ key: "tenant.appearance.manage_workspace", label: "Manage workspace appearance", description: "", requires: [], moduleDisabled: true }],
          },
        ],
      }),
    );
    expect(html).toContain("Module disabled by the Platform Owner");
    expect(html).not.toContain('role="checkbox"');
    const empty = renderToStaticMarkup(createElement(PrivilegeList, { modules: [] }));
    expect(empty).toContain("No privileges");
  });
});

describe("SubUserForm", () => {
  const roles = [{ id: ROLE_A, name: "Support", isMaster: false, privilegeCount: 2 }];

  function render(variant: "platform" | "tenant" | "customer", mode: "create" | "edit" = "create") {
    return renderToStaticMarkup(
      createElement(SubUserForm, {
        variant,
        mode,
        roles,
        initial: mode === "edit" ? { fullName: "Asha Rao", username: "asha.rao", email: variant === "platform" ? null : "asha@example.com", accountType: variant === "customer" ? "artist" : undefined, roleId: ROLE_A } : undefined,
        action: noopAction,
        cancelHref: "/tenant/users",
      }),
    );
  }

  it("platform: full name, username, passwords and role; no email", () => {
    const html = render("platform");
    for (const name of ["fullName", "username", "password", "confirmPassword", "roleId"]) expect(html).toContain(`name="${name}"`);
    expect(html).not.toContain('name="email"');
    expect(html).not.toContain('id="sub-user-accountType"');
    expect(html).toContain("Create Sub-Platform Owner");
  });

  it("tenant: adds a masked email; customer: adds the account type", () => {
    const tenant = render("tenant");
    expect(tenant).toContain('name="email"');
    expect(tenant).toContain('aria-label="Show email"');
    expect(tenant).toContain("Create sub-tenant");
    const customer = render("customer");
    expect(customer).toContain('id="sub-user-accountType"');
    expect(customer).toContain("Artist");
    expect(customer).toContain("Create sub-customer");
  });

  it("gives both password fields an eye toggle and the role picker its helper text", () => {
    const html = render("tenant");
    expect(count(html, 'aria-label="Show password"')).toBe(2);
    expect(html).toContain("Exactly one role. It takes effect on the user&#x27;s next request.");
    expect(count(html, 'name="roleId"')).toBe(1);
    for (const id of ['id="sub-user-personal"', 'id="sub-user-login"', 'id="sub-user-access"']) expect(html).toContain(id);
  });

  it("edit: username read-only (not submitted), optional new password, prefilled values", () => {
    const html = render("tenant", "edit");
    expect(html).not.toContain('name="username"');
    expect(html).not.toContain('name="email"');
    expect(html).toContain("Set a new password");
    expect(html).toContain('value="Asha Rao"');
    expect(html).toContain(`value="${ROLE_A}"`);
    expect(html).toContain("Save changes");
    expect(count(html, 'aria-label="Show password"')).toBe(2);
  });
});
