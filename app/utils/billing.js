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
 * テスト課金（test: true）にするか。
 * - 開発ストア（審査用の店も含む）では、本物の請求を作らずに承認の流れを試せるようにする。
 * - SHOPIFY_BILLING_TEST=1 は開発中の確認用。NODE_ENV=production では効かせない
 *   （公開用の本番 Render に残っていても、本当の店がテスト課金にならないように）。そのときは強い警告をログに出す。
 * @param {{ isDevelopmentStore?: boolean } | null | undefined} shopPlan
 * @param {Record<string, string | undefined>} [env]
 * @param {(...args: any[]) => void} [warn]
 * @returns {boolean}
 */
export function shouldUseTestCharge(shopPlan, env = process.env, warn = console.warn) {
  if (shopPlan?.isDevelopmentStore === true) return true;
  const flag = String(env?.SHOPIFY_BILLING_TEST ?? "").trim() === "1";
  if (!flag) return false;
  if (String(env?.NODE_ENV ?? "").trim() === "production") {
    warn(
      "[billing] WARNING: SHOPIFY_BILLING_TEST=1 is set in production. It is ignored; real charges are created. Remove it from this server's environment.",
    );
    return false;
  }
  return true;
}

/**
 * 承認のあとに戻る先（管理画面の中のアプリの URL）。
 * ライブラリの billing.request が初めから使う形と同じ: https://admin.shopify.com/store/<店>/apps/<client_id><path>
 * Shopify は承認のあと returnUrl を iframe の外で開き charge_id だけを付けるので、
 * アプリの URL（?shop= だけ）では authenticate.admin が host を読めずに戻れない。
 * @param {string | null | undefined} shop - xxx.myshopify.com
 * @param {string | null | undefined} apiKey - SHOPIFY_API_KEY（client_id）
 * @param {string} [path] - アプリの中の道（既定 /app/plan）
 * @returns {string | null}
 */
export function buildEmbeddedReturnUrl(shop, apiKey, path = "/app/plan") {
  const key = String(apiKey ?? "").trim();
  const storeHandle = String(shop ?? "").trim().replace(/\.myshopify\.com$/i, "");
  if (!key || !storeHandle) return null;
  const p = path.startsWith("/") ? path : `/${path}`;
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/apps/${encodeURIComponent(key)}${p}`;
}

/**
 * Shopify 管理画面のプラン選択ページの URL。
 * アプリのハンドルが分からないときは null（間違った URL を作らない）。
 * @param {string | null | undefined} shop - xxx.myshopify.com
 * @param {string | null | undefined} appHandle - Partner のアプリのハンドル（SHOPIFY_APP_HANDLE）
 * @returns {string | null}
 */
export function buildPricingPlansUrl(shop, appHandle) {
  const handle = String(appHandle ?? "").trim();
  const storeHandle = String(shop ?? "").trim().replace(/\.myshopify\.com$/i, "");
  if (!handle || !storeHandle) return null;
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/charges/${encodeURIComponent(handle)}/pricing_plans`;
}

/**
 * サブスクリプションを作成し、承認用 URL を返す。
 * Lite: Recurring $20 のみ。Pro: Recurring $20 ＋ Usage $2/ロケーション。
 * @param {object} admin - graphql メソッドを持つオブジェクト
 * @param {"lite"|"pro"} plan
 * @param {string} returnUrl
 * @param {{ test?: boolean }} [options] - test: true でテスト課金（開発ストア用）
 * @returns {Promise<{ confirmationUrl: string|null; userErrors: Array<{ message: string }> }>}
 */
export async function createAppSubscription(admin, plan, returnUrl, options = {}) {
  const test = options.test === true;
  const trialDays = TRIAL_DAYS[plan];
  const basePrice = BASE_PRICE[plan];

  if (plan === "lite") {
    const name = "Lite - 10 locations";
    const mutation = `#graphql
      mutation AppSubscriptionCreate(
        $name: String!,
        $returnUrl: URL!,
        $lineItems: [AppSubscriptionLineItemInput!]!,
        $trialDays: Int,
        $test: Boolean
      ) {
        appSubscriptionCreate(
          name: $name,
          returnUrl: $returnUrl,
          lineItems: $lineItems,
          trialDays: $trialDays,
          test: $test
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
      variables: { name, returnUrl, lineItems, trialDays, test },
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
      $trialDays: Int,
      $test: Boolean
    ) {
      appSubscriptionCreate(
        name: $name,
        returnUrl: $returnUrl,
        lineItems: $lineItems,
        trialDays: $trialDays,
        test: $test
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
    variables: { name, returnUrl, lineItems, trialDays, test },
  });
  const data = await resp.json();
  const payload = data?.data?.appSubscriptionCreate;
  const userErrors = payload?.userErrors ?? [];
  if (userErrors.length > 0) {
    return { confirmationUrl: null, userErrors };
  }
  return { confirmationUrl: payload?.confirmationUrl ?? null, userErrors: [] };
}
