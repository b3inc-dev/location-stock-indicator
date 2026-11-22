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
/** 明細の属性。商品ごとに出荷元を選んだときの、この明細の出荷元（ロケーションの数字の ID）。 */
export const SHIP_FROM_PROPERTY = "_lsi_from";
/**
 * 送料の行（カスタム売上）の印。明細の属性で、注文の明細の customAttributes に残る（先頭の _ でレシートには出ない）。
 * POS Receipt・Shop Point はこの印で送料の行を見分ける（T 11/23 3:40）:
 *   _lsi_fee        = "1"            … この行は Location Stock の送料
 *   _lsi_fee_sales  = "1" | "0"      … 売上に含めるか（会計のときの設定の値）
 *   _lsi_fee_points = "1" | "0"      … ポイントの対象にするか（会計のときの設定の値）
 */
export const FEE_PROPERTY = "_lsi_fee";
export const FEE_SALES_PROPERTY = "_lsi_fee_sales";
export const FEE_POINTS_PROPERTY = "_lsi_fee_points";
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
    "配送する分が店頭で引渡済みになっています。会計の前に「フルフィルメント済みにする」をオフにするか、管理画面の「店頭で履行済みになった配送分を取り消して出荷元へ移す」をオンにしてから再処理してください。",
  waiting_fulfillment_orders: "Shopify の出荷指示がまだできていません。少し待ってから再処理してください。",
  cancel: "店頭の履行を取り消せませんでした。",
  cancel_incomplete: "店頭の履行を取り消したあとも、配送する分が店頭で引渡済みのままです。",
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
  // shippingTaxable: 送料の行に消費税をかける（日本では送料も課税。既定は税あり。T が確かめる 11/23）
  // cancelStoreFulfillment: 店頭で履行済みにされた配送分を取り消して出荷元へ移す（POS Lite で
  //   「フルフィルメント済みにする」をオフにできないときの道。T 11/23 3:30。既定オフ）
  return {
    version: 1,
    pickupEnabled: false,
    pickupNotifyOnHandover: false,
    deliveryEnabled: false,
    cancelStoreFulfillment: false,
    shippingTaxable: true,
    // 送料の行を売上に含めるか・ポイントの対象にするか（行の印に書く。読むのは POS Receipt・Shop Point。T が確かめる）
    feeCountsAsSales: true,
    feeEarnsPoints: false,
    locations: [],
  };
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
    cancelStoreFulfillment: data.cancelStoreFulfillment === true,
    shippingTaxable: data.shippingTaxable !== false,
    feeCountsAsSales: data.feeCountsAsSales !== false,
    feeEarnsPoints: data.feeEarnsPoints === true,
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
    // 出荷元は会計ごとに POS で必ず選ぶ（T 11/23 3:40）。ここで決めるのは、POS で最初に選んでおく「既定の出荷元」（空でよい）
    if (warehouseLocationId && !known.some((l) => l.id === warehouseLocationId)) {
      errors.push(`「${label}」の既定の出荷元が見つかりません。`);
    }
    if (warehouseLocationId && warehouseLocationId === locationId) {
      errors.push(`「${label}」の既定の出荷元は、販売する店舗と別のロケーションにしてください。`);
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
    cancelStoreFulfillment: input?.cancelStoreFulfillment === true,
    shippingTaxable: input?.shippingTaxable === true,
    feeCountsAsSales: input?.feeCountsAsSales === true,
    feeEarnsPoints: input?.feeEarnsPoints === true,
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
  return Boolean(locationRow(config, locationId)?.enabled);
}

/**
 * POS の「配送の分け」で出す出荷元の候補（販売する店舗を除く）と、最初に選んでおく値。
 * 既定の出荷元は、候補にあるときだけ先に選んでおく（画面に出すので黙って決めない）。
 */
export function shipFromChoices(locations, row) {
  const choices = (locations || [])
    .map((l) => ({ id: numericId(l.id), name: String(l.name || numericId(l.id)) }))
    .filter((l) => l.id && !sameId(l.id, row?.locationId));
  const preset = choices.some((l) => sameId(l.id, row?.warehouseLocationId)) ? numericId(row.warehouseLocationId) : "";
  return { choices, preset };
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
 * 出荷元は必ず選ぶ（T 11/23 3:40「発送の際は必ず商品ごとかまとめて選択」）:
 *   mode "all"   … 配送全体で 1 つ（input.from）
 *   mode "items" … 配送する明細ごとに 1 つ（input.lineFrom[uuid]）。明細の属性 _lsi_from に書く
 * @param {{lines: {uuid: string, variantId?: number|string|null, quantity: number, title?: string}[], shipQuantities: Record<string, number>, address: object, mode?: "all"|"items", from?: string, lineFrom?: Record<string, string>}} input
 * @param {object} row 店舗の設定（locationRow）
 * @returns {{error: string} | {cartProperties: Record<string,string>, lineProperties: {uuid: string, quantity: number, from: string|null}[], clearLines: string[], fee: number, title: string, shipCount: number, mode: "all"|"items"}}
 */
export function buildDeliveryCart(input, row) {
  if (!row?.enabled) return { error: "この店舗では配送を使わない設定です。" };
  const mode = input?.mode === "items" ? "items" : "all";
  const from = numericId(input?.from);
  if (mode === "all") {
    if (!from) return { error: "出荷元を選んでください。" };
    if (sameId(from, row.locationId)) return { error: "出荷元は、販売する店舗と別のロケーションを選んでください。" };
  }
  const normalized = normalizeAddress(input?.address);
  if (normalized.error) return normalized;
  const lineProperties = [];
  const clearLines = [];
  let shipCount = 0;
  for (const line of input?.lines || []) {
    if (!numericId(line.variantId)) continue;
    const quantity = whole(line.quantity) ?? 0;
    const ship = whole(input?.shipQuantities?.[line.uuid] ?? 0);
    const name = line.title || "商品";
    if (ship == null) return { error: `「${name}」の配送する数量を確かめてください。` };
    if (ship > quantity) return { error: `「${name}」の配送する数量がカートの数量より多いです。` };
    if (ship > 0) {
      let lineFrom = null;
      if (mode === "items") {
        lineFrom = numericId(input?.lineFrom?.[line.uuid]);
        if (!lineFrom) return { error: `「${name}」の出荷元を選んでください。` };
        if (sameId(lineFrom, row.locationId)) return { error: `「${name}」の出荷元は、販売する店舗と別のロケーションを選んでください。` };
      }
      lineProperties.push({ uuid: line.uuid, quantity: ship, from: lineFrom });
      shipCount += ship;
    } else {
      clearLines.push(line.uuid);
    }
  }
  if (!shipCount) return { error: "配送する商品の数量を 1 つ以上にしてください。" };
  const fee = whole(row.shippingFee) ?? 0;
  const title = row.shippingTitle || "送料";
  const delivery = mode === "items" ? { v: 1, mode, fee, title, to: normalized.address } : { v: 1, mode, from, fee, title, to: normalized.address };
  return { cartProperties: { [DELIVERY_ATTRIBUTE]: JSON.stringify(delivery) }, lineProperties, clearLines, fee, title, shipCount, mode };
}

/** 送料の行か（印があるか、印の前の版の行なら同じ名前のカスタム売上）。 */
export function isFeeLine(line, title) {
  if (numericId(line?.variantId)) return false;
  const props = line?.properties || {};
  if (props[FEE_PROPERTY] === "1") return true;
  return Boolean(title) && line?.title === title;
}

/** 送料の行に付ける印（会計のときの設定をそのまま写す）。 */
export function feeProperties(config) {
  return {
    [FEE_PROPERTY]: "1",
    [FEE_SALES_PROPERTY]: config?.feeCountsAsSales === false ? "0" : "1",
    [FEE_POINTS_PROPERTY]: config?.feeEarnsPoints === true ? "1" : "0",
  };
}

/**
 * 送料のカスタム売上をカートに合わせる（同じ名前の行は 1 つだけ）。
 * taxable: 送料に消費税をかけるか（設定の shippingTaxable。既定は税あり）。
 */
export function feeSync(cartLines, title, fee, taxable = true) {
  const feeLines = (cartLines || []).filter((line) => isFeeLine(line, title));
  const price = Number(fee || 0).toFixed(2);
  const wantTaxable = taxable !== false;
  if (!(Number(fee) > 0)) return { remove: feeLines.map((line) => line.uuid), add: null };
  const keep = feeLines.find(
    (line) =>
      Number(line.price).toFixed(2) === price &&
      Number(line.quantity) === 1 &&
      // 税のあり・なしが読める行は、設定と同じときだけ残す（設定を変えたら入れ直す）
      (typeof line.taxable !== "boolean" || line.taxable === wantTaxable),
  );
  return {
    remove: feeLines.filter((line) => line !== keep).map((line) => line.uuid),
    add: keep ? null : { title, price, quantity: 1, taxable: wantTaxable },
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

/**
 * カートの属性 _lsi_delivery を読む。
 * 配送先（to）は、会計のあとサーバーが注文の配送先住所に書いたら消す（scrubDelivery）。
 * 消したあとは to が null で返る（配送先は注文の配送先住所が正）。
 */
export function parseDelivery(raw) {
  let data;
  try {
    data = JSON.parse(String(raw || ""));
  } catch {
    return null;
  }
  if (!data || data.v !== 1) return null;
  // mode が無いのは最初の版（配送全体で 1 つ）
  const mode = data.mode === "items" ? "items" : "all";
  if (mode === "all" && !numericId(data.from)) return null;
  const base = { mode, from: mode === "all" ? numericId(data.from) : "", fee: whole(data.fee) ?? 0, title: String(data.title || "送料") };
  if (data.to == null) return { ...base, to: null };
  const normalized = normalizeAddress({ ...data.to, province: data.to?.provinceCode });
  if (normalized.error) return null;
  return { ...base, to: normalized.address };
}

/** _lsi_delivery から配送先（名前・住所・電話）を外した値。外すものが無ければ null。 */
export function scrubDelivery(raw) {
  let data;
  try {
    data = JSON.parse(String(raw || ""));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || data.to == null) return null;
  const { to: _removed, ...rest } = data;
  return JSON.stringify(rest);
}

/**
 * 注文の customAttributes のうち _lsi_delivery の配送先だけを外した一覧（orderUpdate は一覧を丸ごと置きかえるので、ほかの属性は残す）。
 * 外すものが無ければ null。
 */
export function scrubbedAttributes(customAttributes) {
  const list = Array.isArray(customAttributes) ? customAttributes : [];
  const index = list.findIndex((item) => item?.key === DELIVERY_ATTRIBUTE);
  if (index < 0) return null;
  const value = scrubDelivery(list[index].value);
  if (value == null) return null;
  return list.map((item, i) => ({ key: String(item.key), value: i === index ? value : String(item.value ?? "") }));
}

/** 配送の記録（delivery_handoff）から、前の版で入れていた配送先（destination）を外す。外すものが無ければ null。 */
export function scrubHandoff(raw) {
  let data;
  try {
    data = JSON.parse(String(raw || ""));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || !("destination" in data)) return null;
  const { destination: _removed, ...rest } = data;
  return JSON.stringify(rest);
}

// ---------------------------------------------------------------------------
// 会計のあと（サーバー: orders/paid と管理画面の再処理）
// ---------------------------------------------------------------------------

function emptyStep(phase, reason) {
  return { phase, reason: reason || null, message: reason ? messageFor(reason) : "", cancels: [], moves: [], fulfills: [], handoff: null, addressInput: null, storeQuantity: 0 };
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

/**
 * 明細ごとの出荷元。まとめて選んだときは全部 delivery.from、商品ごとのときは明細の属性 _lsi_from。
 * まとめてのときは明細の属性を読まない（前に商品ごとにして残った値で動かさない）。読めない明細は ""。
 */
export function shipFromByLine(order, delivery, ship) {
  const map = new Map();
  for (const line of order.lines || []) {
    if (!ship.has(line.id)) continue;
    map.set(line.id, delivery.mode === "items" ? numericId(attribute(line.customAttributes, SHIP_FROM_PROPERTY)) : delivery.from);
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

/**
 * 注文に書く orderUpdate の入力（配送先住所と、属性から配送先を外すこと）。書くものが無ければ null。
 * 配送先住所を書くのと同じ 1 回で、カートの属性 _lsi_delivery の配送先（to）を外す（コピーを残さない）。
 */
function orderInput(order, address) {
  const scrubbed = scrubbedAttributes(order.customAttributes);
  const addressPart = address ? shippingInput(order, address) : null;
  if (!addressPart && !scrubbed) return null;
  return { id: order.id, ...(addressPart || {}), ...(scrubbed ? { customAttributes: scrubbed } : {}) };
}

function shippingInput(order, address) {
  const current = order.shippingAddress || {};
  const same = ["lastName", "zip", "provinceCode", "city", "address1", "address2", "phone"].every(
    (key) => String(current[key] || "") === String(address[key] || ""),
  );
  if (same) return null;
  return {
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
 * @returns {{phase: "skip"|"retry"|"review"|"cancel"|"move"|"fulfill"|"done", reason: string|null, cancels: any[], moves: any[], fulfills: any[], handoff: any, addressInput: any, storeQuantity: number}}
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
  // 配送先を属性から外したあとは、注文の配送先住所が正。どちらも無ければ読めない
  if (!delivery.to && !order.shippingAddress) return emptyStep("review", "bad_delivery");
  const ship = shipByLine(order);
  if (!ship.size) return emptyStep("review", "no_ship_lines");
  const targets = shipFromByLine(order, delivery, ship);
  if ([...targets.values()].some((id) => !id)) return emptyStep("review", "bad_delivery");
  if ([...targets.values()].some((id) => sameId(id, order.salesLocationId))) return emptyStep("review", "same_location");

  const active = activeFulfillmentOrders(order);
  if (active.some((fo) => fo.method === "PICK_UP")) return emptyStep("review", "pickup_mixed");
  if (active.some((fo) => BLOCKED_REQUESTS.has(fo.requestStatus))) return emptyStep("review", "fulfillment_request");
  if (active.some((fo) => fo.status === "ON_HOLD")) return emptyStep("review", "on_hold");
  if (active.some((fo) => fo.status === "SCHEDULED")) return emptyStep("review", "scheduled");
  // Shopify は出荷指示を注文のすぐあとに作る。まだ 1 つも無く、履行も無いときは待つ（印を付けず、送り直してもらう）
  if (!active.length && !(order.fulfillments || []).length) return emptyStep("retry", "waiting_fulfillment_orders");

  const feeLines = (order.lines || []).filter(
    (line) => !line.variantId && (attribute(line.customAttributes, FEE_PROPERTY) === "1" || line.title === delivery.title),
  );
  const feeCharged = feeLines.reduce((sum, line) => sum + Number(line.unitPrice || 0) * Number(line.quantity || 0), 0);
  const handoff = {
    salesLocationId: numericId(order.salesLocationId),
    // まとめて選んだときだけ 1 つ。商品ごとのときは null で、明細ごとの warehouseLocationId を見る
    shipFromMode: delivery.mode,
    warehouseLocationId: delivery.mode === "all" ? delivery.from : null,
    shippingFee: delivery.fee,
    shippingFeeCharged: Math.round(feeCharged),
    // 送料の行（POS Receipt・Shop Point が見分けるとき、明細の印 _lsi_fee と同じ行）
    feeLineItemIds: feeLines.map((line) => numericId(line.id)),
    currency: "JPY",
    // 配送先（名前・住所・電話）はここに写さない。倉庫は注文の配送先住所を読む（見直し 11/23）
    lines: (order.lines || [])
      .filter((line) => ship.has(line.id))
      .map((line) => ({ lineItemId: numericId(line.id), sku: line.sku || "", title: line.title || "", quantity: ship.get(line.id), warehouseLocationId: targets.get(line.id) })),
  };
  const side = { handoff, addressInput: orderInput(order, delivery.to) };

  // 1) 配送する分のうち、まだその明細の出荷元に無い分を、販売店舗の出荷指示から出荷元へ移す
  const need = new Map();
  for (const [lineItemId, quantity] of ship) {
    const target = targets.get(lineItemId);
    const there = remainingAt(order, lineItemId, target) + fulfilledAt(order, lineItemId, target);
    need.set(lineItemId, Math.max(0, quantity - there));
  }
  // 1 回に移すのは 1 つの出荷元の分だけ（出荷元が分かれると、1 つの出荷指示が出荷元ごとに分かれる。
  // 移したあとは出荷指示の明細の ID が変わりうるので、読み直してから次の出荷元の分を移す）
  const waitingTargets = [...new Set([...need].filter(([, left]) => left > 0).map(([id]) => targets.get(id)))].sort();
  const moveTarget = waitingTargets.find((target) =>
    active.some((fo) => sameId(fo.locationId, order.salesLocationId) && (fo.lines || []).some((line) => line.remaining > 0 && (need.get(line.lineItemId) || 0) > 0 && targets.get(line.lineItemId) === target)),
  );
  const moves = [];
  const left = new Map(need);
  if (moveTarget) {
    for (const fo of active) {
      if (!sameId(fo.locationId, order.salesLocationId)) continue;
      const lines = [];
      for (const line of fo.lines || []) {
        if (targets.get(line.lineItemId) !== moveTarget) continue;
        const want = left.get(line.lineItemId) || 0;
        if (want <= 0 || line.remaining <= 0) continue;
        const quantity = Math.min(want, line.remaining);
        lines.push({ id: line.id, quantity });
        left.set(line.lineItemId, want - quantity);
      }
      if (lines.length) moves.push({ id: fo.id, newLocationId: gid("Location", moveTarget), fulfillmentOrderLineItems: lines });
    }
  }
  // 販売店舗に移す元が足りるか（店頭で引渡済みにされていないか）を、全部の出荷元の分で見る
  const short = new Map(need);
  for (const fo of active) {
    if (!sameId(fo.locationId, order.salesLocationId)) continue;
    for (const line of fo.lines || []) {
      const want = short.get(line.lineItemId) || 0;
      if (want > 0 && line.remaining > 0) short.set(line.lineItemId, Math.max(0, want - line.remaining));
    }
  }
  // 移す元が残っていない（店頭で引渡済みにされた）
  if ([...short.values()].some((n) => n > 0)) {
    // POS Lite で「フルフィルメント済みにする」をオフにできないときの道（T 11/23 3:30・既定オフ）:
    // 配送する明細を含む、販売店舗での履行を取り消す。取り消した分は販売店舗の出荷指示に戻るので、次の 1 歩で出荷元へ移す。
    // 取り消すのは履行の丸ごと（持ち帰り分も一度戻る）。持ち帰り分は移したあとにまた通知なしで履行する。
    if (config.cancelStoreFulfillment) {
      const cancels = (order.fulfillments || [])
        .filter((f) => f.id && sameId(f.locationId, order.salesLocationId))
        .filter((f) => (f.lines || []).some((line) => (short.get(line.lineItemId) || 0) > 0 && line.quantity > 0))
        .map((f) => ({ id: f.id }));
      if (cancels.length) return { ...emptyStep("cancel", null), ...side, cancels };
    }
    return { ...emptyStep("review", "already_fulfilled"), ...side };
  }
  if (moves.length) return { ...emptyStep("move", null), ...side, moves };

  // 2) 販売店舗に残っている分は持ち帰り。通知なしで履行する（配送分は出荷元に未履行のまま残す）
  // 持ち帰りの点数は商品の明細だけで数える（送料などのカスタム売上の行は数えない）
  const productLines = new Set((order.lines || []).filter((line) => line.variantId).map((line) => line.id));
  const fulfills = [];
  let storeQuantity = 0;
  for (const fo of active) {
    if (!sameId(fo.locationId, order.salesLocationId)) continue;
    const open = (fo.lines || []).filter((line) => line.remaining > 0);
    if (!open.length) continue;
    storeQuantity += open.filter((line) => productLines.has(line.lineItemId)).reduce((sum, line) => sum + line.remaining, 0);
    fulfills.push({ fulfillmentOrderId: fo.id, fulfillmentOrderLineItems: open.map((line) => ({ id: line.id, quantity: line.remaining })) });
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
