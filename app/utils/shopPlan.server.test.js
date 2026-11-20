import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { getShopPlan } from "./shopPlan.server.js";

function fakeAdmin({ partnerDevelopment, locations, subscriptions }) {
  return {
    graphql: async () => ({
      json: async () => ({
        data: {
          shop: { plan: { partnerDevelopment } },
          locations: { nodes: Array.from({ length: locations }, (_, i) => ({ id: `gid://shopify/Location/${i}` })) },
          currentAppInstallation: { activeSubscriptions: subscriptions },
        },
      }),
    }),
  };
}

const liteSub = [{ id: "gid://shopify/AppSubscription/1", name: "Lite - 10 locations", status: "ACTIVE", lineItems: [] }];
const saved = { ...process.env };

afterEach(() => {
  for (const key of ["APP_DISTRIBUTION", "CUSTOM_APP_STORE_IDS", "FORCE_PLAN_LITE"]) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("getShopPlan location mismatch", () => {
  it("does not lock a development store that picked a test Lite plan with more than 10 locations", async () => {
    delete process.env.APP_DISTRIBUTION;
    delete process.env.FORCE_PLAN_LITE;
    const plan = await getShopPlan(fakeAdmin({ partnerDevelopment: true, locations: 12, subscriptions: liteSub }), "dev.myshopify.com");
    assert.equal(plan.plan, "lite");
    assert.equal(plan.isDevelopmentStore, true);
    assert.equal(plan.locationPlanMismatch, undefined);
    assert.equal(plan.features.areas, true);
  });

  it("still locks a paid store on Lite with more than 10 locations", async () => {
    delete process.env.APP_DISTRIBUTION;
    delete process.env.FORCE_PLAN_LITE;
    const plan = await getShopPlan(fakeAdmin({ partnerDevelopment: false, locations: 12, subscriptions: liteSub }), "paid.myshopify.com", { reportUsage: false });
    assert.equal(plan.plan, "lite");
    assert.equal(plan.locationPlanMismatch, true);
    assert.equal(plan.maxLocationsForPlan, 10);
  });

  it("keeps the lock on a development store when FORCE_PLAN_LITE=1 (Lite check mode)", async () => {
    delete process.env.APP_DISTRIBUTION;
    process.env.FORCE_PLAN_LITE = "1";
    const plan = await getShopPlan(fakeAdmin({ partnerDevelopment: true, locations: 12, subscriptions: [] }), "dev.myshopify.com");
    assert.equal(plan.locationPlanMismatch, true);
  });

  it("shows Pro on a development store without a subscription", async () => {
    delete process.env.APP_DISTRIBUTION;
    delete process.env.FORCE_PLAN_LITE;
    const plan = await getShopPlan(fakeAdmin({ partnerDevelopment: true, locations: 3, subscriptions: [] }), "dev.myshopify.com");
    assert.equal(plan.plan, "pro");
  });
});
