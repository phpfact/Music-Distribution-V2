import { CircleX, Clock, LogOut } from "lucide-react";
import type { Metadata } from "next";
import { AuthPageGuard } from "@/components/shared";
import { AuthLayout } from "@/components/workspace/auth-layout";
import { WorkspaceThemeRoot } from "@/components/workspace/theme-root";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getPublicAppearance } from "@/lib/workspace/appearance";
import { requireApplicant } from "@/lib/workspace/guards";
import { accountTypeLabel } from "@/lib/workspace/rules";
import { applicantLogoutAction } from "./actions";
import { ReviewRequestForm } from "./review-request-form";

export const metadata: Metadata = { title: "Registration status", robots: { index: false, follow: false } };

/**
 * Description: Format a date for the status page.
 * Input: A date.
 * Output: e.g. "16 Oct 2026, 14:05" (server time zone; dates are informational).
 * Use case: Submission and review-request times.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

/**
 * Description: Show a rejected applicant their registration status.
 * Input: None (the registration comes from the verified limited session).
 * Output: Rejected → the reason and the review-request form; review requested
 *   → when it was sent and the message. Never a dashboard, never other data.
 * Use case: /customer/registration — opened by logging in with the password
 *   of a rejected registration (owner decision 2026-10-15).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export default async function RegistrationStatusPage() {
  const area       = await requireApplicant();
  const appearance = await getPublicAppearance(area.db);
  const { applicant } = area;
  const rejected      = applicant.status === "rejected";

  return (
    <WorkspaceThemeRoot appearance={appearance}>
      {/* Back after sign-out: a page restored from the browser's cache is re-checked. */}
      <AuthPageGuard />
      <AuthLayout tenantName={area.tenant.name}>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>
                <h1 className="text-2xl font-semibold tracking-tight">Registration status</h1>
              </CardTitle>
              {rejected ? (
                <Badge variant="destructive-soft" className="gap-1">
                  <CircleX aria-hidden="true" className="size-3.5" />
                  Not approved
                </Badge>
              ) : (
                <Badge variant="secondary" className="gap-1">
                  <Clock aria-hidden="true" className="size-3.5" />
                  Review requested
                </Badge>
              )}
            </div>
            <CardDescription>
              {applicant.fullName} · {accountTypeLabel(applicant.accountType)} · submitted{" "}
              {formatDate(applicant.createdAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {rejected ? (
              <>
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm font-medium">Reason from {area.tenant.name}</p>
                  <p className="mt-1 text-sm whitespace-pre-line text-muted-foreground">
                    {applicant.rejectionReason ?? "No reason was given."}
                  </p>
                </div>
                <Separator />
                <div className="flex flex-col gap-1">
                  <h2 className="text-base font-semibold">Ask for a new review</h2>
                  <p className="text-sm text-muted-foreground">
                    If something has changed, {area.tenant.name} can review your registration again.
                  </p>
                </div>
                <ReviewRequestForm />
              </>
            ) : (
              <div className="rounded-lg border bg-muted/40 p-4 text-sm">
                <p className="font-medium">Your review request was sent</p>
                <p className="mt-1 text-muted-foreground">
                  {applicant.reviewRequestedAt ? `Sent ${formatDate(applicant.reviewRequestedAt)}. ` : null}
                  {area.tenant.name} will review your registration again. You can log in normally once it has been
                  approved.
                </p>
                {applicant.reviewRequestMessage ? (
                  <p className="mt-3 border-l-2 pl-3 whitespace-pre-line text-muted-foreground">
                    {applicant.reviewRequestMessage}
                  </p>
                ) : null}
              </div>
            )}
          </CardContent>
          <CardFooter className="justify-end">
            <form action={applicantLogoutAction}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut aria-hidden="true" />
                Sign out
              </Button>
            </form>
          </CardFooter>
        </Card>
      </AuthLayout>
    </WorkspaceThemeRoot>
  );
}
