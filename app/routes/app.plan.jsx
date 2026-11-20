// app/routes/app.plan.jsx - 料金プランページ（プラン選択＋プラン別機能の紹介）POS Stock 同様 UI
import { Form, redirect, useLoaderData, useOutletContext } from "react-router";
import { authenticate } from "../shopify.server";
import { getShopPlan } from "../utils/shopPlan.server.js";
import { createAppSubscription } from "../utils/billing.js";
import { createT, resolveAdminLocale } from "../i18n/adminI18n.js";

const APP_HANDLE = process.env.SHOPIFY_APP_HANDLE || "app";

export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shopPlan = await getShopPlan(admin, session?.shop);

  const storeHandle = session.shop.replace(".myshopify.com", "");
  const pricingPlansUrl = `https://admin.shopify.com/store/${storeHandle}/charges/${APP_HANDLE}/pricing_plans`;
  const url = new URL(request.url);
  const requiredFromQuery = url.searchParams.get("required") === "1";

  return { shopPlan, pricingPlansUrl, requiredFromQuery };
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
  const { shopPlan, pricingPlansUrl, requiredFromQuery } = useLoaderData();
  const outletContext = useOutletContext();
  const t =
    outletContext?.t ||
    createT(resolveAdminLocale(shopPlan));
  const { plan, locationsCount, distribution, isDevelopmentStore, locationPlanMismatch, maxLocationsForPlan, planRequired } =
    shopPlan ?? {};
  const isInhouse = distribution === "inhouse";
  const showRequiredBanner = Boolean(planRequired || requiredFromQuery);

  if (isInhouse) {
    return (
      <s-page heading={t("plan.heading")}>
        <div style={{ padding: "16px", maxWidth: "600px", margin: "0 16px" }}>
          <div
            style={{
              padding: "16px",
              background: "#fff",
              borderRadius: "8px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
            }}
          >
            <s-text emphasis="bold">{t("plan.inhouseTitle")}</s-text>
            <div style={{ marginTop: "8px" }}>
              <s-text tone="subdued" size="small">
                {t("plan.inhouseBody")}
              </s-text>
            </div>
          </div>
        </div>
      </s-page>
    );
  }

  return (
    <s-page heading={t("plan.heading")}>
      <div style={{ padding: "16px", maxWidth: "900px" }}>
        {showRequiredBanner && (
          <div
            style={{
              marginBottom: "16px",
              padding: "16px",
              background: "#eaf4ff",
              border: "1px solid #2c6ecb",
              borderRadius: "8px",
            }}
          >
            <s-text emphasis="bold">{t("plan.requiredTitle")}</s-text>
            <div style={{ marginTop: "8px" }}>
              <s-text size="small">
                {t("plan.requiredBody")}
              </s-text>
            </div>
          </div>
        )}
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
              {t("plan.mismatchTitle")}
            </div>
            <div style={{ fontSize: "14px", color: "#202223", marginBottom: "12px", lineHeight: 1.5 }}>
              {t("plan.mismatchBodyBefore")}{" "}
              <strong>{t("plan.mismatchLocations", { count: maxLocationsForPlan })}</strong>
              {t("plan.mismatchBodyMid")}
              <strong>{locationsCount}</strong>
              {t("plan.mismatchBodyAfter")}
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
              {t("plan.changeOnShopify")}
            </a>
            <div style={{ marginTop: "8px", fontSize: "13px", color: "#6d7175" }}>
              {t("plan.reloadAfterChange")}
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
            <s-text emphasis="bold">{t("plan.devTitle")}</s-text>
            <div style={{ marginTop: "4px" }}>
              <s-text tone="subdued" size="small">
                {t("plan.devBody")}
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
            <span style={{ fontSize: "18px", fontWeight: 700, color: "#202223" }}>{t("plan.sectionTitle")}</span>
            <span style={{ fontSize: "14px", color: "#6d7175" }}>{t("plan.locationCountLabel", { count: locationsCount })}</span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
            <PlanCard
              t={t}
              planKey="lite"
              name="Lite"
              priceSummary={t("plan.litePrice")}
              priceDetail={t("plan.liteDetail")}
              trial={t("plan.liteTrial")}
              summary={t("plan.liteSummary")}
              isCurrent={plan === "lite"}
            />
            <PlanCard
              t={t}
              planKey="pro"
              name="Pro"
              priceSummary={t("plan.proPrice")}
              priceDetail={t("plan.proDetail")}
              trial={t("plan.proTrial")}
              summary={t("plan.proSummary")}
              isCurrent={plan === "pro"}
            />
          </div>
        </div>

        {/* 全てのプランで利用可能な機能 */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ marginBottom: "12px", fontSize: "18px", fontWeight: 700, color: "#202223" }}>
            {t("plan.allPlansTitle")}
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
              title={t("plan.featureStockTitle")}
              description={t("plan.featureStockDesc")}
            />
            <FeatureCard
              title={t("plan.featureSortTitle")}
              description={t("plan.featureSortDesc")}
            />
            <FeatureCard
              title={t("plan.featureLocTitle")}
              description={t("plan.featureLocDesc")}
            />
          </div>
        </div>

        {/* Pro で利用可能な機能 */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
            <span style={{ fontSize: "18px", fontWeight: 700, color: "#202223" }}>
              {t("plan.proPlansTitle")}
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
              title={t("plan.featureAreaTitle")}
              description={t("plan.featureAreaDesc")}
              pro
            />
            <FeatureCard
              title={t("plan.featureNearbyTitle")}
              description={t("plan.featureNearbyDesc")}
              pro
            />
            <FeatureCard
              title={t("plan.featurePickupTitle")}
              description={t("plan.featurePickupDesc")}
              pro
            />
            <FeatureCard
              title={t("plan.featureAnalyticsTitle")}
              description={t("plan.featureAnalyticsDesc")}
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
                {t("plan.upgradeLink")}
              </a>
            </div>
          )}
        </div>
      </div>
    </s-page>
  );
}

function PlanCard({
  t,
  planKey,
  name,
  priceSummary,
  priceDetail,
  trial,
  summary,
  isCurrent,
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
          {t("plan.currentPlanBadge")}
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
            {t("plan.selectThisPlan")}
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
