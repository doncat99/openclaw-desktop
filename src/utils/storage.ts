const STORAGE_PREFIX = 'ontosynth-';
const LEGACY_STORAGE_PREFIX = 'aegis-';

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function toLegacyKey(key: string): string | null {
  if (!key.startsWith(STORAGE_PREFIX)) return null;
  return `${LEGACY_STORAGE_PREFIX}${key.slice(STORAGE_PREFIX.length)}`;
}

export function storageKey(suffix: string): string {
  const clean = suffix.trim().replace(/^-+/, '');
  return `${STORAGE_PREFIX}${clean}`;
}

export function migrateStorageKey(newKey: string, legacyKey?: string): void {
  const storage = getStorage();
  if (!storage) return;

  try {
    if (storage.getItem(newKey) !== null) return;
    const fallbackKey = legacyKey || toLegacyKey(newKey);
    if (!fallbackKey) return;
    const legacyValue = storage.getItem(fallbackKey);
    if (legacyValue !== null) {
      storage.setItem(newKey, legacyValue);
    }
  } catch {
    // Ignore storage errors.
  }
}

export function getStorageItem(key: string): string | null {
  migrateStorageKey(key);
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function setStorageItem(key: string, value: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Ignore storage errors.
  }
}

export function removeStorageItem(key: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(key);
    const legacyKey = toLegacyKey(key);
    if (legacyKey) storage.removeItem(legacyKey);
  } catch {
    // Ignore storage errors.
  }
}
