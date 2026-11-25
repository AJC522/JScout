/**
 * Keyboard cursor over the result list (j/k and the arrow keys). The cursor is a job id rather
 * than an index so it stays on the same job when more pages load or a job above it is hidden.
 */
export interface CursorState {
  id: string | null;
}

export type CursorAction =
  | { type: 'move'; delta: 1 | -1; ids: readonly string[] }
  | { type: 'set'; id: string | null }
  /** The list changed (new search, a job hidden): keep the cursor near where it was. */
  | { type: 'sync'; ids: readonly string[]; previousIds: readonly string[] };

export const initialCursor: CursorState = { id: null };

export function cursorReducer(state: CursorState, action: CursorAction): CursorState {
  switch (action.type) {
    case 'set':
      return state.id === action.id ? state : { id: action.id };
    case 'move': {
      const { ids, delta } = action;
      if (ids.length === 0) return state.id === null ? state : { id: null };
      const index = state.id === null ? -1 : ids.indexOf(state.id);
      // From nowhere, j starts at the top and k does too: the top is where the user is looking.
      if (index === -1) return { id: ids[0] ?? null };
      const next = Math.min(ids.length - 1, Math.max(0, index + delta));
      return next === index ? state : { id: ids[next] ?? null };
    }
    case 'sync': {
      if (state.id === null || action.ids.includes(state.id)) return state;
      // The job under the cursor went away: move to the job that took its place, or the new last one.
      const oldIndex = action.previousIds.indexOf(state.id);
      if (oldIndex === -1 || action.ids.length === 0) return { id: null };
      for (let i = oldIndex + 1; i < action.previousIds.length; i++) {
        const candidate = action.previousIds[i];
        if (candidate !== undefined && action.ids.includes(candidate)) return { id: candidate };
      }
      return { id: action.ids[Math.min(oldIndex, action.ids.length - 1)] ?? null };
    }
  }
}
