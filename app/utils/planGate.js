/**
 * 公開アプリの課金ゲート（純関数）。
 *
 * 方針:
 * - 自社用（inhouse）は全機能（Pro 相当）。今まで通り。
 * - 公開用は、開発ストアも本番の店も Shopify App Pricing の契約で決める
 *   （開発ストアは Shopify のテスト課金なので請求されない。POS Stock #78 と同じ）。
 * - 未契約（plan === null）は基本の在庫表示も含め使えない（無料開放しない）。
 * - Shopify から契約を読めなかった（planCheckFailed）ときも使えない（fail-closed）。
 *   ただし「未契約」とは分けて、画面では「確認できませんでした」と出す。
 *
 * 根拠: docs/PLAN_SETTINGS_DESIGN.md, docs/APP_REVIEW_SUBMISSION.md。
 */

/**
 * @typedef {{ distribution?: string, plan?: string|null, planCheckFailed?: boolean } | null | undefined} PlanSnapshot
 */

/**
 * @param {PlanSnapshot} shopPlan
 * @returns {boolean} ストアフロントの在庫表示を許可するか
 */
export function isStorefrontInventoryAllowed(shopPlan) {
  if (!shopPlan) return false;
  if (shopPlan.distribution === "inhouse") return true;
  if (shopPlan.planCheckFailed) return false;
  return shopPlan.plan === "lite" || shopPlan.plan === "pro";
}

/**
 * @param {PlanSnapshot} shopPlan
 * @returns {boolean} Pro 専用 future（エリア・近隣・店頭受取・分析）を許可するか
 */
export function isProFeaturesAllowed(shopPlan) {
  if (!shopPlan) return false;
  if (shopPlan.distribution === "inhouse") return true;
  if (shopPlan.planCheckFailed) return false;
  return shopPlan.plan === "pro";
}

/**
 * 公開アプリで未契約のため、管理 UI を /app/plan へ誘導すべきか（読めなかったときは含めない）。
 * @param {PlanSnapshot} shopPlan
 */
export function requiresPlanSelection(shopPlan) {
  if (!shopPlan) return false;
  if (shopPlan.distribution !== "public") return false;
  if (shopPlan.planCheckFailed) return false;
  return shopPlan.plan == null;
}

/**
 * 管理画面の設定保存（action）を止めるべきか。止めるときは理由のコードを返す。
 * - "plan_check_failed": 契約を読めなかった（少し待ってもう一度）
 * - "plan_required": 未契約
 * - "location_plan_mismatch": Lite の上限を超えるロケーション数
 * @param {(PlanSnapshot & { locationPlanMismatch?: boolean })} shopPlan
 * @returns {null|"plan_check_failed"|"plan_required"|"location_plan_mismatch"}
 */
export function adminWriteBlockReason(shopPlan) {
  if (!shopPlan) return "plan_check_failed";
  if (shopPlan.distribution === "inhouse") return null;
  if (shopPlan.planCheckFailed) return "plan_check_failed";
  if (shopPlan.plan == null) return "plan_required";
  if (shopPlan.locationPlanMismatch) return "location_plan_mismatch";
  return null;
}

/** adminWriteBlockReason の理由を画面に出す文（見出しは何が起きたか、本文はどうすればいいか） */
export const ADMIN_WRITE_BLOCK_MESSAGES = {
  plan_check_failed:
    "契約の状態を確認できなかったため、保存しませんでした。少し待ってから、もう一度保存してください。",
  plan_required: "料金プランを契約していないため、保存しませんでした。料金プランの画面で Lite か Pro を選んでください。",
  location_plan_mismatch:
    "ロケーション数が Lite の上限を超えているため、保存しませんでした。料金プランの画面で Pro を選んでください。",
};
