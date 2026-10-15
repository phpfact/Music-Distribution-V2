import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "./icons";

type NoticeVariant = "success" | "error" | "warning" | "info";
type NoticeProps = {
  variant: NoticeVariant;
  title?: ReactNode;
  children?: ReactNode;
  onDismiss?: () => void;
};
const VARIANTS: Record<NoticeVariant, { icon: IconName; srLabel: string }> = {
  success: { icon: "circle-check", srLabel: "Success:" },
  error: { icon: "circle-x", srLabel: "Error:" },
  warning: { icon: "alert-triangle", srLabel: "Warning:" },
  info: { icon: "info", srLabel: "Note:" },
};

/**
 * Announce action results through the shared shadcn Alert.
 * Input: message severity, title, content and optional dismissal callback.
 * Output: an assertive error or a polite status with semantic theme colors.
 * Use case: preserve existing success/error announcements on every screen.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function Notice({ variant, title, children, onDismiss }: NoticeProps) {
  const { icon, srLabel } = VARIANTS[variant];
  return (
    <Alert
      variant={variant === "error" ? "destructive" : variant}
      role={variant === "error" ? "alert" : "status"}
      className={`flex items-start gap-3 ${variant === "error" ? "border-destructive/25 bg-destructive/10" : ""}`}
    >
      <Icon name={icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        <span className="sr-only">{srLabel} </span>
        {title ? (
          <AlertTitle className="font-semibold">{title}</AlertTitle>
        ) : null}
        {children ? (
          <AlertDescription className={`text-inherit ${title ? "mt-1" : ""}`}>
            {children}
          </AlertDescription>
        ) : null}
      </div>
      {onDismiss ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-1 -mr-2 shrink-0 text-inherit"
        >
          <Icon name="x" className="size-4" />
        </Button>
      ) : null}
    </Alert>
  );
}
