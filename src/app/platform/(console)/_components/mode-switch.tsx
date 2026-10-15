"use client";

import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Icon, type IconName } from "./icons";

/** How a section's values are produced. */
export type SwitchMode = "auto" | "manual";

const OPTIONS: { value: SwitchMode; label: string; icon: IconName }[] = [
  { value: "auto", label: "Auto-Generate", icon: "wand" },
  { value: "manual", label: "Manual", icon: "pencil" },
];

type ModeSwitchProps = {
  /**
   * The id of the radio group. The options get `<id>-auto` and `<id>-manual`;
   * focusing the group's checked option is how error links reach a section.
   */
  id: string;
  value: SwitchMode;
  onChange: (next: SwitchMode) => void;
  /** Accessible name of the group, e.g. "Tenant admin login values". */
  label: string;
  /** Ids of hint or error text read out with the group. */
  describedBy?: string;
  disabled?: boolean;
};

/**
 * Description: A compact segmented "Auto-Generate | Manual" switch for one form section.
 * Input: The group id, current mode, change callback, accessible label and optional description ids.
 * Output: A Radix radio group styled as a segmented control (arrow keys move between the two options).
 * Use case: The header of each create-tenant section that has generated values,
 *   so every section decides on its own whether its values are generated or typed.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function ModeSwitch({
  id,
  value,
  onChange,
  label,
  describedBy,
  disabled,
}: ModeSwitchProps) {
  return (
    <RadioGroup
      id={id}
      value={value}
      onValueChange={(next) => onChange(next as SwitchMode)}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      // A pill track holding two segments; the checked segment is raised.
      className="inline-flex gap-0.5 rounded-lg border border-border bg-muted p-0.5"
    >
      {OPTIONS.map((option) => {
        const optionId = `${id}-${option.value}`;
        return (
          <Label
            key={option.value}
            htmlFor={optionId}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[[data-state=checked]]:bg-background has-[[data-state=checked]]:text-foreground has-[[data-state=checked]]:shadow-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
          >
            {/* The radio stays in the tab order but is drawn by the label around it. */}
            <RadioGroupItem
              id={optionId}
              value={option.value}
              className="sr-only"
            />
            <Icon
              name={option.icon}
              className={`size-3.5 shrink-0 ${value === option.value ? "text-primary" : ""}`}
            />
            {option.label}
          </Label>
        );
      })}
    </RadioGroup>
  );
}
