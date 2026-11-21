/**
 * Location Stock Indicator：プラン情報の取得
 * 自社用（inhouse）は全機能。公開用は Shopify App Pricing（Managed Pricing）の契約で Lite / Pro を決める。
 * 開発ストアも契約で決める（Shopify のテスト課金で請求なし）。
 * 契約を読めなかったときは planCheckFailed（fail-closed。未契約とは分けて出す）。
 * 設計: docs/PLAN_SETTINGS_DESIGN.md
 */

import { getMaxLocationsForPlan, getPlanFromActiveSubscriptions } from "./billing.js";
import {
  ADMIN_WRITE_BLOCK_MESSAGES,
  adminWriteBlockReason,
  isProFeaturesAllowed,
  isStorefrontInventoryAllowed,
  requiresPlanSelection,
} from "./planGate.js";
import { resolvePlanDistribution } from "./planDistribution.js";
import { computeProLocationUsage, reportProLocationUsage } from "./appEventsUsage.server.js";

const SHOP_PLAN_QUERY = `#graphql
  query ShopPlanAndLocations($first: Int!) {
    shop {
      id
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
      }
    }
  }
`;

/**
 * このサーバー・この店が自社用か公開用か（GraphQL を呼ばない）。
 * @param {string|null|undefined} shop
 */
export function getPlanDistribution(shop) {
  return resolvePlanDistribution(process.env, shop);
}

/**
 * プラン情報を取得する。
 * @param {object} admin - GraphQL を実行する admin オブジェクト
 * @param {string} [currentShop] - ショップドメイン
 * @param {{ reportUsage?: boolean }} [options] - reportUsage: true のときだけ Pro の従量（App Events API）を待たずに報告する。
 *   管理画面のレイアウト（app.jsx）だけが true を渡す。ストアフロント（App Proxy）・保存の門番は渡さない（課金の副作用を付けない）
 * @returns {Promise<{
 *   distribution: "inhouse"|"public";
 *   plan: "lite"|"pro"|null;
 *   features: {
 *     basicDisplay: boolean;
 *     areas: boolean;
 *     nearby: boolean;
 *     storePickup: boolean;
 *     analytics: boolean;
 *   };
 *   locationsCount: number;
 *   isDevelopmentStore: boolean;
 *   planRequired?: boolean;
 *   planCheckFailed?: boolean;
 *   locationPlanMismatch?: boolean;
 *   maxLocationsForPlan?: number;
 *   proLocationUsage?: { units: number; unitPriceUsd: number; amountUsd: number; periodEnd: string|null };
 * }>}
 */
export async function getShopPlan(admin, currentShop, options = {}) {
  const { distribution, forceInhouse } = getPlanDistribution(currentShop);

  let locationsCount = 0;
  let isDevelopmentStore = false;
  let planFromBilling = null;
  let shopGid = null;
  /** @type {Array<{ status?: string; currentPeriodEnd?: string|null }>} */
  let activeSubs = [];
  /** Shopify から契約の一覧を読めたか（読めない＝未契約とは言えない） */
  let subscriptionsRead = false;

  try {
    const resp = await admin.graphql(SHOP_PLAN_QUERY, { variables: { first: 250 } });
    const data = await resp.json().catch(() => null);
    const d = data?.data;
    locationsCount = d?.locations?.nodes?.length ?? 0;
    isDevelopmentStore = d?.shop?.plan?.partnerDevelopment === true;
    shopGid = typeof d?.shop?.id === "string" ? d.shop.id : null;
    const subs = d?.currentAppInstallation?.activeSubscriptions;
    if (Array.isArray(subs)) {
      subscriptionsRead = true;
      activeSubs = subs;
      planFromBilling = getPlanFromActiveSubscriptions(subs);
    } else if (distribution === "public") {
      const errs = Array.isArray(data?.errors) ? data.errors.map((e) => e?.message).join("; ") : "";
      console.warn("[getShopPlan] activeSubscriptions missing in response:", errs || "(no errors field)");
    }
  } catch (e) {
    console.warn("[getShopPlan] plan query failed:", e instanceof Error ? e.message : String(e));
  }

  let plan = null;
  let planCheckFailed = false;
  if (distribution === "inhouse") {
    plan = "pro";
  } else {
    plan = planFromBilling;
    planCheckFailed = !subscriptionsRead;
    if (planCheckFailed) {
      console.warn(
        "[getShopPlan] could not read activeSubscriptions; blocking until it can be read. shop=",
        currentShop
      );
    }
  }

  const planSnapshot = { distribution, plan, planCheckFailed };
  const proOk = isProFeaturesAllowed(planSnapshot);
  const features = {
    basicDisplay: isStorefrontInventoryAllowed(planSnapshot),
    areas: proOk,
    nearby: proOk,
    storePickup: proOk,
    analytics: proOk,
  };
  const planRequired = requiresPlanSelection(planSnapshot);

  // Lite でロケーション数が上限を超えていたらプラン不一致
  let locationPlanMismatch = false;
  let maxLocationsForPlan;
  const maxForPlan = getMaxLocationsForPlan(plan);
  if (distribution === "public" && !forceInhouse && maxForPlan != null && locationsCount > maxForPlan) {
    locationPlanMismatch = true;
    maxLocationsForPlan = maxForPlan;
  }

  // Pro の従量（$2 × ロケーション数）。公開用・Pro のときだけ。1 請求期間に 1 回だけ App Events API で送る
  // （送るか・失敗の記録は appEventsUsage.server.js。ここでは待たない）
  let proLocationUsage;
  if (distribution === "public" && !forceInhouse && plan === "pro") {
    const usage = computeProLocationUsage(plan, locationsCount);
    if (usage.units > 0) {
      const periodEnd =
        activeSubs.find((s) => String(s?.status || "").toUpperCase() === "ACTIVE" && s?.currentPeriodEnd)?.currentPeriodEnd ?? null;
      proLocationUsage = { units: usage.units, unitPriceUsd: usage.unitPriceUsd, amountUsd: usage.amountUsd, periodEnd };
      const shopForReport = String(currentShop ?? "").trim().toLowerCase();
      if (options?.reportUsage === true && shopForReport) {
        void import("../db.server.js")
          .then(({ default: prisma }) =>
            reportProLocationUsage(
              { shop: shopForReport, shopGid, plan, locationsCount, periodEnd },
              { store: prisma.appUsageReport }
            )
          )
          .catch((e) => {
            console.error("[getShopPlan] pro location usage report crashed:", e instanceof Error ? e.message : String(e));
          });
      }
    }
  }

  return {
    distribution,
    plan,
    features,
    locationsCount,
    isDevelopmentStore,
    ...(planRequired ? { planRequired: true } : {}),
    ...(planCheckFailed ? { planCheckFailed: true } : {}),
    ...(locationPlanMismatch ? { locationPlanMismatch: true, maxLocationsForPlan } : {}),
    ...(proLocationUsage ? { proLocationUsage } : {}),
  };
}

/**
 * 管理画面の設定保存（action）の門番。action は親（app.jsx）の loader を通らないので、ここで止める。
 * 自社用は GraphQL を呼ばずに通す（Ciara の保存の速さを変えない）。
 * @param {object} admin
 * @param {string|null|undefined} shop
 * @returns {Promise<null | { ok: false, error: string, planBlock: string }>} 止めるときだけ返す
 */
export async function adminWritePlanBlock(admin, shop) {
  const { distribution } = getPlanDistribution(shop);
  if (distribution === "inhouse") return null;
  let shopPlan = null;
  try {
    shopPlan = await getShopPlan(admin, shop ?? undefined);
  } catch (e) {
    console.warn("[adminWritePlanBlock] getShopPlan failed:", e instanceof Error ? e.message : String(e));
  }
  const reason = adminWriteBlockReason(shopPlan);
  if (!reason) return null;
  console.warn(`[plan-gate] admin write blocked: shop=${shop} reason=${reason}`);
  return { ok: false, error: ADMIN_WRITE_BLOCK_MESSAGES[reason], planBlock: reason };
}
