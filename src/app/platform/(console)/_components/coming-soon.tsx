import Link from "next/link";
import { getNavItem, type PlatformNavId } from "../navigation";
import { Icon } from "./icons";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty";

type ComingSoonProps = {
  id: PlatformNavId;
};

/**
 * Description: Render the whole page of a module that is in the navigation but not built yet.
 * Input: The navigation id of the module.
 * Output: A centred card: the module's icon, "Coming soon", its label and
 *   description, and a Back to dashboard button.
 * Use case: Roles, Subscriptions and Support pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function ComingSoon({ id }: ComingSoonProps) {
  const item = getNavItem(id);

  return (
    <section aria-label={item.label}>
      <Card className="mx-auto mt-6 max-w-lg p-8 text-center sm:p-10">
        <Empty className="gap-0 p-0">
          <EmptyHeader className="max-w-none">
            <EmptyMedia
              variant="icon"
              className="mx-auto size-12 bg-accent-soft text-primary"
            >
              <Icon name={item.icon} className="size-6" />
            </EmptyMedia>
            <Badge variant="outline" className="mx-auto mt-6">
              <Icon name="clock" className="size-3.5" />
              Coming soon
            </Badge>
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">
              {item.label}
            </h1>
            <p className="mt-2 text-fg-muted">{item.description}</p>
            <p className="mt-1 text-sm text-fg-subtle">
              This module isn&apos;t available yet.
            </p>
          </EmptyHeader>
          <Button asChild variant="outline" className="mt-8">
            <Link href={getNavItem("dashboard").href}>
              <Icon name="arrow-left" className="size-4" />
              Back to dashboard
            </Link>
          </Button>
        </Empty>
      </Card>
    </section>
  );
}
