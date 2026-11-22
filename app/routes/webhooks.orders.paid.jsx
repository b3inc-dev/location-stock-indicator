// app/routes/webhooks.orders.paid.jsx
// POS Lite の「持ち帰りと配送」: 会計のあと、配送分を出荷元へ移し、持ち帰り分だけを履行する。
// 設定の「持ち帰りと配送の履行」がオフ（既定）のとき・Pro でないときは何もしない。
//
// Shopify は 5 秒の内に応答が無いと失敗として送り直すので、ここでは短い確かめ（1 回の問い合わせ）だけをして返し、
// 重い処理（10 回ほどの API）は応答のあとに行う（processPaidInBackground）。
// - 出荷指示がまだできていない注文は、印を付けずに 500 を返し、Shopify に送り直してもらう（見直し 11/23）。
// - 処理は何度来ても安全（注文の今の状態を読み直して、済んだ分を除く）。止まったら注文に「要確認」の印を付ける。

import { authenticate } from "../shopify.server";
import { getShopPlan } from "../utils/shopPlan.server.js";
import { precheckPaid, processPaidInBackground, requestFromAdmin } from "../utils/posLiteSale.js";
import { DELIVERY_ATTRIBUTE } from "../../extensions/pos-lite/src/logic.js";

export const action = async ({ request }) => {
  const { shop, payload, admin } = await authenticate.webhook(request);
  const orderId = payload?.admin_graphql_api_id;
  // 配送の指定が無い注文（ほとんどの会計）は、API を呼ばずに終える
  const attributes = Array.isArray(payload?.note_attributes) ? payload.note_attributes : [];
  const hasDelivery = attributes.some((item) => item?.name === DELIVERY_ATTRIBUTE);
  if (!orderId || !hasDelivery || !admin) return new Response();
  const run = requestFromAdmin(admin);
  let check;
  try {
    check = await precheckPaid(run, orderId);
  } catch (error) {
    console.error("[location-stock] pos-lite precheck failed", { shop, orderId }, error instanceof Error ? error.message : "failed");
    return new Response("retry", { status: 500 });
  }
  if (check.action === "ignore") return new Response();
  if (check.action === "retry") {
    console.log("[location-stock] pos-lite sale waiting for fulfillment orders", { shop, orderId });
    return new Response("retry", { status: 500 });
  }
  // 応答を先に返し、処理は後ろで続ける（失敗は注文の「要確認」と記録に残る）
  void processPaidInBackground({
    request: run,
    orderId,
    config: check.config,
    lockKey: `${shop}:${orderId}`,
    allowed: async () => Boolean((await getShopPlan(admin, shop, { reportUsage: false }))?.features?.storePickup),
    log: (...args) => console.log(...args, { shop }),
  });
  return new Response();
};
