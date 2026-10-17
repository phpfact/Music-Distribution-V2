"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { Icon } from "./icons";

type CountDetailsProps = {
  /**
   * The trigger's accessible name; say what opens, e.g.
   * "Active tenants: 5. Show the tenants behind this figure."
   */
  label: string;
  /** What the trigger shows: the figure, or a sentence containing it. */
  children: ReactNode;
  /** The dialog title, e.g. "Active tenants". */
  title: ReactNode;
  /** One sentence under the title. */
  description?: ReactNode;
  /** How the figure is calculated, in plain words (shown in a highlighted box). */
  calculation: ReactNode;
  /**
   * The supporting records. Mounted only while the dialog is open, so a list
   * that loads from the server loads on demand and again on every opening.
   */
  records: ReactNode;
  /** Classes for the trigger button (size and font of the figure). */
  className?: string;
};

/**
 * Description: Make a count clickable and show how it is calculated and which records it contains.
 * Input: The trigger's name and content, the dialog's title/description, the
 *   calculation text and the records element.
 * Output: A link-styled button; pressing it opens a themed dialog with the
 *   calculation and the records. A wide records table scrolls inside its own
 *   box instead of widening (and clipping) the dialog.
 * Use case: CLAUDE.md "Count Transparency": dashboard and tenant summary
 *   figures, the directory total, setup progress. Every count can be verified.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-17
 */
export function CountDetails({
  label,
  children,
  title,
  description,
  calculation,
  records,
  className,
}: CountDetailsProps) {
  // Closed by default; the records element mounts only while open.
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        type="button"
        variant="link"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cn(
          "h-auto gap-1.5 p-0 text-inherit underline decoration-dotted decoration-1 underline-offset-4 hover:decoration-solid",
          className,
        )}
      >
        {children}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="gap-5 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          {/* How the figure is made, so it can be checked against the records below. */}
          <div className="flex gap-3 rounded-lg border border-border bg-muted/50 p-3 text-sm">
            <Icon name="info" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-medium text-foreground">How this is calculated</p>
              <div className="mt-1 text-muted-foreground">{calculation}</div>
            </div>
          </div>

          {/* The dialog is a CSS grid: without min-w-0 a wide table would stretch the
              grid column past the dialog (clipped, whole dialog scrolling sideways);
              with it, the records' own overflow-x-auto box scrolls instead. */}
          <div className="min-w-0">{open ? records : null}</div>
        </DialogContent>
      </Dialog>
    </>
  );
}
