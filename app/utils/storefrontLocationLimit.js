/**
 * 公開用 Lite のロケーション上限（10）をストアフロントの在庫応答にも当てる。
 *
 * 管理画面では getShopPlan の locationPlanMismatch のとき /app/plan へ誘導している（app.jsx）。
 * ストアフロントでも同じ判定で在庫を返さず、理由のコードと「表示できない」の文を返す。
 * 一部の店舗だけ出すと「どの 10 か所か」が店の意図と合わない恐れがあるため、
 * 先頭 10 件に切り詰めることはしない（docs/PLAN_SETTINGS_DESIGN.md の「プラン不一致」）。
 */

import { STOREFRONT_UNAVAILABLE_MESSAGE } from "./storefrontMessages.js";

export const LOCATION_PLAN_MISMATCH_CODE = "location_plan_mismatch";

/** 商品ページにはプランの話を出さない（T、2026-11-23）。理由はコードとログだけ */
export const LOCATION_PLAN_MISMATCH_MESSAGE = STOREFRONT_UNAVAILABLE_MESSAGE;

/**
 * @param {{ distribution?: string, locationPlanMismatch?: boolean } | null | undefined} shopPlan
 * @returns {boolean} ストアフロントの在庫を上限超えで止めるか
 */
export function isStorefrontLocationLimitExceeded(shopPlan) {
  if (!shopPlan) return false;
  if (shopPlan.distribution !== "public") return false;
  return shopPlan.locationPlanMismatch === true;
}
