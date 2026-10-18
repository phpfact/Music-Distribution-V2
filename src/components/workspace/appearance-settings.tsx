"use client";

import { Check, Monitor, Moon, RotateCcw, Save, Sun, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { type CSSProperties, type ReactNode, useId, useRef, useState, useTransition } from "react";
import { ConfirmDialog, Notice, SectionedLayout, type SecondaryMenuItem } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import {
  describeWorkspaceAppearance,
  sameWorkspaceAppearance,
  reconcileWorkspaceAppearanceDraft,
  WORKSPACE_ACCENT_OPTIONS,
  WORKSPACE_DEFAULT_APPEARANCE,
  WORKSPACE_THEME_OPTIONS,
  WORKSPACE_WIDTH_OPTIONS,
  type WorkspaceAppearanceActionResult,
  type WorkspaceAppearanceState,
  type WorkspaceAppearanceUpdate,
  type WorkspaceAppearanceValue,
} from "@/lib/workspace/appearance-options";
import { cn } from "@/lib/utils";

/** The page's sections (secondary-menu targets), in page order. */
const SECTIONS = {
  saved:     { id: "appearance-saved", label: "Currently saved" },
  theme:     { id: "appearance-theme", label: "Interface theme" },
  accent:    { id: "appearance-accent", label: "Accent color" },
  width:     { id: "appearance-width", label: "Content width" },
  preview:   { id: "appearance-preview", label: "Preview" },
  workspace: { id: "appearance-workspace", label: "Workspace default" },
} as const;

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

const SOURCE_LABELS = {
  personal: "Your personal choice",
  workspace: "Workspace default",
  default: "Application default",
} as const;

/** The confirmations this page can open. */
type Confirmation = "discard" | "reset-personal" | "apply-workspace" | "reset-workspace";

// Shown when the Server Action itself could not be reached.
const SAVE_FAILED = "Your appearance could not be saved. Check your connection and try again.";

type AppearanceSettingsProps = {
  /** The viewer's saved state, rendered on the server. */
  state: WorkspaceAppearanceState;
  /** The area's own appearance Server Action (it checks the session itself). */
  saveAction: (input: unknown) => Promise<WorkspaceAppearanceActionResult>;
};

/**
 * Description: The tenant portal's Appearance settings (built for the portal, not shared with the platform).
 * Input: The viewer's saved appearance state and the area's save action.
 * Output: Theme, accent and width choices with a live preview; "Save for me"
 *   and "Use workspace default"; for the tenant owner also "Apply to everyone"
 *   and "Reset workspace default". Drafts change nothing until saved; risky
 *   actions and discarding ask for confirmation; saves block repeat clicks,
 *   keep the draft after an error and refresh the server-rendered theme
 *   without a full page reload.
 * Use case: /tenant/settings/appearance and /customer/settings/appearance.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-17
 */
export function AppearanceSettings({ state, saveAction }: AppearanceSettingsProps) {
  const router                        = useRouter();
  const [, startTransition]           = useTransition();
  const [received, setReceived]       = useState(state);
  const [conflicts, setConflicts]     = useState<(keyof WorkspaceAppearanceValue)[]>([]);
  const [saved, setSaved]             = useState(state);
  const [draft, setDraft]             = useState<WorkspaceAppearanceValue>(state.appearance);
  const [pending, setPending]         = useState(false);
  const [notice, setNotice]           = useState<{ variant: "success" | "error"; text: string } | null>(null);
  const [confirm, setConfirm]         = useState<Confirmation | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const running = useRef(false);
  const id      = useId();

  // Reconcile during the prop-change render, before stale choices can be painted/saved.
  // A field-by-field rebase preserves intentional draft edits, while a header save
  // updates every untouched field and the authoritative permission/source baseline.
  if (received !== state) {
    const reconciled = reconcileWorkspaceAppearanceDraft(saved.appearance, draft, state.appearance, conflicts);
    setReceived(state);
    setSaved(state);
    setDraft(reconciled.draft);
    setConflicts(reconciled.conflicts);
  }

  const dirty = !sameWorkspaceAppearance(draft, saved.appearance);
  const menu: SecondaryMenuItem[] = Object.values(SECTIONS).filter(
    (section) => section.id !== SECTIONS.workspace.id || saved.canManageWorkspace,
  );

  /**
   * Description: Send one save request and apply the authoritative answer.
   * Input: The update and the success message.
   * Output: True when saved: the saved state and draft follow the server and
   *   the page's theme re-renders; on failure the draft stays and the error is shown.
   * Use case: Every save/reset button and confirmation of this page.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-17
   */
  async function submit(update: WorkspaceAppearanceUpdate, success: string): Promise<boolean> {
    if (running.current || (update.operation === "apply" && conflicts.length > 0)) return false;
    running.current = true;
    setPending(true);
    setNotice(null);
    setDialogError(null);
    try {
      const result = await saveAction(update);
      if (!result.ok) {
        // Inside a dialog the error shows there; otherwise above the page.
        if (confirm) setDialogError(result.error);
        else setNotice({ variant: "error", text: result.error });
        return false;
      }
      setConflicts([]);
      setSaved(result.state);
      setDraft(result.state.appearance);
      setNotice({ variant: "success", text: success });
      // Re-render the server layout with the new theme (no full reload).
      startTransition(() => router.refresh());
      return true;
    } catch {
      if (confirm) setDialogError(SAVE_FAILED);
      else setNotice({ variant: "error", text: SAVE_FAILED });
      return false;
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  /**
   * Description: Run the confirmed action of the open dialog.
   * Input: None (reads which confirmation is open).
   * Output: The dialog closes after success; it stays open with the error otherwise.
   * Use case: ConfirmDialog's onConfirm.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-17
   */
  async function confirmOpen() {
    if (confirm === "discard") {
      setDraft(saved.appearance);
      setConflicts([]);
      setConfirm(null);
      return;
    }
    const done =
      confirm === "reset-personal"
        ? await submit({ operation: "reset", scope: "personal" }, "Your personal choice was removed. You now use the workspace default.")
        : confirm === "apply-workspace"
          ? await submit(
              { operation: "apply", scope: "workspace", appearance: draft },
              "The workspace default was saved. Everyone without a personal choice now sees it, including the login and sign-up pages.",
            )
          : await submit(
              { operation: "reset", scope: "workspace" },
              "The workspace default was reset to Light, Neutral and Default width.",
            );
    if (done) setConfirm(null);
  }

  const dialog = confirm ? CONFIRMATIONS[confirm](draft) : null;

  return (
    <div className="flex flex-col gap-6">
      {notice ? (
        <Notice variant={notice.variant} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Notice>
      ) : null}

      {conflicts.length > 0 ? (
        <Notice variant="warning" title="Saved appearance changed">
          <p>Your saved {conflicts.join(", ")} changed while you were editing. Your draft is preserved. Choose which version to keep before saving.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => { setDraft(saved.appearance); setConflicts([]); }}>Use saved appearance</Button>
            <Button type="button" variant="outline" onClick={() => setConflicts([])}>Keep my draft</Button>
          </div>
        </Notice>
      ) : null}

      <SectionedLayout items={menu} contentClassName="flex flex-col gap-6">
        <section id={SECTIONS.saved.id} aria-labelledby={`${SECTIONS.saved.id}-title`}>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 id={`${SECTIONS.saved.id}-title`}>Currently saved</h2>
              </CardTitle>
              <CardDescription>What you see now, and where it comes from.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{describeWorkspaceAppearance(saved.appearance)}</Badge>
              <span className="text-muted-foreground">· {SOURCE_LABELS[saved.source]}</span>
              {dirty ? <Badge variant="warning">Unsaved changes</Badge> : null}
            </CardContent>
          </Card>
        </section>

        <ChoiceSection id={SECTIONS.theme.id} title="Interface theme" description="Light, dark, or follow your device.">
          <RadioGroup
            value={draft.theme}
            onValueChange={(value) => setDraft({ ...draft, theme: value as WorkspaceAppearanceValue["theme"] })}
            aria-labelledby={`${SECTIONS.theme.id}-title`}
            disabled={pending}
            className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
          >
            {WORKSPACE_THEME_OPTIONS.map((option) => {
              const Icon = THEME_ICONS[option.value];
              return (
                <ChoiceCard key={option.value} id={`${id}-theme-${option.value}`} value={option.value} selected={draft.theme === option.value}>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Icon aria-hidden="true" className="size-4" />
                    {option.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{option.description}</span>
                </ChoiceCard>
              );
            })}
          </RadioGroup>
        </ChoiceSection>

        <ChoiceSection id={SECTIONS.accent.id} title="Accent color" description="Used for buttons, links and highlights.">
          <RadioGroup
            value={draft.accent}
            onValueChange={(value) => setDraft({ ...draft, accent: value as WorkspaceAppearanceValue["accent"] })}
            aria-labelledby={`${SECTIONS.accent.id}-title`}
            disabled={pending}
            className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3"
          >
            {WORKSPACE_ACCENT_OPTIONS.map((option) => (
              <ChoiceCard key={option.value} id={`${id}-accent-${option.value}`} value={option.value} selected={draft.accent === option.value}>
                <span className="flex items-center gap-2 text-sm font-medium">
                  {/* The swatch shows the light and dark shade of the accent. */}
                  <span aria-hidden="true" className="flex overflow-hidden rounded-full border">
                    <span className="size-3" style={{ backgroundColor: option.light }} />
                    <span className="size-3" style={{ backgroundColor: option.dark }} />
                  </span>
                  {option.label}
                </span>
              </ChoiceCard>
            ))}
          </RadioGroup>
        </ChoiceSection>

        <ChoiceSection id={SECTIONS.width.id} title="Content width" description="How wide dashboard pages may grow.">
          <RadioGroup
            value={draft.width}
            onValueChange={(value) => setDraft({ ...draft, width: value as WorkspaceAppearanceValue["width"] })}
            aria-labelledby={`${SECTIONS.width.id}-title`}
            disabled={pending}
            className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
          >
            {WORKSPACE_WIDTH_OPTIONS.map((option) => (
              <ChoiceCard key={option.value} id={`${id}-width-${option.value}`} value={option.value} selected={draft.width === option.value}>
                <span className="text-sm font-medium">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </ChoiceCard>
            ))}
          </RadioGroup>
        </ChoiceSection>

        <section id={SECTIONS.preview.id} aria-labelledby={`${SECTIONS.preview.id}-title`}>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2 id={`${SECTIONS.preview.id}-title`}>Preview</h2>
              </CardTitle>
              <CardDescription>Your selection, before you save it.</CardDescription>
            </CardHeader>
            <CardContent>
              <AppearancePreview value={draft} />
            </CardContent>
          </Card>
        </section>

        {saved.canManageWorkspace ? (
          <section id={SECTIONS.workspace.id} aria-labelledby={`${SECTIONS.workspace.id}-title`}>
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2 id={`${SECTIONS.workspace.id}-title`}>Workspace default</h2>
                </CardTitle>
                <CardDescription>
                  Used by everyone in your workspace who has no personal choice — staff, customers and sub-customers
                  — and by the welcome, login and sign-up pages. Personal choices are never overwritten.
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm">
                <span className="text-muted-foreground">Current workspace default: </span>
                <Badge variant="outline">{describeWorkspaceAppearance(saved.workspace ?? WORKSPACE_DEFAULT_APPEARANCE)}</Badge>
              </CardContent>
              <CardFooter className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={pending || conflicts.length > 0} onClick={() => setConfirm("apply-workspace")}>
                  <Users aria-hidden="true" />
                  Apply selection to everyone
                </Button>
                <Button type="button" variant="ghost" disabled={pending || saved.workspace === null} onClick={() => setConfirm("reset-workspace")}>
                  <RotateCcw aria-hidden="true" />
                  Reset workspace default
                </Button>
              </CardFooter>
            </Card>
          </section>
        ) : null}
      </SectionedLayout>

      {/* Sticky action bar: always reachable at the bottom of long settings pages. */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:-mx-6 lg:px-6">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved.personal ? (
            <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirm("reset-personal")} className="mr-auto">
              <RotateCcw aria-hidden="true" />
              Use workspace default
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={pending || !dirty} onClick={() => setConfirm("discard")}>
            Discard changes
          </Button>
          <Button
            type="button"
            disabled={pending || conflicts.length > 0 || (!dirty && saved.source === "personal")}
            aria-busy={pending || undefined}
            onClick={() => void submit({ operation: "apply", scope: "personal", appearance: draft }, "Your appearance was saved.")}
          >
            {pending ? <Spinner /> : <Save aria-hidden="true" />}
            {pending ? "Saving…" : "Save for me"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onClose={() => {
          setConfirm(null);
          setDialogError(null);
        }}
        title={dialog?.title ?? ""}
        description={dialog?.description}
        confirmLabel={dialog?.confirm ?? "Confirm"}
        confirmVariant={dialog?.variant ?? "primary"}
        pending={pending}
        error={dialogError}
        onConfirm={() => void confirmOpen()}
      />
    </div>
  );
}

// The texts of every confirmation (the draft is named where it matters).
const CONFIRMATIONS: Record<
  Confirmation,
  (draft: WorkspaceAppearanceValue) => { title: string; description: string; confirm: string; variant: "primary" | "danger" }
> = {
  discard: () => ({
    title: "Discard your changes?",
    description: "Your unsaved selection is lost and the page goes back to what is saved.",
    confirm: "Discard",
    variant: "danger",
  }),
  "reset-personal": () => ({
    title: "Use the workspace default?",
    description: "Your personal choice is removed and you will see the workspace default from now on.",
    confirm: "Use workspace default",
    variant: "primary",
  }),
  "apply-workspace": (draft) => ({
    title: "Apply to everyone in your workspace?",
    description: `${describeWorkspaceAppearance(draft)} becomes the default for all of your staff, customers and sub-customers who have no personal choice, and for the public login and sign-up pages. Your own personal choice, if any, is updated too.`,
    confirm: "Apply to everyone",
    variant: "primary",
  }),
  "reset-workspace": () => ({
    title: "Reset the workspace default?",
    description: "The workspace default goes back to Light, Neutral and Default width. Personal choices stay as they are.",
    confirm: "Reset",
    variant: "danger",
  }),
};

/**
 * Description: Frame one group of choices as a card section.
 * Input: The section id, title, description and the choices.
 * Output: A section with an h2 (the radio group is labelled by it).
 * Use case: Theme, accent and width sections.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function ChoiceSection({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`}>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 id={`${id}-title`}>{title}</h2>
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}

/**
 * Description: Render one selectable card of a radio group.
 * Input: The option id and value, whether it is selected, and its content.
 * Output: A label wrapping a visible radio, with a clear selected border and check.
 * Use case: Theme, accent and width choices.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function ChoiceCard({ id, value, selected, children }: { id: string; value: string; selected: boolean; children: ReactNode }) {
  return (
    <Label
      htmlFor={id}
      className={cn(
        "relative flex cursor-pointer flex-col items-start gap-1.5 rounded-lg border p-3 font-normal transition-colors hover:bg-accent/50",
        // The radio itself is visually hidden: the card shows its keyboard focus.
        "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
        selected ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <RadioGroupItem id={id} value={value} className="sr-only" />
      {selected ? <Check aria-hidden="true" className="absolute top-2.5 right-2.5 size-4 text-primary" /> : null}
      {children}
    </Label>
  );
}

/**
 * Description: Draw a miniature dashboard in a draft appearance.
 * Input: The draft appearance.
 * Output: A decorative preview rendered in its own theme scope (theme class and
 *   accent variables), using only theme tokens.
 * Use case: The Preview section.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function AppearancePreview({ value }: { value: WorkspaceAppearanceValue }) {
  const accent = WORKSPACE_ACCENT_OPTIONS.find((option) => option.value === value.accent) ?? WORKSPACE_ACCENT_OPTIONS[0];
  const style  = { "--accent-light": accent?.light, "--accent-dark": accent?.dark } as CSSProperties;
  const narrow = value.width === "focused";
  const full   = value.width === "full";

  return (
    <div
      aria-hidden="true"
      style={style}
      className={cn(value.theme, "workspace-theme flex h-56 overflow-hidden rounded-lg border bg-sidebar")}
    >
      <div className="flex w-28 shrink-0 flex-col gap-2 p-3">
        <div className="h-5 w-16 rounded bg-primary" />
        <div className="mt-2 h-3 w-20 rounded bg-sidebar-accent" />
        <div className="h-3 w-14 rounded bg-sidebar-accent" />
        <div className="h-3 w-16 rounded bg-sidebar-accent" />
      </div>
      <div className="m-2 ml-0 flex flex-1 flex-col rounded-md bg-background p-3 shadow-sm">
        <div className="mb-3 h-3 w-24 rounded bg-muted" />
        <div className={cn("mx-auto flex w-full flex-col gap-2", narrow && "max-w-[70%]", !narrow && !full && "max-w-[92%]")}>
          <div className="grid grid-cols-3 gap-2">
            <div className="h-12 rounded border bg-card" />
            <div className="h-12 rounded border bg-card" />
            <div className="h-12 rounded border bg-card" />
          </div>
          <div className="h-16 rounded border bg-card p-2">
            <div className="h-2 w-1/2 rounded bg-primary/70" />
          </div>
          <div className="flex gap-2">
            <div className="h-6 w-20 rounded bg-primary" />
            <div className="h-6 w-16 rounded border bg-card" />
          </div>
        </div>
      </div>
    </div>
  );
}
