import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleComplianceWebhook, normalizeWebhookTopic } from "./complianceWebhook.js";

function fakeDb() {
  const calls = [];
  return {
    calls,
    session: {
      deleteMany: async (args) => {
        calls.push(args);
        return { count: 2 };
      },
    },
  };
}

const quiet = () => {};

describe("normalizeWebhookTopic", () => {
  it("accepts both library and header forms", () => {
    assert.equal(normalizeWebhookTopic("SHOP_REDACT"), "SHOP_REDACT");
    assert.equal(normalizeWebhookTopic("shop/redact"), "SHOP_REDACT");
    assert.equal(normalizeWebhookTopic("customers/data_request"), "CUSTOMERS_DATA_REQUEST");
    assert.equal(normalizeWebhookTopic(" Customers/Redact "), "CUSTOMERS_REDACT");
    assert.equal(normalizeWebhookTopic(undefined), "");
  });
});

describe("handleComplianceWebhook", () => {
  for (const topic of ["SHOP_REDACT", "shop/redact"]) {
    it(`deletes the shop's sessions for ${topic}`, async () => {
      const db = fakeDb();
      const res = await handleComplianceWebhook({ topic, shop: "a.myshopify.com", payload: {}, db, log: quiet });
      assert.equal(res.status, 200);
      assert.equal(res.handled, "SHOP_REDACT");
      assert.deepEqual(db.calls, [{ where: { shop: "a.myshopify.com" } }]);
    });
  }

  it("falls back to payload.shop_domain for shop/redact", async () => {
    const db = fakeDb();
    await handleComplianceWebhook({ topic: "SHOP_REDACT", shop: "", payload: { shop_domain: "b.myshopify.com" }, db, log: quiet });
    assert.deepEqual(db.calls, [{ where: { shop: "b.myshopify.com" } }]);
  });

  it("does not delete anything without a shop domain", async () => {
    const db = fakeDb();
    const res = await handleComplianceWebhook({ topic: "SHOP_REDACT", shop: null, payload: {}, db, log: quiet });
    assert.equal(res.status, 200);
    assert.deepEqual(db.calls, []);
  });

  for (const topic of ["CUSTOMERS_REDACT", "customers/redact", "CUSTOMERS_DATA_REQUEST", "customers/data_request"]) {
    it(`acknowledges ${topic} without deleting sessions`, async () => {
      const db = fakeDb();
      const res = await handleComplianceWebhook({ topic, shop: "a.myshopify.com", payload: {}, db, log: quiet });
      assert.equal(res.status, 200);
      assert.ok(res.handled);
      assert.deepEqual(db.calls, []);
    });
  }

  it("returns 200 and handled=null for an unknown topic", async () => {
    const db = fakeDb();
    const res = await handleComplianceWebhook({ topic: "PRODUCTS_UPDATE", shop: "a.myshopify.com", db, log: quiet });
    assert.deepEqual(res, { status: 200, handled: null });
    assert.deepEqual(db.calls, []);
  });
});
