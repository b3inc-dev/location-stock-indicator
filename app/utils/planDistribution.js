/**
 * 「このサーバー・この店は自社用（inhouse）か公開用（public）か」を決める、ただ 1 つの決まり（純関数）。
 * POS Stock（b3inc-dev/stock-transfer-pos）の app/utils/plan-distribution.ts と同じ順番で見る。
 *
 * 上から順に見て、最初に当たったもので決める。
 * 1. SHOPIFY_API_KEY が自社用アプリの client_id（shopify.app.toml）と同じ → 自社用（Ciara を止めない）
 * 2. APP_DISTRIBUTION=inhouse、または店が CUSTOM_APP_STORE_IDS にある → 自社用
 * 3. APP_DISTRIBUTION=public → 公開用
 * 4. SHOPIFY_API_KEY が公開用アプリの client_id（shopify.app.public.toml）と同じ → 公開用
 * 5. SHOPIFY_API_KEY があって、公開用の client_id とはっきり違う → 自社用
 * 6. それ以外（環境変数が無いなど）→ 公開用（今まで通り。料金プランを見る）
 *
 * client_id は秘密の値ではない（toml にそのまま書かれている）。
 */

/** shopify.app.public.toml の client_id（公開用 Location Stock） */
export const PUBLIC_CLIENT_ID = "1758d63a004d7f7d99afe5bf334d1f48";
/** shopify.app.toml の client_id（自社用 Location Stock - Ciara） */
export const INHOUSE_CLIENT_ID = "61b474b801b754166b12f0b9cd07f450";

/**
 * @param {Record<string, string|undefined>} env
 * @param {string|null|undefined} shop
 * @param {{ publicClientId?: string, inhouseClientId?: string }} [ids]
 * @returns {{ distribution: "inhouse"|"public", forceInhouse: boolean, reason: string }}
 */
export function resolvePlanDistribution(env, shop, ids = {}) {
  const publicId = String(ids.publicClientId ?? PUBLIC_CLIENT_ID).trim();
  const inhouseId = String(ids.inhouseClientId ?? INHOUSE_CLIENT_ID).trim();
  const shopNormalized = String(shop ?? "").trim().toLowerCase();
  const custom = String(env?.CUSTOM_APP_STORE_IDS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const forceInhouse = Boolean(shopNormalized && custom.includes(shopNormalized));
  const apiKey = String(env?.SHOPIFY_API_KEY ?? "").trim();
  const dist = String(env?.APP_DISTRIBUTION ?? "").trim().toLowerCase();

  if (apiKey && inhouseId && apiKey === inhouseId) {
    return { distribution: "inhouse", forceInhouse, reason: "inhouse_client_id" };
  }
  if (dist === "inhouse") return { distribution: "inhouse", forceInhouse, reason: "app_distribution_inhouse" };
  if (forceInhouse) return { distribution: "inhouse", forceInhouse, reason: "custom_app_store" };
  if (dist === "public") return { distribution: "public", forceInhouse, reason: "app_distribution_public" };
  if (apiKey && publicId && apiKey === publicId) {
    return { distribution: "public", forceInhouse, reason: "public_client_id" };
  }
  if (apiKey && publicId && apiKey !== publicId) {
    return { distribution: "inhouse", forceInhouse, reason: "api_key_not_public" };
  }
  return { distribution: "public", forceInhouse, reason: "unknown" };
}
