import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEmbeddedReturnUrl, buildPricingPlansUrl, createAppSubscription, shouldUseTestCharge } from "./billing.js";

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
  it("is true when SHOPIFY_BILLING_TEST=1 outside production", () => {
    assert.equal(shouldUseTestCharge({ isDevelopmentStore: false }, { SHOPIFY_BILLING_TEST: "1" }), true);
    assert.equal(
      shouldUseTestCharge({ isDevelopmentStore: false }, { SHOPIFY_BILLING_TEST: "1", NODE_ENV: "development" }),
      true,
    );
  });
  it("ignores SHOPIFY_BILLING_TEST=1 in production and warns loudly", () => {
    const warnings = [];
    const res = shouldUseTestCharge(
      { isDevelopmentStore: false },
      { SHOPIFY_BILLING_TEST: "1", NODE_ENV: "production" },
      (msg) => warnings.push(msg),
    );
    assert.equal(res, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /SHOPIFY_BILLING_TEST=1 is set in production/);
  });
  it("still uses test charges for development stores in production", () => {
    assert.equal(shouldUseTestCharge({ isDevelopmentStore: true }, { NODE_ENV: "production" }), true);
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

describe("buildEmbeddedReturnUrl", () => {
  it("returns the embedded admin URL with the client id (library default form)", () => {
    assert.equal(
      buildEmbeddedReturnUrl("demo.myshopify.com", "abc123", "/app/plan"),
      "https://admin.shopify.com/store/demo/apps/abc123/app/plan",
    );
    assert.equal(
      buildEmbeddedReturnUrl("demo.myshopify.com", "abc123", "app/plan"),
      "https://admin.shopify.com/store/demo/apps/abc123/app/plan",
    );
  });
  it("returns null when the API key or shop is missing", () => {
    assert.equal(buildEmbeddedReturnUrl("demo.myshopify.com", ""), null);
    assert.equal(buildEmbeddedReturnUrl("", "abc123"), null);
  });
});
