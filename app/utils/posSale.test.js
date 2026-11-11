import {test} from "node:test";
import assert from "node:assert/strict";
import {
  ORDER_LOCK_STALE_MS,
  acquireOrderLock,
  claimDecision,
  claimState,
  coordinatePaidOrder,
  coordinateRetry,
  createPlan,
  executeSale,
  feeSync,
  listReviewOrders,
  loadSaleOrder,
  normalizeAddress,
  normalizeOperations,
  planSale,
  recalculatePlan,
  settingsFor,
} from "../../extensions/pos-pickup/src/logic.js";

const store = "gid://shopify/Location/12";
const warehouse = "gid://shopify/Location/9";
const settings = {
  locationId: store,
  active: true,
  startsAt: "2026-11-01T00:00:00.000Z",
  endsAt: "",
  deliveryEnabled: true,
  warehouseLocationId: warehouse,
  shippingFee: 770,
  shippingTitle: "送料",
};
const address = {
  lastName: "山田", firstName: "花", zip: "100-0001", city: "千代田区",
  address1: "1-1", address2: "", phone: "0311112222", countryCode: "JP", provinceCode: "JP-13",
};

function sale(extra = {}) {
  return {
    id: "gid://shopify/Order/1",
    sourceName: "pos",
    createdAt: "2026-11-11T00:00:00.000Z",
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    returnStatus: "NO_RETURN",
    salesLocationId: store,
    staffMemberId: "88",
    tags: [],
    customAttributes: [],
    refundCount: 0,
    shippingAddress: null,
    lines: [{variantKey: "5", sku: "SKU", title: "Shirt", quantity: 2, unitPrice: 1000}],
    fulfillmentOrders: [{
      id: "gid://shopify/FulfillmentOrder/1",
      status: "OPEN",
      requestStatus: "UNSUBMITTED",
      method: "RETAIL",
      locationId: store,
      lines: [{id: "line-1", variantKey: "5", sku: "SKU", title: "Shirt", remaining: 2}],
    }],
    ...extra,
  };
}

function withDelivery(quantity, fee = 770) {
  const order = sale({
    customAttributes: [{key: "_lsi_reception", value: "abc12345"}],
    lines: [
      {variantKey: "5", sku: "SKU", title: "Shirt", quantity: 2, unitPrice: 1000},
      {variantKey: "", sku: "", title: "送料", quantity: 1, unitPrice: fee},
    ],
  });
  order.fulfillmentOrders[0].lines.push({id: "fee-1", variantKey: "", sku: "", title: "送料", remaining: 1});
  return {
    order,
    plan: {
      id: "abc12345",
      status: "open",
      locationId: "12",
      warehouseLocationId: "9",
      shippingTitle: "送料",
      feeAmount: fee,
      confirmedFee: fee,
      address,
      lines: [{uuid: "u1", variantId: "5", sku: "SKU", quantity: 2, deliveryQuantity: quantity}],
    },
  };
}

test("normal paid POS sales are fulfilled in full without a tile", () => {
  const step = planSale(sale(), settings, null);
  assert.equal(step.phase, "fulfill");
  assert.equal(step.storeQuantity, 2);
  assert.equal(step.moves.length, 0);
  assert.equal(step.fulfills[0].notifyCustomer, false);
  assert.equal(step.handoff, null);
});

test("full delivery moves every unit and leaves no store fulfillment", async () => {
  const {order, plan} = withDelivery(2);
  const first = planSale(order, settings, plan);
  assert.equal(first.phase, "move");
  assert.equal(first.moves[0].fulfillmentOrderLineItems[0].quantity, 2);
  assert.equal(first.moves[0].newLocationId, warehouse);
  assert.equal(first.addressInput.shippingAddress.address1, "1-1");
  assert.equal(first.handoff.shippingFee, 770);
  assert.equal(first.handoff.destination.phone, "0311112222");
  assert.equal(first.handoff.salesLocationId, store);
  assert.equal(first.handoff.staffMemberId, "88");
  assert.deepEqual(Object.keys(first.addressInput).sort(), ["id", "shippingAddress"]);
  const calls = [];
  const after = sale({
    shippingAddress: address,
    lines: order.lines,
    customAttributes: order.customAttributes,
    fulfillmentOrders: [
      {...order.fulfillmentOrders[0], lines: [{id: "fee-1", variantKey: "", title: "送料", remaining: 1}]},
      {id: "gid://shopify/FulfillmentOrder/2", status: "OPEN", requestStatus: "UNSUBMITTED", method: "SHIPPING", locationId: warehouse, lines: [{id: "line-2", variantKey: "5", title: "Shirt", remaining: 2}]},
    ],
  });
  const result = await executeSale(async (query) => {
    calls.push(query);
    if (query.includes("orderUpdate")) return {orderUpdate: {userErrors: []}};
    if (query.includes("metafieldsSet")) return {metafieldsSet: {userErrors: []}};
    if (query.includes("PosMove")) return {fulfillmentOrderMove: {userErrors: []}};
    if (query.includes("PosFulfill")) throw new Error("store fulfillment");
    throw new Error(query);
  }, order, settings, plan, async () => after);
  assert.equal(result.phase, "done");
  assert.equal(result.storeQuantity, 0);
  assert.equal(calls.some((query) => query.includes("PosFulfill")), false);
  assert.equal(JSON.parse(first.metafield.value).shippingFee, 770);
});

test("mixed delivery fulfills only the takeaway quantity after the warehouse move", async () => {
  const {order, plan} = withDelivery(1);
  const calls = [];
  const after = sale({
    shippingAddress: address,
    lines: order.lines,
    customAttributes: order.customAttributes,
    fulfillmentOrders: [
      {id: "gid://shopify/FulfillmentOrder/1", status: "OPEN", requestStatus: "UNSUBMITTED", method: "RETAIL", locationId: store, lines: [
        {id: "line-1", variantKey: "5", title: "Shirt", remaining: 1},
        {id: "fee-1", variantKey: "", title: "送料", remaining: 1},
      ]},
      {id: "gid://shopify/FulfillmentOrder/2", status: "OPEN", requestStatus: "UNSUBMITTED", method: "SHIPPING", locationId: warehouse, lines: [
        {id: "line-2", variantKey: "5", title: "Shirt", remaining: 1},
      ]},
    ],
  });
  const result = await executeSale(async (query, variables) => {
    calls.push({query, variables});
    if (query.includes("orderUpdate")) return {orderUpdate: {userErrors: []}};
    if (query.includes("metafieldsSet")) return {metafieldsSet: {userErrors: []}};
    if (query.includes("PosMove")) return {fulfillmentOrderMove: {userErrors: []}};
    if (query.includes("PosFulfill")) return {fulfillmentCreate: {userErrors: [], fulfillment: {id: "f", status: "SUCCESS"}}};
    throw new Error(query);
  }, order, settings, plan, async () => after);
  const fulfillment = calls.find((call) => call.query.includes("PosFulfill")).variables.fulfillment;
  assert.equal(fulfillment.notifyCustomer, false);
  assert.deepEqual(fulfillment.lineItemsByFulfillmentOrder[0].fulfillmentOrderLineItems, [{id: "line-1", quantity: 1}]);
  assert.equal(result.storeQuantity, 1);
  assert.equal(result.handoff.staffMemberId, "88");
});

test("same SKU can be split between takeaway and delivery and recalculates when quantity changes", () => {
  const row = {...settings, locationId: "12", warehouseLocationId: "9"};
  const created = createPlan({
    address: {...address, province: "東京都", provinceCode: undefined},
    lines: [
      {uuid: "a", variantId: "gid://shopify/ProductVariant/5", sku: "SKU", quantity: 2, deliveryQuantity: 2},
      {uuid: "b", variantId: 5, sku: "SKU", quantity: 1, deliveryQuantity: 1},
    ],
  }, row);
  assert.equal(created.plan.lines.length, 2);
  assert.equal(created.plan.lines[0].deliveryQuantity, 2);
  assert.equal(created.plan.feeAmount, 770);
  const reduced = recalculatePlan(created.plan, [
    {uuid: "a", variantId: 5, sku: "SKU", quantity: 1},
    {uuid: "b", variantId: 5, sku: "SKU", quantity: 1},
  ]);
  assert.equal(reduced.lines.find((line) => line.uuid === "a").deliveryQuantity, 1);
  assert.equal(reduced.feeAmount, 770);
  const removed = recalculatePlan(created.plan, []);
  assert.equal(removed.status, "cancelled");
  assert.equal(removed.feeAmount, 0);
  assert.deepEqual(feeSync([{uuid: "fee", variantId: null, title: "送料", price: 770, quantity: 1}], "送料", 0).remove, ["fee"]);
});

test("delivery quantity cannot exceed the cart line", () => {
  const result = createPlan({
    address,
    lines: [{uuid: "a", variantId: 5, quantity: 1, deliveryQuantity: 2}],
  }, settings);
  assert.match(result.error, /超えて/);
});

test("excludes channels and states that are outside the paid POS sale", () => {
  const cases = [
    [{sourceName: "web"}, "not_pos"],
    [{salesLocationId: null}, "not_pos_location"],
    [{displayFinancialStatus: "PENDING"}, "unpaid"],
    [{cancelledAt: "2026-11-11T00:00:00.000Z"}, "cancelled"],
    [{refundCount: 1}, "refund"],
    [{returnStatus: "IN_PROGRESS"}, "return"],
    [{tags: ["点検"]}, "settlement"],
    [{fulfillmentOrders: [{...sale().fulfillmentOrders[0], method: "PICK_UP"}]}, "pickup"],
  ];
  for (const [patch, reason] of cases) {
    assert.equal(planSale(sale(patch), settings, null).reason, reason);
  }
  const {order} = withDelivery(2);
  assert.equal(planSale(order, settings, null).reason, "partial_plan");
  assert.equal(settingsFor({locations: [settings]}, store, "2026-10-01T00:00:00.000Z"), null);
});

test("a warehouse allocation failure stays for review and does not fulfill", async () => {
  const {order, plan} = withDelivery(2);
  const calls = [];
  const result = await executeSale(async (query) => {
    calls.push(query);
    if (query.includes("orderUpdate")) return {orderUpdate: {userErrors: []}};
    if (query.includes("metafieldsSet")) return {metafieldsSet: {userErrors: []}};
    if (query.includes("PosMove")) return {fulfillmentOrderMove: {userErrors: [{message: "在庫がありません"}]}};
    throw new Error("fulfilled");
  }, order, settings, plan, async () => { throw new Error("reloaded"); });
  assert.equal(result.phase, "review");
  assert.equal(result.reason, "warehouse_short");
  assert.match(result.message, /在庫がありません/);
});

test("inconsistent delivery quantity and a fee mismatch are review items", () => {
  const tooMany = withDelivery(3);
  assert.equal(planSale(tooMany.order, tooMany.settings || settings, tooMany.plan).reason, "inconsistent");
  const mismatched = withDelivery(1);
  mismatched.plan.feeAmount = 500;
  assert.equal(planSale(mismatched.order, settings, mismatched.plan).reason, "fee_mismatch");
});

test("a late webhook uses the order time and an inactive flag does not close an open period", () => {
  const period = {...settings, active: false, endsAt: "2026-11-12T00:00:00.000Z"};
  assert.ok(settingsFor({locations: [period]}, store, "2026-11-11T23:00:00.000Z"));
  assert.equal(settingsFor({locations: [period]}, store, "2026-11-12T00:00:00.000Z"), null);
});

test("turning a target off closes an empty end time", () => {
  const known = [store, warehouse];
  const previous = {locations: [{...settings, active: true, endsAt: ""}]};
  const saved = normalizeOperations([{...settings, active: false, endsAt: "", shippingFee: 770}], known, previous, "2026-11-11T12:00:00.000Z");
  assert.equal(saved.errors.length, 0);
  assert.equal(saved.locations[0].endsAt, "2026-11-11T12:00:00.000Z");
  assert.equal(saved.locations[0].deliveryEnabled, false);
});

test("Japanese prefecture names become shipping province codes", () => {
  assert.equal(normalizeAddress({...address, provinceCode: undefined, province: "東京都"}).address.provinceCode, "JP-13");
});

test("sale order loading follows every line-item page", async () => {
  const header = {
    id: "gid://shopify/Order/1", name: "#1", sourceName: "pos", createdAt: "2026-11-11T00:00:00.000Z",
    cancelledAt: null, displayFinancialStatus: "PAID", returnStatus: "NO_RETURN", tags: [],
    retailLocation: {id: store}, customAttributes: [], refunds: [], shippingAddress: null,
  };
  const line = (id) => ({id, sku: id, title: id, quantity: 1, currentQuantity: 1, originalUnitPriceSet: {shopMoney: {amount: "100"}}, variant: {id: "gid://shopify/ProductVariant/5"}});
  const empty = {nodes: [], pageInfo: {hasNextPage: false, endCursor: null}};
  const order = await loadSaleOrder(async (query, variables) => {
    if (query.includes("PosFulfillmentLines")) return {fulfillmentOrder: {lineItems: empty}};
    if (variables.lineItemsAfter === "next") {
      return {order: {...header, lineItems: {nodes: [line("b")], pageInfo: {hasNextPage: false, endCursor: null}}, fulfillmentOrders: empty}};
    }
    return {order: {...header, lineItems: {nodes: [line("a")], pageInfo: {hasNextPage: true, endCursor: "next"}}, fulfillmentOrders: empty}};
  }, header.id);
  assert.deepEqual(order.lines.map((item) => item.id), ["a", "b"]);
  assert.equal(order.salesLocationId, store);
});

test("webhook claims do not run a finished or review event again", () => {
  assert.equal(claimDecision(null), "start");
  assert.equal(claimDecision({state: "processing"}), "continue");
  assert.equal(claimDecision({state: "done"}), "stop");
  assert.equal(claimDecision({state: "review"}), "stop");
  assert.equal(claimState("review"), "review");
  assert.equal(claimState("done"), "done");
});

test("fulfilled warehouse quantity is not allocated again from takeaway stock", () => {
  const {order, plan} = withDelivery(1);
  order.fulfillmentOrders = [{
    id: "gid://shopify/FulfillmentOrder/1",
    status: "OPEN",
    requestStatus: "UNSUBMITTED",
    method: "RETAIL",
    locationId: store,
    lines: [{id: "line-1", variantKey: "5", sku: "SKU", title: "Shirt", remaining: 1}],
  }];
  order.shipments = [{
    status: "SUCCESS",
    locationId: warehouse,
    lines: [{variantKey: "5", quantity: 1}],
  }];
  const step = planSale(order, settings, plan);
  assert.equal(step.moves.length, 0);
  assert.equal(step.phase, "fulfill");
  assert.deepEqual(step.fulfills[0].fulfillmentOrderLineItems, [{id: "line-1", quantity: 1}]);
});

test("a partial warehouse shipment moves only the delivery quantity still outstanding", () => {
  const {order, plan} = withDelivery(2);
  order.shipments = [{status: "SUCCESS", locationId: warehouse, lines: [{variantKey: "5", quantity: 1}]}];
  const step = planSale(order, settings, plan);
  assert.equal(step.phase, "move");
  assert.equal(step.moves[0].fulfillmentOrderLineItems[0].quantity, 1);
});

test("each store's review list is collected from every page", async () => {
  const other = Array.from({length: 30}, (_, index) => ({
    id: `gid://shopify/Order/${1000 + index}`,
    name: `#${1000 + index}`,
    retailLocation: {id: "gid://shopify/Location/99"},
  }));
  const pages = [
    {nodes: other, pageInfo: {hasNextPage: true, endCursor: "p2"}},
    {nodes: [{id: "gid://shopify/Order/13", name: "#13", retailLocation: {id: "gid://shopify/Location/13"}}], pageInfo: {hasNextPage: true, endCursor: "p3"}},
    {nodes: [{id: "gid://shopify/Order/12", name: "#12", retailLocation: {id: store}, metafield: {value: "再処理"}}], pageInfo: {hasNextPage: false, endCursor: null}},
  ];
  const seen = [];
  const request = async (_query, variables) => {
    seen.push(variables.after);
    const page = variables.after === "p2" ? pages[1] : variables.after === "p3" ? pages[2] : pages[0];
    return {orders: page};
  };
  const store12 = await listReviewOrders(request, 12);
  const store13 = await listReviewOrders(request, 13);
  assert.deepEqual(seen, [null, "p2", "p3", null, "p2", "p3"]);
  assert.deepEqual(store12.rows.map((row) => row.name), ["#12"]);
  assert.deepEqual(store13.rows.map((row) => row.name), ["#13"]);
  assert.equal(store12.complete, true);
  assert.equal(store13.complete, true);
});

function memoryLocks() {
  const rows = new Map();
  return {
    get: async (id) => rows.get(id) || null,
    create: async (data) => {
      if (rows.has(data.id)) {
        const error = new Error("exists");
        error.code = "P2002";
        throw error;
      }
      rows.set(data.id, {...data, updatedAt: data.updatedAt || new Date()});
    },
    takeover: async (id, owner, staleBefore) => {
      const row = rows.get(id);
      if (!row || row.updatedAt > staleBefore) return 0;
      row.owner = owner;
      row.updatedAt = new Date();
      return 1;
    },
    release: async (id, owner) => {
      const row = rows.get(id);
      if (row?.owner === owner) rows.delete(id);
    },
  };
}

test("the same order cannot be processed twice while its lock is fresh", async () => {
  const locks = memoryLocks();
  const now = Date.parse("2026-11-11T00:00:00.000Z");
  let runs = 0;
  const first = coordinatePaidOrder({
    repo: {get: async () => null, start: async () => {}, finish: async () => {}},
    locks,
    shop: "ciara.myshopify.com",
    webhookId: "wh_1",
    orderId: "gid://shopify/Order/1",
    owner: "wh_1",
    now,
    staleMs: ORDER_LOCK_STALE_MS,
    distribution: "inhouse",
    work: async () => {
      runs += 1;
      const second = await coordinateRetry({
        locks,
        shop: "ciara.myshopify.com",
        orderId: "gid://shopify/Order/1",
        owner: "pos",
        now,
        staleMs: ORDER_LOCK_STALE_MS,
        work: async () => { runs += 10; },
      });
      assert.equal(second.busy, true);
      return {phase: "done", reason: null};
    },
  });
  const outcome = await first;
  assert.equal(runs, 1);
  assert.equal(outcome.state, "done");
});

function memoryClaims() {
  const rows = new Map();
  return {
    get: async (id) => rows.get(id) || null,
    start: async (data) => {
      if (rows.has(data.id)) {
        const error = new Error("exists");
        error.code = "P2002";
        throw error;
      }
      rows.set(data.id, {...data});
    },
    finish: async (id, data) => {
      rows.set(id, {...rows.get(id), ...data});
    },
  };
}

test("duplicate paid events acquire one order and run the sale once", async () => {
  const locks = memoryLocks();
  const repo = memoryClaims();
  const now = Date.parse("2026-11-11T00:00:00.000Z");
  let runs = 0;
  const run = () => coordinatePaidOrder({
    repo,
    locks,
    shop: "ciara.myshopify.com",
    webhookId: "wh_same",
    orderId: "gid://shopify/Order/1",
    owner: "wh_same",
    now,
    staleMs: ORDER_LOCK_STALE_MS,
    distribution: "inhouse",
    work: async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {phase: "done", reason: null};
    },
  });
  const [first, second] = await Promise.all([run(), run()]);
  const busy = [first, second].filter((item) => item.busy).length;
  assert.equal(runs, 1);
  assert.equal(busy, 1);
  assert.equal([first, second].some((item) => item.state === "done"), true);
});

test("only one caller takes over a stale order lock", async () => {
  const locks = memoryLocks();
  const now = Date.parse("2026-11-11T00:10:00.000Z");
  await locks.create({
    id: "ciara.myshopify.com:gid://shopify/Order/1",
    shop: "ciara.myshopify.com",
    orderId: "gid://shopify/Order/1",
    owner: "dead",
    updatedAt: new Date(now - ORDER_LOCK_STALE_MS - 1000),
  });
  const input = {shop: "ciara.myshopify.com", orderId: "gid://shopify/Order/1", now, staleMs: ORDER_LOCK_STALE_MS};
  assert.equal(await acquireOrderLock(locks, {...input, owner: "a"}), true);
  assert.equal(await acquireOrderLock(locks, {...input, owner: "b"}), false);
});
