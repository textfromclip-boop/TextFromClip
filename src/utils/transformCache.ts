// Lightweight, deterministic in-memory cache for AI transformations and translations.
// Scoped per session/component instance (no cross-user or cross-session persistence).

export type CacheCategory = 'transform' | 'translate';

/**
 * Deterministic 32-bit FNV-1a hash for fast transcript content fingerprinting.
 */
export function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Builds a compact scope key that uniquely distinguishes different providers, video IDs,
 * and materially edited transcript text.
 */
export function buildTranscriptScopeKey(
  provider: string,
  videoId: string,
  fullText: string
): string {
  const normalized = fullText.trim();
  return `${provider || 'unknown'}:${videoId || 'unknown'}:${normalized.length}:${fnv1aHash(normalized)}`;
}

export interface ScopedResultCache {
  get(scopeKey: string, category: CacheCategory, subKey: string): string | undefined;
  set(scopeKey: string, category: CacheCategory, subKey: string, value: string): boolean;
  clear(): void;
  size(): number;
}

export function createScopedResultCache(maxEntries = 30): ScopedResultCache {
  const store = new Map<string, string>();

  const makeKey = (scopeKey: string, category: CacheCategory, subKey: string) =>
    `${scopeKey}::${category}::${subKey.trim().toLowerCase()}`;

  return {
    get(scopeKey, category, subKey) {
      if (!scopeKey || !subKey) return undefined;
      return store.get(makeKey(scopeKey, category, subKey));
    },

    set(scopeKey, category, subKey, value) {
      // Never cache failed, empty, or whitespace-only outputs
      if (!scopeKey || !subKey || typeof value !== 'string' || value.trim().length === 0) {
        return false;
      }
      const key = makeKey(scopeKey, category, subKey);
      if (store.has(key)) {
        store.delete(key);
      } else if (store.size >= maxEntries) {
        const oldestKey = store.keys().next().value;
        if (oldestKey !== undefined) {
          store.delete(oldestKey);
        }
      }
      store.set(key, value);
      return true;
    },

    clear() {
      store.clear();
    },

    size() {
      return store.size;
    },
  };
}

