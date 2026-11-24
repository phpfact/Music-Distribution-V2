"use client";

import { useState } from "react";
import { KeyRoundIcon, ShieldIcon, Trash2Icon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { PasswordChecklist, PasswordInput } from "@/components/shared";
import type { RoleOptionView } from "@/components/rbac/types";
import { changePlatformOwnerRoleAction, resetPlatformOwnerPasswordAction, deleteSubPlatformOwnerAction } from "../actions";

// ---------------------------------------------------------------------------
// 1. Change Role Dialog
// ---------------------------------------------------------------------------
export type ChangeRoleDialogProps = {
  user: { id: string; fullName: string; roleName: string } | null;
  open: boolean;
  roles: readonly RoleOptionView[];
  onClose: () => void;
  onSuccess: (msg: string) => void;
};

export function ChangeRoleDialog({ user, open, roles, onClose, onSuccess }: ChangeRoleDialogProps) {
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !selectedRole) return;
    setPending(true);
    setError(null);

    try {
      const res = await changePlatformOwnerRoleAction(user.id, selectedRole);
      if (res.ok) {
        onClose();
        onSuccess(res.message);
      } else {
        setError(res.error);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldIcon className="size-5 text-primary" aria-hidden="true" />
              Change Assigned Role
            </DialogTitle>
            <DialogDescription>
              Assign a new role to <strong>{user?.fullName}</strong>. Their access permissions will update immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {error ? (
              <p className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">{error}</p>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="change-role-select">Select New Role *</Label>
              <NativeSelect
                id="change-role-select"
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value)}
                required
              >
                <NativeSelectOption value="">Choose a role…</NativeSelectOption>
                {roles.map((r) => (
                  <NativeSelectOption key={r.id} value={r.id}>
                    {r.name} {r.isMaster ? "(Master)" : `(${r.privilegeCount ?? 0} perms)`}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!selectedRole || pending}>
              {pending ? "Updating Role…" : "Save Role"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 2. Reset Password Dialog
// ---------------------------------------------------------------------------
export type ResetPasswordDialogProps = {
  user: { id: string; fullName: string; username?: string | null } | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
};

export function ResetPasswordDialog({ user, open, onClose, onSuccess }: ResetPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setPending(true);
    setError(null);

    const formData = new FormData();
    formData.set("password", password);
    formData.set("confirmPassword", confirmPassword);

    try {
      const res = await resetPlatformOwnerPasswordAction(user.id, formData);
      if (res.ok) {
        setPassword("");
        setConfirmPassword("");
        onClose();
        onSuccess(res.message);
      } else {
        setError(res.error);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRoundIcon className="size-5 text-primary" aria-hidden="true" />
              Reset Password
            </DialogTitle>
            <DialogDescription>
              Set a new secure password for <strong>{user?.fullName}</strong>. This will revoke all their active sessions.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-4">
            {error ? (
              <p className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">{error}</p>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="reset-new-password">New Password *</Label>
              <PasswordInput
                id="reset-new-password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <PasswordChecklist
                id="reset-password-checklist"
                password={password}
                username={user?.username ?? ""}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="reset-confirm-password">Confirm New Password *</Label>
              <PasswordInput
                id="reset-confirm-password"
                name="confirmPassword"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={!password || !confirmPassword || pending}>
              {pending ? "Resetting…" : "Reset Password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// 3. Delete Platform Owner Dialog
// ---------------------------------------------------------------------------
export type DeletePlatformOwnerDialogProps = {
  user: { id: string; fullName: string; roleName: string } | null;
  open: boolean;
  onClose: () => void;
  onSuccess: (msg: string) => void;
};

export function DeletePlatformOwnerDialog({ user, open, onClose, onSuccess }: DeletePlatformOwnerDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!user) return;
    setPending(true);
    setError(null);

    try {
      const res = await deleteSubPlatformOwnerAction(user.id);
      if (res.ok) {
        onClose();
        onSuccess(res.message);
      } else {
        setError(res.error);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2Icon className="size-5" aria-hidden="true" />
            Delete Platform Owner
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to permanently delete <strong>{user?.fullName}</strong>?
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 text-sm text-muted-foreground">
          {error ? (
            <p className="mb-3 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">{error}</p>
          ) : null}
          <p>
            This action cannot be undone. All active sessions, preferences, and permissions assigned to this platform owner will be permanently removed.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleDelete} disabled={pending}>
            {pending ? "Deleting…" : "Delete Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
