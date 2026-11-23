/**
 * App Proxy の在庫取得で inventoryLevels を 250 件ずつ次のページまで読む。
 *
 * - 1 ページ目は在庫と設定（メタフィールド）をまとめた既存のクエリで読む（呼び出し側）。
 * - hasNextPage のときだけ、endCursor から続きを読む。
 * - 途中のページで失敗したときは、一部だけの在庫を返さず失敗として返す
 *   （店舗が黙って欠けた一覧を出さないため）。
 * - 読むページ数には上限がある（MAX_INVENTORY_LEVEL_PAGES）。上限で止めたときは
 *   truncated: true を返し、呼び出し側でログと応答の印にする。
 */

/** 1 ページの件数（Admin API の connection の上限） */
export const INVENTORY_LEVELS_PAGE_SIZE = 250;

/** 読むページ数の上限（1 ページ目を含む）。250 × 4 = 1,000 ロケーション */
export const MAX_INVENTORY_LEVEL_PAGES = 4;

export const INVENTORY_LEVELS_PAGE_QUERY = `#graphql
  query VariantInventoryLevelsPage($id: ID!, $after: String!) {
    productVariant(id: $id) {
      id
      inventoryItem {
        id
        inventoryLevels(first: ${INVENTORY_LEVELS_PAGE_SIZE}, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              location {
                id
                name
                fulfillsOnlineOrders
                localPickupSettingsV2 {
                  pickupTime
                }
                address {
                  city
                  provinceCode
                  countryCode
                  latitude
                  longitude
                }
              }
              quantities(names: "available") {
                name
                quantity
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * @typedef {{ edges?: Array<object>, pageInfo?: { hasNextPage?: boolean, endCursor?: string|null } } | null | undefined} LevelsConnection
 *
 * @typedef {(
 *   | { ok: true, connection: LevelsConnection }
 *   | { ok: false, reason: string, detail?: unknown }
 * )} PageFetchResult
 */

/**
 * 1 ページ目の connection から、必要なら続きのページを読み、edges をつなげて返す。
 *
 * @param {LevelsConnection} firstConnection 1 ページ目の inventoryLevels
 * @param {(after: string) => Promise<PageFetchResult>} fetchPage 続きの 1 ページを読む関数
 * @param {{ maxPages?: number }} [options]
 * @returns {Promise<
 *   | { ok: true, edges: Array<object>, pages: number, truncated: boolean }
 *   | { ok: false, reason: string, detail?: unknown, pages: number }
 * >}
 */
export async function collectInventoryLevelEdges(firstConnection, fetchPage, options = {}) {
  const maxPages = Math.max(1, options.maxPages ?? MAX_INVENTORY_LEVEL_PAGES);
  const edges = [...(firstConnection?.edges ?? [])];
  let pageInfo = firstConnection?.pageInfo;
  let pages = 1;

  while (pageInfo?.hasNextPage) {
    const after = pageInfo.endCursor;
    if (typeof after !== "string" || after === "") {
      // 次があるのにカーソルが無い: 続きを読めないので黙って欠けさせない
      return { ok: false, reason: "missing_cursor", pages };
    }
    if (pages >= maxPages) {
      return { ok: true, edges, pages, truncated: true };
    }
    const next = await fetchPage(after);
    pages += 1;
    if (!next.ok) {
      return { ok: false, reason: next.reason, detail: next.detail, pages };
    }
    edges.push(...(next.connection?.edges ?? []));
    pageInfo = next.connection?.pageInfo;
  }

  return { ok: true, edges, pages, truncated: false };
}
