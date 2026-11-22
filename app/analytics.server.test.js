import assert from "node:assert/strict";
import test from "node:test";
import {
  recordAnalyticsEvent,
  getAnalyticsDailyData,
  incrementDay,
  MAX_DAY_BYTES,
  SIZE_LIMIT_REASON,
} from "./analytics.server.js";

const date = "2026-01-15";
const dayKey = "analytics_2026_01_15";

function internalError() {
  class GraphqlQueryError extends Error {}
  return new GraphqlQueryError("Internal error. Fixture");
}

// キーごとのメタフィールドを持つ、Admin GraphQL の小さなまね
function fixture({ beforeWrite, initial = {} } = {}) {
  const fields = structuredClone(initial); // { [key]: { value, compareDigest } }
  let writes = 0;
  const writtenKeys = [];
  const client = {
    async graphql(query, { variables }) {
      if (!query.includes("mutation")) {
        if (query.includes("AnalyticsMetafields(")) {
          const shop = {};
          for (const [alias, key] of Object.entries(variables)) shop[alias] = structuredClone(fields[key] ?? null);
          return { json: async () => ({ data: { shop } }) };
        }
        const snapshot = structuredClone(fields[variables.key] ?? null);
        return { json: async () => ({ data: { shop: { metafield: snapshot } } }) };
      }
      const update = variables.metafields[0];
      writtenKeys.push(update.key);
      const commit = () => { fields[update.key] = { value: update.value, compareDigest: "digest-" + writes }; };
      writes++;
      if (beforeWrite) await beforeWrite(writes, commit);
      const result = update.compareDigest !== (fields[update.key]?.compareDigest ?? null)
        ? { userErrors: [{ code: "STALE_OBJECT" }] }
        : (commit(), { metafields: [{ id: "fixture" }], userErrors: [] });
      return { json: async () => ({ data: { metafieldsSet: result } }) };
    },
  };
  return {
    client,
    record: (type = "area_display", payload = {}, d = date) => recordAnalyticsEvent(client, "fixture", d, type, payload),
    day: (key = dayKey) => JSON.parse(fields[key].value),
    writes: () => writes,
    writtenKeys: () => writtenKeys,
    fields,
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

test("two events on one day both survive a digest conflict", async () => {
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

test("invalid existing day never becomes an empty write", async () => {
  const f = fixture({ initial: { [dayKey]: { value: "{", compareDigest: "existing" } } });
  await assert.rejects(f.record());
  assert.equal(f.writes(), 0);
});

test("writes go to the per-day key, never the old month key", async () => {
  const f = fixture();
  await f.record("order_pick_click", { locationId: "gid://shopify/Location/1" });
  assert.deepEqual(f.writtenKeys(), [dayKey]);
  assert.equal(f.fields.analytics_2026_01, undefined);
  assert.equal(f.day().orderPickByLocation["gid://shopify/Location/1"], 1);
});

test("one day stays under 128KB even with many locations", async () => {
  const f = fixture();
  const ids = Array.from({ length: 300 }, (_, i) => `gid://shopify/Location/${100000000000 + i}`);
  for (let i = 0; i < 5; i++) await f.record("nearby_click", { locationIds: ids });
  for (const id of ids) await f.record("order_pick_click", { locationId: id });
  const bytes = Buffer.byteLength(f.fields[dayKey].value, "utf8");
  assert.ok(bytes < 128 * 1024, `day is ${bytes} bytes`);
  assert.equal(f.day().nearbyDisplayByLocation[ids[0]], 5);
  assert.equal(f.day().sizeLimitSkipped, undefined);
});

test("over the limit: totals still count, skipped location counts are recorded with a reason", () => {
  const big = {};
  // 上限の少し手前（あと 50 バイト）まで埋める
  let bytes = 2;
  for (let i = 0; bytes < MAX_DAY_BYTES - 50; i++) {
    const id = `gid://shopify/Location/${100000000000 + i}`;
    big[id] = 1;
    bytes += JSON.stringify(id).length + 3;
  }
  assert.ok(Buffer.byteLength(JSON.stringify(big)) < MAX_DAY_BYTES);
  const before = { nearbyClickCount: 3, nearbyDisplayByLocation: big };
  const next = incrementDay(before, "nearby_click", { locationIds: ["gid://shopify/Location/new-1", "gid://shopify/Location/new-2"] }, "e1");
  assert.equal(next.nearbyClickCount, 4);
  assert.equal(next.nearbyDisplayByLocation["gid://shopify/Location/new-1"], undefined);
  assert.equal(next.sizeLimitSkipped.count, 2);
  assert.equal(next.sizeLimitSkipped.reason, SIZE_LIMIT_REASON);
  assert.ok(Buffer.byteLength(JSON.stringify(next)) < 128 * 1024);
  // 次のイベントでも件数は消えずに増える
  const after = incrementDay(next, "order_pick_click", { locationId: "gid://shopify/Location/new-3" }, "e2");
  assert.equal(after.sizeLimitSkipped.count, 3);
  assert.equal(after.orderPickClickCount, 1);
  // 合計だけのイベントでは件数を残したまま
  const area = incrementDay(after, "area_display", {}, "e3");
  assert.equal(area.sizeLimitSkipped.count, 3);
  assert.equal(area.areaDisplayCount, 1);
});

test("reads the old month shape and the new day shape, and adds the same day", async () => {
  const L1 = "gid://shopify/Location/1";
  const f = fixture({
    initial: {
      analytics_2026_01: {
        value: JSON.stringify({
          "2026-01-14": { areaDisplayCount: 2, nearbyDisplayByLocation: { [L1]: 1 } },
          "2026-01-15": { areaDisplayCount: 5, orderPickClickCount: 1, orderPickByLocation: { [L1]: 1 } },
          "2025-12-31": { areaDisplayCount: 9 },
        }),
        compareDigest: "m",
      },
      analytics_2026_01_15: {
        value: JSON.stringify({ areaDisplayCount: 1, orderPickClickCount: 2, orderPickByLocation: { [L1]: 2 }, sizeLimitSkipped: { count: 4, reason: "size_limit" } }),
        compareDigest: "d",
      },
      analytics_2026_02_01: { value: JSON.stringify({ nearbyClickCount: 1 }), compareDigest: "d2" },
      analytics_2026_01_20: { value: "{", compareDigest: "broken" },
    },
  });
  const rows = await getAnalyticsDailyData(f.client, "fixture", "2026-01-14", "2026-02-01");
  assert.deepEqual(rows.map((r) => r.date), ["2026-01-14", "2026-01-15", "2026-02-01"]);
  const d15 = rows[1];
  assert.equal(d15.areaDisplayCount, 6);
  assert.equal(d15.orderPickClickCount, 3);
  assert.equal(d15.orderPickByLocation[L1], 3);
  assert.equal(d15.sizeLimitSkippedCount, 4);
  assert.equal(rows[0].nearbyDisplayByLocation[L1], 1);
  assert.equal(rows[0].sizeLimitSkippedCount, 0);
  assert.equal(rows[2].nearbyClickCount, 1);
});

test("a 90-day range is read in a few batched queries", async () => {
  const f = fixture();
  let reads = 0;
  const client = { graphql: async (q, o) => { reads++; return f.client.graphql(q, o); } };
  const rows = await getAnalyticsDailyData(client, "fixture", "2026-01-01", "2026-03-31");
  assert.deepEqual(rows, []);
  assert.ok(reads <= 2, `reads=${reads}`);
});
