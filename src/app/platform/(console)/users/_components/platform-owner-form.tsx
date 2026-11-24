"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useRef, useState, type FormEvent } from "react";
import {
  ConfirmDialog,
  describedBy,
  errorId,
  Field,
  FormActions,
  FormSection,
  Notice,
  PasswordChecklist,
  PasswordInput,
  RequiredLegend,
  SectionedLayout,
  SensitiveInput,
  Spinner,
  type SecondaryMenuItem,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { validateEmail, validateFullName, validateMasterPassword, validatePhone } from "@/lib/tenants/rules";
import type { RoleOptionView, SubUserFormState } from "@/components/rbac/types";

const SECTION_PERSONAL = "owner-personal";
const SECTION_SECURITY = "owner-security";
const MENU_ITEMS: readonly SecondaryMenuItem[] = [
  { id: SECTION_PERSONAL, label: "Personal Information", icon: "user" },
  { id: SECTION_SECURITY, label: "Access & Security", icon: "shield-check" },
];

export type PlatformOwnerInitial = {
  fullName: string;
  email: string | null;
  phone: string | null;
  roleId: string;
  status: "active" | "disabled";
};

export type PlatformOwnerFormProps = {
  mode: "create" | "edit";
  roles: readonly RoleOptionView[];
  initial?: PlatformOwnerInitial;
  action: (state: SubUserFormState, formData: FormData) => Promise<SubUserFormState>;
  cancelHref: string;
};

const INITIAL_STATE: SubUserFormState = { status: "idle" };

/**
 * Description: Dedicated create and edit form for Platform Owners with the required fields:
 *   Full Name, Email Address, Mobile Number, Password, Confirm Password, Select Role, Account Status.
 * Input: mode, assignable roles, initial values, bound Server Action, cancel link.
 * Output: Complete sectioned form with secondary navigation and instant validation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-11-24
 * Last modified: 2026-11-24
 */
export function PlatformOwnerForm({ mode, roles, initial, action, cancelHref }: PlatformOwnerFormProps) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(action, INITIAL_STATE);

  const [fullName, setFullName] = useState(initial?.fullName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [roleId, setRoleId] = useState(initial?.roleId ?? "");
  const [status, setStatus] = useState<"active" | "disabled">(initial?.status ?? "active");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const [confirmLeave, setConfirmLeave] = useState(false);
  const submitting = useRef(false);

  function errorOf(name: string): string | undefined {
    return clientErrors[name] ?? (state.status === "error" ? state.fieldErrors[name as keyof typeof state.fieldErrors] : undefined);
  }

  function validate(): boolean {
    const errors: Record<string, string> = {};

    const fnCheck = validateFullName(fullName);
    if (!fnCheck.ok) errors.fullName = fnCheck.error;

    if (!email.trim()) {
      errors.email = "Enter the email address.";
    } else {
      const emCheck = validateEmail(email);
      if (!emCheck.ok) errors.email = emCheck.error;
    }

    if (!phone.trim()) {
      errors.phone = "Enter the mobile number.";
    } else {
      const phCheck = validatePhone(phone);
      if (!phCheck.ok) errors.phone = phCheck.error;
    }

    if (!roleId) {
      errors.roleId = "Select a mandatory role for this platform owner.";
    }

    if (mode === "create" || password || confirmPassword) {
      if (!password) {
        errors.password = "Enter a password.";
      } else {
        const pwCheck = validateMasterPassword(password, email.split("@")[0] || "admin");
        if (!pwCheck.ok) errors.password = pwCheck.error;
      }

      if (!confirmPassword) {
        errors.confirmPassword = "Confirm the password.";
      } else if (password !== confirmPassword) {
        errors.confirmPassword = "The passwords do not match.";
      }
    }

    setClientErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || submitting.current) return;

    if (!validate()) {
      return;
    }

    submitting.current = true;
    const formData = new FormData();
    formData.set("fullName", fullName.trim());
    formData.set("email", email.trim());
    formData.set("phone", phone.trim());
    formData.set("roleId", roleId);
    formData.set("status", status);
    if (password) formData.set("password", password);
    if (confirmPassword) formData.set("confirmPassword", confirmPassword);

    startTransition(() => dispatch(formData));
  }

  function handleCancel() {
    const isDirty =
      fullName !== (initial?.fullName ?? "") ||
      email !== (initial?.email ?? "") ||
      phone !== (initial?.phone ?? "") ||
      roleId !== (initial?.roleId ?? "") ||
      status !== (initial?.status ?? "active") ||
      Boolean(password);

    if (isDirty) {
      setConfirmLeave(true);
      return;
    }
    router.push(cancelHref);
  }

  return (
    <SectionedLayout items={MENU_ITEMS} label="Form sections">
      <form onSubmit={handleSubmit} noValidate aria-busy={pending || undefined} className="flex flex-col gap-6">
        {state.status === "error" && state.formMessage ? (
          <Notice variant="error">{state.formMessage}</Notice>
        ) : null}

        {/* Personal Information */}
        <FormSection
          id={SECTION_PERSONAL}
          icon="user"
          title="Personal Information"
          description="Owner name, contact details, and account active status."
        >
          <Field label="Full Name" htmlFor="owner-fullName" required error={errorOf("fullName")}>
            <Input
              id="owner-fullName"
              name="fullName"
              value={fullName}
              placeholder="e.g. Vikram Malhotra"
              onChange={(e) => {
                setFullName(e.target.value);
                setClientErrors((cur) => ({ ...cur, fullName: "" }));
              }}
              required
            />
          </Field>

          <Field label="Email Address" htmlFor="owner-email" required error={errorOf("email")}>
            <SensitiveInput
              id="owner-email"
              noun="email"
              name="email"
              inputMode="email"
              value={email}
              placeholder="e.g. vikram@platform.com"
              onChange={(e) => {
                setEmail(e.target.value);
                setClientErrors((cur) => ({ ...cur, email: "" }));
              }}
              hasError={Boolean(errorOf("email"))}
            />
          </Field>

          <Field label="Mobile Number" htmlFor="owner-phone" required error={errorOf("phone")} hint="10-digit mobile number">
            <SensitiveInput
              id="owner-phone"
              noun="phone"
              name="phone"
              inputMode="tel"
              value={phone}
              placeholder="e.g. 9876543210"
              onChange={(e) => {
                setPhone(e.target.value);
                setClientErrors((cur) => ({ ...cur, phone: "" }));
              }}
              hasError={Boolean(errorOf("phone"))}
            />
          </Field>

          <div className="flex flex-col gap-2">
            <Label id="owner-status-label">
              Account Status <span className="text-destructive">*</span>
            </Label>
            <RadioGroup
              value={status}
              onValueChange={(val) => setStatus(val as "active" | "disabled")}
              className="grid gap-2 sm:grid-cols-2"
              aria-labelledby="owner-status-label"
            >
              <Label
                htmlFor="owner-status-active"
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-accent/50",
                  status === "active" ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <RadioGroupItem id="owner-status-active" value="active" className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Active</span>
                  <span className="text-xs text-muted-foreground">Account can immediately log in and access permitted features.</span>
                </span>
              </Label>

              <Label
                htmlFor="owner-status-disabled"
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-accent/50",
                  status === "disabled" ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <RadioGroupItem id="owner-status-disabled" value="disabled" className="mt-0.5" />
                <span className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Inactive / Deactivated</span>
                  <span className="text-xs text-muted-foreground">Account is suspended and cannot log in to the console.</span>
                </span>
              </Label>
            </RadioGroup>
          </div>
        </FormSection>

        {/* Access & Security */}
        <FormSection
          id={SECTION_SECURITY}
          icon="shield-check"
          title="Access & Security"
          description="Assign a mandatory role and establish secure credentials."
        >
          <Field
            label="Select Role"
            htmlFor="owner-roleId"
            required
            error={errorOf("roleId")}
            hint="Role selection is mandatory. The owner will strictly receive permissions permitted by this role."
          >
            <NativeSelect
              id="owner-roleId"
              name="roleId"
              value={roleId}
              onChange={(e) => {
                setRoleId(e.target.value);
                setClientErrors((c) => ({ ...c, roleId: "" }));
              }}
              required
            >
              <NativeSelectOption value="">Select an assigned role…</NativeSelectOption>
              {roles.map((r) => (
                <NativeSelectOption key={r.id} value={r.id}>
                  {r.name} {r.isMaster ? "(Master Admin)" : `(${r.privilegeCount ?? 0} privileges)`}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>

          {mode === "edit" ? (
            <div className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
              Leave password fields empty to keep the existing password. Entering a new password will revoke all active sessions.
            </div>
          ) : null}

          <Field
            label={mode === "create" ? "Password" : "New Password (Optional)"}
            htmlFor="owner-password"
            required={mode === "create"}
            error={errorOf("password")}
          >
            <PasswordInput
              id="owner-password"
              name="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setClientErrors((c) => ({ ...c, password: "" })); }}
              autoComplete="new-password"
            />
            {password ? (
              <PasswordChecklist
                id="owner-password-checklist"
                password={password}
                username={email.split("@")[0] || "admin"}
              />
            ) : null}
          </Field>

          <Field
            label={mode === "create" ? "Confirm Password" : "Confirm New Password"}
            htmlFor="owner-confirmPassword"
            required={mode === "create" || Boolean(password)}
            error={errorOf("confirmPassword")}
          >
            <PasswordInput
              id="owner-confirmPassword"
              name="confirmPassword"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setClientErrors((c) => ({ ...c, confirmPassword: "" })); }}
              autoComplete="new-password"
            />
          </Field>
        </FormSection>

        <FormActions>
          <Button type="button" variant="outline" onClick={handleCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner className="mr-2" /> : null}
            {mode === "create" ? (pending ? "Creating Platform Owner…" : "Create Platform Owner") : (pending ? "Saving Changes…" : "Save Changes")}
          </Button>
        </FormActions>
      </form>

      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Discard unsaved changes?"
        description="You have unsaved changes. Leaving now will lose them."
        confirmLabel="Discard changes"
        confirmVariant="danger"
        onConfirm={() => router.push(cancelHref)}
      />
    </SectionedLayout>
  );
}
