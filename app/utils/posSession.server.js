import {createHmac, timingSafeEqual} from "node:crypto";

export function verifySessionToken(token, apiKey, apiSecret, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !apiKey || !apiSecret) throw new Error("認証に失敗しました。");
  const [header, body, signature] = parts;
  const expected = createHmac("sha256", apiSecret).update(`${header}.${body}`).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("認証に失敗しました。");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString());
  const seconds = Math.floor(now / 1000);
  if (payload.aud !== apiKey) throw new Error("認証に失敗しました。");
  if (!payload.exp || payload.exp < seconds || (payload.nbf && payload.nbf > seconds)) {
    throw new Error("認証に失敗しました。");
  }
  const shop = new URL(payload.dest).hostname;
  if (!shop) throw new Error("認証に失敗しました。");
  return {shop, payload};
}

export function posSessionCredentials() {
  return {
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecret: process.env.SHOPIFY_API_SECRET || "",
  };
}
