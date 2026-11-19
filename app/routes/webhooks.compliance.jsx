// app/routes/webhooks.compliance.jsx
// 必須コンプライアンス Webhook（customers/data_request, customers/redact, shop/redact）
// authenticate.webhook(request) が HMAC を検証し、無効な場合は 401 を返す。

import { authenticate } from "../shopify.server";
import db from "../db.server";
import {redactCustomerPosData, redactShopPosData} from "../utils/posRedact.server.js";

export const action = async ({ request }) => {
  // HMAC 検証：無効な場合は 401 Unauthorized が throw される
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic === "customers/data_request") {
    // 当アプリは顧客の個人データを保存していない（設定・集計のみ）。提供するデータなしで受領確認。
    console.log(`[compliance] customers/data_request for ${shop}`, payload?.data_request?.id ?? "");
    return new Response(null, { status: 200 });
  }

  if (topic === "customers/redact") {
    // 顧客の名前・連絡先は保存していない。POS Lite の受取・配送の処理用に
    // 注文 ID を持つ行（PosWebhookClaim・PosOrderLock）だけ、orders_to_redact の注文分を消す。
    const deleted = await redactCustomerPosData(db, shop, payload);
    console.log(
      `[compliance] customers/redact for ${shop}`,
      payload?.customer?.id ?? "",
      `pos claims deleted: ${deleted.claims}, pos locks deleted: ${deleted.locks}`,
    );
    return new Response(null, { status: 200 });
  }

  if (topic === "shop/redact") {
    // アンインストール 48 時間後に送信。当ショップのセッションと POS Lite の処理用の行を削除。
    if (shop) {
      await db.session.deleteMany({ where: { shop } });
      const deleted = await redactShopPosData(db, shop);
      console.log(
        `[compliance] shop/redact for ${shop}: sessions deleted, pos claims deleted: ${deleted.claims}, pos locks deleted: ${deleted.locks}`,
      );
    }
    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 200 });
};
