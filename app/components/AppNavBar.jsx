/**
 * 管理画面用の常時表示ナビゲーション（POS Stock / POS Receipt と同様）。
 * s-app-nav が表示されない環境でもメニューを提供する。
 * 見た目は共通の部品（admin-ui.tsx の AppNavBarView）。選択中は灰色の角丸、スマホは1行の横スライド（UI ルール v1.1 3章）。
 * 共通の CSS（AdminStyle）は、レイアウトで1回だけ描かれるこのメニューと一緒に描く（13章）。
 */
import { useLocation } from "react-router";
import { AdminStyle, AppNavBarView } from "./admin-ui";

export function AppNavBar({ shopPlan }) {
  const location = useLocation();
  const search = location.search || "";
  const showPlanLink = shopPlan?.distribution === "public";
  const showAnalyticsLink = !!shopPlan?.features?.analytics;

  const items = [
    { path: "/app/locations", label: "ロケーション設定" },
    { path: "/app/settings", label: "在庫表示設定" },
  ];
  if (shopPlan?.features?.storePickup) {
    items.push({ path: "/app/pos-lite", label: "店頭受取・配送" });
  }
  if (showAnalyticsLink) {
    items.push({ path: "/app/analytics", label: "分析" });
  }
  if (showPlanLink) {
    items.push({ path: "/app/plan", label: "料金プラン" });
  }

  return (
    <>
      <AdminStyle />
      <AppNavBarView items={items} pathname={location.pathname} search={search} />
    </>
  );
}
