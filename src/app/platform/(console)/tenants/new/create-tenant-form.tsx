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
import { FormActions, RequiredLegend } from "../../_components/form-actions";
import { FormSection } from "../../_components/form-section";
import { Icon } from "../../_components/icons";
import { ModeSwitch } from "../../_components/mode-switch";
import { Notice } from "../../_components/notice";
import { PasswordInput } from "../../_components/password-input";
import { SensitiveInput } from "../../_components/sensitive-input";
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
  anySectionAuto,
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
  type GeneratedSummary,
  generatedSummary,
  generateDatabasePassword,
  generateMasterPassword,
  initialFormValues,
  type ManualField,
  type ModeSection,
  SECTION_GENERATED_FIELDS,
  SECTION_MODE_FIELD,
  sectionOfField,
  type SharedField,
  summarizeErrors,
  switchSectionMode,
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
  "Values could not be generated right now. Try again, or switch this section to Manual.";
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

/** No section has shown its "prefilled from the preview" note yet. */
const NO_PREFILL_NOTES: Record<ModeSection, boolean> = {
  login: false,
  database: false,
  domain: false,
};

/** The accessible name of each section's Auto-Generate / Manual switch. */
const SWITCH_LABELS: Record<ModeSection, string> = {
  login: "How the admin login is set",
  database: "How the database is set",
  domain: "How the subdomain is set",
};

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

/**
 * Description: Focus an element, or the checked option when the element is a radio group.
 * Input: The element an error link points at.
 * Output: Focus moved to it (a radio group's container is not focusable itself).
 * Use case: Error summary links that land on a section's Auto-Generate / Manual switch.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
function focusElement(element: HTMLElement) {
  if (element.getAttribute("role") === "radiogroup") {
    element
      .querySelector<HTMLElement>('[role="radio"][data-state="checked"]')
      ?.focus();
    return;
  }
  element.focus();
}

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
 * Description: Render the creation state machine with one Auto-Generate / Manual switch per section.
 * Input: The server configuration (base domain, default port, host) and the reset callbacks.
 * Output: The create form, or the success panel once the tenant is recorded.
 * Use case: The platform owner creates a tenant at /platform/tenants/new.
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
  // Per section: the "empty fields were filled from the preview" note.
  const [prefillNotes, setPrefillNotes] =
    useState<Record<ModeSection, boolean>>(NO_PREFILL_NOTES);
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" });
  const [connection, setConnection] = useState<ConnectionState>({
    status: "idle",
  });
  const [image, setImage] = useState<ImageState>(NO_IMAGE);
  // What the Auto sections submitted, for the success panel (they never showed it).
  const [submittedGenerated, setSubmittedGenerated] =
    useState<GeneratedSummary>({});

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
  const loginManual = values.modes.login === "manual";
  const databaseManual = values.modes.database === "manual";
  const domainManual = values.modes.domain === "manual";
  const anyAuto = anySectionAuto(values);
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
  // Auto-Generate preview (shared by every section on Auto)

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

  // Debounced: one request once the owner pauses typing a valid name, and
  // only while some section still uses generated values.
  useEffect(() => {
    if (!anyAuto || nameForPreview === null) return;
    if (nameForPreview === previewedName.current) return;
    const timer = setTimeout(
      () => void requestPreview(nameForPreview),
      PREVIEW_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [anyAuto, nameForPreview, requestPreview]);

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
   * Description: Update a creation draft that every section mode shares.
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
   * Description: Move one section between Auto-Generate and Manual, keeping every typed draft.
   * Input: The section whose switch was used and the requested mode.
   * Output: Updated values, that section's prefill note and errors; other sections are untouched.
   * Use case: The owner clicks Auto-Generate or Manual in a section header.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function changeSectionMode(section: ModeSection, next: CredentialMode) {
    // Step 1: nothing to do when the switch did not move.
    if (next === values.modes[section]) return;

    // Step 2: move the switch (the model prefills empty fields once, from the preview).
    const result = switchSectionMode(values, section, next);
    setValues(result.values);

    // Step 3: the note explains a prefill only right after it happened.
    setPrefillNotes((current) => ({
      ...current,
      [section]: next === "manual" && result.prefilled.length > 0,
    }));

    // Step 4: errors about values that are no longer submitted go away.
    setClientErrors((current) => errorsAfterModeSwitch(current, section));
    setServerErrors((current) => errorsAfterModeSwitch(current, section));

    // Step 5: a connection result described the database fields: it is stale now.
    if (section === "database") resetConnection();
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
    // Exactly what the Auto sections send now, for the success panel.
    setSubmittedGenerated(generatedSummary(values, baseDomain));
    const formData = buildCreateFormData(values, image.file);
    startTransition(() => dispatch(formData));
  }

  /**
   * Description: Move focus to a form field after validation reports an error.
   * Input: The field the error summary link points at.
   * Output: Focus on the field, or on its section's switch when Auto hides the field.
   * Use case: Error summary links, including errors on generated (hidden) values.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function focusField(field: CreateTenantField) {
    // Step 1: the field itself, when its section shows it.
    const target = document.getElementById(fid(field));
    if (target) {
      focusElement(target);
      return;
    }
    // Step 2: a generated value hidden by Auto: the section's switch is the
    // nearest control, and the error is shown right below it.
    const section = sectionOfField(field);
    if (section === "profile") return;
    const modeSwitch = document.getElementById(fid(SECTION_MODE_FIELD[section]));
    if (modeSwitch) focusElement(modeSwitch);
  }

  if (state.status === "created") {
    return (
      <SuccessPanel
        tenantId={state.tenantId}
        generatedMasterPassword={state.generatedMasterPassword}
        generated={submittedGenerated}
        onCreateAnother={onReset}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Rendering

  const sections = summarizeErrors(errors);
  const showSummary =
    summary.visible && (sections.length > 0 || summary.formError !== null);

  /**
   * Description: The errors a section cannot show next to an input, because Auto hides the input.
   * Input: The section.
   * Output: Its switch's own error, plus (on Auto) the errors of its generated values.
   * Use case: "<value> is no longer available — regenerate." and "not ready" messages
   *   on values the owner never saw.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15. Last modified: 2026-10-15.
   */
  function hiddenErrors(section: ModeSection): SectionError[] {
    const fields: CreateTenantField[] = [SECTION_MODE_FIELD[section]];
    if (values.modes[section] === "auto") {
      fields.push(...SECTION_GENERATED_FIELDS[section]);
    }
    return fields.flatMap((field) => {
      const message = errors[field];
      return message ? [{ id: errorId(fid(field)), message }] : [];
    });
  }

  /**
   * Description: The ids a section's switch is described by: the errors of its hidden values.
   * Input: The section.
   * Output: A space-separated id list, or undefined when there is nothing to read out.
   * Use case: aria-describedby of the login, database and domain switches.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15. Last modified: 2026-10-15.
   */
  function switchDescribedBy(section: ModeSection): string | undefined {
    const errorIds = hiddenErrors(section).map((error) => error.id);
    return errorIds.length > 0 ? errorIds.join(" ") : undefined;
  }

  /**
   * Description: Build the note an Auto section shows in place of its hidden fields.
   * Input: The section, the note's title and its description.
   * Output: An AutoGeneratedNote with the shared preview state and the section's hidden errors.
   * Use case: The body of the login, database and domain sections while on Auto-Generate.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15. Last modified: 2026-10-15.
   */
  function autoNote(
    section: ModeSection,
    title: string,
    description: ReactNode,
  ): ReactNode {
    return (
      <AutoGeneratedNote
        title={title}
        description={description}
        status={
          nameForPreview === null
            ? "waiting"
            : preview.status === "loading"
              ? "loading"
              : values.generated !== null
                ? "ready"
                : "waiting"
        }
        previewError={preview.status === "error" ? preview.message : null}
        errors={hiddenErrors(section)}
        regenerating={preview.status === "loading"}
        onRegenerate={regenerate}
      />
    );
  }

  /**
   * Description: The top of a Manual section: its switch's own error and the prefill note.
   * Input: The section.
   * Output: The switch error (if any) and, right after the first switch filled
   *   something, the "empty fields were filled" note; otherwise nothing.
   * Use case: Explaining why fields the owner never typed already hold values,
   *   and giving the switch's aria-describedby an element to point at.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function manualIntro(section: ModeSection): ReactNode {
    // In Manual only the switch's own error can be hidden: every field is shown.
    const switchErrors = hiddenErrors(section);
    const showPrefill = prefillNotes[section];
    if (switchErrors.length === 0 && !showPrefill) return null;
    return (
      <>
        {switchErrors.map((error) => (
          <p key={error.id} id={error.id} className="text-sm text-destructive">
            {error.message}
          </p>
        ))}
        {showPrefill ? (
          <p
            role="status"
            className="flex items-start gap-2 text-xs text-fg-muted"
          >
            <Icon name="info" className="mt-px size-3.5 shrink-0" />
            Empty fields were filled with the generated values; change
            anything you like.
          </p>
        ) : null}
      </>
    );
  }

  /**
   * A masked identifier input for a section on Manual (username, database name/user).
   * Input: The identifier and its maximum length.
   * Output: A SensitiveInput bound to the manual draft, with blur validation.
   * Use case: Identifiers the owner types; the eye button reveals them.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function identifierInput(
    field: "username" | "databaseName" | "databaseUser",
    maxLength: number,
    noun: string,
  ): ReactNode {
    const id = fid(field);
    const error = errors[field];
    return (
      <SensitiveInput
        id={id}
        noun={noun}
        value={values.manual[field]}
        maxLength={maxLength}
        hasError={Boolean(error)}
        onChange={(event) => setManual(field, event.target.value)}
        onBlur={() => validateOnBlur(field)}
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

      {/* 1. Tenant profile: nothing here is generated, so no switch. */}
      <FormSection
        icon="user"
        title="Tenant profile"
        description="Who the tenant is. The full name is also the basis for generated values."
      >
        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          {/* Profile image: preview on the left, its controls below it. */}
          <div
            role="group"
            aria-labelledby={fid("profileImage-label")}
            className="flex shrink-0 items-center gap-4 md:w-48 md:flex-col md:items-center md:text-center"
          >
            <Avatar
              name={values.shared.fullName || "?"}
              src={image.url}
              size="lg"
            />
            <div className="flex min-w-0 flex-col gap-2 md:items-center">
              <p
                id={fid("profileImage-label")}
                className="text-sm font-medium text-fg"
              >
                Profile image
              </p>
              <div className="flex flex-wrap gap-2 md:justify-center">
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
                  {image.file ? "Change" : "Upload"}
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
          </div>

          <div className="grid flex-1 gap-5 sm:grid-cols-2">
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
                placeholder="e.g. Acme Music"
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
        </div>
      </FormSection>

      {/* 2. Tenant admin login */}
      <FormSection
        icon="key-round"
        title="Tenant admin login"
        description="The account the tenant's administrator signs in with."
        action={
          <ModeSwitch
            id={fid(SECTION_MODE_FIELD.login)}
            value={values.modes.login}
            onChange={(next) => changeSectionMode("login", next)}
            label={SWITCH_LABELS.login}
            describedBy={switchDescribedBy("login")}
          />
        }
      >
        {loginManual
          ? manualIntro("login")
          : autoNote(
              "login",
              "Username and master password are generated",
              "The username is based on the full name. The master password is created securely and shown once, right after the tenant is created.",
            )}

        <div className="grid gap-5 sm:grid-cols-2">
          {loginManual ? (
            <Field
              label="Username"
              htmlFor={fid("username")}
              required
              error={errors.username}
            >
              {identifierInput(
                "username",
                TENANT_USERNAME_MAX_LENGTH,
                "username",
              )}
            </Field>
          ) : null}
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
              placeholder="e.g. admin@acme.com"
              onChange={(event) => setShared("email", event.target.value)}
              onBlur={() => validateOnBlur("email")}
              {...describedBy(fid("email"), { error: errors.email })}
            />
          </Field>
          {loginManual ? (
            <div className="sm:col-span-2">
              <Field
                label="Master password"
                htmlFor={masterPasswordId}
                required
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
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
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
      </FormSection>

      {/* 3. Database */}
      <FormSection
        icon="database"
        title="Database"
        description="Where the tenant's data is stored."
        action={
          <ModeSwitch
            id={fid(SECTION_MODE_FIELD.database)}
            value={values.modes.database}
            onChange={(next) => changeSectionMode("database", next)}
            label={SWITCH_LABELS.database}
            describedBy={switchDescribedBy("database")}
          />
        }
      >
        {databaseManual ? (
          <>
            {manualIntro("database")}
            <fieldset
              aria-describedby={
                errors.databaseMode ? errorId(fid("databaseMode")) : undefined
              }
            >
              <legend className="sr-only">Database mode</legend>
              <RadioGroup
                name="databaseMode"
                value={databaseMode}
                onValueChange={(value) =>
                  changeDatabaseMode(value as DatabaseMode)
                }
                className="grid gap-3 sm:grid-cols-2"
                aria-label="Database mode"
              >
                {DATABASE_OPTIONS.map((option, index) => {
                  const optionId =
                    index === 0
                      ? fid("databaseMode")
                      : `${fid("databaseMode")}-${option.value}`;
                  return (
                    <Label
                      key={option.value}
                      htmlFor={optionId}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/10"
                    >
                      <RadioGroupItem
                        id={optionId}
                        value={option.value}
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
                error={errors.databaseName}
              >
                {identifierInput(
                  "databaseName",
                  DATABASE_IDENTIFIER_MAX_LENGTH,
                  "database name",
                )}
              </Field>
              <Field
                label="Database user"
                htmlFor={fid("databaseUser")}
                required
                error={errors.databaseUser}
              >
                {identifierInput(
                  "databaseUser",
                  DATABASE_IDENTIFIER_MAX_LENGTH,
                  "database user",
                )}
              </Field>
              <Field
                label="Database password"
                htmlFor={databasePasswordId}
                required
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
              <Field
                label="Port"
                htmlFor={fid("databasePort")}
                required
                error={errors.databasePort}
              >
                <Input
                  id={fid("databasePort")}
                  type="text"
                  inputMode="numeric"
                  value={values.manual.databasePort}
                  maxLength={5}
                  autoComplete="off"
                  onChange={(event) =>
                    setManual("databasePort", event.target.value)
                  }
                  onBlur={() => validateOnBlur("databasePort")}
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
              <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface-2 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p
                    id={fid("existing-hint")}
                    className="text-xs text-fg-muted"
                  >
                    The database must be empty or already contain this
                    platform&apos;s schema. Nothing in it is deleted or
                    overwritten.
                  </p>
                  <Button
                    type="button"
                    onClick={testConnection}
                    disabled={connection.status === "pending"}
                    aria-describedby={fid("existing-hint")}
                    variant="outline"
                    className="shrink-0"
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
          </>
        ) : (
          autoNote(
            "database",
            "A new database is created automatically",
            <>
              A dedicated database, user and password are created on{" "}
              <span className="font-mono text-fg">{hostLabel}</span>, port{" "}
              <span className="font-mono text-fg">{defaultPort}</span>. The
              password is stored encrypted and never shown. To attach an
              existing database, switch to Manual.
            </>,
          )
        )}
      </FormSection>

      {/* 4. Domain */}
      <FormSection
        icon="globe"
        title="Domain"
        description="The addresses the tenant's site is reached at."
        action={
          <ModeSwitch
            id={fid(SECTION_MODE_FIELD.domain)}
            value={values.modes.domain}
            onChange={(next) => changeSectionMode("domain", next)}
            label={SWITCH_LABELS.domain}
            describedBy={switchDescribedBy("domain")}
          />
        }
      >
        {domainManual
          ? manualIntro("domain")
          : autoNote(
              "domain",
              "The SaaS subdomain is generated",
              <>
                It is based on the full name and ends in{" "}
                <span className="font-mono text-fg">.{baseDomain}</span>.
              </>,
            )}

        <div className="grid gap-5 sm:grid-cols-2">
          {domainManual ? (
            <Field
              label="SaaS subdomain"
              htmlFor={subdomainId}
              required
              error={subdomainError}
            >
              <div
                className={`flex h-10 w-full min-w-0 overflow-hidden rounded-lg border bg-surface transition-colors focus-within:ring-2 ${
                  subdomainError
                    ? "border-destructive focus-within:border-destructive focus-within:ring-destructive/30"
                    : "border-line focus-within:border-primary focus-within:ring-ring/30"
                }`}
              >
                <Input
                  id={subdomainId}
                  type="text"
                  value={values.manual.subdomain}
                  maxLength={SUBDOMAIN_LABEL_MAX_LENGTH}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) =>
                    setManual("subdomain", event.target.value)
                  }
                  onBlur={() => validateOnBlur("subdomain")}
                  aria-invalid={subdomainError ? true : undefined}
                  aria-describedby={[
                    subdomainSuffixId,
                    subdomainError ? errorId(subdomainId) : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-3 shadow-none focus-visible:border-transparent focus-visible:ring-0"
                />
                <span
                  id={subdomainSuffixId}
                  className="flex max-w-[55%] shrink-0 items-center truncate border-l border-line bg-surface-2 px-3 text-sm text-fg-muted"
                >
                  .{baseDomain}
                </span>
              </div>
            </Field>
          ) : null}
          <div className={domainManual ? undefined : "sm:col-span-2"}>
            <Field
              label="Custom domain"
              htmlFor={fid("customDomain")}
              hint="Optional. Requires a DNS TXT record before it becomes active. Your SaaS subdomain works in the meantime."
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
        </div>
      </FormSection>

      <FormActions note={<RequiredLegend />}>
        <Button asChild variant="outline">
          <Link href={TENANTS_PATH}>Cancel</Link>
        </Button>
        <Button
          type="submit"
          disabled={pending || !hydrated}
          variant="default"
        >
          {pending ? <Spinner size="sm" /> : <Icon name="plus" className="size-4" />}
          {pending ? "Creating…" : "Create tenant"}
        </Button>
      </FormActions>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Auto-Generate note

/** One error of a value the section does not show, with the id its switch references. */
type SectionError = { id: string; message: string };

type AutoGeneratedNoteProps = {
  title: string;
  description: ReactNode;
  /**
   * waiting: no valid full name yet, or no preview yet;
   * loading: a preview is on its way; ready: the values are there.
   */
  status: "waiting" | "loading" | "ready";
  /** The last preview request's failure message, if it failed. */
  previewError: string | null;
  /** Server or client errors about this section's hidden values. */
  errors: SectionError[];
  regenerating: boolean;
  onRegenerate: () => void;
};

/**
 * Description: The panel an Auto-Generate section shows instead of its generated fields.
 * Input: The title and description, the preview status, any preview failure and hidden-value errors.
 * Output: A tinted note with a live status line; problems add a Regenerate button.
 * Use case: Login, database and domain sections on Auto, whose values stay hidden
 *   until the success panel, but whose problems must still be visible and fixable.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15. Last modified: 2026-10-15.
 */
function AutoGeneratedNote({
  title,
  description,
  status,
  previewError,
  errors,
  regenerating,
  onRegenerate,
}: AutoGeneratedNoteProps) {
  const hasProblem = previewError !== null || errors.length > 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Icon name="wand" className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{title}</p>
          <p className="mt-1 text-sm text-fg-muted">{description}</p>
          {/* Announced as the shared preview moves on. */}
          <p
            aria-live="polite"
            className="mt-2 flex items-center gap-1.5 text-xs text-fg-subtle"
          >
            {status === "loading" ? (
              <>
                <Spinner size="sm" />
                Preparing values…
              </>
            ) : status === "ready" ? (
              <>
                <Icon name="circle-check" className="size-3.5 text-success" />
                Ready. The values are shown once the tenant is created.
              </>
            ) : (
              <>
                <Icon name="clock" className="size-3.5" />
                Waiting for the full name — the values are based on it.
              </>
            )}
          </p>
        </div>
      </div>

      {hasProblem ? (
        <div className="flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 sm:flex-row sm:items-start sm:justify-between">
          <ul className="flex min-w-0 flex-col gap-1 text-sm text-destructive">
            {previewError ? <li>{previewError}</li> : null}
            {errors.map((error) => (
              <li key={error.id} id={error.id}>
                {error.message}
              </li>
            ))}
          </ul>
          <Button
            type="button"
            onClick={onRegenerate}
            disabled={regenerating}
            variant="outline"
            size="sm"
            className="shrink-0"
          >
            {regenerating ? (
              <Spinner size="sm" />
            ) : (
              <Icon name="refresh-cw" className="size-4" />
            )}
            {regenerating ? "Generating…" : "Regenerate"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
