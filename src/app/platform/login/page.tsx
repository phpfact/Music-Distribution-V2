import { redirect } from "next/navigation";
import { getPlatformSession } from "@/lib/platform-auth/dal";
import { PASSWORD_MAX_LENGTH } from "@/lib/platform-auth/password";
import { USERNAME_MAX_LENGTH } from "@/lib/platform-auth/username";
import { LoginForm } from "./login-form";

export default async function PlatformLoginPage() {
  if (await getPlatformSession()) redirect("/platform/dashboard");

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-sm font-medium text-zinc-500">Platform</p>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Use your platform owner account.</p>
      </header>

      {/* The limits are passed down as numbers: the module that defines the
          password limit loads the native hashing library, which must stay out
          of the browser bundle. */}
      <LoginForm usernameMaxLength={USERNAME_MAX_LENGTH} passwordMaxLength={PASSWORD_MAX_LENGTH} />
    </main>
  );
}
