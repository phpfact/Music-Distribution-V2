"use client";

import { useEffect, useState } from "react";
import { CheckCircle2Icon, ShieldAlertIcon, ShieldCheckIcon, UserIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { SensitiveValue } from "@/components/shared";
import { formatRbacDate } from "@/components/rbac/format";
import { MasterBadge, PrimaryBadge, SelfBadge, UserStatusBadge } from "@/components/rbac/role-badges";
import { loadPlatformOwnerDetailsAction } from "../actions";

export type PlatformOwnerDetailsProps = {
  userId: string | null;
  open: boolean;
  onClose: () => void;
  onEdit?: () => void;
};

type OwnerData = NonNullable<Awaited<ReturnType<typeof loadPlatformOwnerDetailsAction>>["data"]>;

/**
 * Description: Dedicated details modal for a Platform Owner showing full metadata and role permissions.
 * Input: userId, open state, onClose handler.
 * Output: Detailed inspection dialog.
 * Author: Mr. Sachin Sharma
 * Created: 2026-11-24
 * Last modified: 2026-11-24
 */
export function PlatformOwnerDetailsDialog({ userId, open, onClose }: PlatformOwnerDetailsProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<OwnerData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !userId) {
      setData(null);
      setError(null);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    loadPlatformOwnerDetailsAction(userId)
      .then((res) => {
        if (!active) return;
        if (res.ok && res.data) {
          setData(res.data);
        } else {
          setError(res.error || "Failed to load owner details.");
        }
      })
      .catch(() => {
        if (active) setError("Could not connect to server. Try again.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [open, userId]);

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserIcon className="size-5 text-primary" aria-hidden="true" />
            Platform Owner Details
          </DialogTitle>
          <DialogDescription>
            Account overview, contact details, and role permissions.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <p className="text-sm text-muted-foreground animate-pulse">Loading owner details…</p>
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        ) : data ? (
          <div className="flex flex-col gap-6 py-2">
            {/* Header / Identity */}
            <div className="flex flex-col gap-2 rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">{data.fullName}</span>
                {data.isPrimary ? <PrimaryBadge /> : null}
                <UserStatusBadge status={data.status === "active" ? "active" : "disabled"} />
              </div>
              <p className="text-xs text-muted-foreground">ID: {data.id}</p>
            </div>

            {/* Profile & Contact Details */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-0.5 rounded-lg border p-3">
                <span className="text-xs font-medium text-muted-foreground">Email Address</span>
                <span className="text-sm font-semibold">
                  {data.email ? <SensitiveValue value={data.email} noun="email" monospace={false} /> : "—"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 rounded-lg border p-3">
                <span className="text-xs font-medium text-muted-foreground">Mobile Number</span>
                <span className="text-sm font-semibold">
                  {data.phone ? <SensitiveValue value={data.phone} noun="phone" /> : "—"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5 rounded-lg border p-3">
                <span className="text-xs font-medium text-muted-foreground">Username</span>
                <span className="text-sm font-semibold">
                  <SensitiveValue value={data.username} noun="username" />
                </span>
              </div>
              <div className="flex flex-col gap-0.5 rounded-lg border p-3">
                <span className="text-xs font-medium text-muted-foreground">Account Created</span>
                <span className="text-sm">{formatRbacDate(data.createdAt)}</span>
              </div>
              <div className="flex flex-col gap-0.5 rounded-lg border p-3 sm:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Last Login</span>
                <span className="text-sm font-medium">
                  {data.lastLoginAt ? formatRbacDate(data.lastLoginAt) : "Never logged in"}
                </span>
              </div>
            </div>

            {/* Assigned Role & Permissions */}
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldCheckIcon className="size-4 text-primary" aria-hidden="true" />
                  <span className="text-sm font-bold">Assigned Role</span>
                </div>
                {data.role?.isMaster ? <MasterBadge /> : null}
              </div>

              <div className="flex items-center justify-between border-t pt-2">
                <span className="text-base font-semibold text-primary">{data.role?.name ?? "No Role"}</span>
                <span className="text-xs text-muted-foreground">
                  {data.role?.permissions ? `${data.role.permissions.length} privileges granted` : "All permissions"}
                </span>
              </div>

              {/* Granted Permissions List */}
              {data.role?.permissions && data.role.permissions.length > 0 ? (
                <div className="mt-2 flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border bg-background p-2">
                  {data.role.permissions.map((p) => (
                    <div key={p.key} className="flex items-center gap-2 text-xs">
                      <CheckCircle2Icon className="size-3.5 shrink-0 text-emerald-600" aria-hidden="true" />
                      <span className="font-medium">{p.label}</span>
                      <span className="text-[10px] text-muted-foreground">({p.key})</span>
                    </div>
                  ))}
                </div>
              ) : data.role?.isMaster ? (
                <p className="text-xs text-muted-foreground">
                  The Master Platform role grants full platform administrative access across all modules.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
