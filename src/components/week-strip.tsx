import { StyleSheet, Text, View } from 'react-native';

import { Radii, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WEEKDAYS, type ScheduleEntry, type Weekday } from '@/lib/markets';

const LETTERS: Record<Weekday, string> = {
  mon: 'M', tue: 'T', wed: 'W', thu: 'T', fri: 'F', sat: 'S', sun: 'S',
};

const NAMES: Record<Weekday, string> = {
  mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
  fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
};

/**
 * The week at a glance: seven letters, market days inked in.
 *
 * Screen readers get the day names instead of the letters — which required a role. On web
 * `accessible` is dropped entirely and a role-less View is role=generic, where an author
 * name is prohibited, so this announced seven bare letters and discarded the label.
 * `image` maps to role="img", which is nameable and children-presentational.
 */
export function WeekStrip({
  schedule,
  size = 22,
}: {
  schedule: ScheduleEntry[];
  size?: number;
}) {
  const theme = useTheme();
  const openDays = new Set(schedule.map((s) => s.day));
  // Ordered by the week rather than by the order the schedule lists days in, and
  // spoken as names: a market listing Sunday first announced "Open sun, mon".
  const label =
    openDays.size === 0
      ? 'Market days not listed'
      : `Open ${WEEKDAYS.filter((d) => openDays.has(d)).map((d) => NAMES[d]).join(', ')}`;

  return (
    <View style={styles.row} accessibilityLabel={label} accessible accessibilityRole="image">
      {WEEKDAYS.map((day) => {
        const open = openDays.has(day);
        return (
          <View
            key={day}
            style={[
              styles.day,
              {
                width: size,
                height: size,
                borderRadius: Radii.pill,
                backgroundColor: open ? theme.tint : 'transparent',
                borderColor: open ? theme.tint : theme.border,
              },
            ]}>
            <Text
              style={[
                styles.letter,
                { fontSize: size * 0.5, color: open ? theme.background : theme.textSecondary },
              ]}>
              {LETTERS[day]}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.one + Spacing.half },
  day: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: { fontWeight: '700' },
});
