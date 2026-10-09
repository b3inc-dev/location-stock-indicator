import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isLocalDeliveryMethodName,
  getConnectionNodes,
  buildLocationDeliveryFlags,
  buildLocationDeliveryFlagsFromMarkets,
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

describe("buildLocationDeliveryFlagsFromMarkets", () => {
  it("maps shipping and local flags from Market.delivery", () => {
    const data = {
      markets: {
        nodes: [
          {
            id: "gid://shopify/Market/1",
            delivery: {
              shipping: {
                isEnabled: true,
                optionDefinitions: {
                  nodes: [
                    {
                      __typename: "DeliveryFlatRateOptionDefinition",
                      name: "Standard",
                      isActive: true,
                      description: null,
                      includedLocations: {
                        nodes: [{ id: "gid://shopify/Location/1" }],
                      },
                    },
                    {
                      __typename: "DeliveryFlatRateOptionDefinition",
                      name: "Local Delivery",
                      isActive: true,
                      description: null,
                      includedLocations: {
                        nodes: [{ id: "gid://shopify/Location/2" }],
                      },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    };
    const map = buildLocationDeliveryFlagsFromMarkets(data);
    assert.equal(map.get("gid://shopify/Location/1").hasShipping, true);
    assert.equal(map.get("gid://shopify/Location/1").hasLocalDelivery, false);
    assert.equal(map.get("gid://shopify/Location/2").hasShipping, true);
    assert.equal(map.get("gid://shopify/Location/2").hasLocalDelivery, true);
  });

  it("applies empty includedLocations to allLocationIds", () => {
    const data = {
      markets: {
        nodes: [
          {
            id: "gid://shopify/Market/1",
            delivery: {
              shipping: {
                isEnabled: true,
                optionDefinitions: {
                  nodes: [
                    {
                      __typename: "DeliveryFlatRateOptionDefinition",
                      name: "Nationwide",
                      isActive: true,
                      includedLocations: { nodes: [] },
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    };
    const map = buildLocationDeliveryFlagsFromMarkets(data, {
      allLocationIds: [
        "gid://shopify/Location/10",
        "gid://shopify/Location/11",
      ],
    });
    assert.equal(map.get("gid://shopify/Location/10").hasShipping, true);
    assert.equal(map.get("gid://shopify/Location/11").hasShipping, true);
  });
});
