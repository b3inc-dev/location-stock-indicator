import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPricingPlansUrl, createAppSubscription, shouldUseTestCharge } from "./billing.js";

function fakeAdmin() {
  const calls = [];
  return {
    calls,
    graphql: async (query, { variables }) => {
      calls.push({ query, variables });
      return {
        json: async () => ({
          data: { appSubscriptionCreate: { userErrors: [], confirmationUrl: "https://admin.shopify.com/confirm" } },
        }),
      };
    },
  };
}

describe("shouldUseTestCharge", () => {
  it("is true for development stores", () => {
    assert.equal(shouldUseTestCharge({ isDevelopmentStore: true }, {}), true);
  });
  it("is true when SHOPIFY_BILLING_TEST=1", () => {
    assert.equal(shouldUseTestCharge({ isDevelopmentStore: false }, { SHOPIFY_BILLING_TEST: "1" }), true);
  });
  it("is false for paid stores by default", () => {
    assert.equal(shouldUseTestCharge({ isDevelopmentStore: false }, {}), false);
    assert.equal(shouldUseTestCharge(null, {}), false);
  });
});

describe("buildPricingPlansUrl", () => {
  it("builds the admin pricing page URL", () => {
    assert.equal(
      buildPricingPlansUrl("demo.myshopify.com", "location-stock"),
      "https://admin.shopify.com/store/demo/charges/location-stock/pricing_plans",
    );
  });
  it("returns null when the app handle is unknown (no 'app' fallback)", () => {
    assert.equal(buildPricingPlansUrl("demo.myshopify.com", undefined), null);
    assert.equal(buildPricingPlansUrl("demo.myshopify.com", "  "), null);
    assert.equal(buildPricingPlansUrl("", "location-stock"), null);
  });
});

describe("createAppSubscription", () => {
  for (const plan of ["lite", "pro"]) {
    it(`passes test=true to appSubscriptionCreate for ${plan}`, async () => {
      const admin = fakeAdmin();
      const res = await createAppSubscription(admin, plan, "https://app.test/app/plan", { test: true });
      assert.equal(res.confirmationUrl, "https://admin.shopify.com/confirm");
      assert.equal(admin.calls[0].variables.test, true);
      assert.match(admin.calls[0].query, /test: \$test/);
    });

    it(`defaults to test=false for ${plan}`, async () => {
      const admin = fakeAdmin();
      await createAppSubscription(admin, plan, "https://app.test/app/plan");
      assert.equal(admin.calls[0].variables.test, false);
    });
  }
});
