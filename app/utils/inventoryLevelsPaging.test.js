import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  INVENTORY_LEVELS_PAGE_QUERY,
  MAX_INVENTORY_LEVEL_PAGES,
  collectInventoryLevelEdges,
} from "./inventoryLevelsPaging.js";

const edge = (n) => ({ node: { id: `level-${n}`, location: { id: `loc-${n}` } } });
const page = (from, count, hasNextPage, endCursor = hasNextPage ? `c${from + count}` : null) => ({
  edges: Array.from({ length: count }, (_, i) => edge(from + i)),
  pageInfo: { hasNextPage, endCursor },
});

describe("collectInventoryLevelEdges", () => {
  it("returns the first page as is when there is no next page (no extra request)", async () => {
    const calls = [];
    const result = await collectInventoryLevelEdges(page(0, 3, false), async (after) => {
      calls.push(after);
      return { ok: true, connection: page(0, 0, false) };
    });
    assert.equal(result.ok, true);
    assert.equal(result.edges.length, 3);
    assert.equal(result.truncated, false);
    assert.equal(result.pages, 1);
    assert.deepEqual(calls, []);
  });

  it("reads following pages with the cursor and keeps every location (251+ locations)", async () => {
    const calls = [];
    const pages = { c250: page(250, 250, true), c500: page(500, 10, false) };
    const result = await collectInventoryLevelEdges(page(0, 250, true), async (after) => {
      calls.push(after);
      return { ok: true, connection: pages[after] };
    });
    assert.equal(result.ok, true);
    assert.equal(result.edges.length, 510);
    assert.equal(new Set(result.edges.map((e) => e.node.location.id)).size, 510);
    assert.equal(result.truncated, false);
    assert.equal(result.pages, 3);
    assert.deepEqual(calls, ["c250", "c500"]);
  });

  it("stops at the page limit and says it was truncated instead of dropping silently", async () => {
    let n = 250;
    const result = await collectInventoryLevelEdges(page(0, 250, true), async () => {
      const p = page(n, 250, true);
      n += 250;
      return { ok: true, connection: p };
    });
    assert.equal(result.ok, true);
    assert.equal(result.truncated, true);
    assert.equal(result.pages, MAX_INVENTORY_LEVEL_PAGES);
    assert.equal(result.edges.length, MAX_INVENTORY_LEVEL_PAGES * 250);
  });

  it("fails the whole read when a following page fails (no partial list)", async () => {
    const result = await collectInventoryLevelEdges(page(0, 250, true), async () => ({
      ok: false,
      reason: "graphql_error",
      detail: [{ message: "Throttled" }],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "graphql_error");
    assert.equal(result.pages, 2);
    assert.equal("edges" in result, false);
  });

  it("fails when the API says there is a next page but gives no cursor", async () => {
    const result = await collectInventoryLevelEdges(
      { edges: [edge(0)], pageInfo: { hasNextPage: true, endCursor: null } },
      async () => assert.fail("must not request without a cursor")
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "missing_cursor");
  });

  it("treats a missing connection on the first page as an empty list", async () => {
    const result = await collectInventoryLevelEdges(undefined, async () => assert.fail("no request"));
    assert.deepEqual(result, { ok: true, edges: [], pages: 1, truncated: false });
  });

  it("asks for the same location fields as the first-page query plus pageInfo", () => {
    for (const field of ["after: $after", "hasNextPage", "endCursor", "fulfillsOnlineOrders", "localPickupSettingsV2", "latitude", 'quantities(names: "available")']) {
      assert.ok(INVENTORY_LEVELS_PAGE_QUERY.includes(field), field);
    }
  });
});
