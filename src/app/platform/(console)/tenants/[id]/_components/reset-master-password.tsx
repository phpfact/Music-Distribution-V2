"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  MASTER_PASSWORD_MAX_LENGTH,
  validateMasterPassword,
} from "@/lib/tenants/rules";
import { ConfirmDialog } from "../../../_components/confirm-dialog";
import { SensitiveValue } from "../../../_components/sensitive-value";
import { errorId, Field } from "../../../_components/field";
import { Icon } from "../../../_components/icons";
import { PasswordInput } from "../../../_components/password-input";
import { useTenantFlash } from "../../_components/tenant-flash";
import type { ResetMasterPasswordActionResult } from "../../action-types";
import { resetMasterPasswordAction } from "../../manage-actions";
import { PasswordChecklist } from "../../new/password-checklist";

type Mode = "auto" | "manual";

const FAILED = "The action could not be completed. Try again shortly.";
const SUCCESS =
  "Master password reset. The tenant admin signs in with the new password.";

const MODES: { value: Mode; label: string; description: string }[] = [
  {
    value: "auto",
    label: "Auto generate",
    description: "A strong password is generated and shown once.",
  },
  {
    value: "manual",
    label: "Manual",
    description: "You type the new password.",
  },
];

type ResetMasterPasswordProps = {
  tenantId: string;
  tenantName: string;
  username: string;
};

/**
 * "Reset master password" on the Admin login card (§8.5, §9.4): Auto
 * generate or Manual. A generated password is shown once in a result view and
 * dropped from state when that view closes.
 *
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export function ResetMasterPassword({
  tenantId,
  tenantName,
  username,
}: ResetMasterPasswordProps) {
  const router = useRouter();
  const flash = useTenantFlash();
  const uid = useId();
  const passwordId = `${uid}-password`;
  const checklistId = `${uid}-checklist`;
  const triggerRef = useRef<HTMLButtonElement>(null);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("auto");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /**
   * Description: Prepare a fresh credential confirmation with old errors and secrets cleared.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function openDialog() {
    setMode("auto");
    setPassword("");
    setPasswordError(null);
    setError(null);
    setOpen(true);
  }

  /**
   * Description: Close an idle credential confirmation and clear its transient secret.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function close() {
    if (pending) return;
    setOpen(false);
    setPassword("");
  }

  /**
   * Description: Validate the selected credential operation and run its existing Server Action.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function confirm() {
    if (pending) return;
    setError(null);
    let input: { mode: "auto" } | { mode: "manual"; password: string } = {
      mode: "auto",
    };
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
      <Button
        ref={triggerRef}
        type="button"
        onClick={openDialog}
        variant="outline"
        size="sm"
      >
        <Icon name="key-round" className="size-4" />
        Reset master password
      </Button>

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
          <legend className="mb-2 text-sm font-medium text-fg">
            New password
          </legend>
          <RadioGroup
            name={`${uid}-mode`}
            value={mode}
            disabled={pending}
            onValueChange={(value) => {
              setMode(value as Mode);
              setPasswordError(null);
            }}
            aria-label="New password"
            className="grid gap-2 sm:grid-cols-2"
          >
            {MODES.map((option) => (
              <Label
                key={option.value}
                htmlFor={`${uid}-${option.value}`}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10"
              >
                <RadioGroupItem
                  id={`${uid}-${option.value}`}
                  value={option.value}
                  className="mt-0.5 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </Label>
            ))}
          </RadioGroup>
        </fieldset>

        {mode === "manual" ? (
          <Field
            label="Master password"
            htmlFor={passwordId}
            required
            error={passwordError}
          >
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
              aria-describedby={[
                checklistId,
                passwordError ? errorId(passwordId) : null,
              ]
                .filter(Boolean)
                .join(" ")}
            />
            <PasswordChecklist
              id={checklistId}
              password={password}
              username={username}
            />
          </Field>
        ) : null}
      </ConfirmDialog>

      <GeneratedPasswordDialog
        password={generated}
        onDone={() => setGenerated(null)}
        onRestoreFocus={() => triggerRef.current?.focus()}
      />
    </>
  );
}

/**
 * Description: Show a newly generated master password once in a protected result dialog.
 * Input: The transient password, close callback and initiating-control focus callback.
 * Output: An accessible shadcn dialog with copy and acknowledgement controls.
 * Use case: A successful automatically generated tenant master-password reset.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function GeneratedPasswordDialog({
  password,
  onDone,
  onRestoreFocus,
}: {
  password: string | null;
  onDone: () => void;
  onRestoreFocus: () => void;
}) {
  const doneRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={password !== null}
      onOpenChange={(open) => {
        if (!open) onDone();
      }}
    >
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          doneRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
        // Outside clicks must not discard the only copy of the generated secret.
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>New master password</DialogTitle>
          <DialogDescription>
            Copy it now. It won&apos;t be shown again.
          </DialogDescription>
        </DialogHeader>
        {/* Masked until the eye button is used; Copy works either way. */}
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
          {password !== null ? (
            <SensitiveValue
              value={password}
              noun="master password"
              copyLabel="Copy master password"
            />
          ) : null}
        </div>
        <DialogFooter>
          <Button
            ref={doneRef}
            type="button"
            onClick={onDone}
            className="w-full sm:w-auto"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
