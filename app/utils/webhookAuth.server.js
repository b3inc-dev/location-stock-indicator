// authenticateWebhookSafely を本物の authenticate.webhook と秘密の値につなぐ。
import { authenticate } from "../shopify.server";
import { authenticateWebhookSafely } from "./webhookAuth.js";

export function authenticateWebhook(request) {
  return authenticateWebhookSafely(request, {
    authenticateWebhook: (r) => authenticate.webhook(r),
    apiSecret: process.env.SHOPIFY_API_SECRET || "",
  });
}
