// app/routes/webhooks.compliance.jsx
// 必須コンプライアンス Webhook（customers/data_request, customers/redact, shop/redact）
// authenticateWebhook(request)（中で authenticate.webhook）が HMAC を検証し、無効な場合は 401 を返す。
// topic の形（"SHOP_REDACT" / "shop/redact"）の違いは handleComplianceWebhook がそろえる。

import { authenticateWebhook } from "../utils/webhookAuth.server.js";
import db from "../db.server";
import { handleComplianceWebhook, planPosLiteRedact } from "../utils/complianceWebhook.js";
import { isShopStillInstalled } from "../utils/shopInstallProbe.server.js";
import { redactPosLiteOrders, requestFromAdmin } from "../utils/posLiteSale.js";

export const action = async ({ request }) => {
  // HMAC 検証：無効な場合は 401 Unauthorized が throw される
  // （外した店でトークンの更新に失敗したときも 500 にせず、セッション無しで受ける: webhookAuth.js）
  const { topic, shop, payload, admin, sessionRefreshFailed } = await authenticateWebhook(request);

  try {
    // POS Lite の配送: 注文の属性・配送の記録に残る配送先のコピーを消す（アプリの DB には持たない）。
    // 入っていない店（admin が無い）は、アプリから注文を触れないので消すものはない。
    // トークンの更新に失敗して admin が無いのに消す注文があるときは、500 で送り直してもらう（planPosLiteRedact）。
    const redact = planPosLiteRedact({ topic, payload, admin, sessionRefreshFailed });
    if (redact.action === "retry") {
      console.warn(
        `[compliance] customers/redact for ${shop}: トークンの更新に失敗したので、配送先のコピーを消せない（${redact.orders.length} 件）。500 で送り直してもらう`,
      );
      return new Response(null, { status: 500 });
    }
    if (redact.action === "scrub") {
      const { scrubbed } = await redactPosLiteOrders(requestFromAdmin(admin), redact.orders);
      console.log(`[compliance] customers/redact for ${shop}: pos-lite delivery copies scrubbed`, scrubbed);
    }
    const { status } = await handleComplianceWebhook({ topic, shop, payload, db, isShopStillInstalled });
    return new Response(null, { status });
  } catch (err) {
    // DB の失敗・入っているか確かめられないとき。500 を返し、Shopify にもう一度送ってもらう（何度来ても安全）。
    console.error("[compliance] handler error:", err);
    return new Response(null, { status: 500 });
  }
};
