/**
 * The tenant portal's pure rules (src/lib/workspace/rules.ts,
 * src/lib/workspace/appearance-options.ts) and the proxy's host/path decision
 * (src/proxy.ts). No database, no network.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";
import {
  parseWorkspaceAppearance,
  parseWorkspaceAppearanceUpdate,
  resolveWorkspaceAppearance,
  WORKSPACE_DEFAULT_APPEARANCE,
} from "@/lib/workspace/appearance-options";
import {
  accountTypeLabel,
  isEmailIdentifier,
  normalizeLoginIdentifier,
  parseRegistrationFilter,
  parseRegistrationListQuery,
  parseRegistrationPage,
  signupFieldError,
  validateLoginFields,
  validateRejectionReason,
  validateReviewMessage,
  validateSignupFields,
  type SignupFields,
} from "@/lib/workspace/rules";

const VALID_SIGNUP: SignupFields = {
  fullName: "  Asha   Rao ",
  accountType: "white_label",
  email: " Asha.Rao@Example.COM ",
  username: " AshaRao ",
  password: "Strong-pass-2026",
  confirmPassword: "Strong-pass-2026",
};

describe("sign-in rules", () => {
  it("normalizes the identifier and tells emails from usernames", () => {
    expect(normalizeLoginIdentifier("  Admin.User ")).toBe("admin.user");
    expect(isEmailIdentifier("a@b.co")).toBe(true);
    expect(isEmailIdentifier("admin")).toBe(false);
  });

  it("requires both fields, rejects whitespace-only passwords and never trims a password", () => {
    expect(validateLoginFields({ identifier: "", password: "" })).toStrictEqual({
      identifier: "Enter your username or email.",
      password: "Enter your password.",
    });
    expect(validateLoginFields({ identifier: "ab", password: "    " })).toStrictEqual({
      identifier: "Enter at least 3 characters.",
      password: "Enter your password.",
    });
    expect(validateLoginFields({ identifier: "x".repeat(321), password: "p".repeat(257) })).toStrictEqual({
      identifier: "Use at most 320 characters.",
      password: "Use at most 256 characters.",
    });
    expect(validateLoginFields({ identifier: " admin ", password: " spaced password " })).toStrictEqual({});
  });
});

describe("sign-up rules", () => {
  it("accepts a valid form and returns normalized values (password unchanged)", () => {
    expect(validateSignupFields(VALID_SIGNUP)).toStrictEqual({
      ok: true,
      value: {
        fullName: "Asha Rao",
        accountType: "white_label",
        email: "asha.rao@example.com",
        username: "asharao",
        password: "Strong-pass-2026",
      },
    });
  });

  it("reports every invalid field in page order", () => {
    const result = validateSignupFields({
      fullName: "Agent 007",
      accountType: "admin",
      email: "not-an-email",
      username: "x",
      password: "short",
      confirmPassword: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors)).toStrictEqual([
      "fullName",
      "accountType",
      "email",
      "username",
      "password",
      "confirmPassword",
    ]);
  });

  it("checks the password against the username and the confirmation against the password", () => {
    expect(signupFieldError("password", { ...VALID_SIGNUP, password: "asharao-2026-x" })).toBe(
      "Choose a password that does not contain the user name.",
    );
    expect(signupFieldError("confirmPassword", { ...VALID_SIGNUP, confirmPassword: "Strong-pass-2025" })).toBe(
      "The passwords do not match.",
    );
    expect(signupFieldError("accountType", { ...VALID_SIGNUP, accountType: "" })).toBe("Choose your account type.");
  });

  it("names the account types", () => {
    expect(accountTypeLabel("artist")).toBe("Artist");
    expect(accountTypeLabel("label")).toBe("Label");
    expect(accountTypeLabel("white_label")).toBe("White Label");
  });
});

describe("review rules", () => {
  it("requires a 3–500 character rejection reason", () => {
    expect(validateRejectionReason("   ")).toStrictEqual({ ok: false, error: "Enter the reason for the rejection." });
    expect(validateRejectionReason(" no ")).toMatchObject({ ok: false });
    expect(validateRejectionReason("x".repeat(501))).toMatchObject({ ok: false });
    expect(validateRejectionReason("  Missing links  ")).toStrictEqual({ ok: true, value: "Missing links" });
  });

  it("allows an empty review message and caps it at 1000 characters", () => {
    expect(validateReviewMessage("   ")).toStrictEqual({ ok: true, value: null });
    expect(validateReviewMessage(" Please look again ")).toStrictEqual({ ok: true, value: "Please look again" });
    expect(validateReviewMessage("x".repeat(1001))).toMatchObject({ ok: false });
  });
});

describe("registrations list query", () => {
  it("reads search, status and page from the URL with safe fallbacks", () => {
    expect(parseRegistrationListQuery({ q: "  asha ", status: "pending", page: "3" })).toStrictEqual({
      q: "asha",
      status: "pending",
      page: 3,
    });
    expect(parseRegistrationListQuery({ q: ["a", "b"], status: "deleted", page: "-1" })).toStrictEqual({
      q: "a",
      status: "all",
      page: 1,
    });
    expect(parseRegistrationListQuery({ q: "x".repeat(300), page: "99999999" })).toMatchObject({ page: 1 });
    expect(parseRegistrationListQuery({ q: "x".repeat(300) }).q).toHaveLength(100);
  });

  it("accepts only known popup filters and pages", () => {
    expect(parseRegistrationFilter("suspended")).toBe("suspended");
    expect(parseRegistrationFilter("approved")).toBeNull();
    expect(parseRegistrationFilter({})).toBeNull();
    expect(parseRegistrationPage(4)).toBe(4);
    expect(parseRegistrationPage("4")).toBe(1);
    expect(parseRegistrationPage(0)).toBe(1);
  });
});

describe("workspace appearance options", () => {
  it("accepts only complete, listed appearances", () => {
    expect(parseWorkspaceAppearance({ theme: "dark", accent: "rose", width: "full" })).toStrictEqual({
      theme: "dark",
      accent: "rose",
      width: "full",
    });
    expect(parseWorkspaceAppearance({ theme: "dark", accent: "pink", width: "full" })).toBeNull();
    expect(parseWorkspaceAppearance({ theme: "dark", accent: "rose" })).toBeNull();
    expect(parseWorkspaceAppearance(null)).toBeNull();
  });

  it("resolves personal → workspace → application default", () => {
    const personal  = { theme: "dark", accent: "rose", width: "full" };
    const workspace = { theme: "system", accent: "blue", width: "focused" };
    expect(resolveWorkspaceAppearance(personal, workspace)).toStrictEqual({ appearance: personal, source: "personal" });
    expect(resolveWorkspaceAppearance({ theme: "bad" }, workspace)).toStrictEqual({ appearance: workspace, source: "workspace" });
    expect(resolveWorkspaceAppearance(null, null)).toStrictEqual({ appearance: WORKSPACE_DEFAULT_APPEARANCE, source: "default" });
    // The returned default is a copy: changing it never changes the constant.
    resolveWorkspaceAppearance(null, null).appearance.theme = "dark";
    expect(WORKSPACE_DEFAULT_APPEARANCE.theme).toBe("light");
  });

  it("validates save requests", () => {
    expect(parseWorkspaceAppearanceUpdate({ operation: "reset", scope: "workspace" })).toStrictEqual({
      operation: "reset",
      scope: "workspace",
    });
    expect(
      parseWorkspaceAppearanceUpdate({ operation: "apply", scope: "personal", appearance: { theme: "light", accent: "amber", width: "default" } }),
    ).toMatchObject({ operation: "apply", scope: "personal" });
    expect(parseWorkspaceAppearanceUpdate({ operation: "apply", scope: "global", appearance: WORKSPACE_DEFAULT_APPEARANCE })).toBeNull();
    expect(parseWorkspaceAppearanceUpdate({ operation: "apply", scope: "personal" })).toBeNull();
    expect(parseWorkspaceAppearanceUpdate("reset")).toBeNull();
  });
});

describe("proxy: which host serves which path", () => {
  /** Runs the proxy for a host and path and says whether the request continues. */
  function continues(host: string, path: string): boolean {
    const request = new NextRequest(`http://${host}${path}`, { headers: { host } });
    const response = proxy(request);
    return response.status !== 404;
  }

  it("keeps the tenant portal off the platform host", () => {
    for (const path of ["/login", "/tenant", "/tenant/dashboard", "/customer/signup", "/customer/dashboard"]) {
      expect(continues("127.0.0.1:3000", path), path).toBe(false);
      expect(continues("localhost:3000", path), path).toBe(false);
    }
  });

  it("serves the tenant portal on tenant hosts and keeps the console off them", () => {
    for (const path of ["/login", "/tenant/dashboard", "/customer/signup"]) {
      expect(continues("acme.localhost:3000", path), path).toBe(true);
      expect(continues("music.example.com", path), path).toBe(true);
    }
    expect(continues("acme.localhost:3000", "/platform/login")).toBe(false);
    expect(continues("127.0.0.1:3000", "/platform/login")).toBe(true);
  });
});
