import { ScrollView, StyleSheet, View } from 'react-native';

import { ExternalLink } from '@/components/external-link';
import { PageTitle } from '@/components/page-title';
import { ThemedText } from '@/components/themed-text';
import { sourcePath } from '@/constants/source';
import { Display, MaxContentWidth, Spacing } from '@/constants/theme';
import { useFocusHeading } from '@/hooks/use-focus-heading';
import { useTheme } from '@/hooks/use-theme';

/**
 * The privacy policy, as a screen of the app rather than a page somewhere else.
 *
 * App Store Connect requires a policy URL for every app, and review guideline 5.1.1 wants it
 * reachable inside the app too. A route answers both: the static export emits `privacy.html`,
 * so `freshfoodmap.app/privacy` resolves (through the apex's 308 to staging, for now), and the
 * same words are a press away on a phone with no network.
 *
 * **Every sentence here is a claim about the code, and has to stay one.** It was written
 * against what the app and the intake service actually do — TRD §7 and PRD §6 are the long
 * form — including the parts that are less flattering than "we collect nothing": a submission's
 * hashed IP stays beside it in the queue, and the address lookups reach a third party. A change
 * that makes a line here false changes this screen in the same pull request. That is the same
 * rule `app.json`'s location string is held to, and for the same reason: it is a promise made
 * to someone deciding whether to trust the app.
 */
const UPDATED = '20 October 2026';

const SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: 'The short version',
    body: [
      'Fresh Food Map has no accounts, no analytics, no advertising and no tracking. It does not know who you are, and nothing it sends carries an identifier for you or your device — there is none to send.',
    ],
  },
  {
    heading: 'Your location',
    body: [
      'If you allow it, the app uses your location to show markets near you and sort them by distance. That happens on your device. Your position is not sent anywhere for it.',
      'There is one exception, and it only happens when you press it: “Use my current location” on the submit form sends your coordinates to OpenStreetMap’s address service (Nominatim) to find the street address of the market you are adding.',
    ],
  },
  {
    heading: 'Address and place searches',
    body: [
      'When you press “Find it from the address” on the submit form, or search for a place to sort markets from, what you typed is sent to Nominatim, run by the OpenStreetMap Foundation, to turn it into coordinates. A place you search for may be your own address, so only search for what you are comfortable sending. While the app is open, answers are kept in memory so the same question is not sent twice; they are gone when it closes.',
    ],
  },
  {
    heading: 'The map and the market list',
    body: [
      'Map images come from OpenFreeMap, and the latest market list is downloaded from freshfoodmap.app. Like any web request, these reach their servers with your IP address and, for the map, the area you are looking at. Our web server records addresses shortened so they cannot identify a device or a household.',
    ],
  },
  {
    heading: 'Submitting a market',
    body: [
      'Everything you type into the submit form is published. A person reviews each submission as a public pull request on GitHub before it is added, so please leave out personal details — the note field especially is quoted as written.',
      'To limit spam, the submission service keeps a salted hash of your IP address rather than the address itself. It is used to count submissions per hour and per day, and that count is deleted after a day. The same hash is stored with your submission while it waits in the queue, and is deleted once the submission has been turned into a pull request.',
    ],
  },
  {
    heading: 'Reporting a listing',
    body: [
      '“Flag or update this listing” opens a GitHub issue. That happens on GitHub, under your GitHub account and GitHub’s own privacy policy.',
    ],
  },
  {
    heading: 'Stored on your device',
    body: [
      'Your country and appearance settings. Nothing else. Deleting the app deletes them.',
    ],
  },
  {
    heading: 'Children',
    body: [
      'The app collects nothing about anyone, children included, and has nothing to sign up for.',
    ],
  },
  {
    heading: 'Changes and questions',
    body: [
      'This policy lives in the app’s public source code, so every change to it is recorded with a date. Questions go to the project’s issue tracker.',
    ],
  },
];

export default function PrivacyScreen() {
  const theme = useTheme();
  const headingRef = useFocusHeading();

  return (
    <ScrollView
      role="main"
      style={{ backgroundColor: theme.background }}
      contentContainerStyle={styles.content}>
      <PageTitle
        title="Privacy — Fresh Food Map"
        description="What Fresh Food Map does with your location, your searches and your submissions."
      />

      <View style={styles.header}>
        <ThemedText
          ref={headingRef}
          tabIndex={-1}
          style={styles.title}
          accessibilityRole="header"
          // 2, not 1: on the web the navigation bar's title is already the page's level-1
          // heading, which is why the market screen's name is a 2 as well.
          aria-level={2}>
          Privacy
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Last updated {UPDATED}
        </ThemedText>
      </View>

      {SECTIONS.map((section) => (
        <View key={section.heading} style={styles.section}>
          <ThemedText type="smallBold" accessibilityRole="header" aria-level={3}>
            {section.heading}
          </ThemedText>
          {section.body.map((paragraph) => (
            <ThemedText key={paragraph} style={styles.paragraph}>
              {paragraph}
            </ThemedText>
          ))}
        </View>
      ))}

      <View style={styles.links}>
        <ExternalLink url={sourcePath('issues')} label="Ask a question" />
        <ExternalLink
          url={sourcePath('commits/main/src/app/privacy.tsx')}
          label="History of this policy"
        />
        <ExternalLink
          url="https://osmfoundation.org/wiki/Privacy_Policy"
          label="OpenStreetMap Foundation privacy policy"
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: MaxContentWidth,
    padding: Spacing.three,
    paddingBottom: Spacing.five,
    gap: Spacing.four,
  },
  header: { gap: Spacing.one },
  title: {
    fontFamily: Display.black,
    fontSize: 36,
    lineHeight: 42,
  },
  section: { gap: Spacing.two },
  paragraph: { fontSize: 15, lineHeight: 23 },
  links: { gap: Spacing.two },
});
