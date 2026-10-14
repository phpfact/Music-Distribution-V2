import type { Metadata } from "next";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { ComingSoon } from "../_components/coming-soon";
import { getNavItem } from "../navigation";

export const metadata: Metadata = { title: getNavItem("settings").label };

export default async function PlatformSettingsPage() {
  await requirePlatformOwner();
  return <ComingSoon id="settings" />;
}
