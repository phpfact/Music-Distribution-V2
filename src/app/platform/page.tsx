import { redirect } from "next/navigation";

// The dashboard decides whether the visitor is signed in.
export default function PlatformIndexPage() {
  redirect("/platform/dashboard");
}
