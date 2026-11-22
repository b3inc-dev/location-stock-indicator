// Location Stock の POS Lite 用の決まり（POS の画面とサーバーの両方で使う。純関数だけ）。
//
// - 店頭受取: 自店の受取待ち（PICK_UP の出荷指示）を一覧にし、「準備完了」と「引渡し完了」を記録する。
// - 持ち帰りと配送: 会計の前に、明細ごとに配送する数量・配送先・出荷元をカートに書く。
//   会計のあと（orders/paid）にサーバーが、配送分を出荷元へ移し、持ち帰り分だけを履行する。
//
// Shopify の POS Lite では標準の「店頭受取」「配送・持ち帰りと配送」が使えないので、
// アプリのタイルと Admin API でこの 2 つを行う（T 11/23 3:08・3:15）。
// 書き込みはすべて設定のスイッチ（既定オフ）で止まる。

import { getPlanFromActiveSubscriptions } from "../../../app/utils/billing.js";
import { isProFeaturesAllowed } from "../../../app/utils/planGate.js";

export const CONFIG_NAMESPACE = "location_stock";
export const CONFIG_KEY = "pos_lite";
/** カートの属性（注文の customAttributes になる）。先頭の _ で POS の画面とレシートには出ない。 */
export const DELIVERY_ATTRIBUTE = "_lsi_delivery";
/** 明細の属性。この明細のうち配送する数量。 */
export const SHIP_QTY_PROPERTY = "_lsi_ship";
export const HANDOFF_KEY = "delivery_handoff";
export const REVIEW_KEY = "review_reason";
export const REVIEW_TAG = "location-stock-review";
/** 自社用（Location Stock - Ciara）の client_id。toml に書いてある公開の値。 */
export const CIARA_API_KEY = "61b474b801b754166b12f0b9cd07f450";
export const MAX_SHIPPING_FEE = 1000000;

const MESSAGES = {
  not_pos: "POS の注文ではありません。",
  no_location: "販売した店舗が分かりません。",
  cancelled: "キャンセルされた注文です。",
  unpaid: "支払いが終わっていません。",
  refund: "返金のある注文です。",
  return: "返品・交換のある注文です。",
  no_delivery: "配送の指定がない注文です。",
  switch_off: "持ち帰りと配送の履行がオフです。",
  plan: "この機能は Pro プランで使えます。",
  location_off: "この店舗では配送を使わない設定です。設定を確かめて再処理してください。",
  bad_delivery: "配送の指定が読めません（配送先・出荷元）。",
  same_location: "出荷元が販売した店舗と同じです。出荷元を変えて再処理してください。",
  no_ship_lines: "配送する商品がありません（会計の前に数量が変わった可能性があります）。",
  pickup_mixed: "店頭受取の出荷指示がある注文です。",
  fulfillment_request: "別の出荷依頼が出ている注文です。",
  on_hold: "保留中の出荷指示があります。",
  scheduled: "予定日のある出荷指示があります。",
  already_fulfilled:
    "配送する分が店頭で引渡済みになっています。会計の前に「フルフィルメント済みにする」をオフにしてください。",
  move_incomplete: "出荷元へ移したあとも、移す分が残っています。",
  network: "通信に失敗しました。再処理してください。",
  pagination: "明細を最後まで読めませんでした。再処理してください。",
};

export function messageFor(reason) {
  return MESSAGES[reason] || "要確認の注文です。";
}

export function numericId(value) {
  if (value == null || value === "") return "";
  const match = String(value).trim().match(/(\d+)$/);
  return match ? match[1] : "";
}

export function sameId(left, right) {
  const a = numericId(left);
  return a !== "" && a === numericId(right);
}

export function gid(type, id) {
  const n = numericId(id);
  return n ? `gid://shopify/${type}/${n}` : "";
}

function whole(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// ---------------------------------------------------------------------------
// 設定（店のメタフィールド location_stock.pos_lite）
// ---------------------------------------------------------------------------

/** 何も保存していない店の設定。書き込みはすべてオフ。 */
export function defaultConfig() {
  return { version: 1, pickupEnabled: false, pickupNotifyOnHandover: false, deliveryEnabled: false, locations: [] };
}

/** 保存された JSON を読む。壊れていたら既定（すべてオフ）にする。 */
export function parseConfig(raw) {
  let data = null;
  try {
    data = typeof raw === "string" ? JSON.parse(raw || "null") : raw;
  } catch {
    data = null;
  }
  const base = defaultConfig();
  if (!data || typeof data !== "object") return base;
  return {
    version: 1,
    pickupEnabled: data.pickupEnabled === true,
    pickupNotifyOnHandover: data.pickupNotifyOnHandover === true,
    deliveryEnabled: data.deliveryEnabled === true,
    locations: (Array.isArray(data.locations) ? data.locations : [])
      .map((row) => ({
        locationId: numericId(row?.locationId),
        enabled: row?.enabled === true,
        warehouseLocationId: numericId(row?.warehouseLocationId),
        shippingFee: whole(row?.shippingFee) ?? 0,
        shippingTitle: String(row?.shippingTitle || "送料").slice(0, 30) || "送料",
      }))
      .filter((row) => row.locationId),
  };
}

/**
 * 管理画面の入力を確かめる。1 つでも誤りがあれば errors を返し、何も保存しない（UI ルール 7章）。
 * @param {{pickupEnabled?: boolean, pickupNotifyOnHandover?: boolean, deliveryEnabled?: boolean, locations?: any[]}} input
 * @param {{id: string, name?: string}[]} knownLocations
 */
export function validateConfig(input, knownLocations) {
  const errors = [];
  const known = (knownLocations || []).map((l) => ({ id: numericId(l.id), name: l.name || numericId(l.id) }));
  const nameOf = (id) => known.find((l) => l.id === id)?.name || id;
  const locations = [];
  for (const raw of Array.isArray(input?.locations) ? input.locations : []) {
    const locationId = numericId(raw?.locationId);
    if (!known.some((l) => l.id === locationId)) {
      errors.push("知らないロケーションの行があります。画面を開き直してください。");
      continue;
    }
    const enabled = raw?.enabled === true;
    const warehouseLocationId = numericId(raw?.warehouseLocationId);
    const fee = whole(String(raw?.shippingFee ?? "").trim() === "" ? 0 : raw?.shippingFee);
    const shippingTitle = String(raw?.shippingTitle ?? "").trim() || "送料";
    const label = nameOf(locationId);
    if (enabled && !warehouseLocationId) errors.push(`「${label}」の出荷元を選んでください。`);
    if (warehouseLocationId && !known.some((l) => l.id === warehouseLocationId)) {
      errors.push(`「${label}」の出荷元が見つかりません。`);
    }
    if (enabled && warehouseLocationId === locationId) {
      errors.push(`「${label}」の出荷元は、販売する店舗と別のロケーションにしてください。`);
    }
    if (fee == null || fee > MAX_SHIPPING_FEE) errors.push(`「${label}」の送料は 0 以上の整数（円）にしてください。`);
    if (shippingTitle.length > 30) errors.push(`「${label}」の送料の名前は 30 文字以内にしてください。`);
    locations.push({ locationId, enabled, warehouseLocationId, shippingFee: fee ?? 0, shippingTitle });
  }
  const config = {
    version: 1,
    pickupEnabled: input?.pickupEnabled === true,
    pickupNotifyOnHandover: input?.pickupNotifyOnHandover === true,
    deliveryEnabled: input?.deliveryEnabled === true,
    locations,
  };
  return { errors: [...new Set(errors)], config };
}

export function locationRow(config, locationId) {
  return (config?.locations || []).find((row) => sameId(row.locationId, locationId)) || null;
}

/** この店舗の POS で「配送の分け」を使えるか。 */
export function deliveryUsable(config, locationId) {
  if (!config?.deliveryEnabled) return false;
  const row = locationRow(config, locationId);
  return Boolean(row?.enabled && row.warehouseLocationId && !sameId(row.warehouseLocationId, locationId));
}

// ---------------------------------------------------------------------------
// プラン（公開版は Pro、自社用と開発ストアは使える。planGate.js と同じ決まり）
// ---------------------------------------------------------------------------

export const POS_ACCESS_QUERY = `query PosLiteAccess {
  shop { plan { partnerDevelopment } }
  currentAppInstallation { app { apiKey } activeSubscriptions { name status } }
}`;

export function accessFromInstallation({ apiKey, partnerDevelopment, subscriptions }) {
  const distribution = apiKey === CIARA_API_KEY ? "inhouse" : "public";
  const isDevelopmentStore = partnerDevelopment === true;
  const plan = distribution === "inhouse" ? "pro" : getPlanFromActiveSubscriptions(subscriptions || []);
  return { distribution, plan, isDevelopmentStore, allowed: isProFeaturesAllowed({ distribution, plan, isDevelopmentStore }) };
}

// ---------------------------------------------------------------------------
// 持ち帰りと配送（会計の前: POS のカートに書く）
// ---------------------------------------------------------------------------

const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県",
  "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県",
  "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];

/** 「東京都」「東京」「JP-13」→「JP-13」。分からなければ ""。 */
export function prefectureCode(value) {
  const raw = String(value || "").trim();
  if (/^JP-(0[1-9]|[1-3]\d|4[0-7])$/.test(raw)) return raw;
  const index = PREFECTURES.findIndex((name) => name === raw || name.replace(/[都道府県]$/, "") === raw);
  return index >= 0 ? `JP-${String(index + 1).padStart(2, "0")}` : "";
}

/** 配送先の入力を確かめる（国内だけ）。 */
export function normalizeAddress(input) {
  const address = {
    lastName: String(input?.lastName || "").trim(),
    firstName: String(input?.firstName || "").trim(),
    zip: String(input?.zip || "").trim(),
    provinceCode: prefectureCode(input?.province),
    city: String(input?.city || "").trim(),
    address1: String(input?.address1 || "").trim(),
    address2: String(input?.address2 || "").trim(),
    phone: String(input?.phone || "").trim(),
    countryCode: "JP",
  };
  const missing = [];
  if (!address.lastName) missing.push("姓");
  if (!address.zip) missing.push("郵便番号");
  if (!address.city) missing.push("市区町村");
  if (!address.address1) missing.push("住所");
  if (!address.phone) missing.push("電話番号");
  if (missing.length) return { error: `配送先の「${missing.join("」「")}」を入れてください。` };
  if (!/^\d{3}-?\d{4}$/.test(address.zip)) return { error: "郵便番号は 7 けたの数字で入れてください。" };
  if (!address.provinceCode) return { error: "都道府県を確かめてください（例: 東京都）。" };
  return { address };
}

/**
 * 「配送を確定」のときにカートへ書く中身を作る。
 * @param {{lines: {uuid: string, variantId?: number|string|null, quantity: number, title?: string}[], shipQuantities: Record<string, number>, address: object}} input
 * @param {object} row 店舗の設定（locationRow）
 * @returns {{error: string} | {cartProperties: Record<string,string>, lineProperties: {uuid: string, quantity: number}[], clearLines: string[], fee: number, title: string, shipCount: number}}
 */
export function buildDeliveryCart(input, row) {
  if (!row?.enabled || !row.warehouseLocationId) return { error: "この店舗では配送を使わない設定です。" };
  if (sameId(row.warehouseLocationId, row.locationId)) return { error: "出荷元が販売する店舗と同じです。管理画面の設定を直してください。" };
  const normalized = normalizeAddress(input?.address);
  if (normalized.error) return normalized;
  const lineProperties = [];
  const clearLines = [];
  let shipCount = 0;
  for (const line of input?.lines || []) {
    if (!numericId(line.variantId)) continue;
    const quantity = whole(line.quantity) ?? 0;
    const ship = whole(input?.shipQuantities?.[line.uuid] ?? 0);
    if (ship == null) return { error: `「${line.title || "商品"}」の配送する数量を確かめてください。` };
    if (ship > quantity) return { error: `「${line.title || "商品"}」の配送する数量がカートの数量より多いです。` };
    if (ship > 0) {
      lineProperties.push({ uuid: line.uuid, quantity: ship });
      shipCount += ship;
    } else {
      clearLines.push(line.uuid);
    }
  }
  if (!shipCount) return { error: "配送する商品の数量を 1 つ以上にしてください。" };
  const fee = whole(row.shippingFee) ?? 0;
  const title = row.shippingTitle || "送料";
  const delivery = { v: 1, from: numericId(row.warehouseLocationId), fee, title, to: normalized.address };
  return { cartProperties: { [DELIVERY_ATTRIBUTE]: JSON.stringify(delivery) }, lineProperties, clearLines, fee, title, shipCount };
}

/** 送料のカスタム売上をカートに合わせる（同じ名前の行は 1 つだけ）。 */
export function feeSync(cartLines, title, fee) {
  const feeLines = (cartLines || []).filter((line) => !numericId(line.variantId) && line.title === title);
  const price = Number(fee || 0).toFixed(2);
  if (!(Number(fee) > 0)) return { remove: feeLines.map((line) => line.uuid), add: null };
  const keep = feeLines.find((line) => Number(line.price).toFixed(2) === price && Number(line.quantity) === 1);
  return {
    remove: feeLines.filter((line) => line !== keep).map((line) => line.uuid),
    add: keep ? null : { title, price, quantity: 1, taxable: false },
  };
}

/** カートの今の配送の点数（タイルの表示用）。 */
export function cartShipCount(cart) {
  if (!cart?.properties?.[DELIVERY_ATTRIBUTE]) return 0;
  let count = 0;
  for (const line of cart.lineItems || []) {
    const ship = whole(line.properties?.[SHIP_QTY_PROPERTY]);
    if (ship) count += Math.min(ship, whole(line.quantity) ?? 0);
  }
  return count;
}

export function parseDelivery(raw) {
  let data;
  try {
    data = JSON.parse(String(raw || ""));
  } catch {
    return null;
  }
  if (!data || data.v !== 1 || !numericId(data.from)) return null;
  const normalized = normalizeAddress({ ...data.to, province: data.to?.provinceCode });
  if (normalized.error) return null;
  return { from: numericId(data.from), fee: whole(data.fee) ?? 0, title: String(data.title || "送料"), to: normalized.address };
}

// ---------------------------------------------------------------------------
// 会計のあと（サーバー: orders/paid と管理画面の再処理）
// ---------------------------------------------------------------------------

function emptyStep(phase, reason) {
  return { phase, reason: reason || null, message: reason ? messageFor(reason) : "", moves: [], fulfills: [], handoff: null, addressInput: null, storeQuantity: 0 };
}

function attribute(list, key) {
  return (list || []).find((item) => item.key === key)?.value ?? "";
}

function hasSettlementMarker(order) {
  const words = ["精算", "点検"];
  if ((order.tags || []).some((tag) => words.some((w) => String(tag).includes(w)))) return true;
  return (order.customAttributes || []).some((item) => words.some((w) => `${item.key || ""}${item.value || ""}`.includes(w)));
}

function activeFulfillmentOrders(order) {
  return (order.fulfillmentOrders || []).filter((fo) => !["CLOSED", "CANCELLED", "INCOMPLETE"].includes(fo.status));
}

const BLOCKED_REQUESTS = new Set(["SUBMITTED", "ACCEPTED", "CANCELLATION_REQUESTED", "CANCELLATION_REJECTED"]);

/** 明細ごとの「配送する数量」。会計の前に数量が減っていたら、今の数量までにする。 */
export function shipByLine(order) {
  const map = new Map();
  for (const line of order.lines || []) {
    const ship = whole(attribute(line.customAttributes, SHIP_QTY_PROPERTY));
    if (!ship) continue;
    const quantity = Math.min(ship, whole(line.quantity) ?? 0);
    if (quantity > 0) map.set(line.id, quantity);
  }
  return map;
}

function remainingAt(order, lineItemId, locationId) {
  let total = 0;
  for (const fo of activeFulfillmentOrders(order)) {
    if (!sameId(fo.locationId, locationId)) continue;
    for (const line of fo.lines || []) if (line.lineItemId === lineItemId) total += line.remaining;
  }
  return total;
}

function fulfilledAt(order, lineItemId, locationId) {
  let total = 0;
  for (const shipment of order.fulfillments || []) {
    if (!sameId(shipment.locationId, locationId)) continue;
    for (const line of shipment.lines || []) if (line.lineItemId === lineItemId) total += line.quantity;
  }
  return total;
}

function shippingInput(order, address) {
  const current = order.shippingAddress || {};
  const same = ["lastName", "zip", "provinceCode", "city", "address1", "address2", "phone"].every(
    (key) => String(current[key] || "") === String(address[key] || ""),
  );
  if (same) return null;
  return {
    id: order.id,
    shippingAddress: {
      lastName: address.lastName,
      firstName: address.firstName,
      zip: address.zip,
      provinceCode: address.provinceCode,
      countryCode: address.countryCode,
      city: address.city,
      address1: address.address1,
      address2: address.address2,
      phone: address.phone,
    },
  };
}

/**
 * 注文の今の状態から、次にすることを決める（何度呼んでも同じ結果になる。済んだ分は数えて除く）。
 * @param {object} order loadSaleOrder の形
 * @param {object} config parseConfig の形
 * @returns {{phase: "skip"|"review"|"move"|"fulfill"|"done", reason: string|null, moves: any[], fulfills: any[], handoff: any, addressInput: any, storeQuantity: number}}
 */
export function planSale(order, config) {
  const raw = attribute(order.customAttributes, DELIVERY_ATTRIBUTE);
  if (!raw) return emptyStep("skip", "no_delivery");
  if (!config?.deliveryEnabled) return emptyStep("skip", "switch_off");
  if (String(order.sourceName || "").toLowerCase() !== "pos") return emptyStep("skip", "not_pos");
  if (!order.salesLocationId) return emptyStep("review", "no_location");
  if (order.cancelledAt) return emptyStep("skip", "cancelled");
  if (order.displayFinancialStatus !== "PAID") return emptyStep("review", "unpaid");
  if ((order.refundCount || 0) > 0) return emptyStep("review", "refund");
  if (order.returnStatus && order.returnStatus !== "NO_RETURN") return emptyStep("review", "return");
  if (hasSettlementMarker(order)) return emptyStep("skip", "no_delivery");

  const row = locationRow(config, order.salesLocationId);
  if (!row?.enabled) return emptyStep("review", "location_off");
  const delivery = parseDelivery(raw);
  if (!delivery) return emptyStep("review", "bad_delivery");
  if (sameId(delivery.from, order.salesLocationId)) return emptyStep("review", "same_location");
  const ship = shipByLine(order);
  if (!ship.size) return emptyStep("review", "no_ship_lines");

  const active = activeFulfillmentOrders(order);
  if (active.some((fo) => fo.method === "PICK_UP")) return emptyStep("review", "pickup_mixed");
  if (active.some((fo) => BLOCKED_REQUESTS.has(fo.requestStatus))) return emptyStep("review", "fulfillment_request");
  if (active.some((fo) => fo.status === "ON_HOLD")) return emptyStep("review", "on_hold");
  if (active.some((fo) => fo.status === "SCHEDULED")) return emptyStep("review", "scheduled");

  const feeCharged = (order.lines || [])
    .filter((line) => !line.variantId && line.title === delivery.title)
    .reduce((sum, line) => sum + Number(line.unitPrice || 0) * Number(line.quantity || 0), 0);
  const handoff = {
    salesLocationId: numericId(order.salesLocationId),
    warehouseLocationId: delivery.from,
    shippingFee: delivery.fee,
    shippingFeeCharged: Math.round(feeCharged),
    currency: "JPY",
    destination: delivery.to,
    lines: (order.lines || [])
      .filter((line) => ship.has(line.id))
      .map((line) => ({ lineItemId: numericId(line.id), sku: line.sku || "", title: line.title || "", quantity: ship.get(line.id) })),
  };
  const side = { handoff, addressInput: shippingInput(order, delivery.to) };

  // 1) 配送する分のうち、まだ出荷元に無い分を、販売店舗の出荷指示から出荷元へ移す
  const need = new Map();
  for (const [lineItemId, quantity] of ship) {
    const there = remainingAt(order, lineItemId, delivery.from) + fulfilledAt(order, lineItemId, delivery.from);
    need.set(lineItemId, Math.max(0, quantity - there));
  }
  const moves = [];
  for (const fo of active) {
    if (!sameId(fo.locationId, order.salesLocationId)) continue;
    const lines = [];
    for (const line of fo.lines || []) {
      const left = need.get(line.lineItemId) || 0;
      if (left <= 0 || line.remaining <= 0) continue;
      const quantity = Math.min(left, line.remaining);
      lines.push({ id: line.id, quantity });
      need.set(line.lineItemId, left - quantity);
    }
    if (lines.length) moves.push({ id: fo.id, newLocationId: gid("Location", delivery.from), fulfillmentOrderLineItems: lines });
  }
  // 移す元が残っていない（店頭で引渡済みにされた）
  if ([...need.values()].some((left) => left > 0)) return { ...emptyStep("review", "already_fulfilled"), ...side };
  if (moves.length) return { ...emptyStep("move", null), ...side, moves };

  // 2) 販売店舗に残っている分は持ち帰り。通知なしで履行する（配送分は出荷元に未履行のまま残す）
  const fulfills = [];
  let storeQuantity = 0;
  for (const fo of active) {
    if (!sameId(fo.locationId, order.salesLocationId)) continue;
    const lines = (fo.lines || []).filter((line) => line.remaining > 0).map((line) => ({ id: line.id, quantity: line.remaining }));
    if (!lines.length) continue;
    storeQuantity += lines.reduce((sum, line) => sum + line.quantity, 0);
    fulfills.push({ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: lines });
  }
  if (!fulfills.length) return { ...emptyStep("done", null), ...side };
  return { ...emptyStep("fulfill", null), ...side, fulfills, storeQuantity };
}

// ---------------------------------------------------------------------------
// 店頭受取（POS のタイル）
// ---------------------------------------------------------------------------

/**
 * 受取の出荷指示に対して、押されたボタンで何をするかを決める（最新の状態を読み直してから呼ぶ）。
 * @param {{intent: "prepare"|"complete", locationOk: boolean, method: string, status: string, requestStatus?: string, ready?: boolean, supportedActions?: string[], lines: {id: string, remaining: number}[]}} fo
 */
export function pickupAction(fo, { notifyOnHandover = false } = {}) {
  const changed = "受取の注文が変わりました。一覧を更新してください。";
  if (!fo || !fo.locationOk || fo.method !== "PICK_UP") return { error: changed };
  if (["CANCELLED", "CLOSED", "INCOMPLETE"].includes(fo.status)) {
    return fo.intent === "complete" && fo.status === "CLOSED" ? { already: "fulfilled" } : { error: changed };
  }
  if (fo.status === "ON_HOLD") return { error: "保留中の注文は操作できません。管理画面で保留を外してください。" };
  if (fo.status === "SCHEDULED" || BLOCKED_REQUESTS.has(fo.requestStatus)) return { error: "ほかの出荷依頼・予定がある注文は操作できません。" };
  const lineItems = (fo.lines || []).filter((line) => line.remaining > 0).map((line) => ({ id: line.id, quantity: line.remaining }));
  if (fo.intent === "prepare") {
    if (fo.ready) return { already: "prepared" };
    if (!lineItems.length) return { error: "引き渡す商品が残っていません。" };
    return { mutate: "prepare" };
  }
  if (!lineItems.length) return { already: "fulfilled" };
  if (Array.isArray(fo.supportedActions) && !fo.supportedActions.includes("CREATE_FULFILLMENT")) {
    return { error: "今は引渡し完了にできない状態です。一覧を更新してください。" };
  }
  return { mutate: "complete", lineItems, notifyCustomer: notifyOnHandover === true };
}

/** 一覧の状態の言葉（POS の画面）。 */
export function pickupLabel(fo) {
  if (fo.status === "ON_HOLD") return "保留";
  if (fo.status === "SCHEDULED") return "予定";
  return fo.ready ? "引渡し待ち" : "準備待ち";
}

/** カーソルで全ページを読む。同じカーソルが戻ってきたら止める。 */
export async function collectPages(fetchPage) {
  const nodes = [];
  const seen = new Set();
  let after = null;
  for (;;) {
    const page = await fetchPage(after);
    nodes.push(...(page?.nodes || []));
    if (!page?.pageInfo?.hasNextPage) return nodes;
    after = page.pageInfo.endCursor;
    if (!after || seen.has(after)) throw new Error(messageFor("pagination"));
    seen.add(after);
  }
}
