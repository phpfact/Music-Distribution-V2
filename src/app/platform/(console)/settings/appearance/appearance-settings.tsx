"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  ACCENT_OPTIONS,
  DEFAULT_APPEARANCE,
  WIDTH_OPTIONS,
  type Appearance,
  type AppearanceState,
} from "@/lib/appearance/preferences";
import { cn } from "@/lib/utils";
import { notifyAppearanceSaved, useTheme } from "@/app/platform/theme-root";
import { ConfirmDialog } from "../../_components/confirm-dialog";
import { Icon, type IconName } from "../../_components/icons";
import { Notice } from "../../_components/notice";
import { SectionedLayout, type SecondaryMenuItem } from "../../_components/secondary-menu";
import { updateAppearanceAction } from "./actions";
import { ThemePreview } from "./theme-preview";
import { appearanceNoticeHref, clearAppearanceNoticeHref, type AppearanceFeedback } from "./feedback";
import {
  createAppearanceSaveController,
  installUnsavedAppearanceGuard,
  sameAppearance as same,
  type AppearanceSaveController,
} from "./save-and-reload";

const THEMES: { value: Appearance["theme"]; label: string; description: string; icon: IconName }[] = [
  { value: "system", label: "System preference", description: "Follow your device’s light or dark mode.", icon: "layout-grid" },
  { value: "light", label: "Light", description: "A bright, clear workspace.", icon: "sun" },
  { value: "dark", label: "Dark", description: "A calmer view in low light.", icon: "moon" },
];

/** The settings page's sections (secondary-menu targets), in page order. */
const SECTIONS = {
  saved:   { id: "appearance-currently-saved", label: "Currently saved", icon: "check" },
  accent:  { id: "appearance-accent-color", label: "Accent color", icon: "wand" },
  theme:   { id: "appearance-interface-theme", label: "Interface theme", icon: "sun" },
  width:   { id: "appearance-content-width", label: "Content width", icon: "layout-grid" },
  preview: { id: "appearance-preview", label: "Preview", icon: "image" },
} as const satisfies Record<string, SecondaryMenuItem & { icon: IconName }>;
const MENU_ITEMS: readonly SecondaryMenuItem[] = Object.values(SECTIONS);

// Shared look of one settings row: label column and control column.
const ROW_CLASS = "grid min-w-0 gap-5 border-b border-border px-5 py-7 sm:grid-cols-[13rem_1fr] sm:gap-8 sm:px-8";

/**
 * Description: Name a supported theme in saved-state and confirmation summaries.
 * Input: A complete validated appearance.
 * Output: The readable theme label.
 * Use case: Consistently describe draft and saved choices.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function themeName(appearance: Appearance): string {
  return THEMES.find((item) => item.value === appearance.theme)?.label ?? "Light";
}

/**
 * Description: Name a supported brand accent in saved-state and confirmation summaries.
 * Input: A complete validated appearance.
 * Output: The readable accent label.
 * Use case: Consistently describe draft and saved colors.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function accentName(appearance: Appearance): string {
  return ACCENT_OPTIONS.find((item) => item.value === appearance.accent)?.label ?? "Neutral";
}

/**
 * Description: Name a supported content width for saved-state and confirmation summaries.
 * Input: A complete validated appearance.
 * Output: The corresponding human-readable width label.
 * Use case: Distinguish saved width from an unsaved width selection.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function widthName(appearance: Appearance): string {
  return WIDTH_OPTIONS.find((item) => item.value === appearance.width)?.label ?? "Default Width";
}

/**
 * Description: Describe a whole appearance in one line.
 * Input: A complete validated appearance.
 * Output: "Light · Neutral · Default Width".
 * Use case: The "Currently saved" badge and the dialogs.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function appearanceSummary(appearance: Appearance): string {
  return `${themeName(appearance)} · ${accentName(appearance)} · ${widthName(appearance)}`;
}

/**
 * Description: Choose how wide the settings page itself may grow for the saved width.
 * Input: The saved width option.
 * Output: The Tailwind max-width class (room for the secondary menu included).
 * Use case: The page wrapper, so "Full Width" really uses the whole content area.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function pageWidthClass(width: Appearance["width"]): string {
  if (width === "full") return "max-w-none";
  if (width === "focused") return "max-w-5xl";
  return "max-w-6xl";
}

/**
 * Description: Render the authenticated account's appearance form and account-bound feedback.
 * Input: Feedback validated by the authenticated server page.
 * Output: A keyed form, or a session-ended notice when no account is active.
 * Use case: Discard the previous account's draft and feedback on account switches.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function AppearanceSettings({ initialFeedback }: { initialFeedback: AppearanceFeedback | null }) {
  const { state } = useTheme();

  // Signed out in another tab: nothing to manage here.
  if (!state.ownerId) {
    return <Notice variant="warning">Your session has ended. Sign in again to manage your appearance.</Notice>;
  }

  // A cross-tab account switch remounts the form and discards the old draft.
  const feedback = initialFeedback?.ownerId === state.ownerId ? initialFeedback : null;
  return <AppearanceForm key={state.ownerId} saved={state} initialFeedback={feedback} />;
}

/**
 * Description: Manage appearance drafts, width previews, confirmation, and success-only reloads.
 * Input: The saved authenticated appearance and optional one-time success feedback.
 * Output: The settings page with a secondary menu, accessible controls with
 *   separate saved/draft state, confirmations and accurate failures.
 * Use case: Persist personal or authorized global changes without applying drafts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function AppearanceForm({ saved, initialFeedback }: { saved: AppearanceState; initialFeedback: AppearanceFeedback | null }) {
  const id = useId();
  // The unsaved selection, and the saved appearance it was started from.
  const [draft, setDraft] = useState<Appearance>(saved.appearance);
  const [base, setBase] = useState(saved.appearance);
  // The open confirmation ("apply" or "reset") and its chosen scope.
  const [operation, setOperation] = useState<"apply" | "reset" | null>(null);
  const [scope, setScope] = useState<"personal" | "global">("personal");
  // "Discard changes" asks first (CLAUDE.md: confirm risky actions).
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Save progress and its feedback.
  const [pending, setPending] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(initialFeedback?.message ?? null);

  const mounted        = useRef(true);
  const saveController = useRef<AppearanceSaveController | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // The server has already validated the account-bound feedback. Consume only
  // its URL parameters, so refresh or account switching cannot replay it.
  useEffect(() => {
    const href    = clearAppearanceNoticeHref(window.location.href);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (href === current) return;
    try {
      window.history.replaceState(window.history.state, "", href);
    } catch {
      // Feedback still belongs only to the server-authenticated account.
    }
  }, []);

  // Incoming saves from another tab update a clean form; a local unsaved
  // selection stays intact and is compared with the latest saved preference.
  if (!same(base, saved.appearance)) {
    setBase(saved.appearance);
    if (same(draft, base)) setDraft(saved.appearance);
  }
  const dirty = !same(draft, saved.appearance);

  // Warn before leaving the page with an unsaved selection (until a save is confirmed).
  useEffect(() => {
    if (!dirty || committed) return;
    return installUnsavedAppearanceGuard(window, () => saveController.current?.hasCommitted() ?? false);
  }, [dirty, committed]);

  /**
   * Description: Change only the unsaved selection and dismiss any previous success notice.
   * Input: A supported theme, accent, and width combination.
   * Output: Updated local draft state; no preference write or workspace change.
   * Use case: Live previews and discarding draft changes.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function choose(next: Appearance) {
    setDraft(next);
    setMessage(null);
  }

  /**
   * Description: Open an Apply/Default confirmation with a safe personal-scope starting point.
   * Input: The requested apply or reset operation.
   * Output: A confirmation dialog with previous feedback cleared.
   * Use case: Require an explicit scope choice and confirmation before saving.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  function openDialog(next: "apply" | "reset") {
    if (saveController.current?.isPending()) return;
    setOperation(next);
    setScope("personal");
    setError(null);
    setMessage(null);
  }

  /**
   * Description: Submit the confirmed operation through the duplicate-safe save controller.
   * Input: The current operation, scope, draft, and authenticated owner state.
   * Output: Accurate error feedback or one committed-result page reload.
   * Use case: Preserve draft choices on failure and keep navigation guarded on success.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-15
   */
  async function confirmSave() {
    if (!operation || !saved.ownerId || saveController.current?.isPending()) return;
    setError(null);

    // Create the controller from this event, keeping refs out of render. The
    // keyed form unmounts on account switches, so the captured owner stays valid.
    if (!saveController.current) {
      saveController.current = createAppearanceSaveController({
        save: updateAppearanceAction,
        currentOwnerId: () => saved.ownerId,
        isMounted: () => mounted.current,
        onPending: setPending,
        onError: setError,
        onCommitted: (notice) => {
          setCommitted(true);
          setMessage(notice);
        },
        prepareReload: (code, ownerId) => {
          const href = appearanceNoticeHref(window.location.href, code, ownerId);
          window.history.replaceState(window.history.state, "", href);
        },
        notifyTabs: notifyAppearanceSaved,
        // The owner explicitly asked for one reload after a confirmed save (documented exception).
        reload: () => window.location.reload(),
      });
    }

    const input =
      operation === "apply"
        ? { operation, scope, expectedOwnerId: saved.ownerId, appearance: draft }
        : { operation, scope, expectedOwnerId: saved.ownerId };
    await saveController.current.submit(input);
  }

  /**
   * Description: Close the Apply/Default dialog unless a save is running.
   * Input: None.
   * Output: The dialog closes; a running save keeps it open.
   * Use case: Cancel, Escape and outside clicks of the confirmation.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function closeDialog() {
    if (!saveController.current?.isPending()) setOperation(null);
  }

  /**
   * Description: Accept a scope choice that the owner is allowed to make.
   * Input: The value selected in the scope radio group.
   * Output: The scope changes to "personal", or to "global" only with permission.
   * Use case: The "Who should this affect?" choice of the confirmation.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function chooseScope(value: string) {
    if (value === "personal" || (value === "global" && saved.canManageGlobal)) setScope(value);
  }

  // Texts of the confirmation, by operation and scope.
  const dialogTitle = operation === "apply" ? "Apply your appearance" : "Restore the default appearance";
  const dialogDescription =
    operation === "apply"
      ? `Selected: ${themeName(draft)} with ${accentName(draft)}, ${widthName(draft)}. Choose where to save it. The page reloads after a successful save.`
      : "Choose which default to restore. The page reloads only after you confirm and the reset is saved.";
  const confirmLabel = pending
    ? committed
      ? "Reloading…"
      : "Saving…"
    : scopeOptionLabel(operation, scope);
  const sourceLabel =
    saved.source === "personal" ? "Personal override" : saved.source === "global" ? "Platform default" : "Application default";

  return (
    <div className={cn("mx-auto flex w-full flex-col gap-6", pageWidthClass(saved.appearance.width))}>
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">Your workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-2 text-sm text-muted-foreground">Make the platform feel like your own.</p>
      </header>
      <nav aria-label="Settings" className="border-b border-border pb-3">
        <Button asChild variant="ghost" className="bg-accent-soft text-primary">
          <a href="/platform/settings/appearance" aria-current="page">
            <Icon name="sun" className="size-4" />
            Appearance
          </a>
        </Button>
      </nav>
      {message ? <Notice variant="success">{message}</Notice> : null}

      <SectionedLayout items={MENU_ITEMS} label="Appearance sections" contentClassName="flex flex-col gap-6">
        <Card role="region" aria-labelledby="appearance-title" className="gap-0 overflow-hidden py-0">
          <CardHeader className="flex flex-col justify-between gap-4 border-b border-border px-5 py-6 sm:flex-row sm:items-center sm:px-8">
            <div>
              <CardTitle>
                <h2 id="appearance-title" className="text-lg font-semibold tracking-tight">Appearance</h2>
              </CardTitle>
              <CardDescription className="mt-1">Choose your colors and the way your interface looks.</CardDescription>
            </div>
            <Badge variant={dirty ? "warning" : "secondary"} role="status" className="w-fit">
              <Icon name={dirty ? "pencil" : "check"} className="size-3" />
              {dirty ? "Unsaved changes" : "All changes saved"}
            </Badge>
          </CardHeader>

          <CardContent className="px-0">
            {/* 1. Currently saved */}
            <section id={SECTIONS.saved.id} aria-labelledby={`${id}-saved`} className={cn(ROW_CLASS, "py-5 text-sm")}>
              <div>
                <h3 id={`${id}-saved`} className="font-medium">Currently saved</h3>
                <p className="mt-1 text-xs text-muted-foreground">Active across your signed-in devices.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-lg px-3 py-1.5 text-sm whitespace-normal">
                  {appearanceSummary(saved.appearance)}
                </Badge>
                <span className="text-xs text-muted-foreground">{sourceLabel}</span>
              </div>
            </section>

            {/* 2. Accent color */}
            <fieldset id={SECTIONS.accent.id} disabled={pending} className={ROW_CLASS}>
              <legend className="sr-only">Accent color</legend>
              <div aria-hidden="true">
                <p className="text-sm font-medium">Accent color</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  A little personality for buttons, links, and active navigation. Neutral is the standard black and white.
                </p>
              </div>
              <div className="flex flex-col gap-4">
                <RadioGroup
                  name="accent"
                  aria-label="Accent color"
                  value={draft.accent}
                  disabled={pending}
                  onValueChange={(value) => {
                    const selected = ACCENT_OPTIONS.find((option) => option.value === value);
                    if (selected) choose({ ...draft, accent: selected.value });
                  }}
                  className="flex flex-wrap gap-3"
                >
                  {ACCENT_OPTIONS.map((option) => (
                    <RadioGroupItem
                      key={option.value}
                      value={option.value}
                      aria-label={option.label}
                      title={option.label}
                      className="size-9 cursor-pointer border-border bg-[var(--swatch-light)] text-primary-foreground shadow-xs data-[state=checked]:ring-2 data-[state=checked]:ring-primary data-[state=checked]:ring-offset-4 data-[state=checked]:ring-offset-card dark:bg-[var(--swatch-dark)] [&_svg]:size-3 [&_svg]:fill-current"
                      // The swatch shows the accent's own preset colours (the accent registry).
                      style={{ "--swatch-light": option.light, "--swatch-dark": option.dark } as CSSProperties}
                    />
                  ))}
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium">{accentName(draft)}</span> · Colors adapt for contrast in each theme.
                </p>
              </div>
            </fieldset>

            {/* 3. Interface theme */}
            <fieldset id={SECTIONS.theme.id} disabled={pending} className={ROW_CLASS}>
              <legend className="sr-only">Interface theme</legend>
              <div aria-hidden="true">
                <p className="text-sm font-medium">Interface theme</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Find your focus with a light, dark, or device-based appearance.</p>
              </div>
              <RadioGroup
                name="theme"
                aria-label="Interface theme"
                value={draft.theme}
                disabled={pending}
                onValueChange={(value) => {
                  const selected = THEMES.find((option) => option.value === value);
                  if (selected) choose({ ...draft, theme: selected.value });
                }}
                className="grid min-w-0 gap-4 xl:grid-cols-3"
              >
                {THEMES.map((option) => (
                  <AppearanceChoice
                    key={option.value}
                    id={`${id}-theme-${option.value}`}
                    value={option.value}
                    label={option.label}
                    description={option.description}
                    selected={draft.theme === option.value}
                    preview={<ThemePreview theme={option.value} accent={draft.accent} width={draft.width} />}
                  />
                ))}
              </RadioGroup>
            </fieldset>

            {/* 4. Content width */}
            <fieldset id={SECTIONS.width.id} disabled={pending} className={ROW_CLASS}>
              <legend className="sr-only">Content width</legend>
              <div aria-hidden="true">
                <p className="text-sm font-medium">Content width</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Choose the space your workspace content uses. Mobile gutters stay comfortable in every mode.
                </p>
              </div>
              <RadioGroup
                name="content-width"
                aria-label="Content width"
                value={draft.width}
                disabled={pending}
                onValueChange={(value) => {
                  const selected = WIDTH_OPTIONS.find((option) => option.value === value);
                  if (selected) choose({ ...draft, width: selected.value });
                }}
                className="grid min-w-0 gap-4 xl:grid-cols-3"
              >
                {WIDTH_OPTIONS.map((option) => (
                  <AppearanceChoice
                    key={option.value}
                    id={`${id}-width-${option.value}`}
                    value={option.value}
                    label={option.label}
                    description={option.description}
                    selected={draft.width === option.value}
                    preview={<ThemePreview theme={draft.theme} accent={draft.accent} width={option.value} />}
                  />
                ))}
              </RadioGroup>
            </fieldset>

            {/* 5. Preview */}
            <section id={SECTIONS.preview.id} aria-labelledby={`${id}-preview`} className={ROW_CLASS}>
              <div>
                <h3 id={`${id}-preview`} className="text-sm font-medium">Preview</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Your selection, before you apply it. The workspace updates after saving.
                </p>
              </div>
              <div className="min-w-0">
                <ThemePreview theme={draft.theme} accent={draft.accent} width={draft.width} large />
                <p className="mt-3 text-xs text-muted-foreground">
                  Illustrative preview · {themeName(draft)} with {accentName(draft)} · {widthName(draft)}
                </p>
              </div>
            </section>
          </CardContent>

          <CardFooter className="flex flex-col gap-4 bg-muted/40 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <Button type="button" variant="ghost" onClick={() => openDialog("reset")} disabled={pending}>
              <Icon name="refresh-cw" className="size-4" />
              Default
            </Button>
            <div className="flex w-full gap-3 sm:w-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => setConfirmDiscard(true)}
                disabled={!dirty || pending}
                className="flex-1 sm:flex-none"
              >
                Discard changes
              </Button>
              <Button type="button" onClick={() => openDialog("apply")} disabled={pending} className="flex-1 sm:flex-none">
                Apply
                <Icon name="arrow-right" className="size-4" />
              </Button>
            </div>
          </CardFooter>
        </Card>

        <div className="flex gap-3 px-1 text-xs leading-5 text-muted-foreground">
          <Icon name="shield-check" className="mt-0.5 size-4 shrink-0" />
          <p>
            Your personal settings take priority over the platform default. Apply to All updates the platform default and
            your existing override; other accounts’ overrides stay intact. Global resets preserve every personal override.
          </p>
        </div>
      </SectionedLayout>

      {/* Apply / Default: the owner chooses the scope and confirms before anything is saved. */}
      <ConfirmDialog
        open={operation !== null}
        onClose={closeDialog}
        title={dialogTitle}
        description={dialogDescription}
        confirmLabel={confirmLabel}
        pending={pending}
        error={error}
        onConfirm={() => {
          void confirmSave();
        }}
      >
        <RadioGroup
          name="appearance-scope"
          aria-label="Who should this affect?"
          value={scope}
          disabled={pending}
          onValueChange={chooseScope}
          className="gap-3"
        >
          {(["personal", "global"] as const).map((target) => {
            const unavailable = target === "global" && !saved.canManageGlobal;
            return (
              <div
                key={target}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4",
                  scope === target ? "border-primary bg-accent-soft" : "border-border",
                  unavailable && "opacity-60",
                )}
              >
                <RadioGroupItem
                  id={`${id}-scope-${target}`}
                  value={target}
                  disabled={unavailable}
                  className="mt-0.5"
                  aria-describedby={`${id}-scope-${target}-description`}
                />
                <div className="min-w-0 flex-1">
                  <Label htmlFor={`${id}-scope-${target}`} className="cursor-pointer text-sm font-semibold">
                    {scopeOptionLabel(operation, target)}
                  </Label>
                  <p id={`${id}-scope-${target}-description`} className="mt-1 text-xs leading-5 text-muted-foreground">
                    {scopeDescription(operation, target, saved.canManageGlobal)}
                  </p>
                </div>
              </div>
            );
          })}
        </RadioGroup>
        <ScopeWarning operation={operation} scope={scope} saved={saved} />
      </ConfirmDialog>

      {/* Discarding the unsaved selection cannot be undone: ask first. */}
      <ConfirmDialog
        open={confirmDiscard}
        onClose={() => setConfirmDiscard(false)}
        title="Discard your unsaved selection?"
        description={`Your selection goes back to the saved appearance: ${appearanceSummary(saved.appearance)}.`}
        confirmLabel="Discard changes"
        confirmVariant="danger"
        onConfirm={() => {
          setConfirmDiscard(false);
          choose(saved.appearance);
        }}
      />
    </div>
  );
}

/**
 * Description: Name a scope option (and the confirm button) for an operation.
 * Input: The open operation and the scope.
 * Output: "Apply to Me" / "Apply to All" or "Default Theme to Me" / "Default Theme to All".
 * Use case: The scope choices and the confirm button of the Apply/Default dialog.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function scopeOptionLabel(operation: "apply" | "reset" | null, scope: "personal" | "global"): string {
  if (operation === "apply") return scope === "personal" ? "Apply to Me" : "Apply to All";
  return scope === "personal" ? "Default Theme to Me" : "Default Theme to All";
}

/**
 * Description: Explain what a scope option changes.
 * Input: The open operation, the scope and whether the owner may change the platform default.
 * Output: One sentence for the option's description.
 * Use case: The scope choices of the Apply/Default dialog.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function scopeDescription(
  operation: "apply" | "reset" | null,
  scope: "personal" | "global",
  canManageGlobal: boolean,
): string {
  if (scope === "personal") {
    return operation === "apply"
      ? "Save only to your account. Other accounts keep their settings."
      : "Remove your personal override and inherit the platform default.";
  }
  if (!canManageGlobal) return "An administrator with global appearance permission is required.";
  return operation === "apply"
    ? "Save the platform default and update your existing personal override to match. Other accounts’ overrides stay intact."
    : "Restore the application default for the platform. Every personal override stays intact.";
}

/**
 * Description: Warn about the impact of the selected scope before confirming.
 * Input: The open operation, the chosen scope and the saved appearance state.
 * Output: A warning notice for global changes or for discarding a personal
 *   override; nothing otherwise.
 * Use case: Below the scope choices of the Apply/Default dialog.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function ScopeWarning({
  operation,
  scope,
  saved,
}: {
  operation: "apply" | "reset" | null;
  scope: "personal" | "global";
  saved: AppearanceState;
}) {
  if (scope === "global") {
    return (
      <Notice variant="warning">
        {operation === "apply"
          ? "Confirming changes the platform default, login page, and your appearance. Your existing override, if present, is updated to the selection. Other accounts’ overrides are preserved."
          : "Confirming resets the platform default and login page. All personal overrides are preserved, including yours. Your appearance changes only if you have no override."}
      </Notice>
    );
  }
  if (operation === "reset" && saved.personal) {
    const platformDefault = saved.global ?? DEFAULT_APPEARANCE;
    return (
      <Notice variant="warning">
        Your customized personal appearance will be discarded. The current platform default is{" "}
        {themeName(platformDefault)} with {accentName(platformDefault)}, {widthName(platformDefault)}.
      </Notice>
    );
  }
  return null;
}

/**
 * Description: Render one theme or width preview with a genuine controlled RadioGroupItem.
 * Input: The unique control ID, option label/description, selection and preview.
 * Output: A labelled, keyboard-accessible choice with shared Card styling.
 * Use case: Keep theme and width choices consistent without duplicating controls.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function AppearanceChoice({ id, value, label, description, selected, preview }: {
  id: string;
  value: string;
  label: string;
  description: string;
  selected: boolean;
  preview: ReactNode;
}) {
  return (
    <Card className={cn("min-w-0 gap-3 p-3 shadow-none", selected && "border-primary ring-1 ring-primary")}>
      <Label htmlFor={id} className="block cursor-pointer">{preview}</Label>
      <div className="flex items-center gap-2">
        <RadioGroupItem id={id} value={value} aria-describedby={`${id}-description`} />
        <Label htmlFor={id} className="cursor-pointer text-sm font-medium">{label}</Label>
      </div>
      <p id={`${id}-description`} className="pl-6 text-xs leading-5 text-muted-foreground">{description}</p>
    </Card>
  );
}
