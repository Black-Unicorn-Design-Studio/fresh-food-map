import Head from 'expo-router/head';
import { Platform } from 'react-native';

/**
 * Sets the HTML document title and description for a route on the web build.
 *
 * `Stack.Screen`'s `title` option names a screen in the navigation chrome; it does
 * not reach the HTML document under static rendering, which is why every exported
 * page shipped with no `<title>` at all — unnamed in the browser tab, in bookmarks,
 * in history, and to a screen reader announcing the page on arrival (WCAG 2.4.2).
 * Expo's static rendering docs name `<Head>` as the mechanism for this.
 *
 * Renders nothing, and nothing at all off the web: `expo-router/head` exists on
 * native to feed iOS handoff and Spotlight, which needs a `headOrigin` (or `origin`)
 * in the `expo-router` config plugin naming the hosted URL. Without one it throws on
 * render — so every screen declaring a title crashed the native app. This app indexes
 * nothing into Spotlight and hands nothing off, so the guard buys back the whole
 * feature rather than configuring an origin that would only exist to be unused.
 * Adding handoff later means setting that origin and dropping this branch.
 */
export function PageTitle({ title, description }: { title: string; description: string }) {
  if (Platform.OS !== 'web') {
    return null;
  }
  return (
    <Head>
      <title>{title}</title>
      <meta name="description" content={description} />
    </Head>
  );
}
