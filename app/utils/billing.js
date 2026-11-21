/**
 * Location Stock Indicator：公開アプリの料金プラン（Shopify App Pricing / Managed Pricing）
 *
 * 2026-11-21 T 決定: 公開用は Shopify App Pricing（Managed Pricing）で課金する（POS Stock と同じ）。
 * - プランと料金は Partner Dashboard で作る。アプリは appSubscriptionCreate を呼ばない。
 * - 店は Shopify のプラン選択ページ（admin.shopify.com/store/<店>/charges/<app handle>/pricing_plans）で選ぶ。
 * - アプリは currentAppInstallation.activeSubscriptions のプラン名（"Lite" / "Pro" を含む）を読んで機能を決める。
 * - Managed Pricing には従量課金（usage）が無いので、appUsageRecordCreate は使わない。
 */

/**
 * 公開アプリの App Handle（pricing_plans の URL 用）。
 * SHOPIFY_APP_HANDLE が無いときは null。分からない値（"app" など）で URL を作らない
 * （間違った URL は accounts.shopify.com に飛び、埋め込み画面では開けない）。
 * @param {Record<string, string|undefined>} [env]
 * @returns {string|null}
 */
export function getPublicAppHandle(env = process.env) {
  const fromEnv = String(env?.SHOPIFY_APP_HANDLE ?? "").trim();
  return fromEnv || null;
}

/**
 * Shopify App Pricing のプラン選択ページの URL。
 * 必ず admin.shopify.com を使う。埋め込み画面からは target "_top" で開く。
 * @param {string|null|undefined} shopDomain - 例: my-store.myshopify.com
 * @param {Record<string, string|undefined>} [env]
 * @returns {string|null} 店かハンドルが分からないときは null
 */
export function buildManagedPricingPlansUrl(shopDomain, env = process.env) {
  const shop = String(shopDomain ?? "").trim().toLowerCase();
  if (!shop) return null;
  const storeHandle = shop
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/\.myshopify\.com$/i, "");
  if (!storeHandle || storeHandle.includes(".") || storeHandle === "admin") return null;
  const appHandle = getPublicAppHandle(env);
  if (!appHandle) return null;
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/charges/${encodeURIComponent(appHandle)}/pricing_plans`;
}

/**
 * 有効な契約の一覧からプランを決める。
 * 名前に "Pro" を含む → pro、"Lite" を含む → lite。両方あれば Pro。
 * 有効な契約があるのに名前から読めないとき → lite（払っている店を「未契約」として止めない。POS Stock と同じ）。
 * 開発ストアのテスト課金も Shopify は ACTIVE で返すので、契約として数える。
 * @param {Array<{ name?: string; status?: string }>} subscriptions
 * @returns {"lite"|"pro"|null}
 */
export function getPlanFromActiveSubscriptions(subscriptions) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return null;
  const active = subscriptions.filter((s) => String(s?.status || "").toUpperCase() === "ACTIVE");
  if (active.length === 0) return null;
  const hasPro = active.some((s) => /pro/i.test(String(s?.name || "")));
  const hasLite = active.some((s) => /lite/i.test(String(s?.name || "")));
  if (hasPro) return "pro";
  if (hasLite) return "lite";
  console.warn(
    "[billing] active subscription name has neither Pro nor Lite; treating as lite:",
    active.map((s) => String(s?.name || "")).join(", ")
  );
  return "lite";
}

/** Lite で使えるロケーション数の上限 */
export const LITE_MAX_LOCATIONS = 10;

/**
 * プランで使えるロケーション数の上限。Lite は 10、Pro は上限なし（null）。
 * @param {"lite"|"pro"|null} plan
 * @returns {number|null}
 */
export function getMaxLocationsForPlan(plan) {
  return plan === "lite" ? LITE_MAX_LOCATIONS : null;
}
