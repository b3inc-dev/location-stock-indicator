// app/routes/webhooks.compliance.jsx
// 必須コンプライアンス Webhook（customers/data_request, customers/redact, shop/redact）
// authenticate.webhook(request) が HMAC を検証し、無効な場合は 401 を返す。
// topic の形（"SHOP_REDACT" / "shop/redact"）の違いは handleComplianceWebhook がそろえる。

import { authenticate } from "../shopify.server";
import db from "../db.server";
import { handleComplianceWebhook } from "../utils/complianceWebhook.js";
import { isShopStillInstalled } from "../utils/shopInstallProbe.server.js";

export const action = async ({ request }) => {
  // HMAC 検証：無効な場合は 401 Unauthorized が throw される
  const { topic, shop, payload } = await authenticate.webhook(request);

  try {
    const { status } = await handleComplianceWebhook({ topic, shop, payload, db, isShopStillInstalled });
    return new Response(null, { status });
  } catch (err) {
    // DB の失敗・入っているか確かめられないとき。500 を返し、Shopify にもう一度送ってもらう（何度来ても安全）。
    console.error("[compliance] handler error:", err);
    return new Response(null, { status: 500 });
  }
};
