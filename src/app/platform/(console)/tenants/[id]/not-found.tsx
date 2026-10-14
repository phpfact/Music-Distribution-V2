import Link from "next/link";
import { Icon } from "../../_components/icons";
import { buttonClass } from "../../_components/ui";
import { TENANTS_PATH } from "../list-query";

// An unknown or malformed tenant id: said inside the console frame, so the
// navigation stays usable. Nothing tells a missing tenant from a bad id.
export default function TenantNotFound() {
  return (
    <section className="mx-auto mt-6 max-w-lg rounded-2xl border border-line bg-surface p-8 text-center">
      <div className="mx-auto grid size-12 place-items-center rounded-xl bg-surface-2 text-fg-muted">
        <Icon name="building-2" className="size-6" />
      </div>
      <h1 className="mt-6 text-xl font-semibold tracking-tight">Tenant not found</h1>
      <p className="mt-2 text-fg-muted">This tenant doesn&apos;t exist or is no longer available.</p>
      <Link href={TENANTS_PATH} className={`${buttonClass("secondary")} mt-6`}>
        <Icon name="arrow-left" className="size-4" />
        Back to tenants
      </Link>
    </section>
  );
}
