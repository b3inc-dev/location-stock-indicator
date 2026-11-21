// app/routes/app.plan.jsx - 料金プランページ（プラン選択＋プラン別機能の紹介）POS Stock 同様 UI
// 公開アプリは Shopify App Pricing（Managed Pricing）。プランの選択・変更・解約は Shopify の pricing_plans で行う。
// アプリは appSubscriptionCreate を呼ばない。埋め込み画面の外（target="_top"）で開く。
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopPlan } from "../utils/shopPlan.server.js";
import { LITE_MAX_LOCATIONS, buildManagedPricingPlansUrl } from "../utils/billing.js";

import { NOTICE_STYLES, buildPlanPageNotice } from "../utils/planNotice.js";
import { describeUsageReportForMerchant } from "../utils/appEventsUsage.server.js";
import prisma from "../db.server.js";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shopPlan = await getShopPlan(admin, session?.shop);
  const pricingPlansUrl =
    shopPlan.distribution === "public" ? buildManagedPricingPlansUrl(session?.shop) : null;
  if (shopPlan.distribution === "public" && !pricingPlansUrl) {
    console.error("[app.plan] cannot build pricing_plans URL (SHOPIFY_APP_HANDLE missing?) shop=", session?.shop);
  }
  // Pro の従量（App Events API）の報告の状態。読めなくても画面は出す
  let usageReportNote = null;
  const usage = shopPlan.proLocationUsage;
  if (usage && session?.shop) {
    try {
      const row = usage.periodEnd
        ? await prisma.appUsageReport.findUnique({
            where: { shop_periodEnd: { shop: session.shop.trim().toLowerCase(), periodEnd: usage.periodEnd } },
            select: { status: true },
          })
        : null;
      usageReportNote = describeUsageReportForMerchant(row);
    } catch (e) {
      console.warn("[app.plan] usage report read failed:", e instanceof Error ? e.message : String(e));
      usageReportNote = "報告の状態を読めませんでした。少し待ってから再読み込みしてください。";
    }
  }
  return { shopPlan, pricingPlansUrl, usageReportNote };
}

/**
 * 互換用: 古い画面からの POST（プラン選択）を Shopify のプラン選択ページへ _top で移す。
 * 課金はアプリで作らない（Managed Pricing）。
 */
export async function action({ request }) {
  if (request.method !== "POST") return null;
  const auth = await authenticate.admin(request);
  const shopPlan = await getShopPlan(auth.admin, auth.session?.shop);
  if (shopPlan.distribution === "inhouse") return null;
  const pricingPlansUrl = buildManagedPricingPlansUrl(auth.session?.shop);
  if (!pricingPlansUrl) {
    return { ok: false, error: "プラン選択ページの URL を作れませんでした。" };
  }
  return auth.redirect(pricingPlansUrl, { target: "_top" });
}

export default function PlanPage() {
  const { shopPlan, pricingPlansUrl, usageReportNote } = useLoaderData();
  const proUsage = shopPlan?.proLocationUsage;
  const { plan, locationsCount, distribution, isDevelopmentStore, locationPlanMismatch, maxLocationsForPlan, planCheckFailed } =
    shopPlan ?? {};
  const isInhouse = distribution === "inhouse";
  const notice = buildPlanPageNotice({
    plan,
    planCheckFailed: planCheckFailed === true,
    pricingPlansUrl,
    locationPlanMismatch: locationPlanMismatch === true,
    maxLocationsForPlan,
    locationsCount,
    isDevelopmentStore,
  });

  if (isInhouse) {
    return (
      <s-page heading="料金プラン">
        <div style={{ padding: "16px", maxWidth: "600px", margin: "0 16px" }}>
          <div
            style={{
              padding: "16px",
              background: "#fff",
              borderRadius: "8px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            <s-text emphasis="bold">全機能をご利用いただけます</s-text>
            <div style={{ marginTop: "8px" }}>
              <s-text tone="subdued" size="small">
                このアプリでは料金プランの選択はありません。
              </s-text>
            </div>
          </div>
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading="料金プラン">
      <div style={{ padding: "16px", maxWidth: "900px" }}>
        {notice && (
          <div
            role={notice.tone === "critical" ? "alert" : "status"}
            style={{
              marginBottom: "16px",
              padding: "12px 16px",
              background: NOTICE_STYLES[notice.tone].background,
              border: `1px solid ${NOTICE_STYLES[notice.tone].border}`,
              borderRadius: "8px",
            }}
          >
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#202223", marginBottom: "4px" }}>
              {notice.heading}
            </div>
            <div style={{ fontSize: "14px", color: "#202223", lineHeight: 1.5 }}>{notice.body}</div>
          </div>
        )}

        {/* プラン選択セクション */}
        <div style={{ marginBottom: "32px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "18px", fontWeight: 700, color: "#202223" }}>料金プラン</span>
            <span style={{ fontSize: "14px", color: "#6d7175" }}>ロケーション数: {locationsCount}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
            <PlanCard
              name="Lite"
              priceDetail={`${LITE_MAX_LOCATIONS}ロケーションまで。`}
              summary="基本の在庫表示・並び順・閾値・公開名・リンクなど。エリア・近隣店舗・店舗受け取り・分析は Pro でご利用いただけます。"
              isCurrent={plan === "lite"}
              pricingPlansUrl={pricingPlansUrl}
            />
            <PlanCard
              name="Pro"
              priceDetail="ロケーション数に制限なし。"
              summary="エリア設定・近隣店舗表示・店舗受け取りボタン・分析（管理画面）を含む全機能。"
              isCurrent={plan === "pro"}
              pricingPlansUrl={pricingPlansUrl}
              primary
            />
          </div>
          {proUsage && proUsage.units > 0 ? (
            <div
              style={{
                marginTop: "16px",
                padding: "12px 16px",
                background: "#fff",
                border: "1px solid #e1e3e5",
                borderRadius: "8px",
                fontSize: "14px",
                color: "#202223",
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: "4px" }}>ロケーション数の従量（Pro）</div>
              <div>
                ロケーション <strong>{proUsage.units} か所</strong> × ${proUsage.unitPriceUsd} ＝ <strong>${proUsage.amountUsd}</strong>
                ／請求期間（基本料金とは別に、Shopify の請求に載ります）
              </div>
              <div style={{ marginTop: "4px", fontSize: "13px", color: "#6d7175" }}>
                請求期間ごとに 1 回、その時点のロケーション数で数えます。{usageReportNote ?? ""}
              </div>
            </div>
          ) : null}
          <div style={{ marginTop: "12px", fontSize: "13px", color: "#6d7175", lineHeight: 1.5 }}>
            料金・無料期間は Shopify のプラン選択ページに表示されます。プランの選択・変更・解約も Shopify の画面で行います。変更のあと、このページを再読み込みしてください。
          </div>
        </div>

        {/* 全てのプランで利用可能な機能 */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ marginBottom: "12px", fontSize: "18px", fontWeight: 700, color: "#202223" }}>
            全てのプランで利用可能な機能
          </div>
          <div
            style={{
              marginTop: "12px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: "12px",
            }}
          >
            <FeatureCard
              title="在庫表示"
              description="閾値（在庫なし/残りわずか/在庫あり）・在庫マーク・ラベル・メッセージの設定。"
            />
            <FeatureCard
              title="並び順・上部固定"
              description="ロケーションの並び順と、1件の上部固定ロケーションを設定。"
            />
            <FeatureCard
              title="ロケーション表示"
              description="表示ON/OFF・公開名・リンクURL の設定。"
            />
          </div>
        </div>

        {/* Pro で利用可能な機能 */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <span style={{ fontSize: "18px", fontWeight: 700, color: "#202223" }}>
              Pro プランで利用可能な機能
            </span>
            <span
              style={{
                fontSize: "12px",
                padding: "2px 8px",
                background: "#2c6ecb",
                color: "#fff",
                borderRadius: "4px",
              }}
            >
              Pro
            </span>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
              gap: "12px",
            }}
          >
            <FeatureCard
              title="エリア設定"
              description="ロケーションをエリアでグルーピング・折りたたみ・未設定の見出し。"
              pro
            />
            <FeatureCard
              title="近隣店舗表示"
              description="近隣店舗を優先表示・その他ロケーションの見出し。"
              pro
            />
            <FeatureCard
              title="店舗受け取り"
              description="「この店舗で受け取る」ボタン・ラベル・リダイレクト・モーダル。"
              pro
            />
            <FeatureCard
              title="分析（管理画面）"
              description="エリア表示回数・近隣クリック・店舗受け取りクリックなどの分析。"
              pro
            />
          </div>
        </div>
      </div>
    </s-page>
  );
}

function PlanCard({ name, priceDetail, summary, isCurrent, pricingPlansUrl, primary }) {
  return (
    <div
      style={{
        padding: "20px",
        background: "#fff",
        borderRadius: "8px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        border: isCurrent ? "2px solid #2c6ecb" : "1px solid #e1e3e5",
      }}
    >
      <div style={{ marginBottom: "12px", fontSize: "20px", fontWeight: 700 }}>{name}</div>
      <div style={{ marginBottom: "6px", fontSize: "14px", color: "#202223", lineHeight: 1.4 }}>
        {priceDetail}
      </div>
      <div style={{ marginBottom: "16px", fontSize: "14px", color: "#6d7175", lineHeight: 1.4 }}>
        {summary}
      </div>
      {isCurrent ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
          <span
            style={{
              display: "inline-block",
              padding: "4px 10px",
              background: "#cdfee1",
              color: "#0c5132",
              borderRadius: "8px",
              fontSize: "13px",
              fontWeight: 600,
            }}
          >
            利用中
          </span>
          {pricingPlansUrl && <PricingPlansButton href={pricingPlansUrl} label="Shopify でプランを変更" />}
        </div>
      ) : pricingPlansUrl ? (
        <PricingPlansButton href={pricingPlansUrl} label="このプランを選ぶ" primary={primary} />
      ) : null}
    </div>
  );
}

/** Shopify のプラン選択ページへ埋め込み画面の外（_top）で移るボタン */
function PricingPlansButton({ href, label, primary }) {
  return (
    <a
      href={href}
      target="_top"
      rel="noopener noreferrer"
      style={{
        display: "inline-block",
        padding: "6px 14px",
        background: primary ? "#303030" : "#fff",
        color: primary ? "#fff" : "#303030",
        border: primary ? "1px solid #303030" : "1px solid #c9cccf",
        borderRadius: "8px",
        fontSize: "13px",
        fontWeight: 600,
        textDecoration: "none",
      }}
    >
      {label}
    </a>
  );
}

function FeatureCard({ title, description, pro }) {
  return (
    <div
      style={{
        padding: "16px",
        background: "#fff",
        borderRadius: "8px",
        boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
        border: "1px solid #e1e3e5",
      }}
    >
      <div style={{ marginBottom: "6px", display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ fontSize: "15px", fontWeight: 700, color: "#202223" }}>{title}</span>
        {pro && (
          <span
            style={{
              fontSize: "10px",
              padding: "2px 6px",
              background: "#2c6ecb",
              color: "#fff",
              borderRadius: "4px",
            }}
          >
            Pro
          </span>
        )}
      </div>
      <div style={{ fontSize: "13px", color: "#6d7175", lineHeight: 1.4 }}>{description}</div>
    </div>
  );
}
