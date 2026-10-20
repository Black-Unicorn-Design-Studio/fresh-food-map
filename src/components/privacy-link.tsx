import { Link } from 'expo-router';

import { ThemedText } from '@/components/themed-text';

/**
 * The way into the privacy policy, from wherever the app offers one.
 *
 * One component for both callers so the two cannot drift apart: the list's credit line, which
 * anyone can read without pressing anything, and the settings dialog, which is where an "about
 * this app" link is usually looked for. Review guideline 5.1.1 wants the policy reachable in the
 * app, not only from the App Store page.
 *
 * `Link` rather than `ExternalLink`, because this is a route of the app. On the web it renders
 * a real `<a href="/privacy">`, with middle-click and "copy link address", which the external
 * one goes to some trouble to get. Underlined for the same reason `ExternalLink` is: link
 * identity must not rest on hue alone (WCAG 1.4.1).
 *
 * `onNavigate` exists for the settings dialog. A react-native `Modal` stays on top of whatever
 * the stack pushes underneath it, so a link pressed inside one would open the policy behind a
 * dialog that is still up. The caller closes itself first.
 */
export function PrivacyLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href="/privacy" onPress={onNavigate} accessibilityRole="link">
      <ThemedText type="small" themeColor="link" style={{ textDecorationLine: 'underline' }}>
        Privacy policy
      </ThemedText>
    </Link>
  );
}
