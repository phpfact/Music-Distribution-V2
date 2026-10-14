"use client";

import { useFormStatus } from "react-dom";
import { Icon } from "./icons";
import { MENU_ITEM_CLASS } from "./styles";

/**
 * The account menu's last item. Must be rendered inside the sign-out form:
 * the pending state comes from it.
 */
export function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button type="submit" role="menuitem" tabIndex={-1} disabled={pending} className={MENU_ITEM_CLASS}>
      <Icon name="log-out" className="size-4 shrink-0" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
