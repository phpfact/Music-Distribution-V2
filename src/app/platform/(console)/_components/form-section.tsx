import { useId, type ReactNode } from "react";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type FormSectionProps = {
  /** Position in the form, shown in the badge (1, 2, 3…). */
  number: number;
  title: ReactNode;
  description?: ReactNode;
  /** Something on the right of the header, e.g. a "Regenerate" button. */
  action?: ReactNode;
  children: ReactNode;
};

/** One numbered card of a long form, labelled by its own title.  * Input: component props or field identifiers. Output: themed UI or ARIA attributes.
 * Use case: preserve shared application semantics across the shadcn migration.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function FormSection({
  number,
  title,
  description,
  action,
  children,
}: FormSectionProps) {
  const titleId = useId();

  return (
    <section aria-labelledby={titleId}>
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-3">
            {/* The number is ordering for the eye; the title alone names the section. */}
            <Badge
              variant="outline"
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-primary"
            >
              {number}
            </Badge>
            <div className="min-w-0">
              <h2
                id={titleId}
                className="text-base font-semibold break-words text-fg"
              >
                {title}
              </h2>
              {description ? (
                <p className="mt-1 text-sm text-fg-muted">{description}</p>
              ) : null}
            </div>
          </div>
          {action ? <div className="shrink-0 sm:ml-auto">{action}</div> : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-5 p-5">
          {children}
        </CardContent>
      </Card>
    </section>
  );
}
