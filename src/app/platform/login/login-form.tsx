"use client";

import { type FormEvent, useActionState, useEffect, useId, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Icon } from "../(console)/_components/icons";
import { PasswordInput } from "../(console)/_components/password-input";
import { SensitiveInput } from "../(console)/_components/sensitive-input";
import { Spinner } from "../(console)/_components/spinner";
import { loginAction, type LoginFormState } from "./actions";
import {
  type LoginClientErrors,
  type LoginField,
  trimUsername,
  validateLoginField,
  validateLoginForm,
} from "./login-model";

const initialState: LoginFormState = { username: "" };

const FIELD_ERROR_CLASS = "text-sm text-destructive";

type LoginFormProps = { usernameMaxLength: number; passwordMaxLength: number };

/**
 * Description: Render the platform sign-in form with client and server validation.
 * Input: The server-owned username and password maximum lengths.
 * Output: The native Server Action form (works without JavaScript) with a
 *   masked username (eye button), a password with show/hide, errors under each
 *   field, a form-level alert and a pending "Signing in…" button.
 * Use case: /platform/login. With JavaScript, fields are validated on blur and
 *   while correcting an error; an invalid form is not sent and the first
 *   invalid field is scrolled into view and focused. The server validates again.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function LoginForm({ usernameMaxLength, passwordMaxLength }: LoginFormProps) {
  // Passing the Server Action to the form keeps it working without JavaScript.
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const limits = { usernameMaxLength, passwordMaxLength };

  const id              = useId();
  const usernameId      = `${id}-username`;
  const usernameErrorId = `${id}-username-error`;
  const passwordId      = `${id}-password`;
  const passwordErrorId = `${id}-password-error`;

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // Client errors come from the shared rules (blur, typing, submit); server
  // errors from the last attempt. A server error stays until its field is edited.
  const [clientErrors, setClientErrors] = useState<LoginClientErrors>({});
  const [serverErrors, setServerErrors] = useState<LoginClientErrors>(state.fieldErrors ?? {});
  const [handledState, setHandledState] = useState(state);

  // A new result of the Server Action, handled once while rendering (the
  // pattern React recommends over an effect that sets state).
  if (state !== handledState) {
    setHandledState(state);
    setServerErrors(state.fieldErrors ?? {});
    setClientErrors({});
  }

  const usernameError = clientErrors.username ?? serverErrors.username;
  const passwordError = clientErrors.password ?? serverErrors.password;

  // Each failed attempt returns a new state object. Focus goes to the first
  // field with an error, otherwise to the password so it can be retyped.
  useEffect(() => {
    if (state === initialState) return;
    if (state.fieldErrors?.username) usernameRef.current?.focus();
    else passwordRef.current?.focus();
  }, [state]);

  /**
   * Description: Store (or clear) the client error of one field.
   * Input: The field and its error message (undefined when valid).
   * Output: Updated client errors; the field's server error is dismissed.
   * Use case: Blur and typing validation.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function setFieldError(field: LoginField, error: string | undefined) {
    setClientErrors((current) => {
      const next = { ...current };
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
    // The owner has acted on this field: the old server message no longer applies.
    setServerErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  /**
   * Description: Validate a field when the owner leaves it (trims the username first).
   * Input: The field and its input element.
   * Output: The field's error shown or cleared.
   * Use case: onBlur of both inputs (real-time validation).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function validateOnBlur(field: LoginField, input: HTMLInputElement) {
    // Spaces around a username are meaningless: remove them in place.
    if (field === "username") input.value = trimUsername(input.value);
    setFieldError(field, validateLoginField(field, input.value, limits));
  }

  /**
   * Description: Re-validate a field while the owner corrects it.
   * Input: The field and its current value.
   * Output: The error updates as soon as the value becomes valid (or changes).
   * Use case: onChange of both inputs, only once the field shows an error.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function validateWhileTyping(field: LoginField, value: string) {
    const shownError = field === "username" ? usernameError : passwordError;
    if (!shownError) return;
    setFieldError(field, validateLoginField(field, value, limits));
  }

  /**
   * Description: Block an invalid sign-in before the request is sent.
   * Input: The submit event.
   * Output: For a valid form nothing (the Server Action runs); otherwise the
   *   request is cancelled, errors are shown, and the first invalid field is
   *   scrolled into view and focused.
   * Use case: The form's onSubmit (runs before the Server Action).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const usernameInput = usernameRef.current;
    const passwordInput = passwordRef.current;
    if (!usernameInput || !passwordInput) return;

    // Step 1: the submitted username never carries stray spaces.
    usernameInput.value = trimUsername(usernameInput.value);

    // Step 2: check both fields with the same rules as on blur.
    const found = validateLoginForm(
      { username: usernameInput.value, password: passwordInput.value },
      limits,
    );
    if (Object.keys(found).length === 0) {
      setClientErrors({});
      return;
    }

    // Step 3: invalid: do not send; show the errors under their fields.
    event.preventDefault();
    setClientErrors(found);
    setServerErrors({});

    // Step 4: bring the first invalid field into view and focus it.
    const first        = found.username ? usernameInput : passwordInput;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    first.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    first.focus({ preventScroll: true });
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      {state.formError ? (
        <Alert variant="destructive">
          <Icon name="alert-triangle" className="size-4" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor={usernameId}>
          Username <span aria-hidden="true" className="text-destructive">*</span>
        </Label>
        {/* Usernames are sensitive: masked until the eye button reveals them. */}
        <SensitiveInput
          ref={usernameRef}
          id={usernameId}
          noun="username"
          name="username"
          autoComplete="username"
          maxLength={usernameMaxLength}
          defaultValue={state.username}
          autoFocus
          aria-required="true"
          hasError={Boolean(usernameError)}
          aria-describedby={usernameError ? usernameErrorId : undefined}
          placeholder="Enter your username"
          onBlur={(event) => validateOnBlur("username", event.currentTarget)}
          onChange={(event) => validateWhileTyping("username", event.currentTarget.value)}
          className="h-12 px-3.5 text-base"
        />
        {usernameError ? (
          <p id={usernameErrorId} className={FIELD_ERROR_CLASS}>
            {usernameError}
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
          maxLength={passwordMaxLength}
          aria-required="true"
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? passwordErrorId : undefined}
          hasError={Boolean(passwordError)}
          placeholder="Enter your password"
          onBlur={(event) => validateOnBlur("password", event.currentTarget)}
          onChange={(event) => validateWhileTyping("password", event.currentTarget.value)}
          className="h-12 px-3.5 text-base"
        />
        {passwordError ? (
          <p id={passwordErrorId} className={FIELD_ERROR_CLASS}>
            {passwordError}
          </p>
        ) : null}
      </div>

      {/* Disabled while signing in, so a second click cannot send a duplicate request. */}
      <Button
        type="submit"
        disabled={pending}
        className="mt-1 h-12 w-full"
      >
        {pending ? <Spinner /> : null}
        {pending ? "Signing in…" : "Sign in"}
        {pending ? null : <Icon name="arrow-right" className="size-4" />}
      </Button>
    </form>
  );
}
