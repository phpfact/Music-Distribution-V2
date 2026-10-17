"use client";

import { useId, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  MODULE_DISABLE_WARNINGS,
  MODULE_UNAVAILABLE_MESSAGE,
  moduleSwitchedMessage,
  type ModuleStateView,
  type ModuleToggleResult,
} from "@/lib/authz/module-model";
import { setPlatformModuleAction } from "../settings/modules/actions";
import { setTenantModuleAction } from "../tenants/[id]/module-actions";
import { ConfirmDialog } from "./confirm-dialog";
import { Icon } from "./icons";
import { Notice } from "./notice";
import { Spinner } from "./spinner";
import { ToneBadge } from "./status-badge";

/** Which switch board the list belongs to (decides the Server Action). */
export type ModuleToggleTarget = { scope: "platform" } | { scope: "tenant"; tenantId: string };

/** One titled group of modules (e.g. "Tenant panel"); the title is optional. */
export type ModuleToggleGroup = {
  /** Stable id (DOM ids are derived from it). */
  id: string;
  title?: string;
  modules: ModuleStateView[];
};

type ModuleToggleListProps = {
  target: ModuleToggleTarget;
  groups: ModuleToggleGroup[];
  /** True when the viewer may switch modules; otherwise read-only On/Off badges. */
  canManage: boolean;
};

/** The result notice shown above the list. */
type Feedback = { variant: "success" | "error"; message: string };

/**
 * Description: Call the Server Action of the list's switch board.
 * Input: The target (platform or one tenant), the module key and the target state.
 * Output: The action's result; a network/transport failure becomes a friendly
 *   "unavailable" result, so the caller never deals with exceptions.
 * Use case: ModuleToggleList, for both switch boards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
async function callSwitchAction(target: ModuleToggleTarget, moduleKey: string, enabled: boolean): Promise<ModuleToggleResult> {
  try {
    return target.scope === "platform"
      ? await setPlatformModuleAction(moduleKey, enabled)
      : await setTenantModuleAction(target.tenantId, moduleKey, enabled);
  } catch {
    // E.g. the connection dropped; the server logs its own failures.
    return { ok: false, reason: "unavailable", error: MODULE_UNAVAILABLE_MESSAGE };
  }
}

/**
 * Description: Render module rows with on/off switches (or read-only badges) and
 *   handle switching: confirmation before turning a module off, direct apply
 *   when turning it on, a pending state per row and a result notice.
 * Input: The switch board target, the module groups and whether the viewer may
 *   switch modules.
 * Output: The groups of rows. Each row shows label, description and its
 *   privileges, plus a Switch (non-core, may manage), an "On"/"Off" badge
 *   (non-core, read-only) or a "Core · always on" lock badge (core). The shown
 *   state changes only after the server confirms; on an error it stays as it
 *   was and the error is shown (inside the dialog when it came from there).
 * Use case: /platform/settings/modules and the tenant details page's
 *   "Module access" section (one shared implementation).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function ModuleToggleList({ target, groups, canManage }: ModuleToggleListProps) {
  // States confirmed by the server since the last render of fresh server data.
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  // Rows whose switch request is running (switch disabled + spinner).
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  // The module waiting for the "turn off" confirmation, and that dialog's error.
  const [confirming, setConfirming] = useState<ModuleStateView | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Fresh server data (after the action's revalidation) replaces local confirmations.
  const [previousGroups, setPreviousGroups] = useState(groups);
  if (previousGroups !== groups) {
    setPreviousGroups(groups);
    setConfirmed({});
  }

  /**
   * Description: Send one switch request and show its outcome.
   * Input: The module, the target state and whether it came from the confirmation dialog.
   * Output: Nothing; updates the shown state, the notice or the dialog error.
   * Use case: Turning a module on (directly) or off (after confirmation).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  async function applySwitch(module: ModuleStateView, enabled: boolean, fromDialog: boolean): Promise<void> {
    // Step 1: one request per row at a time (the switch is disabled meanwhile).
    if (pending[module.key]) return;
    setPending((current) => ({ ...current, [module.key]: true }));
    if (!fromDialog) setFeedback(null);

    // Step 2: the Server Action (authorizes, validates, switches, audits).
    const result = await callSwitchAction(target, module.key, enabled);
    setPending((current) => ({ ...current, [module.key]: false }));

    // Step 3a: refused or failed — keep the shown state; report where the user is looking.
    if (!result.ok) {
      if (fromDialog) setDialogError(result.error);
      else setFeedback({ variant: "error", message: result.error });
      return;
    }

    // Step 3b: confirmed by the server.
    setConfirmed((current) => ({ ...current, [module.key]: result.module.enabled }));
    setConfirming(null);
    setDialogError(null);
    setFeedback({ variant: "success", message: moduleSwitchedMessage(module.label, result.module.enabled) });
  }

  /**
   * Description: React to a switch click.
   * Input: The module and the requested state.
   * Output: Nothing; turning off opens the confirmation, turning on applies directly.
   * Use case: The Switch of every non-core row.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function onSwitch(module: ModuleStateView, enabled: boolean): void {
    if (enabled) {
      void applySwitch(module, true, false);
      return;
    }
    // Risky: every role of the panel loses these privileges at once.
    setDialogError(null);
    setConfirming(module);
  }

  const confirmingPending = confirming ? pending[confirming.key] === true : false;

  return (
    <div className="flex flex-col gap-4">
      {feedback ? (
        <Notice variant={feedback.variant} onDismiss={() => setFeedback(null)}>
          {feedback.message}
        </Notice>
      ) : null}

      {groups.map((group) => (
        <ModuleGroup
          key={group.id}
          group={group}
          canManage={canManage}
          isEnabled={(module) => confirmed[module.key] ?? module.enabled}
          isPending={(module) => pending[module.key] === true}
          onSwitch={onSwitch}
        />
      ))}

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => {
          setConfirming(null);
          setDialogError(null);
        }}
        title={confirming ? `Turn off ${confirming.label}?` : ""}
        description={confirming ? MODULE_DISABLE_WARNINGS[confirming.domain] : undefined}
        confirmLabel={confirmingPending ? "Turning off…" : "Turn off"}
        confirmVariant="danger"
        pending={confirmingPending}
        error={dialogError}
        onConfirm={() => {
          if (confirming) void applySwitch(confirming, false, true);
        }}
      >
        {confirming && confirming.privileges.length > 0 ? (
          <div className="flex flex-col gap-2 text-sm">
            <p className="font-medium">Privileges switched off</p>
            <ul className="list-disc space-y-1 pl-5 text-fg-muted">
              {confirming.privileges.map((privilege) => (
                <li key={privilege.key}>{privilege.label}</li>
              ))}
            </ul>
            <p className="text-fg-muted">Turning the module on again restores them for the roles that hold them.</p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}

type ModuleGroupProps = {
  group: ModuleToggleGroup;
  canManage: boolean;
  isEnabled: (module: ModuleStateView) => boolean;
  isPending: (module: ModuleStateView) => boolean;
  onSwitch: (module: ModuleStateView, enabled: boolean) => void;
};

/**
 * Description: Render one group of module rows with an optional heading.
 * Input: The group, whether the viewer may switch, state/pending lookups and the click handler.
 * Output: A labelled list of module rows (divided by borders).
 * Use case: ModuleToggleList ("Tenant panel", "Customer panel", or the untitled platform list).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function ModuleGroup({ group, canManage, isEnabled, isPending, onSwitch }: ModuleGroupProps) {
  const headingId = useId();
  return (
    <div className="flex flex-col gap-1">
      {group.title ? (
        <h3 id={headingId} className="text-sm font-semibold">
          {group.title}
        </h3>
      ) : null}
      <ul aria-labelledby={group.title ? headingId : undefined} className="divide-y divide-border">
        {group.modules.map((module) => (
          <ModuleRow
            key={module.key}
            module={module}
            canManage={canManage}
            enabled={isEnabled(module)}
            pending={isPending(module)}
            onSwitch={onSwitch}
          />
        ))}
      </ul>
    </div>
  );
}

type ModuleRowProps = {
  module: ModuleStateView;
  canManage: boolean;
  enabled: boolean;
  pending: boolean;
  onSwitch: (module: ModuleStateView, enabled: boolean) => void;
};

/**
 * Description: Render one module row: texts, privileges and its control.
 * Input: The module, whether the viewer may switch, its shown state, its pending flag and the click handler.
 * Output: A list item; the control is a lock badge (core), a Switch with
 *   "On"/"Off" text and a spinner while saving (may manage) or an On/Off badge.
 * Use case: ModuleGroup.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function ModuleRow({ module, canManage, enabled, pending, onSwitch }: ModuleRowProps) {
  const id            = useId();
  const labelId       = `${id}-label`;
  const descriptionId = `${id}-description`;

  return (
    <li className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="flex min-w-0 flex-col gap-1">
        <p id={labelId} className="text-sm font-medium break-words">
          {module.label}
        </p>
        <p id={descriptionId} className="text-sm break-words text-fg-muted">
          {module.description}
        </p>
        {module.privileges.length > 0 ? (
          <ul aria-label={`${module.label} privileges`} className="mt-1 flex flex-wrap gap-1.5">
            {module.privileges.map((privilege) => (
              <li
                key={privilege.key}
                title={privilege.description}
                className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-fg-muted"
              >
                {privilege.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:pt-0.5">
        {module.core ? (
          // Core modules can never be switched off (nobody can be locked out).
          <ToneBadge tone="neutral">
            <Icon name="lock" className="size-3" />
            Core · always on
          </ToneBadge>
        ) : canManage ? (
          <>
            {pending ? <Spinner className="text-fg-muted" /> : null}
            {/* Visible state text; the switch itself announces it through aria-checked. */}
            <span aria-hidden="true" className="w-7 text-right text-sm text-fg-muted">
              {enabled ? "On" : "Off"}
            </span>
            <Switch
              checked={enabled}
              disabled={pending}
              aria-busy={pending || undefined}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              onCheckedChange={(next) => onSwitch(module, next)}
            />
          </>
        ) : (
          <ToneBadge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</ToneBadge>
        )}
      </div>
    </li>
  );
}
