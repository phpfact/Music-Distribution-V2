"use client";

import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { Notice } from "./notice";
import { Spinner } from "./spinner";
import { buttonClass, textareaClass } from "./ui";

type ReasonOptions = {
  label: string;
  hint?: string;
  maxLength: number;
  required: boolean;
};

type ConfirmDialogProps = {
  open: boolean;
  /** Called for every way of closing: Cancel, Escape, a click on the backdrop. */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  /** While true the action runs: nothing closes the dialog and Confirm is busy. */
  pending?: boolean;
  /** A failure from the action, shown inside the dialog. */
  error?: ReactNode;
  /** Gets the trimmed reason when `reason` is set. */
  onConfirm: (reason?: string) => void;
  /** Adds a reason textarea, e.g. for a suspension. */
  reason?: ReasonOptions;
  children?: ReactNode;
};

/**
 * A modal confirmation on the native `<dialog>`: `showModal()` gives the focus
 * trap, Escape and the inert page behind it. The caller owns `open`.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { open, onClose, pending = false } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const ids = { title: `${id}-title`, description: `${id}-description` };

  // Before paint: closing must not show one frame of an emptied dialog.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // React doesn't put `autofocus` in the DOM, so pick the starting point here.
      initialFocusRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Escape fires `cancel` first: refusing it keeps the dialog open mid-action.
  function onCancel(event: SyntheticEvent<HTMLDialogElement>) {
    if (pending) event.preventDefault();
  }

  // The content sits in an inner box, so a click on the dialog itself is on the backdrop.
  function onDialogClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === event.currentTarget && !pending) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onCancel}
      onClick={onDialogClick}
      aria-labelledby={ids.title}
      aria-describedby={props.description ? ids.description : undefined}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-fg shadow-xl shadow-black/20 backdrop:bg-black/60"
    >
      {/* Mounted only while open, so the reason starts empty every time. */}
      {open ? (
        <DialogBody {...props} pending={pending} ids={ids} initialFocusRef={initialFocusRef} />
      ) : null}
    </dialog>
  );
}

type DialogBodyProps = ConfirmDialogProps & {
  pending: boolean;
  ids: { title: string; description: string };
  initialFocusRef: RefObject<HTMLElement | null>;
};

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
  ids,
  initialFocusRef,
}: DialogBodyProps) {
  const [reasonText, setReasonText] = useState("");
  const [reasonError, setReasonError] = useState<string | null>(null);
  const id = useId();
  const reasonId = `${id}-reason`;
  const reasonHintId = `${id}-reason-hint`;
  const reasonCountId = `${id}-reason-count`;
  const reasonErrorId = `${id}-reason-error`;

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
    onConfirm(trimmed);
  }

  const reasonDescribedBy = [
    reason?.hint ? reasonHintId : null,
    reasonCountId,
    reasonError ? reasonErrorId : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5 p-6">
        <div className="flex flex-col gap-2">
          <h2 id={ids.title} className="text-lg font-semibold break-words">
            {title}
          </h2>
          {description ? (
            <div id={ids.description} className="text-sm text-fg-muted">
              {description}
            </div>
          ) : null}
        </div>

        {children}

        {reason ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor={reasonId} className="text-sm font-medium">
                {reason.label}
                {reason.required ? (
                  <>
                    <span aria-hidden="true" className="ml-0.5 text-red-600 dark:text-red-400">
                      *
                    </span>
                    <span className="sr-only"> (required)</span>
                  </>
                ) : null}
              </label>
              <span id={reasonCountId} className="text-xs text-fg-subtle tabular-nums">
                {reasonText.length} / {reason.maxLength}
                <span className="sr-only"> characters</span>
              </span>
            </div>
            <textarea
              ref={(element) => {
                initialFocusRef.current = element;
              }}
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
              className={textareaClass(Boolean(reasonError))}
            />
            {reason.hint ? (
              <p id={reasonHintId} className="text-xs text-fg-subtle">
                {reason.hint}
              </p>
            ) : null}
            {reasonError ? (
              <p id={reasonErrorId} className="text-sm text-red-600 dark:text-red-400">
                {reasonError}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? <Notice variant="error">{error}</Notice> : null}

        {/* aria-disabled rather than disabled while pending: focus stays on the button. */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            ref={(element) => {
              if (!reason) initialFocusRef.current = element;
            }}
            type="button"
            onClick={() => {
              if (!pending) onClose();
            }}
            aria-disabled={pending || undefined}
            className={buttonClass("secondary")}
          >
            Cancel
          </button>
          <button
            type="submit"
            aria-disabled={pending || undefined}
            className={buttonClass(confirmVariant)}
          >
            {pending ? <Spinner /> : null}
            {confirmLabel}
          </button>
        </div>
    </form>
  );
}
