import {test} from "node:test";
import assert from "node:assert/strict";
import {pickupOrders} from "../../extensions/pos-pickup/src/pickup.js";

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
