import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { getTenantDetails, type TenantDetails } from "@/lib/tenants/service";
import { Avatar } from "../../_components/avatar";
import { CopyButton } from "../../_components/copy-button";
import { Icon, type IconName } from "../../_components/icons";
import { Notice } from "../../_components/notice";
import { Spinner } from "../../_components/spinner";
import { StatusBadge, ToneBadge } from "../../_components/status-badge";
import { FOCUS_RING } from "../../_components/styles";
import { buttonClass } from "../../_components/ui";
import { DomainStatusBadge } from "../_components/badges";
import { LifecycleButton } from "../_components/lifecycle-button";
import { TenantFlashNotice, TenantFlashProvider } from "../_components/tenant-flash";
import {
  DATABASE_MODE_LABELS,
  HISTORY_LABELS,
  isSetupInProgress,
  SCHEMA_STATUS_LABELS,
  showsSetupCard,
  suspensionSentence,
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

// Memoized for one request: the metadata and the page read the tenant once.
const loadTenant = cache(async (id: string) => getTenantDetails(id));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  // No tenant data in the title without a session.
  await requirePlatformOwner();
  const tenant = await loadTenant((await params).id);
  return { title: tenant ? tenant.name : "Tenant not found" };
}

export default async function TenantDetailsPage({ params, searchParams }: PageProps) {
  // Checked on the server on every request; nothing below renders without it.
  await requirePlatformOwner();
  const { id } = await params;
  const tenant = await loadTenant(id);
  if (!tenant) notFound();

  const notice = tenantNoticeMessage((await searchParams).notice);
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
              src={tenant.hasProfileImage ? `${TENANTS_PATH}/${tenant.id}/avatar` : null}
              size="lg"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-semibold tracking-tight break-words sm:text-3xl">
                  {tenant.name}
                </h1>
                <StatusBadge status={tenant.status} />
              </div>
              <p className="text-sm break-words text-fg-muted">
                @{tenant.login.username}
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                Created <time dateTime={tenant.createdAt}>{formatDate(tenant.createdAt)}</time>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`${TENANTS_PATH}/${tenant.id}/edit`} className={buttonClass("secondary")}>
              <Icon name="pencil" className="size-4" />
              Edit
            </Link>
            {tenant.provisioning.canRetry ? (
              <LifecycleButton action="retry" tenantId={tenant.id} tenantName={tenant.name} />
            ) : null}
            {tenant.status === "suspended" ? (
              <LifecycleButton action="reactivate" tenantId={tenant.id} tenantName={tenant.name} />
            ) : null}
            {tenant.status === "active" ? (
              <LifecycleButton action="suspend" tenantId={tenant.id} tenantName={tenant.name} />
            ) : null}
          </div>
        </header>

        {notice ? <Notice variant="success">{notice}</Notice> : null}
        <TenantFlashNotice />
        {tenant.suspension ? (
          <Notice variant="error">{suspensionSentence(tenant.suspension)}</Notice>
        ) : null}

        {showsSetupCard(tenant.status, tenant.provisioning.canRetry) ? (
          <SetupCard tenant={tenant} />
        ) : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <ProfileCard tenant={tenant} />
          <LoginCard tenant={tenant} />
          <DatabaseCard tenant={tenant} />
          <DomainsCard tenant={tenant} siteRequest={siteRequest} />
        </div>

        <HistoryCard tenant={tenant} />

        <AutoRefresh active={isSetupInProgress(tenant.status)} />
      </div>
    </TenantFlashProvider>
  );
}

// ---------------------------------------------------------------------------
// Building blocks

type DetailCardProps = {
  id: string;
  title: string;
  icon: IconName;
  /** Buttons in the card header (the credential and domain actions go here). */
  actions?: ReactNode;
  children: ReactNode;
};

function DetailCard({ id, title, icon, actions, children }: DetailCardProps) {
  const titleId = `tenant-${id}`;
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold">
          <Icon name={icon} className="size-4 text-fg-muted" />
          {title}
        </h2>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      <div className="flex flex-1 flex-col gap-4 p-5">{children}</div>
    </section>
  );
}

function DetailList({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)]">
      {children}
    </dl>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

function Missing({ children = "—" }: { children?: ReactNode }) {
  return <span className="text-fg-subtle">{children}</span>;
}

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
  done: { text: "Done", className: "text-emerald-700 dark:text-emerald-300" },
  running: { text: "In progress", className: "text-amber-800 dark:text-amber-300" },
  failed: { text: "Failed", className: "text-red-700 dark:text-red-400" },
  waiting: { text: "Waiting", className: "text-fg-subtle" },
} as const;

function StepIcon({ state }: { state: keyof typeof STEP_STATES }) {
  const className = `size-5 shrink-0 ${STEP_STATES[state].className}`;
  if (state === "running") return <Spinner size="md" className={className} />;
  const name: IconName = state === "done" ? "circle-check" : state === "failed" ? "circle-x" : "circle";
  return <Icon name={name} className={className} />;
}

function setupSummary(tenant: TenantDetails): string {
  const { steps } = tenant.provisioning;
  const running = steps.find((step) => step.state === "running");
  const done = steps.filter((step) => step.state === "done").length;
  if (tenant.status === "failed") return "Setup failed.";
  if (running) return `Step ${done + 1} of ${steps.length}: ${running.label}…`;
  if (tenant.status === "pending") return "Waiting to start.";
  return `${done} of ${steps.length} steps done.`;
}

function SetupCard({ tenant }: { tenant: TenantDetails }) {
  const { steps, attempt, lastError, canRetry } = tenant.provisioning;
  const running = isSetupInProgress(tenant.status);

  return (
    <DetailCard id="setup" title="Setup progress" icon="loader">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        {/* Announced as the page refreshes itself, so progress is heard as well as seen. */}
        <p aria-live="polite" className="text-sm font-medium text-fg">
          {setupSummary(tenant)}
        </p>
        <p className="text-xs text-fg-subtle">
          {attempt > 0 ? `Attempt ${attempt}` : "Not started yet"}
          {running ? " · Updates automatically" : ""}
        </p>
      </div>

      {tenant.status === "failed" && lastError ? (
        <Notice variant="error" title="Setup failed">
          <p>{lastError.message}</p>
          {canRetry ? <p className="mt-1">Fix the cause if needed, then retry setup.</p> : null}
        </Notice>
      ) : null}

      <ol className="flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.step} className="flex items-center gap-3 text-sm">
            <StepIcon state={step.state} />
            <span className={`min-w-0 flex-1 ${step.state === "waiting" ? "text-fg-muted" : "text-fg"}`}>
              {step.label}
            </span>
            <span className={`text-xs font-medium ${STEP_STATES[step.state].className}`}>
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
            variant="secondary"
          />
        </div>
      ) : null}
    </DetailCard>
  );
}

// ---------------------------------------------------------------------------
// Cards

function ProfileCard({ tenant }: { tenant: TenantDetails }) {
  return (
    <DetailCard id="profile" title="Profile" icon="user">
      <DetailList>
        <DetailRow label="Name">{tenant.profile.name}</DetailRow>
        <DetailRow label="Phone">{tenant.profile.phone ?? <Missing>Not provided</Missing>}</DetailRow>
        <DetailRow label="Email">{tenant.profile.email}</DetailRow>
      </DetailList>
    </DetailCard>
  );
}

function LoginCard({ tenant }: { tenant: TenantDetails }) {
  return (
    <DetailCard
      id="login"
      title="Admin login"
      icon="key-round"
      actions={
        // Setup writes the same login: nothing to offer while it runs.
        tenant.status === "provisioning" ? undefined : (
          <ResetMasterPassword tenantId={tenant.id} tenantName={tenant.name} username={tenant.login.username} />
        )
      }
    >
      <DetailList>
        <DetailRow label="Username">{tenant.login.username}</DetailRow>
        <DetailRow label="Email">{tenant.login.email}</DetailRow>
        <DetailRow label="Two-factor authentication">
          <span className="text-fg-muted">
            Not available yet — two-factor sign-in isn&apos;t supported for tenant accounts.
          </span>
        </DetailRow>
      </DetailList>
    </DetailCard>
  );
}

const SCHEMA_TONES = { pending: "warning", current: "success", failed: "danger" } as const;

function DatabaseCard({ tenant }: { tenant: TenantDetails }) {
  const { database } = tenant;
  return (
    <DetailCard
      id="database"
      title="Database"
      icon="database"
      actions={
        tenant.status === "provisioning" ? undefined : (
          <DatabasePassword tenantId={tenant.id} tenantName={tenant.name} mode={database.mode} />
        )
      }
    >
      <DetailList>
        <DetailRow label="Mode">{DATABASE_MODE_LABELS[database.mode]}</DetailRow>
        <DetailRow label="Name">
          {database.name ? <span className="font-mono">{database.name}</span> : <Missing />}
        </DetailRow>
        <DetailRow label="User">
          {database.user ? <span className="font-mono">{database.user}</span> : <Missing />}
        </DetailRow>
        <DetailRow label="Port">{database.port ?? <Missing />}</DetailRow>
        <DetailRow label="Server">
          <span className="font-mono">{database.host}</span>
        </DetailRow>
        <DetailRow label="Password">
          {database.hasPassword ? "Stored encrypted" : <Missing>Not set</Missing>}
        </DetailRow>
        <DetailRow label="Schema">
          <span className="flex flex-wrap items-center gap-2">
            <ToneBadge tone={SCHEMA_TONES[database.schemaStatus]}>
              {SCHEMA_STATUS_LABELS[database.schemaStatus]}
            </ToneBadge>
            {database.schemaVersion ? (
              <span className="font-mono text-xs break-all text-fg-muted">{database.schemaVersion}</span>
            ) : null}
          </span>
        </DetailRow>
      </DetailList>
      <Note>Database name, user and port can&apos;t be changed after creation.</Note>
    </DetailCard>
  );
}

function CheckError({ children }: { children: ReactNode }) {
  return <p className="text-sm text-red-700 dark:text-red-400">{children}</p>;
}

function DomainsCard({
  tenant,
  siteRequest,
}: {
  tenant: TenantDetails;
  siteRequest: { host: string | null; forwardedProto: string | null };
}) {
  const { subdomain, custom } = tenant.domains;
  const canCheck = tenant.status !== "provisioning";

  return (
    <DetailCard id="domains" title="Domains" icon="globe">
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-medium tracking-wider text-fg-subtle uppercase">SaaS subdomain</h3>
        {subdomain ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {subdomain.status === "active" ? (
                <a
                  href={tenantSiteUrl(subdomain.host, siteRequest)}
                  className={`rounded-sm font-medium break-all text-accent underline-offset-4 hover:underline ${FOCUS_RING}`}
                >
                  {subdomain.host}
                </a>
              ) : (
                <span className="font-medium break-all text-fg">{subdomain.host}</span>
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
        <h3 className="text-xs font-medium tracking-wider text-fg-subtle uppercase">Custom domain</h3>
        {custom ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium break-all text-fg">{custom.host}</span>
              <DomainStatusBadge status={custom.status} />
            </div>
            {custom.status === "active" && custom.verifiedAt ? (
              <p className="text-xs text-fg-subtle">
                Verified <time dateTime={custom.verifiedAt}>{formatDateTime(custom.verifiedAt)}</time>
              </p>
            ) : null}
            {custom.verification ? (
              <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4">
                <p className="text-sm text-fg-muted">
                  Add this DNS TXT record at the domain&apos;s DNS provider to verify it:
                </p>
                <RecordValue label="Name" value={custom.verification.name} />
                <RecordValue label="Value" value={custom.verification.value} />
              </div>
            ) : null}
            {custom.status !== "active" && custom.lastCheckedAt ? (
              <p className="text-xs text-fg-subtle">
                Last checked{" "}
                <time dateTime={custom.lastCheckedAt}>{formatDateTime(custom.lastCheckedAt)}</time>
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

      <Note>HTTPS for this host must be configured at your proxy or hosting provider.</Note>
    </DetailCard>
  );
}

function RecordValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs break-all text-fg">
          {value}
        </code>
        <CopyButton value={value} label={`Copy TXT record ${label.toLowerCase()}`} />
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

function HistoryCard({ tenant }: { tenant: TenantDetails }) {
  return (
    <DetailCard id="history" title="Status history" icon="clock">
      {tenant.history.length === 0 ? (
        <p className="text-sm text-fg-muted">No events yet.</p>
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
                <p className="text-sm">
                  <span className="font-medium text-fg">{HISTORY_LABELS[entry.action]}</span>
                  <span className="text-fg-muted"> by {entry.actor}</span>
                </p>
                <p className="text-xs text-fg-subtle">
                  <time dateTime={entry.occurredAt}>{formatDateTime(entry.occurredAt)}</time>
                </p>
                {entry.reason ? (
                  <p className="mt-1 text-sm break-words text-fg-muted">Reason: {entry.reason}</p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </DetailCard>
  );
}
