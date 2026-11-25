import { describe, expect, it } from 'vitest';
import { hotkeyLabels, isPlainKey, matchesHotkey, parseHotkey, type KeyEventLike } from './hotkey';

const key = (k: string, mods: Partial<Omit<KeyEventLike, 'key'>> = {}): KeyEventLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('parseHotkey', () => {
  it('parses modifiers and aliases', () => {
    expect(parseHotkey('mod+shift+K')).toEqual({ key: 'k', mod: true, ctrl: false, meta: false, alt: false, shift: true });
    expect(parseHotkey('esc').key).toBe('escape');
    expect(parseHotkey('cmd+up')).toMatchObject({ key: 'arrowup', meta: true });
    expect(parseHotkey('+').key).toBe('+');
    expect(parseHotkey('ctrl+plus')).toMatchObject({ key: '+', ctrl: true });
  });
});

describe('matchesHotkey', () => {
  it('maps mod to Cmd on Apple and Ctrl elsewhere', () => {
    const hotkey = parseHotkey('mod+k');
    expect(matchesHotkey(key('k', { metaKey: true }), hotkey, true)).toBe(true);
    expect(matchesHotkey(key('k', { ctrlKey: true }), hotkey, true)).toBe(false);
    expect(matchesHotkey(key('k', { ctrlKey: true }), hotkey, false)).toBe(true);
    expect(matchesHotkey(key('K', { ctrlKey: true }), hotkey, false)).toBe(true);
  });

  it('requires exact modifiers for letters', () => {
    expect(matchesHotkey(key('k', { ctrlKey: true, shiftKey: true }), parseHotkey('mod+k'), false)).toBe(false);
    expect(matchesHotkey(key('k'), parseHotkey('k'), false)).toBe(true);
    expect(matchesHotkey(key('k', { altKey: true }), parseHotkey('k'), false)).toBe(false);
  });

  it('ignores Shift for punctuation typed differently across layouts', () => {
    expect(matchesHotkey(key('?', { shiftKey: true }), parseHotkey('?'), false)).toBe(true);
    expect(matchesHotkey(key('/'), parseHotkey('/'), false)).toBe(true);
  });

  it('never matches an empty key', () => {
    expect(matchesHotkey(key('k'), parseHotkey('mod'), false)).toBe(false);
  });
});

describe('labels', () => {
  it('renders platform key caps', () => {
    expect(hotkeyLabels('mod+k', true)).toEqual(['⌘', 'K']);
    expect(hotkeyLabels('mod+k', false)).toEqual(['Ctrl', 'K']);
    expect(hotkeyLabels('shift+enter', false)).toEqual(['Shift', '↵']);
    expect(hotkeyLabels('alt+pageup', true)).toEqual(['⌥', 'Pageup']);
  });

  it('flags shortcuts that collide with typing', () => {
    expect(isPlainKey(parseHotkey('/'))).toBe(true);
    expect(isPlainKey(parseHotkey('shift+?'))).toBe(true);
    expect(isPlainKey(parseHotkey('mod+k'))).toBe(false);
  });
});
