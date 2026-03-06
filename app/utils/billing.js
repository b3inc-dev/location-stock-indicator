/**
 * Location Stock Indicator：公開アプリ用 Billing ユーティリティ
 * - Lite: $20/月 定額・10ロケーションまで
 * - Pro: $20/月 ＋ ロケーション数 × $2（Usage）
 * 設計: docs/PLAN_SETTINGS_DESIGN.md
 */

/**
 * アクティブなサブスクリプション一覧からプランを判定する。
 * 名前に "Pro" を含む → pro、"Lite" を含む → lite。複数ある場合は Pro を優先。
 * @param {Array<{ name?: string; status?: string }>} subscriptions
 * @returns {"lite"|"pro"|null}
 */
export function getPlanFromActiveSubscriptions(subscriptions) {
  if (!Array.isArray(subscriptions) || subscriptions.length === 0) return null;
  const active = subscriptions.filter((s) => String(s?.status || "").toUpperCase() === "ACTIVE");
  if (active.length === 0) return null;
  const hasPro = active.some((s) => /pro/i.test(String(s?.name || "")));
  const hasLite = active.some((s) => /lite/i.test(String(s?.name || "")));
  if (hasPro) return "pro";
  if (hasLite) return "lite";
  return null;
}

/**
 * Lite プランは 10 ロケーションまで。サブスク名に "Lite" を含む場合は 10 を返す。
 * Pro は制限なしなので null。
 * @param {string} name
 * @returns {10|null}
 */
export function getMaxLocationsFromSubscriptionName(name) {
  const n = String(name || "").trim();
  if (!n) return null;
  if (/lite/i.test(n)) return 10;
  return null; // Pro は上限なし
}

/** Pro の従量単価（USD/ロケーション/月） */
export const USAGE_PRICE_PER_LOCATION = 2;

/** 基本料金（USD/30日） */
export const BASE_PRICE = { lite: 20, pro: 20 };

/** Pro の Usage 上限（USD/月）目安 */
export const USAGE_CAP_USD = 500;

/** トライアル日数 */
export const TRIAL_DAYS = { lite: 7, pro: 14 };

/**
 * Pro の従量料金を計算する。$2 × ロケーション数。Lite は 0。
 * @param {"lite"|"pro"} plan
 * @param {number} locationsCount
 * @returns {{ amountUsd: number }}
 */
export function calculateUsageAmount(plan, locationsCount) {
  if (plan !== "pro" || locationsCount <= 0) return { amountUsd: 0 };
  return { amountUsd: locationsCount * USAGE_PRICE_PER_LOCATION };
}

/**
 * Usage 用の LineItem（AppUsagePricing の __typename を持つ行）の id を取得する。
 * @param {object} subscription - lineItems を持つサブスクリプション
 * @returns {string|null}
 */
export function getUsageLineItemId(subscription) {
  const items = subscription?.lineItems ?? [];
  for (const item of items) {
    const typename = item?.plan?.pricingDetails?.__typename ?? "";
    if (typename === "AppUsagePricing") {
      return item.id ?? null;
    }
  }
  return null;
}

/**
 * 従量課金を 1 件報告する。同一請求期間の重複は idempotencyKey で防止。
 * @param {object} admin - graphql メソッドを持つオブジェクト
 * @param {string} subscriptionLineItemId
 * @param {number} amountUsd
 * @param {string} description
 * @param {string} idempotencyKey
 * @returns {Promise<{ success: boolean; userErrors?: Array<{ message: string }> }>}
 */
export async function reportUsageRecord(
  admin,
  subscriptionLineItemId,
  amountUsd,
  description,
  idempotencyKey
) {
  if (amountUsd <= 0) return { success: true };
  const mutation = `#graphql
    mutation AppUsageRecordCreate(
      $subscriptionLineItemId: ID!,
      $price: MoneyInput!,
      $description: String!,
      $idempotencyKey: String
    ) {
      appUsageRecordCreate(
        subscriptionLineItemId: $subscriptionLineItemId,
        price: $price,
        description: $description,
        idempotencyKey: $idempotencyKey
      ) {
        userErrors { message }
        appUsageRecord { id }
      }
    }
  `;
  const resp = await admin.graphql(mutation, {
    variables: {
      subscriptionLineItemId,
      price: { amount: amountUsd.toFixed(2), currencyCode: "USD" },
      description,
      idempotencyKey,
    },
  });
  const data = await resp.json();
  const payload = data?.data?.appUsageRecordCreate;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length > 0) {
    return { success: false, userErrors };
  }
  return { success: true };
}

/**
 * サブスクリプションを作成し、承認用 URL を返す。
 * Lite: Recurring $20 のみ。Pro: Recurring $20 ＋ Usage $2/ロケーション。
 * @param {object} admin - graphql メソッドを持つオブジェクト
 * @param {"lite"|"pro"} plan
 * @param {string} returnUrl
 * @returns {Promise<{ confirmationUrl: string|null; userErrors: Array<{ message: string }> }>}
 */
export async function createAppSubscription(admin, plan, returnUrl) {
  const trialDays = TRIAL_DAYS[plan];
  const basePrice = BASE_PRICE[plan];

  if (plan === "lite") {
    const name = "Lite - 10 locations";
    const mutation = `#graphql
      mutation AppSubscriptionCreate(
        $name: String!,
        $returnUrl: URL!,
        $lineItems: [AppSubscriptionLineItemInput!]!,
        $trialDays: Int
      ) {
        appSubscriptionCreate(
          name: $name,
          returnUrl: $returnUrl,
          lineItems: $lineItems,
          trialDays: $trialDays
        ) {
          userErrors { message }
          confirmationUrl
          appSubscription { id }
        }
      }
    `;
    const lineItems = [
      {
        plan: {
          appRecurringPricingDetails: {
            price: { amount: String(basePrice), currencyCode: "USD" },
            interval: "EVERY_30_DAYS",
          },
        },
      },
    ];
    const resp = await admin.graphql(mutation, {
      variables: { name, returnUrl, lineItems, trialDays },
    });
    const data = await resp.json();
    const payload = data?.data?.appSubscriptionCreate;
    const userErrors = payload?.userErrors ?? [];
    if (userErrors.length > 0) {
      return { confirmationUrl: null, userErrors };
    }
    return { confirmationUrl: payload?.confirmationUrl ?? null, userErrors: [] };
  }

  // Pro: Recurring $20 + Usage $2 per location
  const name = "Pro - usage per location";
  const terms = "$2 per location per month";
  const mutation = `#graphql
    mutation AppSubscriptionCreate(
      $name: String!,
      $returnUrl: URL!,
      $lineItems: [AppSubscriptionLineItemInput!]!,
      $trialDays: Int
    ) {
      appSubscriptionCreate(
        name: $name,
        returnUrl: $returnUrl,
        lineItems: $lineItems,
        trialDays: $trialDays
      ) {
        userErrors { message }
        confirmationUrl
        appSubscription { id }
      }
    }
  `;
  const lineItems = [
    {
      plan: {
        appUsagePricingDetails: {
          terms,
          cappedAmount: { amount: String(USAGE_CAP_USD), currencyCode: "USD" },
        },
      },
    },
    {
      plan: {
        appRecurringPricingDetails: {
          price: { amount: String(basePrice), currencyCode: "USD" },
          interval: "EVERY_30_DAYS",
        },
      },
    },
  ];
  const resp = await admin.graphql(mutation, {
    variables: { name, returnUrl, lineItems, trialDays },
  });
  const data = await resp.json();
  const payload = data?.data?.appSubscriptionCreate;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length > 0) {
    return { confirmationUrl: null, userErrors };
  }
  return { confirmationUrl: payload?.confirmationUrl ?? null, userErrors: [] };
}
