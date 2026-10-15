"use client";

import { useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CUSTOM_DOMAIN_MAX_LENGTH,
  SUBDOMAIN_LABEL_MAX_LENGTH,
} from "@/lib/domains/rules";
import { PROFILE_IMAGE_ACCEPT } from "@/lib/storage/image";
import type { TenantForEdit } from "@/lib/tenants/service";
import {
  EMAIL_MAX_LENGTH,
  FULL_NAME_ALLOWED_TEXT,
  FULL_NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  sanitizeIndianMobileInput,
  TENANT_USERNAME_MAX_LENGTH,
} from "@/lib/tenants/rules";
import { Avatar } from "../../../_components/avatar";
import { ConfirmDialog } from "../../../_components/confirm-dialog";
import {
  describedBy,
  errorId,
  Field,
  hintId,
} from "../../../_components/field";
import { FormActions, RequiredLegend } from "../../../_components/form-actions";
import { FormSection } from "../../../_components/form-section";
import { Icon } from "../../../_components/icons";
import { Notice } from "../../../_components/notice";
import { SensitiveInput } from "../../../_components/sensitive-input";
import { Spinner } from "../../../_components/spinner";
import { FOCUS_RING } from "../../../_components/styles";
import type {
  UpdateTenantActionState,
  UpdateTenantField,
  UpdateTenantFieldErrors,
} from "../../action-types";
import { TENANTS_PATH } from "../../list-query";
import { updateTenantAction } from "../../manage-actions";
import { checkProfileImageFile } from "../../new/form-model";
import {
  buildUpdateFormData,
  EDIT_SECTIONS,
  type EditImage,
  type EditSectionId,
  type EditTextField,
  type EditValues,
  hasUnsavedEdits,
  initialEditValues,
  savedTenantHref,
  summarizeEditErrors,
  validateEditField,
  validateEditForm,
} from "./edit-model";

const INITIAL_STATE: UpdateTenantActionState = { status: "idle" };

type ImageState = EditImage & { url: string | null; error: string | null };

type EditTenantFormProps = { tenant: TenantForEdit };

/** The DOM id of each form section (secondary-menu targets), by section. */
const SECTION_ANCHORS = Object.fromEntries(
  EDIT_SECTIONS.map((section) => [section.id, section.anchor]),
) as Record<EditSectionId, string>;
/** The heading of each form section, by section (same as the menu labels). */
const SECTION_TITLES = Object.fromEntries(
  EDIT_SECTIONS.map((section) => [section.id, section.title]),
) as Record<EditSectionId, string>;

/**
 * Description: The edit-tenant form (docs/tenant-management.md §9.5); no secret fields.
 * Input: The tenant as loaded for editing (saved values, base domain, status, image flag).
 * Output: Personal, Login and Domain Information sections prefilled with the
 *   saved values, an error summary naming each invalid field, and a sticky
 *   action bar. Locked (read-only) while setup runs.
 * Use case: /platform/tenants/<id>/edit. Fields validate on blur and while
 *   correcting an error; Cancel asks first when there are unsaved changes; a
 *   successful save returns to the details page with a notice.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function EditTenantForm({ tenant }: EditTenantFormProps) {
  const router = useRouter();
  const uid    = useId();
  /**
   * Description: Build the DOM id of one field of this form instance.
   * Input: The field name.
   * Output: `<useId>-<name>` (unique per form).
   * Use case: Every field, hint, error and summary link of the form.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  const fid         = (name: string): string => `${uid}-${name}`;
  const detailsHref = `${TENANTS_PATH}/${tenant.id}`;
  const storedImage = tenant.hasProfileImage ? `${detailsHref}/avatar` : null;
  // Setup writes the same rows: the server refuses edits until it finishes.
  const locked = tenant.status === "provisioning";

  // The saved values, kept to tell whether anything changed (Cancel confirmation).
  const [initialValues] = useState<EditValues>(() => initialEditValues(tenant));
  const [values, setValues] = useState<EditValues>(initialValues);
  // Cancel with unsaved changes asks first (CLAUDE.md: confirm risky actions).
  const [confirmCancel, setConfirmCancel] = useState(false);
  // Client errors come from the shared rules (blur, submit); server errors
  // from the last save. A server error stays until its field is edited.
  const [clientErrors, setClientErrors] = useState<UpdateTenantFieldErrors>({});
  const [serverErrors, setServerErrors] = useState<UpdateTenantFieldErrors>({});
  const [summary, setSummary] = useState<{
    visible: boolean;
    formError: string | null;
  }>({
    visible: false,
    formError: null,
  });
  const [summaryFocus, setSummaryFocus] = useState(0);
  const [image, setImage] = useState<ImageState>({
    action: "keep",
    file: null,
    url: null,
    error: null,
  });

  const action = updateTenantAction.bind(null, tenant.id);
  const [state, dispatch, pending] = useActionState(action, INITIAL_STATE);
  const [handledState, setHandledState] = useState(state);

  const summaryRef   = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageSeq     = useRef(0);
  const submitting   = useRef(false);

  const errors: UpdateTenantFieldErrors = { ...serverErrors, ...clientErrors };
  const ctx   = { baseDomain: tenant.baseDomain, imageError: image.error };
  const saved = state.status === "saved";

  // A new result of the Server Action, handled once, while rendering.
  if (state !== handledState) {
    setHandledState(state);
    if (state.status === "error") {
      setServerErrors(state.fieldErrors);
      setClientErrors({});
      setSummary({ visible: true, formError: state.formError ?? null });
      setSummaryFocus((count) => count + 1);
    }
  }

  useEffect(() => {
    if (state.status === "saved") {
      router.push(savedTenantHref(state.tenantId, state.dnsPending));
      return;
    }
    submitting.current = false;
  }, [state, router]);

  useEffect(() => {
    if (summaryFocus > 0) summaryRef.current?.focus();
  }, [summaryFocus]);

  // The preview is an object URL: released when replaced, removed or unmounted.
  useEffect(() => {
    const url = image.url;
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [image.url]);

  // ---------------------------------------------------------------------------
  // Editing

  /**
   * Description: Remove the given fields' client and server errors.
   * Input: The fields.
   * Output: Both error maps without those fields.
   * Use case: Image changes (the image error no longer applies).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function dropErrors(fields: readonly UpdateTenantField[]) {
    /**
     * Description: Copy an error map without the given fields.
     * Input: The current errors.
     * Output: A new map without the fields of the enclosing call.
     * Use case: dropErrors.
     * Author: Mr. Sachin Sharma
     * Created: 2026-10-14
     * Last modified: 2026-10-15
     */
    const without = (current: UpdateTenantFieldErrors) => {
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    };
    setClientErrors(without);
    setServerErrors(without);
  }

  /**
   * Description: Update one text field's draft.
   * Input: The field and its new value.
   * Output: The draft changes; the field's server error is cleared; a shown client
   *   error is re-checked while the owner corrects it (real-time feedback).
   * Use case: onChange of every text input.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function setField(field: EditTextField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    // Real-time feedback: a field that shows an error is re-checked while it is corrected.
    if (clientErrors[field]) {
      const error = validateEditField(field, { ...values, [field]: value }, ctx);
      setClientErrors((current) => {
        const next = { ...current };
        if (error) next[field] = error;
        else delete next[field];
        return next;
      });
    }
  }

  /**
   * Description: Trim a field whose surrounding spaces carry no meaning, then validate it.
   * Input: The field (email or custom domain).
   * Output: The trimmed value in the form state and its blur validation result.
   * Use case: onBlur of Email and Custom domain (CLAUDE.md whitespace rule).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function trimOnBlur(field: "email" | "customDomain") {
    const trimmed = values[field].trim();
    if (trimmed !== values[field]) setValues((current) => ({ ...current, [field]: trimmed }));
    const error = validateEditField(field, { ...values, [field]: trimmed }, ctx);
    setClientErrors((current) => {
      const next = { ...current };
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  }

  /**
   * Description: Leave the form, asking first when there are unsaved changes.
   * Input: None.
   * Output: Opens the confirmation, or navigates back to the details page.
   * Use case: The Cancel button of the action bar.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function requestCancel() {
    if (hasUnsavedEdits(values, initialValues, image)) {
      setConfirmCancel(true);
      return;
    }
    router.push(detailsHref);
  }

  /**
   * Description: Check one field with the shared rules when the owner leaves it.
   * Input: The field.
   * Output: Its client error shown or cleared.
   * Use case: onBlur of the inputs.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function validateOnBlur(field: UpdateTenantField) {
    const error = validateEditField(field, values, ctx);
    setClientErrors((current) => {
      if (current[field] === error) return current;
      const next = { ...current };
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  }

  /**
   * Description: Validate a chosen image and show its preview at once.
   * Input: The file input's change event.
   * Output: The preview (a local object URL) with action "replace", or the image
   *   error; only the latest choice counts (sequence guard).
   * Use case: The hidden file input behind Upload/Change.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  async function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file  = input.files?.[0];
    // Cleared so that choosing the same file again still fires a change.
    input.value = "";
    if (!file) return;
    imageSeq.current += 1;
    const seq   = imageSeq.current;
    const error = await checkProfileImageFile(file);
    if (seq !== imageSeq.current) return;
    dropErrors(["profileImage"]);
    if (error) {
      setImage((current) => ({ ...current, error }));
      return;
    }
    setImage({
      action: "replace",
      file,
      url: URL.createObjectURL(file),
      error: null,
    });
  }

  /**
   * Description: Mark the profile image for removal.
   * Input: None.
   * Output: The preview disappears; the stored image is removed only on save.
   * Use case: The Remove button.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function removeImage() {
    imageSeq.current += 1;
    setImage({ action: "remove", file: null, url: null, error: null });
    dropErrors(["profileImage"]);
  }

  /**
   * Description: Go back to the stored profile image.
   * Input: None.
   * Output: The image choice is reset to "keep" (nothing is uploaded or removed).
   * Use case: The Keep current image button.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function keepImage() {
    imageSeq.current += 1;
    setImage({ action: "keep", file: null, url: null, error: null });
    dropErrors(["profileImage"]);
  }

  // ---------------------------------------------------------------------------
  // Submit

  /**
   * Description: Validate and send the edit form once.
   * Input: The submit event.
   * Output: Invalid: the error summary appears and is focused (nothing is sent).
   *   Valid: the FormData is dispatched; repeat clicks are blocked while saving.
   * Use case: The form's onSubmit.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || pending || saved || submitting.current) return;

    const found = validateEditForm(values, ctx);
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
    const formData = buildUpdateFormData(values, image);
    startTransition(() => dispatch(formData));
  }

  /**
   * Description: Move focus to a field named in the error summary.
   * Input: The field.
   * Output: The field is focused (and scrolled into view by the browser).
   * Use case: Error summary links.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function focusField(field: UpdateTenantField) {
    document.getElementById(fid(field))?.focus();
  }

  // ---------------------------------------------------------------------------
  // Rendering

  const sections = summarizeEditErrors(errors);
  const showSummary =
    summary.visible && (sections.length > 0 || summary.formError !== null);
  const busy = pending || saved;

  const previewSrc =
    image.action === "replace"
      ? image.url
      : image.action === "remove"
        ? null
        : storedImage;
  const hasImage   = previewSrc !== null;
  const imageError = image.error ?? errors.profileImage;
  const imageStatus =
    image.action === "replace"
      ? "New image chosen — saved with the other changes."
      : image.action === "remove" && storedImage
        ? "The current image will be removed when you save."
        : null;

  const subdomainId       = fid("subdomain");
  const subdomainSuffixId = fid("subdomain-suffix");
  const subdomainError    = errors.subdomain;
  const domainNote =
    "Changing a domain means it has to pass the DNS check again before it becomes active.";

  return (
    <>
      <form
        onSubmit={handleSubmit}
        noValidate
        aria-busy={busy}
        aria-label="Edit tenant"
        className="flex flex-col gap-6"
      >
        {locked ? (
          <Notice variant="warning" title="Setup is running">
            Wait until setup finishes before editing.
          </Notice>
        ) : null}

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
                "The changes could not be saved. Check these sections:"
              }
            >
              {sections.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5">
                  {sections.map((section) => (
                    <li key={section.id}>
                      {/* The section, then every invalid field by name (each one focuses its field). */}
                      <span className="font-medium">{section.title}:</span>{" "}
                      {section.fields.map((item, index) => (
                        <span key={item.field}>
                          {index > 0 ? ", " : null}
                          <a
                            href={`#${fid(item.field)}`}
                            onClick={(event) => {
                              event.preventDefault();
                              focusField(item.field);
                            }}
                            className={`rounded-sm underline underline-offset-2 ${FOCUS_RING}`}
                          >
                            {item.label}
                          </a>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Notice>
          </div>
        ) : null}

        {/* A disabled fieldset disables every control inside, keyboard included. */}
        <fieldset disabled={locked} className="flex min-w-0 flex-col gap-6">
          <legend className="sr-only">Tenant details</legend>

          {/* 1. Personal Information */}
          <FormSection
            id={SECTION_ANCHORS.profile}
            icon="user"
            title={SECTION_TITLES.profile}
            description="Who the tenant is and how they are shown in the console."
          >
            {/* Profile image on the left, the name and phone beside it (as on the create form). */}
            <div className="flex flex-col gap-6 md:flex-row md:items-start">
              <div
                role="group"
                aria-labelledby={fid("profileImage-label")}
                className="flex shrink-0 flex-col gap-2 md:w-48 md:items-center md:text-center"
              >
                <p
                  id={fid("profileImage-label")}
                  className="text-sm font-medium text-fg"
                >
                  Profile image
                </p>
                <div className="flex flex-wrap items-center gap-4 md:flex-col">
                  <Avatar
                    name={values.fullName || tenant.fullName}
                    src={previewSrc}
                    size="lg"
                  />
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
                      {hasImage ? "Change" : "Upload image"}
                    </Button>
                    {hasImage ? (
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
                    {image.action !== "keep" && storedImage ? (
                      <Button
                        type="button"
                        onClick={keepImage}
                        variant="ghost"
                        size="sm"
                      >
                        <Icon name="rotate-ccw" className="size-4" />
                        Keep current image
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
                <p
                  aria-live="polite"
                  className="text-xs text-fg-muted empty:hidden"
                >
                  {imageStatus}
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
              <div className="grid flex-1 gap-5 sm:grid-cols-2">
                <Field
                  label="Full name"
                  htmlFor={fid("fullName")}
                  required
                  hint={`Use ${FULL_NAME_ALLOWED_TEXT}.`}
                  error={errors.fullName}
                >
                  <Input
                    id={fid("fullName")}
                    type="text"
                    value={values.fullName}
                    maxLength={FULL_NAME_MAX_LENGTH}
                    autoComplete="off"
                    onChange={(event) => setField("fullName", event.target.value)}
                    onBlur={() => validateOnBlur("fullName")}
                    {...describedBy(fid("fullName"), { hint: true, error: errors.fullName })}
                  />
                </Field>
                <Field
                  label="Phone"
                  htmlFor={fid("phone")}
                  hint="10-digit Indian mobile number, e.g. 9876543210"
                  error={errors.phone}
                >
                  {/* Sensitive: masked until the eye button is used. Digits only while
                      typing or pasting; a saved number in another format is shown as
                      it is, so the owner can correct it. */}
                  <SensitiveInput
                    id={fid("phone")}
                    noun="phone number"
                    inputMode="numeric"
                    value={values.phone}
                    maxLength={PHONE_MAX_LENGTH}
                    hasError={Boolean(errors.phone)}
                    onChange={(event) => setField("phone", sanitizeIndianMobileInput(event.target.value))}
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

          {/* 2. Login Information */}
          <FormSection
            id={SECTION_ANCHORS.login}
            icon="key-round"
            title={SECTION_TITLES.login}
            description="Passwords are changed with Reset master password on the tenant page."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label="Username"
                htmlFor={fid("username")}
                required
                error={errors.username}
              >
                {/* Masked like every username in the console; the eye reveals it. */}
                <SensitiveInput
                  id={fid("username")}
                  noun="username"
                  value={values.username}
                  maxLength={TENANT_USERNAME_MAX_LENGTH}
                  hasError={Boolean(errors.username)}
                  onChange={(event) => setField("username", event.target.value)}
                  onBlur={() => validateOnBlur("username")}
                  {...describedBy(fid("username"), { error: errors.username })}
                />
              </Field>
              <Field
                label="Email"
                htmlFor={fid("email")}
                required
                error={errors.email}
              >
                {/* Sensitive: masked until the eye button is used; trimmed on blur. */}
                <SensitiveInput
                  id={fid("email")}
                  noun="email"
                  inputMode="email"
                  value={values.email}
                  maxLength={EMAIL_MAX_LENGTH}
                  hasError={Boolean(errors.email)}
                  onChange={(event) => setField("email", event.target.value)}
                  onBlur={() => trimOnBlur("email")}
                  {...describedBy(fid("email"), { error: errors.email })}
                />
              </Field>
            </div>
          </FormSection>

          {/* 3. Domain Information */}
          <FormSection
            id={SECTION_ANCHORS.domain}
            icon="globe"
            title={SECTION_TITLES.domain}
            description={domainNote}
          >
            <div className="grid gap-5 sm:grid-cols-2">
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
                  } ${locked ? "opacity-70" : ""}`}
                >
                  <Input
                    id={subdomainId}
                    type="text"
                    value={values.subdomain}
                    maxLength={SUBDOMAIN_LABEL_MAX_LENGTH}
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    onChange={(event) =>
                      setField("subdomain", event.target.value)
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
                    .{tenant.baseDomain}
                  </span>
                </div>
              </Field>
              <Field
                label="Custom domain"
                htmlFor={fid("customDomain")}
                hint="Optional. Leave empty to remove it. Requires a DNS TXT record before it becomes active."
                error={errors.customDomain}
              >
                <Input
                  id={fid("customDomain")}
                  type="text"
                  value={values.customDomain}
                  placeholder="music.example.com"
                  maxLength={CUSTOM_DOMAIN_MAX_LENGTH}
                  autoComplete="off"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) =>
                    setField("customDomain", event.target.value)
                  }
                  onBlur={() => trimOnBlur("customDomain")}
                  {...describedBy(fid("customDomain"), {
                    hint: true,
                    error: errors.customDomain,
                  })}
                />
              </Field>
            </div>
          </FormSection>
        </fieldset>

        <FormActions note={<RequiredLegend />}>
          <Button type="button" variant="outline" onClick={requestCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" disabled={locked || busy} variant="default">
            {busy ? <Spinner size="sm" /> : <Icon name="check" className="size-4" />}
            {busy ? "Saving…" : "Save changes"}
          </Button>
        </FormActions>
      </form>

      {/* Leaving with unsaved changes loses them: ask first. Rendered outside the
          form, so its own form never submits this one. */}
      <ConfirmDialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title="Discard your changes?"
        description="The changes you made on this form have not been saved and will be lost."
        confirmLabel="Discard and leave"
        confirmVariant="danger"
        onConfirm={() => {
          setConfirmCancel(false);
          router.push(detailsHref);
        }}
      />
    </>
  );
}
