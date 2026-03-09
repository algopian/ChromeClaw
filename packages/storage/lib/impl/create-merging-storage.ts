import type { BaseStorageType, ValueOrUpdateType } from '../base/types.js';

/**
 * Wraps a raw storage instance so that `get()` deep-merges defaults with stored
 * values. This ensures that keys added in newer code versions are present even
 * when the persisted object predates them.
 *
 * @param rawStorage - The underlying chrome storage handle.
 * @param defaults   - Full default config object.
 * @param nestedKeys - Top-level keys whose values are objects that should also
 *                     be merged with their respective defaults (one level deep).
 */
const createMergingStorage = <T>(
  rawStorage: BaseStorageType<T>,
  defaults: T,
  nestedKeys?: (keyof T)[],
): BaseStorageType<T> => ({
  get: async (): Promise<T> => {
    const stored = await rawStorage.get();
    const merged = { ...defaults, ...stored } as T;
    if (nestedKeys) {
      for (const key of nestedKeys) {
        (merged as Record<string, unknown>)[key as string] = {
          ...(defaults[key] as Record<string, unknown>),
          ...((stored[key] ?? {}) as Record<string, unknown>),
        };
      }
    }
    return merged;
  },
  set: (value: ValueOrUpdateType<T>) => rawStorage.set(value),
  getSnapshot: () => rawStorage.getSnapshot(),
  subscribe: (listener: () => void) => rawStorage.subscribe(listener),
});

export { createMergingStorage };
