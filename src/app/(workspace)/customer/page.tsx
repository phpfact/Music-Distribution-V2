import { redirect } from "next/navigation";

/**
 * Description: Send /customer to the customer dashboard.
 * Input: None.
 * Output: A redirect to /customer/dashboard (which checks the session itself).
 * Use case: /customer.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default function CustomerIndexPage() {
  redirect("/customer/dashboard");
}
