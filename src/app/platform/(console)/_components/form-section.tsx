import { useId, type ReactNode } from "react";

type FormSectionProps = {
  /** Position in the form, shown in the badge (1, 2, 3…). */
  number: number;
  title: ReactNode;
  description?: ReactNode;
  /** Something on the right of the header, e.g. a "Regenerate" button. */
  action?: ReactNode;
  children: ReactNode;
};

/** One numbered card of a long form, labelled by its own title. */
export function FormSection({ number, title, description, action, children }: FormSectionProps) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="rounded-xl border border-line bg-surface">
      <div className="flex flex-col gap-3 border-b border-line p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          {/* The number is ordering for the eye; the title alone names the section. */}
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
          >
            {number}
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold break-words text-fg">
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0 sm:ml-auto">{action}</div> : null}
      </div>
      <div className="flex flex-col gap-5 p-5">{children}</div>
    </section>
  );
}
