import { describe, expect, it } from 'vitest';
import { cursorReducer, initialCursor } from './selection';

const ids = ['a', 'b', 'c'];

describe('keyboard cursor', () => {
  it('starts at the top from nowhere, in either direction', () => {
    expect(cursorReducer(initialCursor, { type: 'move', delta: 1, ids })).toEqual({ id: 'a' });
    expect(cursorReducer(initialCursor, { type: 'move', delta: -1, ids })).toEqual({ id: 'a' });
  });

  it('moves and stops at the ends without changing identity', () => {
    const atB = cursorReducer({ id: 'a' }, { type: 'move', delta: 1, ids });
    expect(atB).toEqual({ id: 'b' });
    expect(cursorReducer(atB, { type: 'move', delta: -1, ids })).toEqual({ id: 'a' });
    const end = { id: 'c' };
    expect(cursorReducer(end, { type: 'move', delta: 1, ids })).toBe(end);
  });

  it('clears on an empty list', () => {
    expect(cursorReducer({ id: 'a' }, { type: 'move', delta: 1, ids: [] })).toEqual({ id: null });
  });

  it('restarts at the top when the cursor job is no longer listed', () => {
    expect(cursorReducer({ id: 'zz' }, { type: 'move', delta: 1, ids })).toEqual({ id: 'a' });
  });

  it('sets directly', () => {
    const state = { id: 'b' };
    expect(cursorReducer(state, { type: 'set', id: 'b' })).toBe(state);
    expect(cursorReducer(state, { type: 'set', id: null })).toEqual({ id: null });
  });

  it('follows the next job when the one under the cursor is hidden', () => {
    expect(cursorReducer({ id: 'b' }, { type: 'sync', ids: ['a', 'c'], previousIds: ids })).toEqual({ id: 'c' });
    expect(cursorReducer({ id: 'c' }, { type: 'sync', ids: ['a', 'b'], previousIds: ids })).toEqual({ id: 'b' });
    const kept = { id: 'a' };
    expect(cursorReducer(kept, { type: 'sync', ids: ['a', 'b', 'c', 'd'], previousIds: ids })).toBe(kept);
    expect(cursorReducer({ id: 'a' }, { type: 'sync', ids: [], previousIds: ids })).toEqual({ id: null });
  });
});
