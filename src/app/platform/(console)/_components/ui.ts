/**
 * Class helpers for the console's buttons and form controls, so every screen
 * draws them the same way and in both themes (the colours are the tokens of
 * globals.css, or Tailwind red with a `dark:` variant for danger and errors).
 */
import { FOCUS_RING } from "./styles";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md";

const BUTTON_BASE = `inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors motion-reduce:transition-none ${FOCUS_RING} disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60`;

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "border border-transparent bg-accent text-accent-fg shadow-sm hover:bg-accent/90",
  secondary: "border border-line bg-surface text-fg shadow-xs hover:bg-surface-2",
  // In dark mode a light red with dark text, as the accent does: white on a
  // mid red would fall below the contrast needed for small text.
  danger:
    "bg-red-600 text-white hover:bg-red-700 dark:bg-red-400 dark:text-red-950 dark:hover:bg-red-300",
  ghost: "text-fg-muted hover:bg-surface-2 hover:text-fg",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
};

/**
 * Classes for a `<button>` or a link drawn as one. A link can't be disabled,
 * so `aria-disabled="true"` on it gives the same look and blocks the pointer.
 */
export function buttonClass(variant: ButtonVariant, size: ButtonSize = "md"): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]}`;
}

/**
 * What every text control shares. The focus style is the login input's
 * (border + soft ring) in token colours; read-only fields (generated values)
 * look filled-in rather than editable.
 */
export const INPUT_BASE =
  "w-full rounded-lg border bg-surface px-3 text-sm text-fg shadow-xs outline-none transition-colors motion-reduce:transition-none placeholder:text-fg-subtle focus-visible:ring-2 read-only:bg-surface-2 read-only:text-fg-muted disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-fg-subtle disabled:opacity-70";

// An invalid field keeps its red border while focused, so the error stays visible.
const INPUT_BORDER = "border-line focus-visible:border-accent focus-visible:ring-accent/30";
const INPUT_ERROR_BORDER =
  "border-red-600 focus-visible:border-red-600 focus-visible:ring-red-600/30 dark:border-red-500 dark:focus-visible:border-red-500 dark:focus-visible:ring-red-500/30";

function controlClass(size: string, hasError: boolean, extra: string): string {
  return [INPUT_BASE, size, hasError ? INPUT_ERROR_BORDER : INPUT_BORDER, extra]
    .filter(Boolean)
    .join(" ");
}

/** A single-line `<input>`. */
export function inputClass(hasError: boolean, extra = ""): string {
  return controlClass("h-10", hasError, extra);
}

/** A native `<select>`: same box as an input, room on the right for the arrow. */
export function selectClass(hasError: boolean, extra = ""): string {
  return controlClass("h-10 pr-8", hasError, extra);
}

/** A `<textarea>`: grows vertically only, so the layout never widens. */
export function textareaClass(hasError: boolean, extra = ""): string {
  return controlClass("min-h-24 resize-y py-2", hasError, extra);
}
