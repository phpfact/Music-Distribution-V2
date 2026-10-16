"use client";

import { CircleAlert, CircleCheck, KeyRound, UserRound } from "lucide-react";
import Link from "next/link";
import { type FormEvent, type ReactNode, useActionState, useId, useRef, useState } from "react";
import { describedBy, Field, PasswordChecklist, PasswordInput, SensitiveInput } from "@/components/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  ACCOUNT_TYPE_OPTIONS,
  SIGNUP_EMAIL_MAX_LENGTH,
  SIGNUP_FIELD_ORDER,
  SIGNUP_FULL_NAME_MAX_LENGTH,
  SIGNUP_USERNAME_MAX_LENGTH,
  signupFieldError,
  validateSignupFields,
  WORKSPACE_PASSWORD_MAX_LENGTH,
  type SignupFieldErrors,
  type SignupFieldName,
  type SignupFields,
} from "@/lib/workspace/rules";
import { signupAction, type SignupState } from "./actions";

const initialState: SignupState = {
  status: "idle",
  values: { fullName: "", accountType: "", email: "", username: "" },
};

// Fields whose surrounding spaces are meaningless: trimmed on blur and submit.
const TRIMMED_FIELDS: readonly SignupFieldName[] = ["fullName", "email", "username"];

/**
 * Description: Group related fields under a heading (CLAUDE.md category-wise forms).
 * Input: The heading, its icon and the fields.
 * Output: A fieldset with a visible legend.
 * Use case: "Personal Information" and "Login Information" of the sign-up form.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function FormGroup({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * Description: Render the public customer sign-up form.
 * Input: The tenant's name (shown in the confirmation).
 * Output: Personal Information (full name, account type) and Login Information
 *   (email, username, password with live checklist, confirmation). Validation on
 *   blur, while correcting and on submit (the first invalid field is scrolled
 *   into view and focused); errors under each field; a pending "Submitting…"
 *   button; the rejected-registration notice; and, after success, a
 *   confirmation that the account is awaiting approval (no sign-in happens).
 * Use case: /customer/signup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function SignupForm({ tenantName }: { tenantName: string }) {
  const [state, formAction, pending] = useActionState(signupAction, initialState);
  const id = useId();

  // Controlled values: kept after every server answer (CLAUDE.md "preserve input").
  const [fields, setFields] = useState<SignupFields>({
    ...initialState.values,
    password: "",
    confirmPassword: "",
  });
  const [clientErrors, setClientErrors] = useState<SignupFieldErrors>({});
  const [serverErrors, setServerErrors] = useState<SignupFieldErrors>({});
  const [handledState, setHandledState] = useState(state);
  const inputRefs = useRef<Partial<Record<SignupFieldName, HTMLElement | null>>>({});

  // A new Server Action result, handled once while rendering.
  if (state !== handledState) {
    setHandledState(state);
    setServerErrors(state.fieldErrors ?? {});
    setClientErrors({});
    if (state.status === "success") {
      setFields({ ...initialState.values, password: "", confirmPassword: "" });
    }
  }

  // After success the form is replaced by the confirmation.
  if (state.status === "success") return <SignupSuccess tenantName={tenantName} />;

  /**
   * Description: The error currently shown for a field.
   * Input: The field.
   * Output: The client error, else the last server error, else undefined.
   * Use case: Every field's error message and ARIA wiring.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function errorOf(name: SignupFieldName): string | undefined {
    return clientErrors[name] ?? serverErrors[name];
  }

  /**
   * Description: The DOM id of a field's control.
   * Input: The field.
   * Output: A form-unique id.
   * Use case: Labels, errors and ARIA references.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function inputId(name: SignupFieldName): string {
    return `${id}-${name}`;
  }

  /**
   * Description: Change one field's value and keep its error up to date.
   * Input: The field and its new value.
   * Output: Updated values; a field that shows an error is re-validated live
   *   (and the confirmation follows the password).
   * Use case: onChange of every field.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function change(name: SignupFieldName, value: string) {
    const next = { ...fields, [name]: value };
    setFields(next);
    setServerErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
    if (errorOf(name)) setClientErrors((current) => ({ ...current, [name]: signupFieldError(name, next) }));
    if (name === "password" && errorOf("confirmPassword")) {
      setClientErrors((current) => ({ ...current, confirmPassword: signupFieldError("confirmPassword", next) }));
    }
  }

  /**
   * Description: Validate a field when it loses focus (trimming text fields first).
   * Input: The field.
   * Output: The field's error shown or cleared.
   * Use case: onBlur of every field.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function blur(name: SignupFieldName) {
    const next = TRIMMED_FIELDS.includes(name) ? { ...fields, [name]: fields[name].trim() } : fields;
    if (next !== fields) setFields(next);
    setClientErrors((current) => ({ ...current, [name]: signupFieldError(name, next) }));
  }

  /**
   * Description: Block an invalid sign-up before the request is sent.
   * Input: The submit event.
   * Output: Nothing for a valid form (the Server Action runs); otherwise the
   *   request is cancelled, every error is shown and the first invalid field
   *   is scrolled into view and focused.
   * Use case: The form's onSubmit.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // Step 1: trimmed values are what gets validated (and submitted).
    const trimmed = {
      ...fields,
      fullName: fields.fullName.trim(),
      email: fields.email.trim(),
      username: fields.username.trim(),
    };
    setFields(trimmed);

    // Step 2: the same rules as the server.
    const result = validateSignupFields(trimmed);
    if (result.ok) {
      setClientErrors({});
      return;
    }

    // Step 3: invalid — do not send; show the errors and focus the first one.
    event.preventDefault();
    setClientErrors(result.fieldErrors);
    setServerErrors({});
    const firstName = SIGNUP_FIELD_ORDER.find((name) => result.fieldErrors[name]);
    const first     = firstName ? inputRefs.current[firstName] : null;
    if (first) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      first.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      first.focus({ preventScroll: true });
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-7">
      {state.status === "rejected" ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>Your earlier registration was not approved</AlertTitle>
          <AlertDescription>
            {state.rejectionReason ? <p>Reason: {state.rejectionReason}</p> : null}
            <p>
              A new sign-up with these details is not possible.{" "}
              <Link href="/login" className="font-medium underline underline-offset-4">
                Log in
              </Link>{" "}
              with your password to request a review.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
      {state.formError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <FormGroup title="Personal Information" icon={<UserRound aria-hidden="true" className="size-4" />}>
        <Field label="Full name" htmlFor={inputId("fullName")} required error={errorOf("fullName")}>
          <Input
            ref={(element) => {
              inputRefs.current.fullName = element;
            }}
            id={inputId("fullName")}
            name="fullName"
            autoComplete="name"
            maxLength={SIGNUP_FULL_NAME_MAX_LENGTH}
            value={fields.fullName}
            onChange={(event) => change("fullName", event.currentTarget.value)}
            onBlur={() => blur("fullName")}
            placeholder="e.g. Asha Rao"
            aria-required="true"
            {...describedBy(inputId("fullName"), { error: errorOf("fullName") })}
            className="h-11"
          />
        </Field>

        <div className="flex flex-col gap-2">
          <Label id={`${inputId("accountType")}-label`}>
            Account type <span aria-hidden="true" className="text-destructive">*</span>
            <span className="sr-only"> (required)</span>
          </Label>
          <RadioGroup
            ref={(element) => {
              inputRefs.current.accountType = element;
            }}
            name="accountType"
            value={fields.accountType}
            onValueChange={(value) => {
              change("accountType", value);
              setClientErrors((current) => ({ ...current, accountType: undefined }));
            }}
            aria-labelledby={`${inputId("accountType")}-label`}
            aria-required="true"
            aria-invalid={errorOf("accountType") ? true : undefined}
            aria-describedby={errorOf("accountType") ? `${inputId("accountType")}-error` : undefined}
            tabIndex={-1}
            className="grid gap-2"
          >
            {ACCOUNT_TYPE_OPTIONS.map((option) => {
              const optionId = `${inputId("accountType")}-${option.value}`;
              const selected = fields.accountType === option.value;
              return (
                <Label
                  key={option.value}
                  htmlFor={optionId}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-accent/50",
                    selected ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <RadioGroupItem id={optionId} value={option.value} className="mt-0.5" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-xs leading-5 text-muted-foreground">{option.description}</span>
                  </span>
                </Label>
              );
            })}
          </RadioGroup>
          {errorOf("accountType") ? (
            <p id={`${inputId("accountType")}-error`} className="text-sm text-destructive">
              {errorOf("accountType")}
            </p>
          ) : null}
        </div>
      </FormGroup>

      <FormGroup title="Login Information" icon={<KeyRound aria-hidden="true" className="size-4" />}>
        <Field label="Email" htmlFor={inputId("email")} required error={errorOf("email")}>
          {/* Emails are sensitive: masked until the eye button reveals them. */}
          <SensitiveInput
            ref={(element) => {
              inputRefs.current.email = element;
            }}
            id={inputId("email")}
            noun="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            maxLength={SIGNUP_EMAIL_MAX_LENGTH}
            value={fields.email}
            onChange={(event) => change("email", event.currentTarget.value)}
            onBlur={() => blur("email")}
            placeholder="name@example.com"
            aria-required="true"
            hasError={Boolean(errorOf("email"))}
            {...describedBy(inputId("email"), { error: errorOf("email") })}
            className="h-11"
          />
        </Field>

        <Field
          label="Username"
          htmlFor={inputId("username")}
          required
          hint="3–64 characters: lower-case letters, digits, dots, hyphens or underscores."
          error={errorOf("username")}
        >
          <SensitiveInput
            ref={(element) => {
              inputRefs.current.username = element;
            }}
            id={inputId("username")}
            noun="username"
            name="username"
            autoComplete="username"
            maxLength={SIGNUP_USERNAME_MAX_LENGTH}
            value={fields.username}
            onChange={(event) => change("username", event.currentTarget.value)}
            onBlur={() => blur("username")}
            placeholder="e.g. asharao"
            aria-required="true"
            hasError={Boolean(errorOf("username"))}
            {...describedBy(inputId("username"), { hint: true, error: errorOf("username") })}
            className="h-11"
          />
        </Field>

        <Field label="Password" htmlFor={inputId("password")} required error={errorOf("password")}>
          <PasswordInput
            ref={(element) => {
              inputRefs.current.password = element;
            }}
            id={inputId("password")}
            name="password"
            autoComplete="new-password"
            maxLength={WORKSPACE_PASSWORD_MAX_LENGTH}
            value={fields.password}
            onChange={(event) => change("password", event.currentTarget.value)}
            onBlur={() => blur("password")}
            aria-required="true"
            hasError={Boolean(errorOf("password"))}
            aria-describedby={[`${inputId("password")}-checklist`, errorOf("password") ? `${inputId("password")}-error` : null]
              .filter(Boolean)
              .join(" ")}
            className="h-11"
          />
          <PasswordChecklist
            id={`${inputId("password")}-checklist`}
            password={fields.password}
            username={fields.username.trim().toLowerCase()}
          />
        </Field>

        <Field label="Confirm password" htmlFor={inputId("confirmPassword")} required error={errorOf("confirmPassword")}>
          <PasswordInput
            ref={(element) => {
              inputRefs.current.confirmPassword = element;
            }}
            id={inputId("confirmPassword")}
            name="confirmPassword"
            autoComplete="new-password"
            maxLength={WORKSPACE_PASSWORD_MAX_LENGTH}
            value={fields.confirmPassword}
            onChange={(event) => change("confirmPassword", event.currentTarget.value)}
            onBlur={() => blur("confirmPassword")}
            aria-required="true"
            hasError={Boolean(errorOf("confirmPassword"))}
            {...describedBy(inputId("confirmPassword"), { error: errorOf("confirmPassword") })}
            className="h-11"
          />
        </Field>
      </FormGroup>

      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          <span aria-hidden="true" className="text-destructive">*</span> Required field. Your account is reviewed by{" "}
          {tenantName} before you can log in.
        </p>
        {/* Disabled while submitting, so a second click cannot send a duplicate request. */}
        <Button type="submit" disabled={pending} aria-busy={pending || undefined} className="h-11 w-full">
          {pending ? <Spinner /> : null}
          {pending ? "Submitting…" : "Create account"}
        </Button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Log in
          </Link>
        </p>
      </div>
    </form>
  );
}

/**
 * Description: Confirm that a sign-up was received and is awaiting approval.
 * Input: The tenant's name.
 * Output: A success notice explaining that the account cannot be used until it
 *   is approved, with links to the home and login pages.
 * Use case: SignupForm after a successful submission.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function SignupSuccess({ tenantName }: { tenantName: string }) {
  return (
    <div role="status" className="flex flex-col items-center gap-4 py-4 text-center">
      <span className="grid size-14 place-items-center rounded-2xl border bg-background text-success">
        <CircleCheck aria-hidden="true" className="size-7" />
      </span>
      <div>
        <h2 className="text-lg font-semibold">Registration submitted</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Thank you! Your account is awaiting approval by {tenantName}. You can log in as soon as it has been
          approved — until then, the dashboard is not available.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="outline">
          <Link href="/">Back to home</Link>
        </Button>
        <Button asChild>
          <Link href="/login">Go to log in</Link>
        </Button>
      </div>
    </div>
  );
}
