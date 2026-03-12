/**
 * Location Stock Indicator：プラン情報の取得
 * カスタムアプリ・開発ストアは全機能、公開アプリは Lite/Pro で制限。
 * 設計: docs/PLAN_SETTINGS_DESIGN.md
 */

import {
  getPlanFromActiveSubscriptions,
  getUsageLineItemId,
  calculateUsageAmount,
  reportUsageRecord,
} from "./billing.js";

/**
 * カスタムアプリとして扱うストアのショップドメイン一覧（カンマ区切り）。
 * 例: CUSTOM_APP_STORE_IDS=my-store.myshopify.com
 */
function getCustomAppStoreIds() {
  const raw = process.env.CUSTOM_APP_STORE_IDS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * プラン情報を取得する。
 * @param {object} admin - GraphQL を実行する admin オブジェクト
 * @param {string} [currentShop] - ショップドメイン
 * @returns {Promise<{
 *   distribution: "inhouse"|"public";
 *   plan: "lite"|"pro"|null;
 *   features: { areas: boolean; nearby: boolean; storePickup: boolean; analytics: boolean };
 *   locationsCount: number;
 *   isDevelopmentStore: boolean;
 *   locationPlanMismatch?: boolean;
 *   maxLocationsForPlan?: number;
 * }>}
 */
export async function getShopPlan(admin, currentShop) {
  const customStoreIds = getCustomAppStoreIds();
  const shopNormalized = currentShop?.trim().toLowerCase();
  const forceInhouse = Boolean(
    shopNormalized && customStoreIds.some((id) => id.trim().toLowerCase() === shopNormalized)
  );
  const distEnv = (process.env.APP_DISTRIBUTION ?? "").trim().toLowerCase();
  const distribution = distEnv === "inhouse" || forceInhouse ? "inhouse" : "public";

  let locationsCount = 0;
  let isDevelopmentStore = false;
  let planFromBilling = null;
  let activeSubscriptions = [];

  try {
    const resp = await admin.graphql(
      `#graphql
        query ShopPlanAndLocations($first: Int!) {
          shop {
            plan {
              partnerDevelopment
            }
          }
          locations(first: $first) { nodes { id } }
          currentAppInstallation {
            activeSubscriptions {
              id
              name
              status
              currentPeriodEnd
              lineItems {
                id
                plan {
                  pricingDetails {
                    __typename
                  }
                }
              }
            }
          }
        }
      `,
      { variables: { first: 250 } }
    );
    const data = await resp.json().catch(() => null);
    if (data) {
      const d = data?.data;
      locationsCount = d?.locations?.nodes?.length ?? 0;
      isDevelopmentStore = d?.shop?.plan?.partnerDevelopment === true;
      activeSubscriptions = d?.currentAppInstallation?.activeSubscriptions ?? [];
      planFromBilling = getPlanFromActiveSubscriptions(activeSubscriptions);
    }
  } catch {
    // ignore
  }

  let plan = null;
  if (distribution === "inhouse") {
    plan = "pro";
  } else if (isDevelopmentStore) {
    plan = "pro";
  } else {
    plan = planFromBilling;
  }

  // 開発ストアで Lite の挙動を確認する用（FORCE_PLAN_LITE=1 のときプランを lite に強制）
  if (process.env.FORCE_PLAN_LITE === "1") {
    plan = "lite";
  }

  const features = {
    areas: distribution === "inhouse" || plan === "pro",
    nearby: distribution === "inhouse" || plan === "pro",
    storePickup: distribution === "inhouse" || plan === "pro",
    analytics: distribution === "inhouse" || plan === "pro",
  };

  // Pro の従量課金報告（公開・本番・Pro・ロケーション数に応じて）
  if (distribution === "public" && !isDevelopmentStore && plan === "pro" && locationsCount > 0) {
    const active = activeSubscriptions.filter(
      (s) => String(s?.status || "").toUpperCase() === "ACTIVE"
    );
    const sub = active.find(
      (s) => getUsageLineItemId(s) && s.currentPeriodEnd
    );
    const usageLineItemId = sub ? getUsageLineItemId(sub) : null;
    const periodEnd = sub?.currentPeriodEnd;
    if (usageLineItemId && periodEnd) {
      const { amountUsd } = calculateUsageAmount(plan, locationsCount);
      if (amountUsd > 0) {
        const idempotencyKey = `usage-${sub.id}-${periodEnd}`;
        const description = `${locationsCount} location(s): $${amountUsd.toFixed(2)}`;
        reportUsageRecord(
          admin,
          usageLineItemId,
          amountUsd,
          description,
          idempotencyKey
        ).catch(() => {});
      }
    }
  }

  // Lite のときロケーション数が 10 を超えていたらプラン不一致
  let locationPlanMismatch = false;
  let maxLocationsForPlan;
  if (distribution === "public" && !forceInhouse && plan === "lite" && locationsCount > 10) {
    locationPlanMismatch = true;
    maxLocationsForPlan = 10;
  }

  return {
    distribution,
    plan,
    features,
    locationsCount,
    isDevelopmentStore,
    ...(locationPlanMismatch ? { locationPlanMismatch: true, maxLocationsForPlan } : {}),
  };
}
