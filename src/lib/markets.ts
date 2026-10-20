import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { type CountryCode } from '@/constants/countries';
import { useSettings } from '@/hooks/use-settings';
import { marketClock } from '@/lib/market-clock';
import { MARKET_TAGS, tagAppliesIn, type MarketTag } from '@/constants/tags';
import { haversineKm, type LatLon } from '@/lib/geo';
import { MarketCollection } from '@/lib/market-schema';

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface ScheduleEntry {
  day: Weekday;
  open: string; // "HH:MM"
  close: string;
}

export interface Market {
  id: string;
  name: string;
  address: string;
  lat: number;
  lon: number;
  schedule: ScheduleEntry[];
  seasonStart: string | null; // "MM-DD", null = year-round
  seasonEnd: string | null;
  /**
   * IANA name of the zone the `schedule` is written in. Optional on the *type* even though the
   * schema requires it, because a dataset refetched from a CDN can be older than the app
   * reading it — and `marketClock` falls back to the reader's own zone, which is exactly the
   * behaviour this field replaced.
   */
  timezone?: string;
  /**
   * Which country's conventions this record is written in. Optional on the type though the
   * schema requires it, for the same reason `timezone` is: a dataset refetched from a CDN can
   * be older than the app reading it, and a record with no country should be shown rather than
   * dropped.
   */
  country?: CountryCode;
  website: string | null;
  source: 'usda' | 'osm' | 'state_portal' | 'city_portal' | 'community' | 'manual';
  /** Closed vocabulary (`src/constants/tags.ts`), enforced by the validator. */
  tags: MarketTag[];
}

// Bundled dataset: instant first paint + offline fallback (trd §2).
const bundledCollection = require('../../data/markets.json');

/** Exported for tests: the tag-narrowing invariant is otherwise reachable only through a hook. */
export function featureToMarket(feature: any): Market {
  const p = feature.properties;
  const [lon, lat] = feature.geometry.coordinates;
  return {
    id: p.id,
    name: p.name,
    address: p.address,
    lat,
    lon,
    schedule: p.schedule ?? [],
    seasonStart: p.season_start ?? null,
    seasonEnd: p.season_end ?? null,
    timezone: p.timezone ?? undefined,
    country: (p.country as CountryCode) ?? undefined,
    website: p.website ?? null,
    source: p.source,
    // Filtered rather than trusted: a record written before a tag was retired,
    // or by a fork with its own vocabulary, must not put an unknown value into
    // a filter the UI cannot render.
    tags: ((p.tags ?? []) as MarketTag[]).filter((t) => (MARKET_TAGS as readonly string[]).includes(t)),
  };
}

/**
 * Every id in the dataset compiled into this build.
 *
 * For `generateStaticParams`, which runs at export time — hence the bundle rather than the
 * fetched copy: there is no network at build time, and the published file is derived from
 * this same one anyway. A market merged after this build simply has no pre-rendered page
 * until the next publish, and falls back to the client-rendered route.
 */
export function bundledMarketIds(): string[] {
  return parseCollection(bundledCollection).map((m) => m.id);
}

/** Exported for tests: the `active !== false` drop is otherwise reachable only through a hook. */
export function parseCollection(collection: any): Market[] {
  return (collection.features ?? [])
    .filter((f: any) => f.properties?.active !== false)
    .map(featureToMarket);
}

// Optional CDN copy of data/markets.json for over-the-air freshness;
// unset (e.g. local dev) means bundled-only.
const DATA_URL = process.env.EXPO_PUBLIC_DATA_URL;

/**
 * Validates a dataset that arrived over the network, then narrows it.
 *
 * Exported for tests, and separate from `parseCollection` because the two answer different
 * questions. `parseCollection` trusts its input: it is the bundle, which was compiled from
 * the file CI validated, so nothing on that path can be malformed. This one is handed bytes
 * from a URL, and the checks the record already passed — the intake service's, CI's, a
 * reviewer's — all happened upstream of the file and do not travel with it.
 *
 * All-or-nothing rather than dropping bad records: a feed this app cannot vouch for is not
 * a feed to take the good half of. Throwing keeps the bundled copy on screen, which is the
 * dataset a human merged.
 */
export function parseFetchedCollection(raw: unknown): Market[] {
  const parsed = MarketCollection.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`dataset failed validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
  }
  // A well-formed collection of nothing is the one valid response that must not be believed.
  // `features: []` parses cleanly and would replace every market with none — an empty app,
  // no error, no way for anyone to tell. This dataset is never legitimately empty; a fork
  // starting from zero ships no DATA_URL and reads the bundle.
  if (parsed.data.features.length === 0) {
    throw new Error('dataset was empty; keeping the bundled copy');
  }
  return parseCollection(parsed.data);
}

/** The git-backed tier — every market we publish. */
export function useDatasetMarkets() {
  return useQuery({
    queryKey: ['dataset-markets'],
    queryFn: async (): Promise<Market[]> => {
      if (!DATA_URL) return parseCollection(bundledCollection);
      const res = await fetch(DATA_URL);
      if (!res.ok) throw new Error(`dataset fetch failed: ${res.status}`);
      return parseFetchedCollection(await res.json());
    },
    initialData: () => parseCollection(bundledCollection),
    // Without this the fetch never happens at all. `initialData` with no timestamp counts as
    // fetched-now, so `staleTime` leaves the query fresh on mount, and every page load
    // re-seeds it and restarts the hour — measured: 14 markets served, the page rendered 13,
    // and the access log showed the browser never requested the file. Dating the bundled
    // copy to the epoch marks it stale on arrival, so the fetch fires while the UI still
    // paints instantly from it. On failure the bundled copy simply stays.
    initialDataUpdatedAt: 0,
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });
}

/**
 * Every market the app knows about.
 *
 * v1 has exactly one tier — the dataset in git, bundled for offline and
 * refreshed from the CDN. There is no database, no community tier and no live
 * override: a market is published when its pull request merges, and that review
 * is the only check it gets (docs/trd.md §3).
 */
export function useMarkets() {
  const dataset = useDatasetMarkets();
  const { country } = useSettings();
  /**
   * **Narrowed to the reader's country, at the source.**
   *
   * A reader in Manchester was being shown sixty-one American markets among eight British
   * ones: every count four-fifths noise, `📍 NEAR ME` widening to a hundred miles through an
   * ocean, and any filter press fitting a camera box from California to Oldham — which shows
   * the Atlantic and neither country.
   *
   * Here rather than in each screen because the two must never disagree about what exists;
   * that is the rule `useFilters` was created for, and a list and a map drawing different
   * datasets would be a worse version of the same fault. It is also not a *filter* in the
   * sense the chips are — nothing in the panel can turn it off, and it is not counted as
   * active — so it belongs to the data rather than to the filter state.
   *
   * A record with no country survives. Only a dataset older than this field can produce one,
   * and dropping markets because the CDN copy is stale would be the worst way to discover it.
   */
  const data = dataset.data;
  const markets = useMemo(
    () => (data ?? []).filter((m) => !m.country || m.country === country),
    [data, country],
  );
  return {
    markets,
    isLoading: dataset.isLoading,
    isError: dataset.isError && markets.length === 0,
    /**
     * The refresh failed and the bundled copy is what you are looking at.
     *
     * Separate from `isError`, which asks "is there nothing to show" and, because
     * `initialData` always supplies the bundle, is never true — so a broken feed used to be
     * perfectly silent. This says something weaker and more useful: the markets are real,
     * they may just be behind the file a reviewer last merged.
     *
     * Quiet when merely offline. React Query's default `networkMode: 'online'` pauses a
     * query instead of failing it when there is no connection (query-core `retryer.js`), so
     * this reports a server that answered wrongly rather than a train tunnel.
     */
    refreshFailed: dataset.isError && markets.length > 0,
  };
}

/**
 * Whether a market is trading at `now`, by the *market's* clock.
 *
 * It used to be the device's, and that was a real limitation rather than an oversight: a
 * market three zones away read as open or closed by the viewer's local time. The dataset
 * carries an IANA timezone per record now, so there is something to correct with, and
 * `marketClock` does the correcting.
 *
 * A market with no schedule is never "open now": absent hours are unknown hours, and
 * guessing in the optimistic direction sends somebody to a closed car park.
 */
export function isOpenNow(m: Market, now: Date = new Date()): boolean {
  if (!inSeason(m, now)) return false;
  // **The market's clock, not the device's.** `schedule` says `09:00` and means nine in the
  // morning where the stalls are. Reading the device meant the answer was right only while the
  // reader stood in the same zone as the thing they were looking at — three hours out for
  // California reading Maryland, five for Manchester reading it, with nothing on screen
  // admitting either.
  const { day: today, minutes } = marketClock(m.timezone, now);
  return m.schedule.some((s) => {
    if (s.day !== today) return false;
    const open = toMinutes(s.open);
    const close = toMinutes(s.close);
    if (open === null || close === null) return false;
    // Half-open: a market closing at 14:00 is shut at 14:00, not still trading.
    return minutes >= open && minutes < close;
  });
}

/** Date#getDay() is Sunday-first; WEEKDAYS is Monday-first, so this cannot be an index into it. */

function toMinutes(hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * Season is stored as MM-DD with no year, so string comparison is enough — and a season that
 * runs November to March has an end *earlier* than its start, which is a wrap around the new
 * year rather than an empty range. Getting that backwards hides every winter market.
 */
function inSeason(m: Market, now: Date): boolean {
  if (!m.seasonStart || !m.seasonEnd) return true; // no dates recorded means year-round
  // The market's date, not the reader's: a season that ends on 31 October ends when October
  // does where the stalls are, and the two are a day apart for several hours every day.
  const today = marketClock(m.timezone, now).monthDay;
  return m.seasonStart <= m.seasonEnd
    ? today >= m.seasonStart && today <= m.seasonEnd
    : today >= m.seasonStart || today <= m.seasonEnd;
}

/**
 * Markets carrying every selected tag — AND, not OR. Someone filtering
 * "producer-owned" and "accepts SNAP" wants markets that are both; OR would
 * widen the list as they added constraints, which is the opposite of what
 * picking a second filter means. No selection means no filtering.
 */
/**
 * Case- and accent-insensitive, so "cafe" finds "Café" and nobody has to know which way a
 * name was spelled. `normalize` is guarded: Hermes has shipped without it, and a search box
 * that throws is worse than one that cannot see past an accent.
 */
function fold(text: string): string {
  const lower = text.toLowerCase();
  try {
    return lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    return lower;
  }
}

/**
 * Narrows the list by what somebody typed, over the two fields a card actually shows: the
 * market's name and its address, which is where the town on the overline comes from. Nothing
 * matches against a field the reader cannot see — a result they cannot account for reads as
 * a bug in the search rather than a fact about the market.
 *
 * Every whitespace-separated term has to match, so more words mean fewer markets. That is the
 * same promise the tag chips make, and the opposite would be a search that widens as you get
 * more specific. Order does not matter: "athens farmers" and "farmers athens" find the same
 * market, because a reader typing two words they remember is not composing a phrase.
 *
 * An empty or whitespace-only query is not a filter — it returns the list untouched, the way
 * no selected chips does.
 */
export function searchMarkets(markets: Market[], query: string): Market[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return markets;
  return markets.filter((m) => {
    const haystack = fold(`${m.name} ${m.address}`);
    return terms.every((t) => haystack.includes(t));
  });
}

export function filterByTags(markets: Market[], selected: MarketTag[]): Market[] {
  if (selected.length === 0) return markets;
  return markets.filter((m) => selected.every((t) => m.tags.includes(t)));
}

/**
 * The tags worth offering at all: those at least one market in the whole dataset carries.
 *
 * **Measured against the dataset, never against the current view**, and the difference is the
 * entire point. A tag that is empty *right now* — because of a search, or because another chip
 * is already on — is a fact about where you are, and hiding it makes the row jump under your
 * finger as you select; `TagFilter` disables those instead. A tag no market anywhere carries
 * is a different thing: it is not a filter that happens to match nothing, it is a dead end the
 * vocabulary offers and the data has never had, and it can only ever return an empty list.
 *
 * Order comes from the caller, not from here — `MARKET_TAGS` is the closed vocabulary and
 * `ORDERED_TAGS` is how it is drawn. This answers only "which of them exist".
 */
export function availableTags(markets: Market[], country?: CountryCode): MarketTag[] {
  const present = new Set(markets.flatMap((m) => m.tags));
  // Two reasons a tag is not offered, and they are different questions. *Nothing carries it*
  // is about this dataset and changes as rows arrive. *It does not apply here* is about the
  // reader: SNAP is a US federal programme, so offering it in Manchester is offering a filter
  // that excludes every British market for a reason that is not about British markets.
  return MARKET_TAGS.filter((t) => present.has(t) && (!country || tagAppliesIn(t, country)));
}

/**
 * The list's only ordering, both keys and both directions.
 *
 * `from` picks the key: a point sorts by how far each market is from it, and `null` sorts by
 * name — which is what "alphabetical" *is* here, so the off state needs no second code path
 * and cannot strand a stale order.
 *
 * `descending` flips whichever key is in use, and flips it inside the comparator rather than
 * by reversing the result. Reversing an array also reverses ties, so two markets an equal
 * distance away would swap places purely because the direction changed — a list that
 * reshuffles rows the sort did not distinguish looks broken, and on this dataset ties are
 * name ties, which are the ones a reader is most likely to notice.
 */
export function sortByDistance(
  markets: Market[],
  from: LatLon | null,
  descending = false
): Market[] {
  const direction = descending ? -1 : 1;
  if (!from) return [...markets].sort((a, b) => direction * a.name.localeCompare(b.name));
  return [...markets].sort(
    (a, b) => direction * (haversineKm(from, a) - haversineKm(from, b))
  );
}

const DAY_LABELS: Record<Weekday, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
};

export function formatSchedule(schedule: ScheduleEntry[]): string {
  if (schedule.length === 0) return 'Hours not listed';
  return schedule
    .map((s) => `${DAY_LABELS[s.day]} ${s.open}–${s.close}`)
    .join(' · ');
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatMonthDay(mmdd: string): string {
  const [mm, dd] = mmdd.split('-').map(Number);
  return `${MONTHS[mm - 1]} ${dd}`;
}

export function formatSeason(m: Market): string {
  if (!m.seasonStart || !m.seasonEnd) return 'Open year-round';
  return `In season ${formatMonthDay(m.seasonStart)} – ${formatMonthDay(m.seasonEnd)}`;
}
