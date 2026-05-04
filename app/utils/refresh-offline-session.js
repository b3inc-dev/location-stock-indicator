// オフラインアクセストークンが切れる前にリフレッシュし、DB を更新する（App Proxy 等で使用）
import prisma from "../db.server";

/** 期限切れの約5分前も「更新する」とみなす（単位: ミリ秒） */
const WITHIN_MS_OF_EXPIRY = 5 * 60 * 1000;

/**
 * オフラインアクセストークンが期限切れ（またはまもなく期限切れ）の場合、
 * リフレッシュトークンで更新して DB に保存する。
 * 更新に成功したら true、不要または失敗時は false。
 */
export async function refreshOfflineSessionIfNeeded(
  sessionId,
  shop,
  expires,
  refreshTokenValue
) {
  if (!refreshTokenValue) return false;
  const now = Date.now();
  const expiresMs = expires ? expires.getTime() : 0;
  if (expiresMs > now + WITHIN_MS_OF_EXPIRY) return false;

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiKey || !apiSecret) return false;

  const body = new URLSearchParams({
    client_id: apiKey,
    client_secret: apiSecret,
    grant_type: "refresh_token",
    refresh_token: refreshTokenValue,
  });

  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    console.error(`[refresh-offline-session] Token refresh failed for ${shop}:`, json);
    return false;
  }

  const data = await res.json();
  const newExpires = new Date(now + data.expires_in * 1000);
  const newRefreshExpires = data.refresh_token_expires_in
    ? new Date(now + data.refresh_token_expires_in * 1000)
    : null;

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      accessToken: data.access_token,
      expires: newExpires,
      refreshToken: data.refresh_token ?? refreshTokenValue,
      refreshTokenExpires: newRefreshExpires,
    },
  });

  return true;
}

/**
 * DB を更新したあと、同一リクエスト内の admin.graphql が新しい accessToken を使うよう
 * メモリ上の Session オブジェクトを Prisma の行で上書きする。
 */
export async function applySessionTokensFromDb(session) {
  if (!session?.id) return;
  const row = await prisma.session.findUnique({ where: { id: session.id } });
  if (!row) return;
  session.accessToken = row.accessToken;
  session.expires = row.expires ?? undefined;
  if (row.refreshToken != null) {
    session.refreshToken = row.refreshToken;
  } else {
    session.refreshToken = undefined;
  }
  if (row.refreshTokenExpires != null) {
    session.refreshTokenExpires = row.refreshTokenExpires;
  } else {
    session.refreshTokenExpires = undefined;
  }
}

/**
 * App Proxy 用: 必要ならリフレッシュし、session のトークンを DB と一致させる。
 */
export async function ensureOfflineAccessTokenFresh(session) {
  if (!session?.id || !session.shop) return false;
  const exp =
    session.expires instanceof Date
      ? session.expires
      : session.expires != null
        ? new Date(Number(session.expires))
        : null;
  const rt = session.refreshToken ?? null;
  const did = await refreshOfflineSessionIfNeeded(session.id, session.shop, exp, rt);
  if (did) {
    await applySessionTokensFromDb(session);
  }
  return did;
}
