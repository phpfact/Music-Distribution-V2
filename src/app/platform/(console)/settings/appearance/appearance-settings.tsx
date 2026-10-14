"use client";

import { useEffect, useRef, useState } from "react";
import { ACCENT_OPTIONS, DEFAULT_APPEARANCE, type Appearance, type AppearanceState } from "@/lib/appearance/preferences";
import { notifyAppearanceSaved, useTheme } from "@/app/platform/theme-root";
import { ConfirmDialog } from "../../_components/confirm-dialog";
import { Icon, type IconName } from "../../_components/icons";
import { Notice } from "../../_components/notice";
import { FOCUS_RING } from "../../_components/styles";
import { buttonClass } from "../../_components/ui";
import { updateAppearanceAction } from "./actions";
import { ThemePreview } from "./theme-preview";

const THEMES: { value: Appearance["theme"]; label: string; description: string; icon: IconName }[] = [
  { value: "system", label: "System preference", description: "Follow your device’s light or dark mode.", icon: "layout-grid" },
  { value: "light", label: "Light", description: "A bright, clear workspace.", icon: "sun" },
  { value: "dark", label: "Dark", description: "A calmer view in low light.", icon: "moon" },
];
const same = (a: Appearance, b: Appearance) => a.theme === b.theme && a.accent === b.accent;
const themeName = (appearance: Appearance) => THEMES.find((item) => item.value === appearance.theme)?.label ?? "Light";
const accentName = (appearance: Appearance) => ACCENT_OPTIONS.find((item) => item.value === appearance.accent)?.label ?? "Emerald";

export function AppearanceSettings() {
  const { state } = useTheme();
  // A cross-tab account switch remounts the form and discards the old draft.
  return state.ownerId ? <AppearanceForm key={state.ownerId} saved={state} /> : <Notice variant="warning">Your session has ended. Sign in again to manage your appearance.</Notice>;
}

function AppearanceForm({ saved }: { saved: AppearanceState }) {
  const { acceptState, captureVersion } = useTheme();
  const [draft, setDraft] = useState<Appearance>(saved.appearance);
  const [base, setBase] = useState(saved.appearance);
  const [operation, setOperation] = useState<"apply" | "reset" | null>(null);
  const [scope, setScope] = useState<"personal" | "global">("personal");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Incoming saves from another tab update a clean form; a local unsaved
  // selection stays intact and is compared with the latest saved preference.
  if (!same(base, saved.appearance)) {
    setBase(saved.appearance);
    if (same(draft, base)) setDraft(saved.appearance);
  }
  const dirty = !same(draft, saved.appearance);

  function choose(next: Appearance) { setDraft(next); setMessage(null); }
  function openDialog(next: "apply" | "reset") {
    if (submitting.current) return;
    setOperation(next); setScope("personal"); setError(null); setMessage(null);
  }
  async function confirm() {
    if (!operation || submitting.current) return;
    submitting.current = true;
    const version = captureVersion();
    setPending(true); setError(null);
    try {
      const result = await updateAppearanceAction({ operation, scope, expectedOwnerId: saved.ownerId ?? undefined, ...(operation === "apply" ? { appearance: draft } : {}) });
      if (!mounted.current) return;
      if (!result.ok) { setError(result.error); return; }
      const accepted = acceptState(result.state, version);
      notifyAppearanceSaved();
      if (!accepted) {
        setMessage("Your change was saved. Refreshing the latest appearance settings.");
        setOperation(null);
        return;
      }
      if (scope === "personal") {
        setDraft(result.state.appearance);
        setMessage(operation === "apply" ? "Your appearance is saved. Only your account was updated." : "Your personal override was removed. You now use the platform default.");
      } else {
        setDraft(result.state.appearance);
        setMessage(operation === "apply" ? "The platform default is saved. Personal overrides are preserved." : "The platform default was reset to Light with Emerald. Personal overrides are preserved.");
      }
      setOperation(null);
    } catch {
      setError("We couldn’t save your appearance. Your selection is unchanged. Please try again.");
    } finally { submitting.current = false; if (mounted.current) setPending(false); }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
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
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 font-medium">{themeName(saved.appearance)} · {accentName(saved.appearance)}</span><span className="text-xs text-fg-subtle">{saved.source === "personal" ? "Personal override" : saved.source === "global" ? "Platform default" : "Application default"}</span></div>
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
          <div className="grid min-w-0 gap-4 md:grid-cols-3">
            {THEMES.map((option) => <label key={option.value} className="min-w-0 cursor-pointer"><input className="peer sr-only" type="radio" name="theme" value={option.value} checked={draft.theme === option.value} onChange={() => choose({ ...draft, theme: option.value })} /><div className="rounded-xl p-1 ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent"><ThemePreview theme={option.value} accent={draft.accent} /></div><div className="mt-3 flex items-center gap-2 text-sm font-medium"><span aria-hidden="true" className={`grid size-4 shrink-0 place-items-center rounded-full border ${draft.theme === option.value ? "border-accent bg-accent text-accent-fg" : "border-line"}`}>{draft.theme === option.value ? <Icon name="check" className="size-3" /> : null}</span>{option.label}</div><p className="mt-1 pl-6 text-xs leading-5 text-fg-subtle">{option.description}</p></label>)}
          </div>
        </fieldset>

        <div className="grid gap-5 border-b border-line px-5 py-7 sm:grid-cols-[13rem_1fr] sm:gap-8 sm:px-8">
          <div><p className="text-sm font-medium">Preview</p><p className="mt-1 text-xs leading-5 text-fg-subtle">Your selection, before you apply it. The workspace updates after saving.</p></div>
          <div className="min-w-0"><ThemePreview theme={draft.theme} accent={draft.accent} large /><p className="mt-3 text-xs text-fg-subtle">Illustrative preview · {themeName(draft)} with {accentName(draft)}</p></div>
        </div>

        <div className="flex flex-col gap-4 bg-surface-2/40 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <button type="button" onClick={() => openDialog("reset")} disabled={pending} className={buttonClass("ghost")}><Icon name="refresh-cw" className="size-4" />Default</button>
          <div className="flex gap-3"><button type="button" onClick={() => { choose(saved.appearance); }} disabled={!dirty || pending} className={`${buttonClass("secondary")} flex-1 sm:flex-none`}>Discard changes</button><button type="button" onClick={() => openDialog("apply")} disabled={pending} className={`${buttonClass("primary")} flex-1 sm:flex-none`}>Apply<Icon name="arrow-right" className="size-4" /></button></div>
        </div>
      </section>

      <div className="flex gap-3 px-1 text-xs leading-5 text-fg-subtle"><Icon name="shield-check" className="mt-0.5 size-4 shrink-0" /><p>Your personal settings take priority over the platform default. Global changes affect platform owners without a personal override, including the signed-out login page.</p></div>

      <ConfirmDialog open={operation !== null} onClose={() => { if (!submitting.current) setOperation(null); }} title={operation === "apply" ? "Apply your appearance" : "Restore the default appearance"} description={operation === "apply" ? `Selected: ${themeName(draft)} with ${accentName(draft)}. Choose where to save it.` : "Choose which default to restore. Changes happen only after you confirm."} confirmLabel={operation === "apply" ? scope === "personal" ? "Apply to Me" : "Apply to All" : scope === "personal" ? "Default Theme to Me" : "Default Theme to All"} pending={pending} error={error} onConfirm={() => { void confirm(); }}>
        <fieldset disabled={pending} className="space-y-3"><legend className="sr-only">Who should this affect?</legend>
          {(["personal", "global"] as const).map((target) => <label key={target} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${scope === target ? "border-accent bg-accent-soft" : "border-line"} ${target === "global" && !saved.canManageGlobal ? "cursor-not-allowed opacity-60" : ""}`}><input type="radio" name="appearance-scope" checked={scope === target} onChange={() => setScope(target)} disabled={target === "global" && !saved.canManageGlobal} className="mt-0.5 size-4 accent-accent" /><span><span className="block text-sm font-semibold">{operation === "apply" ? target === "personal" ? "Apply to Me" : "Apply to All" : target === "personal" ? "Default Theme to Me" : "Default Theme to All"}</span><span className="mt-1 block text-xs leading-5 text-fg-muted">{target === "personal" ? operation === "apply" ? "Save only to your account. Other accounts keep their settings." : "Remove your personal override and inherit the platform default." : !saved.canManageGlobal ? "An administrator with global appearance permission is required." : operation === "apply" ? "Change the default for all platform owners without an override. Personal settings stay intact." : "Restore the application default for the platform. Personal settings stay intact."}</span></span></label>)}
        </fieldset>
        {scope === "global" ? <Notice variant="warning">Confirming changes the platform-wide default and the login page. Your own appearance changes only if you have no personal override.</Notice> : operation === "reset" && saved.personal ? <Notice variant="warning">Your customized personal appearance will be discarded. The current platform default is {themeName(saved.global ?? DEFAULT_APPEARANCE)} with {accentName(saved.global ?? DEFAULT_APPEARANCE)}.</Notice> : null}
      </ConfirmDialog>
    </div>
  );
}
