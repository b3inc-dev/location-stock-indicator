// 必須コンプライアンス Webhook の topic の形をそろえ、トピックごとの処理をする。
//
// @shopify/shopify-app-react-router の authenticate.webhook() が返す topic は
// "SHOP_REDACT" のような大文字＋アンダースコアの形（公式ガイドの switch 例）。
// ヘッダーそのままの "shop/redact" の形が来ても同じに扱えるよう、両方を受ける。

export const COMPLIANCE_TOPICS = Object.freeze({
  CUSTOMERS_DATA_REQUEST: "CUSTOMERS_DATA_REQUEST",
  CUSTOMERS_REDACT: "CUSTOMERS_REDACT",
  SHOP_REDACT: "SHOP_REDACT",
});

/**
 * "shop/redact" / "SHOP_REDACT" / " Shop/Redact " などを "SHOP_REDACT" にそろえる。
 * @param {unknown} topic
 * @returns {string}
 */
export function normalizeWebhookTopic(topic) {
  return String(topic ?? "")
    .trim()
    .toUpperCase()
    .replace(/[/.\s-]+/g, "_");
}

/**
 * @param {{
 *   topic: unknown,
 *   shop?: string | null,
 *   payload?: any,
 *   db: any,
 *   isShopStillInstalled: (shop: string) => Promise<boolean>,
 *   log?: (...args: any[]) => void,
 * }} args
 * @returns {Promise<{ status: number, handled: string | null, skipped?: string }>}
 */
export async function handleComplianceWebhook({ topic, shop, payload, db, isShopStillInstalled, log = console.log }) {
  const normalized = normalizeWebhookTopic(topic);

  switch (normalized) {
    case COMPLIANCE_TOPICS.CUSTOMERS_DATA_REQUEST: {
      // このアプリは顧客ごとのデータを DB に持たない（セッションと店の設定だけ）。渡すデータはない。
      log(`[compliance] customers/data_request for ${shop}`, payload?.data_request?.id ?? "");
      return { status: 200, handled: normalized };
    }
    case COMPLIANCE_TOPICS.CUSTOMERS_REDACT: {
      // 顧客ごとのデータを持たないので消すものはない。
      log(`[compliance] customers/redact for ${shop}`, payload?.customer?.id ?? "");
      return { status: 200, handled: normalized };
    }
    case COMPLIANCE_TOPICS.SHOP_REDACT: {
      // アンインストールの 48 時間後に届く。この店の DB の行をすべて消す。
      const shopDomain = shop || payload?.shop_domain || null;
      if (!shopDomain) {
        log("[compliance] shop/redact without shop domain; nothing deleted");
        return { status: 200, handled: normalized, skipped: "no_shop" };
      }
      // 48 時間のうちに入れ直した店なら、入れ直したあとのセッションを消さない。
      // 確かめられないとき（通信の失敗など）は投げて 500 にし、Shopify にもう一度送ってもらう。
      if (typeof isShopStillInstalled !== "function") {
        throw new Error("isShopStillInstalled is required for shop/redact");
      }
      if (await isShopStillInstalled(shopDomain)) {
        log(`[compliance] shop/redact for ${shopDomain}: app is installed again; skipped delete`);
        return { status: 200, handled: normalized, skipped: "reinstalled" };
      }
      const result = await db.session.deleteMany({ where: { shop: shopDomain } });
      log(`[compliance] shop/redact for ${shopDomain}: sessions deleted`, result?.count ?? 0);
      return { status: 200, handled: normalized };
    }
    default: {
      log(`[compliance] unexpected topic ${String(topic)} for ${shop}`);
      return { status: 200, handled: null };
    }
  }
}
