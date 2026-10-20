import { Linking, Platform, Pressable } from 'react-native';

import { ThemedText } from '@/components/themed-text';

/**
 * A link that is actually a link.
 *
 * `accessibilityRole="link"` is not in react-native-web's `roleComponents` map — only
 * `button` becomes a real element — so it rendered `<div role="link" tabindex="0">`.
 * Enter activated it and screen readers announced it, but with no `href` there was no
 * middle-click, no cmd/ctrl-click, no "copy link address" and no status-bar preview.
 * Passing `href` makes View render a genuine `<a>`.
 *
 * Two things here are load-bearing rather than tidiness:
 *
 * `onPress` is undefined on web. RNW's press responder calls `onPress` on every click
 * without preventing the default, so `href` plus `onPress` would navigate the current tab
 * *and* open a second one.
 *
 * The scheme check is a security boundary, not validation theatre. One caller takes its
 * URL from `EXPO_PUBLIC_SOURCE_URL` and another from the dataset, and an arbitrary string
 * reaches a live sink on both platforms: `javascript:` becomes executable once promoted
 * into an `href`, and `Linking.openURL` does *not* refuse unknown schemes — it asks the OS
 * to dispatch them, so `tel:`, `sms:` or `intent://` is a one-tap app launch. Hence the
 * check gates the whole component rather than just the `href`; returning null is what makes
 * it cover native too. (The market detail screen gated only `href` and had exactly that
 * hole.)
 *
 * Underlined because link identity otherwise rested entirely on hue, at 1.08:1 against
 * the text beside it — WCAG 1.4.1, which colour alone cannot satisfy.
 */
export function ExternalLink({
  url,
  label,
  themeColor = 'link',
}: {
  url: string;
  label: string;
  themeColor?: 'link' | 'textSecondary';
}) {
  const safe = /^https?:\/\//i.test(url);
  if (!safe) return null;

  return (
    <Pressable
      accessibilityRole="link"
      // Spoken, not shown: the visible label stays short, and a screen reader still gets
      // the warning that activating this leaves the page.
      accessibilityLabel={`${label} (opens in a new tab)`}
      // Cast because href/hrefAttrs are absent from React Native's Pressable types;
      // react-native-web forwards both to the DOM, and native ignores them.
      {...({ href: url, hrefAttrs: { target: '_blank', rel: 'noreferrer noopener' } } as object)}
      onPress={Platform.OS === 'web' ? undefined : () => Linking.openURL(url)}>
      <ThemedText type="small" themeColor={themeColor} style={{ textDecorationLine: 'underline' }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}
