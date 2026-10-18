"use client";

import { CheckIcon, ChevronsUpDownIcon, SearchIcon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/app/platform/(console)/_components/empty-state";

/** One page of server-searched choices; rows stay bounded in the browser. */
export type SelectOptionsResult =
  | { ok: true; options: SearchableSelectOption[]; page: number; pageCount: number }
  | { ok: false; error: string };

/** One choice of a SearchableSelect. */
export type SearchableSelectOption = {
  /** The submitted value (exactly one is submitted). */
  value: string;
  /** The visible text; also searched. */
  label: string;
  /** A muted second line; also searched. */
  description?: string;
  /** Short text on the right, e.g. "12 privileges"; searched when it is a string. */
  meta?: ReactNode;
  /** A badge after the label, e.g. "Master". */
  badge?: ReactNode;
  /** Shown but not selectable. */
  disabled?: boolean;
};

export type SearchableSelectProps = {
  /** The trigger's id: a `<label htmlFor>` / `Field htmlFor` points at it. */
  id: string;
  /** Name of the hidden input that submits the value with a native form (omit for filters). */
  name?: string;
  options: readonly SearchableSelectOption[];
  /** Optional scoped server search. Local filtering is bypassed when supplied. */
  loadOptions?: (search: string, page: number) => Promise<SelectOptionsResult>;
  /** Controlled value ("" = nothing chosen). */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  /** Called with the newly chosen value. */
  onValueChange?: (value: string) => void;
  /** Trigger text while nothing is chosen. */
  placeholder?: string;
  /** Placeholder of the search box inside the list. */
  searchPlaceholder?: string;
  /** Shown when the search matches nothing (or there are no options). */
  emptyText?: string;
  disabled?: boolean;
  /** While true the trigger shows "Loading…" and stays disabled (dependent fields). */
  loading?: boolean;
  /** Marks the trigger invalid (red border, aria-invalid). */
  invalid?: boolean;
  /** Ids of the hint/error texts (use `describedBy()` from Field). */
  "aria-describedby"?: string;
  /** Id of a visible label when no `<label htmlFor>` is used. */
  "aria-labelledby"?: string;
  /** Accessible name when there is no visible label. */
  "aria-label"?: string;
  required?: boolean;
  /** Ref to the trigger button (e.g. to focus the first invalid field). */
  ref?: Ref<HTMLButtonElement>;
  /** Called when the trigger loses focus while the list is closed (blur validation). */
  onBlur?: () => void;
  className?: string;
};

/**
 * Description: Tell whether an option matches the search text.
 * Input: The option and the lower-cased, trimmed search text.
 * Output: True when the label, description or text meta contains the search text.
 * Use case: Filtering the SearchableSelect list while the user types.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
function matches(option: SearchableSelectOption, search: string): boolean {
  if (search === "") return true;
  const haystack = [option.label, option.description ?? "", typeof option.meta === "string" ? option.meta : ""]
    .join(" ")
    .toLocaleLowerCase("en-US");
  return haystack.includes(search);
}

/**
 * Description: A single-value select with a search box (the shadcn combobox
 *   pattern built from Popover + Input + an ARIA listbox; no extra dependency).
 * Input: See SearchableSelectProps: id, name, options, value/defaultValue,
 *   onValueChange, texts, disabled, loading, invalid, aria wiring, required.
 * Output: A button trigger (`role="combobox"`) showing the chosen label; it
 *   opens a themed popover with a search box and a `role="listbox"` of
 *   `role="option"` rows. Keyboard: ArrowDown/ArrowUp (also open it), Home/End,
 *   Enter selects, Escape closes, typing a letter on the closed trigger opens
 *   it and starts filtering. Focus returns to the trigger on close. With
 *   `name`, a hidden input submits exactly ONE value ("" when nothing chosen).
 * Use case: Role picker (sub-user forms, delete-and-reassign), the role filter
 *   of the sub-users toolbar, and any other dropdown that needs a search
 *   (CLAUDE.md "Searchable Selects").
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function SearchableSelect({
  id,
  name,
  options,
  loadOptions,
  value,
  defaultValue = "",
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches found.",
  disabled = false,
  loading = false,
  invalid = false,
  "aria-describedby": ariaDescribedBy,
  "aria-labelledby": ariaLabelledBy,
  "aria-label": ariaLabel,
  required = false,
  ref,
  onBlur,
  className,
}: SearchableSelectProps) {
  // Uncontrolled value (used only when `value` is not passed).
  const [innerValue, setInnerValue] = useState(defaultValue);
  const [open, setOpen]             = useState(false);
  const [search, setSearch]         = useState("");
  // The highlighted option (keyboard/mouse), by value; null = none.
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [optionPage, setOptionPage] = useState(1);
  const [attempt, setAttempt]       = useState(0);
  const [remote, setRemote]         = useState<SelectOptionsResult | null>(null);
  const [searching, setSearching]   = useState(false);
  // Keep just the selected row across remote pages/searches, never the full dataset.
  const [remembered, setRemembered] = useState<SearchableSelectOption | null>(null);
  const remoteEnabled = Boolean(loadOptions);
  const loadPage = useEffectEvent(async (text: string, page: number) => loadOptions?.(text, page));

  useEffect(() => {
    if (!open || !remoteEnabled) return;
    let obsolete = false;
    // Debounce only typing; paging and opening still show an explicit loading state.
    const timer = setTimeout(() => {
      loadPage(search, optionPage)
        .then((result) => {
          if (!obsolete && result) {
            setRemote(result);
            setSearching(false);
          }
        })
        .catch(() => {
          if (!obsolete) {
            setRemote({ ok: false, error: "The choices could not be loaded. Try again." });
            setSearching(false);
          }
        });
    }, search ? 250 : 0);
    return () => {
      obsolete = true;
      clearTimeout(timer);
    };
  }, [open, search, optionPage, attempt, remoteEnabled]);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLUListElement>(null);
  const baseId    = useId();
  const listboxId = `${baseId}-listbox`;
  const searchId  = `${baseId}-search`;

  // Step 1: the current value (controlled wins) and the option it names.
  const selectedValue  = value ?? innerValue;
  const selectedOption = options.find((option) => option.value === selectedValue)
    ?? (remembered?.value === selectedValue ? remembered : undefined);

  // Step 2: the options matching the search, and which of them can be chosen.
  const normalizedSearch = search.trim().toLocaleLowerCase("en-US");
  const visible          = loadOptions
    ? (searching || !remote?.ok ? [] : remote.options)
    : options.filter((option) => matches(option, normalizedSearch));
  const enabled          = visible.filter((option) => !option.disabled);

  // Step 3: the highlighted option must be a visible, enabled one; otherwise the first enabled.
  const active   = enabled.find((option) => option.value === activeValue) ?? enabled[0] ?? null;
  const inactive = disabled || loading;

  /**
   * Description: The DOM id of one option row.
   * Input: The option's index in the visible list.
   * Output: A listbox-unique id (aria-activedescendant points at it).
   * Use case: Option rows and the search box's active descendant.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function optionId(index: number): string {
    return `${baseId}-option-${index}`;
  }

  /**
   * Description: Open or close the list, resetting the search on every change.
   * Input: Whether it should be open, and an optional first search character.
   * Output: Updated open/search/highlight state (the chosen option is highlighted on open).
   * Use case: Trigger clicks, keyboard opening, Escape, outside clicks, selection.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function changeOpen(next: boolean, seed = "") {
    if (next && inactive) return;
    setOpen(next);
    setSearch(next ? seed : "");
    setOptionPage(1);
    setRemote(null);
    setSearching(Boolean(next && loadOptions));
    setActiveValue(next ? (selectedOption?.value ?? null) : null);
  }

  /**
   * Description: Choose one option and close the list.
   * Input: The option.
   * Output: The value is stored (uncontrolled) and reported; disabled options are ignored.
   * Use case: Click on a row, Enter in the search box.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function choose(option: SearchableSelectOption) {
    if (option.disabled || searching) return;
    setRemembered(option);
    if (value === undefined) setInnerValue(option.value);
    onValueChange?.(option.value);
    changeOpen(false);
  }

  /**
   * Description: Move the highlight and keep the highlighted row in view.
   * Input: The option to highlight (or null).
   * Output: Updated highlight; the row is scrolled into the list's view.
   * Use case: Arrow keys, Home/End and mouse hover.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function highlight(option: SearchableSelectOption | null) {
    if (!option) return;
    setActiveValue(option.value);
    // The row exists already (only the highlight changes), so it can be scrolled now.
    const index = visible.indexOf(option);
    const row   = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(index))}`);
    row?.scrollIntoView({ block: "nearest" });
  }

  /**
   * Description: Keyboard support of the closed trigger.
   * Input: The keydown event.
   * Output: ArrowDown/ArrowUp open the list; a printable character opens it
   *   and starts the search with that character. Enter/Space are handled by
   *   the trigger button itself.
   * Use case: Keyboard-only users and type-to-filter.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (open || inactive) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      changeOpen(true);
      return;
    }
    const printable = event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (printable) {
      event.preventDefault();
      changeOpen(true, event.key);
    }
  }

  /**
   * Description: Keyboard support inside the open list (focus stays in the search box).
   * Input: The keydown event of the search box.
   * Output: ArrowDown/ArrowUp move the highlight, Home/End jump to the first/last
   *   option, Enter chooses the highlighted option, Tab closes the list.
   *   Escape is handled by the popover (closes and returns focus to the trigger).
   * Use case: Keyboard navigation of the listbox (aria-activedescendant pattern).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-16
   * Last modified: 2026-10-16
   */
  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const position = active ? enabled.indexOf(active) : -1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        highlight(enabled[Math.min(position + 1, enabled.length - 1)] ?? null);
        break;
      case "ArrowUp":
        event.preventDefault();
        highlight(enabled[Math.max(position - 1, 0)] ?? null);
        break;
      case "Home":
        event.preventDefault();
        highlight(enabled[0] ?? null);
        break;
      case "End":
        event.preventDefault();
        highlight(enabled[enabled.length - 1] ?? null);
        break;
      case "Enter":
        // Never submit the surrounding form from inside the list.
        event.preventDefault();
        if (active) choose(active);
        break;
      case "Tab":
        changeOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={(next) => changeOpen(next)}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listboxId : undefined}
            aria-invalid={invalid || undefined}
            aria-required={required || undefined}
            aria-describedby={ariaDescribedBy}
            aria-labelledby={ariaLabelledBy}
            aria-label={ariaLabel}
            aria-busy={loading || undefined}
            disabled={inactive}
            onKeyDown={onTriggerKeyDown}
            onBlur={() => {
              if (!open) onBlur?.();
            }}
            className={cn(
              "h-10 w-full justify-between gap-2 px-3 font-normal",
              invalid && "border-destructive ring-destructive/20 dark:ring-destructive/40",
              className,
            )}
          >
            {loading ? (
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <Spinner aria-hidden="true" role={undefined} aria-label={undefined} className="size-4" />
                Loading…
              </span>
            ) : selectedOption ? (
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{selectedOption.label}</span>
                {selectedOption.badge}
              </span>
            ) : (
              <span className="truncate text-muted-foreground">{placeholder}</span>
            )}
            <ChevronsUpDownIcon aria-hidden="true" className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) min-w-64 p-0"
          onOpenAutoFocus={(event) => {
            // Focus the search box (caret after a seeded character) instead of the panel.
            event.preventDefault();
            const input = searchRef.current;
            input?.focus();
            input?.setSelectionRange(input.value.length, input.value.length);
          }}
        >
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={searchRef}
              id={searchId}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={active ? optionId(visible.indexOf(active)) : undefined}
              aria-label={searchPlaceholder}
              maxLength={loadOptions ? 100 : undefined}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={search}
              placeholder={searchPlaceholder}
              onChange={(event) => {
                setSearch(event.currentTarget.value);
                setOptionPage(1);
                if (loadOptions) setSearching(true);
                setActiveValue(null);
              }}
              onKeyDown={onSearchKeyDown}
              className="h-10 w-full min-w-0 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul
            ref={listRef}
            id={listboxId}
            role="listbox"
            aria-busy={searching || undefined}
            aria-labelledby={ariaLabelledBy}
            aria-label={ariaLabelledBy ? undefined : (ariaLabel ?? placeholder)}
            className="max-h-64 overflow-y-auto p-1"
          >
            {searching ? (
              <li role="presentation" aria-live="polite" className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground"><Spinner /> Loading…</li>
            ) : loadOptions && remote && !remote.ok ? (
              <li role="presentation" className="flex flex-col gap-2 px-3 py-4 text-sm text-destructive">
                <p role="status">{remote.error}</p>
                <Button type="button" variant="outline" onClick={() => { setSearching(true); setAttempt((value) => value + 1); }}>Try again</Button>
              </li>
            ) : visible.length === 0 ? (
              // An empty list still explains itself (polite, not an option).
              <li role="presentation" aria-live="polite" className="px-3 py-6 text-center text-sm text-muted-foreground">
                <EmptyState size="sm" icon="search" title="No matching choices" description={emptyText} />
              </li>
            ) : (
              visible.map((option, index) => {
                const isSelected = option.value === selectedValue;
                const isActive   = active?.value === option.value;
                return (
                  <li
                    key={option.value}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    data-active={isActive || undefined}
                    // Keep focus in the search box while clicking a row.
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => {
                      if (!option.disabled && !isActive) setActiveValue(option.value);
                    }}
                    onClick={() => choose(option)}
                    className={cn(
                      "flex cursor-pointer items-start gap-2 rounded-sm px-2 py-2 text-sm outline-none select-none",
                      "data-[active]:bg-accent data-[active]:text-accent-foreground",
                      option.disabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <CheckIcon
                      aria-hidden="true"
                      className={cn("mt-0.5 size-4 shrink-0", isSelected ? "opacity-100" : "opacity-0")}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="break-words">{option.label}</span>
                        {option.badge}
                      </span>
                      {option.description ? (
                        <span className="text-xs text-muted-foreground">{option.description}</span>
                      ) : null}
                    </span>
                    {option.meta ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{option.meta}</span>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
          {loadOptions && remote?.ok && remote.pageCount > 1 ? (
            <div className="flex items-center justify-between gap-2 border-t p-2">
              <Button type="button" size="sm" variant="outline" disabled={searching || remote.page <= 1} onClick={() => { setSearching(true); setOptionPage(remote.page - 1); }}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {remote.page} of {remote.pageCount}</span>
              <Button type="button" size="sm" variant="outline" disabled={searching || remote.page >= remote.pageCount} onClick={() => { setSearching(true); setOptionPage(remote.page + 1); }}>Next</Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {/* Exactly one submitted value for native forms ("" while nothing is chosen). */}
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
    </>
  );
}
