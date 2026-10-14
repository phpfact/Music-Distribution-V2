"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Icon } from "../(console)/_components/icons";
import { Spinner } from "../(console)/_components/spinner";
import { FOCUS_RING } from "../(console)/_components/styles";
import { buttonClass, inputClass } from "../(console)/_components/ui";
import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = { username: "" };

const FIELD_ERROR_CLASS = "text-sm text-red-600 dark:text-red-400";

type LoginFormProps = { usernameMaxLength: number; passwordMaxLength: number };

export function LoginForm({ usernameMaxLength, passwordMaxLength }: LoginFormProps) {
  // Passing the Server Action to the form keeps it working without JavaScript.
  const [state, formAction, pending] = useActionState(loginAction, initialState);
  const [passwordVisible, setPasswordVisible] = useState(false);

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
        <div
          role="alert"
          className="rounded-lg border border-red-600/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-400"
        >
          {state.formError}
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <label htmlFor={usernameId} className="text-sm font-medium">
          Username
        </label>
        <input
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
          aria-invalid={usernameError ? true : undefined}
          aria-describedby={usernameError ? usernameErrorId : undefined}
          placeholder="Enter your username"
          className={inputClass(Boolean(usernameError), "h-12 px-3.5 text-base")}
        />
        {usernameError ? (
          <p id={usernameErrorId} className={FIELD_ERROR_CLASS}>
            {usernameError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={passwordId} className="text-sm font-medium">
          Password
        </label>
        <div className="relative">
          <input
            ref={passwordRef}
            id={passwordId}
            name="password"
            type={passwordVisible ? "text" : "password"}
            autoComplete="current-password"
            maxLength={passwordMaxLength}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? passwordErrorId : undefined}
            placeholder="Enter your password"
            // Right padding keeps the text clear of the toggle.
            className={inputClass(Boolean(passwordError), "h-12 px-3.5 pr-16 text-base")}
          />
          <button
            type="button"
            aria-pressed={passwordVisible}
            aria-controls={passwordId}
            onClick={() => setPasswordVisible((visible) => !visible)}
            className={`absolute inset-y-1 right-1 rounded-md px-3 text-xs font-semibold text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg ${FOCUS_RING}`}
          >
            {passwordVisible ? "Hide" : "Show"}
          </button>
        </div>
        {passwordError ? (
          <p id={passwordErrorId} className={FIELD_ERROR_CLASS}>
            {passwordError}
          </p>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={pending}
        className={`${buttonClass("primary")} mt-1 h-12 w-full`}
      >
        {pending ? <Spinner /> : null}
        {pending ? "Signing in…" : "Sign in"}
        {pending ? null : <Icon name="arrow-right" className="size-4" />}
      </button>
    </form>
  );
}
