import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildManagedPricingPlansUrl,
  getMaxLocationsForPlan,
  getPlanFromActiveSubscriptions,
  getPublicAppHandle,
} from "./billing.js";

describe("getPublicAppHandle", () => {
  it("uses SHOPIFY_APP_HANDLE and never falls back to a guessed handle", () => {
    assert.equal(getPublicAppHandle({ SHOPIFY_APP_HANDLE: " location-stock " }), "location-stock");
    assert.equal(getPublicAppHandle({}), null);
    assert.equal(getPublicAppHandle({ SHOPIFY_APP_HANDLE: "  " }), null);
  });
});

describe("buildManagedPricingPlansUrl", () => {
  const env = { SHOPIFY_APP_HANDLE: "location-stock" };
  it("builds the admin.shopify.com pricing_plans URL", () => {
    assert.equal(
      buildManagedPricingPlansUrl("My-Store.myshopify.com", env),
      "https://admin.shopify.com/store/my-store/charges/location-stock/pricing_plans"
    );
    assert.equal(
      buildManagedPricingPlansUrl("https://my-store.myshopify.com/", env),
      "https://admin.shopify.com/store/my-store/charges/location-stock/pricing_plans"
    );
  });
  it("returns null when the shop or the handle is unknown", () => {
    assert.equal(buildManagedPricingPlansUrl("my-store.myshopify.com", {}), null);
    assert.equal(buildManagedPricingPlansUrl("", env), null);
    assert.equal(buildManagedPricingPlansUrl(null, env), null);
    assert.equal(buildManagedPricingPlansUrl("shop.example.com", env), null);
    assert.equal(buildManagedPricingPlansUrl("admin", env), null);
  });
});

describe("getPlanFromActiveSubscriptions", () => {
  it("returns null without an active subscription", () => {
    assert.equal(getPlanFromActiveSubscriptions([]), null);
    assert.equal(getPlanFromActiveSubscriptions(null), null);
    assert.equal(getPlanFromActiveSubscriptions([{ name: "Pro", status: "CANCELLED" }]), null);
  });
  it("reads Lite / Pro from the plan name and prefers Pro", () => {
    assert.equal(getPlanFromActiveSubscriptions([{ name: "Lite", status: "ACTIVE" }]), "lite");
    assert.equal(getPlanFromActiveSubscriptions([{ name: "Pro plan", status: "active" }]), "pro");
    assert.equal(
      getPlanFromActiveSubscriptions([
        { name: "Lite", status: "ACTIVE" },
        { name: "Pro", status: "ACTIVE" },
      ]),
      "pro"
    );
  });
  it("treats an active subscription with an unknown name as lite (do not lock out a paying shop)", () => {
    assert.equal(getPlanFromActiveSubscriptions([{ name: "Standard", status: "ACTIVE" }]), "lite");
  });
});

describe("getMaxLocationsForPlan", () => {
  it("limits Lite to 10 and Pro to none", () => {
    assert.equal(getMaxLocationsForPlan("lite"), 10);
    assert.equal(getMaxLocationsForPlan("pro"), null);
    assert.equal(getMaxLocationsForPlan(null), null);
  });
});
