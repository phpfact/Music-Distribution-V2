/**
 * The sign-in form's client-side validation without React: pure functions,
 * so they are unit-tested directly and the form only wires them up.
 *
 * The server stays authoritative (authenticatePlatformOwner validates again).
 * By design the username's character rules are not checked here: the login
 * page never reveals the format of valid user names; a malformed name is
 * reported by the server like any other wrong credential.
 */
import { USERNAME_MIN_LENGTH } from "@/lib/platform-auth/username";

/** The two fields of the sign-in form. */
export type LoginField = "username" | "password";

/** The message under each invalid field; a valid field has no entry. */
export type LoginClientErrors = Partial<Record<LoginField, string>>;

/** The field limits the server page passes to the form. */
export type LoginLimits = { usernameMaxLength: number; passwordMaxLength: number };

// The same wording as the server's field errors (src/lib/platform-auth/login.ts).
export const USERNAME_REQUIRED = "Enter your username.";
export const PASSWORD_REQUIRED = "Enter your password.";

/**
 * Description: Bring a typed username into the form it is submitted in.
 * Input: The raw text of the username field.
 * Output: The text without leading and trailing whitespace.
 * Use case: On blur and before submit, so stray spaces never reach the server.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function trimUsername(input: string): string {
  return input.trim();
}

/**
 * Description: Check one sign-in field the way the owner sees it.
 * Input: The field, its current value and the server-owned length limits.
 * Output: The error message for that field, or undefined when it is fine.
 * Use case: Real-time validation (blur, and typing after an error) and submit.
 *   Username: required (whitespace-only counts as empty), 3 to max characters
 *   after trimming. Password: required (whitespace-only counts as empty), at
 *   most max characters; it is never trimmed or changed.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function validateLoginField(
  field: LoginField,
  value: string,
  limits: LoginLimits,
): string | undefined {
  if (field === "username") {
    // Step 1: spaces around the name are not part of it.
    const username = trimUsername(value);
    // Step 2: required.
    if (username.length === 0) return USERNAME_REQUIRED;
    // Step 3: the length every valid platform user name has.
    if (username.length < USERNAME_MIN_LENGTH || username.length > limits.usernameMaxLength) {
      return `Usernames are ${USERNAME_MIN_LENGTH}–${limits.usernameMaxLength} characters long.`;
    }
    return undefined;
  }

  // Password: whitespace-only is treated as empty, but the value is never trimmed.
  if (value.trim().length === 0) return PASSWORD_REQUIRED;
  if (value.length > limits.passwordMaxLength) {
    return `Passwords are at most ${limits.passwordMaxLength} characters long.`;
  }
  return undefined;
}

/**
 * Description: Check the whole sign-in form before the request is sent.
 * Input: The username and password values and the length limits.
 * Output: Every field error at once (empty object when the form may be sent).
 * Use case: The form's submit handler: an invalid form is never sent.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function validateLoginForm(
  values: { username: string; password: string },
  limits: LoginLimits,
): LoginClientErrors {
  const errors: LoginClientErrors = {};
  const usernameError = validateLoginField("username", values.username, limits);
  const passwordError = validateLoginField("password", values.password, limits);
  if (usernameError) errors.username = usernameError;
  if (passwordError) errors.password = passwordError;
  return errors;
}
