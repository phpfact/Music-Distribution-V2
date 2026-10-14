import { redirect } from "next/navigation";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";

export default async function SettingsPage() {
  await requirePlatformOwner();
  redirect("/platform/settings/appearance");
}
