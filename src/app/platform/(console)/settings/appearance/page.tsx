import type { Metadata } from "next";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { AppearanceSettings } from "./appearance-settings";
import { appearanceFeedback } from "./feedback";

export const metadata: Metadata = { title: "Appearance" };

/**
 * Authenticate before resolving account-bound feedback from a successful reload.
 * Input: the route's query parameters.
 * Output: the Appearance interface with safe server-rendered success feedback.
 * Use case: prevent a previous account's success notice appearing for a new login.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export default async function AppearancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePlatformOwner();
  const feedback = appearanceFeedback(await searchParams, session.owner.id);
  return <AppearanceSettings initialFeedback={feedback} />;
}
