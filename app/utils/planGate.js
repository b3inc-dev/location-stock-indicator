/**
 * 公開アプリの課金ゲート（純関数）。
 *
 * App Store 向け方針（2026-10 確定）:
 * - 公開本番ストアで plan === null（サブスク未選択）のときは基本在庫表示も含め機能制限する。
 * - 無料開放（未契約でもストアフロント在庫を出す）は行わない。
 * - inhouse / 開発ストアは従来どおり全機能（Pro 相当）。
 *
 * 根拠: listing の Lite $20 / Pro と実装の一致（docs/PLAN_SETTINGS_DESIGN.md, APP_REVIEW_SUBMISSION.md）。
 */

/**
 * @param {{ distribution?: string, plan?: string|null, isDevelopmentStore?: boolean } | null | undefined} shopPlan
 * @returns {boolean} ストアフロントの在庫表示を許可するか
 */
export function isStorefrontInventoryAllowed(shopPlan) {
  if (!shopPlan) return false;
  if (shopPlan.distribution === "inhouse") return true;
  if (shopPlan.isDevelopmentStore) return true;
  return shopPlan.plan === "lite" || shopPlan.plan === "pro";
}

/**
 * @param {{ distribution?: string, plan?: string|null, isDevelopmentStore?: boolean } | null | undefined} shopPlan
 * @returns {boolean} Pro 専用 future（エリア・近隣・店頭受取等）を許可するか
 */
export function isProFeaturesAllowed(shopPlan) {
  if (!shopPlan) return false;
  if (shopPlan.distribution === "inhouse") return true;
  if (shopPlan.isDevelopmentStore) return true;
  return shopPlan.plan === "pro";
}

/**
 * 公開アプリでプラン未選択のため管理 UI を /app/plan へ誘導すべきか。
 * @param {{ distribution?: string, plan?: string|null, isDevelopmentStore?: boolean } | null | undefined} shopPlan
 */
export function requiresPlanSelection(shopPlan) {
  if (!shopPlan) return false;
  if (shopPlan.distribution !== "public") return false;
  if (shopPlan.isDevelopmentStore) return false;
  return shopPlan.plan == null;
}
