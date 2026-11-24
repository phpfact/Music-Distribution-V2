"use client";

import {
  BanIcon,
  EllipsisIcon,
  EyeIcon,
  KeyRoundIcon,
  PencilIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { EmptyState, Notice, SensitiveValue } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DirectoryPaging } from "@/components/rbac/directory-parts";
import { formatRbacDate } from "@/components/rbac/format";
import { hasRbacFilters, rbacListHref, type RbacListQuery } from "@/components/rbac/list-href";
import { MasterBadge, PrimaryBadge, SelfBadge, UserStatusBadge } from "@/components/rbac/role-badges";
import type { PageView, RbacActionResult, RoleOptionView, SubUserRowView, UserStatusChange } from "@/components/rbac/types";
import { PlatformOwnerDetailsDialog } from "./platform-owner-details-dialog";
import { ChangeRoleDialog, DeletePlatformOwnerDialog, ResetPasswordDialog } from "./platform-owner-quick-dialogs";
import {
  changePlatformOwnerRoleAction,
  deleteSubPlatformOwnerAction,
  resetPlatformOwnerPasswordAction,
  setSubPlatformOwnerStatusAction,
} from "../actions";

export function NoValue() {
  return (
    <>
      <span aria-hidden="true" className="text-muted-foreground">
        —
      </span>
      <span className="sr-only">Not available</span>
    </>
  );
}

function OwnerName({ row }: { row: SubUserRowView }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-foreground">{row.fullName}</span>
        {row.isPrimary ? <PrimaryBadge /> : null}
        {row.isSelf ? <SelfBadge /> : null}
      </div>
      {row.username ? (
        <span className="text-xs text-muted-foreground">
          @{row.username}
        </span>
      ) : null}
    </div>
  );
}

function RoleBadge({ row }: { row: SubUserRowView }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm font-medium">{row.roleName}</span>
      {row.roleIsMaster ? <MasterBadge /> : null}
    </div>
  );
}

export type PlatformOwnersDirectoryProps = {
  page: PageView<SubUserRowView>;
  query: RbacListQuery;
  basePath: string;
  roles: readonly RoleOptionView[];
  permissions: {
    create: boolean;
    edit: boolean;
    suspend: boolean;
    delete: boolean;
  };
};

/**
 * Description: High-grade Platform Owners directory table & cards layout.
 * Input: One server page of SubUserRowView items, current query, basePath, and permissions.
 * Output: Searchable/filterable table with Owner Name, Email, Mobile, Assigned Role,
 *   Status, Created Date, Last Login, and Actions dropdown menu with:
 *   - View Details (dialog & dedicated page)
 *   - Edit Platform Owner
 *   - Change Role (quick dialog)
 *   - Activate / Deactivate (confirmation toggle)
 *   - Reset Password (quick dialog)
 *   - Delete Platform Owner (safe confirmation dialog)
 * Use case: /platform/users listing directory.
 * Author: Mr. Sachin Sharma
 * Created: 2026-11-24
 * Last modified: 2026-11-24
 */
export function PlatformOwnersDirectory({
  page,
  query,
  basePath,
  roles,
  permissions,
}: PlatformOwnersDirectoryProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [success, setSuccess] = useState<string | null>(null);

  // Dialog states
  const [viewingUserId, setViewingUserId] = useState<string | null>(null);
  const [changeRoleUser, setChangeRoleUser] = useState<SubUserRowView | null>(null);
  const [resetPasswordUser, setResetPasswordUser] = useState<SubUserRowView | null>(null);
  const [deleteUser, setDeleteUser] = useState<SubUserRowView | null>(null);

  const filtered = hasRbacFilters(query);

  function handleDone(message: string) {
    setSuccess(message);
    startTransition(() => router.refresh());
  }

  async function handleToggleStatus(user: SubUserRowView) {
    const change: UserStatusChange = user.status === "active" ? "suspend" : "reactivate";
    const res = await setSubPlatformOwnerStatusAction(user.id, change);
    if (res.ok) {
      handleDone(res.message);
    } else {
      setSuccess(null);
      alert(res.error);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {success ? (
        <Notice variant="success" onDismiss={() => setSuccess(null)}>
          {success}
        </Notice>
      ) : null}

      {page.total === 0 ? (
        <EmptyState
          icon="user"
          title={filtered ? "No platform owners match" : "No platform owners yet"}
          description={
            filtered
              ? "Try another search, status or role, or clear the filters."
              : "Create a platform owner and assign them a specific role."
          }
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href={rbacListHref(basePath, {})}>
                  <XIcon aria-hidden="true" />
                  Clear filters
                </Link>
              </Button>
            ) : permissions.create ? (
              <Button asChild>
                <Link href={`${basePath}/new`}>
                  Add Platform Owner
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Desktop Table View (xl screens) */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card xl:block">
            <Table>
              <TableCaption className="sr-only">Platform Owners Directory</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Owner Name</TableHead>
                  <TableHead className="min-w-[180px]">Email Address</TableHead>
                  <TableHead className="min-w-[150px]">Mobile Number</TableHead>
                  <TableHead className="min-w-[160px]">Assigned Role</TableHead>
                  <TableHead className="min-w-[100px]">Status</TableHead>
                  <TableHead className="min-w-[130px]">Created Date</TableHead>
                  <TableHead className="min-w-[140px]">Last Login</TableHead>
                  <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row) => {
                  const manageable = row.manageable && !row.isPrimary && !row.isSelf;
                  const canEdit = manageable && permissions.edit;
                  const canSuspend = manageable && permissions.suspend;
                  const canDelete = manageable && permissions.delete;

                  return (
                    <TableRow key={row.id} className="align-middle">
                      {/* 1. Owner Name */}
                      <TableCell>
                        <OwnerName row={row} />
                      </TableCell>

                      {/* 2. Email Address */}
                      <TableCell>
                        {row.email ? (
                          <SensitiveValue value={row.email} noun="email" monospace={false} />
                        ) : (
                          <NoValue />
                        )}
                      </TableCell>

                      {/* 3. Mobile Number */}
                      <TableCell>
                        {row.phone ? (
                          <SensitiveValue value={row.phone} noun="mobile" monospace={false} />
                        ) : (
                          <NoValue />
                        )}
                      </TableCell>

                      {/* 4. Assigned Role */}
                      <TableCell>
                        <RoleBadge row={row} />
                      </TableCell>

                      {/* 5. Account Status */}
                      <TableCell>
                        <UserStatusBadge status={row.status} />
                      </TableCell>

                      {/* 6. Created Date */}
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {formatRbacDate(row.createdAt)}
                      </TableCell>

                      {/* 7. Last Login */}
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {row.lastLoginAt ? formatRbacDate(row.lastLoginAt) : <span className="text-muted-foreground italic">Never</span>}
                      </TableCell>

                      {/* 8. Actions */}
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-primary hover:text-primary"
                            onClick={() => setViewingUserId(row.id)}
                          >
                            <EyeIcon className="size-3.5 mr-1" aria-hidden="true" />
                            View
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-muted-foreground"
                                aria-label={`Actions for ${row.fullName}`}
                              >
                                <EllipsisIcon className="size-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem onClick={() => setViewingUserId(row.id)}>
                                <EyeIcon className="mr-2 size-4" />
                                View Details
                              </DropdownMenuItem>

                              {canEdit ? (
                                <>
                                  <DropdownMenuItem asChild>
                                    <Link href={`${basePath}/${row.id}/edit`}>
                                      <PencilIcon className="mr-2 size-4" />
                                      Edit Platform Owner
                                    </Link>
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setChangeRoleUser(row)}>
                                    <ShieldCheckIcon className="mr-2 size-4" />
                                    Change Role
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setResetPasswordUser(row)}>
                                    <KeyRoundIcon className="mr-2 size-4" />
                                    Reset Password
                                  </DropdownMenuItem>
                                </>
                              ) : null}

                              {canSuspend ? (
                                <DropdownMenuItem onClick={() => handleToggleStatus(row)}>
                                  {row.status === "active" ? (
                                    <>
                                      <BanIcon className="mr-2 size-4 text-amber-600" />
                                      <span>Deactivate Owner</span>
                                    </>
                                  ) : (
                                    <>
                                      <RotateCcwIcon className="mr-2 size-4 text-emerald-600" />
                                      <span>Activate Owner</span>
                                    </>
                                  )}
                                </DropdownMenuItem>
                              ) : null}

                              {canDelete ? (
                                <>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    className="text-destructive focus:text-destructive"
                                    onClick={() => setDeleteUser(row)}
                                  >
                                    <Trash2Icon className="mr-2 size-4" />
                                    Delete Platform Owner
                                  </DropdownMenuItem>
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Mobile & Tablet Card View (below xl) */}
          <ul className="flex flex-col gap-3 xl:hidden">
            {page.rows.map((row) => {
              const manageable = row.manageable && !row.isPrimary && !row.isSelf;
              const canEdit = manageable && permissions.edit;
              const canSuspend = manageable && permissions.suspend;
              const canDelete = manageable && permissions.delete;

              return (
                <li key={row.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <OwnerName row={row} />
                    <UserStatusBadge status={row.status} />
                  </div>

                  <dl className="grid gap-2 text-sm sm:grid-cols-2">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">Email</dt>
                      <dd>
                        {row.email ? (
                          <SensitiveValue value={row.email} noun="email" monospace={false} />
                        ) : (
                          <NoValue />
                        )}
                      </dd>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">Mobile</dt>
                      <dd>
                        {row.phone ? (
                          <SensitiveValue value={row.phone} noun="mobile" monospace={false} />
                        ) : (
                          <NoValue />
                        )}
                      </dd>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">Assigned Role</dt>
                      <dd>
                        <RoleBadge row={row} />
                      </dd>
                    </div>

                    <div className="flex flex-col gap-0.5">
                      <dt className="text-xs text-muted-foreground">Created / Last Login</dt>
                      <dd className="text-xs text-muted-foreground">
                        {formatRbacDate(row.createdAt)} · Login:{" "}
                        {row.lastLoginAt ? formatRbacDate(row.lastLoginAt) : "Never"}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex items-center justify-between border-t pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setViewingUserId(row.id)}
                    >
                      <EyeIcon className="size-3.5 mr-1" />
                      View Details
                    </Button>

                    <div className="flex items-center gap-1">
                      {canEdit ? (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`${basePath}/${row.id}/edit`}>
                            <PencilIcon className="size-3.5 mr-1" />
                            Edit
                          </Link>
                        </Button>
                      ) : null}

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-8">
                            <EllipsisIcon className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          {canEdit ? (
                            <>
                              <DropdownMenuItem onClick={() => setChangeRoleUser(row)}>
                                <ShieldCheckIcon className="mr-2 size-4" />
                                Change Role
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setResetPasswordUser(row)}>
                                <KeyRoundIcon className="mr-2 size-4" />
                                Reset Password
                              </DropdownMenuItem>
                            </>
                          ) : null}
                          {canSuspend ? (
                            <DropdownMenuItem onClick={() => handleToggleStatus(row)}>
                              {row.status === "active" ? (
                                <>
                                  <BanIcon className="mr-2 size-4 text-amber-600" />
                                  <span>Deactivate</span>
                                </>
                              ) : (
                                <>
                                  <RotateCcwIcon className="mr-2 size-4 text-emerald-600" />
                                  <span>Activate</span>
                                </>
                              )}
                            </DropdownMenuItem>
                          ) : null}
                          {canDelete ? (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => setDeleteUser(row)}
                              >
                                <Trash2Icon className="mr-2 size-4" />
                                Delete Owner
                              </DropdownMenuItem>
                            </>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>

          <DirectoryPaging basePath={basePath} query={query} page={page} label="Platform Owners pages" />
        </>
      )}

      {/* Popups & Dialogs */}
      <PlatformOwnerDetailsDialog
        userId={viewingUserId}
        open={Boolean(viewingUserId)}
        onClose={() => setViewingUserId(null)}
        onEdit={() => {
          const id = viewingUserId;
          setViewingUserId(null);
          if (id) router.push(`${basePath}/${id}/edit`);
        }}
      />

      <ChangeRoleDialog
        user={changeRoleUser}
        open={Boolean(changeRoleUser)}
        roles={roles}
        onClose={() => setChangeRoleUser(null)}
        onSuccess={handleDone}
      />

      <ResetPasswordDialog
        user={resetPasswordUser}
        open={Boolean(resetPasswordUser)}
        onClose={() => setResetPasswordUser(null)}
        onSuccess={handleDone}
      />

      <DeletePlatformOwnerDialog
        user={deleteUser}
        open={Boolean(deleteUser)}
        onClose={() => setDeleteUser(null)}
        onSuccess={handleDone}
      />
    </div>
  );
}
