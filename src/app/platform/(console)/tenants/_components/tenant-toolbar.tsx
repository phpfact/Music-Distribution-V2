"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
  NativeSelectOptGroup,
} from "@/components/ui/native-select";
import {
  TENANT_SEARCH_MAX_LENGTH,
  type TenantListStatusFilter,
} from "@/lib/tenants/rules";
import { Icon } from "../../_components/icons";
import { Spinner } from "../../_components/spinner";
import { tenantFilterHref } from "../list-query";
import { useListTransition } from "./list-transition";

// Long enough not to reload on every keystroke, short enough to feel live.
const SEARCH_DEBOUNCE_MS = 300;

type TenantToolbarProps = {
  /**
   * The search and filter the page was rendered with (already parsed).
   */
  q: string;
  status: TenantListStatusFilter;
};

/**
 * Search and status filter of the tenant list. Their state lives in the URL,
 * so it survives a reload and the Back button; every change starts at page 1.
 *
 * Input: The existing typed arguments and component state.
 * Output: Accessible React UI.
 * Use case: Tenant management’s existing owner workflow.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14. Last modified: 2026-10-15.
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

  /**
   * Description: Update the search draft and debounce the existing URL navigation.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function onSearchChange(value: string) {
    setSearch(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (value.trim() === q) return;
      navigate(tenantFilterHref(searchParams, { q: value }));
    }, SEARCH_DEBOUNCE_MS);
  }

  /**
   * Description: Navigate with the selected status and current pending search draft.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
  function onStatusChange(value: string) {
    // Pending keystrokes go along with the new status rather than after it.
    if (timer.current) clearTimeout(timer.current);
    navigate(
      tenantFilterHref(searchParams, {
        q: search,
        status: value as TenantListStatusFilter,
      }),
    );
  }

  /**
   * Description: Cancel deferred searching and reset the URL filters to page one.
   *
   * Input: The existing typed arguments and component state.
   * Output: The existing helper result or state update.
   * Use case: Tenant management’s existing owner workflow.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-14. Last modified: 2026-10-15.
   */
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
        <Label htmlFor={searchId} className="sr-only">
          Search tenants
        </Label>
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
        />
        <Input
          id={searchId}
          type="search"
          value={search}
          maxLength={TENANT_SEARCH_MAX_LENGTH}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by name, username, email or domain"
          autoComplete="off"
          spellCheck={false}
          aria-controls="tenant-results"
          className="bg-background/50 pl-9 pr-9"
        />
        <span className="pointer-events-none absolute top-1/2 right-3 grid size-4 -translate-y-1/2 place-items-center text-primary">
          {pending ? <Spinner /> : null}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Label htmlFor={statusId} className="sr-only">
          Status
        </Label>
        <NativeSelect
          id={statusId}
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          aria-controls="tenant-results"
          className="bg-background/50 sm:w-44"
        >
          <NativeSelectOption value="all">All statuses</NativeSelectOption>
          <NativeSelectOptGroup label="Account status">
            <NativeSelectOption value="active">Active</NativeSelectOption>
            <NativeSelectOption value="suspended">Suspended</NativeSelectOption>
          </NativeSelectOptGroup>
          <NativeSelectOptGroup label="Setup status">
            <NativeSelectOption value="pending">
              Pending setup
            </NativeSelectOption>
            <NativeSelectOption value="failed">Failed</NativeSelectOption>
          </NativeSelectOptGroup>
        </NativeSelect>
        {search !== "" || status !== "all" ? (
          <Button
            type="button"
            onClick={clearFilters}
            variant="ghost"
            size="sm"
          >
            <Icon name="x" className="size-3.5" />
            Clear
          </Button>
        ) : null}
        <span aria-live="polite" className="sr-only">
          {pending ? "Loading results" : ""}
        </span>
      </div>
    </div>
  );
}
