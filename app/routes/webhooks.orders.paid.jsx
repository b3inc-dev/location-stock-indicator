// app/routes/webhooks.orders.paid.jsx
// POS Lite の「持ち帰りと配送」: 会計のあと、配送分を出荷元へ移し、持ち帰り分だけを履行する。
// 設定の「持ち帰りと配送の履行」がオフ（既定）のとき・Pro でないときは何もしない。
// 処理は何度来ても安全（注文の今の状態を読み直して、済んだ分を除く）。失敗は注文に「要確認」の印を付け、200 を返す
// （Shopify の再送で同じ失敗を繰り返さない。管理画面の「要確認」から再処理する）。

import { authenticate } from "../shopify.server";
import { getShopPlan } from "../utils/shopPlan.server.js";
import { loadConfig, processSale, requestFromAdmin, withOrderLock } from "../utils/posLiteSale.js";
import { DELIVERY_ATTRIBUTE } from "../../extensions/pos-lite/src/logic.js";

export const action = async ({ request }) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  const orderId = payload?.admin_graphql_api_id;
  // 配送の指定が無い注文（ほとんどの会計）は、API を呼ばずに終える
  const attributes = Array.isArray(payload?.note_attributes) ? payload.note_attributes : [];
  const hasDelivery = attributes.some((item) => item?.name === DELIVERY_ATTRIBUTE);
  if (!orderId || !hasDelivery || !admin) return new Response();
  try {
    const run = requestFromAdmin(admin);
    const { config } = await loadConfig(run);
    if (!config.deliveryEnabled) return new Response();
    const plan = await getShopPlan(admin, shop, { reportUsage: false });
    if (!plan?.features?.storePickup) return new Response();
    const result = await withOrderLock(`${shop}:${orderId}`, () => processSale(run, orderId, { config }));
    // 顧客の値（住所など）は記録に出さない。注文の ID と結果だけ
    console.log("[location-stock] pos-lite sale", { shop, orderId, phase: result.phase, reason: result.reason || null });
    return new Response();
  } catch (error) {
    console.error("[location-stock] pos-lite sale failed", { shop, orderId }, error instanceof Error ? error.message : "failed");
    // 設定の読み込みなど、注文に印を付ける前の失敗は Shopify にもう一度送ってもらう
    return new Response("retry", { status: 500 });
  }
};
