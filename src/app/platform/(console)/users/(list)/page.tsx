import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { getNavItem } from "@/app/platform/(console)/navigation";
import { SUB_PLATFORM_OWNER_SCREENS } from "@/app/platform/(console)/rbac-bindings";
import { parseRbacListQuery } from "@/components/rbac/list-href";
import { SubUsersSummary } from "@/components/rbac/rbac-summary";
import { RbacToolbar } from "@/components/rbac/rbac-toolbar";
import { rbacNoticeMessage } from "@/components/rbac/screens/notices";
import { ActorFallback, LoadFailed, ScreenFrame } from "@/components/rbac/screens/screen-parts";
import { SectionedLayout, type SecondaryMenuItem } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { holdsPrivilege } from "@/lib/authz/management-common";
import { toPageView, toSubUserListQuery, toSubUserRowView } from "@/lib/authz/management-view";
import { listRoleFilterOptions } from "@/lib/authz/role-filter";
import { getSubUserSummary, listSubUsers } from "@/lib/authz/sub-user-service";
import { PlatformOwnersDirectory } from "../_components/platform-owners-directory";
import { loadSubPlatformOwnerRecordsAction } from "../actions";

export const metadata: Metadata = { title: getNavItem("users").label };

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const LIST_SECTIONS = {
  summary: { id: "platform-owners-summary", label: "Summary" },
  directory: { id: "platform-owners-directory", label: "Directory" },
} as const;
const LIST_MENU: readonly SecondaryMenuItem[] = Object.values(LIST_SECTIONS);

/**
 * Description: The Platform panel's dedicated Platform Owners listing page.
 * Input: URL searchParams (search, status, role, page, notice).
 * Output: Top summary metrics, toolbar (name, email, mobile search, role filter, status),
 *   and full PlatformOwnersDirectory table with complete action controls.
 * Use case: /platform/users
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-11-24
 */
export default async function PlatformOwnersPage({ searchParams }: PageProps) {
  const binding = SUB_PLATFORM_OWNER_SCREENS;
  const access = await binding.pageActor("usersView");
  if (!access.ok) {
    return <ActorFallback binding={binding} result={access} title="Platform Owners" />;
  }

  const actor = access.actor;
  const permissions = {
    create: holdsPrivilege(actor, "usersCreate"),
    edit: holdsPrivilege(actor, "usersEdit"),
    suspend: holdsPrivilege(actor, "usersSuspend"),
    delete: holdsPrivilege(actor, "usersDelete"),
  };

  const resolvedParams = await searchParams;
  const query = parseRbacListQuery(resolvedParams);
  const notice = rbacNoticeMessage(resolvedParams.notice);

  const summary = await getSubUserSummary(actor);
  const page = await listSubUsers(actor, toSubUserListQuery(resolvedParams));
  const roleOptions = await listRoleFilterOptions(actor, query.role);

  const addButton = permissions.create ? (
    <Button asChild>
      <Link href={`${binding.list}/new`}>
        <PlusIcon aria-hidden="true" />
        Add Platform Owner
      </Link>
    </Button>
  ) : undefined;

  const frame = {
    gutterClassName: binding.gutterClassName,
    eyebrow: binding.eyebrow,
    title: "Platform Owners",
    description: "Manage all platform owners and assign granular roles with Role-Based Access Control (RBAC).",
    actions: addButton,
    notice,
  };

  if (!summary.ok || !page.ok) {
    return (
      <ScreenFrame {...frame}>
        <LoadFailed message={summary.ok ? (page.ok ? "" : page.error) : summary.error} />
      </ScreenFrame>
    );
  }

  const roleList = roleOptions ?? [];

  return (
    <ScreenFrame {...frame}>
      <SectionedLayout items={LIST_MENU} variant="top" contentClassName="flex flex-col gap-6">
        <section id={LIST_SECTIONS.summary.id} aria-labelledby="platform-owners-summary-heading">
          <h2 id="platform-owners-summary-heading" className="sr-only">
            Platform Owners Summary
          </h2>
          <SubUsersSummary
            counts={summary.data}
            nounPlural="Platform Owners"
            loadUsers={loadSubPlatformOwnerRecordsAction}
          />
        </section>

        <section id={LIST_SECTIONS.directory.id} aria-labelledby="platform-owners-directory-heading">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 id="platform-owners-directory-heading" className="text-base font-semibold">
                  Platform Owners Directory
                </h2>
              </CardTitle>
              <CardDescription>
                Search and filter by name, username, email, mobile, status or assigned role.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <RbacToolbar
                basePath={binding.list}
                query={query}
                searchPlaceholder="Search by name, email, or mobile…"
                statusLabels={{ active: "Active", disabled: "Inactive" }}
                roleOptions={roleList}
                loadRoles={binding.loadRoleOptions.bind(null, "filter")}
              />

              <PlatformOwnersDirectory
                page={toPageView(page.data, toSubUserRowView)}
                query={query}
                basePath={binding.list}
                roles={roleList}
                permissions={permissions}
              />
            </CardContent>
          </Card>
        </section>
      </SectionedLayout>
    </ScreenFrame>
  );
}
