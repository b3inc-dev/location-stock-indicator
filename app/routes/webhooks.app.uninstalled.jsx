import { authenticateWebhook } from "../utils/webhookAuth.server.js";
import db from "../db.server";

export const action = async ({ request }) => {
  const { shop, session, topic } = await authenticateWebhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  // 期限付きのトークンでは、外した店のトークンを更新できずに session が無いことがある。
  // そのときもこの店のセッションを消す（deleteMany は何度呼んでも安全）。
  if (shop) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
