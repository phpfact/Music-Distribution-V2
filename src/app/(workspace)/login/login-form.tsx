"use client";

import { ArrowRight, CircleAlert, Info } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useActionState, useEffect, useId, useRef, useState } from "react";
import { PasswordInput, SensitiveInput } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  LOGIN_IDENTIFIER_MAX_LENGTH,
  validateLoginFields,
  WORKSPACE_PASSWORD_MAX_LENGTH,
  type LoginFieldErrors,
} from "@/lib/workspace/rules";
import { workspaceLoginAction, type WorkspaceLoginState } from "./actions";

const initialState: WorkspaceLoginState = { identifier: "" };

type Field = keyof LoginFieldErrors;

/**
 * Description: Render the shared tenant-portal sign-in form.
 * Input: None.
 * Output: A native Server Action form (works without JavaScript) with the masked
 *   "Username or email" field (eye button), the password with show/hide,
 *   errors under each field, a form alert/notice and a pending "Signing in…" button.
 * Use case: /login. Fields validate on blur and while an error is shown; an
 *   invalid form is not sent and the first invalid field is scrolled into view
 *   and focused. The server validates everything again.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function LoginForm() {
  // Passing the Server Action to the form keeps it working without JavaScript.
  const [state, formAction, pending] = useActionState(workspaceLoginAction, initialState);

  const id                = useId();
  const identifierId      = `${id}-identifier`;
  const identifierErrorId = `${id}-identifier-error`;
  const passwordId        = `${id}-password`;
  const passwordErrorId   = `${id}-password-error`;

  const identifierRef = useRef<HTMLInputElement>(null);
  const passwordRef   = useRef<HTMLInputElement>(null);

  // Client errors (blur/typing/submit) and the last attempt's server errors.
  const [clientErrors, setClientErrors] = useState<LoginFieldErrors>({});
  const [serverErrors, setServerErrors] = useState<LoginFieldErrors>(state.fieldErrors ?? {});
  const [handledState, setHandledState] = useState(state);

  // A new Server Action result, handled once while rendering.
  if (state !== handledState) {
    setHandledState(state);
    setServerErrors(state.fieldErrors ?? {});
    setClientErrors({});
  }

  const identifierError = clientErrors.identifier ?? serverErrors.identifier;
  const passwordError   = clientErrors.password ?? serverErrors.password;

  // After a failed attempt: focus the first field with an error, else the password.
  useEffect(() => {
    if (state === initialState) return;
    if (state.fieldErrors?.identifier) identifierRef.current?.focus();
    else passwordRef.current?.focus();
  }, [state]);

  /**
   * Description: Check one field with the shared rules.
   * Input: The field and the current values of both inputs.
   * Output: That field's error message, or undefined.
   * Use case: Blur and typing validation.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function fieldError(field: Field): string | undefined {
    const errors = validateLoginFields({
      identifier: identifierRef.current?.value ?? "",
      password: passwordRef.current?.value ?? "",
    });
    return errors[field];
  }

  /**
   * Description: Store (or clear) one field's client error and drop its old server error.
   * Input: The field and its message (undefined when valid).
   * Output: Updated error state.
   * Use case: validateOnBlur and validateWhileTyping.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function setFieldError(field: Field, error: string | undefined) {
    setClientErrors((current) => ({ ...current, [field]: error }));
    setServerErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  }

  /**
   * Description: Validate a field when it loses focus (trims the identifier first).
   * Input: The field and its input element.
   * Output: The field's error shown or cleared.
   * Use case: onBlur of both inputs.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function validateOnBlur(field: Field, input: HTMLInputElement) {
    // Spaces around a username or email are meaningless: remove them in place.
    if (field === "identifier") input.value = input.value.trim();
    setFieldError(field, fieldError(field));
  }

  /**
   * Description: Re-validate a field while the visitor corrects it.
   * Input: The field.
   * Output: The error updates as soon as the value becomes valid.
   * Use case: onChange, only while the field shows an error.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function validateWhileTyping(field: Field) {
    const shown = field === "identifier" ? identifierError : passwordError;
    if (shown) setFieldError(field, fieldError(field));
  }

  /**
   * Description: Block an invalid sign-in before the request is sent.
   * Input: The submit event.
   * Output: Nothing for a valid form (the Server Action runs); otherwise the
   *   request is cancelled, errors are shown and the first invalid field is
   *   scrolled into view and focused.
   * Use case: The form's onSubmit.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const identifierInput = identifierRef.current;
    const passwordInput   = passwordRef.current;
    if (!identifierInput || !passwordInput) return;

    // Step 1: the identifier never carries stray spaces.
    identifierInput.value = identifierInput.value.trim();

    // Step 2: both fields with the same rules as the server.
    const found = validateLoginFields({ identifier: identifierInput.value, password: passwordInput.value });
    if (!found.identifier && !found.password) {
      setClientErrors({});
      return;
    }

    // Step 3: invalid — do not send; show the errors and focus the first one.
    event.preventDefault();
    setClientErrors(found);
    setServerErrors({});
    const first        = found.identifier ? identifierInput : passwordInput;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    first.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    first.focus({ preventScroll: true });
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {state.formError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}
      {state.formNotice ? (
        <Alert role="status">
          <Info aria-hidden="true" />
          <AlertDescription>{state.formNotice}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor={identifierId}>
          Username or email <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        {/* Usernames and emails are sensitive: masked until the eye button reveals them. */}
        <SensitiveInput
          ref={identifierRef}
          id={identifierId}
          noun="username or email"
          name="identifier"
          autoComplete="username"
          maxLength={LOGIN_IDENTIFIER_MAX_LENGTH}
          defaultValue={state.identifier}
          autoFocus
          aria-required="true"
          hasError={Boolean(identifierError)}
          aria-describedby={identifierError ? identifierErrorId : undefined}
          placeholder="Enter your username or email"
          onBlur={(event) => validateOnBlur("identifier", event.currentTarget)}
          onChange={() => validateWhileTyping("identifier")}
          className="h-11 px-3.5 text-base"
        />
        {identifierError ? (
          <p id={identifierErrorId} className="text-sm text-destructive">
            {identifierError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={passwordId}>
          Password <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        <PasswordInput
          ref={passwordRef}
          id={passwordId}
          name="password"
          autoComplete="current-password"
          maxLength={WORKSPACE_PASSWORD_MAX_LENGTH}
          aria-required="true"
          aria-describedby={passwordError ? passwordErrorId : undefined}
          hasError={Boolean(passwordError)}
          placeholder="Enter your password"
          onBlur={(event) => validateOnBlur("password", event.currentTarget)}
          onChange={() => validateWhileTyping("password")}
          className="h-11 px-3.5 text-base"
        />
        {passwordError ? (
          <p id={passwordErrorId} className="text-sm text-destructive">
            {passwordError}
          </p>
        ) : null}
      </div>

      {/* Disabled while signing in, so a second click cannot send a duplicate request. */}
      <Button type="submit" disabled={pending} aria-busy={pending || undefined} className="mt-1 h-11 w-full">
        {pending ? <Spinner /> : null}
        {pending ? "Signing in…" : "Log in"}
        {pending ? null : <ArrowRight aria-hidden="true" />}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        New artist or label?{" "}
        <Link href="/customer/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
