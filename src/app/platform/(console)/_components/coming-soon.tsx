import Link from "next/link";
import { getNavItem, type PlatformNavId } from "../navigation";
import { Icon } from "./icons";
import { FOCUS_RING } from "./styles";

type ComingSoonProps = {
  id: PlatformNavId;
};

/** The whole page of a module that is in the navigation but not built yet. */
export function ComingSoon({ id }: ComingSoonProps) {
  const item = getNavItem(id);

  return (
    <section className="mx-auto mt-6 max-w-lg rounded-2xl border border-line bg-surface p-8 text-center sm:p-10">
      <div className="mx-auto grid size-12 place-items-center rounded-xl bg-accent-soft text-accent">
        <Icon name={item.icon} className="size-6" />
      </div>
      <p className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg-muted">
        <Icon name="clock" className="size-3.5" />
        Coming soon
      </p>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{item.label}</h1>
      <p className="mt-2 text-fg-muted">{item.description}</p>
      <p className="mt-1 text-sm text-fg-subtle">This module isn&apos;t available yet.</p>
      <Link
        href={getNavItem("dashboard").href}
        className={`mt-8 inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-medium transition-colors hover:bg-surface-2 ${FOCUS_RING}`}
      >
        <Icon name="arrow-left" className="size-4" />
        Back to dashboard
      </Link>
    </section>
  );
}
