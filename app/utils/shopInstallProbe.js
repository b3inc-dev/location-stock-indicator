// shop/redact の前に「この店にまだアプリが入っているか」を確かめるための部品。
//
// shop/redact はアンインストールの 48 時間後に届く。そのあいだに入れ直した店に届いたとき、
// 入れ直したあとのデータを消さないよう、消す前にオフラインのセッションで Admin API を 1 回呼ぶ。
// - オフラインのセッションが無い → 入っていない → 消してよい（false）
// - 呼べた → 今も入っている → 消さない（true）
// - 401 / 403 / トークンが無効 → 入っていない → 消してよい（false）
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
  if (status === 401 || status === 403) return true;
  const text = [err?.message, err?.response?.body && JSON.stringify(err.response.body)]
    .filter(Boolean)
    .join(" ");
  return /invalid_grant|invalid_token|invalid_subject_token|Invalid API key or access token|SessionNotFound|Could not find a session/i.test(
    text,
  );
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
  try {
    await runProbeQuery(shop);
    return true;
  } catch (err) {
    if (isNotInstalledError(err)) return false;
    throw err;
  }
}
