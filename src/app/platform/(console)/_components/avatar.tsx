import { Avatar as UiAvatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getInitials } from "./initials";

type AvatarSize = "sm" | "md" | "lg";

const SIZES: Record<AvatarSize, string> = {
  sm: "size-8",
  md: "size-10",
  lg: "size-16",
};

const INITIAL_SIZES: Record<AvatarSize, string> = { sm: "text-xs", md: "text-sm", lg: "text-lg" };

type AvatarProps = {
  name: string;
  /** A profile image URL (or a local object URL for a preview). */
  src?: string | null;
  size?: AvatarSize;
};

/**
 * Render a decorative profile image with a reliable initials fallback.
 * Input: name, optional authenticated image/local preview, and display size.
 * Output: the shared shadcn Avatar with the active account accent.
 * Use case: identify tenants and account owners beside their visible names.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
export function Avatar({ name, src, size = "md" }: AvatarProps) {
  return (
    <UiAvatar aria-hidden="true" className={`${SIZES[size]} shrink-0 border border-border`}>
      {src ? <AvatarImage src={src} alt="" className="object-cover" /> : null}
      <AvatarFallback className={`bg-primary/10 font-semibold text-primary ${INITIAL_SIZES[size]}`}>
        {getInitials(name)}
      </AvatarFallback>
    </UiAvatar>
  );
}
