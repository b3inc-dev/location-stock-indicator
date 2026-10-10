// app/routes/app._index.jsx

import { Link, useLoaderData, useOutletContext } from "react-router";
import { authenticate } from "../shopify.server";
import { createT, resolveAdminLocale } from "../i18n/adminI18n.js";

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
function DeliveryProfileCard({ shop, t }) {
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
        {t("home.deliveryTitle")}
      </div>
      <div style={{ marginBottom: "12px", fontSize: "14px", color: "#6d7175", lineHeight: 1.5 }}>
        {t("home.deliveryBodyBefore")}
        <strong style={{ color: "#202223" }}>{t("home.deliveryBodyStrong")}</strong>
        {t("home.deliveryBodyAfter")}
      </div>
      <div style={{ marginBottom: "12px", fontSize: "13px", color: "#6d7175", lineHeight: 1.5 }}>
        <strong style={{ color: "#202223" }}>{t("home.deliveryStepsLabel")}</strong>
        {t("home.deliverySteps")}
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
          {t("home.deliveryOpen")}
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
 * /app の Home 画面（POS Stock のカード構成に準拠：プラン・ロケーション数＋導入ステップ）
 */
export default function AppIndex() {
  const { shop } = useLoaderData();
  const outletContext = useOutletContext();
  const shopPlan = outletContext?.shopPlan ?? null;
  const t =
    outletContext?.t ||
    createT(resolveAdminLocale(shopPlan));
  const distribution = shopPlan?.distribution;
  const plan = shopPlan?.plan;
  const locationsCount = shopPlan?.locationsCount ?? 0;
  const isDevelopmentStore = shopPlan?.isDevelopmentStore ?? false;
  const isInhouse = distribution === "inhouse";
  const showBillingNote = !isInhouse && isDevelopmentStore;

  const planLabel =
    plan === "pro"
      ? "Pro"
      : plan === "lite"
        ? t("home.planLiteTrial")
        : t("home.planNotSelected");

  return (
    <s-page heading={t("home.heading")}>
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
          <SummaryCard title={t("home.currentPlan")} style={{ marginBottom: "16px" }}>
            <div style={{ marginBottom: "8px", fontSize: "18px", fontWeight: 700, color: "#202223" }}>
              {planLabel}
            </div>
            {!isInhouse && !plan && (
              <Link to="/app/plan" style={{ fontSize: "14px", color: "#2c6ecb" }}>
                {t("home.selectPlan")}
              </Link>
            )}
            {!isInhouse && plan === "lite" && (
              <Link to="/app/plan" style={{ fontSize: "14px", color: "#2c6ecb" }}>
                {t("home.upgradeCta")}
              </Link>
            )}
            {isInhouse && (
              <span style={{ fontSize: "14px", color: "#6d7175" }}>
                {t("home.allFeatures")}
              </span>
            )}
            {showBillingNote && (
              <span style={{ fontSize: "14px", color: "#6d7175", display: "block", marginTop: "4px" }}>
                {t("home.devStoreNoBilling")}
              </span>
            )}
          </SummaryCard>

          <SummaryCard title={t("home.locationCount")}>
            <span style={{ fontSize: "18px", fontWeight: 700, color: "#202223" }}>{locationsCount}</span>
            <span style={{ marginLeft: "4px", fontSize: "14px", color: "#6d7175" }}>{t("home.locationUnit")}</span>
          </SummaryCard>
        </div>
        <div className="HomePage-steps">
          <StepCard
            title={t("home.step1Title")}
            description={t("home.step1Desc")}
            buttonLabel={t("home.step1Button")}
            to="/app/locations"
          />
          <DeliveryProfileCard shop={shop} t={t} />
          <StepCard
            title={t("home.step2Title")}
            description={t("home.step2Desc")}
            buttonLabel={t("home.step2Button")}
            to="/app/settings"
          />
        </div>
      </div>
    </s-page>
  );
}
