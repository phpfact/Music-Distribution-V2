import type { Metadata } from "next";
import { AuthLayout } from "@/components/workspace/auth-layout";
import { WorkspaceThemeRoot } from "@/components/workspace/theme-root";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPublicAppearance } from "@/lib/workspace/appearance";
import { getWorkspace } from "@/lib/workspace/context";
import { requireReadyWorkspace } from "@/lib/workspace/guards";
import { SignupForm } from "./signup-form";

/**
 * Description: Name the browser tab after the tenant.
 * Input: None (the tenant comes from the Host header).
 * Output: "Create an account · <tenant name>".
 * Use case: Next.js metadata of /customer/signup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export async function generateMetadata(): Promise<Metadata> {
  const workspace = await getWorkspace();
  const name      = workspace.state === "unknown" ? null : workspace.tenant.name;
  return { title: name ? `Create an account · ${name}` : "Create an account", robots: { index: false, follow: false } };
}

/**
 * Description: Render the public customer sign-up page.
 * Input: None (tenant from the Host header).
 * Output: The sign-up card in the workspace's default appearance. Unknown host
 *   → 404 page; suspended/unfinished tenant → the notice on "/".
 * Use case: /customer/signup — only customers (artists, labels, white-label
 *   partners) can sign up; tenant staff accounts never come from this form.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function CustomerSignupPage() {
  const workspace  = await requireReadyWorkspace();
  const appearance = await getPublicAppearance(workspace.db);

  return (
    <WorkspaceThemeRoot appearance={appearance}>
      <AuthLayout tenantName={workspace.tenant.name}>
        <Card>
          <CardHeader>
            <CardTitle>
              <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
            </CardTitle>
            <CardDescription>
              Join {workspace.tenant.name} as an artist, label or white-label partner. Every new account is reviewed
              before it can be used.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SignupForm tenantName={workspace.tenant.name} />
          </CardContent>
        </Card>
      </AuthLayout>
    </WorkspaceThemeRoot>
  );
}
