"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPE_OPTIONS } from "@/lib/workspace/rules";

type AccountTypeFieldProps = {
  /** The DOM id of the radio group (its label is `<id>-label`, its error `<id>-error`). */
  id: string;
  /** The FormData key. */
  name: string;
  /** The chosen type ("" while nothing is chosen). */
  value: string;
  onValueChange: (value: string) => void;
  /** The message shown under the choices (also marks the group invalid). */
  error?: string;
  /** Extra classes of the options grid, e.g. "md:grid-cols-3". */
  className?: string;
};

/**
 * Description: The required "Account type" choice of a customer (Artist, Label, White Label).
 * Input: See AccountTypeFieldProps: id, form name, value, change handler,
 *   optional error and grid classes.
 * Output: A label with the red required asterisk, one card-style radio per
 *   type (label + description, the chosen one highlighted with theme tokens)
 *   and the error text under the choices, wired with ARIA (labelledby,
 *   required, invalid, describedby).
 * Use case: The tenant's "Add customer" form (src/components/customers/customer-form.tsx).
 *   The same options as the sign-up and Sub-Customer forms (ACCOUNT_TYPE_OPTIONS).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function AccountTypeField({ id, name, value, onValueChange, error, className }: AccountTypeFieldProps) {
  const labelId = `${id}-label`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <Label id={labelId}>
        Account type
        <span aria-hidden="true" className="ml-0.5 text-destructive">
          *
        </span>
        <span className="sr-only"> (required)</span>
      </Label>
      <RadioGroup
        id={id}
        name={name}
        value={value}
        onValueChange={onValueChange}
        aria-labelledby={labelId}
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn("grid gap-2", className)}
      >
        {ACCOUNT_TYPE_OPTIONS.map((option) => {
          const optionId = `${id}-${option.value}`;
          return (
            <Label
              key={option.value}
              htmlFor={optionId}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-accent/50",
                value === option.value ? "border-primary bg-primary/5" : "border-border",
              )}
            >
              <RadioGroupItem id={optionId} value={option.value} className="mt-0.5" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs leading-5 text-muted-foreground">{option.description}</span>
              </span>
            </Label>
          );
        })}
      </RadioGroup>
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
