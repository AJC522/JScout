import { Monitor, Moon, Sun } from 'lucide-react';
import type { ThemePreference } from '../../../shared/types';
import { useTheme } from '../../app/theme';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../ui/DropdownMenu';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Light / dark / system switch. "segmented" for the full sidebar, "menu" (one icon button) for the rail. */
export function ThemeToggle({ variant = 'segmented' }: { variant?: 'segmented' | 'menu' }) {
  const { theme, resolvedTheme, setTheme } = useTheme();

  if (variant === 'segmented') {
    return (
      <SegmentedControl
        aria-label="Theme"
        size="sm"
        value={theme}
        onValueChange={setTheme}
        options={OPTIONS.map(({ value, label, icon: Icon }) => ({ value, label, icon: <Icon aria-hidden="true" />, iconOnly: true }))}
      />
    );
  }

  const CurrentIcon = resolvedTheme === 'dark' ? Moon : Sun;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Theme" tooltipSide="right" icon={<CurrentIcon />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(next) => setTheme(next as ThemePreference)}>
          {OPTIONS.map(({ value, label }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
