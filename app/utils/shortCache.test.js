import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cacheGet, cacheSet, cacheClear } from "./shortCache.js";

describe("shortCache", () => {
  it("stores and returns values before TTL", () => {
    cacheClear();
    cacheSet("k", { a: 1 }, 60_000);
    assert.deepEqual(cacheGet("k"), { a: 1 });
  });

  it("expires after TTL", async () => {
    cacheClear();
    cacheSet("exp", "x", 10);
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(cacheGet("exp"), undefined);
  });
});
