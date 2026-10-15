"use client";

import { useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "./notice";
import { Spinner } from "./spinner";

type ReasonOptions = {
  label: string;
  hint?: string;
  maxLength: number;
  required: boolean;
};

type ConfirmDialogProps = {
  open: boolean;
  /** Called for every permitted close: Cancel, Escape, outside interaction. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  /** While true, the action runs: nothing dismisses or resubmits the dialog. */
  pending?: boolean;
  error?: ReactNode;
  /** Gets the trimmed reason when `reason` is set. */
  onConfirm: (reason?: string) => void;
  reason?: ReasonOptions;
  children?: ReactNode;
};

/**
 * Compose the shared confirmation flow with shadcn's accessible Dialog.
 * Input: caller-owned open, pending, error, and confirmation configuration.
 * Output: a themed modal with guarded dismissal and validated optional reason.
 * Use case: confirm tenant and Appearance changes without duplicating focus traps.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onClose, pending = false, description } = props;
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !pending) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        {...(description ? {} : { "aria-describedby": undefined })}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onEscapeKeyDown={(event) => { if (pending) event.preventDefault(); }}
        onInteractOutside={(event) => { if (pending) event.preventDefault(); }}
        onOpenAutoFocus={(event) => {
          // This controlled wrapper has no DialogTrigger. Save the caller's
          // focused control before selecting the safe initial field/button.
          returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          event.preventDefault();
          initialFocusRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
        }}
      >
        {/* Reset the reason only after closing, retaining drafts on failures. */}
        {open ? <DialogBody {...props} pending={pending} initialFocusRef={initialFocusRef} /> : null}
      </DialogContent>
    </Dialog>
  );
}

type DialogBodyProps = ConfirmDialogProps & {
  pending: boolean;
  initialFocusRef: RefObject<HTMLElement | null>;
};

/**
 * Render and validate the app-specific contents of a confirmation dialog.
 * Input: confirmation options and the ref selected for initial focus.
 * Output: a native form that sends a trimmed, length-checked reason to the caller.
 * Use case: retain failed-operation drafts and accessible reason feedback.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
function DialogBody({
  onClose,
  title,
  description,
  confirmLabel,
  confirmVariant = "primary",
  pending,
  error,
  onConfirm,
  reason,
  children,
  initialFocusRef,
}: DialogBodyProps) {
  const [reasonText, setReasonText] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const id = useId();
  const reasonId = `${id}-reason`;
  const reasonHintId = `${id}-reason-hint`;
  const reasonCountId = `${id}-reason-count`;
  const reasonErrorId = `${id}-reason-error`;

  /**
   * Validate the optional reason and dispatch one permitted confirmation.
   * Input: the native form submit event and current reason/pending state.
   * Output: validation feedback or the caller's confirmation callback.
   * Use case: block blank reasons and duplicate submits while work is pending.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15. Last modified: 2026-10-15.
   */
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if (!reason) {
      onConfirm();
      return;
    }

    const trimmed = reasonText.trim();
    if (reason.required && trimmed === "") {
      setReasonError(`Enter a ${reason.label.toLowerCase()} to continue.`);
      initialFocusRef.current?.focus();
      return;
    }
    if (trimmed.length > reason.maxLength) {
      setReasonError(`Use ${reason.maxLength} characters or fewer.`);
      initialFocusRef.current?.focus();
      return;
    }
    onConfirm(trimmed);
  }

  const reasonDescribedBy = [
    reason?.hint ? reasonHintId : null,
    reasonCountId,
    reasonError ? reasonErrorId : null,
  ].filter(Boolean).join(" ");

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle className="break-words">{title}</DialogTitle>
        {description ? <DialogDescription asChild><div>{description}</div></DialogDescription> : null}
      </DialogHeader>

      {children}

      {reason ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <Label htmlFor={reasonId}>
              {reason.label}
              {reason.required ? <><span aria-hidden="true" className="text-destructive">*</span><span className="sr-only"> (required)</span></> : null}
            </Label>
            <span id={reasonCountId} className="text-xs text-muted-foreground tabular-nums">
              {reasonText.length} / {reason.maxLength}<span className="sr-only"> characters</span>
            </span>
          </div>
          <Textarea
            ref={(element) => { initialFocusRef.current = element; }}
            id={reasonId}
            value={reasonText}
            maxLength={reason.maxLength}
            readOnly={pending}
            required={reason.required}
            onChange={(event) => {
              setReasonText(event.target.value);
              if (reasonError) setReasonError(null);
            }}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonDescribedBy}
          />
          {reason.hint ? <p id={reasonHintId} className="text-xs text-muted-foreground">{reason.hint}</p> : null}
          {reasonError ? <p id={reasonErrorId} role="alert" className="text-sm text-destructive">{reasonError}</p> : null}
        </div>
      ) : null}

      {error ? <Notice variant="error">{error}</Notice> : null}

      <DialogFooter className="gap-3">
        {/* aria-disabled retains focus while the caller is saving; handlers
            enforce the pending guard for mouse, keyboard, and form submits. */}
        <Button
          ref={(element) => { if (!reason) initialFocusRef.current = element; }}
          type="button"
          variant="outline"
          aria-disabled={pending || undefined}
          onClick={() => { if (!pending) onClose(); }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant={confirmVariant === "danger" ? "destructive" : "default"}
          aria-disabled={pending || undefined}
          aria-busy={pending || undefined}
        >
          {pending ? <Spinner /> : null}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
