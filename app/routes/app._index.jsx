// app/routes/app._index.jsx

import { useLoaderData, Link } from "react-router";
import { authenticate } from "../shopify.server";

/**
 * Home 画面用 loader
 * - セッション確認（未ログインなら Shopify 側へリダイレクト）
 * - shop ドメインだけ UI に渡しておく（表示に使いたいとき用）
 */
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  return {
    shop: session.shop, // 例: "location-stock-indicator.myshopify.com"
  };
}

/**
 * /app の Home 画面
 */
export default function AppIndex() {
  const { shop } = useLoaderData();

  return (
    <div style={{ padding: "24px", maxWidth: "960px" }}>
      <h1 style={{ fontSize: "1.6rem", marginBottom: "0.75rem" }}>
        Location stock indicator
      </h1>

      <p style={{ marginBottom: "0.5rem", color: "#4a4a4a" }}>
        ストアのロケーションごとの在庫を、商品ページに表示するためのアプリです。
      </p>
      <p style={{ marginBottom: "1.5rem", color: "#6b6b6b", fontSize: "0.9rem" }}>
        アプリ設定では、ロケーション名の表示名・並び順・表示／非表示をまとめて設定できます。
      </p>

      <div
        style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "24px",
        }}
      >
        <div
          style={{
            flex: "1 1 260px",
            padding: "16px 18px",
            borderRadius: "8px",
            border: "1px solid #e1e3e5",
            background: "#fff",
          }}
        >
          <h2
            style={{
              fontSize: "1.05rem",
              margin: "0 0 0.5rem",
              fontWeight: 600,
            }}
          >
            ロケーション在庫設定
          </h2>
          <p
            style={{
              margin: "0 0 0.75rem",
              fontSize: "0.9rem",
              color: "#555",
            }}
          >
            各ロケーションの表示名・並び順・表示／非表示をまとめて管理します。
          </p>
          <Link
            to="/app/locations"
            style={{
              display: "inline-block",
              padding: "0.45rem 1.1rem",
              borderRadius: "4px",
              background: "#008060",
              color: "#fff",
              fontSize: "0.9rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            ロケーション設定を開く
          </Link>
        </div>

        <div
          style={{
            flex: "1 1 260px",
            padding: "16px 18px",
            borderRadius: "8px",
            border: "1px solid #e1e3e5",
            background: "#f9fafb",
            fontSize: "0.85rem",
            color: "#555",
          }}
        >
          <h3
            style={{
              fontSize: "0.95rem",
              margin: "0 0 0.5rem",
              fontWeight: 600,
            }}
          >
            使い方メモ
          </h3>
          <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
            <li>左メニュー「ロケーション在庫設定」を開きます。</li>
            <li>各ロケーションの公開名・sortOrder・表示チェックを編集します。</li>
            <li>商品ページ側のセクション設定で sort_by を「none」にすると、ここで設定した順番が使われます。</li>
          </ol>
          {shop && (
            <p style={{ marginTop: "0.75rem", opacity: 0.7 }}>
              現在のストア: <code>{shop}</code>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
