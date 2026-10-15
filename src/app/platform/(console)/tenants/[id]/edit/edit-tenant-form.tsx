"use client";

import Link from "next/link";
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
  FULL_NAME_MAX_LENGTH,
  PHONE_MAX_LENGTH,
  TENANT_USERNAME_MAX_LENGTH,
} from "@/lib/tenants/rules";
import { Avatar } from "../../../_components/avatar";
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
  type EditImage,
  type EditTextField,
  type EditValues,
  initialEditValues,
  savedTenantHref,
  summarizeEditErrors,
  validateEditField,
  validateEditForm,
} from "./edit-model";

const INITIAL_STATE: UpdateTenantActionState = { status: "idle" };

type ImageState = EditImage & { url: string | null; error: string | null };

type EditTenantFormProps = { tenant: TenantForEdit };

/**
 * The edit-tenant form (docs/tenant-management.md §9.5). No secret fields.
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
 */
export function EditTenantForm({ tenant }: EditTenantFormProps) {
  const router = useRouter();
  const uid = useId();
  const fid = (name: string): string => `${uid}-${name}`;
  const detailsHref = `${TENANTS_PATH}/${tenant.id}`;
  const storedImage = tenant.hasProfileImage ? `${detailsHref}/avatar` : null;
  // Setup writes the same rows: the server refuses edits until it finishes.
  const locked = tenant.status === "provisioning";

  const [values, setValues] = useState<EditValues>(() =>
    initialEditValues(tenant),
  );
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

  const summaryRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageSeq = useRef(0);
  const submitting = useRef(false);

  const errors: UpdateTenantFieldErrors = { ...serverErrors, ...clientErrors };
  const ctx = { baseDomain: tenant.baseDomain, imageError: image.error };
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
   * Description: Remove only the edited fields from the existing client and server error state.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function dropErrors(fields: readonly UpdateTenantField[]) {
    const without = (current: UpdateTenantFieldErrors) => {
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    };
    setClientErrors(without);
    setServerErrors(without);
  }

  /**
   * Description: Update an edit-field draft and clear that field’s previous server error.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function setField(field: EditTextField, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setServerErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  /**
   * Checks one field with the shared rules when the owner leaves it.
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
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
    setImage({
      action: "replace",
      file,
      url: URL.createObjectURL(file),
      error: null,
    });
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
    setImage({ action: "remove", file: null, url: null, error: null });
    dropErrors(["profileImage"]);
  }

  /**
   * Description: Restore the edit form’s stored image without uploading or saving a new file.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function keepImage() {
    imageSeq.current += 1;
    setImage({ action: "keep", file: null, url: null, error: null });
    dropErrors(["profileImage"]);
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
   * Description: Move focus to the requested form field after validation reports an error.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
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
  const hasImage = previewSrc !== null;
  const imageError = image.error ?? errors.profileImage;
  const imageStatus =
    image.action === "replace"
      ? "New image chosen — saved with the other changes."
      : image.action === "remove" && storedImage
        ? "The current image will be removed when you save."
        : null;

  const subdomainId = fid("subdomain");
  const subdomainSuffixId = fid("subdomain-suffix");
  const subdomainError = errors.subdomain;
  const domainNote =
    "Changing a domain means it has to pass the DNS check again before it becomes active.";

  return (
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

      {/* A disabled fieldset disables every control inside, keyboard included. */}
      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-6">
        <legend className="sr-only">Tenant details</legend>

        {/* 1. Profile */}
        <FormSection
          icon="user"
          title="Profile"
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
                  value={values.phone}
                  maxLength={PHONE_MAX_LENGTH}
                  autoComplete="off"
                  onChange={(event) => setField("phone", event.target.value)}
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

        {/* 2. Login */}
        <FormSection
          icon="key-round"
          title="Login"
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
              <Input
                id={fid("email")}
                type="email"
                value={values.email}
                maxLength={EMAIL_MAX_LENGTH}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                onChange={(event) => setField("email", event.target.value)}
                onBlur={() => validateOnBlur("email")}
                {...describedBy(fid("email"), { error: errors.email })}
              />
            </Field>
          </div>
        </FormSection>

        {/* 3. Domain */}
        <FormSection icon="globe" title="Domain" description={domainNote}>
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
                onBlur={() => validateOnBlur("customDomain")}
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
        <Button asChild variant="outline">
          <Link href={detailsHref}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={locked || busy} variant="default">
          {busy ? <Spinner size="sm" /> : <Icon name="check" className="size-4" />}
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </FormActions>
    </form>
  );
}
