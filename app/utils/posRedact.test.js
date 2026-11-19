/* eslint-env node */
import {test} from "node:test";
import assert from "node:assert/strict";
import {orderGidsToRedact, redactCustomerPosData, redactShopPosData} from "./posRedact.server.js";

function fakeDb(rows) {
  const tables = {posWebhookClaim: [...rows.claims], posOrderLock: [...rows.locks]};
  const matches = (row, where) =>
    Object.entries(where).every(([key, cond]) =>
      cond && typeof cond === "object" && Array.isArray(cond.in) ? cond.in.includes(row[key]) : row[key] === cond,
    );
  const db = {tables};
  for (const name of Object.keys(tables)) {
    db[name] = {
      deleteMany: async ({where}) => {
        const before = tables[name].length;
        tables[name] = tables[name].filter((row) => !matches(row, where));
        return {count: before - tables[name].length};
      },
    };
  }
  return db;
}

const A = "a.myshopify.com";
const B = "b.myshopify.com";
const order = (n) => `gid://shopify/Order/${n}`;

function sample() {
  return fakeDb({
    claims: [
      {id: "w1", shop: A, orderId: order(1)},
      {id: "w2", shop: A, orderId: order(2)},
      {id: "w3", shop: A, orderId: null},
      {id: "w4", shop: B, orderId: order(1)},
    ],
    locks: [
      {id: `${A}:${order(1)}`, shop: A, orderId: order(1)},
      {id: `${B}:${order(1)}`, shop: B, orderId: order(1)},
    ],
  });
}

test("shop/redact deletes every POS claim and lock of that shop only", async () => {
  const db = sample();
  const result = await redactShopPosData(db, A);
  assert.deepEqual(result, {claims: 3, locks: 1});
  assert.deepEqual(db.tables.posWebhookClaim.map((r) => r.id), ["w4"]);
  assert.deepEqual(db.tables.posOrderLock.map((r) => r.shop), [B]);
});

test("shop/redact without a shop deletes nothing", async () => {
  const db = sample();
  assert.deepEqual(await redactShopPosData(db, ""), {claims: 0, locks: 0});
  assert.equal(db.tables.posWebhookClaim.length, 4);
});

test("customers/redact deletes rows of the listed orders in that shop only", async () => {
  const db = sample();
  const result = await redactCustomerPosData(db, A, {orders_to_redact: [1, "999"]});
  assert.deepEqual(result, {claims: 1, locks: 1});
  assert.deepEqual(db.tables.posWebhookClaim.map((r) => r.id), ["w2", "w3", "w4"]);
  assert.deepEqual(db.tables.posOrderLock.map((r) => r.shop), [B]);
});

test("customers/redact without orders deletes nothing", async () => {
  const db = sample();
  assert.deepEqual(await redactCustomerPosData(db, A, {}), {claims: 0, locks: 0});
  assert.deepEqual(await redactCustomerPosData(db, A, {orders_to_redact: []}), {claims: 0, locks: 0});
  assert.equal(db.tables.posWebhookClaim.length, 4);
  assert.equal(db.tables.posOrderLock.length, 2);
});

test("order ids are normalized to Order gids and invalid values are ignored", () => {
  assert.deepEqual(
    orderGidsToRedact({orders_to_redact: [123, "456", order(789), "abc", null, -1, 123]}),
    [order(123), order(456), order(789)],
  );
});
