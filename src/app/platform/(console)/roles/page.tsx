import type { Metadata } from "next";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { ComingSoon } from "../_components/coming-soon";
import { getNavItem } from "../navigation";

export const metadata: Metadata = { title: getNavItem("roles").label };

export default async function PlatformRolesPage() {
  await requirePlatformOwner();
  return <ComingSoon id="roles" />;
}
