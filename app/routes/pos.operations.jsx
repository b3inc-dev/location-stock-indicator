import {adminForShop, prismaOrderLockRepo, retryPaidOrder} from "../utils/posOperations.server.js";
import {posSessionCredentials, verifySessionToken} from "../utils/posSession.server.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {"Content-Type": "application/json", ...cors},
  });
}

export const loader = async ({request}) => {
  if (request.method === "OPTIONS") return new Response(null, {headers: cors});
  return json({error: "method"}, 405);
};

export const action = async ({request}) => {
  if (request.method === "OPTIONS") return new Response(null, {headers: cors});
  try {
    const header = request.headers.get("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const credentials = posSessionCredentials();
    const {shop} = verifySessionToken(token, credentials.apiKey, credentials.apiSecret);
    const body = await request.json();
    const orderId = String(body?.orderId || "");
    if (!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId)) return json({message: "注文を確認してください。"}, 400);
    const owner = `pos:${shop}:${orderId}:${Date.now()}`;
    const outcome = await retryPaidOrder({
      shop,
      orderId,
      owner,
      locks: prismaOrderLockRepo(),
      request: await adminForShop(shop),
    });
    if (outcome.busy) {
      return json({busy: true, message: "別の処理が進行中です。少し待って再処理してください。"}, 409);
    }
    if (outcome.state === "skipped") return json({message: "この環境では再処理できません。"}, 403);
    return json({
      phase: outcome.result?.phase,
      reason: outcome.result?.reason || null,
      message: outcome.result?.message || "再処理しました。",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "再処理に失敗しました。";
    const status = message === "認証に失敗しました。" ? 401 : 500;
    return json({message}, status);
  }
};
