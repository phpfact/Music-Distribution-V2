"use client";

import { useEffect, useRef, useState } from "react";
import { ACCENT_OPTIONS, DEFAULT_APPEARANCE, WIDTH_OPTIONS, type Appearance, type AppearanceState } from "@/lib/appearance/preferences";
import { notifyAppearanceSaved, useTheme } from "@/app/platform/theme-root";
import { ConfirmDialog } from "../../_components/confirm-dialog";
import { Icon, type IconName } from "../../_components/icons";
import { Notice } from "../../_components/notice";
import { FOCUS_RING } from "../../_components/styles";
import { buttonClass } from "../../_components/ui";
import { updateAppearanceAction } from "./actions";
import { ThemePreview } from "./theme-preview";
import { appearanceNoticeHref, clearAppearanceNoticeHref, type AppearanceFeedback } from "./feedback";
import { createAppearanceSaveController, installUnsavedAppearanceGuard, sameAppearance as same, type AppearanceSaveController } from "./save-and-reload";

const THEMES: { value: Appearance["theme"]; label: string; description: string; icon: IconName }[] = [
  { value: "system", label: "System preference", description: "Follow your device’s light or dark mode.", icon: "layout-grid" },
  { value: "light", label: "Light", description: "A bright, clear workspace.", icon: "sun" },
  { value: "dark", label: "Dark", description: "A calmer view in low light.", icon: "moon" },
];
const themeName = (appearance: Appearance) => THEMES.find((item) => item.value === appearance.theme)?.label ?? "Light";
const accentName = (appearance: Appearance) => ACCENT_OPTIONS.find((item) => item.value === appearance.accent)?.label ?? "Emerald";
/**
 * Name a supported content width for saved-state and confirmation summaries.
 * Input: a complete validated appearance.
 * Output: the corresponding human-readable width label.
 * Use case: distinguish saved width from an unsaved width selection.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
const widthName = (appearance: Appearance) => WIDTH_OPTIONS.find((item) => item.value === appearance.width)?.label ?? "Default Width";

/**
 * Render the authenticated account's appearance form and account-bound feedback.
 * Input: feedback validated by the authenticated server page.
 * Output: a keyed form, or a session-ended notice when no account is active.
 * Use case: discard the previous account's draft and feedback on account switches.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
export function AppearanceSettings({ initialFeedback }: { initialFeedback: AppearanceFeedback | null }) {
  const { state } = useTheme();
  // A cross-tab account switch remounts the form and discards the old draft.
  return state.ownerId ? <AppearanceForm key={state.ownerId} saved={state} initialFeedback={initialFeedback?.ownerId === state.ownerId ? initialFeedback : null} /> : <Notice variant="warning">Your session has ended. Sign in again to manage your appearance.</Notice>;
}

/**
 * Manage appearance drafts, width previews, confirmation, and success-only reloads.
 * Input: the saved authenticated appearance and optional one-time success feedback.
 * Output: accessible controls with separate saved/draft state and accurate failures.
 * Use case: persist personal or authorized global changes without applying drafts.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-14
 */
function AppearanceForm({ saved, initialFeedback }: { saved: AppearanceState; initialFeedback: AppearanceFeedback | null }) {
  const [draft, setDraft] = useState<Appearance>(saved.appearance);
  const [base, setBase] = useState(saved.appearance);
  const [operation, setOperation] = useState<"apply" | "reset" | null>(null);
  const [scope, setScope] = useState<"personal" | "global">("personal");
  const [pending, setPending] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(initialFeedback?.message ?? null);
  const mounted = useRef(true);
  const saveController = useRef<AppearanceSaveController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // The server has already validated the account-bound feedback. Consume only
  // its URL parameters, so refresh or account switching cannot replay it.
  useEffect(() => {
    const href = clearAppearanceNoticeHref(window.location.href);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (href !== current) {
      try { window.history.replaceState(window.history.state, "", href); } catch { /* Feedback still belongs only to the server-authenticated account. */ }
    }
  }, []);

  // Incoming saves from another tab update a clean form; a local unsaved
  // selection stays intact and is compared with the latest saved preference.
  if (!same(base, saved.appearance)) {
    setBase(saved.appearance);
    if (same(draft, base)) setDraft(saved.appearance);
  }
  const dirty = !same(draft, saved.appearance);
  const formWidth = saved.appearance.width === "full" ? "max-w-none" : saved.appearance.width === "focused" ? "max-w-4xl" : "max-w-5xl";

  useEffect(() => {
    if (!dirty || committed) return;
    return installUnsavedAppearanceGuard(window, () => saveController.current?.hasCommitted() ?? false);
  }, [dirty, committed]);

  /**
   * Change only the unsaved selection and dismiss any previous success notice.
   * Input: a supported theme, accent, and width combination.
   * Output: updated local draft state; no preference write or workspace change.
   * Use case: live previews and discarding draft changes.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-14
   */
  function choose(next: Appearance) { setDraft(next); setMessage(null); }

  /**
   * Open an Apply/Default confirmation with a safe personal-scope starting point.
   * Input: the requested apply or reset operation.
   * Output: a confirmation dialog with previous feedback cleared.
   * Use case: require an explicit scope choice and confirmation before saving.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-14
   */
  function openDialog(next: "apply" | "reset") {
    if (saveController.current?.isPending()) return;
    setOperation(next); setScope("personal"); setError(null); setMessage(null);
  }
  /**
   * Submit the confirmed operation through the duplicate-safe save controller.
   * Input: the current operation, scope, draft, and authenticated owner state.
   * Output: accurate error feedback or one committed-result page reload.
   * Use case: preserve draft choices on failure and keep navigation guarded on success.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14
   * Last modified: 2026-10-14
   */
  async function confirm() {
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
        onCommitted: (notice) => { setCommitted(true); setMessage(notice); },
        prepareReload: (code, ownerId) => {
          const href = appearanceNoticeHref(window.location.href, code, ownerId);
          window.history.replaceState(window.history.state, "", href);
        },
        notifyTabs: notifyAppearanceSaved,
        reload: () => window.location.reload(),
      });
    }
    const input = operation === "apply"
      ? { operation, scope, expectedOwnerId: saved.ownerId, appearance: draft }
      : { operation, scope, expectedOwnerId: saved.ownerId };
    await saveController.current.submit(input);
  }

  return (
    <div className={`mx-auto flex w-full flex-col gap-6 ${formWidth}`}>
      <header>
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent">Your workspace</p>
        <h1 className="text-3xl font-semibold tracking-tight text-fg">Settings</h1>
        <p className="mt-2 text-sm text-fg-muted">Make the platform feel like your own.</p>
      </header>
      <nav aria-label="Settings" className="border-b border-line">
        <a href="/platform/settings/appearance" aria-current="page" className={`-mb-px inline-flex items-center gap-2 border-b-2 border-accent px-1 pb-3 text-sm font-semibold text-accent ${FOCUS_RING}`}><Icon name="sun" className="size-4" />Appearance</a>
      </nav>
      {message ? <Notice variant="success">{message}</Notice> : null}

      <section aria-labelledby="appearance-title" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm shadow-black/[0.02]">
        <div className="flex flex-col justify-between gap-4 border-b border-line px-5 py-6 sm:flex-row sm:items-center sm:px-8">
          <div><h2 id="appearance-title" className="text-lg font-semibold tracking-tight">Appearance</h2><p className="mt-1 text-sm text-fg-muted">Choose your colors and the way your interface looks.</p></div>
          <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${dirty ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "border-line bg-surface-2 text-fg-muted"}`} role="status"><Icon name={dirty ? "pencil" : "check"} className="size-3" />{dirty ? "Unsaved changes" : "All changes saved"}</span>
        </div>

        <div className="grid gap-3 border-b border-line px-5 py-5 text-sm sm:grid-cols-[13rem_1fr] sm:gap-8 sm:px-8">
          <div><p className="font-medium">Currently saved</p><p className="mt-1 text-xs text-fg-subtle">Active across your signed-in devices.</p></div>
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-medium">{themeName(saved.appearance)} · {accentName(saved.appearance)} · {widthName(saved.appearance)}</span><span className="text-xs text-fg-subtle">{saved.source === "personal" ? "Personal override" : saved.source === "global" ? "Platform default" : "Application default"}</span></div>
        </div>

        <fieldset disabled={pending} className="grid min-w-0 gap-5 border-b border-line px-5 py-7 sm:grid-cols-[13rem_1fr] sm:gap-8 sm:px-8">
          <legend className="sr-only">Accent color</legend>
          <div aria-hidden="true"><p className="text-sm font-medium">Accent color</p><p className="mt-1 text-xs leading-5 text-fg-subtle">A little personality for buttons, links, and active navigation.</p></div>
          <div className="flex flex-col gap-4"><div className="flex flex-wrap gap-3">
            {ACCENT_OPTIONS.map((option) => <label key={option.value} title={option.label} className="relative cursor-pointer"><input className="peer sr-only" type="radio" name="accent" value={option.value} checked={draft.accent === option.value} onChange={() => choose({ ...draft, accent: option.value })} /><span aria-hidden="true" className="grid size-9 place-items-center rounded-full border border-black/10 ring-offset-4 ring-offset-surface peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent" style={{ background: option.light }}>{draft.accent === option.value ? <Icon name="check" className="size-4 text-white" /> : null}</span><span className="sr-only">{option.label}</span></label>)}
          </div><p className="text-xs text-fg-subtle"><span className="font-medium text-fg-muted">{accentName(draft)}</span> · Colors adapt for contrast in each theme.</p></div>
        </fieldset>

        <fieldset disabled={pending} className="grid min-w-0 gap-5 border-b border-line px-5 py-7 sm:grid-cols-[13rem_1fr] sm:gap-8 sm:px-8">
          <legend className="sr-only">Interface theme</legend>
          <div aria-hidden="true"><p className="text-sm font-medium">Interface theme</p><p className="mt-1 text-xs leading-5 text-fg-subtle">Find your focus with a light, dark, or device-based appearance.</p></div>
          <div className="grid min-w-0 gap-4 xl:grid-cols-3">
            {THEMES.map((option) => <label key={option.value} className="min-w-0 cursor-pointer"><input className="peer sr-only" type="radio" name="theme" value={option.value} checked={draft.theme === option.value} onChange={() => choose({ ...draft, theme: option.value })} /><div className="rounded-xl p-1 ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"><ThemePreview theme={option.value} accent={draft.accent} width={draft.width} /></div><div className="mt-3 flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className={`grid size-4 shrink-0 place-items-center rounded-full border ${draft.theme === option.value ? "border-accent bg-accent text-accent-fg" : "border-line"}`}>{draft.theme === option.value ? <Icon name="check" className="size-3" /> : null}</span>{option.label}</div><p className="mt-1 pl-6 text-xs leading-5 text-fg-subtle">{option.description}</p></label>)}
          </div>
        </fieldset>

        <fieldset disabled={pending} className="grid min-w-0 gap-5 border-b border-line px-5 py-7 sm:grid-cols-[13rem_1fr] sm:gap-8 sm:px-8">
          <legend className="sr-only">Content width</legend>
          <div aria-hidden="true"><p className="text-sm font-medium">Content width</p><p className="mt-1 text-xs leading-5 text-fg-subtle">Choose the space your workspace content uses. Mobile gutters stay comfortable in every mode.</p></div>
          <div className="grid min-w-0 gap-4 xl:grid-cols-3">
            {WIDTH_OPTIONS.map((option) => (
              <label key={option.value} className="min-w-0 cursor-pointer">
                <input className="peer sr-only" type="radio" name="content-width" value={option.value} checked={draft.width === option.value} onChange={() => choose({ ...draft, width: option.value })} />
                <div className="rounded-xl p-1 ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"><ThemePreview theme={draft.theme} accent={draft.accent} width={option.value} /></div>
                <div className="mt-3 flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className={`grid size-4 shrink-0 place-items-center rounded-full border ${draft.width === option.value ? "border-accent bg-accent text-accent-fg" : "border-line"}`}>{draft.width === option.value ? <Icon name="check" className="size-3" /> : null}</span>{option.label}</div>
                <p className="mt-1 pl-6 text-xs leading-5 text-fg-subtle">{option.description}</p>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-5 border-b border-line px-5 py-7 sm:grid-cols-[13rem_1fr] sm:gap-8 sm:px-8">
          <div><p className="text-sm font-medium">Preview</p><p className="mt-1 text-xs leading-5 text-fg-subtle">Your selection, before you apply it. The workspace updates after saving.</p></div>
          <div className="min-w-0"><ThemePreview theme={draft.theme} accent={draft.accent} width={draft.width} large /><p className="mt-3 text-xs text-fg-subtle">Illustrative preview · {themeName(draft)} with {accentName(draft)} · {widthName(draft)}</p></div>
        </div>

        <div className="flex flex-col gap-4 bg-surface-2/40 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <button type="button" onClick={() => openDialog("reset")} disabled={pending} className={buttonClass("ghost")}><Icon name="refresh-cw" className="size-4" />Default</button>
          <div className="flex gap-3"><button type="button" onClick={() => { choose(saved.appearance); }} disabled={!dirty || pending} className={`${buttonClass("secondary")} flex-1 sm:flex-none`}>Discard changes</button><button type="button" onClick={() => openDialog("apply")} disabled={pending} className={`${buttonClass("primary")} flex-1 sm:flex-none`}>Apply<Icon name="arrow-right" className="size-4" /></button></div>
        </div>
      </section>

      <div className="flex gap-3 px-1 text-xs leading-5 text-fg-subtle"><Icon name="shield-check" className="mt-0.5 size-4 shrink-0" /><p>Your personal settings take priority over the platform default. Apply to All updates the platform default and your existing override; other accounts’ overrides stay intact. Global resets preserve every personal override.</p></div>

      <ConfirmDialog open={operation !== null} onClose={() => { if (!saveController.current?.isPending()) setOperation(null); }} title={operation === "apply" ? "Apply your appearance" : "Restore the default appearance"} description={operation === "apply" ? `Selected: ${themeName(draft)} with ${accentName(draft)}, ${widthName(draft)}. Choose where to save it. The page reloads after a successful save.` : "Choose which default to restore. The page reloads only after you confirm and the reset is saved."} confirmLabel={pending ? committed ? "Reloading…" : "Saving…" : operation === "apply" ? scope === "personal" ? "Apply to Me" : "Apply to All" : scope === "personal" ? "Default Theme to Me" : "Default Theme to All"} pending={pending} error={error} onConfirm={() => { void confirm(); }}>
        <fieldset disabled={pending} className="space-y-3"><legend className="sr-only">Who should this affect?</legend>
          {(["personal", "global"] as const).map((target) => <label key={target} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${scope === target ? "border-accent bg-accent-soft" : "border-line"} ${target === "global" && !saved.canManageGlobal ? "cursor-not-allowed opacity-60" : ""}`}><input type="radio" name="appearance-scope" checked={scope === target} onChange={() => setScope(target)} disabled={target === "global" && !saved.canManageGlobal} className="mt-0.5 size-4 accent-accent" /><span><span className="block text-sm font-semibold">{operation === "apply" ? target === "personal" ? "Apply to Me" : "Apply to All" : target === "personal" ? "Default Theme to Me" : "Default Theme to All"}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{target === "personal" ? operation === "apply" ? "Save only to your account. Other accounts keep their settings." : "Remove your personal override and inherit the platform default." : !saved.canManageGlobal ? "An administrator with global appearance permission is required." : operation === "apply" ? "Save the platform default and update your existing personal override to match. Other accounts’ overrides stay intact." : "Restore the application default for the platform. Every personal override stays intact."}</span></span></label>)}
        </fieldset>
        {scope === "global" ? <Notice variant="warning">{operation === "apply" ? "Confirming changes the platform default, login page, and your appearance. Your existing override, if present, is updated to the selection. Other accounts’ overrides are preserved." : "Confirming resets the platform default and login page. All personal overrides are preserved, including yours. Your appearance changes only if you have no override."}</Notice> : operation === "reset" && saved.personal ? <Notice variant="warning">Your customized personal appearance will be discarded. The current platform default is {themeName(saved.global ?? DEFAULT_APPEARANCE)} with {accentName(saved.global ?? DEFAULT_APPEARANCE)}, {widthName(saved.global ?? DEFAULT_APPEARANCE)}.</Notice> : null}
      </ConfirmDialog>
    </div>
  );
}
