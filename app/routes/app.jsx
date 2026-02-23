// app/routes/app.jsx

import { Outlet, useLoaderData, useNavigation, useRouteError } from "react-router";
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
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

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
