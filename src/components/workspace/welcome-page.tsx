import { ArrowRight, AudioLines, ChartColumn, Disc3, Globe, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const FEATURES = [
  { icon: Disc3,       title: "Releases",     description: "Prepare your singles, EPs and albums with their artwork and metadata." },
  { icon: Globe,       title: "Distribution", description: "Deliver your music to the stores and streaming services you choose." },
  { icon: ChartColumn, title: "Analytics",    description: "See how your releases perform once your music is live." },
  { icon: Wallet,      title: "Royalties",    description: "Keep track of your earnings and statements in one place." },
] as const;

/**
 * Description: Render a tenant's public welcome page.
 * Input: The tenant's name (resolved from the Host header on the server).
 * Output: A responsive landing page: header with Log in / Sign up, a hero with
 *   the tenant's name and a welcome message, what the portal is for, and a
 *   footer. No invented figures or claims about the tenant.
 * Use case: "/" on a tenant subdomain or verified custom domain (the platform
 *   host keeps its own start page).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function WelcomePage({ tenantName }: { tenantName: string }) {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <AudioLines aria-hidden="true" className="size-4" />
            </span>
            <span className="truncate text-sm font-semibold sm:text-base">{tenantName}</span>
          </Link>
          <nav aria-label="Account" className="ml-auto flex shrink-0 items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/customer/signup">Sign up</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="relative isolate overflow-hidden">
          {/* Soft decorative rings drawn with theme tokens only. */}
          <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 -z-10 size-[42rem] -translate-x-1/2 rounded-full border border-primary/10 bg-primary/[0.03]" />
          <div aria-hidden="true" className="pointer-events-none absolute -top-24 left-1/2 -z-10 size-[30rem] -translate-x-1/2 rounded-full border border-primary/15" />

          <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center sm:px-6 sm:py-28">
            <Badge variant="outline" className="mb-6 gap-1.5 px-3 py-1">
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              Music distribution portal
            </Badge>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              Welcome to <span className="text-primary">{tenantName}</span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-pretty text-muted-foreground sm:text-lg">
              Release your music, reach listeners on the platforms that matter and keep track of your royalties —
              all from one secure workspace.
            </p>
            <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <Button asChild size="lg" className="h-11 px-6">
                <Link href="/login">
                  Log in
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-11 px-6">
                <Link href="/customer/signup">Create an account</Link>
              </Button>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              New accounts are reviewed by {tenantName} before they can be used.
            </p>
          </div>
        </section>

        <section aria-labelledby="welcome-features" className="border-t border-border bg-muted/40">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="welcome-features" className="text-center text-2xl font-semibold tracking-tight">
              Everything you need to put your music out
            </h2>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map(({ icon: Icon, title, description }) => (
                <li key={title}>
                  <Card className="h-full">
                    <CardHeader>
                      <span className="mb-2 grid size-10 place-items-center rounded-xl border bg-background text-primary">
                        <Icon aria-hidden="true" className="size-5" />
                      </span>
                      <CardTitle>
                        <h3 className="text-base font-semibold">{title}</h3>
                      </CardTitle>
                      <CardDescription>{description}</CardDescription>
                    </CardHeader>
                  </Card>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <p>© {tenantName}</p>
          <p>Secure access for artists, labels and partners.</p>
        </div>
      </footer>
    </div>
  );
}
