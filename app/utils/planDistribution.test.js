import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INHOUSE_CLIENT_ID, PUBLIC_CLIENT_ID, resolvePlanDistribution } from "./planDistribution.js";

describe("resolvePlanDistribution", () => {
  it("treats the Ciara client_id as inhouse regardless of other values", () => {
    assert.equal(
      resolvePlanDistribution({ SHOPIFY_API_KEY: INHOUSE_CLIENT_ID, APP_DISTRIBUTION: "public" }, "x.myshopify.com").distribution,
      "inhouse"
    );
  });
  it("keeps APP_DISTRIBUTION=inhouse and CUSTOM_APP_STORE_IDS as inhouse (unchanged)", () => {
    assert.equal(resolvePlanDistribution({ APP_DISTRIBUTION: "inhouse" }, "x.myshopify.com").distribution, "inhouse");
    assert.equal(resolvePlanDistribution({ APP_DISTRIBUTION: " InHouse " }, null).distribution, "inhouse");
    const r = resolvePlanDistribution(
      { SHOPIFY_API_KEY: PUBLIC_CLIENT_ID, CUSTOM_APP_STORE_IDS: "a.myshopify.com, B.myshopify.com" },
      "b.myshopify.com"
    );
    assert.equal(r.distribution, "inhouse");
    assert.equal(r.forceInhouse, true);
  });
  it("treats the public client_id / APP_DISTRIBUTION=public as public", () => {
    assert.equal(resolvePlanDistribution({ SHOPIFY_API_KEY: PUBLIC_CLIENT_ID }, "x.myshopify.com").distribution, "public");
    assert.equal(resolvePlanDistribution({ APP_DISTRIBUTION: "public" }, "x.myshopify.com").distribution, "public");
  });
  it("treats an api key that is clearly not the public app as inhouse", () => {
    assert.equal(resolvePlanDistribution({ SHOPIFY_API_KEY: "someotherkey" }, "x.myshopify.com").distribution, "inhouse");
  });
  it("defaults to public when nothing is known (plan gate applies)", () => {
    assert.equal(resolvePlanDistribution({}, "x.myshopify.com").distribution, "public");
  });
});
