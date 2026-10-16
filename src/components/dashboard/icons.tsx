import {
  AudioLines,
  Banknote,
  ChartColumn,
  ClipboardCheck,
  CreditCard,
  Disc3,
  LayoutDashboard,
  ListMusic,
  MicVocal,
  Palette,
  Send,
  Tag,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

/**
 * The icons the dashboards' navigation may use, by name. A server layout can
 * pass a name to the client shell; a component could not be serialized.
 */
const DASHBOARD_ICONS = {
  "audio-lines":      AudioLines,
  banknote:           Banknote,
  "chart-column":     ChartColumn,
  "clipboard-check":  ClipboardCheck,
  "credit-card":      CreditCard,
  disc:               Disc3,
  "layout-dashboard": LayoutDashboard,
  "list-music":       ListMusic,
  "mic-vocal":        MicVocal,
  palette:            Palette,
  send:               Send,
  tag:                Tag,
  users:              UsersRound,
} as const satisfies Record<string, LucideIcon>;

export type DashboardIconName = keyof typeof DASHBOARD_ICONS;

/**
 * Description: Render a navigation icon by name.
 * Input: The icon name and optional classes.
 * Output: The lucide icon (decorative: the link text names the item).
 * Use case: Sidebar links and the quick action of the dashboards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function DashboardIcon({ name, className }: { name: DashboardIconName; className?: string }) {
  const Component = DASHBOARD_ICONS[name];
  return <Component aria-hidden="true" className={className} />;
}
