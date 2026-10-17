import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AccessDenied } from "@/components/shared";
import type { TenantModuleGroups } from "@/lib/authz/module-model";
import { listTenantModules } from "@/lib/authz/module-service";
import { requirePlatformAccess } from "@/lib/authz/platform";
import { getControlDb } from "@/lib/db/control";
import { getTenantDetails, type TenantDetails } from "@/lib/tenants/service";
import { Avatar } from "../../_components/avatar";
import { CopyButton } from "../../_components/copy-button";
import { CountDetails } from "../../_components/count-details";
import { EmptyState } from "../../_components/empty-state";
import { Icon, type IconName } from "../../_components/icons";
import { ModuleToggleList } from "../../_components/module-toggle-list";
import { Notice } from "../../_components/notice";
import { SectionedLayout, type SecondaryMenuItem } from "../../_components/secondary-menu";
import { SensitiveValue } from "../../_components/sensitive-value";
import { Spinner } from "../../_components/spinner";
import { StatusBadge, ToneBadge } from "../../_components/status-badge";
import { FOCUS_RING } from "../../_components/styles";
import { DomainStatusBadge } from "../_components/badges";
import { LifecycleButton } from "../_components/lifecycle-button";
import {
  TenantFlashNotice,
  TenantFlashProvider,
} from "../_components/tenant-flash";
import {
  DATABASE_MODE_LABELS,
  HISTORY_LABELS,
  isSetupInProgress,
  SCHEMA_STATUS_LABELS,
  showsSetupCard,
  suspensionLead,
} from "../details";
import { formatDate, formatDateTime, tenantSiteUrl } from "../format";
import { tenantNoticeMessage, TENANTS_PATH } from "../list-query";
import { AutoRefresh } from "./_components/auto-refresh";
import { DatabasePassword } from "./_components/database-password";
import { DomainCheck } from "./_components/domain-check";
import { ResetMasterPassword } from "./_components/reset-master-password";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** The page's sections (category-wise), in page order: DOM id, heading and icon. */
const SECTIONS = {
  setup:    { id: "tenant-setup-progress", title: "Setup Progress", icon: "loader" },
  profile:  { id: "tenant-personal-information", title: "Personal Information", icon: "user" },
  login:    { id: "tenant-login-information", title: "Login Information", icon: "key-round" },
  database: { id: "tenant-database-information", title: "Database Information", icon: "database" },
  domains:  { id: "tenant-domain-information", title: "Domain Information", icon: "globe" },
  modules:  { id: "tenant-module-access", title: "Module Access", icon: "layout-grid" },
  history:  { id: "tenant-status-history", title: "Status History", icon: "clock" },
} as const satisfies Record<string, { id: string; title: string; icon: IconName }>;

/** What the signed-in owner may do on this page (decided on the server per request). */
type TenantPagePermissions = {
  /** platform.tenants.edit: Edit button and the domain DNS checks. */
  edit: boolean;
  /** platform.tenants.suspend: Suspend / Reactivate. */
  suspend: boolean;
  /** platform.tenants.provision: Retry setup. */
  provision: boolean;
  /** platform.tenants.credentials: Reset master password, rotate/update the database password. */
  credentials: boolean;
  /** platform.tenant_registrations.view: the Registrations link. */
  registrations: boolean;
  /** platform.tenant_modules.manage: the switches of the Module access section. */
  modules: boolean;
};

// The page shown instead of the details when platform.tenants.view is missing.
const DASHBOARD_PATH = "/platform/dashboard";

// The secondary menu lists every section; the Setup Progress item disappears
// by itself while that card is not shown (the menu follows the page's DOM).
const MENU_ITEMS: readonly SecondaryMenuItem[] = Object.values(SECTIONS).map((section) => ({
  id: section.id,
  label: section.title,
  icon: section.icon,
}));

/**
 * Description: Load the tenant details once per request for the metadata and the page.
 * Input: The tenant id from the URL.
 * Output: The details DTO, or null when there is no such tenant.
 * Use case: generateMetadata and TenantDetailsPage (React cache: one database read).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
const loadTenant = cache(async (id: string) => getTenantDetails(id));

/**
 * Description: Build the details page's title without exposing data to signed-out visitors.
 * Input: The route parameters (tenant id).
 * Output: The tenant's name, or "Tenant not found"; "Access denied" without
 *   platform.tenants.view; a signed-out visitor is redirected first.
 * Use case: The browser tab title of /platform/tenants/<id>.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  // No tenant data in the title without a session and the view privilege.
  const { access } = await requirePlatformAccess();
  if (!access.can("platform.tenants.view")) return { title: "Access denied" };
  const tenant = await loadTenant((await params).id);
  return { title: tenant ? tenant.name : "Tenant not found" };
}

/**
 * Description: Render the protected tenant details page.
 * Input: The route parameters (tenant id) and search parameters (notice).
 * Output: The header with the permitted actions, notices, the secondary menu and the
 *   Setup, Personal, Login, Database, Domain, Module access and Status History sections;
 *   sensitive values are masked; 404 when the tenant does not exist. Needs
 *   platform.tenants.view (otherwise the inline access-denied state, HTTP 200,
 *   before anything is read); every button appears only with its privilege.
 * Use case: /platform/tenants/<id> — the owner reviews and manages one tenant
 *   (and opens its customer registrations).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
export default async function TenantDetailsPage({
  params,
  searchParams,
}: PageProps) {
  // Checked on the server on every request: session and CURRENT privileges.
  const { access } = await requirePlatformAccess();
  if (!access.can("platform.tenants.view")) return <AccessDenied homeHref={DASHBOARD_PATH} />;
  // The page's buttons follow the privileges (each action checks again).
  const can: TenantPagePermissions = {
    edit: access.can("platform.tenants.edit"),
    suspend: access.can("platform.tenants.suspend"),
    provision: access.can("platform.tenants.provision"),
    credentials: access.can("platform.tenants.credentials"),
    registrations: access.can("platform.tenant_registrations.view"),
    modules: access.can("platform.tenant_modules.manage"),
  };
  const { id } = await params;
  const tenant = await loadTenant(id);
  if (!tenant) notFound();
  // The tenant's panel modules and their switches (control plane, read fresh).
  const modules = await listTenantModules(getControlDb(), tenant.id);

  const notice         = tenantNoticeMessage((await searchParams).notice);
  const requestHeaders = await headers();
  const siteRequest = {
    host: requestHeaders.get("host"),
    forwardedProto: requestHeaders.get("x-forwarded-proto"),
  };

  return (
    <TenantFlashProvider>
      <div className="flex flex-col gap-6">
        <Link
          href={TENANTS_PATH}
          className={`inline-flex items-center gap-1.5 self-start rounded-md text-sm font-medium text-fg-muted transition-colors hover:text-fg ${FOCUS_RING}`}
        >
          <Icon name="arrow-left" className="size-4" />
          Tenants
        </Link>

        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar
              name={tenant.name}
              src={
                tenant.hasProfileImage
                  ? `${TENANTS_PATH}/${tenant.id}/avatar`
                  : null
              }
              size="lg"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
                  {tenant.name}
                </h1>
                <StatusBadge status={tenant.status} />
              </div>
              {/* The username is masked in the Admin login card, so it is not repeated here. */}
              <p className="text-sm break-words text-fg-muted">
                Created{" "}
                <time dateTime={tenant.createdAt}>
                  {formatDate(tenant.createdAt)}
                </time>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Customer sign-ups exist only once the tenant's database is set up. */}
            {can.registrations && (tenant.status === "active" || tenant.status === "suspended") ? (
              <Button asChild variant="outline">
                <Link href={`${TENANTS_PATH}/${tenant.id}/registrations`}>
                  <Icon name="user" className="size-4" />
                  Registrations
                </Link>
              </Button>
            ) : null}
            {can.edit ? (
              <Button asChild variant="outline">
                <Link href={`${TENANTS_PATH}/${tenant.id}/edit`}>
                  <Icon name="pencil" className="size-4" />
                  Edit
                </Link>
              </Button>
            ) : null}
            {can.provision && tenant.provisioning.canRetry ? (
              <LifecycleButton
                action="retry"
                tenantId={tenant.id}
                tenantName={tenant.name}
              />
            ) : null}
            {can.suspend && tenant.status === "suspended" ? (
              <LifecycleButton
                action="reactivate"
                tenantId={tenant.id}
                tenantName={tenant.name}
              />
            ) : null}
            {can.suspend && tenant.status === "active" ? (
              <LifecycleButton
                action="suspend"
                tenantId={tenant.id}
                tenantName={tenant.name}
              />
            ) : null}
          </div>
        </header>

        {notice ? <Notice variant="success">{notice}</Notice> : null}
        <TenantFlashNotice />
        {tenant.suspension ? <SuspensionNotice suspension={tenant.suspension} /> : null}

        <SectionedLayout items={MENU_ITEMS} contentClassName="flex flex-col gap-6">
          {showsSetupCard(tenant.status, tenant.provisioning.canRetry) ? (
            <SetupCard tenant={tenant} canRetry={can.provision} />
          ) : null}

          <div className="grid gap-6 2xl:grid-cols-2">
            <ProfileCard tenant={tenant} />
            <LoginCard tenant={tenant} canManageCredentials={can.credentials} />
            <DatabaseCard tenant={tenant} canManageCredentials={can.credentials} />
            <DomainsCard tenant={tenant} siteRequest={siteRequest} canCheck={can.edit} />
          </div>

          <ModulesCard tenantId={tenant.id} modules={modules} canManage={can.modules} />

          <HistoryCard tenant={tenant} />
        </SectionedLayout>

        <AutoRefresh active={isSetupInProgress(tenant.status)} />
      </div>
    </TenantFlashProvider>
  );
}

// ---------------------------------------------------------------------------
// Building blocks

/**
 * Description: Render the suspension notice with the suspending owner masked.
 * Input: The tenant's suspension (time, actor and whether it is a username, reason).
 * Output: An error notice: "Suspended on <date> by <actor>: <reason>"; a platform
 *   owner's username is masked behind an eye button, "System" is not.
 * Use case: The details page of a suspended tenant.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function SuspensionNotice({
  suspension,
}: {
  suspension: NonNullable<TenantDetails["suspension"]>;
}) {
  return (
    <Notice variant="error">
      <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
        <span>{suspensionLead(suspension)}</span>
        {suspension.by ? (
          <>
            <span>by</span>
            {suspension.byIsUsername ? (
              <SensitiveValue value={suspension.by} noun="owner username" monospace={false} />
            ) : (
              <span>{suspension.by}</span>
            )}
          </>
        ) : null}
        <span>{suspension.reason ? `: ${suspension.reason}` : "."}</span>
      </span>
    </Notice>
  );
}

type DetailCardProps = {
  /** The section's DOM id (secondary-menu target). */
  id: string;
  title: string;
  icon: IconName;
  /**
   * Buttons in the card header (the credential and domain actions go here).
   */
  actions?: ReactNode;
  children: ReactNode;
};

/**
 * Description: Render one labelled section of the details page as a card.
 * Input: The section id, title, icon, optional header actions and the body.
 * Output: A `<section id>` named by its heading, with a fixed-height header row so
 *   side-by-side cards line up.
 * Use case: Every details section; the id is the secondary menu's scroll target.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function DetailCard({ id, title, icon, actions, children }: DetailCardProps) {
  const titleId = `${id}-title`;
  return (
    <section id={id} aria-labelledby={titleId}>
      <Card className="h-full min-w-0 gap-0 py-0">
        {/* min-h keeps headers with and without buttons the same height, so side-by-side cards line up. */}
        <CardHeader className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
          <CardTitle
            id={titleId}
            role="heading"
            aria-level={2}
            className="flex items-center gap-2 text-base"
          >
            <Icon name={icon} className="size-4 text-fg-muted" />
            {title}
          </CardTitle>
          {actions ? (
            <div className="flex flex-wrap gap-2">{actions}</div>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-4 p-5">
          {children}
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Description: Lay out a details section's label/value pairs.
 * Input: The DetailRow children.
 * Output: A responsive definition list (labels beside values from sm).
 * Use case: Personal, Login and Database Information cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function DetailList({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)]">
      {children}
    </dl>
  );
}

/**
 * Description: Pair one label with its value in a DetailList.
 * Input: The label and the value.
 * Output: A dt/dd pair; long values wrap.
 * Use case: The details cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="contents">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

/**
 * Description: Show a muted placeholder for an optional value.
 * Input: The placeholder text (default "—").
 * Output: The text in the subtle colour.
 * Use case: Absent phone, database name/user/port, domains.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function Missing({ children = "—" }: { children?: ReactNode }) {
  return <span className="text-fg-subtle">{children}</span>;
}

/**
 * Description: Show a small informational note in a card.
 * Input: The note text.
 * Output: An info icon and the text in the subtle colour.
 * Use case: Database and Domain Information cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function Note({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 text-xs text-fg-subtle">
      <Icon name="info" className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Setup progress

const STEP_STATES = {
  done: { text: "Done", className: "text-success" },
  running: { text: "In progress", className: "text-warning" },
  failed: { text: "Failed", className: "text-destructive" },
  waiting: { text: "Waiting", className: "text-fg-subtle" },
} as const;

/**
 * Description: Draw a setup step's state icon.
 * Input: The step state.
 * Output: A spinner while running, otherwise a check, cross or empty circle in the
 *   state's semantic colour.
 * Use case: Setup Progress list and the setup-steps dialog.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function StepIcon({ state }: { state: keyof typeof STEP_STATES }) {
  const className = `size-5 shrink-0 ${STEP_STATES[state].className}`;
  if (state === "running") return <Spinner size="md" className={className} />;
  const name: IconName =
    state === "done"
      ? "circle-check"
      : state === "failed"
        ? "circle-x"
        : "circle";
  return <Icon name={name} className={className} />;
}

/**
 * Description: Summarize the setup progress in one sentence.
 * Input: The tenant.
 * Output: "Setup failed.", "Step n of m: <step>…", "Waiting to start." or "n of m steps done.".
 * Use case: Setup Progress (announced as the page refreshes) and its count dialog.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function setupSummary(tenant: TenantDetails): string {
  const { steps } = tenant.provisioning;
  const running = steps.find((step) => step.state === "running");
  const done    = steps.filter((step) => step.state === "done").length;
  if (tenant.status === "failed") return "Setup failed.";
  if (running) return `Step ${done + 1} of ${steps.length}: ${running.label}…`;
  if (tenant.status === "pending") return "Waiting to start.";
  return `${done} of ${steps.length} steps done.`;
}

/**
 * Description: Render the Setup Progress section.
 * Input: The tenant and whether the owner holds platform.tenants.provision.
 * Output: The progress sentence (opens the steps dialog), the attempt, the last error
 *   with retry advice, every step with its state and the Retry setup button
 *   when allowed.
 * Use case: The details page while setup is unfinished or retryable.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
function SetupCard({ tenant, canRetry: mayRetry }: { tenant: TenantDetails; canRetry: boolean }) {
  const { steps, attempt, lastError } = tenant.provisioning;
  // Retry needs both a retryable state and platform.tenants.provision.
  const canRetry = tenant.provisioning.canRetry && mayRetry;
  const running  = isSetupInProgress(tenant.status);

  return (
    <DetailCard id={SECTIONS.setup.id} title={SECTIONS.setup.title} icon={SECTIONS.setup.icon}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/* Announced as the page refreshes itself, so progress is heard as well as seen.
            The step count opens the full step list with each step's state. */}
        <p aria-live="polite" className="text-sm font-medium text-fg">
          <SetupProgressDetails tenant={tenant} />
        </p>
        <p className="text-xs text-fg-subtle">
          {attempt > 0 ? `Attempt ${attempt}` : "Not started yet"}
          {running ? " · Updates automatically" : ""}
        </p>
      </div>

      {tenant.status === "failed" && lastError ? (
        <Notice variant="error" title="Setup failed">
          <p>{lastError.message}</p>
          {canRetry ? (
            <p className="mt-1">Fix the cause if needed, then retry setup.</p>
          ) : null}
        </Notice>
      ) : null}

      <ol className="flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.step} className="flex items-center gap-3 text-sm">
            <StepIcon state={step.state} />
            <span
              className={`min-w-0 flex-1 ${step.state === "waiting" ? "text-fg-muted" : "text-fg"}`}
            >
              {step.label}
            </span>
            <span
              className={`text-xs font-medium ${STEP_STATES[step.state].className}`}
            >
              {STEP_STATES[step.state].text}
            </span>
          </li>
        ))}
      </ol>

      {canRetry ? (
        <div>
          <LifecycleButton
            action="retry"
            tenantId={tenant.id}
            tenantName={tenant.name}
            variant="outline"
          />
        </div>
      ) : null}
    </DetailCard>
  );
}

/**
 * Description: Make the setup progress line a count button with its step list.
 * Input: The tenant (status and provisioning steps).
 * Output: The progress sentence as a button; its dialog explains the count and
 *   lists every step of this tenant's setup with its state.
 * Use case: Setup Progress (CLAUDE.md count transparency: "3 of 7 steps done").
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function SetupProgressDetails({ tenant }: { tenant: TenantDetails }) {
  const { steps } = tenant.provisioning;
  const done = steps.filter((step) => step.state === "done").length;
  return (
    <CountDetails
      label={`${setupSummary(tenant)} Show every setup step.`}
      title="Setup steps"
      description={`The steps of ${tenant.name}'s setup, in the order they run.`}
      calculation={`Steps done ÷ steps in this tenant's setup plan: ${done} of ${steps.length}. A step counts as done only after it finished successfully.`}
      records={
        <ol className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {steps.map((step, index) => (
            <li key={step.step} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="w-6 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                {index + 1}.
              </span>
              <StepIcon state={step.state} />
              <span className="min-w-0 flex-1">{step.label}</span>
              <span className={`text-xs font-medium ${STEP_STATES[step.state].className}`}>
                {STEP_STATES[step.state].text}
              </span>
            </li>
          ))}
        </ol>
      }
      className="text-sm font-medium text-fg"
    >
      {setupSummary(tenant)}
    </CountDetails>
  );
}

// ---------------------------------------------------------------------------
// Cards

/**
 * Description: Render the Personal Information section.
 * Input: The tenant.
 * Output: Name, and the phone and email masked behind eye buttons.
 * Use case: The details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function ProfileCard({ tenant }: { tenant: TenantDetails }) {
  return (
    <DetailCard id={SECTIONS.profile.id} title={SECTIONS.profile.title} icon={SECTIONS.profile.icon}>
      <DetailList>
        <DetailRow label="Name">{tenant.profile.name}</DetailRow>
        {/* Contact details are sensitive: masked until the eye button is used. */}
        <DetailRow label="Phone">
          {tenant.profile.phone ? (
            <SensitiveValue value={tenant.profile.phone} noun="phone number" monospace={false} />
          ) : (
            <Missing>Not provided</Missing>
          )}
        </DetailRow>
        <DetailRow label="Email">
          <SensitiveValue value={tenant.profile.email} noun="email" monospace={false} />
        </DetailRow>
      </DetailList>
    </DetailCard>
  );
}

/**
 * Description: Render the Login Information section.
 * Input: The tenant and whether the owner holds platform.tenants.credentials.
 * Output: The username and email masked behind eye buttons, the 2FA note and the
 *   Reset master password action (not while setup runs).
 * Use case: The details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
function LoginCard({ tenant, canManageCredentials }: { tenant: TenantDetails; canManageCredentials: boolean }) {
  return (
    <DetailCard
      id={SECTIONS.login.id}
      title={SECTIONS.login.title}
      icon={SECTIONS.login.icon}
      actions={
        // Setup writes the same login: nothing to offer while it runs (or without the privilege).
        tenant.status === "provisioning" || !canManageCredentials ? undefined : (
          <ResetMasterPassword
            tenantId={tenant.id}
            tenantName={tenant.name}
            username={tenant.login.username}
          />
        )
      }
    >
      <DetailList>
        <DetailRow label="Username">
          <SensitiveValue value={tenant.login.username} noun="username" />
        </DetailRow>
        <DetailRow label="Email">
          <SensitiveValue value={tenant.login.email} noun="email" monospace={false} />
        </DetailRow>
        <DetailRow label="Two-factor authentication">
          <span className="text-fg-muted">
            Not available yet — two-factor sign-in isn&apos;t supported for
            tenant accounts.
          </span>
        </DetailRow>
      </DetailList>
    </DetailCard>
  );
}

const SCHEMA_TONES = {
  pending: "warning",
  current: "success",
  failed: "danger",
} as const;

/**
 * Description: Render the Database Information section.
 * Input: The tenant and whether the owner holds platform.tenants.credentials.
 * Output: Mode, name and user and server (masked), port, password status (never the
 *   password), schema status and the Rotate/Update password action (not while
 *   setup runs).
 * Use case: The details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
function DatabaseCard({ tenant, canManageCredentials }: { tenant: TenantDetails; canManageCredentials: boolean }) {
  const { database } = tenant;
  return (
    <DetailCard
      id={SECTIONS.database.id}
      title={SECTIONS.database.title}
      icon={SECTIONS.database.icon}
      actions={
        tenant.status === "provisioning" || !canManageCredentials ? undefined : (
          <DatabasePassword
            tenantId={tenant.id}
            tenantName={tenant.name}
            mode={database.mode}
          />
        )
      }
    >
      <DetailList>
        <DetailRow label="Mode">
          {DATABASE_MODE_LABELS[database.mode]}
        </DetailRow>
        <DetailRow label="Name">
          {database.name ? (
            <SensitiveValue value={database.name} noun="database name" />
          ) : (
            <Missing />
          )}
        </DetailRow>
        <DetailRow label="User">
          {database.user ? (
            <SensitiveValue value={database.user} noun="database user" />
          ) : (
            <Missing />
          )}
        </DetailRow>
        <DetailRow label="Port">{database.port ?? <Missing />}</DetailRow>
        {/* Connection information: masked until the eye button is used. */}
        <DetailRow label="Server">
          <SensitiveValue value={database.host} noun="database server" />
        </DetailRow>
        <DetailRow label="Password">
          {database.hasPassword ? (
            "Stored encrypted"
          ) : (
            <Missing>Not set</Missing>
          )}
        </DetailRow>
        <DetailRow label="Schema">
          <span className="flex flex-wrap items-center gap-2">
            <ToneBadge tone={SCHEMA_TONES[database.schemaStatus]}>
              {SCHEMA_STATUS_LABELS[database.schemaStatus]}
            </ToneBadge>
            {database.schemaVersion ? (
              <span className="font-mono text-xs break-all text-fg-muted">
                {database.schemaVersion}
              </span>
            ) : null}
          </span>
        </DetailRow>
      </DetailList>
      <Note>
        Database name, user and port can&apos;t be changed after creation.
      </Note>
    </DetailCard>
  );
}

/**
 * Description: Show a domain check's last error.
 * Input: The message.
 * Output: The text in the destructive colour.
 * Use case: Domain Information.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function CheckError({ children }: { children: ReactNode }) {
  return <p className="text-sm text-destructive">{children}</p>;
}

/**
 * Description: Render the Domain Information section.
 * Input: The tenant, the console request's host/scheme (for the site link) and
 *   whether the owner holds platform.tenants.edit (DNS checks).
 * Output: The subdomain (link when active) and custom domain with their status, the
 *   TXT record to add (with copy buttons), last check details and the DNS check
 *   actions (not while setup runs).
 * Use case: The details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-16
 */
function DomainsCard({
  tenant,
  siteRequest,
  canCheck: mayCheck,
}: {
  tenant: TenantDetails;
  siteRequest: { host: string | null; forwardedProto: string | null };
  canCheck: boolean;
}) {
  const { subdomain, custom } = tenant.domains;
  // DNS checks need platform.tenants.edit and are not offered while setup runs.
  const canCheck = mayCheck && tenant.status !== "provisioning";

  return (
    <DetailCard id={SECTIONS.domains.id} title={SECTIONS.domains.title} icon={SECTIONS.domains.icon}>
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wider text-fg-subtle uppercase">
          SaaS subdomain
        </h3>
        {subdomain ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {subdomain.status === "active" ? (
                <a
                  href={tenantSiteUrl(subdomain.host, siteRequest)}
                  className={`rounded-sm font-medium break-all text-primary underline-offset-4 hover:underline ${FOCUS_RING}`}
                >
                  {subdomain.host}
                </a>
              ) : (
                <span className="font-medium break-all text-fg">
                  {subdomain.host}
                </span>
              )}
              <DomainStatusBadge status={subdomain.status} />
            </div>
            {subdomain.status !== "active" && subdomain.lastCheckError ? (
              <CheckError>{subdomain.lastCheckError}</CheckError>
            ) : null}
            {canCheck && subdomain.status !== "active" ? (
              <DomainCheck tenantId={tenant.id} kind="subdomain" />
            ) : null}
          </>
        ) : (
          <p className="text-sm">
            <Missing>No subdomain</Missing>
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <h3 className="text-xs font-medium tracking-wider text-fg-subtle uppercase">
          Custom domain
        </h3>
        {custom ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium break-all text-fg">
                {custom.host}
              </span>
              <DomainStatusBadge status={custom.status} />
            </div>
            {custom.status === "active" && custom.verifiedAt ? (
              <p className="text-xs text-fg-subtle">
                Verified{" "}
                <time dateTime={custom.verifiedAt}>
                  {formatDateTime(custom.verifiedAt)}
                </time>
              </p>
            ) : null}
            {custom.verification ? (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4">
                <p className="text-sm text-fg-muted">
                  Add this DNS TXT record at the domain&apos;s DNS provider to
                  verify it:
                </p>
                <RecordValue label="Name" value={custom.verification.name} />
                <RecordValue label="Value" value={custom.verification.value} />
              </div>
            ) : null}
            {custom.status !== "active" && custom.lastCheckedAt ? (
              <p className="text-xs text-fg-subtle">
                Last checked{" "}
                <time dateTime={custom.lastCheckedAt}>
                  {formatDateTime(custom.lastCheckedAt)}
                </time>
              </p>
            ) : null}
            {custom.status !== "active" && custom.lastCheckError ? (
              <CheckError>{custom.lastCheckError}</CheckError>
            ) : null}
            {canCheck && custom.status !== "active" ? (
              <DomainCheck tenantId={tenant.id} kind="custom" />
            ) : null}
          </>
        ) : (
          <p className="text-sm">
            <Missing>No custom domain</Missing>
          </p>
        )}
      </div>

      <Note>
        HTTPS for this host must be configured at your proxy or hosting
        provider.
      </Note>
    </DetailCard>
  );
}

/**
 * Description: Show one DNS record field with a copy button.
 * Input: The field label (Name/Value) and its value.
 * Output: The value in a code box and a Copy button.
 * Use case: The custom domain's TXT record instructions.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function RecordValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs break-all text-fg">
          {value}
        </code>
        <CopyButton
          value={value}
          label={`Copy TXT record ${label.toLowerCase()}`}
        />
      </div>
    </div>
  );
}

const HISTORY_ICONS: Record<keyof typeof HISTORY_LABELS, IconName> = {
  "tenant.created": "plus",
  "tenant.provisioned": "circle-check",
  "tenant.provisioning_failed": "circle-x",
  "tenant.suspended": "ban",
  "tenant.reactivated": "rotate-ccw",
};

/**
 * Description: Render the Status History section.
 * Input: The tenant.
 * Output: A timeline of lifecycle events (who, when, reason; owner usernames masked),
 *   or the shared empty state.
 * Use case: The details page.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
function HistoryCard({ tenant }: { tenant: TenantDetails }) {
  return (
    <DetailCard id={SECTIONS.history.id} title={SECTIONS.history.title} icon={SECTIONS.history.icon}>
      {tenant.history.length === 0 ? (
        <EmptyState
          size="sm"
          icon="clock"
          title="No events yet"
          description="The tenant's status changes (setup, suspension, reactivation) will appear here."
        />
      ) : (
        <ol className="flex flex-col">
          {tenant.history.map((entry, index) => (
            <li key={`${entry.occurredAt}-${index}`} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-fg-muted">
                  <Icon name={HISTORY_ICONS[entry.action]} className="size-4" />
                </span>
                {index < tenant.history.length - 1 ? (
                  <span aria-hidden="true" className="w-px flex-1 bg-line" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 pt-1.5 pb-5">
                <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
                  <span className="font-medium text-fg">
                    {HISTORY_LABELS[entry.action]}
                  </span>
                  <span className="text-fg-muted">by</span>
                  {/* A platform owner's username is masked; "System" is not sensitive. */}
                  {entry.actorIsUsername ? (
                    <SensitiveValue value={entry.actor} noun="owner username" monospace={false} />
                  ) : (
                    <span className="text-fg-muted">{entry.actor}</span>
                  )}
                </p>
                <p className="text-xs text-fg-subtle">
                  <time dateTime={entry.occurredAt}>
                    {formatDateTime(entry.occurredAt)}
                  </time>
                </p>
                {entry.reason ? (
                  <p className="mt-1 text-sm break-words text-fg-muted">
                    Reason: {entry.reason}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </DetailCard>
  );
}

/**
 * Description: Render the Module access section: the tenant's Tenant panel and
 *   Customer panel modules with their per-tenant state.
 * Input: The tenant id, its module groups and whether the viewer holds
 *   platform.tenant_modules.manage.
 * Output: The section card with two groups; switches with the privilege,
 *   read-only On/Off badges without it, core modules locked ("Core · always on").
 * Use case: The details page (.vibe/memory/tenant-management.md, "Module access section").
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function ModulesCard({
  tenantId,
  modules,
  canManage,
}: {
  tenantId: string;
  modules: TenantModuleGroups;
  canManage: boolean;
}) {
  return (
    <DetailCard id={SECTIONS.modules.id} title={SECTIONS.modules.title} icon={SECTIONS.modules.icon}>
      <Note>
        {canManage
          ? "Switch this tenant's panel modules on or off. A module that is off removes its privileges from every role of that panel on the next request."
          : "The panel modules available to this tenant. Only Platform Owners with the Manage tenant modules privilege can change them."}
      </Note>
      <ModuleToggleList
        target={{ scope: "tenant", tenantId }}
        groups={[
          { id: "tenant-panel", title: "Tenant panel", modules: modules.tenant },
          { id: "customer-panel", title: "Customer panel", modules: modules.customer },
        ]}
        canManage={canManage}
      />
    </DetailCard>
  );
}
