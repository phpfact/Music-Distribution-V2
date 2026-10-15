"use client";

import { useActionState, useEffect, useId, useRef } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "../(console)/_components/icons";
import { PasswordInput } from "../(console)/_components/password-input";
import { Spinner } from "../(console)/_components/spinner";
import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = { username: "" };

const FIELD_ERROR_CLASS = "text-sm text-destructive";

type LoginFormProps = { usernameMaxLength: number; passwordMaxLength: number };

/**
 * Render the native Server Action sign-in form with shared shadcn/ui controls.
 * Input: server-owned username and password maximum lengths.
 * Output: accessible fields, retained username, validation feedback and pending state.
 * Use case: authenticate platform owners without changing authentication behavior.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function LoginForm({ usernameMaxLength, passwordMaxLength }: LoginFormProps) {
  // Passing the Server Action to the form keeps it working without JavaScript.
  const [state, formAction, pending] = useActionState(loginAction, initialState);

  const id = useId();
  const usernameId = `${id}-username`;
  const usernameErrorId = `${id}-username-error`;
  const passwordId = `${id}-password`;
  const passwordErrorId = `${id}-password-error`;

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const usernameError = state.fieldErrors?.username;
  const passwordError = state.fieldErrors?.password;

  // Each failed attempt returns a new state object. Focus goes to the first
  // field with an error, otherwise to the password so it can be retyped.
  useEffect(() => {
    if (state === initialState) return;
    if (state.fieldErrors?.username) usernameRef.current?.focus();
    else passwordRef.current?.focus();
  }, [state]);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-5">
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
        <Input
          ref={usernameRef}
          id={usernameId}
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={usernameMaxLength}
          defaultValue={state.username}
          autoFocus
          aria-required="true"
          aria-invalid={usernameError ? true : undefined}
          aria-describedby={usernameError ? usernameErrorId : undefined}
          placeholder="Enter your username"
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
          className="h-12 px-3.5 text-base"
        />
        {passwordError ? (
          <p id={passwordErrorId} className={FIELD_ERROR_CLASS}>
            {passwordError}
          </p>
        ) : null}
      </div>

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
