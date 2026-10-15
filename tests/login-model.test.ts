/**
 * The sign-in form's client-side validation (src/app/platform/login/login-model.ts):
 * required fields, whitespace-only input, length limits and trimming. The
 * server validates again; these rules only stop an invalid form being sent.
 */
import { describe, expect, it } from "vitest";
import {
  PASSWORD_REQUIRED,
  trimUsername,
  USERNAME_REQUIRED,
  validateLoginField,
  validateLoginForm,
} from "@/app/platform/login/login-model";

const LIMITS = { usernameMaxLength: 64, passwordMaxLength: 256 };

describe("validateLoginField: username", () => {
  it.each([
    ["empty", ""],
    ["white space only", "   \t "],
  ])("requires a username (%s)", (_, value) => {
    expect(validateLoginField("username", value, LIMITS)).toBe(USERNAME_REQUIRED);
  });

  it("checks the length after trimming", () => {
    expect(validateLoginField("username", "  ab  ", LIMITS)).toBe("Usernames are 3–64 characters long.");
    expect(validateLoginField("username", "x".repeat(65), LIMITS)).toBe("Usernames are 3–64 characters long.");
    expect(validateLoginField("username", "  abc  ", LIMITS)).toBeUndefined();
    expect(validateLoginField("username", "x".repeat(64), LIMITS)).toBeUndefined();
  });

  it("does not reveal the character rules of user names", () => {
    // A malformed name is reported by the server like any wrong credential.
    expect(validateLoginField("username", "Not A Valid Name!", LIMITS)).toBeUndefined();
  });
});

describe("validateLoginField: password", () => {
  it.each([
    ["empty", ""],
    ["white space only", "    "],
  ])("requires a password (%s)", (_, value) => {
    expect(validateLoginField("password", value, LIMITS)).toBe(PASSWORD_REQUIRED);
  });

  it("accepts spaces around a real password and limits the length", () => {
    expect(validateLoginField("password", "  secret  ", LIMITS)).toBeUndefined();
    expect(validateLoginField("password", "x".repeat(257), LIMITS)).toBe("Passwords are at most 256 characters long.");
  });
});

describe("validateLoginForm", () => {
  it("returns every error at once", () => {
    expect(validateLoginForm({ username: " ", password: "" }, LIMITS)).toStrictEqual({
      username: USERNAME_REQUIRED,
      password: PASSWORD_REQUIRED,
    });
  });

  it("is empty for a form that may be sent", () => {
    expect(validateLoginForm({ username: "owner", password: "correct horse" }, LIMITS)).toStrictEqual({});
  });
});

describe("trimUsername", () => {
  it("removes surrounding white space only", () => {
    expect(trimUsername("  vt-owner \n")).toBe("vt-owner");
    expect(trimUsername("a b")).toBe("a b");
  });
});
