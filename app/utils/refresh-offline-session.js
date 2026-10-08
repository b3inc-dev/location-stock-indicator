// オフラインアクセストークンが切れる前にリフレッシュし、DB を更新する（App Proxy 等で使用）
import prisma from "../db.server";

/** 期限切れの約5分前も「更新する」とみなす（単位: ミリ秒） */
const WITHIN_MS_OF_EXPIRY = 5 * 60 * 1000;

const OFFLINE_ACCESS_TOKEN_TYPE =
  "urn:shopify:params:oauth:token-type:offline-access-token";
const TOKEN_EXCHANGE_GRANT =
  "urn:ietf:params:oauth:grant-type:token-exchange";

/**
 * @typedef {"not_needed"|"refreshed"|"migrated"|"missing_credentials"|"missing_refresh_token"|"refresh_token_expired"|"refresh_failed"|"migrate_failed"|"reauth_required"|"no_session"} OfflineTokenStatus
 */

/**
 * @typedef {{
 *   ok: boolean;
 *   status: OfflineTokenStatus;
 *   needsReauth?: boolean;
 *   httpStatus?: number;
 *   detail?: string;
 * }} OfflineTokenResult
 */

function result(ok, status, extra = {}) {
  return { ok, status, ...extra };
}

function toDate(value) {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const d = new Date(typeof value === "number" ? value : Number(value) || value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function credentials() {
  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiKey || !apiSecret) return null;
  return { apiKey, apiSecret };
}

function logRefreshEvent(shop, status, extra = {}) {
  console.error(
    "[refresh-offline-session]",
    JSON.stringify({ shop, status, ...extra })
  );
}

/**
 * OAuth access_token エンドポイントへ POST し、成功時は DB を更新する。
 * @returns {Promise<{ ok: true, data: object } | { ok: false, httpStatus: number, detail: string }>}
 */
async function postAccessToken(shop, body) {
  const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof json?.error === "string"
        ? json.error
        : typeof json?.error_description === "string"
          ? json.error_description
          : `http_${res.status}`;
    return { ok: false, httpStatus: res.status, detail };
  }
  return { ok: true, data: json };
}

/**
 * 取得したトークン応答を Prisma Session に保存する。
 */
async function persistTokenResponse(sessionId, shop, data, fallbackRefreshToken) {
  const now = Date.now();
  const newExpires =
    typeof data.expires_in === "number"
      ? new Date(now + data.expires_in * 1000)
      : null;
  const newRefreshExpires =
    typeof data.refresh_token_expires_in === "number"
      ? new Date(now + data.refresh_token_expires_in * 1000)
      : null;

  await prisma.session.update({
    where: { id: sessionId },
    data: {
      accessToken: data.access_token,
      expires: newExpires,
      refreshToken: data.refresh_token ?? fallbackRefreshToken ?? null,
      refreshTokenExpires: newRefreshExpires,
    },
  });

  logRefreshEvent(shop, "token_persisted", {
    hasRefreshToken: Boolean(data.refresh_token ?? fallbackRefreshToken),
    expiresIn: data.expires_in ?? null,
  });
}

/**
 * 非期限付き offline token → 期限付き（refresh 付き）へ公式 token-exchange で移行。
 * https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
 */
async function migrateNonExpiringOfflineToken(sessionId, shop, accessToken) {
  const creds = credentials();
  if (!creds) {
    return result(false, "missing_credentials", { needsReauth: true });
  }
  if (!accessToken) {
    return result(false, "reauth_required", {
      needsReauth: true,
      detail: "no_access_token_for_migration",
    });
  }

  const body = new URLSearchParams({
    client_id: creds.apiKey,
    client_secret: creds.apiSecret,
    grant_type: TOKEN_EXCHANGE_GRANT,
    subject_token: accessToken,
    subject_token_type: OFFLINE_ACCESS_TOKEN_TYPE,
    requested_token_type: OFFLINE_ACCESS_TOKEN_TYPE,
    expiring: "1",
  });

  const exchanged = await postAccessToken(shop, body);
  if (!exchanged.ok) {
    logRefreshEvent(shop, "migrate_failed", {
      httpStatus: exchanged.httpStatus,
      detail: exchanged.detail,
    });
    // invalid_subject_token 等は再認可が必要
    return result(false, "migrate_failed", {
      needsReauth: true,
      httpStatus: exchanged.httpStatus,
      detail: exchanged.detail,
    });
  }

  await persistTokenResponse(sessionId, shop, exchanged.data, null);
  return result(true, "migrated");
}

/**
 * refresh_token で access token を更新する。
 * 失敗時は false を握りつぶさず、structured result を返す。
 */
export async function refreshOfflineSessionIfNeeded(
  sessionId,
  shop,
  expires,
  refreshTokenValue,
  options = {}
) {
  const { force = false, refreshTokenExpires = null, accessToken = null } =
    options;

  const creds = credentials();
  if (!creds) {
    logRefreshEvent(shop, "missing_credentials");
    return result(false, "missing_credentials", { needsReauth: true });
  }

  const now = Date.now();
  const expiresMs = expires ? expires.getTime() : 0;
  const needsRefresh =
    force || !expires || expiresMs <= now + WITHIN_MS_OF_EXPIRY;

  if (!needsRefresh) {
    return result(true, "not_needed");
  }

  // refresh 無し: 非期限付きトークンなら公式 migration、それ以外は再認可
  if (!refreshTokenValue) {
    const looksNonExpiring = !expires;
    if (looksNonExpiring && accessToken) {
      return migrateNonExpiringOfflineToken(sessionId, shop, accessToken);
    }
    logRefreshEvent(shop, "missing_refresh_token", {
      hasExpires: Boolean(expires),
      force,
    });
    return result(false, "missing_refresh_token", {
      needsReauth: true,
      detail: looksNonExpiring
        ? "non_expiring_without_access_token"
        : "expiring_session_without_refresh_token",
    });
  }

  const refreshExp = toDate(refreshTokenExpires);
  if (refreshExp && refreshExp.getTime() <= now) {
    logRefreshEvent(shop, "refresh_token_expired", {
      refreshTokenExpires: refreshExp.toISOString(),
    });
    return result(false, "refresh_token_expired", { needsReauth: true });
  }

  const body = new URLSearchParams({
    client_id: creds.apiKey,
    client_secret: creds.apiSecret,
    grant_type: "refresh_token",
    refresh_token: refreshTokenValue,
  });

  const refreshed = await postAccessToken(shop, body);
  if (!refreshed.ok) {
    logRefreshEvent(shop, "refresh_failed", {
      httpStatus: refreshed.httpStatus,
      detail: refreshed.detail,
    });
    // Shopify: refresh 失敗は 401 invalid_request → 再認可
    const needsReauth =
      refreshed.httpStatus === 401 ||
      refreshed.detail === "invalid_request" ||
      refreshed.detail === "invalid_grant";
    return result(false, "refresh_failed", {
      needsReauth,
      httpStatus: refreshed.httpStatus,
      detail: refreshed.detail,
    });
  }

  await persistTokenResponse(
    sessionId,
    shop,
    refreshed.data,
    refreshTokenValue
  );
  return result(true, "refreshed");
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
 * メッセージ文字列が認証失敗を示すか（秘密は出さない・部分一致を狭く保つ）。
 * @param {string} msg
 */
function messageLooksLikeAuthFailure(msg) {
  const m = String(msg || "").toLowerCase();
  return (
    m.includes("invalid api key or access token") ||
    m.includes("invalid access token") ||
    m.includes("expired access token") ||
    m.includes("access token is invalid") ||
    m.includes("access token has expired") ||
    m.includes("unauthorized") ||
    m.includes("not authorized") ||
    m.includes("authentication failed") ||
    m.includes("non-expiring access tokens are no longer accepted")
  );
}

/**
 * GraphQL / Admin API エラーが認証失敗かどうかを判定する。
 * admin.graphql は失敗時に throw するため、thrown error も受け付ける。
 * @param {unknown} errors - GraphQL errors 配列、または throw された Error
 * @param {number} [httpStatus]
 */
export function isAdminAuthFailure(errors, httpStatus) {
  if (httpStatus === 401 || httpStatus === 403) return true;

  // HttpResponseError 等: error.response.code
  const thrownCode = errors?.response?.code ?? errors?.code;
  if (thrownCode === 401 || thrownCode === 403) return true;

  if (errors instanceof Error && messageLooksLikeAuthFailure(errors.message)) {
    return true;
  }

  // GraphqlQueryError.body.errors.graphQLErrors
  const graphQLErrors = errors?.body?.errors?.graphQLErrors;
  if (Array.isArray(graphQLErrors) && graphQLErrors.some((e) => messageLooksLikeAuthFailure(e?.message))) {
    return true;
  }

  if (!Array.isArray(errors) || errors.length === 0) return false;
  return errors.some((e) => messageLooksLikeAuthFailure(e?.message || e));
}

/**
 * App Proxy 用: 必要ならリフレッシュ／移行し、session のトークンを DB と一致させる。
 * 失敗を握りつぶさない（ok:false + needsReauth 等を返す）。
 *
 * @param {object} session
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<OfflineTokenResult>}
 */
export async function ensureOfflineAccessTokenFresh(session, options = {}) {
  const { force = false } = options;
  if (!session?.id || !session.shop) {
    return result(false, "no_session", { needsReauth: true });
  }

  // DB 最新を優先（他プロセス refresh / 管理 UI 蘇生との競合緩和）
  const row = await prisma.session.findUnique({ where: { id: session.id } });
  if (row) {
    session.accessToken = row.accessToken;
    session.expires = row.expires ?? undefined;
    session.refreshToken = row.refreshToken ?? undefined;
    session.refreshTokenExpires = row.refreshTokenExpires ?? undefined;
  }

  const exp = toDate(session.expires);
  const rt = session.refreshToken ?? null;
  const rtExp = toDate(session.refreshTokenExpires);

  const did = await refreshOfflineSessionIfNeeded(
    session.id,
    session.shop,
    exp,
    rt,
    {
      force,
      refreshTokenExpires: rtExp,
      accessToken: session.accessToken ?? null,
    }
  );

  if (did.ok && (did.status === "refreshed" || did.status === "migrated")) {
    await applySessionTokensFromDb(session);
  }

  return did;
}
