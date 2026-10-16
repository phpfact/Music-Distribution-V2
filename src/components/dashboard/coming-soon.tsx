import Link from "next/link";
import { EmptyState } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeading } from "./page-heading";

type ComingSoonProps = {
  /** The module's name, e.g. "Releases". */
  title: string;
  /** What the module will be for (one sentence). */
  description: string;
  /** Where "Back to dashboard" goes. */
  homeHref: string;
};

/**
 * Description: Render the honest placeholder of a module that is not built yet.
 * Input: The module's title and purpose, and the area's dashboard link.
 * Output: The page heading and an empty state saying the module is not
 *   available yet, with a way back. No fake records, figures or controls.
 * Use case: Releases, Artists, Labels, Distribution, Analytics, Royalties …
 *   in the tenant and customer areas.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function ComingSoon({ title, description, homeHref }: ComingSoonProps) {
  return (
    <>
      <PageHeading title={title} description={description} />
      <div className="px-4 lg:px-6">
        <Card>
          <CardContent>
            <EmptyState
              icon="disc-3"
              title={`${title} is coming soon`}
              description="This module is part of the platform roadmap and is not available yet. Nothing is shown here until it works with your real data."
              action={
                <Button asChild variant="outline">
                  <Link href={homeHref}>Back to dashboard</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
