/**
 * Data shapes of the dashboard-01 block (src/components/dashboard). Plain,
 * serializable data, so a server layout can pass them to the client shell;
 * icons are referred to by name (see icons.tsx), never as components.
 */
import type { DashboardIconName } from "./icons";

/** One navigation link of the sidebar. */
export type DashboardNavItem = {
  title: string;
  href: string;
  icon: DashboardIconName;
  /** A real count shown next to the link (e.g. pending approvals); omitted when 0. */
  badge?: number;
  /** The module is not built yet: the link opens its "coming soon" page. */
  soon?: boolean;
};

/** A labelled group of links (the block's "Documents" group). */
export type DashboardNavGroup = {
  label: string;
  items: readonly DashboardNavItem[];
};

/** The prominent button at the top of the sidebar (only for a real action). */
export type DashboardQuickAction = {
  title: string;
  href: string;
  icon: DashboardIconName;
};

/** The brand shown in the sidebar header. */
export type DashboardBrand = {
  /** The tenant's name. */
  name: string;
  /** E.g. "Tenant workspace" or "Customer portal". */
  subtitle: string;
  href: string;
};

/** The signed-in person in the account menu (sensitive parts are masked there). */
export type DashboardUser = {
  name: string;
  roleLabel: string;
  username: string | null;
  email: string;
};

/** Everything an area passes to its dashboard shell. */
export type DashboardConfig = {
  brand: DashboardBrand;
  quickAction?: DashboardQuickAction;
  navMain: readonly DashboardNavItem[];
  navGroups: readonly DashboardNavGroup[];
  navSecondary: readonly DashboardNavItem[];
  user: DashboardUser;
  /** The area's Appearance settings page. */
  appearanceHref: string;
};
