import {test} from "node:test";
import assert from "node:assert/strict";
import {pickupOrders, pickupDetails, completePickup, preparePickup} from "../../extensions/pos-pickup/src/pickup.js";
import {pickupMail} from "../../extensions/pos-pickup/src/logic.js";

const row = (id, location = 12, method = "PICK_UP", status = "OPEN") => ({
  id, status, orderName: "#" + id, deliveryMethod: {methodType: method},
  assignedLocation: {location: {id: "gid://shopify/Location/" + location}},
});
const page = (nodes, endCursor = null) => ({fulfillmentOrders: {
  nodes, pageInfo: {hasNextPage: !!endCursor, endCursor},
}});

test("returns only current-location pickup work across all pages", async () => {
  const result = await pickupOrders(12, async (_, {filter, after}) => {
    assert.match(filter, /assigned_location_id:12\b/);
    return after ? page([row(5), row(1)]) :
      page([row(1), row(2, 13), row(3, 12, "SHIPPING"), row(4, 12, "PICK_UP", "CLOSED")], "next");
  });
  assert.deepEqual(result.map(item => item.id), [1, 5]);
});

test("rejects invalid location and incomplete pagination", async () => {
  await assert.rejects(pickupOrders(null, () => assert.fail()), /店舗/);
  await assert.rejects(pickupOrders(12, async () => page([], "same")), /更新/);
});

test("details include remaining quantities from every page", async () => {
  const items = await pickupDetails("fo", 12, async (_, {after}) => ({
    fulfillmentOrder: {...row("fo"), updatedAt: "v1", lineItems: {
      nodes: after ? [{id: "b", remainingQuantity: 2}] : [{id: "a", remainingQuantity: 0}],
      pageInfo: {hasNextPage: !after, endCursor: after ? null : "next"},
    }},
  }));
  assert.deepEqual(items, [{id: "b", remainingQuantity: 2}]);
});

test("details reject an order reassigned to another store", async () => {
  await assert.rejects(pickupDetails("fo", 12, async () => ({fulfillmentOrder: row("fo", 13)})), /変更/);
});

function actionOrder(status, extra = {}) {
  return {fulfillmentOrder: {
    status,
    requestStatus: extra.requestStatus || "UNSUBMITTED",
    order: {displayFulfillmentStatus: extra.display || "UNFULFILLED"},
    deliveryMethod: {methodType: "PICK_UP"},
    assignedLocation: {location: {id: "gid://shopify/Location/" + (extra.location || 12)}},
    supportedActions: [{action: "CREATE_FULFILLMENT"}],
    lineItems: {
      nodes: extra.lines || [{id: "li", remainingQuantity: 2}],
      pageInfo: {hasNextPage: false, endCursor: null},
    },
  }};
}

test("prepare notifies once and a second terminal reloads instead of sending again", async () => {
  let status = "OPEN";
  const mutations = [];
  const request = async (query) => {
    if (query.includes("fulfillmentOrderLineItemsPreparedForPickup")) {
      mutations.push(query);
      status = "IN_PROGRESS";
      return {fulfillmentOrderLineItemsPreparedForPickup: {userErrors: []}};
    }
    return actionOrder(status);
  };
  assert.equal((await preparePickup("fo", 12, request)).status, "prepared");
  assert.equal((await preparePickup("fo", 12, request)).already, "prepared");
  assert.equal(mutations.length, 1);
});

test("hold, transfer, cancellation, and another store cannot be actioned", async () => {
  const reject = (status, extra, pattern) => assert.rejects(
    preparePickup("fo", 12, async (query) => {
      if (query.includes("mutation")) throw new Error("mutated");
      return actionOrder(status, extra);
    }),
    pattern,
  );
  await reject("ON_HOLD", {}, /保留/);
  await reject("SCHEDULED", {}, /転送待ち/);
  await reject("CANCELLED", {}, /変更/);
  await reject("OPEN", {location: 13}, /変更/);
});

test("a timed-out prepare that Shopify applied is not sent again", async () => {
  let status = "OPEN";
  let attempts = 0;
  const result = await preparePickup("fo", 12, async (query) => {
    if (query.includes("fulfillmentOrderLineItemsPreparedForPickup")) {
      attempts += 1;
      status = "IN_PROGRESS";
      throw new Error("timeout");
    }
    return actionOrder(status);
  });
  assert.equal(result.already, "prepared");
  assert.equal(attempts, 1);
});

test("network failure can be retried and still sends the prepare once", async () => {
  let status = "OPEN";
  let attempts = 0;
  const request = async (query) => {
    if (query.includes("fulfillmentOrderLineItemsPreparedForPickup")) {
      attempts += 1;
      if (attempts === 1) throw new Error("network");
      status = "IN_PROGRESS";
      return {fulfillmentOrderLineItemsPreparedForPickup: {userErrors: []}};
    }
    return actionOrder(status);
  };
  await assert.rejects(preparePickup("fo", 12, request), /network/);
  assert.equal((await preparePickup("fo", 12, request)).status, "prepared");
  assert.equal(attempts, 2);
});

test("handover fulfills only the remaining quantity and records that the mailbox was not observed", async () => {
  let captured;
  let remaining = [{id: "a", remainingQuantity: 1}, {id: "b", remainingQuantity: 0}];
  const request = async (query, variables) => {
    if (query.includes("fulfillmentCreate")) {
      captured = variables;
      remaining = [{id: "a", remainingQuantity: 0}, {id: "b", remainingQuantity: 0}];
      return {fulfillmentCreate: {userErrors: [], fulfillment: {id: "f", status: "SUCCESS"}}};
    }
    return actionOrder("IN_PROGRESS", {lines: remaining});
  };
  await completePickup("fo", 12, request);
  assert.equal(captured.fulfillment.notifyCustomer, true);
  assert.deepEqual(captured.fulfillment.lineItemsByFulfillmentOrder[0].fulfillmentOrderLineItems, [{id: "a", quantity: 1}]);
  assert.equal((await completePickup("fo", 12, request)).already, "fulfilled");
  assert.equal(pickupMail.observed, null);
  assert.equal(pickupMail.complete.notifyCustomer, true);
});
