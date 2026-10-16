import { AudioLines, BadgeCheck, Disc3, Globe, Wallet } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

type AuthLayoutProps = {
  /** The tenant's name (resolved from the Host header on the server). */
  tenantName: string;
  children: ReactNode;
};

const HIGHLIGHTS = [
  { icon: Disc3,  label: "Release management" },
  { icon: Globe,  label: "Store distribution" },
  { icon: Wallet, label: "Royalty tracking" },
] as const;

/**
 * Description: Lay out the tenant portal's public account pages.
 * Input: The tenant's name and the page content (usually one Card).
 * Output: On large screens a brand panel (tenant name, what the portal is for)
 *   beside the content; on phones the content with a compact brand header.
 *   Semantic theme tokens only, so the workspace appearance applies.
 * Use case: /login, /customer/signup, /customer/registration and future
 *   account pages (e.g. forgot password, 2FA), which inherit the theme.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function AuthLayout({ tenantName, children }: AuthLayoutProps) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative isolate hidden overflow-hidden border-r border-border bg-sidebar px-10 py-10 lg:flex lg:flex-col xl:px-14">
        <Link href="/" className="flex items-center gap-3 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
          <span className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <AudioLines aria-hidden="true" className="size-5" />
          </span>
          <span className="truncate text-base font-semibold tracking-tight">{tenantName}</span>
        </Link>

        <div className="my-auto max-w-md py-16">
          {/* Decorative record: rings drawn with theme tokens only. */}
          <div aria-hidden="true" className="relative mb-12 grid size-56 place-items-center">
            <div className="absolute inset-0 rounded-full border border-primary/15" />
            <div className="absolute inset-6 rounded-full border border-primary/20" />
            <div className="absolute inset-12 rounded-full border border-primary/25 bg-primary/5" />
            <div className="grid size-24 place-items-center rounded-full border border-primary/30 bg-card shadow-xl">
              <Disc3 className="size-12 text-primary" />
            </div>
          </div>
          <p className="mb-3 text-xs font-semibold tracking-[0.18em] text-primary uppercase">Music distribution</p>
          <h2 className="text-3xl leading-tight font-semibold tracking-tight xl:text-4xl">
            Your music, everywhere it belongs.
          </h2>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Manage releases, reach stores and keep track of your earnings with {tenantName}.
          </p>
        </div>

        <ul className="flex flex-wrap gap-x-6 gap-y-3 border-t border-border pt-6 text-xs font-medium text-muted-foreground">
          {HIGHLIGHTS.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-2">
              <Icon aria-hidden="true" className="size-4 text-primary" />
              {label}
            </li>
          ))}
        </ul>
      </aside>

      <main className="flex min-w-0 flex-col px-4 py-8 sm:px-10">
        <Link href="/" className="flex items-center gap-2.5 self-start rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 lg:hidden">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground">
            <AudioLines aria-hidden="true" className="size-4" />
          </span>
          <span className="truncate text-sm font-semibold">{tenantName}</span>
        </Link>
        <div className="mx-auto my-auto w-full max-w-md py-10">{children}</div>
        <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
          <BadgeCheck aria-hidden="true" className="size-3.5" />
          Secure sign-in for {tenantName}
        </p>
      </main>
    </div>
  );
}
