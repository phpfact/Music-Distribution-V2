import { useId, type ReactNode } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Icon, type IconName } from "./icons";

type FormSectionProps = {
  /** The section's symbol, shown in a tinted tile before the title. */
  icon: IconName;
  title: ReactNode;
  description?: ReactNode;
  /**
   * Something on the right of the header, e.g. the section's
   * Auto-Generate / Manual switch. Wraps below the title on narrow screens.
   */
  action?: ReactNode;
  children: ReactNode;
};

/**
 * Description: One card of a long form, labelled by its own title.
 * Input: An icon, a title, an optional description and header action, and the section's fields.
 * Output: A `<section>` named by its heading, with a header row and a padded body.
 * Use case: Every section of the create and edit tenant forms, so they share one look.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function FormSection({
  icon,
  title,
  description,
  action,
  children,
}: FormSectionProps) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId}>
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            {/* Decorative: the title alone names the section. */}
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-primary"
            >
              <Icon name={icon} className="size-[18px]" />
            </span>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-base font-semibold break-words text-fg"
              >
                {title}
              </h2>
              {description ? (
                <p className="mt-0.5 text-sm text-fg-muted">{description}</p>
              ) : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-5 p-5">
          {children}
        </CardContent>
      </Card>
    </section>
  );
}
