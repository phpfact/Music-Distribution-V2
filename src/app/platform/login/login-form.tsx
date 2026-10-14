"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { loginAction, type LoginFormState } from "./actions";

const initialState: LoginFormState = { username: "" };

const INPUT_CLASS =
  "h-11 w-full rounded-lg border bg-white px-3 text-base outline-none transition-colors focus-visible:border-emerald-600 focus-visible:ring-2 focus-visible:ring-emerald-600/30 dark:bg-zinc-900";
const INPUT_BORDER_CLASS = "border-zinc-300 dark:border-zinc-700";
const INPUT_ERROR_BORDER_CLASS = "border-red-600 dark:border-red-500";
const FIELD_ERROR_CLASS = "text-sm text-red-600 dark:text-red-400";

function inputClass(hasError: boolean, extra = ""): string {
  return [INPUT_CLASS, hasError ? INPUT_ERROR_BORDER_CLASS : INPUT_BORDER_CLASS, extra]
    .filter(Boolean)
    .join(" ");
}

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

      <div className="flex flex-col gap-1.5">
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
          className={inputClass(Boolean(usernameError))}
        />
        {usernameError ? (
          <p id={usernameErrorId} className={FIELD_ERROR_CLASS}>
            {usernameError}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
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
            // Right padding keeps the text clear of the toggle.
            className={inputClass(Boolean(passwordError), "pr-16")}
          />
          <button
            type="button"
            aria-pressed={passwordVisible}
            aria-controls={passwordId}
            onClick={() => setPasswordVisible((visible) => !visible)}
            className="absolute inset-y-0 right-0 rounded-r-lg px-3 text-sm font-medium text-zinc-600 hover:text-zinc-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600 dark:text-zinc-400 dark:hover:text-zinc-100"
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
        className="h-11 w-full rounded-lg bg-zinc-900 font-medium text-white transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
