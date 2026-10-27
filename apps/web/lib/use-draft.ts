import { useCallback, useSyncExternalStore } from 'react';
import { EMPTY_DRAFT, draftReducer, type Draft, type DraftAction } from '@/lib/draft';
import { STORAGE_KEYS, getDefaultStore, useStoredState } from '@/lib/storage';
import { parseDraft } from '@/lib/stored-schemas';

const NO_DRAFT: Draft | null = null;
const NOOP_SUBSCRIBE = () => () => {};

/** False during the server render and the hydration render, true afterwards. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    NOOP_SUBSCRIBE,
    () => true,
    () => false,
  );
}

/**
 * The saved quotation draft plus a reducer-style dispatch. Each dispatch reduces from the newest
 * stored value (not a render-time snapshot), so two quick events in a row cannot overwrite each other.
 */
export function useDraft(): {
  draft: Draft | null;
  dispatch: (action: DraftAction) => void;
  persistent: boolean;
  writeFailed: boolean;
} {
  const [draft, setDraft, { persistent, writeFailed }] = useStoredState<Draft | null>(
    STORAGE_KEYS.draft,
    NO_DRAFT,
    parseDraft,
  );

  const dispatch = useCallback(
    (action: DraftAction) => {
      const current = parseDraft(getDefaultStore().get<unknown>(STORAGE_KEYS.draft));
      // A new match starts from scratch; every other action edits an existing draft.
      const base = action.type === 'loadMatch' ? EMPTY_DRAFT : current;
      if (base === null) return;
      const next = draftReducer(base, action);
      if (next !== current) setDraft(next);
    },
    [setDraft],
  );

  return { draft, dispatch, persistent, writeFailed };
}
