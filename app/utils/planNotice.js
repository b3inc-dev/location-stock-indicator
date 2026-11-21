/**
 * 料金プラン画面のお知らせ（純関数。app/routes/app.plan.jsx が使う）。
 */

export const NOTICE_STYLES = {
  critical: { background: "#fff4f4", border: "#e0a3a3" },
  warning: { background: "#fff4e5", border: "#e0b252" },
  info: { background: "#eaf4ff", border: "#a4c8f0" },
};

/**
 * 料金プラン画面のお知らせ（1 画面に 1 つ。失敗 → 注意 → 案内の順。docs/UI_RULES.md 5章）。
 * @returns {{ tone: "critical"|"warning"|"info", heading: string, body: string } | null}
 */
export function buildPlanPageNotice({
  plan,
  planCheckFailed,
  pricingPlansUrl,
  locationPlanMismatch,
  maxLocationsForPlan,
  locationsCount,
  isDevelopmentStore,
}) {
  if (planCheckFailed) {
    return {
      tone: "critical",
      heading: "契約の状態を確認できませんでした",
      body: "Shopify から料金プランの情報を読めませんでした。確認できるまで、商品ページの在庫表示と設定の保存を止めています。少し待ってからこのページを再読み込みしてください。",
    };
  }
  if (!pricingPlansUrl) {
    return {
      tone: "critical",
      heading: "プラン選択ページを開けません",
      body: "アプリの設定が足りないため、Shopify のプラン選択ページの URL を作れませんでした。サポートにお問い合わせください。",
    };
  }
  if (locationPlanMismatch && maxLocationsForPlan != null) {
    return {
      tone: "warning",
      heading: "ロケーション数がプランと一致していません",
      body: `今のプランは ${maxLocationsForPlan} ロケーションまでで、ストアのロケーション数は ${locationsCount} です。下の Pro を選ぶまで、設定などの機能は使えません。`,
    };
  }
  if (!plan) {
    return {
      tone: "warning",
      heading: "料金プランの契約が必要です",
      body: `契約するまで、商品ページのロケーション別在庫は表示されません。下の Lite か Pro を選んでください。${
        isDevelopmentStore ? "開発ストアはテスト課金のため請求されません。" : ""
      }`,
    };
  }
  if (isDevelopmentStore) {
    return {
      tone: "info",
      heading: "開発ストアはテスト課金です",
      body: "プランを選んでも請求はされません。本番の店では Shopify のプラン選択ページの料金がかかります。",
    };
  }
  return null;
}

