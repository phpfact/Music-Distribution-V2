import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, PencilIcon, ShieldCheckIcon, UserIcon } from "lucide-react";
import { SUB_PLATFORM_OWNER_SCREENS } from "@/app/platform/(console)/rbac-bindings";
import { MasterBadge, PrimaryBadge, UserStatusBadge } from "@/components/rbac/role-badges";
import { ActorFallback, DeniedScreen, ScreenFrame } from "@/components/rbac/screens/screen-parts";
import { SensitiveValue } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { holdsPrivilege } from "@/lib/authz/management-common";
import { formatRbacDate } from "@/components/rbac/format";
import { loadPlatformOwnerDetailsAction } from "../actions";

export const metadata: Metadata = { title: "Platform Owner Details" };

type PageProps = {
  params: Promise<{ id: string }>;
};

/**
 * Description: Dedicated View Details page for a Platform Owner.
 * Input: Route params containing platform owner id.
 * Output: Complete details card with assigned role permissions breakdown.
 * Use case: /platform/users/[id]
 * Author: Mr. Sachin Sharma
 * Created: 2026-11-24
 * Last modified: 2026-11-24
 */
export default async function PlatformOwnerDetailsPage({ params }: PageProps) {
  const { id } = await params;
  const binding = SUB_PLATFORM_OWNER_SCREENS;
  const access = await binding.pageActor("usersView");
  if (!access.ok) {
    return <ActorFallback binding={binding} result={access} title="Platform Owner Details" />;
  }

  const detailsRes = await loadPlatformOwnerDetailsAction(id);
  if (!detailsRes.ok || !detailsRes.data) {
    notFound();
  }

  const user = detailsRes.data;
  const canEdit = holdsPrivilege(access.actor, "usersEdit") && !user.isPrimary;

  return (
    <ScreenFrame
      gutterClassName={binding.gutterClassName}
      title={user.fullName}
      description="Platform owner profile, role assignment, and associated module permissions."
      eyebrow={binding.eyebrow}
      actions={
        <div className="flex items-center gap-2">
          <Button asChild variant="outline">
            <Link href={binding.list}>
              <ArrowLeftIcon className="mr-1 size-4" />
              Back to Owners
            </Link>
          </Button>
          {canEdit ? (
            <Button asChild>
              <Link href={`${binding.list}/${id}/edit`}>
                <PencilIcon className="mr-1 size-4" />
                Edit Owner
              </Link>
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="flex flex-col gap-6">
        {/* Profile Card */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="grid size-12 place-items-center rounded-xl border bg-muted text-foreground">
                  <UserIcon className="size-6 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-xl font-bold">{user.fullName}</CardTitle>
                    {user.isPrimary ? <PrimaryBadge /> : null}
                  </div>
                  <CardDescription>
                    Username: <span className="font-mono text-foreground font-medium">@{user.username}</span>
                  </CardDescription>
                </div>
              </div>
              <UserStatusBadge status={user.status === "active" ? "active" : "disabled"} />
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">Email Address</dt>
                <dd className="text-sm font-medium">
                  {user.email ? (
                    <SensitiveValue value={user.email} noun="email" monospace={false} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>

              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">Mobile Number</dt>
                <dd className="text-sm font-medium">
                  {user.phone ? (
                    <SensitiveValue value={user.phone} noun="mobile" monospace={false} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </dd>
              </div>

              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">Created Date</dt>
                <dd className="text-sm font-medium">{formatRbacDate(user.createdAt)}</dd>
              </div>

              <div className="flex flex-col gap-1">
                <dt className="text-xs font-medium text-muted-foreground">Last Login</dt>
                <dd className="text-sm font-medium">
                  {user.lastLoginAt ? formatRbacDate(user.lastLoginAt) : <span className="italic text-muted-foreground">Never</span>}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Role & Permissions Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheckIcon className="size-5 text-primary" />
              <CardTitle className="text-lg">Assigned Role & RBAC Permissions</CardTitle>
            </div>
            <CardDescription>
              This platform owner's access is strictly constrained by this role's configured privileges.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {user.role ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-base">{user.role.name}</span>
                    {user.role.isMaster ? <MasterBadge /> : null}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {user.role.permissions.length} Permissions Active
                  </Badge>
                </div>

                {user.role.permissions.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {user.role.permissions.map((perm) => (
                      <div
                        key={perm.key}
                        className="flex flex-col gap-1 rounded-md border bg-card p-3 shadow-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-foreground">{perm.label}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground line-clamp-2">
                          {perm.description}
                        </p>
                        <code className="text-[10px] text-muted-foreground/80 font-mono mt-1">
                          {perm.key}
                        </code>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    This role has no active permissions assigned.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-destructive font-medium">
                No active role assigned. This account cannot access protected platform operations.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </ScreenFrame>
  );
}
