import type { Metadata } from "next";
import { AuthLayout } from "@/components/workspace/auth-layout";
import { WorkspaceThemeRoot } from "@/components/workspace/theme-root";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicAppearance } from "@/lib/workspace/appearance";
import { getWorkspace } from "@/lib/workspace/context";
import { requireReadyWorkspace } from "@/lib/workspace/guards";
import { LoginForm } from "./login-form";

/**
 * Description: Name the browser tab after the tenant.
 * Input: None (the tenant comes from the Host header).
 * Output: "Log in · <tenant name>", or "Log in" when the tenant cannot be served.
 * Use case: Next.js metadata of /login.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export async function generateMetadata(): Promise<Metadata> {
  const workspace = await getWorkspace();
  const name      = workspace.state === "unknown" ? null : workspace.tenant.name;
  return { title: name ? `Log in · ${name}` : "Log in", robots: { index: false, follow: false } };
}

/**
 * Description: Render the tenant portal's shared sign-in page.
 * Input: None (tenant from the Host header).
 * Output: The sign-in card in the workspace's default appearance. Unknown host
 *   → 404 page; suspended/unfinished tenant → the notice on "/".
 * Use case: /login — tenant staff and customers sign in here; the account
 *   decides where they land (owner decision 2026-10-15).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export default async function WorkspaceLoginPage() {
  const workspace  = await requireReadyWorkspace();
  const appearance = await getPublicAppearance(workspace.db);

  return (
    <WorkspaceThemeRoot appearance={appearance}>
      <AuthLayout tenantName={workspace.tenant.name}>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
            </CardTitle>
            <CardDescription>Welcome back to {workspace.tenant.name}. Use your username or email to continue.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </AuthLayout>
    </WorkspaceThemeRoot>
  );
}
