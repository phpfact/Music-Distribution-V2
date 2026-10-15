import { redirect } from "next/navigation";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getPlatformSession } from "@/lib/platform-auth/dal";
import { PASSWORD_MAX_LENGTH } from "@/lib/platform-auth/password";
import { USERNAME_MAX_LENGTH } from "@/lib/platform-auth/username";
import { Icon } from "../(console)/_components/icons";
import { LoginForm } from "./login-form";

/**
 * Render the platform sign-in page using the active shared Appearance tokens.
 * Input: the authenticated request session, resolved on the server.
 * Output: a responsive sign-in Card or a redirect for an existing session.
 * Use case: retain authentication and server-owned field limits during UI migration.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export default async function PlatformLoginPage() {
  if (await getPlatformSession()) redirect("/platform/dashboard");

  return (
    <main className="grid min-h-dvh bg-canvas text-fg lg:grid-cols-[1.05fr_1fr]">
      <section className="relative isolate hidden overflow-hidden border-r border-line bg-accent-soft px-10 py-10 lg:flex lg:flex-col xl:px-16">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
            <Icon name="disc-3" className="size-6" />
          </span>
          <div>
            <p className="text-base font-semibold tracking-tight">Music Distribution</p>
            <p className="mt-0.5 text-xs text-fg-muted">Platform administration</p>
          </div>
        </div>

        <div className="my-auto max-w-lg py-16">
          <div aria-hidden="true" className="relative mb-12 grid size-64 place-items-center xl:size-80">
            <div className="absolute inset-0 rounded-full border border-primary/15" />
            <div className="absolute inset-6 rounded-full border border-primary/20" />
            <div className="absolute inset-12 rounded-full border border-primary/25 bg-primary/5" />
            <div className="grid size-32 place-items-center rounded-full border border-primary/30 bg-surface shadow-2xl shadow-primary/10 xl:size-40">
              <Icon name="disc-3" className="size-20 text-primary xl:size-24" />
            </div>
            <span className="absolute top-5 right-3 grid size-12 place-items-center rounded-2xl border border-line bg-surface text-primary shadow-sm">
              <Icon name="building-2" className="size-5" />
            </span>
            <span className="absolute bottom-5 left-3 grid size-12 place-items-center rounded-2xl border border-line bg-surface text-primary shadow-sm">
              <Icon name="shield-check" className="size-5" />
            </span>
          </div>
          <p className="mb-4 text-xs font-semibold tracking-[0.18em] text-primary uppercase">Your platform, connected</p>
          <h2 className="text-4xl leading-[1.15] font-semibold tracking-tight xl:text-5xl">One place to manage<br />every tenant.</h2>
          <p className="mt-5 max-w-md text-base leading-7 text-fg-muted">A focused workspace for your tenant accounts, databases, and domains. Stay in control as your platform grows.</p>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-3 border-t border-primary/15 pt-6 text-xs font-medium text-fg-muted">
          <span className="flex items-center gap-2"><Icon name="building-2" className="size-4 text-primary" />Tenant management</span>
          <span className="flex items-center gap-2"><Icon name="database" className="size-4 text-primary" />Database operations</span>
          <span className="flex items-center gap-2"><Icon name="globe" className="size-4 text-primary" />Domain control</span>
        </div>
      </section>

      <section className="flex flex-col px-6 py-8 sm:px-10 lg:px-12">
        <div className="flex items-center gap-2.5 lg:hidden">
          <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Icon name="disc-3" className="size-5" /></span>
          <span className="text-sm font-semibold">Music Distribution</span>
        </div>
        <div className="mx-auto my-auto w-full max-w-md py-12">
          <Card>
            <CardHeader>
              <span className="mb-3 grid size-12 place-items-center rounded-2xl border border-border bg-background text-primary shadow-xs"><Icon name="key-round" className="size-5" /></span>
              <header>
                <p className="mb-2 text-xs font-semibold tracking-wider text-primary uppercase">Platform owner</p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Sign in</h1>
                <p className="mt-3 text-sm leading-6 text-fg-muted">Welcome back. Use your platform owner account to continue to your workspace.</p>
              </header>
            </CardHeader>

            {/* Password limits stay server-side: their source loads the native hashing library. */}
            <CardContent>
              <LoginForm usernameMaxLength={USERNAME_MAX_LENGTH} passwordMaxLength={PASSWORD_MAX_LENGTH} />
            </CardContent>
            <Separator />
            <CardFooter className="justify-center">
              <p className="text-center text-xs leading-5 text-muted-foreground">Access is limited to authorized platform owners.</p>
            </CardFooter>
          </Card>
        </div>
        <p className="text-center text-xs text-fg-subtle">Music Distribution · Platform console</p>
      </section>
    </main>
  );
}
