import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "../../_components/icons";
import { TENANTS_PATH } from "../list-query";

// An unknown or malformed tenant id: said inside the console frame, so the
// navigation stays usable. Nothing tells a missing tenant from a bad id.
/**
 * Description: Show a safe tenant-not-found state inside the console.
 * Input: None (Next.js not-found convention).
 * Output: A card explaining the tenant does not exist, with a way back to the
 *   directory (a missing tenant and a bad id look the same).
 * Use case: Unknown or malformed tenant ids.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export default function TenantNotFound() {
  return (
    <section className="mx-auto mt-6 max-w-lg">
      <Card className="gap-0 py-0 text-center">
        <CardContent className="p-8">
          <div className="mx-auto grid size-12 place-items-center rounded-xl bg-surface-2 text-fg-muted">
            <Icon name="building-2" className="size-6" />
          </div>
          <h1 className="mt-6 text-xl font-semibold tracking-tight">
            Tenant not found
          </h1>
          <p className="mt-2 text-fg-muted">
            This tenant doesn&apos;t exist or is no longer available.
          </p>
          <Button asChild variant="outline" className="mt-6">
            <Link href={TENANTS_PATH}>
              <Icon name="arrow-left" className="size-4" />
              Back to tenants
            </Link>
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
