// POS Lite（店頭受取・持ち帰りと配送）の試験。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CIARA_API_KEY,
  DELIVERY_ATTRIBUTE,
  REVIEW_TAG,
  SHIP_QTY_PROPERTY,
  accessFromInstallation,
  buildDeliveryCart,
  cartShipCount,
  deliveryUsable,
  feeSync,
  parseConfig,
  parseDelivery,
  pickupAction,
  pickupLabel,
  planSale,
  prefectureCode,
  validateConfig,
} from "../../extensions/pos-lite/src/logic.js";
import { processSale, withOrderLock } from "./posLiteSale.js";

const STORE = "gid://shopify/Location/101";
const WAREHOUSE = "gid://shopify/Location/202";
const ADDRESS = { lastName: "山田", firstName: "花子", zip: "153-0042", province: "東京都", city: "目黒区", address1: "青葉台1-1-1", address2: "", phone: "0300000000" };
const ON = parseConfig({
  pickupEnabled: true,
  deliveryEnabled: true,
  locations: [{ locationId: "101", enabled: true, warehouseLocationId: "202", shippingFee: 800, shippingTitle: "送料" }],
});

function deliveryAttr() {
  const built = buildDeliveryCart({ lines: [{ uuid: "a", variantId: 9, quantity: 3 }], shipQuantities: { a: 2 }, address: ADDRESS }, ON.locations[0]);
  return built.cartProperties[DELIVERY_ATTRIBUTE];
}

/** 3 点買って 2 点配送・1 点持ち帰り（T の切替条件）。POS の「フルフィルメント済みにする」はオフ。 */
function order3(overrides = {}) {
  return {
    id: "gid://shopify/Order/1",
    name: "#1001",
    sourceName: "pos",
    displayFinancialStatus: "PAID",
    cancelledAt: null,
    refundCount: 0,
    returnStatus: "NO_RETURN",
    tags: [],
    salesLocationId: STORE,
    customAttributes: [{ key: DELIVERY_ATTRIBUTE, value: deliveryAttr() }],
    shippingAddress: null,
    lines: [
      { id: "gid://shopify/LineItem/11", sku: "SKU-1", title: "シャツ", quantity: 3, unitPrice: 5000, variantId: "gid://shopify/ProductVariant/9", customAttributes: [{ key: SHIP_QTY_PROPERTY, value: "2" }] },
      { id: "gid://shopify/LineItem/12", sku: "", title: "送料", quantity: 1, unitPrice: 800, variantId: null, customAttributes: [] },
    ],
    fulfillmentOrders: [
      { id: "gid://shopify/FulfillmentOrder/71", status: "OPEN", method: "RETAIL", locationId: STORE, lines: [{ id: "gid://shopify/FulfillmentOrderLineItem/81", lineItemId: "gid://shopify/LineItem/11", remaining: 3 }] },
    ],
    fulfillments: [],
    ...overrides,
  };
}

test("設定は何も保存していなければ、書き込みのスイッチがすべてオフ", () => {
  for (const raw of [null, "", "{壊れた", { pickupEnabled: "true" }]) {
    const config = parseConfig(raw);
    assert.equal(config.pickupEnabled, false);
    assert.equal(config.deliveryEnabled, false);
    assert.equal(config.pickupNotifyOnHandover, false);
  }
});

test("設定の誤りは店舗の名前つきで返し、1 つでもあれば保存しない形", () => {
  const known = [{ id: "gid://shopify/Location/101", name: "渋谷店" }, { id: "202", name: "倉庫" }];
  const bad = validateConfig({ deliveryEnabled: true, locations: [{ locationId: "101", enabled: true, warehouseLocationId: "101", shippingFee: "-1" }] }, known);
  assert.ok(bad.errors.some((e) => e.includes("渋谷店") && e.includes("別のロケーション")));
  assert.ok(bad.errors.some((e) => e.includes("送料")));
  const none = validateConfig({ locations: [{ locationId: "101", enabled: true, warehouseLocationId: "" }] }, known);
  assert.ok(none.errors.some((e) => e.includes("出荷元を選んで")));
  const ok = validateConfig({ deliveryEnabled: true, locations: [{ locationId: "101", enabled: true, warehouseLocationId: "202", shippingFee: "800" }] }, known);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.config.locations[0].shippingFee, 800);
  assert.equal(deliveryUsable(ok.config, "gid://shopify/Location/101"), true);
  assert.equal(deliveryUsable({ ...ok.config, deliveryEnabled: false }, "101"), false);
});

test("プラン: 公開版は Pro だけ、自社用と開発ストアは使える（planGate と同じ）", () => {
  assert.equal(accessFromInstallation({ apiKey: CIARA_API_KEY, subscriptions: [] }).allowed, true);
  assert.equal(accessFromInstallation({ apiKey: "x", partnerDevelopment: true, subscriptions: [] }).allowed, true);
  assert.equal(accessFromInstallation({ apiKey: "x", subscriptions: [{ name: "Pro", status: "ACTIVE" }] }).allowed, true);
  assert.equal(accessFromInstallation({ apiKey: "x", subscriptions: [{ name: "Lite", status: "ACTIVE" }] }).allowed, false);
  assert.equal(accessFromInstallation({ apiKey: "x", subscriptions: [] }).allowed, false);
});

test("都道府県は名前・県なし・コードのどれでも JP-xx にする", () => {
  assert.equal(prefectureCode("東京都"), "JP-13");
  assert.equal(prefectureCode("北海道"), "JP-01");
  assert.equal(prefectureCode("大阪"), "JP-27");
  assert.equal(prefectureCode("JP-47"), "JP-47");
  assert.equal(prefectureCode("JP-48"), "");
  assert.equal(prefectureCode("ニューヨーク"), "");
});

test("配送の確定: 明細の配送数量・配送先・出荷元・送料をカートに書く形を作る", () => {
  const built = buildDeliveryCart(
    { lines: [{ uuid: "a", variantId: 9, quantity: 3 }, { uuid: "b", variantId: 10, quantity: 1 }, { uuid: "fee", variantId: null, quantity: 1 }], shipQuantities: { a: 2 }, address: ADDRESS },
    ON.locations[0],
  );
  assert.deepEqual(built.lineProperties, [{ uuid: "a", quantity: 2 }]);
  assert.deepEqual(built.clearLines, ["b"]);
  assert.equal(built.shipCount, 2);
  assert.equal(built.fee, 800);
  const delivery = parseDelivery(built.cartProperties[DELIVERY_ATTRIBUTE]);
  assert.equal(delivery.from, "202");
  assert.equal(delivery.to.provinceCode, "JP-13");
  assert.match(buildDeliveryCart({ lines: [{ uuid: "a", variantId: 9, quantity: 1 }], shipQuantities: { a: 2 }, address: ADDRESS }, ON.locations[0]).error, /多い/);
  assert.match(buildDeliveryCart({ lines: [{ uuid: "a", variantId: 9, quantity: 1 }], shipQuantities: {}, address: ADDRESS }, ON.locations[0]).error, /1 つ以上/);
  assert.match(buildDeliveryCart({ lines: [{ uuid: "a", variantId: 9, quantity: 1 }], shipQuantities: { a: 1 }, address: { ...ADDRESS, phone: "" } }, ON.locations[0]).error, /電話番号/);
});

test("送料の行はカートに 1 つだけ。配送 0 なら消す", () => {
  const lines = [{ uuid: "f1", variantId: null, title: "送料", price: 800, quantity: 1 }, { uuid: "f2", variantId: null, title: "送料", price: 500, quantity: 1 }];
  assert.deepEqual(feeSync(lines, "送料", 800), { remove: ["f2"], add: null });
  assert.deepEqual(feeSync([], "送料", 800).add, { title: "送料", price: "800.00", quantity: 1, taxable: false });
  assert.deepEqual(feeSync(lines, "送料", 0), { remove: ["f1", "f2"], add: null });
});

test("タイルの点数はカートの数量までにする", () => {
  const cart = { properties: { [DELIVERY_ATTRIBUTE]: "x" }, lineItems: [{ quantity: 1, properties: { [SHIP_QTY_PROPERTY]: "2" } }] };
  assert.equal(cartShipCount(cart), 1);
  assert.equal(cartShipCount({ properties: {}, lineItems: cart.lineItems }), 0);
});

test("会計のあと: まず配送 2 点を出荷元へ移す（持ち帰り 1 点は残す）", () => {
  const step = planSale(order3(), ON);
  assert.equal(step.phase, "move");
  assert.deepEqual(step.moves, [{ id: "gid://shopify/FulfillmentOrder/71", newLocationId: WAREHOUSE, fulfillmentOrderLineItems: [{ id: "gid://shopify/FulfillmentOrderLineItem/81", quantity: 2 }] }]);
  assert.equal(step.handoff.lines[0].quantity, 2);
  assert.equal(step.handoff.shippingFeeCharged, 800);
  assert.equal(step.addressInput.shippingAddress.provinceCode, "JP-13");
});

test("移したあと: 販売店舗に残った持ち帰り 1 点だけを履行する", () => {
  const moved = order3({
    fulfillmentOrders: [
      { id: "fo-store", status: "OPEN", method: "RETAIL", locationId: STORE, lines: [{ id: "l-store", lineItemId: "gid://shopify/LineItem/11", remaining: 1 }] },
      { id: "fo-wh", status: "OPEN", method: "RETAIL", locationId: WAREHOUSE, lines: [{ id: "l-wh", lineItemId: "gid://shopify/LineItem/11", remaining: 2 }] },
    ],
  });
  const step = planSale(moved, ON);
  assert.equal(step.phase, "fulfill");
  assert.deepEqual(step.fulfills, [{ fulfillmentOrderId: "fo-store", fulfillmentOrderLineItems: [{ id: "l-store", quantity: 1 }] }]);
  assert.equal(step.storeQuantity, 1);
});

test("済んだあとに何度呼んでも、何もしない（配送分は未発送のまま）", () => {
  const done = order3({
    fulfillmentOrders: [
      { id: "fo-store", status: "CLOSED", method: "RETAIL", locationId: STORE, lines: [{ id: "l-store", lineItemId: "gid://shopify/LineItem/11", remaining: 0 }] },
      { id: "fo-wh", status: "OPEN", method: "RETAIL", locationId: WAREHOUSE, lines: [{ id: "l-wh", lineItemId: "gid://shopify/LineItem/11", remaining: 2 }] },
    ],
    fulfillments: [{ locationId: STORE, lines: [{ lineItemId: "gid://shopify/LineItem/11", quantity: 1 }] }],
  });
  const step = planSale(done, ON);
  assert.equal(step.phase, "done");
  assert.deepEqual(step.moves, []);
  assert.deepEqual(step.fulfills, []);
});

test("店頭で全部引渡済みにされていたら、要確認（配送分を勝手に戻さない）", () => {
  const all = order3({
    fulfillmentOrders: [{ id: "fo", status: "CLOSED", method: "RETAIL", locationId: STORE, lines: [{ id: "l", lineItemId: "gid://shopify/LineItem/11", remaining: 0 }] }],
    fulfillments: [{ locationId: STORE, lines: [{ lineItemId: "gid://shopify/LineItem/11", quantity: 3 }] }],
  });
  const step = planSale(all, ON);
  assert.equal(step.phase, "review");
  assert.equal(step.reason, "already_fulfilled");
});

test("スイッチがオフ・配送の指定なし・POS でない注文は何もしない", () => {
  assert.equal(planSale(order3(), parseConfig(null)).reason, "switch_off");
  assert.equal(planSale(order3({ customAttributes: [] }), ON).reason, "no_delivery");
  assert.equal(planSale(order3({ sourceName: "web" }), ON).phase, "skip");
});

test("止める条件は要確認にする（店舗の設定オフ・返金・受取の混在・出荷元が販売店舗）", () => {
  const off = parseConfig({ deliveryEnabled: true, locations: [{ locationId: "101", enabled: false, warehouseLocationId: "202" }] });
  assert.equal(planSale(order3(), off).reason, "location_off");
  assert.equal(planSale(order3({ refundCount: 1 }), ON).reason, "refund");
  const pickup = order3();
  pickup.fulfillmentOrders[0].method = "PICK_UP";
  assert.equal(planSale(pickup, ON).reason, "pickup_mixed");
  const same = order3({ salesLocationId: WAREHOUSE });
  const sameConfig = parseConfig({ deliveryEnabled: true, locations: [{ locationId: "202", enabled: true, warehouseLocationId: "101" }] });
  assert.equal(planSale(same, sameConfig).reason, "same_location");
});

test("会計の前に数量が減っていたら、配送は今の数量までにする", () => {
  const fewer = order3();
  fewer.lines[0].quantity = 1;
  fewer.fulfillmentOrders[0].lines[0].remaining = 1;
  const step = planSale(fewer, ON);
  assert.equal(step.phase, "move");
  assert.equal(step.moves[0].fulfillmentOrderLineItems[0].quantity, 1);
});

/** Shopify の代わり。出荷指示の移動と履行を本当に状態に反映する。 */
function fakeShopify(order) {
  const state = structuredClone(order);
  const calls = [];
  const request = async (query, variables) => {
    const name = query.match(/(query|mutation)\s+(\w+)/)[2];
    calls.push(name);
    if (name === "PosLiteConfig") return { shop: { id: "gid://shopify/Shop/1", metafield: { value: JSON.stringify(ON) } } };
    if (name === "PosLiteOrder") {
      return {
        order: {
          ...state,
          retailLocation: { id: state.salesLocationId },
          refunds: Array.from({ length: state.refundCount }, () => ({ id: "r" })),
          lineItems: { pageInfo: { hasNextPage: false }, nodes: state.lines.map((l) => ({ id: l.id, sku: l.sku, title: l.title, currentQuantity: l.quantity, customAttributes: l.customAttributes, originalUnitPriceSet: { shopMoney: { amount: String(l.unitPrice) } }, variant: l.variantId ? { id: l.variantId } : null })) },
          fulfillments: state.fulfillments.map((f) => ({ status: "SUCCESS", location: { id: f.locationId }, fulfillmentLineItems: { pageInfo: { hasNextPage: false }, nodes: f.lines.map((x) => ({ quantity: x.quantity, lineItem: { id: x.lineItemId } })) } })),
        },
      };
    }
    if (name === "PosLiteFulfillmentOrders") {
      return { order: { fulfillmentOrders: { pageInfo: { hasNextPage: false }, nodes: state.fulfillmentOrders.map((fo) => ({ id: fo.id, status: fo.status, requestStatus: "UNSUBMITTED", deliveryMethod: { methodType: fo.method }, assignedLocation: { location: { id: fo.locationId } }, lineItems: { pageInfo: { hasNextPage: false }, nodes: fo.lines.map((l) => ({ id: l.id, remainingQuantity: l.remaining, lineItem: { id: l.lineItemId } })) } })) } } };
    }
    if (name === "PosLiteMove") {
      const fo = state.fulfillmentOrders.find((x) => x.id === variables.id);
      const lines = [];
      for (const item of variables.fulfillmentOrderLineItems) {
        const line = fo.lines.find((l) => l.id === item.id);
        line.remaining -= item.quantity;
        lines.push({ id: `${line.id}-moved`, lineItemId: line.lineItemId, remaining: item.quantity });
      }
      state.fulfillmentOrders.push({ id: `${fo.id}-moved`, status: "OPEN", method: fo.method, locationId: variables.newLocationId, lines });
      return { fulfillmentOrderMove: { movedFulfillmentOrder: { id: `${fo.id}-moved` }, userErrors: [] } };
    }
    if (name === "PosLiteFulfill") {
      for (const group of variables.fulfillment.lineItemsByFulfillmentOrder) {
        const fo = state.fulfillmentOrders.find((x) => x.id === group.fulfillmentOrderId);
        const done = [];
        for (const item of group.fulfillmentOrderLineItems) {
          const line = fo.lines.find((l) => l.id === item.id);
          if (item.quantity > line.remaining) return { fulfillmentCreate: { fulfillment: null, userErrors: [{ message: "数量が多い" }] } };
          line.remaining -= item.quantity;
          done.push({ lineItemId: line.lineItemId, quantity: item.quantity });
        }
        if (fo.lines.every((l) => l.remaining === 0)) fo.status = "CLOSED";
        state.fulfillments.push({ locationId: fo.locationId, lines: done });
      }
      assert.equal(variables.fulfillment.notifyCustomer, false);
      return { fulfillmentCreate: { fulfillment: { id: "f", status: "SUCCESS" }, userErrors: [] } };
    }
    if (name === "PosLiteShippingAddress") {
      state.shippingAddress = variables.input.shippingAddress;
      return { orderUpdate: { order: { id: state.id }, userErrors: [] } };
    }
    if (name === "PosLiteMetafields") return { metafieldsSet: { metafields: [], userErrors: [] } };
    if (name === "PosLiteTag") {
      state.tags.push(REVIEW_TAG);
      return { tagsAdd: { userErrors: [] } };
    }
    if (name === "PosLiteUntag") {
      state.tags = state.tags.filter((t) => t !== REVIEW_TAG);
      return { tagsRemove: { userErrors: [] } };
    }
    throw new Error(`知らない呼び出し ${name}`);
  };
  return { request, state, calls };
}

test("processSale: 3 点のうち 1 点を履行、2 点は出荷元に未発送。2 回目は何も書かない", async () => {
  const shop = fakeShopify(order3());
  const first = await processSale(shop.request, "gid://shopify/Order/1");
  assert.equal(first.phase, "done");
  const store = shop.state.fulfillments.filter((f) => f.locationId === STORE).flatMap((f) => f.lines);
  assert.deepEqual(store, [{ lineItemId: "gid://shopify/LineItem/11", quantity: 1 }]);
  const warehouse = shop.state.fulfillmentOrders.filter((fo) => fo.locationId === WAREHOUSE && fo.status === "OPEN");
  assert.equal(warehouse.reduce((sum, fo) => sum + fo.lines.reduce((s, l) => s + l.remaining, 0), 0), 2);
  assert.equal(shop.state.shippingAddress.city, "目黒区");

  shop.calls.length = 0;
  const second = await processSale(shop.request, "gid://shopify/Order/1");
  assert.equal(second.phase, "done");
  assert.ok(!shop.calls.includes("PosLiteMove") && !shop.calls.includes("PosLiteFulfill"), "2 回目に移動・履行をしない");
});

test("processSale: 後日 1 点を返品した注文はもう動かさない（返金があれば要確認で止める）", async () => {
  const shop = fakeShopify(order3());
  await processSale(shop.request, "gid://shopify/Order/1");
  shop.state.refundCount = 1;
  shop.calls.length = 0;
  const again = await processSale(shop.request, "gid://shopify/Order/1");
  assert.equal(again.phase, "review");
  assert.equal(again.reason, "refund");
  assert.ok(!shop.calls.includes("PosLiteMove") && !shop.calls.includes("PosLiteFulfill"));
});

test("processSale: 移せないときは要確認のタグと理由を残し、直して再処理すると外れる", async () => {
  const shop = fakeShopify(order3());
  const original = shop.request;
  let fail = true;
  const request = async (query, variables) => {
    if (fail && /mutation PosLiteMove/.test(query)) return { fulfillmentOrderMove: { movedFulfillmentOrder: null, userErrors: [{ message: "在庫の登録がありません" }] } };
    return original(query, variables);
  };
  const first = await processSale(request, "gid://shopify/Order/1");
  assert.equal(first.phase, "review");
  assert.match(first.message, /在庫の登録がありません/);
  assert.ok(shop.state.tags.includes(REVIEW_TAG));
  fail = false;
  const retry = await processSale(request, "gid://shopify/Order/1");
  assert.equal(retry.phase, "done");
  assert.ok(!shop.state.tags.includes(REVIEW_TAG));
});

test("同じ注文の処理は順番に 1 つずつ", async () => {
  const order = [];
  const slow = (label, ms) => () => new Promise((resolve) => setTimeout(() => { order.push(label); resolve(label); }, ms));
  await Promise.all([withOrderLock("o", slow("a", 20)), withOrderLock("o", slow("b", 1))]);
  assert.deepEqual(order, ["a", "b"]);
});

test("店頭受取: 準備完了 → 引渡し完了。もう済んでいたら送り直さない", () => {
  const base = { locationOk: true, method: "PICK_UP", status: "OPEN", lines: [{ id: "x", remaining: 2 }] };
  assert.deepEqual(pickupAction({ ...base, intent: "prepare" }), { mutate: "prepare" });
  assert.deepEqual(pickupAction({ ...base, ready: true, intent: "prepare" }), { already: "prepared" });
  const handover = pickupAction({ ...base, status: "IN_PROGRESS", ready: true, intent: "complete", supportedActions: ["CREATE_FULFILLMENT"] });
  assert.deepEqual(handover, { mutate: "complete", lineItems: [{ id: "x", quantity: 2 }], notifyCustomer: false });
  assert.equal(pickupAction({ ...base, intent: "complete" }, { notifyOnHandover: true }).notifyCustomer, true);
  assert.deepEqual(pickupAction({ ...base, status: "CLOSED", intent: "complete" }), { already: "fulfilled" });
  assert.match(pickupAction({ ...base, locationOk: false, intent: "prepare" }).error, /一覧を更新/);
  assert.match(pickupAction({ ...base, status: "ON_HOLD", intent: "prepare" }).error, /保留/);
  assert.match(pickupAction({ ...base, method: "SHIPPING", intent: "prepare" }).error, /一覧を更新/);
  assert.equal(pickupLabel({ status: "OPEN" }), "準備待ち");
  assert.equal(pickupLabel({ status: "IN_PROGRESS", ready: true }), "引渡し待ち");
});

test("準備完了の入力は出荷指示の ID だけ（Shopify の例と同じ形）", () => {
  const modal = readFileSync("extensions/pos-lite/src/modal.js", "utf8");
  assert.match(modal, /lineItemsByFulfillmentOrder: \[\{ fulfillmentOrderId: id \}\]/);
});

test("toml: 2 つのアプリに同じ権限と orders/paid を足している", () => {
  for (const file of ["shopify.app.toml", "shopify.app.public.toml"]) {
    const toml = readFileSync(file, "utf8");
    for (const scope of ["read_orders", "write_orders", "read_merchant_managed_fulfillment_orders", "write_merchant_managed_fulfillment_orders"]) {
      assert.match(toml, new RegExp(`scopes = "[^"]*\\b${scope}\\b`), `${file} に ${scope} がない`);
    }
    assert.match(toml, /topics = \[ "orders\/paid" \]/);
  }
});
