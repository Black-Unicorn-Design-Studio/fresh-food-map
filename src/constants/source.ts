/**
 * Where this build's source lives, and the one thing the app builds out of it.
 *
 * A fork MUST point `EXPO_PUBLIC_SOURCE_URL` at its own repository: AGPL §6(d) requires
 * directions to the Corresponding Source next to the object code, and "the upstream project's
 * GitHub" is not the source of a modified build. `Attribution` is the licence obligation;
 * `reportUrl` below is a second, unrelated use of the same fact — where a reader goes to say a
 * listing is wrong.
 */
export const SOURCE_URL =
  process.env.EXPO_PUBLIC_SOURCE_URL ?? 'https://github.com/Black-Unicorn-Design-Studio/fresh-food-map';

/**
 * A prefilled issue against the dataset, for a market whose details are wrong.
 *
 * **Why an issue and not a form.** There is no account system and no correction endpoint: the
 * intake service takes whole markets, and a correction naming an existing one is a
 * same-name-within-100m duplicate, which intake treats as a hard fail and drops in silence. A
 * report routed that way would vanish, deliberately, and the reporter would be told "received"
 * — the worst outcome this codebase has a word for. An issue lands somewhere a person reads,
 * which is the same answer the Submit tab gives when no intake service is configured, and it
 * needs nothing running.
 *
 * The cost is stated rather than hidden: it wants a GitHub account. That is why this is a
 * quiet link at the foot of the screen and not a button competing with `GET DIRECTIONS`.
 *
 * The id is in the body because it is what a maintainer greps `data/markets.json` for; the
 * name is in the title because it is what a human reads in a list of issues. `ExternalLink`
 * refuses anything that is not http(s), so a `EXPO_PUBLIC_SOURCE_URL` pointing somewhere
 * strange renders no link rather than an unsafe one.
 */
/**
 * A path inside the source repository — its issues, a file's history.
 *
 * The one place the trailing-slash guard lives: `EXPO_PUBLIC_SOURCE_URL` is typed by a person
 * into an env file, a trailing slash is the usual way that goes, and `…/repo//issues` is a 404
 * rather than an error anybody would see before shipping.
 */
export function sourcePath(path: string, base: string = SOURCE_URL): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * The issue endpoint for a repository URL.
 *
 * Separate from `reportUrl` so the trailing-slash guard is testable without reaching into the
 * environment (see `sourcePath`).
 */
export function issuesEndpoint(base: string = SOURCE_URL): string {
  return sourcePath('issues/new', base);
}

export function reportUrl(market: { id: string; name: string }): string {
  const title = `Correction: ${market.name}`;
  const body = [
    `Market: ${market.name}`,
    `Id: ${market.id}`,
    '',
    'What is wrong (hours, address, season, website, tags, or the market has closed):',
    '',
    '',
    'How you know:',
    '',
  ].join('\n');
  return `${issuesEndpoint()}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
