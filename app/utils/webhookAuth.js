// Webhook の受け口で、アプリを外した店の Webhook が 500 にならないようにする部品。
//
// @shopify/shopify-app-react-router 1.1 系は、期限付きのトークンを使うと、Webhook を受けたときに
// 切れたトークンをリフレッシュしようとする。アプリを外した店ではリフレッシュが断られ、
// authenticate.webhook が 500 の Response を投げる（ライブラリ 4.0.3 で直った不具合）。
// 500 だと Shopify が送り直しを続け、Dev Dashboard に「Webhook の失敗」が出る。
//
// ここでは、authenticate.webhook が 500 を投げたときだけ、HMAC を自分で確かめ、
// 正しければ「セッションの無い Webhook」として返す（4.0.3 と同じ動き）。
// HMAC が合わなければ 401 を返す。ほかの Response（401・400・405）はそのまま投げる。

import crypto from "node:crypto";

function header(request, names) {
  for (const n of names) {
    const v = request.headers.get(n);
    if (v) return v;
  }
  return null;
}

/** "app/uninstalled" → "APP_UNINSTALLED"（ライブラリが返す topic の形にそろえる） */
export function toTopicConst(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[/.]/g, "_");
}

/**
 * 本文の HMAC（SHA-256・base64）が合っているか。時間の差が出ない比べ方をする。
 * @param {string} rawBody
 * @param {string|null} hmacHeader
 * @param {string} secret
 */
export function isValidWebhookHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest();
  let given;
  try {
    given = Buffer.from(hmacHeader, "base64");
  } catch {
    return false;
  }
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(given, expected);
}

/**
 * @param {Request} request
 * @param {{
 *   authenticateWebhook: (request: Request) => Promise<any>,
 *   apiSecret: string,
 *   log?: (line: string) => void,
 * }} deps
 */
export async function authenticateWebhookSafely(request, { authenticateWebhook, apiSecret, log = console.warn }) {
  // authenticate.webhook は本文を読むので、先に写しを取っておく
  const copy = request.clone();
  try {
    return await authenticateWebhook(request);
  } catch (thrown) {
    const isResponse = typeof Response !== "undefined" && thrown instanceof Response;
    if (!isResponse || thrown.status !== 500) throw thrown;

    const rawBody = await copy.text();
    const hmac = header(copy, ["x-shopify-hmac-sha256", "shopify-hmac-sha256"]);
    if (!isValidWebhookHmac(rawBody, hmac, apiSecret)) {
      throw new Response(undefined, { status: 401, statusText: "Unauthorized" });
    }

    const shop = header(copy, ["x-shopify-shop-domain", "shopify-shop-domain"]) || "";
    const topic = toTopicConst(header(copy, ["x-shopify-topic", "shopify-topic"]));
    let payload = {};
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      payload = {};
    }
    log(`[webhook] ${topic} for ${shop}: セッションの更新に失敗したので、セッション無しで受ける（アプリを外した店など）`);
    return {
      apiVersion: header(copy, ["x-shopify-api-version", "shopify-api-version"]) || undefined,
      shop,
      topic,
      webhookId: header(copy, ["x-shopify-webhook-id", "shopify-webhook-id"]) || undefined,
      payload,
      subTopic: header(copy, ["x-shopify-sub-topic", "shopify-sub-topic"]) || undefined,
      session: undefined,
      admin: undefined,
      sessionRefreshFailed: true,
    };
  }
}
