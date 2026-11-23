// 期限の無いオフライントークン（古い形）を、期限付き（リフレッシュトークン付き）に移すための部品。
//
// Shopify の案内: https://shopify.dev/docs/apps/build/authentication-authorization/migrate-to-expiring-offline-access-tokens
// - 2027-01-01 から、期限の無いトークンを使う公開アプリは新しく入れられなくなる。
// - 2027-04-01 から、期限の無いトークンでの Admin API の呼び出しは断られる。
//
// 新しく入れた店は、ライブラリ（@shopify/shopify-app-react-router 1.1 以上）と
// future.expiringOfflineAccessTokens で、はじめから期限付きのトークンになる。
// すでに入っている店の古いトークンは、ライブラリは移さない（期限が無いので「有効」と見るため）。
// そこで、管理画面を開いたときに 1 回だけ公式の交換（token exchange・expiring=1）で移す。
//
// 交換すると古いトークンはすぐ使えなくなり、取り消せない。止めるスイッチを付けて既定オフで出す。
// オンにするのは T（環境変数 EXPIRING_TOKEN_MIGRATION=on）。

/** 環境変数のスイッチ。"on" / "1" / "true" のときだけ移す（既定オフ）。 */
export function isExpiringTokenMigrationEnabled(env = process.env) {
  const v = String(env?.EXPIRING_TOKEN_MIGRATION ?? "").trim().toLowerCase();
  return v === "on" || v === "1" || v === "true";
}

/**
 * このセッションが「期限の無いオフライントークン」か。
 * オンラインのセッション・期限のあるもの・リフレッシュトークンのあるもの・トークンの無いものは移さない。
 * @param {{ isOnline?: boolean, expires?: Date|string|number|null, refreshToken?: string|null, accessToken?: string|null } | null | undefined} session
 */
export function needsExpiringMigration(session) {
  if (!session) return false;
  if (session.isOnline) return false;
  if (!session.accessToken) return false;
  if (session.expires) return false;
  if (session.refreshToken) return false;
  return true;
}

/**
 * 管理画面を開いたときに、期限の無いトークンなら移す。失敗しても画面は止めない（ログだけ）。
 *
 * @param {object} session - authenticate.admin が返したセッション（移したあと、中のトークンを新しいものに書き換える）
 * @param {{
 *   enabled: boolean,
 *   ensureFresh: (session: object) => Promise<{ ok: boolean, status: string, httpStatus?: number, detail?: string }>,
 *   log?: (line: string) => void,
 * }} deps
 * @returns {Promise<"disabled"|"not_needed"|"migrated"|"failed">}
 */
export async function migrateOfflineSessionOnAdmin(session, { enabled, ensureFresh, log = console.log }) {
  if (!needsExpiringMigration(session)) return "not_needed";
  if (!enabled) {
    log(`[expiring-token] ${session.shop}: 期限の無いトークンのまま（EXPIRING_TOKEN_MIGRATION がオフ）`);
    return "disabled";
  }
  try {
    const r = await ensureFresh(session);
    if (r?.ok && r.status === "migrated") {
      log(`[expiring-token] ${session.shop}: 期限付きのトークンに移した`);
      return "migrated";
    }
    if (r?.ok) return "not_needed";
    log(
      `[expiring-token] ${session.shop}: 移せなかった status=${r?.status ?? "unknown"} http=${r?.httpStatus ?? "-"} detail=${r?.detail ?? "-"}`,
    );
    return "failed";
  } catch (err) {
    log(`[expiring-token] ${session.shop}: 移す途中で例外 ${err instanceof Error ? err.message : String(err)}`);
    return "failed";
  }
}
