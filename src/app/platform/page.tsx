import { redirect } from "next/navigation";

/**
 * Description: Send /platform to the dashboard.
 * Input: None.
 * Output: A redirect to /platform/dashboard (never renders).
 * Use case: /platform. The dashboard decides whether the visitor is signed in
 *   (signed-out visitors continue to the login page).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export default function PlatformIndexPage() {
  redirect("/platform/dashboard");
}
