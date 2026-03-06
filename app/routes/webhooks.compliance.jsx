// app/routes/webhooks.compliance.jsx
// 必須コンプライアンス Webhook（customers/data_request, customers/redact, shop/redact）
// authenticate.webhook(request) が HMAC を検証し、無効な場合は 401 を返す。

import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }) => {
  // HMAC 検証：無効な場合は 401 Unauthorized が throw される
  const { topic, shop, payload } = await authenticate.webhook(request);

  if (topic === "customers/data_request") {
    // 当アプリは顧客の個人データを保存していない（設定・集計のみ）。提供するデータなしで受領確認。
    console.log(`[compliance] customers/data_request for ${shop}`, payload?.data_request?.id ?? "");
    return new Response(null, { status: 200 });
  }

  if (topic === "customers/redact") {
    // 当アプリは顧客単位のデータを保存していない。削除対象なしで受領確認。
    console.log(`[compliance] customers/redact for ${shop}`, payload?.customer?.id ?? "");
    return new Response(null, { status: 200 });
  }

  if (topic === "shop/redact") {
    // アンインストール 48 時間後に送信。当ショップのセッションを削除。
    if (shop) {
      await db.session.deleteMany({ where: { shop } });
      console.log(`[compliance] shop/redact for ${shop}: sessions deleted`);
    }
    return new Response(null, { status: 200 });
  }

  return new Response(null, { status: 200 });
};
