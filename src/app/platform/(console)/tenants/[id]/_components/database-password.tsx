"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  DATABASE_PASSWORD_MAX_LENGTH,
  validateExistingDatabasePassword,
} from "@/lib/tenants/rules";
import { ConfirmDialog } from "../../../_components/confirm-dialog";
import { describedBy, Field } from "../../../_components/field";
import { Icon } from "../../../_components/icons";
import { PasswordInput } from "../../../_components/password-input";
import { useTenantFlash } from "../../_components/tenant-flash";
import type { DatabasePasswordActionResult } from "../../action-types";
import {
  rotateDatabasePasswordAction,
  updateDatabasePasswordAction,
} from "../../manage-actions";

const FAILED = "The action could not be completed. Try again shortly.";

type DatabasePasswordProps = {
  tenantId: string;
  tenantName: string;
  /**
   * provisioned → "Rotate password"; existing → "Update password".
   */
  mode: "provisioned" | "existing";
};

/**
 * Description: Render the Database card's password action (§8.5, §9.4).
 * Input: The tenant id and name and the database mode.
 * Output: "Rotate password" (new database) or "Update password" (existing database)
 *   with its confirmation; the password itself is never shown.
 * Use case: The details page's Database Information card.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function DatabasePassword({
  tenantId,
  tenantName,
  mode,
}: DatabasePasswordProps) {
  const router     = useRouter();
  const flash      = useTenantFlash();
  const uid        = useId();
  const passwordId = `${uid}-password`;

  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rotate = mode === "provisioned";

  /**
   * Description: Open a fresh password confirmation.
   * Input: None.
   * Output: The dialog opens with the old password, errors and failure cleared.
   * Use case: The Rotate/Update password button.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function openDialog() {
    setPassword("");
    setPasswordError(null);
    setError(null);
    setOpen(true);
  }

  /**
   * Description: Close the confirmation unless the action runs.
   * Input: None.
   * Output: The dialog closes and the typed password is cleared.
   * Use case: Cancel, Escape and outside clicks.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function close() {
    if (pending) return;
    setOpen(false);
    setPassword("");
  }

  /**
   * Description: Validate and run the password change.
   * Input: None (reads the typed password).
   * Output: Field error (Update), a failure message in the dialog, or success: the
   *   dialog closes, the flash notice reports it and the page data refreshes.
   * Use case: The confirmation's confirm button.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function confirm() {
    if (pending) return;
    setError(null);
    if (!rotate) {
      const checked = validateExistingDatabasePassword(password);
      if (!checked.ok) {
        setPasswordError(checked.error);
        document.getElementById(passwordId)?.focus();
        return;
      }
    }
    const value = password;
    startTransition(async () => {
      let result: DatabasePasswordActionResult;
      try {
        result = rotate
          ? await rotateDatabasePasswordAction(tenantId)
          : await updateDatabasePasswordAction(tenantId, value);
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
      flash.show(
        rotate ? "Database password rotated." : "Database password updated.",
      );
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" onClick={openDialog} variant="outline" size="sm">
        <Icon name={rotate ? "refresh-cw" : "key-round"} className="size-4" />
        {rotate ? "Rotate password" : "Update password"}
      </Button>

      {rotate ? (
        <ConfirmDialog
          open={open}
          onClose={close}
          pending={pending}
          error={error}
          title={`Rotate the database password of ${tenantName}?`}
          description="A new random password is generated, applied to the database login and stored encrypted. Connections using the old password stop working."
          confirmLabel="Rotate password"
          onConfirm={confirm}
        />
      ) : (
        <ConfirmDialog
          open={open}
          onClose={close}
          pending={pending}
          error={error}
          title={`Update the database password of ${tenantName}?`}
          description="Enter the password the database login uses now. The new password is tested against the database before it is saved."
          confirmLabel="Update password"
          onConfirm={confirm}
        >
          <Field
            label="Database password"
            htmlFor={passwordId}
            required
            error={passwordError}
          >
            <PasswordInput
              id={passwordId}
              value={password}
              maxLength={DATABASE_PASSWORD_MAX_LENGTH}
              autoComplete="off"
              readOnly={pending}
              hasError={Boolean(passwordError)}
              onChange={(event) => {
                setPassword(event.target.value);
                if (passwordError) setPasswordError(null);
              }}
              {...describedBy(passwordId, { error: passwordError })}
            />
          </Field>
        </ConfirmDialog>
      )}
    </>
  );
}
