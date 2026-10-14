"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { TENANT_SEARCH_MAX_LENGTH, type TenantListStatusFilter } from "@/lib/tenants/rules";
import { Icon } from "../../_components/icons";
import { Spinner } from "../../_components/spinner";
import { buttonClass, inputClass, selectClass } from "../../_components/ui";
import { tenantFilterHref } from "../list-query";
import { useListTransition } from "./list-transition";

// Long enough not to reload on every keystroke, short enough to feel live.
const SEARCH_DEBOUNCE_MS = 300;

type TenantToolbarProps = {
  /** The search and filter the page was rendered with (already parsed). */
  q: string;
  status: TenantListStatusFilter;
};

/**
 * Search and status filter of the tenant list. Their state lives in the URL,
 * so it survives a reload and the Back button; every change starts at page 1.
 */
export function TenantToolbar({ q, status }: TenantToolbarProps) {
  const searchParams = useSearchParams();
  const { pending, navigate } = useListTransition();
  const [search, setSearch] = useState(q);
  const [renderedQ, setRenderedQ] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const searchId = `${id}-search`;
  const statusId = `${id}-status`;

  // The URL changed from elsewhere ("Clear filters", Back): show its search,
  // unless it is just what was typed here, perhaps with spaces still to come.
  if (q !== renderedQ) {
    setRenderedQ(q);
    if (q !== search.trim()) setSearch(q);
  }

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  function onSearchChange(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (value.trim() === q) return;
      navigate(tenantFilterHref(searchParams, { q: value }));
    }, SEARCH_DEBOUNCE_MS);
  }

  function onStatusChange(value: string) {
    // Pending keystrokes go along with the new status rather than after it.
    if (timer.current) clearTimeout(timer.current);
    navigate(
      tenantFilterHref(searchParams, { q: search, status: value as TenantListStatusFilter }),
    );
  }

  function clearFilters() {
    if (timer.current) clearTimeout(timer.current);
    setSearch("");
    navigate(tenantFilterHref(searchParams, { q: "", status: "all" }));
  }

  return (
    <div
      role="search"
      aria-label="Tenants"
      className="flex flex-col gap-3 border-t border-line px-5 py-4 sm:flex-row sm:items-center sm:px-6"
    >
      <div className="relative min-w-0 flex-1">
        <label htmlFor={searchId} className="sr-only">
          Search tenants
        </label>
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
        />
        <input
          id={searchId}
          type="search"
          value={search}
          maxLength={TENANT_SEARCH_MAX_LENGTH}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by name, username, email or domain"
          autoComplete="off"
          spellCheck={false}
          aria-controls="tenant-results"
          className={inputClass(false, "bg-canvas/50 pl-9 pr-9")}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 grid size-4 -translate-y-1/2 place-items-center text-accent">{pending ? <Spinner /> : null}</span>
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor={statusId} className="sr-only">
          Status
        </label>
        <select
          id={statusId}
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          aria-controls="tenant-results"
          className={selectClass(false, "bg-canvas/50 sm:w-44")}
        >
          <option value="all">All statuses</option>
          <optgroup label="Account status">
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </optgroup>
          <optgroup label="Setup status">
            <option value="pending">Pending setup</option>
            <option value="failed">Failed</option>
          </optgroup>
        </select>
        {search !== "" || status !== "all" ? (
          <button type="button" onClick={clearFilters} className={buttonClass("ghost", "sm")}>
            <Icon name="x" className="size-3.5" />Clear
          </button>
        ) : null}
        <span aria-live="polite" className="sr-only">
          {pending ? "Loading results" : ""}
        </span>
      </div>
    </div>
  );
}
