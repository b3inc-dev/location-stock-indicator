export const CONFIG_NAMESPACE = "location_stock";
export const CONFIG_KEY = "pos_operations";
export const RECEPTION_ATTRIBUTE = "_lsi_reception";
export const HANDOFF_KEY = "delivery_handoff";
export const REVIEW_KEY = "review_reason";
export const REVIEW_TAG = "location-stock-review";

const MESSAGES = {
  outside: "対象期間外の注文です。",
  not_pos: "POS以外の注文です。",
  not_pos_location: "販売店舗が確認できません。",
  unpaid: "支払済みではありません。",
  cancelled: "キャンセルされた注文です。",
  refund: "返品を含む注文です。",
  return: "返品・交換の注文です。",
  settlement: "精算・点検の注文です。",
  pickup: "受取注文です。",
  pickup_mixed: "受取と配送の情報が同時にあります。",
  fulfillment_request: "別の出荷依頼がある注文です。",
  on_hold: "保留中の出荷指示です。",
  scheduled: "予定された出荷指示です。",
  partial_plan: "配送受付の情報が不足しています。",
  fee_left: "取り消した配送の送料が残っています。",
  fee_mismatch: "送料が注文金額と一致しません。",
  inconsistent: "配送数量と注文数量が一致しません。",
  warehouse_short: "倉庫へ移せる数量が足りません。",
  move_incomplete: "倉庫への割当後も移動が残っています。",
  network: "通信に失敗しました。再処理してください。",
  pagination: "明細を最後まで取得できませんでした。",
};

const PREFECTURES = {
  北海道: "JP-01",
  青森県: "JP-02",
  岩手県: "JP-03",
  宮城県: "JP-04",
  秋田県: "JP-05",
  山形県: "JP-06",
  福島県: "JP-07",
  茨城県: "JP-08",
  栃木県: "JP-09",
  群馬県: "JP-10",
  埼玉県: "JP-11",
  千葉県: "JP-12",
  東京都: "JP-13",
  神奈川県: "JP-14",
  新潟県: "JP-15",
  富山県: "JP-16",
  石川県: "JP-17",
  福井県: "JP-18",
  山梨県: "JP-19",
  長野県: "JP-20",
  岐阜県: "JP-21",
  静岡県: "JP-22",
  愛知県: "JP-23",
  三重県: "JP-24",
  滋賀県: "JP-25",
  京都府: "JP-26",
  大阪府: "JP-27",
  兵庫県: "JP-28",
  奈良県: "JP-29",
  和歌山県: "JP-30",
  鳥取県: "JP-31",
  島根県: "JP-32",
  岡山県: "JP-33",
  広島県: "JP-34",
  山口県: "JP-35",
  徳島県: "JP-36",
  香川県: "JP-37",
  愛媛県: "JP-38",
  高知県: "JP-39",
  福岡県: "JP-40",
  佐賀県: "JP-41",
  長崎県: "JP-42",
  熊本県: "JP-43",
  大分県: "JP-44",
  宮崎県: "JP-45",
  鹿児島県: "JP-46",
  沖縄県: "JP-47",
};

const BLOCKED_REQUESTS = new Set([
  "SUBMITTED",
  "ACCEPTED",
  "CANCELLATION_REQUESTED",
  "CANCELLATION_REJECTED",
]);

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

export function planKey(id) {
  const clean = String(id || "").replace(/[^a-zA-Z0-9]/g, "");
  if (clean.length < 8 || clean.length > 40) return null;
  return `delivery_${clean}`;
}

export function newReceptionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function inPeriod(row, iso) {
  if (!row?.startsAt) return false;
  const created = Date.parse(iso);
  const start = Date.parse(row.startsAt);
  if (!Number.isFinite(created) || !Number.isFinite(start) || created < start) return false;
  if (!row.endsAt) return true;
  const end = Date.parse(row.endsAt);
  return Number.isFinite(end) && created < end;
}

export function settingsFor(config, locationId, createdAt) {
  const row = (config?.locations || []).find((item) => sameId(item.locationId, locationId));
  if (!row || !inPeriod(row, createdAt)) return null;
  return row;
}

export function deliveryAvailable(row, nowIso) {
  return Boolean(
    row?.active &&
    row.deliveryEnabled &&
    row.warehouseLocationId &&
    !sameId(row.warehouseLocationId, row.locationId) &&
    inPeriod(row, nowIso)
  );
}

function canonicalLocation(value, knownIds) {
  return knownIds.find((id) => sameId(id, value)) || "";
}

export function normalizeOperations(input, knownIds, previous, nowIso) {
  const errors = [];
  const locations = [];
  const rows = Array.isArray(input) ? input : [];
  for (const raw of rows) {
    const locationId = canonicalLocation(raw?.locationId, knownIds);
    if (!locationId) {
      errors.push("ロケーションを確認してください。");
      continue;
    }
    const prev = (previous?.locations || []).find((item) => sameId(item.locationId, locationId));
    let active = Boolean(raw.active);
    let startsAt = String(raw.startsAt || "");
    let endsAt = String(raw.endsAt || "");
    if (active && !startsAt) startsAt = nowIso;
    if (prev?.active && !active && (!endsAt || Date.parse(endsAt) > Date.parse(nowIso))) endsAt = nowIso;
    if (!prev?.active && active && endsAt && Date.parse(endsAt) <= Date.parse(nowIso)) endsAt = "";
    const deliveryEnabled = Boolean(raw.deliveryEnabled);
    const warehouseLocationId = canonicalLocation(raw.warehouseLocationId, knownIds);
    const shippingFee = Number(raw.shippingFee);
    const shippingTitle = String(raw.shippingTitle || "送料").trim() || "送料";
    const delivery = active && deliveryEnabled;
    if (delivery && !warehouseLocationId) errors.push("出荷元の倉庫を設定してください。");
    if (delivery && sameId(warehouseLocationId, locationId)) {
      errors.push("出荷元は販売店舗と別のロケーションにしてください。");
    }
    if (!Number.isInteger(shippingFee) || shippingFee < 0 || shippingFee > 1000000) {
      errors.push("送料は0以上の整数にしてください。");
    }
    if (shippingTitle.length > 30) errors.push("送料名は30文字以内にしてください。");
    locations.push({
      locationId,
      active,
      startsAt,
      endsAt,
      deliveryEnabled: delivery,
      warehouseLocationId,
      shippingFee: Number.isInteger(shippingFee) ? shippingFee : 0,
      shippingTitle,
    });
  }
  return {errors: [...new Set(errors)], locations};
}

function provinceCode(address) {
  const country = String(address.countryCode || "JP").toUpperCase();
  const raw = String(address.province || address.provinceCode || "").trim();
  if (country !== "JP") return /^[A-Z0-9-]{1,10}$/.test(raw) ? raw : "";
  if (PREFECTURES[raw]) return PREFECTURES[raw];
  const withSuffix = PREFECTURES[`${raw}県`] || PREFECTURES[`${raw}府`] || PREFECTURES[`${raw}都`];
  if (withSuffix) return withSuffix;
  if (/^JP-\d{2}$/.test(raw)) return raw;
  return "";
}

export function normalizeAddress(input) {
  const address = {
    lastName: String(input?.lastName || "").trim(),
    firstName: String(input?.firstName || "").trim(),
    zip: String(input?.zip || "").trim(),
    city: String(input?.city || "").trim(),
    address1: String(input?.address1 || "").trim(),
    address2: String(input?.address2 || "").trim(),
    phone: String(input?.phone || "").trim(),
    countryCode: String(input?.countryCode || "JP").trim().toUpperCase(),
    provinceCode: provinceCode(input || {}),
  };
  if (!/^[A-Z]{2}$/.test(address.countryCode)) return {error: "国コードを確認してください。"};
  if (!address.lastName || !address.zip || !address.city || !address.address1 || !address.phone) {
    return {error: "配送先と連絡先を入力してください。"};
  }
  if (!address.provinceCode) return {error: "都道府県を確認してください。"};
  return {address};
}

function whole(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

export function createPlan(input, settings) {
  if (!settings?.deliveryEnabled || !settings.warehouseLocationId) {
    return {error: "この店舗の配送は無効です。"};
  }
  if (sameId(settings.warehouseLocationId, settings.locationId)) {
    return {error: "出荷元は販売店舗と別のロケーションにしてください。"};
  }
  const normalized = normalizeAddress(input?.address);
  if (normalized.error) return normalized;
  const lines = [];
  for (const line of input?.lines || []) {
    const variantId = numericId(line.variantId);
    if (!variantId) continue;
    const quantity = whole(line.quantity);
    const deliveryQuantity = whole(line.deliveryQuantity);
    if (quantity == null || deliveryQuantity == null) return {error: "数量を確認してください。"};
    if (deliveryQuantity > quantity) return {error: "配送数量がカート数量を超えています。"};
    if (deliveryQuantity === 0) continue;
    lines.push({
      uuid: String(line.uuid || variantId),
      variantId,
      sku: String(line.sku || ""),
      title: String(line.title || ""),
      quantity,
      deliveryQuantity,
    });
  }
  if (!lines.length) return {error: "配送する商品を指定してください。"};
  const feeAmount = whole(settings.shippingFee);
  if (feeAmount == null) return {error: "送料を確認してください。"};
  const id = planKey(input.id) ? String(input.id).replace(/[^a-zA-Z0-9]/g, "") : newReceptionId();
  return {
    plan: {
      id,
      status: "open",
      locationId: numericId(settings.locationId),
      warehouseLocationId: numericId(settings.warehouseLocationId),
      shippingTitle: settings.shippingTitle || "送料",
      feeAmount,
      confirmedFee: feeAmount,
      address: normalized.address,
      lines,
    },
  };
}

export function recalculatePlan(plan, cartLines) {
  if (!plan || plan.status === "cancelled") {
    return {...plan, status: "cancelled", lines: [], feeAmount: 0};
  }
  const cart = new Map((cartLines || []).filter((line) => numericId(line.variantId)).map((line) => [String(line.uuid), line]));
  const lines = [];
  for (const line of plan.lines || []) {
    const current = cart.get(String(line.uuid));
    if (!current) continue;
    const quantity = whole(current.quantity);
    if (!quantity) continue;
    lines.push({
      ...line,
      quantity,
      sku: current.sku || line.sku || "",
      deliveryQuantity: Math.min(line.deliveryQuantity, quantity),
    });
  }
  const remaining = lines.filter((line) => line.deliveryQuantity > 0);
  return {
    ...plan,
    lines: remaining,
    feeAmount: remaining.length ? (plan.confirmedFee ?? plan.feeAmount ?? 0) : 0,
    status: remaining.length ? "open" : "cancelled",
  };
}

export function feeSync(cartLines, shippingTitle, fee) {
  const title = shippingTitle || "送料";
  const feeLines = (cartLines || []).filter((line) => !numericId(line.variantId) && line.title === title);
  const price = Number(fee || 0).toFixed(2);
  if (!(Number(fee) > 0)) return {remove: feeLines.map((line) => line.uuid), add: null};
  const match = feeLines.find((line) => Number(line.price).toFixed(2) === price && line.quantity === 1);
  return {
    remove: feeLines.filter((line) => line !== match).map((line) => line.uuid),
    add: match ? null : {title, price, quantity: 1, taxable: false},
  };
}

export function createCartSync(run) {
  let running = false;
  let queued = false;
  return async function schedule() {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    try {
      do {
        queued = false;
        await run();
      } while (queued);
    } finally {
      running = false;
    }
  };
}

function emptyStep(phase, reason) {
  return {
    phase,
    reason,
    message: reason ? messageFor(reason) : "",
    moves: [],
    fulfills: [],
    storeQuantity: 0,
    handoff: null,
    addressInput: null,
    metafield: null,
  };
}

function attribute(order, key) {
  return (order.customAttributes || []).find((item) => item.key === key)?.value || "";
}

function titles(settings, plan) {
  return new Set([settings?.shippingTitle || "送料", plan?.shippingTitle || "送料"].filter(Boolean));
}

function isFee(line, names) {
  return !line.variantKey && names.has(line.title);
}

function activeFulfillments(order) {
  return (order.fulfillmentOrders || []).filter((item) => !["CLOSED", "CANCELLED"].includes(item.status));
}

function purchased(order, key) {
  return (order.lines || [])
    .filter((line) => line.variantKey === key)
    .reduce((sum, line) => sum + line.quantity, 0);
}

function remainingAt(order, key, locationId) {
  let total = 0;
  for (const fulfillment of activeFulfillments(order)) {
    if (locationId && !sameId(fulfillment.locationId, locationId)) continue;
    for (const line of fulfillment.lines || []) {
      if (line.variantKey === key) total += line.remaining;
    }
  }
  return total;
}

function fulfilledAt(order, key, locationId) {
  let total = 0;
  for (const shipment of order.shipments || []) {
    if (shipment.status && shipment.status !== "SUCCESS") continue;
    if (!sameId(shipment.locationId, locationId)) continue;
    for (const line of shipment.lines || []) {
      if (line.variantKey === key) total += Number(line.quantity || 0);
    }
  }
  return total;
}

function accountedAt(order, key, locationId) {
  return remainingAt(order, key, locationId) + fulfilledAt(order, key, locationId);
}

function deliveryMap(plan) {
  const map = new Map();
  for (const line of plan?.lines || []) {
    const key = numericId(line.variantId);
    const quantity = whole(line.deliveryQuantity) || 0;
    if (!key || quantity <= 0) continue;
    map.set(key, (map.get(key) || 0) + quantity);
  }
  return map;
}

function markers(order) {
  const words = ["精算", "点検"];
  const tags = order.tags || [];
  if (tags.some((tag) => words.some((word) => String(tag).includes(word)))) return true;
  return (order.customAttributes || []).some((item) =>
    words.some((word) => `${item.key || ""}${item.value || ""}`.includes(word))
  );
}

function shippingInput(order, address) {
  if (!address) return null;
  const current = order.shippingAddress || {};
  const same = ["address1", "city", "zip", "lastName", "phone", "provinceCode"].every(
    (key) => String(current[key] || "") === String(address[key] || "")
  );
  if (same && current.address1) return null;
  return {
    id: order.id,
    shippingAddress: {
      address1: address.address1,
      address2: address.address2 || "",
      city: address.city,
      zip: address.zip,
      phone: address.phone,
      firstName: address.firstName || "",
      lastName: address.lastName,
      countryCode: address.countryCode,
      provinceCode: address.provinceCode,
    },
  };
}

function handoffFor(order, plan) {
  const grouped = new Map();
  for (const line of plan.lines || []) {
    const key = numericId(line.variantId);
    const current = grouped.get(key) || {variantId: key, sku: line.sku || "", quantity: 0};
    current.quantity += line.deliveryQuantity;
    if (!current.sku && line.sku) current.sku = line.sku;
    grouped.set(key, current);
  }
  return {
    receptionId: plan.id,
    shippingFee: plan.feeAmount,
    currency: "JPY",
    destination: plan.address,
    warehouseLocationId: plan.warehouseLocationId,
    lines: [...grouped.values()],
    salesLocationId: order.salesLocationId,
  };
}

function exclude(order) {
  if (String(order.sourceName || "").toLowerCase() !== "pos") return "not_pos";
  if (!order.salesLocationId) return "not_pos_location";
  if (order.cancelledAt) return "cancelled";
  if (order.displayFinancialStatus !== "PAID") return "unpaid";
  if ((order.refundCount || 0) > 0) return "refund";
  if (order.returnStatus && order.returnStatus !== "NO_RETURN") return "return";
  if (markers(order)) return "settlement";
  return null;
}

export function planSale(order, settings, plan) {
  const reason = exclude(order);
  if (reason) return emptyStep("skip", reason);
  if (!settings || !sameId(settings.locationId, order.salesLocationId)) return emptyStep("skip", "outside");
  const reception = attribute(order, RECEPTION_ATTRIBUTE);
  if (reception && !plan) return emptyStep("review", "partial_plan");
  if (plan?.status === "cancelled") {
    if ((order.lines || []).some((line) => isFee(line, titles(settings, plan)))) return emptyStep("review", "fee_left");
    plan = null;
  }
  const names = titles(settings, plan);
  const active = activeFulfillments(order);
  if (active.some((item) => item.method === "PICK_UP")) {
    return emptyStep(plan ? "review" : "skip", plan ? "pickup_mixed" : "pickup");
  }
  if (active.some((item) => BLOCKED_REQUESTS.has(item.requestStatus))) return emptyStep("skip", "fulfillment_request");
  if (active.some((item) => item.status === "ON_HOLD")) return emptyStep("review", "on_hold");
  if (active.some((item) => item.status === "SCHEDULED")) return emptyStep("review", "scheduled");

  if (plan && !sameId(plan.locationId, order.salesLocationId)) return emptyStep("review", "inconsistent");
  const delivery = plan ? deliveryMap(plan) : new Map();
  for (const [key, quantity] of delivery) {
    if (quantity > purchased(order, key)) return emptyStep("review", "inconsistent");
  }
  if (plan && Math.round(chargedFee(order, names)) !== Number(plan.feeAmount)) return emptyStep("review", "fee_mismatch");

  const moves = [];
  const outstanding = new Map(delivery);
  for (const [key, quantity] of delivery) {
    outstanding.set(key, Math.max(0, quantity - accountedAt(order, key, plan.warehouseLocationId)));
  }
  for (const fulfillment of active) {
    if (!sameId(fulfillment.locationId, order.salesLocationId)) continue;
    const lines = [];
    for (const line of fulfillment.lines || []) {
      const need = outstanding.get(line.variantKey) || 0;
      if (!line.variantKey || need <= 0 || line.remaining <= 0) continue;
      const quantity = Math.min(need, line.remaining);
      lines.push({id: line.id, quantity});
      outstanding.set(line.variantKey, need - quantity);
    }
    if (lines.length) {
      moves.push({
        id: fulfillment.id,
        newLocationId: gid("Location", plan.warehouseLocationId),
        fulfillmentOrderLineItems: lines,
      });
    }
  }
  if ([...outstanding.values()].some((quantity) => quantity > 0)) return emptyStep("review", "warehouse_short");

  const handoff = plan ? handoffFor(order, plan) : null;
  const side = {
    handoff,
    addressInput: handoff ? shippingInput(order, plan.address) : null,
    metafield: handoff
      ? {
          ownerId: order.id,
          namespace: CONFIG_NAMESPACE,
          key: HANDOFF_KEY,
          type: "json",
          value: JSON.stringify(handoff),
        }
      : null,
  };
  if (moves.length) return {...emptyStep("move", null), ...side, moves};

  for (const [key, quantity] of delivery) {
    const takeaway = purchased(order, key) - quantity;
    if (remainingAt(order, key, order.salesLocationId) > takeaway) return emptyStep("review", "warehouse_short");
  }
  const fulfills = [];
  let storeQuantity = 0;
  for (const fulfillment of active) {
    if (!sameId(fulfillment.locationId, order.salesLocationId)) continue;
    const lines = [];
    for (const line of fulfillment.lines || []) {
      if (line.remaining <= 0 || isFee(line, names)) continue;
      lines.push({id: line.id, quantity: line.remaining});
      storeQuantity += line.remaining;
    }
    if (lines.length) {
      fulfills.push({
        fulfillmentOrderId: fulfillment.id,
        notifyCustomer: false,
        fulfillmentOrderLineItems: lines,
      });
    }
  }
  return {...emptyStep("fulfill", null), ...side, fulfills, storeQuantity};
}

function chargedFee(order, names) {
  return (order.lines || [])
    .filter((line) => isFee(line, names))
    .reduce((sum, line) => sum + Number(line.unitPrice || 0) * Number(line.quantity || 0), 0);
}

function gid(type, id) {
  const numeric = numericId(id);
  return numeric ? `gid://shopify/${type}/${numeric}` : id;
}

async function userErrors(request, query, variables, key) {
  const data = await request(query, variables);
  const errors = data?.[key]?.userErrors || [];
  if (errors.length) return errors[0].message || messageFor("network");
  return null;
}

const ORDER_UPDATE = `mutation PosOrderAddress($input: OrderInput!) {
  orderUpdate(input: $input) { order { id } userErrors { field message } }
}`;
const METAFIELDS_SET = `mutation PosMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
}`;
const MOVE = `mutation PosMove($id: ID!, $newLocationId: ID!, $fulfillmentOrderLineItems: [FulfillmentOrderLineItemInput!]) {
  fulfillmentOrderMove(id: $id, newLocationId: $newLocationId, fulfillmentOrderLineItems: $fulfillmentOrderLineItems) {
    movedFulfillmentOrder { id }
    userErrors { field message }
  }
}`;
const FULFILL = `mutation PosFulfill($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } }
}`;
const TAG = `mutation PosTag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;
const UNTAG = `mutation PosUntag($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`;

async function applySideEffects(request, step) {
  if (step.addressInput) {
    const error = await userErrors(request, ORDER_UPDATE, {input: step.addressInput}, "orderUpdate");
    if (error) return error;
  }
  if (step.metafield) {
    const error = await userErrors(request, METAFIELDS_SET, {metafields: [step.metafield]}, "metafieldsSet");
    if (error) return error;
  }
  return null;
}

export async function executeSale(request, order, settings, plan, reload) {
  const load = reload || (() => loadSaleOrder(request, order.id));
  try {
    let step = planSale(order, settings, plan);
    if (step.phase === "skip" || step.phase === "review") return step;
    const prelude = await applySideEffects(request, step);
    if (prelude) return emptyStep("review", "network");
    if (step.phase === "move") {
      for (const move of step.moves) {
        const error = await userErrors(request, MOVE, move, "fulfillmentOrderMove");
        if (error) return {...emptyStep("review", "warehouse_short"), message: error};
      }
      const next = await load();
      step = planSale(next, settings, plan);
      if (step.phase === "move") return emptyStep("review", "move_incomplete");
      if (step.phase !== "fulfill") return step;
      const again = await applySideEffects(request, step);
      if (again) return emptyStep("review", "network");
    }
    for (const fulfillment of step.fulfills) {
      const error = await userErrors(request, FULFILL, {
        fulfillment: {
          notifyCustomer: false,
          lineItemsByFulfillmentOrder: [{
            fulfillmentOrderId: fulfillment.fulfillmentOrderId,
            fulfillmentOrderLineItems: fulfillment.fulfillmentOrderLineItems,
          }],
        },
      }, "fulfillmentCreate");
      if (error) return {...emptyStep("review", "network"), message: error};
    }
    return {...step, phase: "done", message: step.storeQuantity ? "持ち帰り分を引き渡しました。" : "店頭の引渡数量は0です。"};
  } catch {
    return emptyStep("review", "network");
  }
}

export async function savePlan(request, shopId, plan) {
  const key = planKey(plan?.id);
  if (!key || !shopId) throw new Error("配送受付を保存できません。");
  const error = await userErrors(request, METAFIELDS_SET, {
    metafields: [{
      ownerId: shopId,
      namespace: CONFIG_NAMESPACE,
      key,
      type: "json",
      value: JSON.stringify(plan),
    }],
  }, "metafieldsSet");
  if (error) throw new Error(error);
}

export async function markReview(request, orderId, message) {
  await request(TAG, {id: orderId, tags: [REVIEW_TAG]});
  await request(METAFIELDS_SET, {
    metafields: [{
      ownerId: orderId,
      namespace: CONFIG_NAMESPACE,
      key: REVIEW_KEY,
      type: "single_line_text_field",
      value: String(message || messageFor("network")).slice(0, 200),
    }],
  });
}

export async function reprocessSale(request, orderId) {
  const order = await loadSaleOrder(request, orderId);
  const {config} = await loadConfig(request);
  const settings = settingsFor(config, order.salesLocationId, order.createdAt);
  const reception = (order.customAttributes || []).find((item) => item.key === RECEPTION_ATTRIBUTE)?.value;
  const plan = reception ? await loadPlan(request, reception) : null;
  const result = await executeSale(request, order, settings, plan);
  try {
    if (result.phase === "done" || result.phase === "skip") await clearReview(request, order.id);
    else await markReview(request, order.id, result.message);
  } catch {
    // タグの更新に失敗しても、履行結果は呼び出し元へ返す。
  }
  return result;
}

export async function clearReview(request, orderId) {
  await request(UNTAG, {id: orderId, tags: [REVIEW_TAG]});
}

const CONFIG_QUERY = `query PosOperationsConfig {
  shop { id metafield(namespace: "${CONFIG_NAMESPACE}", key: "${CONFIG_KEY}") { value } }
}`;
const PLAN_QUERY = `query PosDeliveryPlan($key: String!) {
  shop { metafield(namespace: "${CONFIG_NAMESPACE}", key: $key) { value } }
}`;
const ORDER_QUERY = `query PosSaleOrder($id: ID!, $lineItemsAfter: String, $fulfillmentOrdersAfter: String) {
  order(id: $id) {
    id name sourceName createdAt cancelledAt displayFinancialStatus returnStatus tags
    retailLocation { id }
    customAttributes { key value }
    refunds { id }
    shippingAddress { address1 address2 city zip provinceCode countryCode phone firstName lastName }
    lineItems(first: 100, after: $lineItemsAfter) {
      pageInfo { hasNextPage endCursor }
      nodes { id sku title quantity currentQuantity originalUnitPriceSet { shopMoney { amount } } variant { id } }
    }
    fulfillments {
      status
      location { id }
      fulfillmentLineItems(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { quantity lineItem { variant { id } } }
      }
    }
    fulfillmentOrders(first: 30, after: $fulfillmentOrdersAfter) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id status requestStatus
        deliveryMethod { methodType }
        assignedLocation { location { id } }
        lineItems(first: 100) {
          pageInfo { hasNextPage endCursor }
          nodes { id remainingQuantity sku lineItem { title variant { id } } }
        }
      }
    }
  }
}`;
const FO_LINES = `query PosFulfillmentLines($id: ID!, $after: String) {
  fulfillmentOrder(id: $id) {
    lineItems(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id remainingQuantity sku lineItem { title variant { id } } }
    }
  }
}`;

async function collect(fetchPage) {
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

function snapshotLine(line) {
  return {
    id: line.id,
    variantKey: numericId(line.variant?.id),
    sku: line.sku || "",
    title: line.title || "",
    quantity: Number(line.currentQuantity ?? line.quantity ?? 0),
    unitPrice: Number(line.originalUnitPriceSet?.shopMoney?.amount || 0),
  };
}

function snapshotFulfillmentLine(line) {
  return {
    id: line.id,
    variantKey: numericId(line.lineItem?.variant?.id),
    sku: line.sku || "",
    title: line.lineItem?.title || "",
    remaining: Number(line.remainingQuantity || 0),
  };
}

export async function loadConfig(request) {
  const data = await request(CONFIG_QUERY, {});
  let config = {locations: []};
  try {
    config = JSON.parse(data.shop?.metafield?.value || "{}");
  } catch {
    config = {locations: []};
  }
  if (!Array.isArray(config.locations)) config.locations = [];
  return {shopId: data.shop?.id, config};
}

export async function loadPlan(request, id) {
  const key = planKey(id);
  if (!key) return null;
  const data = await request(PLAN_QUERY, {key});
  if (!data.shop?.metafield?.value) return null;
  try {
    return JSON.parse(data.shop.metafield.value);
  } catch {
    return null;
  }
}

export async function loadSaleOrder(request, id) {
  const first = await request(ORDER_QUERY, {id, lineItemsAfter: null, fulfillmentOrdersAfter: null});
  const order = first.order;
  if (!order) throw new Error(messageFor("pagination"));
  const lineNodes = await collect(async (after) => {
    if (!after) return order.lineItems;
    const page = await request(ORDER_QUERY, {id, lineItemsAfter: after, fulfillmentOrdersAfter: null});
    return page.order.lineItems;
  });
  const fulfillmentNodes = await collect(async (after) => {
    if (!after) return order.fulfillmentOrders;
    const page = await request(ORDER_QUERY, {id, lineItemsAfter: null, fulfillmentOrdersAfter: after});
    return page.order.fulfillmentOrders;
  });
  const fulfillmentOrders = [];
  for (const fulfillment of fulfillmentNodes) {
    const lines = await collect(async (after) => {
      if (!after) return fulfillment.lineItems;
      const page = await request(FO_LINES, {id: fulfillment.id, after});
      return page.fulfillmentOrder.lineItems;
    });
    fulfillmentOrders.push({
      id: fulfillment.id,
      status: fulfillment.status,
      requestStatus: fulfillment.requestStatus,
      method: fulfillment.deliveryMethod?.methodType || "",
      locationId: fulfillment.assignedLocation?.location?.id || "",
      lines: lines.map(snapshotFulfillmentLine),
    });
  }
  return {
    id: order.id,
    name: order.name,
    sourceName: order.sourceName,
    createdAt: order.createdAt,
    cancelledAt: order.cancelledAt,
    displayFinancialStatus: order.displayFinancialStatus,
    returnStatus: order.returnStatus,
    salesLocationId: order.retailLocation?.id || null,
    tags: order.tags || [],
    customAttributes: order.customAttributes || [],
    refundCount: order.refunds?.length || 0,
    shippingAddress: order.shippingAddress,
    lines: lineNodes.map(snapshotLine),
    fulfillmentOrders,
    shipments: snapshotShipments(order),
  };
}

function snapshotShipments(order) {
  const shipments = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  return shipments.filter((shipment) => shipment.status === "SUCCESS").map((shipment) => {
    if (shipment.fulfillmentLineItems?.pageInfo?.hasNextPage) throw new Error(messageFor("pagination"));
    return {
      locationId: shipment.location?.id || "",
      status: shipment.status,
      lines: (shipment.fulfillmentLineItems?.nodes || []).map((line) => ({
        variantKey: numericId(line.lineItem?.variant?.id),
        quantity: Number(line.quantity || 0),
      })),
    };
  });
}

const REVIEW_ORDERS = `query PosReviewOrders($query: String!, $after: String) {
  orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      name
      retailLocation { id }
      metafield(namespace: "${CONFIG_NAMESPACE}", key: "${REVIEW_KEY}") { value }
    }
  }
}`;

export async function listReviewOrders(request, locationId) {
  const rows = [];
  const seen = new Set();
  let after = null;
  for (;;) {
    const data = await request(REVIEW_ORDERS, {query: "tag:location-stock-review", after});
    const connection = data.orders;
    for (const node of connection?.nodes || []) {
      if (sameId(node.retailLocation?.id, locationId)) rows.push(node);
    }
    if (!connection?.pageInfo?.hasNextPage) return {rows, complete: true};
    after = connection.pageInfo.endCursor;
    if (!after || seen.has(after)) throw new Error(messageFor("pagination"));
    seen.add(after);
  }
}

export const CIARA_BACKEND = "https://location-stock-indicator-ciara.onrender.com";

export function backendUrl(config) {
  const value = String(config?.backendUrl || "").trim().replace(/\/$/, "");
  if (/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(value)) return value;
  return CIARA_BACKEND;
}

export const ORDER_LOCK_STALE_MS = 120000;

export function claimDecision(existing) {
  if (!existing) return "start";
  if (["done", "skipped", "review"].includes(existing.state)) return "stop";
  return "continue";
}

function lockId(shop, orderId) {
  return `${shop}:${orderId}`;
}

function lockTime(value) {
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function acquireOrderLock(locks, input) {
  const spec = {...input, staleMs: input.staleMs ?? ORDER_LOCK_STALE_MS};
  if (typeof locks.acquire === "function") return locks.acquire(spec);
  const id = lockId(spec.shop, spec.orderId);
  const existing = await locks.get(id);
  if (!existing) {
    try {
      await locks.create({id, shop: spec.shop, orderId: spec.orderId, owner: spec.owner});
      return true;
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      return false;
    }
  }
  if (spec.now - lockTime(existing.updatedAt) < spec.staleMs) return false;
  const taken = await locks.takeover(id, spec.owner, new Date(spec.now - spec.staleMs));
  return taken === 1;
}

export async function coordinatePaidOrder({repo, locks, shop, webhookId, orderId, owner, now, staleMs, distribution, work}) {
  const existing = await repo.get(webhookId);
  if (claimDecision(existing) === "stop") return {state: existing.state};
  const locked = await acquireOrderLock(locks, {shop, orderId, owner, now, staleMs});
  if (!locked) return {busy: true};
  try {
    const current = await repo.get(webhookId);
    if (claimDecision(current) === "stop") return {state: current.state};
    if (!current) {
      try {
        await repo.start({id: webhookId, shop, orderId, state: "processing"});
      } catch (error) {
        if (error?.code !== "P2002") throw error;
      }
    }
    if (distribution !== "inhouse") {
      await repo.finish(webhookId, {state: "skipped", reason: "public", orderId});
      return {state: "skipped"};
    }
    const result = await work();
    const state = claimState(result.phase);
    await repo.finish(webhookId, {state, reason: result.reason || null, orderId});
    return {state, result};
  } finally {
    await locks.release(lockId(shop, orderId), owner);
  }
}

export async function coordinateRetry({locks, shop, orderId, owner, now, staleMs, work}) {
  const locked = await acquireOrderLock(locks, {shop, orderId, owner, now, staleMs});
  if (!locked) return {busy: true};
  try {
    return {result: await work()};
  } finally {
    await locks.release(lockId(shop, orderId), owner);
  }
}

export function claimState(phase) {
  if (phase === "review") return "review";
  if (phase === "skip") return "skipped";
  return "done";
}

export function pickupAction(order) {
  if (!order?.locationOk || order.method !== "PICK_UP") {
    return {error: "受取注文が変更されました。一覧を更新してください。"};
  }
  if (["CANCELLED", "CLOSED"].includes(order.status)) {
    return {error: "受取注文が変更されました。一覧を更新してください。"};
  }
  if (order.status === "ON_HOLD") return {error: "保留中の注文は操作できません。"};
  if (order.status === "SCHEDULED" || BLOCKED_REQUESTS.has(order.requestStatus)) {
    return {error: "転送待ちの注文は操作できません。"};
  }
  const lineItems = (order.lines || [])
    .filter((line) => line.remaining > 0)
    .map((line) => ({id: line.id, quantity: line.remaining}));
  if (order.intent === "prepare") {
    if (order.status === "IN_PROGRESS" || order.displayFulfillmentStatus === "READY_FOR_PICKUP") {
      return {already: "prepared"};
    }
    if (order.status !== "OPEN") return {error: "受取注文が変更されました。一覧を更新してください。"};
    if (!lineItems.length) return {error: "残りの商品はありません。"};
    return {mutate: "prepare", lineItems};
  }
  if (!lineItems.length) return {already: "fulfilled"};
  if (order.supportedActions && !order.supportedActions.includes("CREATE_FULFILLMENT")) {
    return {error: "引渡できる状態ではありません。一覧を更新してください。"};
  }
  return {mutate: "fulfill", notifyCustomer: true, lineItems};
}

export const pickupMail = {
  prepare: "fulfillmentOrderLineItemsPreparedForPickup",
  complete: {mutation: "fulfillmentCreate", notifyCustomer: true},
  observed: null,
};
