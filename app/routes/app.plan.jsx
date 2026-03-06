// app/routes/app.plan.jsx - 料金プランページ（プラン選択＋プラン別機能の紹介）POS Stock 同様 UI
import { Form, redirect, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopPlan } from "../utils/shopPlan.server.js";
import { createAppSubscription } from "../utils/billing.js";

const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "app";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shopPlan = await getShopPlan(admin, session?.shop);

  const storeHandle = session.shop.replace(".myshopify.com", "");
  const pricingPlansUrl = `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;

  return { shopPlan, pricingPlansUrl };
}

/** プラン選択ボタン押下: サブスク作成 → Shopify の承認 URL へリダイレクト */
export async function action({ request }) {
  if (request.method !== "POST") return null;
  const formData = await request.formData();
  const plan = formData.get("plan");
  if (plan !== "lite" && plan !== "pro") return null;

  const { admin, session } = await authenticate.admin(request);
  const shopPlan = await getShopPlan(admin, session?.shop);
  if (shopPlan.distribution === "inhouse") return null;

  const url = new URL(request.url);
  const returnUrl = `${url.origin}${url.pathname}`;
  const { confirmationUrl, userErrors } = await createAppSubscription(admin, plan, returnUrl);
  if (userErrors.length > 0 || !confirmationUrl) {
    return redirect(`${url.pathname}?billingError=1`);
  }
  return redirect(confirmationUrl);
}

export default function PlanPage() {
  const { shopPlan, pricingPlansUrl } = useLoaderData();
  const { plan, locationsCount, distribution, isDevelopmentStore, locationPlanMismatch, maxLocationsForPlan } =
    shopPlan ?? {};
  const isInhouse = distribution === "inhouse";

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
        {locationPlanMismatch && maxLocationsForPlan != null && (
          <div
            style={{
              marginBottom: "16px",
              padding: "16px",
              background: "#fff4e5",
              border: "1px solid #e0b252",
              borderRadius: "8px",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: 700, color: "#202223", marginBottom: "8px" }}>
              ロケーション数がプランと一致していません
            </div>
            <div style={{ fontSize: "14px", color: "#202223", marginBottom: "12px", lineHeight: 1.5 }}>
              現在のプランは<strong>{maxLocationsForPlan}ロケーション</strong>までです。ストアのロケーション数は
              <strong>{locationsCount}</strong>のため、プラン変更が必要です。変更が反映されるまで設定などの機能はご利用いただけません。
            </div>
            <a
              href={pricingPlansUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                padding: "10px 20px",
                background: "#2c6ecb",
                color: "#fff",
                borderRadius: "6px",
                fontSize: "14px",
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Shopify でプランを変更する
            </a>
            <div style={{ marginTop: "8px", fontSize: "13px", color: "#6d7175" }}>
              プラン変更後、このページを再読み込みしてください。
            </div>
          </div>
        )}

        {isDevelopmentStore && (
          <div
            style={{
              marginBottom: "16px",
              padding: "12px 16px",
              background: "#e3f1df",
              borderRadius: "8px",
              borderLeft: "4px solid #008060",
            }}
          >
            <s-text emphasis="bold">開発ストアのため課金は発生しません</s-text>
            <div style={{ marginTop: "4px" }}>
              <s-text tone="subdued" size="small">
                全機能をご利用いただけます。本番ストアでは下記の料金が適用されます。
              </s-text>
            </div>
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
              planKey="lite"
              name="Lite"
              priceSummary="$20/月"
              priceDetail="10ロケーションまで。定額です。"
              trial="7日間無料"
              summary="基本の在庫表示・並び順・閾値・公開名・リンクなど。エリア・近隣店舗・店舗受け取り・分析は Pro でご利用いただけます。"
              isCurrent={plan === "lite"}
              pricingPlansUrl={pricingPlansUrl}
            />
            <PlanCard
              planKey="pro"
              name="Pro"
              priceSummary="$20/月〜"
              priceDetail="$20 ＋ 1ロケーションあたり $2/月（ロケーション数に制限なし）"
              trial="14日間無料"
              summary="エリア設定・近隣店舗表示・店舗受け取りボタン・分析（管理画面）を含む全機能。"
              isCurrent={plan === "pro"}
              pricingPlansUrl={pricingPlansUrl}
            />
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
          {plan !== "pro" && (
            <div style={{ marginTop: "16px" }}>
              <a
                href={pricingPlansUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: "14px", color: "#2c6ecb" }}
              >
                アップグレードして全機能を使う →
              </a>
            </div>
          )}
        </div>
      </div>
    </s-page>
  );
}

function PlanCard({
  planKey,
  name,
  priceSummary,
  priceDetail,
  trial,
  summary,
  isCurrent,
  pricingPlansUrl,
}) {
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
      <div style={{ marginBottom: "6px", fontSize: "18px", fontWeight: 700, color: "#202223" }}>
        {priceSummary}
      </div>
      <div style={{ marginBottom: "6px", fontSize: "12px", color: "#6d7175", lineHeight: 1.4 }}>
        {priceDetail}
      </div>
      <div style={{ marginBottom: "12px", fontSize: "13px", color: "#6d7175" }}>{trial}</div>
      <div style={{ marginBottom: "16px", fontSize: "14px", color: "#6d7175", lineHeight: 1.4 }}>
        {summary}
      </div>
      {isCurrent ? (
        <div
          style={{
            display: "inline-block",
            padding: "8px 16px",
            background: "#e1e3e5",
            color: "#414f3b",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: 500,
          }}
        >
          このプランを利用中
        </div>
      ) : (
        <Form method="post" style={{ display: "inline-block" }}>
          <input type="hidden" name="plan" value={planKey} />
          <button
            type="submit"
            style={{
              padding: "8px 16px",
              background: "#2c6ecb",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            このプランを選択する
          </button>
        </Form>
      )}
    </div>
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
