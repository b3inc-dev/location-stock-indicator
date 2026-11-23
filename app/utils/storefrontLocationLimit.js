/**
 * 公開用 Lite のロケーション上限（10）をストアフロントの在庫応答にも当てる。
 *
 * 管理画面では getShopPlan の locationPlanMismatch のとき /app/plan へ誘導している（app.jsx）。
 * ストアフロントでも同じ判定で在庫を返さず、理由のコードと文を返す。
 * 一部の店舗だけ出すと「どの 10 か所か」が店の意図と合わない恐れがあるため、
 * 先頭 10 件に切り詰めることはしない（docs/PLAN_SETTINGS_DESIGN.md の「プラン不一致」）。
 */

export const LOCATION_PLAN_MISMATCH_CODE = "location_plan_mismatch";

export const LOCATION_PLAN_MISMATCH_MESSAGE =
  "ロケーション数が Lite プランの上限を超えているため、在庫を表示できません。Shopify 管理画面のアプリから Pro プランへ変更してください。";

/**
 * @param {{ distribution?: string, locationPlanMismatch?: boolean } | null | undefined} shopPlan
 * @returns {boolean} ストアフロントの在庫を上限超えで止めるか
 */
export function isStorefrontLocationLimitExceeded(shopPlan) {
  if (!shopPlan) return false;
  if (shopPlan.distribution !== "public") return false;
  return shopPlan.locationPlanMismatch === true;
}
