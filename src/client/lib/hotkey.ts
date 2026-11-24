/** Parsing and matching of keyboard shortcuts such as "mod+k", "/", "shift+enter". Pure; used by useHotkey and Kbd. */

export interface Hotkey {
  /** Lower-case `KeyboardEvent.key` value ("k", "/", "enter", "arrowdown"). */
  key: string;
  /** "mod": ⌘ on Apple platforms, Ctrl everywhere else. */
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  del: 'delete',
  plus: '+',
};

/** "mod+shift+k" -> { key: 'k', mod: true, shift: true, … }. A lone "+" is the plus key. */
export function parseHotkey(combo: string): Hotkey {
  const hotkey: Hotkey = { key: '', mod: false, ctrl: false, meta: false, alt: false, shift: false };
  const parts = combo.trim() === '+' ? ['+'] : combo.toLowerCase().split('+').map((part) => part.trim());
  for (const part of parts) {
    if (part === 'mod') hotkey.mod = true;
    else if (part === 'ctrl' || part === 'control') hotkey.ctrl = true;
    else if (part === 'meta' || part === 'cmd' || part === 'command') hotkey.meta = true;
    else if (part === 'alt' || part === 'option') hotkey.alt = true;
    else if (part === 'shift') hotkey.shift = true;
    else if (part !== '') hotkey.key = KEY_ALIASES[part] ?? part;
  }
  return hotkey;
}

export function matchesHotkey(event: KeyEventLike, hotkey: Hotkey, isApple: boolean): boolean {
  if (hotkey.key === '' || event.key.toLowerCase() !== hotkey.key) return false;
  const wantCtrl = hotkey.ctrl || (hotkey.mod && !isApple);
  const wantMeta = hotkey.meta || (hotkey.mod && isApple);
  if (event.ctrlKey !== wantCtrl || event.metaKey !== wantMeta || event.altKey !== hotkey.alt) return false;
  // Punctuation such as "?" is typed with Shift on some layouts and without on others, so Shift
  // is only compared for letters, digits and named keys.
  const shiftMatters = hotkey.shift || /^[a-z0-9]$/.test(hotkey.key) || hotkey.key.length > 1;
  return !shiftMatters || event.shiftKey === hotkey.shift;
}

/** True when the shortcut has no Ctrl/⌘/Alt part and would therefore collide with typing. */
export function isPlainKey(hotkey: Hotkey): boolean {
  return !hotkey.mod && !hotkey.ctrl && !hotkey.meta && !hotkey.alt;
}

const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  enter: '↵',
  ' ': 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  backspace: '⌫',
  delete: 'Del',
  tab: 'Tab',
};

/** Key caps for display: "mod+k" -> ["⌘", "K"] on Apple platforms, ["Ctrl", "K"] elsewhere. */
export function hotkeyLabels(combo: string, isApple: boolean): string[] {
  const hotkey = parseHotkey(combo);
  const labels: string[] = [];
  if (hotkey.ctrl || (hotkey.mod && !isApple)) labels.push('Ctrl');
  if (hotkey.meta || (hotkey.mod && isApple)) labels.push('⌘');
  if (hotkey.alt) labels.push(isApple ? '⌥' : 'Alt');
  if (hotkey.shift) labels.push(isApple ? '⇧' : 'Shift');
  if (hotkey.key !== '') {
    labels.push(KEY_LABELS[hotkey.key] ?? (hotkey.key.length === 1 ? hotkey.key.toUpperCase() : capitalise(hotkey.key)));
  }
  return labels;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}
