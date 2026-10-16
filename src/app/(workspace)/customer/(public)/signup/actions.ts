"use server";

import { headers } from "next/headers";
import { clientIpFromForwardedFor } from "@/lib/platform-auth/rate-limit";
import { requireReadyWorkspace } from "@/lib/workspace/guards";
import { submitRegistration } from "@/lib/workspace/registrations";
import {
  SIGNUP_EMAIL_MAX_LENGTH,
  SIGNUP_FULL_NAME_MAX_LENGTH,
  SIGNUP_USERNAME_MAX_LENGTH,
  textOf,
  type SignupFieldErrors,
} from "@/lib/workspace/rules";

/** The non-secret values the form keeps after an attempt (never the passwords). */
export type SignupValues = { fullName: string; accountType: string; email: string; username: string };

export type SignupState = {
  status: "idle" | "error" | "rejected" | "success";
  /** A red alert above the form (rate limited, unavailable). */
  formError?: string;
  /** The applicant's earlier rejection reason (only after their password matched). */
  rejectionReason?: string | null;
  fieldErrors?: SignupFieldErrors;
  values: SignupValues;
};

const FORM_ERRORS = {
  rate_limited: "Too many sign-up attempts from your network. Please try again later.",
  unavailable: "Sign-up is temporarily unavailable. Please try again shortly.",
} as const;

/**
 * Description: Submit a public customer sign-up for approval.
 * Input: The previous state (unused) and the submitted FormData (full name,
 *   account type, email, username, password, confirm password; untrusted).
 * Output: "success" (stored as pending — no session, no dashboard access),
 *   field errors, the applicant's own rejection reason, or a form error. The
 *   non-secret values are returned so the form keeps them.
 * Use case: /customer/signup. The tenant comes from the Host header only; the
 *   form never says which tenant it is for.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function signupAction(_previousState: SignupState, formData: FormData): Promise<SignupState> {
  // Step 1: the tenant of this host (unknown → 404, suspended → notice page).
  const workspace = await requireReadyWorkspace();

  /**
   * Description: Read one submitted field without trusting its type.
   * Input: The field name.
   * Output: The text, or "" for anything that is not text.
   * Use case: signupAction.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  const field = (name: string): string => textOf(formData instanceof FormData ? formData.get(name) : null);

  // Step 2: the submitted values the form keeps (never the passwords).
  const values: SignupValues = {
    fullName: field("fullName").slice(0, SIGNUP_FULL_NAME_MAX_LENGTH),
    accountType: field("accountType"),
    email: field("email").slice(0, SIGNUP_EMAIL_MAX_LENGTH),
    username: field("username").slice(0, SIGNUP_USERNAME_MAX_LENGTH),
  };

  // Step 3: validation, duplicates, hashing and storage happen in the service.
  const clientIp = clientIpFromForwardedFor((await headers()).get("x-forwarded-for"));
  const result = await submitRegistration(
    workspace.db,
    workspace.tenant.id,
    {
      fullName: field("fullName"),
      accountType: field("accountType"),
      email: field("email"),
      username: field("username"),
      password: field("password"),
      confirmPassword: field("confirmPassword"),
    },
    clientIp,
  );

  // Step 4: the answer for the form.
  if (result.ok) return { status: "success", values: { fullName: "", accountType: "", email: "", username: "" } };
  if (result.reason === "validation") return { status: "error", fieldErrors: result.fieldErrors, values };
  if (result.reason === "rejected") return { status: "rejected", rejectionReason: result.rejectionReason, values };
  return { status: "error", formError: FORM_ERRORS[result.reason], values };
}
