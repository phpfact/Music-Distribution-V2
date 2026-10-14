"use client";

import { useRouter } from "next/navigation";
import { useId, useLayoutEffect, useRef, useState, useTransition, type MouseEvent } from "react";
import { MASTER_PASSWORD_MAX_LENGTH, validateMasterPassword } from "@/lib/tenants/rules";
import { ConfirmDialog } from "../../../_components/confirm-dialog";
import { CopyButton } from "../../../_components/copy-button";
import { errorId, Field } from "../../../_components/field";
import { Icon } from "../../../_components/icons";
import { PasswordInput } from "../../../_components/password-input";
import { buttonClass } from "../../../_components/ui";
import { useTenantFlash } from "../../_components/tenant-flash";
import type { ResetMasterPasswordActionResult } from "../../action-types";
import { resetMasterPasswordAction } from "../../manage-actions";
import { PasswordChecklist } from "../../new/password-checklist";

type Mode = "auto" | "manual";

const FAILED = "The action could not be completed. Try again shortly.";
const SUCCESS = "Master password reset. The tenant admin signs in with the new password.";

const MODES: { value: Mode; label: string; description: string }[] = [
  { value: "auto", label: "Auto generate", description: "A strong password is generated and shown once." },
  { value: "manual", label: "Manual", description: "You type the new password." },
];

type ResetMasterPasswordProps = { tenantId: string; tenantName: string; username: string };

/**
 * "Reset master password" on the Admin login card (§8.5, §9.4): Auto
 * generate or Manual. A generated password is shown once in a result view and
 * dropped from state when that view closes.
 */
export function ResetMasterPassword({ tenantId, tenantName, username }: ResetMasterPasswordProps) {
  const router = useRouter();
  const flash = useTenantFlash();
  const uid = useId();
  const passwordId = `${uid}-password`;
  const checklistId = `${uid}-checklist`;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("auto");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openDialog() {
    setMode("auto");
    setPassword("");
    setPasswordError(null);
    setError(null);
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
    setPassword("");
  }

  function confirm() {
    if (pending) return;
    setError(null);
    let input: { mode: "auto" } | { mode: "manual"; password: string } = { mode: "auto" };
    if (mode === "manual") {
      const checked = validateMasterPassword(password, username);
      if (!checked.ok) {
        setPasswordError(checked.error);
        document.getElementById(passwordId)?.focus();
        return;
      }
      input = { mode: "manual", password };
    }
    startTransition(async () => {
      let result: ResetMasterPasswordActionResult;
      try {
        result = await resetMasterPasswordAction(tenantId, input);
      } catch {
        setError(FAILED);
        return;
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      setPassword("");
      if (result.generatedPassword) setGenerated(result.generatedPassword);
      flash.show(SUCCESS);
      router.refresh();
    });
  }

  return (
    <>
      <button type="button" onClick={openDialog} className={buttonClass("secondary", "sm")}>
        <Icon name="key-round" className="size-4" />
        Reset master password
      </button>

      <ConfirmDialog
        open={open}
        onClose={close}
        pending={pending}
        error={error}
        title={`Reset the master password of ${tenantName}?`}
        description="The tenant admin signs in with the new password from now on. The old one stops working."
        confirmLabel="Reset password"
        onConfirm={confirm}
      >
        <fieldset className="flex flex-col gap-3" disabled={pending}>
          <legend className="mb-2 text-sm font-medium text-fg">New password</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {MODES.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-line p-3 transition-colors hover:bg-surface-2 has-checked:border-accent has-checked:bg-accent-soft has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent"
              >
                <input
                  type="radio"
                  name={`${uid}-mode`}
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => {
                    setMode(option.value);
                    setPasswordError(null);
                  }}
                  className="mt-0.5 size-4 shrink-0 accent-accent focus-visible:outline-none"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-fg-muted">{option.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === "manual" ? (
          <Field label="Master password" htmlFor={passwordId} required error={passwordError}>
            <PasswordInput
              id={passwordId}
              value={password}
              maxLength={MASTER_PASSWORD_MAX_LENGTH}
              readOnly={pending}
              hasError={Boolean(passwordError)}
              onChange={(event) => {
                setPassword(event.target.value);
                if (passwordError) setPasswordError(null);
              }}
              aria-invalid={passwordError ? true : undefined}
              aria-describedby={[checklistId, passwordError ? errorId(passwordId) : null]
                .filter(Boolean)
                .join(" ")}
            />
            <PasswordChecklist id={checklistId} password={password} username={username} />
          </Field>
        ) : null}
      </ConfirmDialog>

      <GeneratedPasswordDialog password={generated} onDone={() => setGenerated(null)} />
    </>
  );
}

/**
 * The result view of an Auto reset: the password once, with a copy button.
 * "Done" (or Escape) drops it from state. A click on the backdrop does not
 * close it, so the password is not lost by accident.
 */
function GeneratedPasswordDialog({ password, onDone }: { password: string | null; onDone: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const uid = useId();
  const open = password !== null;

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      doneRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  function onDialogClick(event: MouseEvent<HTMLDialogElement>) {
    // Clicks inside the content box are not on the dialog element itself.
    if (event.target === event.currentTarget) doneRef.current?.focus();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onDone}
      onClick={onDialogClick}
      aria-labelledby={`${uid}-title`}
      aria-describedby={`${uid}-description`}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-fg shadow-xl shadow-black/20 backdrop:bg-black/60"
    >
      {password !== null ? (
        <div className="flex flex-col gap-5 p-6">
          <div className="flex flex-col gap-2">
            <h2 id={`${uid}-title`} className="text-lg font-semibold">
              New master password
            </h2>
            <p id={`${uid}-description`} className="text-sm text-fg-muted">
              Copy it now. It won&apos;t be shown again.
            </p>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-amber-600/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 font-mono text-sm break-all text-fg">{password}</code>
            <CopyButton value={password} label="Copy master password" />
          </div>
          <div className="flex justify-end">
            <button
              ref={doneRef}
              type="button"
              onClick={onDone}
              className={`${buttonClass("primary")} w-full sm:w-auto`}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
