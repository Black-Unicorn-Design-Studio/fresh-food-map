import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import type { MarketTag } from '@/constants/tags';
import type { SearchMode } from '@/components/market-search';

/**
 * The narrowing the map and the list share.
 *
 * This is a deliberate reversal. The rule was that filter selections are screen-local,
 * because "a filter that survives leaving the screen is a filter someone forgets is on" —
 * which is a real hazard and was the right call when the two screens had little in common.
 * They now show the same dataset through the same controls: one `TagFilter`, one
 * `MarketSearch`, the same closed vocabulary. Narrowing to producer-owned on the map and
 * finding fifteen pins again on the list does not read as a fresh start; it reads as the two
 * tabs disagreeing about what you asked for.
 *
 * What makes the reversal safe is that the hazard already has an answer on screen: the sprout
 * disc wears a dot whenever anything is narrowing, on both screens, and each panel opens with
 * the search text and the selected chips in plain sight. A filter you can see is not one you
 * forget.
 *
 * The limits are as important as the sharing:
 *
 * - **In memory only.** Nothing is persisted. Relaunching the app is still a clean slate,
 *   which is the half of the old rule that was never in question.
 * - **Narrowing only.** Sort key and direction stay on the list, because the map has no order
 *   to speak of. `🕒 OPEN NOW` was the exception here — held on the list alone, on the grounds
 *   that the map had no such control and sharing it would filter pins by something with
 *   nothing on that screen to see or unset. The map has the control now, in its own filter
 *   panel, so the reason is gone and the switch is shared like everything else that narrows.
 *   Keeping it local would mean the two tabs showing different markets from the same question,
 *   which is the disagreement this whole hook exists to end.
 * - **Not the origin.** A geocoded place means "sort from here" on one screen and "look here"
 *   on the other. Sharing the query is right; sharing the result of submitting it would move
 *   a camera somebody never asked to move.
 */
interface Filters {
  tags: MarketTag[];
  setTags: (next: MarketTag[]) => void;
  /** The search text, whatever it currently means. */
  query: string;
  setQuery: (next: string) => void;
  /** Whether that text is a market name or a place. */
  mode: SearchMode;
  setMode: (next: SearchMode) => void;
  /** Trading right now, by the device's clock — see `isOpenNow` for what that does and does not mean. */
  openNow: boolean;
  setOpenNow: (next: boolean) => void;
  /**
   * Within reach of the reader — 25 miles where 25 miles finds anything, wider where it does
   * not (`nearestWithin`). Shared like `openNow`, because it narrows the same set on both
   * screens and a filter that meant one thing per tab would be two filters wearing one name.
   *
   * It was not a filter at all until now: `📍 NEAR ME` sat in the map's dock and moved the
   * *camera*, framing the reader with the single closest market. That answered "where is the
   * nearest one" and left the list untouched, so the two screens disagreed about what the
   * question even was. As a filter it answers "which ones can I get to", which is the
   * question somebody standing up to leave actually has.
   */
  nearMe: boolean;
  setNearMe: (next: boolean) => void;
  /**
   * How many things are narrowing the markets right now — the figure the sprout disc wears as
   * a dot and speaks in its accessible name.
   *
   * Derived here rather than by each screen, and that is the whole point of it being here. The
   * two screens computed it themselves and drifted the moment `🕒 OPEN NOW` became a shared
   * filter: the map counted it, the list did not, so turning it on put a dot on one disc and
   * left the other bare while both were filtered to the same markets. Every input to this sum
   * lives in this file, so the sum belongs here too.
   */
  activeCount: number;
}

const FiltersContext = createContext<Filters | null>(null);

export function FiltersProvider({ children }: { children: ReactNode }) {
  const [tags, setTags] = useState<MarketTag[]>([]);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('name');
  const [openNow, setOpenNow] = useState(false);
  const [nearMe, setNearMe] = useState(false);

  // Memoised on the values themselves: this sits above every screen, so an unstable object
  // would re-render both tabs on any parent render, and the web map rebuilds every marker
  // when its props change identity.
  const value = useMemo(
    () => ({
      tags,
      setTags,
      query,
      setQuery,
      mode,
      setMode,
      openNow,
      setOpenNow,
      nearMe,
      setNearMe,
      // A search counts as one narrowing whatever its length, because the dot says *whether*
      // something is filtering rather than how much — the figure is spoken, never printed.
      activeCount:
        tags.length + (query.trim() ? 1 : 0) + (openNow ? 1 : 0) + (nearMe ? 1 : 0),
    }),
    [tags, query, mode, openNow, nearMe]
  );

  return <FiltersContext.Provider value={value}>{children}</FiltersContext.Provider>;
}

/**
 * Throws rather than falling back to local state when the provider is missing. A silent
 * fallback would look exactly like working code until somebody noticed the two tabs had
 * quietly stopped agreeing, which is the bug this hook exists to prevent.
 */
export function useFilters(): Filters {
  const value = useContext(FiltersContext);
  if (!value) throw new Error('useFilters must be used inside <FiltersProvider>');
  return value;
}
