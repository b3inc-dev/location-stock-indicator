import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleComplianceWebhook, normalizeWebhookTopic } from "./complianceWebhook.js";
import { isNotInstalledError, probeShopStillInstalled } from "./shopInstallProbe.js";

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
const notInstalled = async () => false;
const installed = async () => true;

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
      const res = await handleComplianceWebhook({ topic, shop: "a.myshopify.com", payload: {}, db, isShopStillInstalled: notInstalled, log: quiet });
      assert.equal(res.status, 200);
      assert.equal(res.handled, "SHOP_REDACT");
      assert.deepEqual(db.calls, [{ where: { shop: "a.myshopify.com" } }]);
    });
  }

  it("falls back to payload.shop_domain for shop/redact", async () => {
    const db = fakeDb();
    await handleComplianceWebhook({ topic: "SHOP_REDACT", shop: "", payload: { shop_domain: "b.myshopify.com" }, db, isShopStillInstalled: notInstalled, log: quiet });
    assert.deepEqual(db.calls, [{ where: { shop: "b.myshopify.com" } }]);
  });

  it("does not delete anything without a shop domain", async () => {
    const db = fakeDb();
    const res = await handleComplianceWebhook({ topic: "SHOP_REDACT", shop: null, payload: {}, db, isShopStillInstalled: notInstalled, log: quiet });
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

  it("skips the delete when the shop has installed the app again", async () => {
    const db = fakeDb();
    const seen = [];
    const res = await handleComplianceWebhook({
      topic: "SHOP_REDACT",
      shop: "a.myshopify.com",
      payload: {},
      db,
      isShopStillInstalled: async (s) => {
        seen.push(s);
        return true;
      },
      log: quiet,
    });
    assert.deepEqual(seen, ["a.myshopify.com"]);
    assert.equal(res.status, 200);
    assert.equal(res.skipped, "reinstalled");
    assert.deepEqual(db.calls, []);
  });

  it("throws (route answers 500) when the install check cannot decide", async () => {
    const db = fakeDb();
    await assert.rejects(
      handleComplianceWebhook({
        topic: "SHOP_REDACT",
        shop: "a.myshopify.com",
        db,
        isShopStillInstalled: async () => {
          throw new Error("network down");
        },
        log: quiet,
      }),
      /network down/,
    );
    assert.deepEqual(db.calls, []);
  });

  it("refuses shop/redact without an install check", async () => {
    const db = fakeDb();
    await assert.rejects(
      handleComplianceWebhook({ topic: "SHOP_REDACT", shop: "a.myshopify.com", db, log: quiet }),
      /isShopStillInstalled/,
    );
    assert.deepEqual(db.calls, []);
  });

  it("does not run the install check for customer topics", async () => {
    const db = fakeDb();
    let called = false;
    await handleComplianceWebhook({
      topic: "CUSTOMERS_REDACT",
      shop: "a.myshopify.com",
      db,
      isShopStillInstalled: async () => {
        called = true;
        return installed();
      },
      log: quiet,
    });
    assert.equal(called, false);
  });
});

describe("probeShopStillInstalled", () => {
  const ok = async () => ({ data: { shop: { id: "gid://shopify/Shop/1" } } });

  it("is false when there is no offline session", async () => {
    let queried = false;
    const res = await probeShopStillInstalled({
      shop: "a.myshopify.com",
      findOfflineSession: async () => null,
      runProbeQuery: async () => {
        queried = true;
      },
    });
    assert.equal(res, false);
    assert.equal(queried, false);
  });

  it("is true when the Admin API call works", async () => {
    const res = await probeShopStillInstalled({
      shop: "a.myshopify.com",
      findOfflineSession: async () => ({ id: "offline_a.myshopify.com" }),
      runProbeQuery: ok,
    });
    assert.equal(res, true);
  });

  for (const err of [
    Object.assign(new Error("Unauthorized"), { response: { code: 401 } }),
    Object.assign(new Error("Forbidden"), { response: { code: 403 } }),
    new Response(null, { status: 401 }),
    new Error("[API] Invalid API key or access token (unrecognized login or wrong password)"),
    new Error("invalid_grant"),
  ]) {
    it(`is false when the token is rejected (${err instanceof Response ? "Response 401" : err.message})`, async () => {
      const res = await probeShopStillInstalled({
        shop: "a.myshopify.com",
        findOfflineSession: async () => ({ id: "offline" }),
        runProbeQuery: async () => {
          throw err;
        },
      });
      assert.equal(res, false);
    });
  }

  it("rethrows other failures (5xx / network) so nothing is deleted yet", async () => {
    const err = Object.assign(new Error("Bad gateway"), { response: { code: 502 } });
    assert.equal(isNotInstalledError(err), false);
    await assert.rejects(
      probeShopStillInstalled({
        shop: "a.myshopify.com",
        findOfflineSession: async () => ({ id: "offline" }),
        runProbeQuery: async () => {
          throw err;
        },
      }),
      /Bad gateway/,
    );
  });
});
