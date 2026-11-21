import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPlanPageNotice } from "./planNotice.js";

const base = {
  plan: null,
  planCheckFailed: false,
  pricingPlansUrl: "https://admin.shopify.com/store/s/charges/h/pricing_plans",
  locationPlanMismatch: false,
  maxLocationsForPlan: undefined,
  locationsCount: 3,
  isDevelopmentStore: false,
};

describe("buildPlanPageNotice (one notice: failure > warning > info)", () => {
  it("shows the read failure first", () => {
    const n = buildPlanPageNotice({ ...base, planCheckFailed: true, pricingPlansUrl: null });
    assert.equal(n.tone, "critical");
    assert.match(n.heading, /確認できませんでした/);
  });
  it("shows a missing pricing URL as a failure", () => {
    assert.match(buildPlanPageNotice({ ...base, pricingPlansUrl: null }).heading, /開けません/);
  });
  it("shows the location mismatch before 'plan required'", () => {
    const n = buildPlanPageNotice({ ...base, plan: "lite", locationPlanMismatch: true, maxLocationsForPlan: 10, locationsCount: 12 });
    assert.equal(n.tone, "warning");
    assert.match(n.body, /12/);
  });
  it("asks to choose a plan when there is none", () => {
    assert.match(buildPlanPageNotice(base).heading, /契約が必要/);
    assert.match(buildPlanPageNotice({ ...base, isDevelopmentStore: true }).body, /テスト課金/);
  });
  it("shows the dev-store info only when nothing else applies", () => {
    assert.equal(buildPlanPageNotice({ ...base, plan: "pro", isDevelopmentStore: true }).tone, "info");
    assert.equal(buildPlanPageNotice({ ...base, plan: "pro" }), null);
  });
});
