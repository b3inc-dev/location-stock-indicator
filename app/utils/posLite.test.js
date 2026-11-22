// POS Lite（店頭受取・持ち帰りと配送）の試験。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CIARA_API_KEY,
  DELIVERY_ATTRIBUTE,
  FEE_PROPERTY,
  REVIEW_TAG,
  SHIP_QTY_PROPERTY,
  accessFromInstallation,
  buildDeliveryCart,
  cartShipCount,
  deliveryUsable,
  feeProperties,
  feeSync,
  isFeeLine,
  parseConfig,
  parseDelivery,
  pickupAction,
  pickupLabel,
  planSale,
  prefectureCode,
  shipFromChoices,
  validateConfig,
} from "../../extensions/pos-lite/src/logic.js";
import { precheckPaid, processPaidInBackground, processSale, redactPosLiteOrders, withOrderLock } from "./posLiteSale.js";

const STORE = "gid://shopify/Location/101";
const WAREHOUSE = "gid://shopify/Location/202";
const ADDRESS = { lastName: "山田", firstName: "花子", zip: "153-0042", province: "東京都", city: "目黒区", address1: "青葉台1-1-1", address2: "", phone: "0300000000" };
const ON = parseConfig({
  pickupEnabled: true,
  deliveryEnabled: true,
  locations: [{ locationId: "101", enabled: true, warehouseLocationId: "202", shippingFee: 800, shippingTitle: "送料" }],
});

function deliveryAttr() {
  const built = buildDeliveryCart({ lines: [{ uuid: "a", variantId: 9, quantity: 3 }], shipQuantities: { a: 2 }, address: ADDRESS, from: "202" }, ON.locations[0]);
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
      { id: "gid://shopify/LineItem/12", sku: "", title: "送料", quantity: 1, unitPrice: 800, variantId: null, customAttributes: [{ key: "_lsi_fee", value: "1" }, { key: "_lsi_fee_sales", value: "1" }, { key: "_lsi_fee_points", value: "0" }] },
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
    assert.equal(config.cancelStoreFulfillment, false, "店頭の履行を取り消すスイッチも既定オフ");
    assert.equal(config.shippingTaxable, true, "送料は既定で税あり");
  }
  assert.equal(parseConfig({ shippingTaxable: false }).shippingTaxable, false);
});

test("設定の誤りは店舗の名前つきで返し、1 つでもあれば保存しない形", () => {
  const known = [{ id: "gid://shopify/Location/101", name: "渋谷店" }, { id: "202", name: "倉庫" }];
  const bad = validateConfig({ deliveryEnabled: true, locations: [{ locationId: "101", enabled: true, warehouseLocationId: "101", shippingFee: "-1" }] }, known);
  assert.ok(bad.errors.some((e) => e.includes("渋谷店") && e.includes("別のロケーション")));
  assert.ok(bad.errors.some((e) => e.includes("送料")));
  // 既定の出荷元は空でよい（出荷元は会計ごとに POS で選ぶ）
  const none = validateConfig({ locations: [{ locationId: "101", enabled: true, warehouseLocationId: "" }] }, known);
  assert.deepEqual(none.errors, []);
  assert.equal(deliveryUsable({ ...none.config, deliveryEnabled: true }, "101"), true);
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
    { lines: [{ uuid: "a", variantId: 9, quantity: 3 }, { uuid: "b", variantId: 10, quantity: 1 }, { uuid: "fee", variantId: null, quantity: 1 }], shipQuantities: { a: 2 }, address: ADDRESS, from: "gid://shopify/Location/303" },
    ON.locations[0],
  );
  assert.deepEqual(built.lineProperties, [{ uuid: "a", quantity: 2 }]);
  assert.deepEqual(built.clearLines, ["b"]);
  assert.equal(built.shipCount, 2);
  assert.equal(built.fee, 800);
  const delivery = parseDelivery(built.cartProperties[DELIVERY_ATTRIBUTE]);
  assert.equal(delivery.from, "303", "POS で選んだ出荷元（既定の 202 ではない）");
  assert.equal(delivery.to.provinceCode, "JP-13");
  // 出荷元は必ず選ぶ。販売する店舗は選べない
  assert.match(buildDeliveryCart({ lines: [{ uuid: "a", variantId: 9, quantity: 1 }], shipQuantities: { a: 1 }, address: ADDRESS }, ON.locations[0]).error, /出荷元を選んで/);
  assert.match(buildDeliveryCart({ lines: [{ uuid: "a", variantId: 9, quantity: 1 }], shipQuantities: { a: 1 }, address: ADDRESS, from: "101" }, ON.locations[0]).error, /別のロケーション/);
  assert.match(buildDeliveryCart({ lines: [{ uuid: "a", variantId: 9, quantity: 1 }], shipQuantities: { a: 2 }, address: ADDRESS, from: "202" }, ON.locations[0]).error, /多い/);
  assert.match(buildDeliveryCart({ lines: [{ uuid: "a", variantId: 9, quantity: 1 }], shipQuantities: {}, address: ADDRESS, from: "202" }, ON.locations[0]).error, /1 つ以上/);
  assert.match(buildDeliveryCart({ lines: [{ uuid: "a", variantId: 9, quantity: 1 }], shipQuantities: { a: 1 }, address: { ...ADDRESS, phone: "" }, from: "202" }, ON.locations[0]).error, /電話番号/);
});

test("送料の行はカートに 1 つだけ。配送 0 なら消す", () => {
  const lines = [{ uuid: "f1", variantId: null, title: "送料", price: 800, quantity: 1 }, { uuid: "f2", variantId: null, title: "送料", price: 500, quantity: 1 }];
  assert.deepEqual(feeSync(lines, "送料", 800), { remove: ["f2"], add: null });
  assert.deepEqual(feeSync([], "送料", 800).add, { title: "送料", price: "800.00", quantity: 1, taxable: true }, "既定は税あり");
  assert.equal(feeSync([], "送料", 800, false).add.taxable, false);
  // 税のあり・なしを変えたら、前の行を消して入れ直す
  const taxed = [{ uuid: "t", variantId: null, title: "送料", price: 800, quantity: 1, taxable: true }];
  assert.deepEqual(feeSync(taxed, "送料", 800, true), { remove: [], add: null });
  assert.deepEqual(feeSync(taxed, "送料", 800, false), { remove: ["t"], add: { title: "送料", price: "800.00", quantity: 1, taxable: false } });
  assert.deepEqual(feeSync(lines, "送料", 0), { remove: ["f1", "f2"], add: null });
});

test("出荷元の候補は販売する店舗を除き、既定の出荷元は候補にあるときだけ先に選ぶ", () => {
  const locations = [{ id: "gid://shopify/Location/101", name: "渋谷店" }, { id: "gid://shopify/Location/202", name: "倉庫" }, { id: "gid://shopify/Location/303", name: "第2倉庫" }];
  const { choices, preset } = shipFromChoices(locations, ON.locations[0]);
  assert.deepEqual(choices.map((c) => c.id), ["202", "303"]);
  assert.equal(preset, "202");
  assert.equal(shipFromChoices(locations, { ...ON.locations[0], warehouseLocationId: "" }).preset, "", "既定が無ければ何も選ばない");
  assert.equal(shipFromChoices(locations.slice(0, 2).filter((l) => !l.id.endsWith("202")), ON.locations[0]).preset, "", "無くなったロケーションは選ばない");
});

test("送料の行: 印で見分け、売上・ポイントの設定を行に写す（POS Receipt・Shop Point が読む）", () => {
  assert.deepEqual(feeProperties(parseConfig(null)), { _lsi_fee: "1", _lsi_fee_sales: "1", _lsi_fee_points: "0" }, "既定: 売上に含める・ポイントの対象にしない");
  assert.deepEqual(feeProperties(parseConfig({ feeCountsAsSales: false, feeEarnsPoints: true })), { _lsi_fee: "1", _lsi_fee_sales: "0", _lsi_fee_points: "1" });
  assert.equal(isFeeLine({ variantId: null, title: "配送料", properties: { [FEE_PROPERTY]: "1" } }, "送料"), true, "名前を変えても印で見分ける");
  assert.equal(isFeeLine({ variantId: 9, title: "送料", properties: { [FEE_PROPERTY]: "1" } }, "送料"), false, "商品の行は送料ではない");
  const step = planSale(order3(), ON);
  assert.deepEqual(step.handoff.feeLineItemIds, ["12"]);
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
  // 配送先は記録に写さない。注文の属性からも同じ 1 回の orderUpdate で外す
  assert.equal("destination" in step.handoff, false);
  const attr = step.addressInput.customAttributes.find((a) => a.key === DELIVERY_ATTRIBUTE);
  assert.equal(JSON.parse(attr.value).to, undefined);
  assert.equal(JSON.parse(attr.value).from, "202");
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

test("持ち帰りの点数に送料の行を数えない", () => {
  const moved = order3({
    fulfillmentOrders: [
      { id: "fo-store", status: "OPEN", method: "RETAIL", locationId: STORE, lines: [
        { id: "l-store", lineItemId: "gid://shopify/LineItem/11", remaining: 1 },
        { id: "l-fee", lineItemId: "gid://shopify/LineItem/12", remaining: 1 },
      ] },
      { id: "fo-wh", status: "OPEN", method: "RETAIL", locationId: WAREHOUSE, lines: [{ id: "l-wh", lineItemId: "gid://shopify/LineItem/11", remaining: 2 }] },
    ],
  });
  const step = planSale(moved, ON);
  assert.equal(step.phase, "fulfill");
  assert.equal(step.storeQuantity, 1);
  assert.equal(step.fulfills[0].fulfillmentOrderLineItems.length, 2, "送料の行も履行はする（数えないだけ）");
});

test("出荷指示がまだ無いときは「待つ」（間違った理由で要確認にしない）", () => {
  const step = planSale(order3({ fulfillmentOrders: [], fulfillments: [] }), ON);
  assert.equal(step.phase, "retry");
  assert.equal(step.reason, "waiting_fulfillment_orders");
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
    fulfillments: [{ id: "gid://shopify/Fulfillment/91", locationId: STORE, lines: [{ lineItemId: "gid://shopify/LineItem/11", quantity: 3 }] }],
  });
  const step = planSale(all, ON);
  assert.equal(step.phase, "review");
  assert.equal(step.reason, "already_fulfilled");
  // 代わりの道のスイッチをオンにしたときだけ、販売店舗の履行を取り消す
  const cancel = planSale(all, { ...ON, cancelStoreFulfillment: true });
  assert.equal(cancel.phase, "cancel");
  assert.deepEqual(cancel.cancels, [{ id: "gid://shopify/Fulfillment/91" }]);
  // 出荷元での履行（倉庫が出荷したもの）は取り消さない
  const shipped = order3({
    fulfillmentOrders: [{ id: "fo", status: "CLOSED", method: "RETAIL", locationId: STORE, lines: [{ id: "l", lineItemId: "gid://shopify/LineItem/11", remaining: 0 }] }],
    fulfillments: [
      { id: "gid://shopify/Fulfillment/92", locationId: STORE, lines: [{ lineItemId: "gid://shopify/LineItem/11", quantity: 1 }] },
      { id: "gid://shopify/Fulfillment/93", locationId: WAREHOUSE, lines: [{ lineItemId: "gid://shopify/LineItem/11", quantity: 2 }] },
    ],
  });
  assert.equal(planSale(shipped, { ...ON, cancelStoreFulfillment: true }).phase, "done");
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

const sameLoc = (a, b) => String(a).replace(/\D/g, "") === String(b).replace(/\D/g, "");

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
          fulfillments: state.fulfillments.map((f) => ({ id: f.id, status: f.status || "SUCCESS", location: { id: f.locationId }, fulfillmentLineItems: { pageInfo: { hasNextPage: false }, nodes: f.lines.map((x) => ({ quantity: x.quantity, lineItem: { id: x.lineItemId } })) } })),
        },
      };
    }
    if (name === "PosLiteCancelFulfillment") {
      const f = state.fulfillments.find((x) => x.id === variables.id);
      if (!f || f.status === "CANCELLED") return { fulfillmentCancel: { fulfillment: null, userErrors: [{ message: "取り消せません" }] } };
      f.status = "CANCELLED";
      // Shopify: 取り消した分は、在庫のある元のロケーションに新しい出荷指示として戻る
      for (const fo of state.fulfillmentOrders) if (sameLoc(fo.locationId, f.locationId) && fo.status === "CLOSED") fo.status = "CANCELLED";
      state.fulfillmentOrders.push({ id: `fo-back-${f.id}`, status: "OPEN", method: "RETAIL", locationId: f.locationId, lines: f.lines.map((l, i) => ({ id: `fol-back-${i}`, lineItemId: l.lineItemId, remaining: l.quantity })) });
      return { fulfillmentCancel: { fulfillment: { id: f.id, status: "CANCELLED" }, userErrors: [] } };
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
        state.fulfillments.push({ id: `gid://shopify/Fulfillment/${900 + state.fulfillments.length}`, locationId: fo.locationId, lines: done });
      }
      assert.equal(variables.fulfillment.notifyCustomer, false);
      return { fulfillmentCreate: { fulfillment: { id: "f", status: "SUCCESS" }, userErrors: [] } };
    }
    if (name === "PosLiteShippingAddress" || name === "PosLiteRedactAttributes") {
      if (variables.input.shippingAddress) state.shippingAddress = variables.input.shippingAddress;
      if (variables.input.customAttributes) state.customAttributes = variables.input.customAttributes;
      return { orderUpdate: { order: { id: state.id }, userErrors: [] } };
    }
    if (name === "PosLiteMetafields") {
      for (const m of variables.metafields) state.metafields = { ...(state.metafields || {}), [m.key]: m.value };
      return { metafieldsSet: { metafields: [], userErrors: [] } };
    }
    if (name === "PosLitePaidPrecheck") {
      return { shop: { metafield: { value: JSON.stringify(state.config || ON) } }, order: { id: state.id, fulfillmentOrders: { nodes: state.fulfillmentOrders.slice(0, 1) }, fulfillments: state.fulfillments.slice(0, 1) } };
    }
    if (name === "PosLiteRedactOrder") {
      return { order: { id: state.id, customAttributes: state.customAttributes, metafield: state.metafields?.delivery_handoff ? { value: state.metafields.delivery_handoff } : null } };
    }
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
  // 注文の属性と配送の記録に、名前・住所・電話のコピーが残らない
  const attr = shop.state.customAttributes.find((a) => a.key === DELIVERY_ATTRIBUTE);
  assert.equal(JSON.parse(attr.value).to, undefined);
  assert.doesNotMatch(shop.state.metafields.delivery_handoff, /山田|目黒|0300000000/);

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

test("代わりの道: 店頭で全部履行済み → 取り消す → 配送 2 点を出荷元へ → 持ち帰り 1 点を履行。2 回目は何もしない", async () => {
  const all = order3({
    fulfillmentOrders: [{ id: "fo", status: "CLOSED", method: "RETAIL", locationId: STORE, lines: [{ id: "l", lineItemId: "gid://shopify/LineItem/11", remaining: 0 }] }],
    fulfillments: [{ id: "gid://shopify/Fulfillment/91", locationId: STORE, lines: [{ lineItemId: "gid://shopify/LineItem/11", quantity: 3 }] }],
  });
  const config = { ...ON, cancelStoreFulfillment: true };
  const shop = fakeShopify(all);
  const first = await processSale(shop.request, "gid://shopify/Order/1", { config });
  assert.equal(first.phase, "done");
  assert.equal(first.storeQuantity, 1);
  assert.equal(shop.state.fulfillments.find((f) => f.id === "gid://shopify/Fulfillment/91").status, "CANCELLED");
  const store = shop.state.fulfillments.filter((f) => f.status !== "CANCELLED" && sameLoc(f.locationId, STORE)).flatMap((f) => f.lines);
  assert.deepEqual(store, [{ lineItemId: "gid://shopify/LineItem/11", quantity: 1 }]);
  const warehouse = shop.state.fulfillmentOrders.filter((fo) => sameLoc(fo.locationId, WAREHOUSE) && fo.status === "OPEN");
  assert.equal(warehouse.reduce((sum, fo) => sum + fo.lines.reduce((s, l) => s + l.remaining, 0), 0), 2);
  shop.calls.length = 0;
  const second = await processSale(shop.request, "gid://shopify/Order/1", { config });
  assert.equal(second.phase, "done");
  assert.ok(!["PosLiteCancelFulfillment", "PosLiteMove", "PosLiteFulfill"].some((c) => shop.calls.includes(c)), "2 回目に取り消し・移動・履行をしない");
});

test("代わりの道: スイッチがオフなら取り消さず、要確認で止める", async () => {
  const all = order3({
    fulfillmentOrders: [{ id: "fo", status: "CLOSED", method: "RETAIL", locationId: STORE, lines: [{ id: "l", lineItemId: "gid://shopify/LineItem/11", remaining: 0 }] }],
    fulfillments: [{ id: "gid://shopify/Fulfillment/91", locationId: STORE, lines: [{ lineItemId: "gid://shopify/LineItem/11", quantity: 3 }] }],
  });
  const shop = fakeShopify(all);
  const result = await processSale(shop.request, "gid://shopify/Order/1", { config: ON });
  assert.equal(result.reason, "already_fulfilled");
  assert.ok(!shop.calls.includes("PosLiteCancelFulfillment"));
  assert.ok(shop.state.tags.includes(REVIEW_TAG));
  // 止まるときも、配送先は注文に書き、属性のコピーは外す
  assert.equal(shop.state.shippingAddress.city, "目黒区");
  assert.equal(JSON.parse(shop.state.customAttributes[0].value).to, undefined);
});

test("代わりの道: 取り消せないときは理由つきで要確認", async () => {
  const all = order3({
    fulfillmentOrders: [{ id: "fo", status: "CLOSED", method: "RETAIL", locationId: STORE, lines: [{ id: "l", lineItemId: "gid://shopify/LineItem/11", remaining: 0 }] }],
    fulfillments: [{ id: "gid://shopify/Fulfillment/91", locationId: STORE, lines: [{ lineItemId: "gid://shopify/LineItem/11", quantity: 3 }] }],
  });
  const shop = fakeShopify(all);
  const request = async (query, variables) =>
    /mutation PosLiteCancelFulfillment/.test(query)
      ? { fulfillmentCancel: { fulfillment: null, userErrors: [{ message: "この履行は取り消せません" }] } }
      : shop.request(query, variables);
  const result = await processSale(request, "gid://shopify/Order/1", { config: { ...ON, cancelStoreFulfillment: true } });
  assert.equal(result.phase, "review");
  assert.equal(result.reason, "cancel");
  assert.match(result.message, /この履行は取り消せません/);
  assert.ok(!shop.calls.includes("PosLiteMove"));
});

test("orders/paid: 出荷指示がまだ無ければ送り直してもらう。後ろの処理で待ちになったら正しい理由で要確認", async () => {
  const shop = fakeShopify(order3({ fulfillmentOrders: [], fulfillments: [] }));
  assert.equal((await precheckPaid(shop.request, "gid://shopify/Order/1")).action, "retry");
  const off = fakeShopify(order3());
  off.state.config = parseConfig(null);
  assert.equal((await precheckPaid(off.request, "gid://shopify/Order/1")).action, "ignore");
  assert.equal((await precheckPaid(fakeShopify(order3()).request, "gid://shopify/Order/1")).action, "process");
  // 再処理（管理画面）では印を付けない
  const manual = await processSale(shop.request, "gid://shopify/Order/1", { config: ON });
  assert.equal(manual.phase, "retry");
  assert.ok(!shop.state.tags.includes(REVIEW_TAG));
  // 後ろの処理では送り直してもらえないので、正しい理由で要確認にする
  const background = await processPaidInBackground({ request: shop.request, orderId: "gid://shopify/Order/1", config: ON, lockKey: "k", allowed: async () => true, log: () => {} });
  assert.equal(background.phase, "review");
  assert.equal(background.reason, "waiting_fulfillment_orders");
  assert.ok(shop.state.tags.includes(REVIEW_TAG));
});

test("orders/paid の後ろの処理: Pro でなければ何もしない・失敗しても投げない", async () => {
  const shop = fakeShopify(order3());
  const skipped = await processPaidInBackground({ request: shop.request, orderId: "gid://shopify/Order/1", config: ON, lockKey: "k2", allowed: async () => false, log: () => {} });
  assert.equal(skipped.phase, "skip");
  assert.ok(!shop.calls.includes("PosLiteMove"));
  const broken = await processPaidInBackground({ request: shop.request, orderId: "x", config: ON, lockKey: "k3", allowed: async () => { throw new Error("plan"); }, log: () => {} });
  assert.equal(broken.phase, "review");
});

test("customers/redact: 注文の属性と配送の記録から配送先を消す（何度呼んでも同じ）", async () => {
  const shop = fakeShopify(order3());
  shop.state.metafields = { delivery_handoff: JSON.stringify({ warehouseLocationId: "202", destination: { lastName: "山田" } }) };
  const first = await redactPosLiteOrders(shop.request, [1]);
  assert.equal(first.scrubbed, 2);
  assert.equal(JSON.parse(shop.state.customAttributes[0].value).to, undefined);
  assert.equal(JSON.parse(shop.state.metafields.delivery_handoff).destination, undefined);
  assert.equal(JSON.parse(shop.state.metafields.delivery_handoff).warehouseLocationId, "202");
  const again = await redactPosLiteOrders(shop.request, ["gid://shopify/Order/1"]);
  assert.equal(again.scrubbed, 0);
  // 注文を読む権限が無い店は消すものが無い（500 にしない）
  const denied = await redactPosLiteOrders(async () => { throw new Error("Shopify の API で失敗しました（Access denied for order field）"); }, [1]);
  assert.equal(denied.skipped, "no_access");
});

test("配送先を外したあとの属性も読める（配送先は注文の配送先住所が正）", () => {
  const scrubbed = JSON.parse(deliveryAttr());
  delete scrubbed.to;
  const order = order3({ customAttributes: [{ key: DELIVERY_ATTRIBUTE, value: JSON.stringify(scrubbed) }] });
  assert.equal(planSale(order, ON).reason, "bad_delivery", "配送先住所も無ければ読めない");
  const withAddress = order3({ customAttributes: [{ key: DELIVERY_ATTRIBUTE, value: JSON.stringify(scrubbed) }], shippingAddress: { city: "目黒区" } });
  const step = planSale(withAddress, ON);
  assert.equal(step.phase, "move");
  assert.equal(step.addressInput, null, "書くものが無い");
});

test("管理画面: 再処理は確認の窓、理由に要確認のバッジ、2 つの新しい設定がある", () => {
  const page = readFileSync("app/routes/app.pos-lite.jsx", "utf8");
  assert.match(page, /<ConfirmAction\s+trigger="secondary"/);
  assert.match(page, /<StateBadge label="要確認" \/>/);
  assert.match(page, /name="cancelStoreFulfillment" defaultChecked=\{config\.cancelStoreFulfillment\}/);
  assert.match(page, /name="shippingTaxable" defaultChecked=\{config\.shippingTaxable\}/);
  const hook = readFileSync("app/routes/webhooks.orders.paid.jsx", "utf8");
  assert.match(hook, /void processPaidInBackground/);
  assert.match(hook, /check\.action === "retry"[\s\S]*status: 500/);
});
