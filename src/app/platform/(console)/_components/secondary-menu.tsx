"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { Icon, type IconName } from "./icons";
import { FOCUS_RING } from "./styles";

/**
 * The secondary menu of a console page (CLAUDE.md "Secondary Menu Navigation
 * Rules"). One shared implementation for every long form, create/edit page,
 * settings page and multi-section page:
 *
 * - Click-to-scroll: a menu item scrolls the page's scroll container smoothly
 *   (instantly with reduced motion) so the section heading sits just below
 *   the sticky menu.
 * - Scroll-to-menu: while the owner scrolls, the item of the section being
 *   read is highlighted (the last section whose top passed the activation line,
 *   or the last section once the page is scrolled to the bottom).
 * - Dynamic sections: an item whose section element is not in the page (a
 *   setup card that is hidden, a form replaced by its success panel) is not
 *   shown; a MutationObserver keeps this current.
 * - Sticky: "sidebar" pages show a vertical menu beside the content from the
 *   lg breakpoint and a horizontal bar above it on smaller screens; "top"
 *   pages always use the horizontal bar (for wide tables).
 */

/** One menu entry: the DOM id of the section it scrolls to and its visible text. */
export type SecondaryMenuItem = {
  /** The id of the section element (a `<section id="…">` or card). */
  id: string;
  /** The text shown in the menu; normally the section's heading. */
  label: string;
  /** Optional decorative symbol before the label. */
  icon?: IconName;
};

/** Where the menu sits: beside the content (from lg) or above it (always). */
export type SecondaryMenuVariant = "sidebar" | "top";

// The console's desktop breakpoint (Tailwind `lg`, 64rem); the same value the
// console shell uses for its persistent sidebar.
const DESKTOP_QUERY = "(min-width: 64rem)";

// Space left between the sticky menu (or the top edge) and a section heading
// after a menu click, in pixels.
const HEADING_GAP_PX = 16;

// A section counts as "being read" once its top is within this many pixels
// below the scroll offset. A little larger than the gap, so the clicked
// section is always active after its scroll finishes.
const ACTIVATION_SLACK_PX = 32;

// Being this close to the bottom counts as "at the bottom" (rounding of
// fractional scroll positions on high-density screens).
const BOTTOM_TOLERANCE_PX = 2;

// After a click the clicked item stays active until scrolling has been quiet
// for this long, so passing over other sections does not flicker the menu.
const SCROLL_SETTLE_MS = 120;

// When a click does not scroll at all (the section is already in place), the
// click lock is released after this long anyway.
const CLICK_LOCK_FALLBACK_MS = 1000;

/**
 * Description: Find the element that scrolls the page content around a section.
 * Input: A section element (or null when none is on the page).
 * Output: The nearest ancestor with `overflow-y: auto | scroll`, or null for the window.
 * Use case: The console scrolls inside `<main>` rather than the window; the
 *   menu must listen to and scroll that element.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function findScrollContainer(element: HTMLElement | null): HTMLElement | null {
  // Step 1: start with the parent; the section itself never scrolls the page.
  let current = element?.parentElement ?? null;

  // Step 2: walk up until an element that scrolls vertically is found.
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }

  // Step 3: nothing scrolls on its own: the window does.
  return null;
}

/**
 * Description: Measure the scroll position, size and top edge of the scroll container.
 * Input: The scroll container, or null for the window.
 * Output: scrollTop, the visible height, the total scroll height and the viewport top.
 * Use case: Shared by the scroll-spy and the click-to-scroll calculation, so
 *   both read the window and an element container the same way.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function measureContainer(container: HTMLElement | null): {
  scrollTop: number;
  viewHeight: number;
  scrollHeight: number;
  viewTop: number;
} {
  if (container) {
    return {
      scrollTop:    container.scrollTop,
      viewHeight:   container.clientHeight,
      scrollHeight: container.scrollHeight,
      viewTop:      container.getBoundingClientRect().top,
    };
  }
  return {
    scrollTop:    window.scrollY,
    viewHeight:   window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    viewTop:      0,
  };
}

/**
 * Description: Decide which section is currently being read.
 * Input: The section ids in page order, the scroll container and the scroll offset (menu height + gap).
 * Output: The active section id, or null when none of the sections is on the page.
 * Use case: Highlighting the menu item while the owner scrolls manually.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function currentSectionId(
  ids: readonly string[],
  container: HTMLElement | null,
  offset: number,
): string | null {
  // Step 1: only sections that exist right now take part.
  const present = ids.filter((id) => document.getElementById(id) !== null);
  if (present.length === 0) return null;

  // Step 2: at the very bottom the last sections may never reach the top
  // line; the last one is then the one being read. scrollTop > 0 keeps a page
  // that does not scroll at all on its first section.
  const { scrollTop, viewHeight, scrollHeight, viewTop } = measureContainer(container);
  const atBottom = scrollTop > 0 && scrollTop + viewHeight >= scrollHeight - BOTTOM_TOLERANCE_PX;
  if (atBottom) return present[present.length - 1] ?? null;

  // Step 3: otherwise the last section whose top has passed the activation line.
  const activationLine = offset + ACTIVATION_SLACK_PX;
  let active           = present[0] ?? null;
  for (const id of present) {
    const section = document.getElementById(id);
    if (!section) continue;
    const topInView = section.getBoundingClientRect().top - viewTop;
    if (topInView <= activationLine) active = id;
  }
  return active;
}

/**
 * Description: Subscribe to DOM changes so the list of present sections stays current.
 * Input: React's change callback from useSyncExternalStore.
 * Output: An unsubscribe function that disconnects the MutationObserver.
 * Use case: Sections that appear, disappear, expand or collapse after the first render.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function subscribeToSectionChanges(onChange: () => void): () => void {
  // childList + subtree: a section added or removed anywhere in the page.
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}

/**
 * Description: Keep only the menu items whose section is currently in the page.
 * Input: The page's menu items (all possible sections, in page order).
 * Output: The items whose section element exists; all of them during server rendering.
 * Use case: Context-aware menu: a hidden setup card or a form replaced by its
 *   success panel disappears from the menu automatically.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function usePresentItems(items: readonly SecondaryMenuItem[]): SecondaryMenuItem[] {
  // Every possible section id, as one string (stable while the items stay the same).
  const allIds = items.map((item) => item.id).join(" ");

  /**
   * Description: Read which of the menu's sections exist in the page right now.
   * Input: None (reads the DOM).
   * Output: The present ids joined by spaces (a string, so React compares it cheaply).
   * Use case: usePresentItems (useSyncExternalStore).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  const getSnapshot = useCallback(
    () =>
      allIds
        .split(" ")
        .filter((id) => id !== "" && document.getElementById(id) !== null)
        .join(" "),
    [allIds],
  );

  /**
   * Description: Give React the server-side list of present sections.
   * Input: None.
   * Output: Every item id (the server cannot look at the DOM; the browser then corrects it).
   * Use case: usePresentItems (useSyncExternalStore).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  const getServerSnapshot = useCallback(() => allIds, [allIds]);

  const presentIds = useSyncExternalStore(subscribeToSectionChanges, getSnapshot, getServerSnapshot);
  const present    = new Set(presentIds.split(" "));
  return items.filter((item) => present.has(item.id));
}

type SectionedLayoutProps = {
  /** Every section the page can show, in page order. */
  items: readonly SecondaryMenuItem[];
  /** "sidebar" (default) or "top"; see SecondaryMenuVariant. */
  variant?: SecondaryMenuVariant;
  /** The menu's accessible name. */
  label?: string;
  /** The page content holding the sections. */
  children: ReactNode;
  /** Extra classes for the content column. */
  contentClassName?: string;
};

/**
 * Description: Lay out a page's sections with the shared secondary menu.
 * Input: The page's sections, the menu variant, the menu's name and the content.
 * Output: The menu (sticky) and the content; without present sections only the content.
 * Use case: Create/edit/detail tenant pages, the tenant directory, the dashboard
 *   and Appearance settings, so every page uses the same navigation.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
export function SectionedLayout({
  items,
  variant = "sidebar",
  label = "On this page",
  children,
  contentClassName,
}: SectionedLayoutProps) {
  // Only sections that exist right now get a menu item.
  const presentItems = usePresentItems(items);
  const hasMenu      = presentItems.length > 0;
  // The two-column grid is used only when there is a sidebar menu to place.
  const sideBySide = hasMenu && variant === "sidebar";

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-6",
        sideBySide && "lg:grid lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-start lg:gap-8",
      )}
    >
      {hasMenu ? <SecondaryMenu items={presentItems} variant={variant} label={label} /> : null}
      <div className={cn("min-w-0", contentClassName)}>{children}</div>
    </div>
  );
}

type SecondaryMenuProps = {
  items: readonly SecondaryMenuItem[];
  variant: SecondaryMenuVariant;
  label: string;
};

/**
 * Description: Render the sticky menu and keep it synchronised with the scroll position.
 * Input: The present sections, the variant and the accessible name.
 * Output: A `<nav>` of in-page links; the active one has `aria-current="location"`.
 * Use case: Rendered by SectionedLayout; not used on its own.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-15
 * Last modified: 2026-10-15
 */
function SecondaryMenu({ items, variant, label }: SecondaryMenuProps) {
  const navRef  = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // The section a click is scrolling to; the scroll-spy waits until it settles.
  const lockedId     = useRef<string | null>(null);
  const releaseTimer = useRef<number | undefined>(undefined);

  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);

  // A string key so the effects below re-run only when the set of sections changes.
  const itemIds = items.map((item) => item.id).join(" ");

  /**
   * Description: Work out how far below the container's top a section heading should land.
   * Input: None (reads the menu's layout).
   * Output: The offset in pixels: the horizontal bar's height plus a gap, or just the gap.
   * Use case: Click-to-scroll and the scroll-spy's activation line.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  const scrollOffset = useCallback((): number => {
    // The menu is a horizontal bar above the content for "top" pages and on
    // screens below lg; it then covers the top of the scroll area.
    const horizontal = variant === "top" || !window.matchMedia(DESKTOP_QUERY).matches;
    const barHeight  = horizontal ? (navRef.current?.offsetHeight ?? 0) : 0;
    return barHeight + HEADING_GAP_PX;
  }, [variant]);

  // Scroll-spy: follow the owner's manual scrolling.
  useEffect(() => {
    const ids          = itemIds.split(" ").filter((id) => id !== "");
    const firstSection = ids[0] ? document.getElementById(ids[0]) : null;
    const container    = findScrollContainer(firstSection);
    const scrollTarget: HTMLElement | Window = container ?? window;
    let frame = 0;

    /**
     * Description: Recalculate the active section once per animation frame.
     * Input: None (reads the DOM).
     * Output: Updates activeId unless a click is still scrolling.
     * Use case: Scroll and resize events.
     * Author: Mr. Sachin Sharma
     * Created: 2026-10-15
     * Last modified: 2026-10-15
     */
    function measure() {
      frame = 0;
      if (lockedId.current !== null) return;
      setActiveId(currentSectionId(ids, container, scrollOffset()));
    }

    /**
     * Description: React to a scroll or resize event.
     * Input: None.
     * Output: Schedules a measurement, or extends the click lock while a click scrolls.
     * Use case: Listener on the scroll container and the window.
     * Author: Mr. Sachin Sharma
     * Created: 2026-10-15
     * Last modified: 2026-10-15
     */
    function onScroll() {
      // A click is scrolling: release the lock only when the scrolling has stopped.
      if (lockedId.current !== null) {
        window.clearTimeout(releaseTimer.current);
        releaseTimer.current = window.setTimeout(() => {
          lockedId.current = null;
        }, SCROLL_SETTLE_MS);
        return;
      }
      // Coalesce many scroll events into one measurement per frame.
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    }

    // The first measurement, deferred to the next frame (after layout).
    frame = window.requestAnimationFrame(measure);
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(releaseTimer.current);
      scrollTarget.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [itemIds, scrollOffset]);

  // On the horizontal bar, keep the active item visible by scrolling the bar
  // sideways only (never the page, which may be in the middle of a smooth scroll).
  useEffect(() => {
    const list = listRef.current;
    if (!list || activeId === null) return;
    const link = list.querySelector<HTMLElement>(`[data-section-id="${CSS.escape(activeId)}"]`);
    if (!link || list.scrollWidth <= list.clientWidth) return;
    const centredLeft = link.offsetLeft - list.clientWidth / 2 + link.offsetWidth / 2;
    list.scrollTo({ left: Math.max(0, centredLeft) });
  }, [activeId]);

  /**
   * Description: Scroll smoothly to the clicked section and mark it active.
   * Input: The click event and the section id.
   * Output: The scroll container moves so the heading sits below the menu; the item is active.
   * Use case: Click-to-scroll for mouse, touch and keyboard (Enter on the link).
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-15
   * Last modified: 2026-10-15
   */
  function handleClick(event: MouseEvent<HTMLAnchorElement>, id: string) {
    const section = document.getElementById(id);
    // Without the section (should not happen) the native #hash link still works.
    if (!section) return;
    event.preventDefault();

    // Step 1: mark the target active at once and hold it while the page scrolls.
    lockedId.current = id;
    setActiveId(id);

    // Step 2: scroll the container so the heading lands just below the menu.
    const container = findScrollContainer(section);
    const { scrollTop, viewTop } = measureContainer(container);
    const target       = scrollTop + section.getBoundingClientRect().top - viewTop - scrollOffset();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const options: ScrollToOptions = { top: Math.max(0, target), behavior: reduceMotion ? "auto" : "smooth" };
    if (container) container.scrollTo(options);
    else window.scrollTo(options);

    // Step 3: if nothing scrolls (already in place), still release the lock.
    window.clearTimeout(releaseTimer.current);
    releaseTimer.current = window.setTimeout(() => {
      lockedId.current = null;
    }, CLICK_LOCK_FALLBACK_MS);
  }

  const horizontalOnly = variant === "top";

  return (
    <nav
      ref={navRef}
      aria-label={label}
      className={cn(
        // Horizontal bar: sticks to the top of the scroll area, full content width.
        "sticky top-0 z-20 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6",
        horizontalOnly
          ? "lg:-mx-9 lg:px-9"
          : // Sidebar from lg: a plain sticky column beside the content.
            "lg:top-6 lg:mx-0 lg:self-start lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none",
      )}
    >
      {horizontalOnly ? null : (
        <p className="mb-2 hidden px-3 text-[11px] font-semibold tracking-[0.15em] text-muted-foreground uppercase lg:block">
          {label}
        </p>
      )}
      <ul
        ref={listRef}
        className={cn(
          "flex gap-1 overflow-x-auto [scrollbar-width:none]",
          horizontalOnly ? null : "lg:flex-col lg:overflow-visible",
        )}
      >
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <li key={item.id} className="shrink-0">
              <a
                href={`#${item.id}`}
                data-section-id={item.id}
                aria-current={active ? "location" : undefined}
                onClick={(event) => handleClick(event, item.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors motion-reduce:transition-none",
                  horizontalOnly ? null : "lg:border-l-2 lg:border-transparent lg:rounded-l-none",
                  active
                    ? "bg-accent font-medium text-accent-foreground lg:border-primary"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  FOCUS_RING,
                )}
              >
                {item.icon ? <Icon name={item.icon} className="size-4 shrink-0" /> : null}
                {item.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
