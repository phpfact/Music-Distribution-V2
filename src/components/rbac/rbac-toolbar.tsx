"use client";

import { SearchIcon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { SearchableSelect, type SearchableSelectOption } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { privilegeCountText } from "./format";
import { hasRbacFilters, RBAC_SEARCH_MAX_LENGTH, rbacListHref, type RbacListQuery, type RbacStatusFilter } from "./list-href";
import { MasterBadge } from "./role-badges";
import type { LoadRoleOptions, RoleOptionView } from "./types";

// Long enough not to reload on every keystroke, short enough to feel live.
const SEARCH_DEBOUNCE_MS = 350;

type RbacToolbarProps = {
  /** The list page's path (filters are written to its URL). */
  basePath: string;
  /** The query the page was rendered with (from parseRbacListQuery). */
  query: RbacListQuery;
  /** Placeholder of the search box, e.g. "Name or description" / "Name, username or email". */
  searchPlaceholder: string;
  /** Labels of the status options, e.g. roles: Active/Disabled; users: Active/Suspended. */
  statusLabels?: { active: string; disabled: string };
  /** When given, a searchable role filter is shown (sub-users directory). */
  roleOptions?: readonly RoleOptionView[];
  /** Searches all scoped roles without loading the full set in the browser. */
  loadRoles?: LoadRoleOptions;
};

/**
 * Description: The search box and filters of a roles or sub-users directory.
 * Input: The list path, the current query, the search placeholder, the status
 *   labels and (optional) the roles for the role filter.
 * Output: A debounced search, a status select (three fixed options, so no
 *   search inside it), an optional searchable role filter and "Clear filters".
 *   The state lives in the URL; changes navigate client-side inside a
 *   transition (only the list re-renders, a spinner shows while loading) and
 *   always restart at page 1.
 * Use case: Roles directory and sub-users directories of all three panels.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function RbacToolbar({
  basePath,
  query,
  searchPlaceholder,
  statusLabels = { active: "Active", disabled: "Disabled" },
  roleOptions,
  loadRoles,
}: RbacToolbarProps) {
  const router                     = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch]        = useState(query.q);
  const [renderedQ, setRenderedQ]  = useState(query.q);

  const timer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id       = useId();
  const searchId = `${id}-search`;
  const statusId = `${id}-status`;
  const roleId   = `${id}-role`;

  // The URL changed elsewhere ("Clear filters", Back): show its search text.
  if (query.q !== renderedQ) {
    setRenderedQ(query.q);
    if (query.q !== search.trim()) setSearch(query.q);
  }

  // A newer URL invalidates any callback that captured the earlier filters.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, [query.q, query.status, query.role, query.page]);

  // A pending debounce never fires after the toolbar is gone.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /**
   * Description: Show the list for a new search/filter combination, from page 1.
   * Input: The changed parts of the query.
   * Output: Client-side navigation to the matching URL inside a transition.
   * Use case: Debounced typing, the status select, the role filter and "Clear filters".
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function navigate(changes: Partial<RbacListQuery>) {
    // Explicit status/role/Clear choices supersede pending typed searches.
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = { ...query, q: search.trim(), ...changes, page: 1 };
    startTransition(() => router.push(rbacListHref(basePath, next), { scroll: false }));
  }

  // The role filter's choices: "All roles" first, then each role with its privilege count.
  const roleChoices: SearchableSelectOption[] | null = roleOptions
    ? [
        { value: "", label: "All roles" },
        ...roleOptions.map((role) => ({
          value: role.id,
          label: role.name,
          meta: privilegeCountText(role.privilegeCount),
          badge: role.isMaster ? <MasterBadge /> : undefined,
        })),
      ]
    : null;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Label htmlFor={searchId}>Search</Label>
        <div className="relative">
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={searchId}
            type="search"
            value={search}
            maxLength={RBAC_SEARCH_MAX_LENGTH}
            placeholder={searchPlaceholder}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSearch(value);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => navigate({ q: value.trim() }), SEARCH_DEBOUNCE_MS);
            }}
            className="pr-9 pl-9"
          />
          {pending ? <Spinner className="absolute top-1/2 right-3 -translate-y-1/2" /> : null}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 lg:w-44">
        <Label htmlFor={statusId}>Status</Label>
        <NativeSelect
          id={statusId}
          value={query.status}
          onChange={(event) => navigate({ status: event.currentTarget.value as RbacStatusFilter })}
        >
          <NativeSelectOption value="all">All statuses</NativeSelectOption>
          <NativeSelectOption value="active">{statusLabels.active}</NativeSelectOption>
          <NativeSelectOption value="disabled">{statusLabels.disabled}</NativeSelectOption>
        </NativeSelect>
      </div>
      {roleChoices ? (
        <div className="flex flex-col gap-1.5 lg:w-64">
          <Label htmlFor={roleId}>Role</Label>
          <SearchableSelect
            id={roleId}
            options={roleChoices}
            loadOptions={loadRoles ? async (search, page) => {
              const result = await loadRoles(search, page);
              return result.ok ? {
                ok: true,
                options: [
                  { value: "", label: "All roles" },
                  ...result.page.rows.map((role) => ({ value: role.id, label: role.name, meta: privilegeCountText(role.privilegeCount), badge: role.isMaster ? <MasterBadge /> : undefined })),
                ],
                page: result.page.page,
                pageCount: result.page.pageCount,
              } : result;
            } : undefined}
            value={query.role}
            onValueChange={(value) => navigate({ role: value })}
            placeholder="All roles"
            searchPlaceholder="Search roles…"
            emptyText="No role matches."
          />
        </div>
      ) : null}
      {hasRbacFilters(query) ? (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setSearch("");
            navigate({ q: "", status: "all", role: "" });
          }}
        >
          <XIcon aria-hidden="true" />
          Clear filters
        </Button>
      ) : null}
    </div>
  );
}
