import assert from "node:assert/strict";
import test from "node:test";
import { recordAnalyticsEvent } from "./analytics.server.js";

const date = "2026-01-15";
function internalError() {
  class GraphqlQueryError extends Error {}
  return new GraphqlQueryError("Internal error. Fixture");
}

function fixture({ beforeWrite, initial } = {}) {
  let field = initial ?? null;
  let writes = 0;
  const client = {
    async graphql(query, { variables }) {
      if (!query.includes("mutation")) {
        const snapshot = structuredClone(field);
        return { json: async () => ({ data: { shop: { metafield: snapshot } } }) };
      }
      const update = variables.metafields[0];
      const commit = () => { field = { value: update.value, compareDigest: "digest-" + writes }; };
      writes++;
      if (beforeWrite) await beforeWrite(writes, commit);
      const result = update.compareDigest !== (field?.compareDigest ?? null)
        ? { userErrors: [{ code: "STALE_OBJECT" }] }
        : (commit(), { metafields: [{ id: "fixture" }], userErrors: [] });
      return { json: async () => ({ data: { metafieldsSet: result } }) };
    },
  };
  return {
    record: (type = "area_display") => recordAnalyticsEvent(client, "fixture", date, type),
    day: () => JSON.parse(field.value)[date],
    writes: () => writes,
  };
}

for (const committed of [false, true]) {
  test("internal error with committed=" + committed, async () => {
    const f = fixture({ beforeWrite(n, commit) {
      if (n === 1) { if (committed) commit(); throw internalError(); }
    } });
    await f.record();
    assert.equal(f.day().areaDisplayCount, 1);
    assert.equal(f.writes(), committed ? 1 : 2);
  });
}

test("two events on one month both survive a digest conflict", async () => {
  const f = fixture();
  await Promise.all([f.record(), f.record("nearby_click")]);
  assert.equal(f.day().areaDisplayCount, 1);
  assert.equal(f.day().nearbyClickCount, 1);
});

test("repeated upstream failure is bounded", async () => {
  const f = fixture({ beforeWrite() { throw internalError(); } });
  await assert.rejects(f.record(), /Internal error/);
  assert.equal(f.writes(), 2);
});

test("invalid existing month never becomes an empty write", async () => {
  const f = fixture({ initial: { value: "{", compareDigest: "existing" } });
  await assert.rejects(f.record());
  assert.equal(f.writes(), 0);
});
