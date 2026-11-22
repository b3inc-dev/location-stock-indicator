// app/routes/webhooks.compliance.jsx
// 必須コンプライアンス Webhook（customers/data_request, customers/redact, shop/redact）
// authenticate.webhook(request) が HMAC を検証し、無効な場合は 401 を返す。
// topic の形（"SHOP_REDACT" / "shop/redact"）の違いは handleComplianceWebhook がそろえる。

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { handleComplianceWebhook, normalizeWebhookTopic } from "../utils/complianceWebhook.js";
import { isShopStillInstalled } from "../utils/shopInstallProbe.server.js";
import { redactPosLiteOrders, requestFromAdmin } from "../utils/posLiteSale.js";

export const action = async ({ request }) => {
  // HMAC 検証：無効な場合は 401 Unauthorized が throw される
  const { topic, shop, payload, admin } = await authenticate.webhook(request);

  try {
    // POS Lite の配送: 注文の属性・配送の記録に残る配送先のコピーを消す（アプリの DB には持たない）。
    // 入っていない店（admin が無い）は、アプリから注文を触れないので消すものはない。
    if (normalizeWebhookTopic(topic) === "CUSTOMERS_REDACT" && admin) {
      const orders = Array.isArray(payload?.orders_to_redact) ? payload.orders_to_redact : [];
      if (orders.length) {
        const { scrubbed } = await redactPosLiteOrders(requestFromAdmin(admin), orders);
        console.log(`[compliance] customers/redact for ${shop}: pos-lite delivery copies scrubbed`, scrubbed);
      }
    }
    const { status } = await handleComplianceWebhook({ topic, shop, payload, db, isShopStillInstalled });
    return new Response(null, { status });
  } catch (err) {
    // DB の失敗・入っているか確かめられないとき。500 を返し、Shopify にもう一度送ってもらう（何度来ても安全）。
    console.error("[compliance] handler error:", err);
    return new Response(null, { status: 500 });
  }
};
