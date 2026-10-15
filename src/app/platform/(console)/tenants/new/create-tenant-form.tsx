"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  startTransition,
  useActionState,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  CUSTOM_DOMAIN_MAX_LENGTH,
  SUBDOMAIN_LABEL_MAX_LENGTH,
} from "@/lib/domains/rules";
import { PROFILE_IMAGE_ACCEPT } from "@/lib/storage/image";
import {
  DATABASE_IDENTIFIER_MAX_LENGTH,
  DATABASE_PASSWORD_MAX_LENGTH,
  EMAIL_MAX_LENGTH,
  FULL_NAME_MAX_LENGTH,
  MASTER_PASSWORD_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  TENANT_USERNAME_MAX_LENGTH,
  validateFullName,
} from "@/lib/tenants/rules";
import { Avatar } from "../../_components/avatar";
import { describedBy, errorId, Field, hintId } from "../../_components/field";
import { FormSection } from "../../_components/form-section";
import { Icon, type IconName } from "../../_components/icons";
import { Notice } from "../../_components/notice";
import { PasswordInput } from "../../_components/password-input";
import { Spinner } from "../../_components/spinner";
import { ToneBadge } from "../../_components/status-badge";
import { FOCUS_RING } from "../../_components/styles";
import {
  createTenantAction,
  previewTenantValuesAction,
  testDatabaseConnectionAction,
} from "../actions";
import type {
  CreateTenantActionState,
  CreateTenantField,
  CreateTenantFieldErrors,
  DatabaseCheck,
} from "../action-types";
import { ConnectionChecks } from "./connection-checks";
import {
  buildCreateFormData,
  checkProfileImageFile,
  clearPasswords,
  clearRejectedPasswords,
  CONNECTION_FIELDS,
  type CredentialMode,
  type DatabaseMode,
  effectiveDatabaseMode,
  errorsAfterModeSwitch,
  type FormValues,
  GENERATED_FIELDS,
  generateDatabasePassword,
  generateMasterPassword,
  initialFormValues,
  type ManualField,
  type SharedField,
  summarizeErrors,
  switchCredentialMode,
  validateConnection,
  validateField,
  validateForm,
  withoutFields,
} from "./form-model";
import { PasswordChecklist } from "./password-checklist";
import { SuccessPanel } from "./success-panel";

const TENANTS_PATH = "/platform/tenants";
const PREVIEW_DELAY_MS = 500;
const INITIAL_STATE: CreateTenantActionState = { status: "idle" };

const PREVIEW_FAILED =
  "Values could not be generated right now. Try again, or switch to Manual entry.";
const CONNECTION_FAILED =
  "The connection could not be tested right now. Try again.";

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string };

type ConnectionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "checked"; ok: boolean; checks: DatabaseCheck[] }
  | { status: "error"; message: string };

type ImageState = {
  file: File | null;
  url: string | null;
  error: string | null;
};

const NO_IMAGE: ImageState = { file: null, url: null, error: null };

const CREDENTIAL_OPTIONS: {
  value: CredentialMode;
  label: string;
  icon: IconName;
}[] = [
  { value: "auto", label: "Auto generate", icon: "wand" },
  { value: "manual", label: "Manual entry", icon: "pencil" },
];

const DATABASE_OPTIONS: {
  value: DatabaseMode;
  label: string;
  description: string;
}[] = [
  {
    value: "provisioned",
    label: "Create a new database",
    description: "A dedicated database and login are created for the tenant.",
  },
  {
    value: "existing",
    label: "Use an existing database",
    description: "Attach a database that already exists on the server.",
  },
];

// True once React runs in the browser. Until then the submit button stays
// disabled, so a click before hydration cannot fall back to a native GET submit.
const noSubscription = () => () => {};
/**
 * Description: Keep the existing create-submit guard disabled until client hydration finishes.
 * Input: The existing typed arguments and component state.
 * Output: The existing helper result or state update.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

type CreateTenantFormProps = {
  /**
   * PLATFORM_BASE_DOMAIN, shown after the subdomain.
   */
  baseDomain: string;
  /**
   * POSTGRES_PORT, the default database port.
   */
  defaultPort: number;
  /**
   * POSTGRES_HOST, shown read-only: every tenant database lives on that server.
   */
  hostLabel: string;
};

/**
 * The create-tenant form (docs/tenant-management.md §9.3). "Create another
 * tenant" remounts it under a new key, which resets every piece of state,
 * the Server Action's result included.
 *
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export function CreateTenantForm(props: CreateTenantFormProps) {
  const [generation, setGeneration] = useState(0);
  return (
    <CreateTenantFormBody
      key={generation}
      {...props}
      focusOnMount={generation > 0}
      onReset={() => setGeneration((current) => current + 1)}
    />
  );
}

type BodyProps = CreateTenantFormProps & {
  focusOnMount: boolean;
  onReset: () => void;
};

/**
 * Description: Render the existing creation state machine with shared input and mode controls.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
function CreateTenantFormBody({
  baseDomain,
  defaultPort,
  hostLabel,
  focusOnMount,
  onReset,
}: BodyProps) {
  const uid = useId();
  const fid = (name: string): string => `${uid}-${name}`;

  const [values, setValues] = useState<FormValues>(() =>
    initialFormValues(defaultPort),
  );
  // Client errors come from the shared rules (blur, submit); server errors
  // from the last create. A server error stays until its field is edited.
  const [clientErrors, setClientErrors] = useState<CreateTenantFieldErrors>({});
  const [serverErrors, setServerErrors] = useState<CreateTenantFieldErrors>({});
  const [summary, setSummary] = useState<{
    visible: boolean;
    formError: string | null;
  }>({
    visible: false,
    formError: null,
  });
  const [summaryFocus, setSummaryFocus] = useState(0);
  const [prefillNote, setPrefillNote] = useState(false);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [connection, setConnection] = useState<ConnectionState>({
    status: "idle",
  });
  const [image, setImage] = useState<ImageState>(NO_IMAGE);

  const [state, dispatch, pending] = useActionState(
    createTenantAction,
    INITIAL_STATE,
  );
  const hydrated = useHydrated();
  const [handledState, setHandledState] = useState(state);

  const summaryRef = useRef<HTMLDivElement>(null);
  const fullNameRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Sequence numbers: a response that is no longer the latest request's is dropped.
  const previewSeq = useRef(0);
  const previewedName = useRef<string | null>(null);
  const connectionSeq = useRef(0);
  const imageSeq = useRef(0);
  const submitting = useRef(false);

  const errors: CreateTenantFieldErrors = { ...serverErrors, ...clientErrors };
  const ctx = { baseDomain, defaultPort, imageError: image.error };
  const manual = values.mode === "manual";
  const databaseMode = effectiveDatabaseMode(values);

  // A new result of the Server Action, handled once, while rendering (the
  // pattern React recommends over an effect that sets state).
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "error") {
      setServerErrors(state.fieldErrors);
      setClientErrors({});
      setSummary({ visible: true, formError: state.formError ?? null });
      setValues((current) =>
        clearRejectedPasswords(current, state.fieldErrors),
      );
      if (state.checks)
        setConnection({ status: "checked", ok: false, checks: state.checks });
      setSummaryFocus((count) => count + 1);
    } else if (state.status === "created") {
      setValues(clearPasswords);
    }
  }

  useEffect(() => {
    submitting.current = false;
  }, [state]);

  useEffect(() => {
    if (summaryFocus > 0) summaryRef.current?.focus();
  }, [summaryFocus]);

  useEffect(() => {
    if (focusOnMount) fullNameRef.current?.focus();
  }, [focusOnMount]);

  // The preview is an object URL: released when replaced, removed or unmounted.
  useEffect(() => {
    const url = image.url;
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [image.url]);

  // ---------------------------------------------------------------------------
  // Auto generate preview

  const requestPreview = useCallback(async (name: string) => {
    previewSeq.current += 1;
    const seq = previewSeq.current;
    previewedName.current = name;
    setPreview({ status: "loading" });
    try {
      const result = await previewTenantValuesAction(name);
      if (seq !== previewSeq.current) return;
      if (result.ok) {
        setValues((current) => ({ ...current, generated: result.values }));
        setPreview({ status: "idle" });
        // New values: whatever was said about the old ones no longer applies.
        setClientErrors((current) => withoutFields(current, GENERATED_FIELDS));
        setServerErrors((current) => withoutFields(current, GENERATED_FIELDS));
      } else {
        setPreview({ status: "error", message: result.message });
      }
    } catch {
      if (seq === previewSeq.current)
        setPreview({ status: "error", message: PREVIEW_FAILED });
    }
  }, []);

  const fullNameResult = validateFullName(values.shared.fullName);
  const nameForPreview = fullNameResult.ok ? fullNameResult.value : null;

  // Debounced: one request once the owner pauses typing a valid name.
  useEffect(() => {
    if (values.mode !== "auto" || nameForPreview === null) return;
    if (nameForPreview === previewedName.current) return;
    const timer = setTimeout(
      () => void requestPreview(nameForPreview),
      PREVIEW_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [values.mode, nameForPreview, requestPreview]);

  /**
   * Description: Request fresh automatic identifiers after checking the tenant name.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function regenerate() {
    const name = validateFullName(values.shared.fullName);
    if (!name.ok) {
      setClientErrors((current) => ({ ...current, fullName: name.error }));
      fullNameRef.current?.focus();
      return;
    }
    void requestPreview(name.value);
  }

  // ---------------------------------------------------------------------------
  // Editing

  /**
   * Description: Remove only the edited fields from the existing client and server error state.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function dropErrors(fields: readonly CreateTenantField[]) {
    setClientErrors((current) => withoutFields(current, fields));
    setServerErrors((current) => withoutFields(current, fields));
  }

  /**
   * Description: Invalidate stale database-check responses when connection drafts change.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function resetConnection() {
    connectionSeq.current += 1;
    setConnection({ status: "idle" });
  }

  /**
   * Description: Update a creation draft shared by automatic and manual credentials.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function setShared(field: SharedField, value: string) {
    setValues((current) => ({
      ...current,
      shared: { ...current.shared, [field]: value },
    }));
    setServerErrors((current) => withoutFields(current, [field]));
  }

  /**
   * Description: Update a manual credential draft and invalidate outdated connection checks.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function setManual(field: ManualField, value: string) {
    setValues((current) => ({
      ...current,
      manual: { ...current.manual, [field]: value },
    }));
    setServerErrors((current) => withoutFields(current, [field]));
    if ((CONNECTION_FIELDS as readonly string[]).includes(field))
      resetConnection();
  }

  /**
   * Checks one field with the shared rules when the owner leaves it.
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function validateOnBlur(field: CreateTenantField) {
    const error = validateField(field, values, ctx);
    setClientErrors((current) => {
      if (current[field] === error) return current;
      const next = { ...current };
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  }

  /**
   * Description: Switch credential mode while preserving existing drafts and validation rules.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function changeCredentialMode(next: CredentialMode) {
    if (next === values.mode) return;
    const result = switchCredentialMode(values, next);
    setValues(result.values);
    if (next === "auto") setPrefillNote(false);
    else if (result.prefilled.length > 0) setPrefillNote(true);
    setClientErrors(errorsAfterModeSwitch);
    setServerErrors(errorsAfterModeSwitch);
    resetConnection();
  }

  /**
   * Description: Switch database mode and invalidate password errors and connection results.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function changeDatabaseMode(next: DatabaseMode) {
    setValues((current) => ({
      ...current,
      manual: { ...current.manual, databaseMode: next },
    }));
    // The password rule differs between the two modes.
    dropErrors(["databaseMode", "databasePassword"]);
    resetConnection();
  }

  /**
   * Description: Populate a valid generated master-password draft using the existing helper.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function fillMasterPassword() {
    setManual("masterPassword", generateMasterPassword(values.manual.username));
    dropErrors(["masterPassword"]);
  }

  /**
   * Description: Populate a database-password draft using the existing generator.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function fillDatabasePassword() {
    setManual("databasePassword", generateDatabasePassword());
    dropErrors(["databasePassword"]);
  }

  // ---------------------------------------------------------------------------
  // Profile image

  /**
   * Description: Validate a selected image and keep only the latest preview response.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    // Cleared so that choosing the same file again still fires a change.
    input.value = "";
    if (!file) return;
    imageSeq.current += 1;
    const seq = imageSeq.current;
    const error = await checkProfileImageFile(file);
    if (seq !== imageSeq.current) return;
    dropErrors(["profileImage"]);
    if (error) {
      setImage((current) => ({ ...current, error }));
      return;
    }
    setImage({ file, url: URL.createObjectURL(file), error: null });
  }

  /**
   * Description: Clear the image preview and record the existing removal intent.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function removeImage() {
    imageSeq.current += 1;
    setImage(NO_IMAGE);
    dropErrors(["profileImage"]);
  }

  // ---------------------------------------------------------------------------
  // Test connection (existing database)

  /**
   * Description: Validate connection drafts and display only the latest existing database-check result.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  async function testConnection() {
    const checked = validateConnection(values, ctx);
    if (!checked.ok) {
      setClientErrors((current) => ({ ...current, ...checked.errors }));
      const first = CONNECTION_FIELDS.find((field) => checked.errors[field]);
      if (first) document.getElementById(fid(first))?.focus();
      return;
    }
    connectionSeq.current += 1;
    const seq = connectionSeq.current;
    setConnection({ status: "pending" });
    try {
      const result = await testDatabaseConnectionAction(checked.input);
      if (seq !== connectionSeq.current) return;
      if (result.kind === "checked") {
        setConnection({
          status: "checked",
          ok: result.ok,
          checks: result.checks,
        });
      } else if (result.kind === "invalid") {
        setConnection({ status: "idle" });
        setServerErrors((current) => ({ ...current, ...result.fieldErrors }));
      } else {
        setConnection({ status: "error", message: result.message });
      }
    } catch {
      if (seq === connectionSeq.current)
        setConnection({ status: "error", message: CONNECTION_FAILED });
    }
  }

  // ---------------------------------------------------------------------------
  // Submit

  /**
   * Description: Prevent duplicate submission, validate drafts and dispatch the existing payload.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || submitting.current) return;

    const found = validateForm(values, ctx);
    if (Object.keys(found).length > 0) {
      setClientErrors(found);
      setSummary({ visible: true, formError: null });
      setSummaryFocus((count) => count + 1);
      return;
    }

    setClientErrors({});
    setServerErrors({});
    setSummary({ visible: false, formError: null });
    submitting.current = true;
    const formData = buildCreateFormData(values, image.file);
    startTransition(() => dispatch(formData));
  }

  /**
   * Description: Move focus to the requested form field after validation reports an error.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function focusField(field: CreateTenantField) {
    document.getElementById(fid(field))?.focus();
  }

  if (state.status === "created") {
    return (
      <SuccessPanel
        tenantId={state.tenantId}
        generatedMasterPassword={state.generatedMasterPassword}
        onCreateAnother={onReset}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Rendering

  const sections = summarizeErrors(errors);
  const showSummary =
    summary.visible && (sections.length > 0 || summary.formError !== null);
  const tag = manual ? "manual" : "generated";
  const generated = values.generated;
  const identifiers = manual ? values.manual : generated;
  const placeholder = manual ? undefined : "Generated from the full name";

  /**
   * A text input in Manual entry, read-only with the generated value in Auto generate.
   * Input: The existing typed arguments and component state.
   * Output: Accessible React UI.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function identifierInput(
    field: "username" | "databaseName" | "databaseUser",
    maxLength: number,
  ): ReactNode {
    const id = fid(field);
    const error = errors[field];
    return (
      <Input
        id={id}
        type="text"
        value={identifiers?.[field] ?? ""}
        readOnly={!manual}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={
          manual ? (event) => setManual(field, event.target.value) : undefined
        }
        onBlur={manual ? () => validateOnBlur(field) : undefined}
        {...describedBy(id, { error })}
      />
    );
  }

  const imageError = image.error ?? errors.profileImage;
  const subdomainId = fid("subdomain");
  const subdomainSuffixId = fid("subdomain-suffix");
  const subdomainError = errors.subdomain;
  const masterPasswordId = fid("masterPassword");
  const checklistId = fid("masterPassword-checklist");
  const databasePasswordId = fid("databasePassword");
  const databasePasswordHint =
    databaseMode === "existing"
      ? "The password of the existing login"
      : "16–128 printable ASCII characters, no spaces.";

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      aria-busy={pending}
      aria-label="Create tenant"
      className="flex flex-col gap-6"
    >
      {showSummary ? (
        <div
          ref={summaryRef}
          tabIndex={-1}
          className="rounded-lg focus:outline-none"
        >
          <Notice
            variant="error"
            title={
              summary.formError ??
              "The tenant could not be created. Check these sections:"
            }
          >
            {sections.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${fid(section.firstField)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        focusField(section.firstField);
                      }}
                      className={`rounded-sm font-medium underline underline-offset-2 ${FOCUS_RING}`}
                    >
                      {section.title}
                    </a>{" "}
                    — {section.count}{" "}
                    {section.count === 1 ? "field needs" : "fields need"}{" "}
                    attention
                  </li>
                ))}
              </ul>
            ) : null}
          </Notice>
        </div>
      ) : null}

      {/* Credentials mode */}
      <Card className="gap-0 py-0">
        <CardContent className="p-5">
          <fieldset aria-describedby={hintId(fid("credentialMode"))}>
            <legend className="mb-3 text-sm font-medium text-fg">
              Credentials
            </legend>
            <RadioGroup
              name="credentialMode"
              value={values.mode}
              onValueChange={(value) =>
                changeCredentialMode(value as CredentialMode)
              }
              className="grid grid-cols-2 gap-3 sm:inline-grid"
              aria-label="Credentials"
            >
              {CREDENTIAL_OPTIONS.map((option, index) => (
                <Label
                  key={option.value}
                  htmlFor={
                    index === 0
                      ? fid("credentialMode")
                      : `${fid("credentialMode")}-${option.value}`
                  }
                  className="flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10"
                >
                  <RadioGroupItem
                    id={
                      index === 0
                        ? fid("credentialMode")
                        : `${fid("credentialMode")}-${option.value}`
                    }
                    value={option.value}
                    aria-describedby={hintId(fid("credentialMode"))}
                  />
                  <Icon name={option.icon} className="size-4 shrink-0" />
                  {option.label}
                </Label>
              ))}
            </RadioGroup>
            <p
              id={hintId(fid("credentialMode"))}
              className="mt-3 text-sm text-fg-muted"
            >
              Auto generate creates the username, passwords, database and
              subdomain for you. Values you typed in Manual entry are kept if
              you switch back.
            </p>
            {errors.credentialMode ? (
              <p
                id={errorId(fid("credentialMode"))}
                className="mt-2 text-sm text-destructive"
              >
                {errors.credentialMode}
              </p>
            ) : null}
          </fieldset>
          {manual && prefillNote ? (
            <p
              role="status"
              className="mt-3 flex items-start gap-2 text-xs text-fg-muted"
            >
              <Icon name="info" className="mt-px size-3.5 shrink-0" />
              Empty fields were filled with the generated values; change
              anything you like.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* 1. Tenant profile */}
      <FormSection number={1} title="Tenant profile">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Full name"
            htmlFor={fid("fullName")}
            required
            error={errors.fullName}
          >
            <Input
              ref={fullNameRef}
              id={fid("fullName")}
              type="text"
              value={values.shared.fullName}
              maxLength={FULL_NAME_MAX_LENGTH}
              autoComplete="off"
              onChange={(event) => setShared("fullName", event.target.value)}
              onBlur={() => validateOnBlur("fullName")}
              {...describedBy(fid("fullName"), { error: errors.fullName })}
            />
          </Field>
          <Field
            label="Phone"
            htmlFor={fid("phone")}
            hint="Include the country code, e.g. +44 20 7946 0958"
            error={errors.phone}
          >
            <Input
              id={fid("phone")}
              type="tel"
              value={values.shared.phone}
              maxLength={PHONE_MAX_LENGTH}
              autoComplete="off"
              onChange={(event) => setShared("phone", event.target.value)}
              onBlur={() => validateOnBlur("phone")}
              {...describedBy(fid("phone"), {
                hint: true,
                error: errors.phone,
              })}
            />
          </Field>
        </div>

        <div
          role="group"
          aria-labelledby={fid("profileImage-label")}
          className="flex min-w-0 flex-col gap-1.5"
        >
          <p
            id={fid("profileImage-label")}
            className="text-sm font-medium text-fg"
          >
            Profile image
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Avatar
              name={values.shared.fullName || "?"}
              src={image.url}
              size="lg"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                id={fid("profileImage")}
                onClick={() => fileInputRef.current?.click()}
                {...describedBy(fid("profileImage"), {
                  hint: true,
                  error: imageError,
                })}
                variant="outline"
                size="sm"
              >
                <Icon name="upload" className="size-4" />
                {image.file ? "Change" : "Upload image"}
              </Button>
              {image.file ? (
                <Button
                  type="button"
                  onClick={removeImage}
                  variant="ghost"
                  size="sm"
                >
                  <Icon name="trash-2" className="size-4" />
                  Remove
                </Button>
              ) : null}
            </div>
            {/* Visually hidden and out of the tab order: the buttons above drive it. */}
            <input
              ref={fileInputRef}
              type="file"
              accept={PROFILE_IMAGE_ACCEPT}
              tabIndex={-1}
              aria-hidden="true"
              onChange={handleImageChange}
              className="sr-only"
            />
          </div>
          <p
            id={hintId(fid("profileImage"))}
            className="text-xs text-fg-subtle"
          >
            PNG, JPEG or WebP, up to 2 MB
          </p>
          {imageError ? (
            <p
              id={errorId(fid("profileImage"))}
              className="text-sm text-destructive"
            >
              {imageError}
            </p>
          ) : null}
        </div>
      </FormSection>

      {/* 2. Tenant admin login */}
      <FormSection
        number={2}
        title="Tenant admin login"
        action={
          manual ? undefined : (
            <Button
              type="button"
              onClick={regenerate}
              disabled={preview.status === "loading"}
              variant="outline"
              size="sm"
            >
              {preview.status === "loading" ? (
                <Spinner size="sm" />
              ) : (
                <Icon name="refresh-cw" className="size-4" />
              )}
              {preview.status === "loading" ? "Generating…" : "Regenerate"}
            </Button>
          )
        }
      >
        {!manual && generated === null && nameForPreview === null ? (
          <p className="text-sm text-fg-muted">
            Enter the full name to generate these values.
          </p>
        ) : null}
        {!manual && preview.status === "error" ? (
          <Notice variant="warning">{preview.message}</Notice>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Username"
            htmlFor={fid("username")}
            required
            tag={tag}
            error={errors.username}
          >
            {identifierInput("username", TENANT_USERNAME_MAX_LENGTH)}
          </Field>
          <Field
            label="Email"
            htmlFor={fid("email")}
            required
            error={errors.email}
          >
            <Input
              id={fid("email")}
              type="email"
              value={values.shared.email}
              maxLength={EMAIL_MAX_LENGTH}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              onChange={(event) => setShared("email", event.target.value)}
              onBlur={() => validateOnBlur("email")}
              {...describedBy(fid("email"), { error: errors.email })}
            />
          </Field>
          <div className="sm:col-span-2">
            {manual ? (
              <Field
                label="Master password"
                htmlFor={masterPasswordId}
                required
                tag="manual"
                error={errors.masterPassword}
                action={
                  <Button
                    type="button"
                    onClick={fillMasterPassword}
                    variant="ghost"
                    size="sm"
                  >
                    <Icon name="wand" className="size-4" />
                    Generate
                  </Button>
                }
              >
                <PasswordInput
                  id={masterPasswordId}
                  value={values.manual.masterPassword}
                  maxLength={MASTER_PASSWORD_MAX_LENGTH}
                  hasError={Boolean(errors.masterPassword)}
                  onChange={(event) =>
                    setManual("masterPassword", event.target.value)
                  }
                  onBlur={() => validateOnBlur("masterPassword")}
                  aria-invalid={errors.masterPassword ? true : undefined}
                  aria-describedby={[
                    checklistId,
                    errors.masterPassword ? errorId(masterPasswordId) : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                />
                <PasswordChecklist
                  id={checklistId}
                  password={values.manual.masterPassword}
                  username={values.manual.username}
                />
              </Field>
            ) : (
              <Field
                label="Master password"
                htmlFor={masterPasswordId}
                tag="generated"
              >
                <output id={masterPasswordId} className={GENERATED_TEXT_CLASS}>
                  Generated when you create the tenant — shown once
                </output>
              </Field>
            )}
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">
                Two-factor authentication
              </p>
              <p className="mt-0.5 text-xs text-fg-subtle">
                Two-factor sign-in isn&apos;t supported for tenant accounts.
              </p>
            </div>
            <ToneBadge tone="neutral">Not available yet</ToneBadge>
          </div>
        </div>
      </FormSection>

      {/* 3. Database */}
      <FormSection number={3} title="Database">
        <fieldset
          aria-describedby={
            [
              manual ? null : hintId(fid("databaseMode")),
              errors.databaseMode ? errorId(fid("databaseMode")) : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined
          }
        >
          <legend className="sr-only">Database mode</legend>
          <RadioGroup
            name="databaseMode"
            value={databaseMode}
            onValueChange={(value) => changeDatabaseMode(value as DatabaseMode)}
            className="grid gap-3 sm:grid-cols-2"
            aria-label="Database mode"
          >
            {DATABASE_OPTIONS.map((option, index) => {
              const disabled = option.value === "existing" && !manual;
              const optionId =
                index === 0
                  ? fid("databaseMode")
                  : `${fid("databaseMode")}-${option.value}`;
              return (
                <Label
                  key={option.value}
                  htmlFor={optionId}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10 has-[[data-disabled]]:cursor-not-allowed has-[[data-disabled]]:opacity-60"
                >
                  <RadioGroupItem
                    id={optionId}
                    value={option.value}
                    disabled={disabled}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">
                      {option.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </span>
                </Label>
              );
            })}
          </RadioGroup>
          {!manual ? (
            <p
              id={hintId(fid("databaseMode"))}
              className="mt-2 text-xs text-fg-subtle"
            >
              Switch to Manual entry to attach an existing database
            </p>
          ) : null}
          {errors.databaseMode ? (
            <p
              id={errorId(fid("databaseMode"))}
              className="mt-2 text-sm text-destructive"
            >
              {errors.databaseMode}
            </p>
          ) : null}
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Database name"
            htmlFor={fid("databaseName")}
            required
            tag={tag}
            error={errors.databaseName}
          >
            {identifierInput("databaseName", DATABASE_IDENTIFIER_MAX_LENGTH)}
          </Field>
          <Field
            label="Database user"
            htmlFor={fid("databaseUser")}
            required
            tag={tag}
            error={errors.databaseUser}
          >
            {identifierInput("databaseUser", DATABASE_IDENTIFIER_MAX_LENGTH)}
          </Field>
          {manual ? (
            <Field
              label="Database password"
              htmlFor={databasePasswordId}
              required
              tag="manual"
              hint={databasePasswordHint}
              error={errors.databasePassword}
              action={
                databaseMode === "provisioned" ? (
                  <Button
                    type="button"
                    onClick={fillDatabasePassword}
                    variant="ghost"
                    size="sm"
                  >
                    <Icon name="wand" className="size-4" />
                    Generate
                  </Button>
                ) : undefined
              }
            >
              <PasswordInput
                id={databasePasswordId}
                value={values.manual.databasePassword}
                maxLength={DATABASE_PASSWORD_MAX_LENGTH}
                autoComplete={
                  databaseMode === "existing" ? "off" : "new-password"
                }
                hasError={Boolean(errors.databasePassword)}
                onChange={(event) =>
                  setManual("databasePassword", event.target.value)
                }
                onBlur={() => validateOnBlur("databasePassword")}
                {...describedBy(databasePasswordId, {
                  hint: true,
                  error: errors.databasePassword,
                })}
              />
            </Field>
          ) : (
            <Field
              label="Database password"
              htmlFor={databasePasswordId}
              tag="generated"
            >
              <output id={databasePasswordId} className={GENERATED_TEXT_CLASS}>
                Generated and stored encrypted — never shown
              </output>
            </Field>
          )}
          <Field
            label="Port"
            htmlFor={fid("databasePort")}
            required
            tag={tag}
            error={errors.databasePort}
          >
            <Input
              id={fid("databasePort")}
              type="text"
              inputMode="numeric"
              value={
                manual
                  ? values.manual.databasePort
                  : String(generated?.port ?? defaultPort)
              }
              readOnly={!manual}
              maxLength={5}
              autoComplete="off"
              onChange={
                manual
                  ? (event) => setManual("databasePort", event.target.value)
                  : undefined
              }
              onBlur={manual ? () => validateOnBlur("databasePort") : undefined}
              {...describedBy(fid("databasePort"), {
                error: errors.databasePort,
              })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Server" htmlFor={fid("server")}>
              <Input
                id={fid("server")}
                type="text"
                value={hostLabel}
                readOnly
              />
            </Field>
          </div>
        </div>

        {databaseMode === "existing" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <Button
                type="button"
                onClick={testConnection}
                disabled={connection.status === "pending"}
                aria-describedby={fid("existing-hint")}
                variant="outline"
              >
                {connection.status === "pending" ? (
                  <Spinner size="sm" />
                ) : (
                  <Icon name="database" className="size-4" />
                )}
                {connection.status === "pending"
                  ? "Testing…"
                  : "Test connection"}
              </Button>
              <p
                id={fid("existing-hint")}
                className="text-xs text-fg-subtle sm:pt-1"
              >
                The database must be empty or already contain this
                platform&apos;s schema. Nothing in it is deleted or overwritten.
              </p>
            </div>
            <div aria-live="polite">
              {connection.status === "checked" ? (
                <ConnectionChecks
                  ok={connection.ok}
                  checks={connection.checks}
                />
              ) : connection.status === "error" ? (
                <Notice variant="error">{connection.message}</Notice>
              ) : null}
            </div>
          </div>
        ) : null}
      </FormSection>

      {/* 4. Domain */}
      <FormSection number={4} title="Domain">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="SaaS subdomain"
            htmlFor={subdomainId}
            required
            tag={tag}
            error={subdomainError}
          >
            <div
              className={`flex h-10 w-full min-w-0 overflow-hidden rounded-lg border transition-colors focus-within:ring-2 ${
                manual ? "bg-surface" : "bg-surface-2"
              } ${
                subdomainError
                  ? "border-destructive focus-within:border-destructive focus-within:ring-destructive/30"
                  : "border-line focus-within:border-primary focus-within:ring-ring/30"
              }`}
            >
              <Input
                id={subdomainId}
                type="text"
                value={identifiers?.subdomain ?? ""}
                readOnly={!manual}
                placeholder={placeholder}
                maxLength={SUBDOMAIN_LABEL_MAX_LENGTH}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                onChange={
                  manual
                    ? (event) => setManual("subdomain", event.target.value)
                    : undefined
                }
                onBlur={manual ? () => validateOnBlur("subdomain") : undefined}
                aria-invalid={subdomainError ? true : undefined}
                aria-describedby={[
                  subdomainSuffixId,
                  subdomainError ? errorId(subdomainId) : null,
                ]
                  .filter(Boolean)
                  .join(" ")}
                className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 shadow-none focus-visible:border-transparent focus-visible:ring-0 read-only:bg-transparent"
              />
              <span
                id={subdomainSuffixId}
                className="flex max-w-[55%] shrink-0 items-center truncate border-l border-line bg-surface-2 px-3 text-sm text-fg-muted"
              >
                .{baseDomain}
              </span>
            </div>
          </Field>
          <Field
            label="Custom domain"
            htmlFor={fid("customDomain")}
            hint="Requires a DNS TXT record before it becomes active. Your SaaS subdomain works in the meantime."
            error={errors.customDomain}
          >
            <Input
              id={fid("customDomain")}
              type="text"
              value={values.shared.customDomain}
              placeholder="music.example.com"
              maxLength={CUSTOM_DOMAIN_MAX_LENGTH}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) =>
                setShared("customDomain", event.target.value)
              }
              onBlur={() => validateOnBlur("customDomain")}
              {...describedBy(fid("customDomain"), {
                hint: true,
                error: errors.customDomain,
              })}
            />
          </Field>
        </div>
      </FormSection>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href={TENANTS_PATH}>Cancel</Link>
        </Button>
        <Button
          type="submit"
          disabled={pending || !hydrated}
          variant="default"
          className="w-full sm:w-auto"
        >
          {pending ? <Spinner size="sm" /> : null}
          {pending ? "Creating…" : "Create tenant"}
        </Button>
      </div>
    </form>
  );
}

/**
 * A read-only line in place of a password that only the server generates.
 */
const GENERATED_TEXT_CLASS =
  "flex min-h-10 w-full items-center rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg-muted";
