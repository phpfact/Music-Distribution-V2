import { describe, expect, it } from "vitest";
import {
  isValidUsername,
  normalizeUsername,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from "@/lib/platform-auth/username";

describe("normalizeUsername", () => {
  it.each([
    ["owner", "owner"],
    ["Owner", "owner"],
    ["OWNER-X", "owner-x"],
    ["  owner ", "owner"],
    ["\t Owner.One_2\n", "owner.one_2"],
    ["", ""],
    ["   ", ""],
    // Inner white space is not removed: the name is then simply not valid.
    ["ow ner", "ow ner"],
  ])("turns %j into %j", (input, expected) => {
    expect(normalizeUsername(input)).toBe(expected);
  });
});

describe("isValidUsername", () => {
  it("allows 3 to 64 characters", () => {
    expect(USERNAME_MIN_LENGTH).toBe(3);
    expect(USERNAME_MAX_LENGTH).toBe(64);
  });

  it.each([
    ["3 characters (the minimum)", "abc"],
    ["64 characters (the maximum)", "a".repeat(64)],
    ["64 characters with separators inside", `a${"-".repeat(62)}b`],
    ["digits only", "123"],
    ["a leading digit", "1owner"],
    ["a dot inside", "a.b"],
    ["an underscore inside", "a_b"],
    ["a hyphen inside", "a-b"],
    ["mixed separators", "platform.owner_01-x"],
    ["consecutive separators", "a.-_b"],
  ])("accepts %s", (_description, username) => {
    expect(isValidUsername(username)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["1 character", "a"],
    ["2 characters", "ab"],
    ["65 characters", "a".repeat(65)],
    ["an upper-case letter (not normalized)", "Owner"],
    ["a space inside", "a b"],
    ["surrounding spaces (not normalized)", " owner "],
    ["a leading hyphen", "-abc"],
    ["a leading dot", ".abc"],
    ["a leading underscore", "_abc"],
    ["a trailing hyphen", "abc-"],
    ["a trailing dot", "abc."],
    ["a trailing underscore", "abc_"],
    ["only separators", "..."],
    ["an at sign", "owner@example.com"],
    ["a slash", "own/er"],
    ["a quote", "own'er"],
    ["a non-ASCII letter", "ownér"],
    ["a trailing newline", "owner\n"],
    ["a NUL byte", "own\u0000er"],
  ])("rejects %s", (_description, username) => {
    expect(isValidUsername(username)).toBe(false);
  });
});
