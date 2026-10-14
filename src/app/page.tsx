import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveHost, type TenantAccess, tenantAccessOf } from "@/lib/domains/resolve";

const healthLinks = [
  { href: "/api/health", label: "Liveness", detail: "/api/health" },
  { href: "/api/health/ready", label: "Readiness", detail: "/api/health/ready" },
];

/**
 * `/` answers on every host. On the platform's own host it is the platform's
 * start page; on a tenant host it goes through the tenant gate
 * (src/lib/domains/resolve.ts) and shows only the tenant's status, since the
 * tenant portal does not exist yet. Reading the Host header makes the page
 * dynamic.
 */
export default async function HomePage() {
  const resolution = await resolveHost((await headers()).get("host"));
  if (resolution === "platform") return <PlatformHome />;
  const gate = tenantAccessOf(resolution);
  if (gate.access === "unknown") notFound();
  return <TenantStatus gate={gate} />;
}

function TenantStatus({ gate }: { gate: Exclude<TenantAccess, { access: "unknown" }> }) {
  const message =
    gate.access === "allowed"
      ? `${gate.tenant.name} — the tenant portal isn't available yet.`
      : gate.access === "suspended"
        ? "This workspace is suspended."
        : "This workspace is being set up.";
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6 py-16">
      <div className="rounded-xl border border-zinc-200 px-6 py-8 dark:border-zinc-800">
        <h1 className="text-2xl font-semibold tracking-tight">{message}</h1>
      </div>
    </main>
  );
}

function PlatformHome() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-3 py-1 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />
          Running
        </span>
        <h1 className="text-3xl font-semibold tracking-tight">Music Distribution</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The application is up. This is the infrastructure foundation only; no product features
          are implemented yet.
        </p>
      </div>

      <ul className="flex flex-col gap-2">
        {healthLinks.map((link) => (
          <li key={link.href}>
            {/* Plain anchors: these are JSON API routes, not pages to prefetch. */}
            <a
              href={link.href}
              className="flex items-center justify-between rounded-lg border border-zinc-200 px-4 py-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
            >
              <span className="font-medium">{link.label}</span>
              <code className="text-sm text-zinc-500">{link.detail}</code>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
