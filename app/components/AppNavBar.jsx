/**
 * 管理画面用の常時表示ナビゲーション（POS Stock / POS Receipt と同様）。
 * s-app-nav が表示されない環境でもメニューを提供する。
 */
import { Link, useLocation } from "react-router";

export function AppNavBar({ shopPlan }) {
  const location = useLocation();
  const search = location.search || "";
  const showPlanLink = shopPlan?.distribution === "public";

  const items = [
    { path: "/app/locations", label: "ロケーション設定" },
    { path: "/app/settings", label: "在庫表示設定" },
    { path: "/app/analytics", label: "分析" },
  ];
  if (showPlanLink) {
    items.push({ path: "/app/plan", label: "料金プラン" });
  }

  return (
    <nav
      data-app-nav="location-stock"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "4px 16px",
        alignItems: "center",
        padding: "12px 20px",
        marginBottom: "16px",
        background: "#f6f6f7",
        borderBottom: "1px solid #e1e3e5",
        fontSize: "14px",
        position: "relative",
        zIndex: 100,
        minHeight: "44px",
        boxSizing: "border-box",
      }}
    >
      {items.map(({ path, label }) => {
        const to = path + search;
        const isActive = location.pathname === path;
        return (
          <Link
            key={path}
            to={to}
            style={{
              color: isActive ? "#2c6ecb" : "#202223",
              fontWeight: isActive ? 600 : 400,
              textDecoration: "none",
            }}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
