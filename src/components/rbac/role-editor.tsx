"use client";

import { ChevronDownIcon, LockIcon, SearchIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ConfirmDialog,
  CountDetails,
  describedBy,
  EmptyState,
  errorId,
  Field,
  FormActions,
  FormSection,
  Notice,
  RequiredLegend,
  SectionedLayout,
  Spinner,
  type SecondaryMenuItem,
} from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import {
  normalizeRoleName,
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_NAME_ALLOWED_TEXT,
  ROLE_NAME_MAX_LENGTH,
  ROLE_NAME_MIN_LENGTH,
  ROLE_STATUS_OPTIONS,
  toggleSelection,
  validateRoleDescription,
  validateRoleName,
  validateRoleStatus,
} from "@/lib/authz/role-rules";
import { cn } from "@/lib/utils";
import { AssignedUsersTable } from "./assigned-users";
import { countText } from "./format";
import type {
  AssignedUserView,
  LockedPrivilegeView,
  ModuleView,
  PrivilegeView,
  RoleFieldName,
  RoleFormState,
  RoleStatusValue,
} from "./types";

// The section ids of the editor (one editor per page) and its secondary menu.
const SECTION_DETAILS    = "role-details";
const SECTION_PRIVILEGES = "role-privileges";
const SECTION_REVIEW     = "role-review";
const MENU_ITEMS: readonly SecondaryMenuItem[] = [
  { id: SECTION_DETAILS, label: "Role details", icon: "pencil" },
  { id: SECTION_PRIVILEGES, label: "Privileges", icon: "key-round" },
  { id: SECTION_REVIEW, label: "Review", icon: "circle-check" },
];

// The DOM ids of the controls (labels, errors and focus targets derive from them).
const NAME_ID        = "role-name";
const DESCRIPTION_ID = "role-description";
const STATUS_ID      = "role-status";
const PRIVILEGES_ID  = "role-privileges-group";
const SEARCH_ID      = "role-privilege-search";

// The order fields are checked in (the first invalid one gets the focus).
const FIELD_ORDER: readonly RoleFieldName[] = ["name", "description", "status", "privileges"];

// What the locked group says for each reason.
const LOCKED_REASON_TEXT: Record<LockedPrivilegeView["reason"], string> = {
  outside_privileges: "Outside your privileges",
  module_disabled: "Module disabled by the Platform Owner",
};

const INITIAL_STATE: RoleFormState = { status: "idle" };

type FieldErrors = Partial<Record<RoleFieldName, string>>;

/** The saved values an edit form starts from (create: omitted). */
export type RoleEditorInitial = {
  name: string;
  description: string | null;
  status: RoleStatusValue;
  /** The role's stored privilege keys (non-assignable ones are ignored here; the server keeps them). */
  privileges: readonly string[];
};

export type RoleEditorProps = {
  mode: "create" | "edit";
  /** The modules with the privileges the actor MAY assign (checkboxes). */
  modules: readonly ModuleView[];
  /** Privileges the actor may NOT assign (locked group, never checkboxes). */
  locked: readonly LockedPrivilegeView[];
  /** Saved values (edit) or a prefill (create). */
  initial?: RoleEditorInitial;
  /** Users holding the role (edit): saving asks for confirmation when > 0. */
  affectedUserCount?: number;
  /** Optional: the affected users, so "N users affected" opens them (count transparency). */
  affectedUsers?: readonly AssignedUserView[];
  /** The panel's bound Server Action (useActionState signature); redirects on success. */
  action: (state: RoleFormState, formData: FormData) => Promise<RoleFormState>;
  /** Where Cancel goes (the roles list or the role details page). */
  cancelHref: string;
};

/**
 * Description: Find the first invalid field of the editor in page order.
 * Input: The field errors.
 * Output: The first field name with an error, or undefined.
 * Use case: Focusing the first invalid field after client or server validation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function firstInvalid(errors: FieldErrors): RoleFieldName | undefined {
  return FIELD_ORDER.find((name) => errors[name]);
}

/**
 * Description: Scroll a field into view and focus it (reduced-motion aware).
 * Input: The field name.
 * Output: The field's control (or, for privileges, the first checkbox) is
 *   centred and focused.
 * Use case: After a failed client or server validation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function focusField(name: RoleFieldName) {
  // Step 1: the control that represents the field.
  const target =
    name === "name"
      ? document.getElementById(NAME_ID)
      : name === "description"
        ? document.getElementById(DESCRIPTION_ID)
        : name === "status"
          ? document.querySelector<HTMLElement>(`#${STATUS_ID} [role="radio"]`)
          : (document.querySelector<HTMLElement>(`#${PRIVILEGES_ID} [role="checkbox"]`) ??
            document.getElementById(PRIVILEGES_ID));
  if (!target) return;

  // Step 2: bring it into view, then focus without a second jump.
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
  target.focus({ preventScroll: true });
}

/**
 * Description: Tell whether a privilege matches the privilege search.
 * Input: The privilege and the lower-cased, trimmed search text.
 * Output: True when its label or description contains the text.
 * Use case: Filtering module cards and the locked group.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function privilegeMatches(privilege: { label: string; description?: string }, search: string): boolean {
  if (search === "") return true;
  return `${privilege.label} ${privilege.description ?? ""}`.toLocaleLowerCase("en-US").includes(search);
}

/**
 * Description: The role create/edit form shared by the three panels (UI spec "Role editor").
 * Input: See RoleEditorProps: mode, assignable modules, locked privileges,
 *   initial values, affected users, the bound Server Action and the Cancel link.
 * Output: A sectioned form with the sidebar secondary menu (Role details,
 *   Privileges, Review):
 *   - Role details: Role name * (live validation), Description (≤500, counter),
 *     Status (Active / Disabled).
 *   - Privileges: search by label/description; one collapsible card per module
 *     with a tri-state header checkbox (assignable privileges only) and "x/y";
 *     one checkbox per privilege with its description and "needs …" hint;
 *     ticking adds its `requires`, un-ticking clears its dependents. Privileges
 *     the actor may not grant appear in a dashed, locked "Not assignable" group
 *     with the reason — never as checkboxes.
 *   - Review: selected privileges grouped by module, the total and, on edit,
 *     "N users affected".
 *   Sticky actions (Cancel, "Save role" → "Saving…") with a duplicate-submit
 *   guard; saving a role that has users asks for confirmation first. Errors
 *   (client or server) appear under their field; the first invalid field is
 *   scrolled into view and focused; values are kept after errors.
 *   Submits FormData: `name`, `description`, `status` and one `privileges`
 *   entry per selected assignable key.
 * Use case: /platform|tenant|customer/roles/new and /roles/[id]/edit.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RoleEditor({
  mode,
  modules,
  locked,
  initial,
  affectedUserCount = 0,
  affectedUsers,
  action,
  cancelHref,
}: RoleEditorProps) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(action, INITIAL_STATE);

  // Every key the actor may grant (the checkboxes); nothing else is ever submitted.
  const assignable = new Set(modules.flatMap((module) => module.privileges.map((privilege) => privilege.key)));

  // Step 1: controlled values, prefilled on edit and kept after every error.
  const [name, setName]               = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [status, setStatus]           = useState<RoleStatusValue>(initial?.status ?? "active");
  const [selected, setSelected]       = useState<Set<string>>(
    () => new Set((initial?.privileges ?? []).filter((key) => assignable.has(key))),
  );
  const [search, setSearch]           = useState("");
  const [collapsed, setCollapsed]     = useState<Set<string>>(() => new Set());
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // Step 2: errors from live/submit validation and from the last server answer.
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [serverErrors, setServerErrors] = useState<FieldErrors>({});
  const [handledState, setHandledState] = useState(state);
  // Synchronous guard against a second submit before React re-renders.
  const submitting = useRef(false);

  // A new Server Action result, handled once while rendering (React's recommended pattern).
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "error") {
      setServerErrors(state.fieldErrors);
      setClientErrors({});
    }
  }

  // After a server answer: release the submit guard and focus the first invalid field.
  useEffect(() => {
    submitting.current = false;
    if (state.status !== "error") return;
    const first = firstInvalid(state.fieldErrors);
    if (first) focusField(first);
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
  function errorOf(field: RoleFieldName): string | undefined {
    return clientErrors[field] ?? serverErrors[field];
  }

  /**
   * Description: Check one field against the shared rules.
   * Input: The field and the values to check (defaults: the current values).
   * Output: The error message, or undefined.
   * Use case: Live validation and validateAll.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function check(
    field: RoleFieldName,
    values: { name: string; description: string; status: string; selected: ReadonlySet<string> } = { name, description, status, selected },
  ): string | undefined {
    if (field === "name") {
      const result = validateRoleName(values.name);
      return result.ok ? undefined : result.error;
    }
    if (field === "description") {
      const result = validateRoleDescription(values.description);
      return result.ok ? undefined : result.error;
    }
    if (field === "status") {
      const result = validateRoleStatus(values.status);
      return result.ok ? undefined : result.error;
    }
    return values.selected.size > 0 ? undefined : "Choose at least one privilege.";
  }

  /**
   * Description: Re-check a field live once it shows an error (and clear its server error).
   * Input: The field and the next values.
   * Output: Updated errors for that field.
   * Use case: onChange of every field.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function revalidate(
    field: RoleFieldName,
    values: { name: string; description: string; status: string; selected: ReadonlySet<string> },
  ) {
    // Step 1: a typed change replaces the server's verdict on this field.
    setServerErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));

    // Step 2: a field that already shows an error is re-checked on every change.
    if (errorOf(field)) {
      setClientErrors((current) => ({ ...current, [field]: check(field, values) }));
      return;
    }

    // Step 3: the name is validated while typing (spec "live validation") once it
    // is long enough to judge, so the first letters do not raise an error at once.
    if (field === "name" && values.name.trim().length >= ROLE_NAME_MIN_LENGTH) {
      setClientErrors((current) => ({ ...current, name: check("name", values) }));
    }
  }

  /**
   * Description: Tick or un-tick one privilege, keeping `requires` dependencies valid.
   * Input: The privilege key and whether it is now checked.
   * Output: The new selection (requires added / dependents cleared); the
   *   privileges error is re-checked.
   * Use case: Per-privilege checkboxes.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function togglePrivilege(key: string, checked: boolean) {
    const next = toggleSelection(selected, key, checked, assignable);
    setSelected(next);
    revalidate("privileges", { name, description, status, selected: next });
  }

  /**
   * Description: Select or clear every assignable privilege of one module.
   * Input: The module and whether all should be selected.
   * Output: The new selection (requires of other modules added when assignable;
   *   clearing also clears dependents elsewhere).
   * Use case: The tri-state module header checkbox.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function toggleModule(module: ModuleView, checked: boolean) {
    let next: Set<string> = new Set(selected);
    for (const privilege of module.privileges) {
      next = toggleSelection(next, privilege.key, checked, assignable);
    }
    setSelected(next);
    revalidate("privileges", { name, description, status, selected: next });
  }

  /**
   * Description: Build the FormData the Server Action receives.
   * Input: None (reads the current values).
   * Output: `name` (normalized), `description` (trimmed), `status` and one
   *   `privileges` entry per selected assignable key, in catalog order.
   * Use case: Sending the form (directly or after the save confirmation).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function buildFormData(): FormData {
    const formData = new FormData();
    formData.set("name", normalizeRoleName(name));
    formData.set("description", description.trim());
    formData.set("status", status);
    for (const group of modules) {
      for (const privilege of group.privileges) {
        if (selected.has(privilege.key)) formData.append("privileges", privilege.key);
      }
    }
    return formData;
  }

  /**
   * Description: Dispatch the Server Action once.
   * Input: None.
   * Output: The action runs inside a transition (pending → "Saving…"); repeat
   *   calls are ignored until the answer arrives.
   * Use case: handleSubmit and the save confirmation.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function send() {
    if (pending || submitting.current) return;
    submitting.current = true;
    setServerErrors({});
    const formData = buildFormData();
    startTransition(() => dispatch(formData));
  }

  /**
   * Description: Validate the editor and send it (or ask for confirmation first).
   * Input: The submit event.
   * Output: Invalid: errors under each field, first invalid field focused,
   *   nothing sent. Valid: the trimmed values are kept; a role with users opens
   *   the confirmation, otherwise the action is dispatched.
   * Use case: The form's onSubmit (Save role button or Enter).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || submitting.current) return;

    // Step 1: trim where spaces are meaningless (the stored forms).
    const trimmedName        = normalizeRoleName(name);
    const trimmedDescription = description.trim();
    setName(trimmedName);
    setDescription(trimmedDescription);

    // Step 2: the same rules as the server, in page order.
    const values = { name: trimmedName, description: trimmedDescription, status, selected };
    const errors: FieldErrors = {};
    for (const field of FIELD_ORDER) {
      const error = check(field, values);
      if (error) errors[field] = error;
    }
    setClientErrors(errors);
    const first = firstInvalid(errors);
    if (first) {
      focusField(first);
      return;
    }

    // Step 3: changing a role that people hold is confirmed first.
    if (mode === "edit" && affectedUserCount > 0) {
      setConfirmSave(true);
      return;
    }
    send();
  }

  /**
   * Description: Leave the editor, asking first when something was changed.
   * Input: None.
   * Output: Opens the discard confirmation when values differ from the start;
   *   otherwise navigates to the Cancel link.
   * Use case: The Cancel button.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function requestCancel() {
    const startKeys = (initial?.privileges ?? []).filter((key) => assignable.has(key));
    const dirty =
      name !== (initial?.name ?? "") ||
      description !== (initial?.description ?? "") ||
      status !== (initial?.status ?? "active") ||
      selected.size !== startKeys.length ||
      startKeys.some((key) => !selected.has(key));
    if (dirty) {
      setConfirmLeave(true);
      return;
    }
    router.push(cancelHref);
  }

  // Labels of every privilege by key, for the "needs …" hints.
  const labelByKey = new Map<string, string>();
  for (const group of modules) for (const privilege of group.privileges) labelByKey.set(privilege.key, privilege.label);
  for (const item of locked) if (!labelByKey.has(item.key)) labelByKey.set(item.key, item.label);

  // The privilege search, applied to module cards and the locked group.
  const normalizedSearch = search.trim().toLocaleLowerCase("en-US");
  const visibleModules   = modules
    .map((module) => ({ module, privileges: module.privileges.filter((privilege) => privilegeMatches(privilege, normalizedSearch)) }))
    .filter((entry) => entry.privileges.length > 0);
  const visibleLocked = locked.filter((item) => privilegeMatches(item, normalizedSearch));

  // The review: selected privileges grouped by module, in catalog order.
  const review = modules
    .map((module) => ({ module, privileges: module.privileges.filter((privilege) => selected.has(privilege.key)) }))
    .filter((entry) => entry.privileges.length > 0);

  const privilegesError = errorOf("privileges");
  const saveLabel       = mode === "create" ? "Create role" : "Save role";

  return (
    <SectionedLayout items={MENU_ITEMS} label="Role editor sections">
      <form onSubmit={handleSubmit} noValidate aria-busy={pending || undefined} aria-label={mode === "create" ? "Create role" : "Edit role"} className="flex flex-col gap-6">
        {state.status === "error" && state.formMessage ? <Notice variant="error">{state.formMessage}</Notice> : null}

        {/* Role details ---------------------------------------------------- */}
        <FormSection id={SECTION_DETAILS} icon="pencil" title="Role details" description="Name the role and decide whether it is in use.">
          <Field
            label="Role name"
            htmlFor={NAME_ID}
            required
            hint={`${ROLE_NAME_MIN_LENGTH}–${ROLE_NAME_MAX_LENGTH} characters: ${ROLE_NAME_ALLOWED_TEXT}.`}
            error={errorOf("name")}
          >
            <Input
              id={NAME_ID}
              name="name"
              value={name}
              maxLength={ROLE_NAME_MAX_LENGTH}
              autoComplete="off"
              placeholder="e.g. Release managers"
              aria-required="true"
              onChange={(event) => {
                const value = event.currentTarget.value;
                setName(value);
                revalidate("name", { name: value, description, status, selected });
              }}
              onBlur={() => {
                const value = normalizeRoleName(name);
                setName(value);
                setClientErrors((current) => ({ ...current, name: check("name", { name: value, description, status, selected }) }));
              }}
              {...describedBy(NAME_ID, { hint: true, error: errorOf("name") })}
            />
          </Field>

          <Field
            label="Description"
            htmlFor={DESCRIPTION_ID}
            hint="Optional. Explain who this role is for."
            error={errorOf("description")}
            action={
              <span className="text-xs text-muted-foreground tabular-nums">
                {description.length} / {ROLE_DESCRIPTION_MAX_LENGTH}
                <span className="sr-only"> characters</span>
              </span>
            }
          >
            <Textarea
              id={DESCRIPTION_ID}
              name="description"
              value={description}
              maxLength={ROLE_DESCRIPTION_MAX_LENGTH}
              rows={3}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDescription(value);
                revalidate("description", { name, description: value, status, selected });
              }}
              onBlur={() => {
                const value = description.trim();
                setDescription(value);
                setClientErrors((current) => ({ ...current, description: check("description", { name, description: value, status, selected }) }));
              }}
              {...describedBy(DESCRIPTION_ID, { hint: true, error: errorOf("description") })}
            />
          </Field>

          <div className="flex flex-col gap-2">
            <Label id={`${STATUS_ID}-label`}>
              Status
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </Label>
            <RadioGroup
              id={STATUS_ID}
              name="status"
              value={status}
              onValueChange={(value) => {
                setStatus(value as RoleStatusValue);
                revalidate("status", { name, description, status: value, selected });
              }}
              aria-labelledby={`${STATUS_ID}-label`}
              aria-required="true"
              aria-invalid={errorOf("status") ? true : undefined}
              aria-describedby={errorOf("status") ? errorId(STATUS_ID) : undefined}
              className="grid gap-2 sm:grid-cols-2"
            >
              {ROLE_STATUS_OPTIONS.map((option) => {
                const optionId = `${STATUS_ID}-${option.value}`;
                return (
                  <Label
                    key={option.value}
                    htmlFor={optionId}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-accent/50",
                      status === option.value ? "border-primary bg-primary/5" : "border-border",
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
            {errorOf("status") ? (
              <p id={errorId(STATUS_ID)} className="text-sm text-destructive">
                {errorOf("status")}
              </p>
            ) : null}
          </div>
        </FormSection>

        {/* Privileges ------------------------------------------------------ */}
        <FormSection
          id={SECTION_PRIVILEGES}
          icon="key-round"
          title={
            <>
              Privileges
              <span aria-hidden="true" className="ml-0.5 text-destructive">
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          }
          description="Choose what people with this role can do. You can only grant privileges you hold yourself."
        >
          <div className="relative">
            <Label htmlFor={SEARCH_ID} className="sr-only">
              Search privileges
            </Label>
            <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={SEARCH_ID}
              type="search"
              value={search}
              placeholder="Search privileges by name or description"
              autoComplete="off"
              onChange={(event) => setSearch(event.currentTarget.value)}
              onKeyDown={(event) => {
                // Enter in the search box must not submit the form.
                if (event.key === "Enter") event.preventDefault();
              }}
              className="pl-9"
            />
          </div>

          {privilegesError ? (
            <p id={errorId(PRIVILEGES_ID)} className="text-sm text-destructive">
              {privilegesError}
            </p>
          ) : null}

          <div
            id={PRIVILEGES_ID}
            role="group"
            aria-label="Assignable privileges"
            aria-describedby={privilegesError ? errorId(PRIVILEGES_ID) : undefined}
            tabIndex={-1}
            className="flex flex-col gap-3 outline-none"
          >
            {modules.length === 0 ? (
              <EmptyState
                size="sm"
                icon="key-round"
                title="Nothing you can assign"
                description="You do not hold any privilege you could grant to a role."
              />
            ) : visibleModules.length === 0 && normalizedSearch !== "" ? (
              <EmptyState
                size="sm"
                icon="search"
                title="No privileges match"
                description="Try another word, or clear the search to see every module."
                action={
                  <Button type="button" variant="outline" onClick={() => setSearch("")}>
                    <XIcon aria-hidden="true" />
                    Clear search
                  </Button>
                }
              />
            ) : (
              visibleModules.map(({ module, privileges }) => (
                <ModuleCard
                  key={module.key}
                  module={module}
                  privileges={privileges}
                  selected={selected}
                  labelByKey={labelByKey}
                  // While searching every matching module is shown open.
                  open={normalizedSearch !== "" || !collapsed.has(module.key)}
                  onOpenChange={(open) =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (open) next.delete(module.key);
                      else next.add(module.key);
                      return next;
                    })
                  }
                  invalid={Boolean(privilegesError)}
                  onToggle={togglePrivilege}
                  onToggleModule={toggleModule}
                />
              ))
            )}
          </div>

          {visibleLocked.length > 0 ? <LockedGroup items={visibleLocked} /> : null}
        </FormSection>

        {/* Review ------------------------------------------------------------ */}
        <FormSection id={SECTION_REVIEW} icon="circle-check" title="Review" description="Check the privileges before saving.">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <p>
              <span className="font-semibold tabular-nums">{selected.size}</span>{" "}
              <span className="text-muted-foreground">{selected.size === 1 ? "privilege selected" : "privileges selected"}</span>
            </p>
            {mode === "edit" ? (
              <p>
                {affectedUsers ? (
                  <CountDetails
                    label={`${countText(affectedUserCount, "user", "users")} affected. Show the users who hold this role.`}
                    title="Users affected by this change"
                    description="Everyone who holds this role gets the saved privileges on their next request."
                    calculation={`Users whose single role is this role: ${affectedUserCount}.`}
                    records={<AssignedUsersTable users={affectedUsers} caption="Users who hold this role" size="sm" />}
                    className="font-semibold tabular-nums"
                  >
                    {countText(affectedUserCount, "user", "users")} affected
                  </CountDetails>
                ) : (
                  <span className="font-semibold tabular-nums">{countText(affectedUserCount, "user", "users")} affected</span>
                )}
              </p>
            ) : null}
          </div>

          {review.length === 0 ? (
            <EmptyState
              size="sm"
              icon="key-round"
              title="No privileges selected"
              description="Choose at least one privilege in the Privileges section."
            />
          ) : (
            <dl className="flex flex-col gap-3">
              {review.map(({ module, privileges }) => (
                <div key={module.key} className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
                  <dt className="flex items-baseline justify-between gap-2 text-sm font-medium">
                    {module.label}
                    <span className="text-xs font-normal text-muted-foreground">
                      {privileges.length}/{module.privileges.length}
                    </span>
                  </dt>
                  <dd className="flex flex-wrap gap-1.5">
                    {privileges.map((privilege) => (
                      <Badge key={privilege.key} variant="secondary">
                        {privilege.label}
                      </Badge>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </FormSection>

        <FormActions note={<RequiredLegend />}>
          <Button type="button" variant="outline" onClick={requestCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending} aria-busy={pending || undefined}>
            {pending ? <Spinner size="sm" /> : null}
            {pending ? "Saving…" : saveLabel}
          </Button>
        </FormActions>
      </form>

      {/* Rendered outside the form, so their own forms never submit this one. */}
      <ConfirmDialog
        open={confirmSave}
        onClose={() => setConfirmSave(false)}
        title="Save changes to this role?"
        description={`${countText(affectedUserCount, "user holds", "users hold")} this role. They get the saved privileges on their next request.`}
        confirmLabel="Save role"
        pending={pending}
        onConfirm={() => {
          setConfirmSave(false);
          send();
        }}
      />
      <ConfirmDialog
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        title="Discard your changes?"
        description="Everything you changed on this form will be lost."
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

type ModuleCardProps = {
  module: ModuleView;
  /** The module's privileges matching the search (all of them without a search). */
  privileges: readonly PrivilegeView[];
  selected: ReadonlySet<string>;
  labelByKey: ReadonlyMap<string, string>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invalid: boolean;
  onToggle: (key: string, checked: boolean) => void;
  onToggleModule: (module: ModuleView, checked: boolean) => void;
};

/**
 * Description: One collapsible module card of the role editor.
 * Input: The module, its visible privileges, the selection, privilege labels
 *   (for "needs …" hints), open state and the toggle callbacks.
 * Output: A header with the tri-state checkbox (all / some / none of the
 *   module's assignable privileges), the module name and description, the
 *   "x/y" count and a chevron button; the content lists one checkbox per
 *   privilege with its description and its "needs …" requirements.
 * Use case: RoleEditor privileges section.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function ModuleCard({
  module,
  privileges,
  selected,
  labelByKey,
  open,
  onOpenChange,
  invalid,
  onToggle,
  onToggleModule,
}: ModuleCardProps) {
  // The header reflects the whole module, not only the search matches.
  const total       = module.privileges.length;
  const chosen      = module.privileges.filter((privilege) => selected.has(privilege.key)).length;
  const headerState = chosen === 0 ? false : chosen === total ? true : "indeterminate";
  const headerId    = `role-module-${module.key.replace(/[^a-z0-9_-]/gi, "-")}`;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-lg border border-border bg-card">
      <div className="flex items-start gap-3 p-4">
        <Checkbox
          id={headerId}
          checked={headerState}
          onCheckedChange={(value) => onToggleModule(module, value === true)}
          aria-label={`Select every privilege of ${module.label}`}
          aria-invalid={invalid || undefined}
          className="mt-0.5"
        />
        <div className="min-w-0 flex-1">
          <Label htmlFor={headerId} className="cursor-pointer text-sm font-semibold">
            {module.label}
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">{module.description}</p>
        </div>
        <span className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums" aria-label={`${chosen} of ${total} selected`}>
          {chosen}/{total}
        </span>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`${open ? "Hide" : "Show"} the privileges of ${module.label}`}>
            <ChevronDownIcon aria-hidden="true" className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {privileges.map((privilege) => {
            const checkboxId = `role-privilege-${privilege.key.replace(/[^a-z0-9_-]/gi, "-")}`;
            const needs      = privilege.requires.map((key) => labelByKey.get(key) ?? key);
            return (
              <li key={privilege.key} className="flex items-start gap-3 px-4 py-3 pl-11">
                <Checkbox
                  id={checkboxId}
                  name="privileges"
                  value={privilege.key}
                  checked={selected.has(privilege.key)}
                  onCheckedChange={(value) => onToggle(privilege.key, value === true)}
                  aria-describedby={`${checkboxId}-description`}
                  aria-invalid={invalid || undefined}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <Label htmlFor={checkboxId} className="cursor-pointer text-sm font-medium">
                    {privilege.label}
                  </Label>
                  <p id={`${checkboxId}-description`} className="mt-1 text-xs text-muted-foreground">
                    {privilege.description}
                    {needs.length > 0 ? <span className="mt-1 block text-fg-subtle">Needs {needs.join(", ")}</span> : null}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Description: The locked "Not assignable" group of the role editor.
 * Input: The privileges the actor may not grant (already search-filtered).
 * Output: A dashed box with a lock heading listing each privilege, its module
 *   and the reason ("Outside your privileges" / "Module disabled by the
 *   Platform Owner"). Plain text only: never checkboxes, so they cannot be sent.
 * Use case: RoleEditor privileges section (delegation ceiling made visible).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function LockedGroup({ items }: { items: readonly LockedPrivilegeView[] }) {
  return (
    <section aria-labelledby="role-locked-heading" className="rounded-lg border border-dashed border-border bg-muted/30 p-4">
      <h3 id="role-locked-heading" className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <LockIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        Not assignable
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">You cannot grant these privileges, so they are not part of this role.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
            <span className="min-w-0 text-muted-foreground">
              <span className="font-medium text-foreground">{item.label}</span> · {item.moduleLabel}
            </span>
            <span className="text-xs text-muted-foreground">{LOCKED_REASON_TEXT[item.reason]}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
