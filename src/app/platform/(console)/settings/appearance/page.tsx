import type { Metadata } from "next";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { AppearanceSettings } from "./appearance-settings";

export const metadata: Metadata = { title: "Appearance" };

export default async function AppearancePage() {
  await requirePlatformOwner();
  return <AppearanceSettings />;
}
