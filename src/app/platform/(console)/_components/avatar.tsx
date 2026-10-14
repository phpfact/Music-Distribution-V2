import { getInitials } from "./initials";

type AvatarSize = "sm" | "md" | "lg";

const SIZES: Record<AvatarSize, string> = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-16 text-lg",
};

type AvatarProps = {
  name: string;
  /** A profile image URL (or a local object URL for a preview). */
  src?: string | null;
  size?: AvatarSize;
};

/**
 * A round picture or, without one, the initials. Decorative: the name is
 * always written next to it, so it adds nothing for a screen reader.
 */
export function Avatar({ name, src, size = "md" }: AvatarProps) {
  const box = `${SIZES[size]} shrink-0 rounded-full`;

  if (src) {
    return (
      // A plain <img>: previews are blob: URLs and stored images come from an
      // authenticated route, neither of which next/image can optimise.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className={`${box} border border-line bg-surface-2 object-cover`} />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={`${box} grid place-items-center bg-accent-soft font-semibold text-accent`}
    >
      {getInitials(name)}
    </span>
  );
}
