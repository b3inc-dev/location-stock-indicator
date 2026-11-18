// 必須コンプライアンス Webhook（shop/redact・customers/redact）で、
// POS Lite の受取・配送の処理用に保存している行を消す。
// 対象の表: PosWebhookClaim（Webhook の重複処理防止）・PosOrderLock（注文ごとの処理ロック）。
// どちらも shop と注文 ID（GraphQL の gid）を持つ。お客様の ID・名前・連絡先は持たない。

const ORDER_GID_PREFIX = "gid://shopify/Order/";

// customers/redact の orders_to_redact（数字の注文 ID）を、保存している形（gid）にそろえる。
export function orderGidsToRedact(payload) {
  const list = Array.isArray(payload?.orders_to_redact) ? payload.orders_to_redact : [];
  const gids = new Set();
  for (const value of list) {
    if (typeof value === "string" && value.startsWith(ORDER_GID_PREFIX)) {
      gids.add(value);
      continue;
    }
    const id = String(value ?? "").trim();
    if (/^\d+$/.test(id)) gids.add(`${ORDER_GID_PREFIX}${id}`);
  }
  return [...gids];
}

// お店のデータをすべて消す（shop/redact）。
export async function redactShopPosData(db, shop) {
  if (!shop) return {claims: 0, locks: 0};
  const claims = await db.posWebhookClaim.deleteMany({where: {shop}});
  const locks = await db.posOrderLock.deleteMany({where: {shop}});
  return {claims: claims?.count ?? 0, locks: locks?.count ?? 0};
}

// お客様の注文に結び付く行を消す（customers/redact）。
export async function redactCustomerPosData(db, shop, payload) {
  const orderIds = orderGidsToRedact(payload);
  if (!shop || orderIds.length === 0) return {claims: 0, locks: 0};
  const where = {shop, orderId: {in: orderIds}};
  const claims = await db.posWebhookClaim.deleteMany({where});
  const locks = await db.posOrderLock.deleteMany({where});
  return {claims: claims?.count ?? 0, locks: locks?.count ?? 0};
}
