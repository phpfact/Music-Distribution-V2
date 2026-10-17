"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import {
  AccountTypeField,
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
import { MasterBadge } from "@/components/rbac/role-badges";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EMAIL_MAX_LENGTH, FULL_NAME_MAX_LENGTH, MASTER_PASSWORD_MAX_LENGTH, TENANT_USERNAME_MAX_LENGTH } from "@/lib/tenants/rules";
import {
  CUSTOMER_FIELD_ORDER,
  CUSTOMER_TRIMMED_FIELDS,
  customerFieldError,
  validateCustomerFields,
  type CustomerFieldErrors,
  type CustomerFieldName,
  type CustomerFields,
  type CustomerFormState,
} from "@/lib/workspace/customer-rules";

// The section ids of the form (one form per page) and its secondary menu
// (CLAUDE.md category-wise form organization).
const SECTION_PERSONAL = "customer-personal";
const SECTION_LOGIN    = "customer-login";
const SECTION_ACCESS   = "customer-access";
const MENU_ITEMS: readonly SecondaryMenuItem[] = [
  { id: SECTION_PERSONAL, label: "Personal Information", icon: "user" },
  { id: SECTION_LOGIN, label: "Login Information", icon: "key-round" },
  { id: SECTION_ACCESS, label: "Access", icon: "shield-check" },
];

const INITIAL_STATE: CustomerFormState = { status: "idle" };

// A new form starts empty.
const EMPTY_FIELDS: CustomerFields = {
  fullName: "",
  accountType: "",
  username: "",
  email: "",
  password: "",
  confirmPassword: "",
};

type CustomerFormProps = {
  /** The bound Server Action (useActionState signature); redirects to the list on success. */
  action: (state: CustomerFormState, formData: FormData) => Promise<CustomerFormState>;
  /** Where Cancel goes (the customers list). */
  cancelHref: string;
};

/**
 * Description: The DOM id of a field's control.
 * Input: The field name.
 * Output: "customer-<field>".
 * Use case: Labels, errors, focus targets.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function fieldId(name: CustomerFieldName): string {
  return `customer-${name}`;
}

/**
 * Description: Scroll a field into view and focus it (reduced-motion aware).
 * Input: The field name.
 * Output: The field's control (the first radio for the account type) is centred and focused.
 * Use case: After failed client or server validation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function focusField(name: CustomerFieldName) {
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
 * Description: The tenant's "Add customer" form.
 * Input: The bound Server Action and the Cancel link.
 * Output: A sectioned form with the sidebar secondary menu:
 *   - Personal Information: Full name *, Account type * (Artist / Label / White Label).
 *   - Login Information: Username * and Email * (masked with an eye toggle),
 *     Password * + Confirm password * (eye toggles, shared live checklist).
 *   - Access: read-only — the account is the customer's primary account with
 *     the Master Customer role (no role is chosen here).
 *   Sticky actions ("Create customer" → "Creating…") with a duplicate-submit
 *   guard. Live validation with the shared rules (trimmed where spaces are
 *   meaningless, whitespace-only rejected), errors under each field (server
 *   errors too), first invalid field scrolled into view and focused, values
 *   kept after server errors (passwords cleared), Cancel asks before
 *   discarding typed values.
 * Use case: /tenant/customers/new.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function CustomerForm({ action, cancelHref }: CustomerFormProps) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(action, INITIAL_STATE);

  // Step 1: controlled values, kept after every server answer (CLAUDE.md "preserve input").
  const [fields, setFields]             = useState<CustomerFields>(EMPTY_FIELDS);
  const [clientErrors, setClientErrors] = useState<CustomerFieldErrors>({});
  const [serverErrors, setServerErrors] = useState<CustomerFieldErrors>({});
  const [handledState, setHandledState] = useState(state);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Synchronous guard against a second submit before React re-renders.
  const submitting = useRef(false);

  // A new Server Action result, handled once while rendering. Passwords are never kept.
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "error") {
      setServerErrors(state.fieldErrors);
      setClientErrors({});
      setFields((current) => ({ ...current, password: "", confirmPassword: "" }));
    }
  }

  // Focus the first field the server rejected.
  const focusFirstServerError = useEffectEvent((errors: CustomerFieldErrors) => {
    const first = CUSTOMER_FIELD_ORDER.find((name) => errors[name]);
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
   * Created: 2026-10-17
   * Last modified: 2026-10-17
   */
  function errorOf(name: CustomerFieldName): string | undefined {
    return clientErrors[name] ?? serverErrors[name];
  }

  /**
   * Description: Change one value and keep its error current.
   * Input: The field and its new value.
   * Output: Updated values; a field that shows an error is re-checked live, and
   *   the confirmation follows the password.
   * Use case: onChange of every field.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-17
   * Last modified: 2026-10-17
   */
  function change(name: CustomerFieldName, value: string) {
    const next = { ...fields, [name]: value };
    setFields(next);
    setServerErrors((current) => (current[name] ? { ...current, [name]: undefined } : current));
    if (errorOf(name)) setClientErrors((current) => ({ ...current, [name]: customerFieldError(name, next) }));
    if (name === "password" && errorOf("confirmPassword")) {
      setClientErrors((current) => ({ ...current, confirmPassword: customerFieldError("confirmPassword", next) }));
    }
  }

  /**
   * Description: Validate a field when it loses focus (trimming text fields first).
   * Input: The field.
   * Output: The field's error shown or cleared.
   * Use case: onBlur of every field.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-17
   * Last modified: 2026-10-17
   */
  function blur(name: CustomerFieldName) {
    const next = CUSTOMER_TRIMMED_FIELDS.includes(name) ? { ...fields, [name]: fields[name].trim() } : fields;
    if (next !== fields) setFields(next);
    setClientErrors((current) => ({ ...current, [name]: customerFieldError(name, next) }));
  }

  /**
   * Description: Validate and send the form once.
   * Input: The submit event.
   * Output: Invalid: errors under each field, first invalid field focused,
   *   nothing sent. Valid: the FormData (trimmed values of the six fields) is
   *   dispatched inside a transition; repeat submits are ignored.
   * Use case: The form's onSubmit.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-17
   * Last modified: 2026-10-17
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || submitting.current) return;

    // Step 1: trim where spaces are meaningless.
    const trimmed = { ...fields };
    for (const name of CUSTOMER_TRIMMED_FIELDS) trimmed[name] = trimmed[name].trim();
    setFields(trimmed);

    // Step 2: the same rules as the server.
    const result = validateCustomerFields(trimmed);
    if (!result.ok) {
      setClientErrors(result.fieldErrors);
      const first = CUSTOMER_FIELD_ORDER.find((name) => result.fieldErrors[name]);
      if (first) focusField(first);
      return;
    }

    // Step 3: send exactly the form's fields.
    const formData = new FormData();
    for (const name of CUSTOMER_FIELD_ORDER) formData.set(name, trimmed[name]);
    submitting.current = true;
    setClientErrors({});
    setServerErrors({});
    startTransition(() => dispatch(formData));
  }

  /**
   * Description: Leave the form, asking first when something was entered.
   * Input: None.
   * Output: The discard confirmation when any value was typed; otherwise navigation.
   * Use case: The Cancel button.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-17
   * Last modified: 2026-10-17
   */
  function requestCancel() {
    const dirty = CUSTOMER_FIELD_ORDER.some((name) => fields[name] !== EMPTY_FIELDS[name]);
    if (dirty) {
      setConfirmLeave(true);
      return;
    }
    router.push(cancelHref);
  }

  const passwordId  = fieldId("password");
  const checklistId = `${passwordId}-checklist`;

  return (
    <SectionedLayout items={MENU_ITEMS} label="Form sections">
      <form onSubmit={handleSubmit} noValidate aria-busy={pending || undefined} className="flex flex-col gap-6">
        {state.status === "error" && state.formMessage ? <Notice variant="error">{state.formMessage}</Notice> : null}

        {/* Personal Information ------------------------------------------- */}
        <FormSection id={SECTION_PERSONAL} icon="user" title="Personal Information" description="Who this customer is.">
          <Field label="Full name" htmlFor={fieldId("fullName")} required error={errorOf("fullName")}>
            <Input
              id={fieldId("fullName")}
              name="fullName"
              autoComplete="off"
              maxLength={FULL_NAME_MAX_LENGTH}
              value={fields.fullName}
              placeholder="e.g. Asha Rao or Moonlight Records"
              aria-required="true"
              onChange={(event) => change("fullName", event.currentTarget.value)}
              onBlur={() => blur("fullName")}
              {...describedBy(fieldId("fullName"), { error: errorOf("fullName") })}
            />
          </Field>

          <AccountTypeField
            id={fieldId("accountType")}
            name="accountType"
            value={fields.accountType}
            onValueChange={(value) => {
              change("accountType", value);
              setClientErrors((current) => ({ ...current, accountType: undefined }));
            }}
            error={errorOf("accountType")}
            className="md:grid-cols-3"
          />
        </FormSection>

        {/* Login Information ---------------------------------------------- */}
        <FormSection
          id={SECTION_LOGIN}
          icon="key-round"
          title="Login Information"
          description="How the customer logs in. Share these details with them yourself."
        >
          <Field
            label="Username"
            htmlFor={fieldId("username")}
            required
            hint="3–64 characters: lower-case letters, digits, dots, hyphens or underscores."
            error={errorOf("username")}
          >
            {/* Login details are sensitive: masked until the eye button reveals them. */}
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

          <Field label="Password" htmlFor={passwordId} required error={errorOf("password")}>
            <PasswordInput
              id={passwordId}
              name="password"
              autoComplete="new-password"
              maxLength={MASTER_PASSWORD_MAX_LENGTH}
              value={fields.password}
              aria-required="true"
              hasError={Boolean(errorOf("password"))}
              onChange={(event) => change("password", event.currentTarget.value)}
              onBlur={() => blur("password")}
              aria-describedby={[checklistId, errorOf("password") ? errorId(passwordId) : null].filter(Boolean).join(" ")}
            />
            <PasswordChecklist id={checklistId} password={fields.password} username={fields.username.trim().toLowerCase()} />
          </Field>

          <Field label="Confirm password" htmlFor={fieldId("confirmPassword")} required error={errorOf("confirmPassword")}>
            <PasswordInput
              id={fieldId("confirmPassword")}
              name="confirmPassword"
              autoComplete="new-password"
              maxLength={MASTER_PASSWORD_MAX_LENGTH}
              value={fields.confirmPassword}
              aria-required="true"
              hasError={Boolean(errorOf("confirmPassword"))}
              onChange={(event) => change("confirmPassword", event.currentTarget.value)}
              onBlur={() => blur("confirmPassword")}
              {...describedBy(fieldId("confirmPassword"), { error: errorOf("confirmPassword") })}
            />
          </Field>
        </FormSection>

        {/* Access (read-only) ----------------------------------------------- */}
        <FormSection
          id={SECTION_ACCESS}
          icon="shield-check"
          title="Access"
          description="Decided by the platform's rules, not chosen here."
        >
          <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-4 text-sm">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              Master Customer
              <MasterBadge />
            </p>
            <p className="text-muted-foreground">
              The account becomes this customer&apos;s primary account with every customer privilege. The customer can
              then add their own sub-customers and roles in their panel. Nothing here gives access to your workspace.
            </p>
          </div>
        </FormSection>

        <FormActions note={<RequiredLegend />}>
          <Button type="button" variant="outline" onClick={requestCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
            {pending ? <Spinner size="sm" /> : null}
            {pending ? "Creating…" : "Create customer"}
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
