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

const SHOP_PLAN_QUERY = `#graphql
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
 * @param {object} [_options] - 互換のため受け取るだけ（以前の reportUsage。Managed Pricing では従量報告をしない）
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
 * }>}
 */
// eslint-disable-next-line no-unused-vars
export async function getShopPlan(admin, currentShop, _options = {}) {
  const { distribution, forceInhouse } = getPlanDistribution(currentShop);

  let locationsCount = 0;
  let isDevelopmentStore = false;
  let planFromBilling = null;
  /** Shopify から契約の一覧を読めたか（読めない＝未契約とは言えない） */
  let subscriptionsRead = false;

  try {
    const resp = await admin.graphql(SHOP_PLAN_QUERY, { variables: { first: 250 } });
    const data = await resp.json().catch(() => null);
    const d = data?.data;
    locationsCount = d?.locations?.nodes?.length ?? 0;
    isDevelopmentStore = d?.shop?.plan?.partnerDevelopment === true;
    const subs = d?.currentAppInstallation?.activeSubscriptions;
    if (Array.isArray(subs)) {
      subscriptionsRead = true;
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

  return {
    distribution,
    plan,
    features,
    locationsCount,
    isDevelopmentStore,
    ...(planRequired ? { planRequired: true } : {}),
    ...(planCheckFailed ? { planCheckFailed: true } : {}),
    ...(locationPlanMismatch ? { locationPlanMismatch: true, maxLocationsForPlan } : {}),
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
