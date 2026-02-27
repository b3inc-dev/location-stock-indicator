// app/routes/app._index.jsx

import { Link, useLoaderData } from "react-router";
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

/** POS Stock の StepCard に準拠：タイトル・説明・ボタンのカード */
function StepCard({ title, description, buttonLabel, to }) {
  return (
    <div
      style={{
        marginBottom: "16px",
        padding: "16px",
        background: "#fff",
        borderRadius: "8px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
      }}
    >
      <div style={{ marginBottom: "8px", fontSize: "14px", fontWeight: 600, color: "#6d7175" }}>
        {title}
      </div>
      <div style={{ marginBottom: "12px", fontSize: "14px", color: "#6d7175", lineHeight: 1.4 }}>
        {description}
      </div>
      <Link
        to={to}
        style={{
          display: "inline-block",
          padding: "8px 16px",
          background: "#2c6ecb",
          color: "#fff",
          borderRadius: "6px",
          fontSize: "14px",
          textDecoration: "none",
          fontWeight: 500,
        }}
      >
        {buttonLabel}
      </Link>
    </div>
  );
}

/**
 * 配送プロファイルの案内カード（ロケーション設定の下に表示）
 * 「配送対応」「ローカルデリバリー対応」は Shopify の配送設定で決まる旨と、配送設定を開くボタン
 */
function DeliveryProfileCard({ shop }) {
  const deliverySettingsUrl = shop ? `https://${shop}/admin/settings/shipping` : null;
  return (
    <div
      style={{
        marginBottom: "16px",
        padding: "16px",
        background: "#fff",
        borderRadius: "8px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        borderLeft: "4px solid #008060",
      }}
    >
      <div style={{ marginBottom: "8px", fontSize: "14px", fontWeight: 600, color: "#6d7175" }}>
        「配送対応」「ローカルデリバリー対応」について
      </div>
      <div style={{ marginBottom: "12px", fontSize: "14px", color: "#6d7175", lineHeight: 1.5 }}>
        ロケーション一覧の「配送対応」「ローカルデリバリー対応」は、Shopify の
        <strong style={{ color: "#202223" }}> 配送プロファイル</strong>
        の設定から取得しています。ロケーションをプロファイルのロケーショングループに割り当て、ゾーン（例：通常配送は「アジア」、ローカルデリバリーは「Local Delivery」や「東京都」など）を作成すると反映されます。並び順の「配送対応を優先」「ローカルデリバリーを優先」も同じ設定を使います。
      </div>
      <div style={{ marginBottom: "12px", fontSize: "13px", color: "#6d7175", lineHeight: 1.5 }}>
        <strong style={{ color: "#202223" }}>手順の例：</strong>
        設定 → 配送と配達 → 配送プロファイルでロケーションを追加し、該当するゾーンを設定してください。ローカルデリバリーの場合は、ゾーン名に「Local delivery」「ローカル」「東京都」などが含まれると「ローカルデリバリー対応」と表示されます。
      </div>
      {deliverySettingsUrl && (
        <a
          href={deliverySettingsUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "inline-block",
            padding: "8px 16px",
            fontSize: "14px",
            fontWeight: 500,
            color: "#fff",
            background: "#2c6ecb",
            borderRadius: "6px",
            textDecoration: "none",
          }}
        >
          配送設定を開く
        </a>
      )}
    </div>
  );
}

/** POS Stock の SummaryCard に準拠：タイトル＋子要素 */
function SummaryCard({ title, children, style = {} }) {
  return (
    <div
      style={{
        padding: "16px",
        background: "#fff",
        borderRadius: "8px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        ...style,
      }}
    >
      <div style={{ marginBottom: "8px", fontSize: "14px", fontWeight: 600, color: "#6d7175" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * /app の Home 画面（POS Stock のカード構成に準拠）
 */
export default function AppIndex() {
  const { shop } = useLoaderData();
  return (
    <s-page heading="ホーム">
      <style>{`
        .HomePage-layout {
          padding: 16px;
          display: flex;
          gap: 24px;
          flex-wrap: wrap;
          max-width: 1200px;
        }
        .HomePage-summary { flex: 0 1 320px; min-width: 260px; }
        .HomePage-steps { flex: 1 1 60%; min-width: 280px; }
        @media (max-width: 767px) {
          .HomePage-layout { flex-direction: column; }
          .HomePage-summary { order: 1; flex: 1 1 100%; min-width: 0; width: 100%; }
          .HomePage-steps { order: 2; flex: 1 1 100%; min-width: 0; width: 100%; }
        }
        @media (min-width: 768px) {
          .HomePage-steps { order: 1; }
          .HomePage-summary { order: 2; }
        }
      `}</style>
      <div className="HomePage-layout">
        <div className="HomePage-summary">
          <SummaryCard title="このアプリについて" style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "14px", color: "#202223", lineHeight: 1.5 }}>
              ストアのロケーションごとの在庫を、商品ページに表示するためのアプリです。
              表示名・並び順・表示／非表示、在庫マークや表示ルールをアプリ側で一括管理できます。
            </div>
          </SummaryCard>
        </div>
        <div className="HomePage-steps">
          <StepCard
            title="1. ロケーション設定"
            description="各ロケーションの「公開名」「並び順」「表示／非表示」をまとめて管理します。店舗名の表示順や、一覧に出したくないロケーションの制御を行います。"
            buttonLabel="ロケーション設定を開く"
            to="/app/locations"
          />
          <DeliveryProfileCard shop={shop} />
          <StepCard
            title="2. 在庫表示設定"
            description="在庫マーク（◯△✕）、並び順、在庫数の表示ルール、在庫ステータスのラベル、ロケーション名クリック時の動作など、在庫表示ロジックをまとめて管理する画面です。"
            buttonLabel="在庫表示設定を開く"
            to="/app/settings"
          />
        </div>
      </div>
    </s-page>
  );
}
