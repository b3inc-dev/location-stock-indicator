import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLocalDeliveryMethodName,
  getConnectionNodes,
  buildLocationDeliveryFlags,
} from "./deliveryProfiles.js";

describe("isLocalDeliveryMethodName", () => {
  it("detects local / 日本語 / same-day", () => {
    assert.equal(isLocalDeliveryMethodName("Local Delivery"), true);
    assert.equal(isLocalDeliveryMethodName("ローカルデリバリー"), true);
    assert.equal(isLocalDeliveryMethodName("Same Day"), true);
    assert.equal(isLocalDeliveryMethodName("標準配送"), false);
    assert.equal(isLocalDeliveryMethodName(""), false);
    assert.equal(isLocalDeliveryMethodName(null), false);
  });
});

describe("getConnectionNodes", () => {
  it("prefers nodes then edges", () => {
    assert.deepEqual(getConnectionNodes({ nodes: [{ id: "a" }] }), [{ id: "a" }]);
    assert.deepEqual(
      getConnectionNodes({ edges: [{ node: { id: "b" } }] }),
      [{ id: "b" }]
    );
    assert.deepEqual(getConnectionNodes(null), []);
  });
});

describe("buildLocationDeliveryFlags", () => {
  it("maps shipping and local flags per location", () => {
    const data = {
      deliveryProfiles: {
        nodes: [
          {
            profileLocationGroups: [
              {
                locationGroup: {
                  locations: { nodes: [{ id: "gid://shopify/Location/1" }] },
                },
                locationGroupZones: {
                  nodes: [
                    {
                      zone: { name: "Domestic" },
                      methodDefinitions: {
                        nodes: [
                          {
                            active: true,
                            name: "Standard",
                            rateProvider: { __typename: "DeliveryRateDefinition" },
                          },
                        ],
                      },
                    },
                    {
                      zone: { name: "Local Delivery" },
                      methodDefinitions: {
                        nodes: [
                          {
                            active: true,
                            name: "Local",
                            rateProvider: { __typename: "DeliveryRateDefinition" },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
    const map = buildLocationDeliveryFlags(data);
    const flags = map.get("gid://shopify/Location/1");
    assert.equal(flags.hasShipping, true);
    assert.equal(flags.hasLocalDelivery, true);
  });
});
