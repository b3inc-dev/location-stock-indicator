/**
 * プロセス内の短命キャッシュ（単一インスタンス前提）。
 * App Proxy の deliveryProfiles / shop config 向け。秘密は載せない。
 */

/** @type {Map<string, { expiresAt: number, value: unknown }>} */
const store = new Map();

/**
 * @param {string} key
 * @returns {unknown|undefined}
 */
export function cacheGet(key) {
  const row = store.get(key);
  if (!row) return undefined;
  if (Date.now() > row.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return row.value;
}

/**
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlMs
 */
export function cacheSet(key, value, ttlMs) {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

/** テスト用 */
export function cacheClear() {
  store.clear();
}
