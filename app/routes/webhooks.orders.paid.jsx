import {authenticate} from "../shopify.server";
import {adminForShop, prismaClaimRepo, processPaidOrder} from "../utils/posOperations.server.js";

export const action = async ({request}) => {
  const {shop, topic, payload} = await authenticate.webhook(request);
  const name = String(topic || "").toUpperCase().replaceAll("/", "_");
  if (name !== "ORDERS_PAID") return new Response();
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");
  const orderId = payload?.admin_graphql_api_id;
  if (!webhookId || !orderId) return new Response("missing webhook", {status: 400});
  try {
    await processPaidOrder({
      shop,
      webhookId,
      orderId,
      staffMemberId: payload?.user_id ? String(payload.user_id) : null,
      repo: prismaClaimRepo(),
      request: await adminForShop(shop),
    });
    return new Response();
  } catch (error) {
    console.error(
      "[location-stock]",
      {route: "webhooks.orders.paid", shop, orderId},
      error instanceof Error ? error.message : "failed",
    );
    return new Response("retry", {status: 500});
  }
};
