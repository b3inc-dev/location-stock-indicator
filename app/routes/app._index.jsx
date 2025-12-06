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
        ロケーションごとの表示名・並び順・表示／非表示とあわせて、
        在庫マークや在庫数表示ルールなどもアプリ側の設定から一括で管理できます。
      </p>

      <div
        style={{
          display: "flex",
          gap: "16px",
          flexWrap: "wrap",
          marginBottom: "24px",
        }}
      >
        {/* ロケーション在庫設定カード */}
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
            各ロケーションの「公開名」「並び順」「表示／非表示」をまとめて管理します。
            店舗名の表示順や、一覧に出したくないロケーションの制御を行います。
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

        {/* グローバル設定カード */}
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
          <h2
            style={{
              fontSize: "1.05rem",
              margin: "0 0 0.5rem",
              fontWeight: 600,
            }}
          >
            在庫表示のグローバル設定
          </h2>
          <p
            style={{
              margin: "0 0 0.75rem",
              fontSize: "0.9rem",
              color: "#555",
            }}
          >
            在庫マーク（◯△✕）、並び順、在庫数の表示ルール、在庫ステータスのラベル、
            ロケーション名クリック時の動作など、
            在庫表示ロジックをまとめて管理する画面です。
          </p>
          <ul style={{ margin: "0 0 0.75rem 1.1rem", padding: 0, fontSize: "0.86rem" }}>
            <li>在庫マーク（◯ / △ / ✕）</li>
            <li>並び順（ロケーション名 / 在庫数の多い順・少ない順）</li>
            <li>在庫数の表示形式（ラベル・カッコ・rowContentMode）</li>
            <li>在庫ステータスのラベル（在庫あり / 残りわずか / 在庫なし）</li>
            <li>ロケーション名クリック時の動作（何もしない / Google マップ / 任意 URL）</li>
          </ul>
          <Link
            to="/app/settings"
            style={{
              display: "inline-block",
              padding: "0.45rem 1.1rem",
              borderRadius: "4px",
              background: "#5c6ac4",
              color: "#fff",
              fontSize: "0.9rem",
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            グローバル設定を開く
          </Link>
        </div>
      </div>

      {/* 使い方メモ */}
      <div
        style={{
          fontSize: "0.85rem",
          color: "#777",
          lineHeight: 1.6,
        }}
      >
        <h3
          style={{
            fontSize: "0.9rem",
            margin: "0 0 0.5rem",
            fontWeight: 600,
          }}
        >
          使い方メモ
        </h3>
        <ol style={{ margin: 0, paddingLeft: "1.1rem" }}>
          <li>
            「ロケーション在庫設定」で、各ロケーションの公開名・順番・表示チェックを編集します。
          </li>
          <li>
            「在庫表示のグローバル設定」で、在庫マーク・並び順・在庫数の表示形式・ラベル・クリック動作を設定します。
          </li>
          <li>
            これらの設定は <code>location_stock.config</code>{" "}
            メタフィールドとして保存され、商品ページの在庫表示ロジックに反映されます。
          </li>
          <li>
            テーマ側では、主に見た目（余白・カラー・凡例テキストなど）だけを調整します。
          </li>
        </ol>
        {shop && (
          <p style={{ marginTop: "0.75rem", opacity: 0.7 }}>
            現在のストア: <code>{shop}</code>
          </p>
        )}
      </div>
    </div>
  );
}
