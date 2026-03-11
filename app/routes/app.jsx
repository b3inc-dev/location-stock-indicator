// app/routes/app.jsx

import { Outlet, redirect, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";
import { AppNavBar } from "../components/AppNavBar";
import { getShopPlan } from "../utils/shopPlan.server.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const shopPlan = await getShopPlan(admin, session?.shop);

  // ロケーション数とプランが一致していない場合は、ホームと料金プラン以外へはアクセスさせずプラン変更を促す
  if (shopPlan.locationPlanMismatch) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path !== "/app" && path !== "/app/plan" && !path.startsWith("/app/plan?")) {
      return redirect("/app/plan?mismatch=1");
    }
  }

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", shopPlan };
};

export default function App() {
  const { apiKey, shopPlan } = useLoaderData();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";
  const showPlanLink = shopPlan?.distribution === "public";

  return (
    <AppProvider embedded apiKey={apiKey}>
      {isLoading && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            padding: "12px 16px",
            background: "#2563eb",
            color: "#fff",
            fontSize: "14px",
            fontWeight: 500,
            textAlign: "center",
            zIndex: 9999,
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          }}
        >
          読み込み中…
        </div>
      )}
      <s-app-nav>
        <s-link href="/app/locations">ロケーション設定</s-link>
        <s-link href="/app/settings">在庫表示設定</s-link>
        <s-link href="/app/analytics">分析</s-link>
        {showPlanLink && <s-link href="/app/plan">料金プラン</s-link>}
      </s-app-nav>
      {/* 上部メニュー（s-app-nav が表示されない環境用・常に表示） */}
      <AppNavBar shopPlan={shopPlan} />

      <Outlet context={{ shopPlan }} />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
