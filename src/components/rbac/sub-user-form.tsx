"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
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
import {
  SUB_USER_TRIMMED_FIELDS,
  subUserFieldError,
  subUserFieldsFor,
  validateSubUserFields,
  type SubUserFieldErrors,
  type SubUserFieldName,
  type SubUserFields,
  type SubUserMode,
  type SubUserVariant,
} from "@/lib/authz/sub-user-rules";
import { EMAIL_MAX_LENGTH, FULL_NAME_MAX_LENGTH, MASTER_PASSWORD_MAX_LENGTH, TENANT_USERNAME_MAX_LENGTH } from "@/lib/tenants/rules";
import { cn } from "@/lib/utils";
import { ACCOUNT_TYPE_OPTIONS, accountTypeLabel } from "@/lib/workspace/rules";
import { ROLE_PICKER_HINT, RolePicker } from "./role-picker";
import type { AccountTypeValue, LoadRoleOptions, RoleOptionView, SubUserFormState } from "./types";

// The section ids of the form (one form per page) and its secondary menu.
const SECTION_PERSONAL = "sub-user-personal";
const SECTION_LOGIN    = "sub-user-login";
const SECTION_ACCESS   = "sub-user-access";
const MENU_ITEMS: readonly SecondaryMenuItem[] = [
  { id: SECTION_PERSONAL, label: "Personal Information", icon: "user" },
  { id: SECTION_LOGIN, label: "Login Information", icon: "key-round" },
  { id: SECTION_ACCESS, label: "Access", icon: "shield-check" },
];

// The submit button text per variant: [idle, pending] (spec: "Create sub-tenant" → "Creating…").
const CREATE_LABELS: Record<SubUserVariant, string> = {
  platform: "Create Sub-Platform Owner",
  tenant: "Create sub-tenant",
  customer: "Create sub-customer",
};

const INITIAL_STATE: SubUserFormState = { status: "idle" };

/** The saved values an edit form is prefilled with. */
export type SubUserInitial = {
  fullName: string;
  username: string;
  /** Null for platform owners. */
  email: string | null;
  /** Sub-customers only. */
  accountType?: AccountTypeValue;
  roleId: string;
};

export type SubUserFormProps = {
  variant: SubUserVariant;
  mode: SubUserMode;
  /** Active roles the actor may assign (exactly one is submitted as `roleId`). */
  roles: readonly RoleOptionView[];
  /** Scoped search and paging for options outside the initial page. */
  loadRoles?: LoadRoleOptions;
  /** While the role list is still loading (the picker shows "Loading…" and stays disabled). */
  rolesLoading?: boolean;
  /** Saved values (edit) — required on edit. */
  initial?: SubUserInitial;
  /** The panel's bound Server Action (useActionState signature); redirects on success. */
  action: (state: SubUserFormState, formData: FormData) => Promise<SubUserFormState>;
  /** Where Cancel goes (the sub-users list). */
  cancelHref: string;
};

/**
 * Description: The DOM id of a field's control.
 * Input: The field name.
 * Output: "sub-user-<field>".
 * Use case: Labels, errors, focus targets.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function fieldId(name: SubUserFieldName): string {
  return `sub-user-${name}`;
}

/**
 * Description: Scroll a field into view and focus it (reduced-motion aware).
 * Input: The field name.
 * Output: The field's control (first radio for the account type) is centred and focused.
 * Use case: After failed client or server validation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function focusField(name: SubUserFieldName) {
  const target =
    name === "accountType"
      ? document.querySelector<HTMLElement>(`#${fieldId("accountType")} [role="radio"]`)
      : document.getElementById(fieldId(name));
  if (!target) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
}

/**
 * Description: The sub-user create/edit form shared by the three panels (UI spec "Sub-user form").
 * Input: See SubUserFormProps: variant (platform / tenant / customer), mode
 *   (create / edit), assignable roles, initial values, the bound Server Action
 *   and the Cancel link.
 * Output: A sectioned form with the sidebar secondary menu:
 *   - Personal Information: Full name *; sub-customers also Account type *.
 *   - Login Information: Username * and Email * (tenant/customer; masked with
 *     an eye toggle), Password * + Confirm password * with eye toggles and the
 *     shared password checklist. Edit: username (and email / account type)
 *     read-only, and an optional "Set a new password" pair.
 *   - Access: Role * — searchable single-role picker (`roleId`) with the
 *     helper "Exactly one role. It takes effect on the user's next request."
 *   Sticky actions ("Create sub-tenant" → "Creating…", edit "Save changes" →
 *   "Saving…") with a duplicate-submit guard. Live validation with the shared
 *   rules (trimmed where spaces are meaningless, whitespace-only rejected),
 *   errors under each field, first invalid field scrolled into view and
 *   focused, values kept after server errors (passwords are cleared).
 * Use case: /platform/users/new|[id]/edit, /tenant/users/new|[id]/edit,
 *   /customer/sub-customers/new|[id]/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function SubUserForm({ variant, mode, roles, loadRoles, rolesLoading = false, initial, action, cancelHref }: SubUserFormProps) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(action, INITIAL_STATE);

  // The fields this variant/mode shows and submits (shared with the server).
  const visibleFields = subUserFieldsFor(variant, mode);
  const shows         = (name: SubUserFieldName) => visibleFields.includes(name);
  const startValues: SubUserFields = {
    fullName: initial?.fullName ?? "",
    accountType: initial?.accountType ?? "",
    username: initial?.username ?? "",
    email: initial?.email ?? "",
    password: "",
    confirmPassword: "",
    roleId: initial?.roleId ?? "",
  };

  // Step 1: controlled values (prefilled on edit), kept after every server answer.
  const [fields, setFields]             = useState<SubUserFields>(startValues);
  const [clientErrors, setClientErrors] = useState<SubUserFieldErrors>({});
  const [serverErrors, setServerErrors] = useState<SubUserFieldErrors>({});
  const [handledState, setHandledState] = useState(state);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Synchronous guard against a second submit before React re-renders.
  const submitting = useRef(false);

  // The stored username (edit): the new password must not contain it.
  const existingUsername = initial?.username ?? "";

  // A new Server Action result, handled once while rendering. Passwords are never kept.
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "error") {
      setServerErrors(state.fieldErrors);
      setClientErrors({});
      setFields((current) => ({ ...current, password: "", confirmPassword: "" }));
    }
  }

  // Focus the first field the server rejected (reads the current visible fields).
  const focusFirstServerError = useEffectEvent((errors: SubUserFieldErrors) => {
    const first = visibleFields.find((name) => errors[name]);
    if (first) focusField(first);
  });

  // After a server answer: release the submit guard and focus the first invalid field.
  useEffect(() => {
    submitting.current = false;
    if (state.status === "error") focusFirstServerError(state.fieldErrors);
  }, [state]);

  /**
   * Description: The error currently shown for a field.
   * Input: The field.
   * Output: The live client error, else the last server error, else undefined.
   * Use case: Every field's error message and ARIA wiring.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function errorOf(name: SubUserFieldName): string | undefined {
    return clientErrors[name] ?? serverErrors[name];
  }

  /**
   * Description: Change one value and keep its error current.
   * Input: The field and its new value.
   * Output: Updated values; a field that shows an error is re-checked live, and
   *   the confirmation follows the password.
   * Use case: onChange of every field.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function change(name: SubUserFieldName, value: string) {
    const next = { ...fields, [name]: value };
    setFields(next);
    setServerErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
    if (errorOf(name)) {
      setClientErrors((current) => ({ ...current, [name]: subUserFieldError(name, next, mode, existingUsername) }));
    }
    if (name === "password" && errorOf("confirmPassword")) {
      setClientErrors((current) => ({
        ...current,
        confirmPassword: subUserFieldError("confirmPassword", next, mode, existingUsername),
      }));
    }
  }

  /**
   * Description: Validate a field when it loses focus (trimming text fields first).
   * Input: The field.
   * Output: The field's error shown or cleared.
   * Use case: onBlur of every field.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function blur(name: SubUserFieldName) {
    const next = SUB_USER_TRIMMED_FIELDS.includes(name) ? { ...fields, [name]: fields[name].trim() } : fields;
    if (next !== fields) setFields(next);
    setClientErrors((current) => ({ ...current, [name]: subUserFieldError(name, next, mode, existingUsername) }));
  }

  /**
   * Description: Validate and send the form once.
   * Input: The submit event.
   * Output: Invalid: errors under each field, first invalid field focused,
   *   nothing sent. Valid: the FormData (trimmed values of the visible fields)
   *   is dispatched inside a transition; repeat submits are ignored.
   * Use case: The form's onSubmit.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || submitting.current) return;

    // Step 1: trim where spaces are meaningless.
    const trimmed = { ...fields };
    for (const name of SUB_USER_TRIMMED_FIELDS) trimmed[name] = trimmed[name].trim();
    setFields(trimmed);

    // Step 2: the same rules as the server.
    const errors = validateSubUserFields(trimmed, variant, mode, existingUsername);
    setClientErrors(errors);
    const first = visibleFields.find((name) => errors[name]);
    if (first) {
      focusField(first);
      return;
    }

    // Step 3: send exactly the visible fields (one roleId).
    const formData = new FormData();
    for (const name of visibleFields) formData.set(name, trimmed[name]);
    submitting.current = true;
    setServerErrors({});
    startTransition(() => dispatch(formData));
  }

  /**
   * Description: Leave the form, asking first when something was entered.
   * Input: None.
   * Output: The discard confirmation when values differ from the start; otherwise navigation.
   * Use case: The Cancel button.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function requestCancel() {
    const dirty = visibleFields.some((name) => fields[name] !== startValues[name]);
    if (dirty) {
      setConfirmLeave(true);
      return;
    }
    router.push(cancelHref);
  }

  const submitLabel  = mode === "create" ? CREATE_LABELS[variant] : "Save changes";
  const pendingLabel = mode === "create" ? "Creating…" : "Saving…";
  const passwordId   = fieldId("password");
  const checklistId  = `${passwordId}-checklist`;
  const required     = mode === "create";

  return (
    <SectionedLayout items={MENU_ITEMS} label="Form sections">
      <form onSubmit={handleSubmit} noValidate aria-busy={pending || undefined} className="flex flex-col gap-6">
        {state.status === "error" && state.formMessage ? <Notice variant="error">{state.formMessage}</Notice> : null}

        {/* Personal Information ------------------------------------------- */}
        <FormSection id={SECTION_PERSONAL} icon="user" title="Personal Information" description="Who this account belongs to.">
          <Field label="Full name" htmlFor={fieldId("fullName")} required error={errorOf("fullName")}>
            <Input
              id={fieldId("fullName")}
              name="fullName"
              autoComplete="name"
              maxLength={FULL_NAME_MAX_LENGTH}
              value={fields.fullName}
              placeholder="e.g. Asha Rao"
              aria-required="true"
              onChange={(event) => change("fullName", event.currentTarget.value)}
              onBlur={() => blur("fullName")}
              {...describedBy(fieldId("fullName"), { error: errorOf("fullName") })}
            />
          </Field>

          {variant === "customer" && shows("accountType") ? (
            <div className="flex flex-col gap-2">
              <Label id={`${fieldId("accountType")}-label`}>
                Account type
                <span aria-hidden="true" className="ml-0.5 text-destructive">
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </Label>
              <RadioGroup
                id={fieldId("accountType")}
                name="accountType"
                value={fields.accountType}
                onValueChange={(value) => {
                  change("accountType", value);
                  setClientErrors((current) => ({ ...current, accountType: undefined }));
                }}
                aria-labelledby={`${fieldId("accountType")}-label`}
                aria-required="true"
                aria-invalid={errorOf("accountType") ? true : undefined}
                aria-describedby={errorOf("accountType") ? errorId(fieldId("accountType")) : undefined}
                className="grid gap-2 md:grid-cols-3"
              >
                {ACCOUNT_TYPE_OPTIONS.map((option) => {
                  const optionId = `${fieldId("accountType")}-${option.value}`;
                  return (
                    <Label
                      key={option.value}
                      htmlFor={optionId}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-accent/50",
                        fields.accountType === option.value ? "border-primary bg-primary/5" : "border-border",
                      )}
                    >
                      <RadioGroupItem id={optionId} value={option.value} className="mt-0.5" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-medium">{option.label}</span>
                        <span className="text-xs leading-5 text-muted-foreground">{option.description}</span>
                      </span>
                    </Label>
                  );
                })}
              </RadioGroup>
              {errorOf("accountType") ? (
                <p id={errorId(fieldId("accountType"))} className="text-sm text-destructive">
                  {errorOf("accountType")}
                </p>
              ) : null}
            </div>
          ) : null}

          {variant === "customer" && mode === "edit" && initial?.accountType ? (
            <Field label="Account type" htmlFor={fieldId("accountType")} hint="The account type cannot be changed.">
              <Input id={fieldId("accountType")} value={accountTypeLabel(initial.accountType)} readOnly aria-readonly="true" />
            </Field>
          ) : null}
        </FormSection>

        {/* Login Information ---------------------------------------------- */}
        <FormSection
          id={SECTION_LOGIN}
          icon="key-round"
          title="Login Information"
          description={mode === "create" ? "How this person signs in." : "The username cannot be changed. Set a new password only when needed."}
        >
          {shows("username") ? (
            <Field
              label="Username"
              htmlFor={fieldId("username")}
              required
              hint="3–64 characters: lower-case letters, digits, dots, hyphens or underscores."
              error={errorOf("username")}
            >
              <SensitiveInput
                id={fieldId("username")}
                noun="username"
                name="username"
                autoComplete="off"
                maxLength={TENANT_USERNAME_MAX_LENGTH}
                value={fields.username}
                placeholder="e.g. asharao"
                aria-required="true"
                hasError={Boolean(errorOf("username"))}
                onChange={(event) => change("username", event.currentTarget.value)}
                onBlur={() => blur("username")}
                {...describedBy(fieldId("username"), { hint: true, error: errorOf("username") })}
              />
            </Field>
          ) : (
            <Field label="Username" htmlFor={fieldId("username")} hint="The username cannot be changed.">
              <SensitiveInput id={fieldId("username")} noun="username" value={existingUsername} readOnly aria-readonly="true" />
            </Field>
          )}

          {shows("email") ? (
            <Field label="Email" htmlFor={fieldId("email")} required error={errorOf("email")}>
              <SensitiveInput
                id={fieldId("email")}
                noun="email"
                name="email"
                inputMode="email"
                autoComplete="off"
                maxLength={EMAIL_MAX_LENGTH}
                value={fields.email}
                placeholder="name@example.com"
                aria-required="true"
                hasError={Boolean(errorOf("email"))}
                onChange={(event) => change("email", event.currentTarget.value)}
                onBlur={() => blur("email")}
                {...describedBy(fieldId("email"), { error: errorOf("email") })}
              />
            </Field>
          ) : variant !== "platform" && mode === "edit" ? (
            <Field label="Email" htmlFor={fieldId("email")} hint="The email cannot be changed here.">
              <SensitiveInput id={fieldId("email")} noun="email" value={initial?.email ?? ""} readOnly aria-readonly="true" />
            </Field>
          ) : null}

          {mode === "edit" ? (
            <div>
              <h3 className="text-sm font-semibold text-foreground">Set a new password</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Optional. Leave both fields empty to keep the current password. A new password signs this person out everywhere.
              </p>
            </div>
          ) : null}

          <Field label={mode === "create" ? "Password" : "New password"} htmlFor={passwordId} required={required} error={errorOf("password")}>
            <PasswordInput
              id={passwordId}
              name="password"
              autoComplete="new-password"
              maxLength={MASTER_PASSWORD_MAX_LENGTH}
              value={fields.password}
              aria-required={required || undefined}
              hasError={Boolean(errorOf("password"))}
              onChange={(event) => change("password", event.currentTarget.value)}
              onBlur={() => blur("password")}
              aria-describedby={[checklistId, errorOf("password") ? errorId(passwordId) : null].filter(Boolean).join(" ")}
            />
            <PasswordChecklist
              id={checklistId}
              password={fields.password}
              username={(mode === "edit" ? existingUsername : fields.username).trim().toLowerCase()}
            />
          </Field>

          <Field
            label={mode === "create" ? "Confirm password" : "Confirm new password"}
            htmlFor={fieldId("confirmPassword")}
            required={required}
            error={errorOf("confirmPassword")}
          >
            <PasswordInput
              id={fieldId("confirmPassword")}
              name="confirmPassword"
              autoComplete="new-password"
              maxLength={MASTER_PASSWORD_MAX_LENGTH}
              value={fields.confirmPassword}
              aria-required={required || undefined}
              hasError={Boolean(errorOf("confirmPassword"))}
              onChange={(event) => change("confirmPassword", event.currentTarget.value)}
              onBlur={() => blur("confirmPassword")}
              {...describedBy(fieldId("confirmPassword"), { error: errorOf("confirmPassword") })}
            />
          </Field>
        </FormSection>

        {/* Access ------------------------------------------------------------ */}
        <FormSection id={SECTION_ACCESS} icon="shield-check" title="Access" description="The single role decides everything this person can do.">
          <Field label="Role" htmlFor={fieldId("roleId")} required hint={ROLE_PICKER_HINT} error={errorOf("roleId")}>
            <RolePicker
              id={fieldId("roleId")}
              roles={roles}
              loadRoles={loadRoles}
              value={fields.roleId}
              onValueChange={(value) => {
                change("roleId", value);
                setClientErrors((current) => ({ ...current, roleId: undefined }));
              }}
              onBlur={() => blur("roleId")}
              loading={rolesLoading}
              invalid={Boolean(errorOf("roleId"))}
              aria-describedby={describedBy(fieldId("roleId"), { hint: true, error: errorOf("roleId") })["aria-describedby"]}
            />
          </Field>
        </FormSection>

        <FormActions note={<RequiredLegend />}>
          <Button type="button" variant="outline" onClick={requestCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
            {pending ? <Spinner size="sm" /> : null}
            {pending ? pendingLabel : submitLabel}
          </Button>
        </FormActions>
      </form>

      {/* Outside the form, so its own form never submits this one. */}
      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Discard your changes?"
        description="Everything you entered on this form will be lost."
        confirmLabel="Discard and leave"
        confirmVariant="danger"
        onConfirm={() => {
          setConfirmLeave(false);
          router.push(cancelHref);
        }}
      />
    </SectionedLayout>
  );
}
