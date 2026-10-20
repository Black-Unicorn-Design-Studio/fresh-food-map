import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSettings } from '@/hooks/use-settings';

/**
 * Which palette to draw in: the reader's choice, or the device's if they have not made one.
 *
 * **Three states rather than a toggle**, and `system` is the default. A two-state switch has
 * no way to say "follow the phone", so the first press of one is a permanent opt-out of a
 * setting the reader may only have wanted to change for an evening — and a phone that switches
 * at sunset then stops, with nothing on screen explaining why.
 *
 * `unspecified` is the device declining to answer, which react-native reports on platforms
 * with no system preference. It reads as light, which is what it reads as everywhere else.
 */
export function useResolvedScheme(): 'light' | 'dark' {
  const { theme } = useSettings();
  const device = useColorScheme();
  if (theme === 'light' || theme === 'dark') return theme;
  return device === 'dark' ? 'dark' : 'light';
}

export function useTheme() {
  return Colors[useResolvedScheme()];
}
