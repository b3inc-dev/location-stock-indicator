import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { adminWritePlanBlock, getShopPlan } from "./shopPlan.server.js";
import { INHOUSE_CLIENT_ID, PUBLIC_CLIENT_ID } from "./planDistribution.js";

const KEYS = ["APP_DISTRIBUTION", "CUSTOM_APP_STORE_IDS", "SHOPIFY_API_KEY"];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function adminReturning(body, counter = { n: 0 }) {
  return {
    counter,
    graphql: async () => {
      counter.n += 1;
      return { json: async () => body };
    },
  };
}
const throwingAdmin = { graphql: async () => { throw new Error("network"); } };
const data = ({ subs, locations = 3, dev = false }) => ({
  data: {
    shop: { plan: { partnerDevelopment: dev } },
    locations: { nodes: Array.from({ length: locations }, (_, i) => ({ id: `gid://shopify/Location/${i}` })) },
    currentAppInstallation: { activeSubscriptions: subs },
  },
});

describe("getShopPlan (public, managed pricing)", () => {
  beforeEach(() => { process.env.SHOPIFY_API_KEY = PUBLIC_CLIENT_ID; });

  it("no subscription → plan null, planRequired, everything off", async () => {
    const p = await getShopPlan(adminReturning(data({ subs: [] })), "s.myshopify.com");
    assert.equal(p.distribution, "public");
    assert.equal(p.plan, null);
    assert.equal(p.planRequired, true);
    assert.equal(p.planCheckFailed, undefined);
    assert.equal(p.features.basicDisplay, false);
    assert.equal(p.features.analytics, false);
  });

  it("development store is decided by its (test) subscription, not given Pro for free", async () => {
    const none = await getShopPlan(adminReturning(data({ subs: [], dev: true })), "s.myshopify.com");
    assert.equal(none.plan, null);
    assert.equal(none.isDevelopmentStore, true);
    const lite = await getShopPlan(adminReturning(data({ subs: [{ name: "Lite", status: "ACTIVE" }], dev: true })), "s.myshopify.com");
    assert.equal(lite.plan, "lite");
    assert.equal(lite.features.basicDisplay, true);
    assert.equal(lite.features.areas, false);
  });

  it("Pro subscription → all features", async () => {
    const p = await getShopPlan(adminReturning(data({ subs: [{ name: "Pro", status: "ACTIVE" }], locations: 40 })), "s.myshopify.com");
    assert.equal(p.plan, "pro");
    assert.equal(Object.values(p.features).every(Boolean), true);
    assert.equal(p.locationPlanMismatch, undefined);
  });

  it("Lite with more than 10 locations → locationPlanMismatch", async () => {
    const p = await getShopPlan(adminReturning(data({ subs: [{ name: "Lite", status: "ACTIVE" }], locations: 11 })), "s.myshopify.com");
    assert.equal(p.locationPlanMismatch, true);
    assert.equal(p.maxLocationsForPlan, 10);
  });

  it("fails closed when the query throws or activeSubscriptions is missing", async () => {
    for (const admin of [
      throwingAdmin,
      adminReturning({ errors: [{ message: "Throttled" }] }),
      adminReturning({ data: { shop: { plan: { partnerDevelopment: false } }, locations: { nodes: [] } } }),
    ]) {
      const p = await getShopPlan(admin, "s.myshopify.com");
      assert.equal(p.plan, null);
      assert.equal(p.planCheckFailed, true);
      assert.equal(p.planRequired, undefined);
      assert.equal(p.features.basicDisplay, false);
    }
  });

  it("adminWritePlanBlock blocks saves for unpaid / unreadable shops and lets paying shops through", async () => {
    assert.equal((await adminWritePlanBlock(adminReturning(data({ subs: [] })), "s.myshopify.com")).planBlock, "plan_required");
    assert.equal((await adminWritePlanBlock(throwingAdmin, "s.myshopify.com")).planBlock, "plan_check_failed");
    assert.equal(await adminWritePlanBlock(adminReturning(data({ subs: [{ name: "Lite", status: "ACTIVE" }] })), "s.myshopify.com"), null);
  });
});

describe("getShopPlan (inhouse / Ciara unchanged)", () => {
  it("APP_DISTRIBUTION=inhouse → Pro, all features, even if the plan read fails", async () => {
    process.env.APP_DISTRIBUTION = "inhouse";
    const p = await getShopPlan(throwingAdmin, "ciara.myshopify.com");
    assert.equal(p.distribution, "inhouse");
    assert.equal(p.plan, "pro");
    assert.equal(Object.values(p.features).every(Boolean), true);
    assert.equal(p.planCheckFailed, undefined);
    assert.equal(p.planRequired, undefined);
  });

  it("keeps returning the location count for the home screen", async () => {
    process.env.SHOPIFY_API_KEY = INHOUSE_CLIENT_ID;
    const p = await getShopPlan(adminReturning(data({ subs: [], locations: 15 })), "ciara.myshopify.com");
    assert.equal(p.distribution, "inhouse");
    assert.equal(p.locationsCount, 15);
    assert.equal(p.locationPlanMismatch, undefined);
  });

  it("adminWritePlanBlock does not call GraphQL for inhouse", async () => {
    process.env.APP_DISTRIBUTION = "inhouse";
    const admin = adminReturning(data({ subs: [] }));
    assert.equal(await adminWritePlanBlock(admin, "ciara.myshopify.com"), null);
    assert.equal(admin.counter.n, 0);
  });
});
