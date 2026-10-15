import type { ReactNode } from "react";

type FormActionsProps = {
  /** Short guidance on the left, e.g. the required-field legend (hidden on phones). */
  note?: ReactNode;
  /** The buttons, secondary first, primary last. */
  children: ReactNode;
};

/**
 * Description: The action bar at the end of a long form, kept in view while scrolling.
 * Input: An optional note and the form's buttons.
 * Output: A sticky card at the bottom of the scroll area; it settles at the end of the form.
 * Use case: Create and edit tenant forms, so "Cancel" and the submit button are
 *   always reachable without scrolling to the end.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function FormActions({ note, children }: FormActionsProps) {
  return (
    <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80 sm:px-4">
      {note ? (
        <p className="hidden min-w-0 text-xs text-fg-muted sm:block">{note}</p>
      ) : null}
      <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/**
 * Description: The standard legend for required fields, shown in FormActions.
 * Input: None.
 * Output: "Fields marked * are required." with the asterisk in the destructive colour.
 * Use case: Long forms whose required markers are spread over several cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function RequiredLegend() {
  return (
    <>
      Fields marked <span className="text-destructive">*</span> are required.
    </>
  );
}
