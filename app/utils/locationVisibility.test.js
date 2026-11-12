import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStoreVisibility,
  classifyLocationVisibility,
  describeDistributionEditing,
  filterLocationRows,
} from "./locationVisibility.js";

describe("classifyLocationVisibility", () => {
  it("hides when the display toggle is off, before mode filters", () => {
    assert.equal(
      classifyLocationVisibility({
        enabled: false,
        fromConfig: true,
        fulfillsOnlineOrders: true,
        locationsMode: "all",
      }),
      "hidden"
    );
    assert.equal(
      classifyLocationVisibility({
        enabled: false,
        fromConfig: false,
        fulfillsOnlineOrders: false,
        locationsMode: "online_only",
      }),
      "hidden"
    );
  });

  it("keeps enabled locations in all mode", () => {
    assert.equal(
      classifyLocationVisibility({
        enabled: true,
        fromConfig: false,
        fulfillsOnlineOrders: false,
        locationsMode: "all",
      }),
      "shown"
    );
  });

  it("marks non-fulfilling locations as excluded in online_only", () => {
    assert.equal(
      classifyLocationVisibility({
        enabled: true,
        fromConfig: true,
        fulfillsOnlineOrders: false,
        locationsMode: "online_only",
      }),
      "excluded_by_mode"
    );
    assert.equal(
      classifyLocationVisibility({
        enabled: true,
        fromConfig: true,
        fulfillsOnlineOrders: true,
        locationsMode: "online_only",
      }),
      "shown"
    );
  });

  it("marks unsaved locations as excluded in custom_from_app", () => {
    assert.equal(
      classifyLocationVisibility({
        enabled: true,
        fromConfig: false,
        fulfillsOnlineOrders: true,
        locationsMode: "custom_from_app",
      }),
      "excluded_by_mode"
    );
    assert.equal(
      classifyLocationVisibility({
        enabled: true,
        fromConfig: true,
        fulfillsOnlineOrders: false,
        locationsMode: "custom_from_app",
      }),
      "shown"
    );
  });
});

describe("buildStoreVisibility", () => {
  it("pairs each store with saved display state and public name", () => {
    const result = buildStoreVisibility(
      [
        { id: "gid://a", name: "渋谷店", fulfillsOnlineOrders: true },
        { id: "gid://b", name: "倉庫", fulfillsOnlineOrders: false },
      ],
      {
        locationsMode: "online_only",
        usePublicName: true,
        locations: [
          { locationId: "gid://a", enabled: true, publicName: "渋谷" },
          { locationId: "gid://b", enabled: true, publicName: "物流倉庫" },
        ],
      }
    );
    assert.equal(result.locationsMode, "online_only");
    assert.equal(result.items[0].state, "shown");
    assert.equal(result.items[0].publicName, "渋谷");
    assert.equal(result.items[1].state, "excluded_by_mode");
    assert.equal(result.items[1].name, "倉庫");
  });
});

describe("filterLocationRows", () => {
  const rows = [
    { locationId: "1", shopifyName: "渋谷店", publicName: "Shibuya", enabled: true, fromConfig: true, fulfillsOnlineOrders: true },
    { locationId: "2", shopifyName: "倉庫", publicName: "", enabled: false, fromConfig: true, fulfillsOnlineOrders: false },
    { locationId: "3", shopifyName: "新宿店", publicName: "新宿", enabled: true, fromConfig: false, fulfillsOnlineOrders: true },
  ];

  it("filters by name without dropping the other rows from the source set", () => {
    const { counts, visible } = filterLocationRows(rows, {
      query: "しぶや",
      filter: "all",
      locationsMode: "custom_from_app",
    });
    assert.equal(counts.all, 0);
    assert.equal(visible.length, 0);
    const found = filterLocationRows(rows, { query: "渋谷", locationsMode: "all" });
    assert.equal(found.counts.shown, 1);
    assert.equal(found.visible[0].row.locationId, "1");
  });

  it("splits shown, hidden, and mode-excluded stores", () => {
    const { counts, visible } = filterLocationRows(rows, {
      filter: "excluded_by_mode",
      locationsMode: "custom_from_app",
    });
    assert.deepEqual(counts, { all: 3, shown: 1, hidden: 1, excluded_by_mode: 1 });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].row.shopifyName, "新宿店");
  });
});

describe("describeDistributionEditing", () => {
  it("keeps inhouse and development stores editable", () => {
    assert.match(describeDistributionEditing({ distribution: "inhouse", plan: null }), /自社版/);
    assert.match(
      describeDistributionEditing({ distribution: "public", plan: "lite", isDevelopmentStore: true }),
      /開発ストア/
    );
    assert.match(describeDistributionEditing({ distribution: "public", plan: "lite" }), /Lite/);
    assert.match(describeDistributionEditing({ distribution: "public", plan: "pro" }), /Pro/);
  });
});
