import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LOCATION_PLAN_MISMATCH_CODE,
  LOCATION_PLAN_MISMATCH_MESSAGE,
  isStorefrontLocationLimitExceeded,
} from "./storefrontLocationLimit.js";

describe("isStorefrontLocationLimitExceeded", () => {
  it("stops a public Lite shop over the location limit", () => {
    assert.equal(
      isStorefrontLocationLimitExceeded({ distribution: "public", plan: "lite", locationPlanMismatch: true, locationsCount: 11 }),
      true
    );
  });

  it("does not stop a public Lite shop within the limit or a Pro shop", () => {
    assert.equal(isStorefrontLocationLimitExceeded({ distribution: "public", plan: "lite", locationsCount: 10 }), false);
    assert.equal(isStorefrontLocationLimitExceeded({ distribution: "public", plan: "pro", locationsCount: 40 }), false);
  });

  it("never stops the in-house app, even if a mismatch flag is present", () => {
    assert.equal(isStorefrontLocationLimitExceeded({ distribution: "inhouse", plan: "pro", locationPlanMismatch: true }), false);
  });

  it("does not decide anything without a plan (the plan gate handles that)", () => {
    assert.equal(isStorefrontLocationLimitExceeded(null), false);
    assert.equal(isStorefrontLocationLimitExceeded(undefined), false);
  });

  it("uses a stable code and a customer-facing message without technical words", () => {
    assert.equal(LOCATION_PLAN_MISMATCH_CODE, "location_plan_mismatch");
    assert.match(LOCATION_PLAN_MISMATCH_MESSAGE, /Pro/);
    assert.doesNotMatch(LOCATION_PLAN_MISMATCH_MESSAGE, /API|GraphQL|token/i);
  });
});
