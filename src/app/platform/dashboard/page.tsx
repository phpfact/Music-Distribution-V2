import { requirePlatformOwner } from "@/lib/platform-auth/dal";
import { logoutAction } from "../actions";
import { SignOutButton } from "./sign-out-button";

export default async function PlatformDashboardPage() {
  // Checked on the server on every request; nothing below renders without it.
  await requirePlatformOwner();

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        Welcome to the Platform Owner Dashboard.
      </h1>
      <form action={logoutAction}>
        <SignOutButton />
      </form>
    </main>
  );
}
