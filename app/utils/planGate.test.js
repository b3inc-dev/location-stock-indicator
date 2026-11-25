import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adminWriteBlockReason,
  isProFeaturesAllowed,
  isStorefrontInventoryAllowed,
  requiresPlanSelection,
} from "./planGate.js";

const pub = (extra) => ({ distribution: "public", plan: null, ...extra });

describe("planGate", () => {
  it("allows everything for inhouse, even if the plan read failed", () => {
    const s = { distribution: "inhouse", plan: "pro", planCheckFailed: true };
    assert.equal(isStorefrontInventoryAllowed(s), true);
    assert.equal(isProFeaturesAllowed(s), true);
    assert.equal(requiresPlanSelection(s), false);
    assert.equal(adminWriteBlockReason(s), null);
  });
  it("blocks a public shop without a plan (no free tier), including development stores", () => {
    for (const s of [pub(), pub({ isDevelopmentStore: true })]) {
      assert.equal(isStorefrontInventoryAllowed(s), false);
      assert.equal(isProFeaturesAllowed(s), false);
      assert.equal(requiresPlanSelection(s), true);
      assert.equal(adminWriteBlockReason(s), "plan_required");
    }
  });
  it("Lite: storefront yes, Pro features no", () => {
    const s = pub({ plan: "lite" });
    assert.equal(isStorefrontInventoryAllowed(s), true);
    assert.equal(isProFeaturesAllowed(s), false);
    assert.equal(adminWriteBlockReason(s), null);
    assert.equal(adminWriteBlockReason({ ...s, locationPlanMismatch: true }), "location_plan_mismatch");
  });
  it("Pro: everything", () => {
    const s = pub({ plan: "pro" });
    assert.equal(isStorefrontInventoryAllowed(s), true);
    assert.equal(isProFeaturesAllowed(s), true);
  });
  it("fails closed when the plan could not be read, without calling it 'plan required'", () => {
    const s = pub({ planCheckFailed: true });
    assert.equal(isStorefrontInventoryAllowed(s), false);
    assert.equal(isProFeaturesAllowed(s), false);
    assert.equal(requiresPlanSelection(s), false);
    assert.equal(adminWriteBlockReason(s), "plan_check_failed");
    assert.equal(adminWriteBlockReason(null), "plan_check_failed");
    assert.equal(isStorefrontInventoryAllowed(null), false);
  });
});
