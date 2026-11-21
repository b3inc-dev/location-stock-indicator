/** テーマ拡張のブロックの handle（extensions/location-stock-theme/blocks/ のファイル名） */
const THEME_APP_BLOCK_HANDLE = "location-stock-indicator";

/**
 * 商品ページのテンプレートにブロックを足した状態でテーマエディタを開く URL（App Store 要件 5.1.3）。
 * 形は shopify.dev の theme app extensions「Deep linking」: addAppBlockId={api_key}/{handle}。
 * api_key は toml の client_id と同じ値（SHOPIFY_API_KEY）。公開用と自社用で Render の値が違うので、そのまま両方で使える。
 */
export function buildThemeAppBlockDeepLink(shop, apiKey) {
  const shopDomain = String(shop || "").trim();
  const key = String(apiKey || "").trim();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain) || !key) return null;
  const params = new URLSearchParams({
    template: "product",
    addAppBlockId: `${key}/${THEME_APP_BLOCK_HANDLE}`,
    target: "newAppsSection",
  });
  return `https://${shopDomain}/admin/themes/current/editor?${params.toString()}`;
}
