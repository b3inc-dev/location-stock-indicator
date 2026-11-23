// shop/redact の前に「この店にまだアプリが入っているか」を確かめるための部品。
//
// shop/redact はアンインストールの 48 時間後に届く。そのあいだに入れ直した店に届いたとき、
// 入れ直したあとのデータを消さないよう、消す前にオフラインのセッションで Admin API を 1 回呼ぶ。
// - オフラインのセッションが無い → 入っていない → 消してよい（false）
// - 呼べた → 今も入っている → 消さない（true）
// - 401 / トークンが無効 → 入っていない → 消してよい（false）
//   （403 は権限の問題などでも返るので「入っていない」とは見ない。投げて、もう一度送ってもらう）
// - それ以外の失敗（通信・5xx など）→ 分からないので投げる（ルートが 500 を返し、Shopify がもう一度送る）

export const INSTALL_PROBE_QUERY = `#graphql
  query ComplianceInstallProbe {
    shop { id }
  }
`;

function statusOf(err) {
  if (!err || typeof err !== "object") return null;
  if (typeof Response !== "undefined" && err instanceof Response) return err.status;
  const candidates = [err.response?.code, err.response?.status, err.status, err.statusCode];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

/**
 * 失敗が「アプリが入っていない／トークンが無効」を表すか。
 * @param {unknown} err
 * @returns {boolean}
 */
export function isNotInstalledError(err) {
  const status = statusOf(err);
  if (status === 401) return true;
  const text = [err?.message, err?.response?.body && JSON.stringify(err.response.body)]
    .filter(Boolean)
    .join(" ");
  return /invalid_grant|invalid_token|invalid_subject_token|Invalid API key or access token|SessionNotFound|Could not find a session/i.test(
    text,
  );
}

function toTime(v) {
  if (v == null) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * トークンが切れていて、リフレッシュトークンも無い・切れている（更新できない）か。
 * 期限の無い古いトークン（expires が無い）は false。
 * @param {{ expires?: unknown, refreshToken?: string|null, refreshTokenExpires?: unknown }} session
 * @param {number} [now]
 */
export function isOfflineSessionUnrefreshable(session, now = Date.now()) {
  const exp = toTime(session?.expires);
  if (exp == null || exp > now) return false;
  if (!session?.refreshToken) return true;
  const rtExp = toTime(session?.refreshTokenExpires);
  return rtExp != null && rtExp <= now;
}

/**
 * @param {{
 *   shop: string,
 *   findOfflineSession: (shop: string) => Promise<unknown | null | undefined>,
 *   runProbeQuery: (shop: string) => Promise<unknown>,
 * }} deps
 * @returns {Promise<boolean>} true = 今も入っている（消さない）
 */
export async function probeShopStillInstalled({ shop, findOfflineSession, runProbeQuery }) {
  const session = await findOfflineSession(shop);
  if (!session) return false;
  // 期限付きのトークンで、トークンもリフレッシュトークンも切れている → もう更新できない（外した店）。
  // ここで呼ぶとライブラリの更新が 500 を投げて、Shopify が送り直しを続けるので、呼ばずに「入っていない」とする。
  if (isOfflineSessionUnrefreshable(session)) return false;
  try {
    await runProbeQuery(shop);
    return true;
  } catch (err) {
    if (isNotInstalledError(err)) return false;
    throw err;
  }
}
