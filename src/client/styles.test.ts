import { describe, expect, it } from 'vitest';

// The client tsconfig is browser-only (no Node types) and Vitest blanks CSS imports, so the
// stylesheet is read through Node's fs behind an untyped specifier.
const fsSpecifier = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ fsSpecifier)) as { readFileSync: (path: URL, encoding: 'utf8') => string };
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** The `--name: #hex;` declarations between `/* tokens:<block> *\/` and the next `/* end tokens *\/`. */
function tokenBlock(name: string): Record<string, string> {
  const start = css.indexOf(`/* tokens:${name} */`);
  if (start < 0) throw new Error(`token block ${name} not found`);
  const end = css.indexOf('/* end tokens */', start);
  const tokens: Record<string, string> = {};
  for (const match of css.slice(start, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    tokens[match[1] as string] = (match[2] as string).trim();
  }
  return tokens;
}

function luminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [value >> 16, (value >> 8) & 255, value & 255].map((channel) => {
    const srgb = channel / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] as number) + 0.7152 * (channels[1] as number) + 0.0722 * (channels[2] as number);
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

// [foreground, background, minimum]: 4.5 for text (WCAG AA), 3 for focus rings and control boundaries.
const PAIRS: Array<[string, string, number]> = [
  ...['surface', 'canvas', 'surface-2', 'surface-3'].flatMap((bg): Array<[string, string, number]> => [
    ['fg', bg, 4.5],
    ['muted', bg, 4.5],
  ]),
  ['subtle', 'surface', 4.5],
  ['subtle', 'canvas', 4.5],
  ['subtle', 'surface-2', 4.5],
  ['on-primary', 'primary', 4.5],
  ['on-primary', 'primary-hover', 4.5],
  ['primary-fg', 'surface', 4.5],
  ['primary-fg', 'canvas', 4.5],
  ['primary-fg', 'primary-soft', 4.5],
  ['on-accent', 'accent', 4.5],
  ['accent-fg', 'accent-soft', 4.5],
  ['accent-fg', 'surface', 4.5],
  ...(['success', 'warning', 'danger', 'info'] as const).flatMap((tone): Array<[string, string, number]> => [
    [tone, `${tone}-soft`, 4.5],
    [tone, 'surface', 4.5],
    [tone, 'canvas', 4.5],
  ]),
  ['on-danger', 'danger-solid', 4.5],
  ['on-tooltip', 'tooltip', 4.5],
  ['focus', 'surface', 3],
  ['focus', 'canvas', 3],
  ['border-control', 'surface', 3],
  ['border-control', 'canvas', 3],
];

describe('design tokens', () => {
  const light = tokenBlock('light');
  const dark = tokenBlock('dark');
  const darkSystem = tokenBlock('dark-system');

  it('defines the same tokens in every theme', () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it('keeps the explicit dark theme and the system-preference dark theme identical', () => {
    expect(darkSystem).toEqual(dark);
  });

  it.each([
    ['light', light],
    ['dark', dark],
  ] as const)('meets WCAG AA contrast in the %s theme', (_name, tokens) => {
    const failures = PAIRS.filter(([fg, bg, min]) => {
      const a = tokens[fg];
      const b = tokens[bg];
      if (!a?.startsWith('#') || !b?.startsWith('#')) throw new Error(`missing hex token ${fg} or ${bg}`);
      return contrast(a, b) < min;
    }).map(([fg, bg, min]) => `${fg} on ${bg}: ${contrast(tokens[fg] as string, tokens[bg] as string).toFixed(2)} < ${min}`);
    expect(failures).toEqual([]);
  });
});
