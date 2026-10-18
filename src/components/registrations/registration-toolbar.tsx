"use client";

import { Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import {
  REGISTRATION_FILTERS,
  REGISTRATION_SEARCH_MAX_LENGTH,
  type RegistrationFilter,
  type RegistrationListQuery,
} from "@/lib/workspace/rules";
import { registrationListHref } from "./list-href";

// Long enough not to reload on every keystroke, short enough to feel live.
const SEARCH_DEBOUNCE_MS = 350;

type RegistrationToolbarProps = {
  basePath: string;
  /** The search and status the page was rendered with (already parsed). */
  query: RegistrationListQuery;
};

/**
 * Description: Render the registrations list's search box and status filter.
 * Input: The list page's path and the current query.
 * Output: A debounced search (name, email or username) and a status select
 *   (five fixed options, so no search inside it), plus "Clear filters". The
 *   state lives in the URL; changes update only the list (no full reload), show
 *   a spinner while loading and always start at page 1.
 * Use case: Tenant and Platform Owner registrations pages.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RegistrationToolbar({ basePath, query }: RegistrationToolbarProps) {
  const router                     = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch]        = useState(query.q);
  const [renderedQ, setRenderedQ]  = useState(query.q);

  const timer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id       = useId();
  const searchId = `${id}-search`;
  const statusId = `${id}-status`;

  // The URL changed elsewhere ("Clear filters", Back): show its search text.
  if (query.q !== renderedQ) {
    setRenderedQ(query.q);
    if (query.q !== search.trim()) setSearch(query.q);
  }

  // A newer URL invalidates any callback that captured the earlier filters.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, [query.q, query.status, query.page]);

  // A pending debounce never fires after the toolbar is gone.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /**
   * Description: Show the list for a new search and/or status, from page 1.
   * Input: The new search text and status.
   * Output: Client-side navigation to the matching URL (only the list re-renders).
   * Use case: Debounced typing, the status select and "Clear filters".
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function navigate(q: string, status: RegistrationFilter) {
    // Explicit status/role/Clear choices supersede pending typed searches.
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const href = registrationListHref(basePath, { q: q.trim(), status, page: 1 });
    startTransition(() => router.push(href, { scroll: false }));
  }

  const hasFilters = query.q !== "" || query.status !== "all";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={searchId}>Search</Label>
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchId}
            type="search"
            value={search}
            maxLength={REGISTRATION_SEARCH_MAX_LENGTH}
            placeholder="Name, email or username"
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSearch(value);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => navigate(value, query.status), SEARCH_DEBOUNCE_MS);
            }}
            className="pr-9 pl-9"
          />
          {pending ? <Spinner className="absolute top-1/2 right-3 -translate-y-1/2" /> : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 sm:w-48">
        <Label htmlFor={statusId}>Status</Label>
        <NativeSelect
          id={statusId}
          value={query.status}
          onChange={(event) => navigate(search, event.currentTarget.value as RegistrationFilter)}
        >
          {REGISTRATION_FILTERS.map((filter) => (
            <NativeSelectOption key={filter.value} value={filter.value}>
              {filter.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {hasFilters ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setSearch("");
            navigate("", "all");
          }}
        >
          <X aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
