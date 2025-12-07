// app/routes/app.jsx

import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        {/* ホーム（カード 2 枚の画面） */}
        <s-link href="/app">Home</s-link>

        {/* ロケーション在庫設定 */}
        <s-link href="/app/locations">ロケーション在庫設定</s-link>

        {/* 在庫表示のグローバル設定 */}
        <s-link href="/app/settings">在庫表示のグローバル設定</s-link>
      </s-app-nav>

      <Outlet />
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
