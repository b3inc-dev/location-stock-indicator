import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FALLBACK_TIME_ZONE,
  MAX_LOCATION_IDS_PER_EVENT,
  REJECT_REASONS,
  allowedDateRange,
  dateInTimeZone,
  filterLocationIds,
  isDateAllowed,
  isDatePossiblyAllowed,
  isRealDate,
  loadAnalyticsShopContext,
  logAnalyticsRejections,
  rejectedTotal,
  splitLocationIdsParam,
  validateAnalyticsEvent,
} from "./analyticsInput.js";

const L1 = "gid://shopify/Location/1";
const L2 = "gid://shopify/Location/2";
const L9 = "gid://shopify/Location/9";
const known = new Set([L1, L2]);
// 2026-11-23 15:30 UTC = 2026-11-24 00:30 JST
const NOW = new Date("2026-11-23T15:30:00Z");

describe("dates", () => {
  it("uses the shop time zone for today", () => {
    assert.equal(dateInTimeZone(NOW, "Asia/Tokyo"), "2026-11-24");
    assert.equal(dateInTimeZone(NOW, "America/Los_Angeles"), "2026-11-23");
  });

  it("falls back to Asia/Tokyo when the time zone is missing or invalid", () => {
    assert.equal(FALLBACK_TIME_ZONE, "Asia/Tokyo");
    assert.equal(dateInTimeZone(NOW, null), "2026-11-24");
    assert.equal(dateInTimeZone(NOW, "Not/AZone"), "2026-11-24");
  });

  it("allows today ±1 day only", () => {
    assert.deepEqual(allowedDateRange(NOW, "Asia/Tokyo"), {
      min: "2026-11-23",
      max: "2026-11-25",
      today: "2026-11-24",
    });
    assert.equal(isDateAllowed("2026-11-23", NOW, "Asia/Tokyo"), true);
    assert.equal(isDateAllowed("2026-11-25", NOW, "Asia/Tokyo"), true);
    assert.equal(isDateAllowed("2026-11-22", NOW, "Asia/Tokyo"), false);
    assert.equal(isDateAllowed("2026-11-26", NOW, "Asia/Tokyo"), false);
    assert.equal(isDateAllowed("2020-01-01", NOW, "Asia/Tokyo"), false);
  });

  it("rejects dates that do not exist, even inside the range by string order", () => {
    const now = new Date("2026-12-01T03:00:00Z"); // JST 2026-12-01 → 11-30〜12-02
    assert.equal(isRealDate("2026-11-31"), false);
    assert.equal(isDateAllowed("2026-11-31", now, "Asia/Tokyo"), false);
    assert.equal(isDateAllowed("2026-11-30", now, "Asia/Tokyo"), true);
  });

  it("handles month and year boundaries", () => {
    const now = new Date("2026-12-31T16:00:00Z"); // JST 2027-01-01
    assert.deepEqual(allowedDateRange(now, "Asia/Tokyo"), {
      min: "2026-12-31",
      max: "2027-01-02",
      today: "2027-01-01",
    });
  });

  it("pre-check without API covers every time zone (UTC ±2 days)", () => {
    assert.equal(isDatePossiblyAllowed("2026-11-21", NOW), true);
    assert.equal(isDatePossiblyAllowed("2026-11-25", NOW), true);
    assert.equal(isDatePossiblyAllowed("2026-11-20", NOW), false);
    assert.equal(isDatePossiblyAllowed("2026-11-26", NOW), false);
    assert.equal(isDatePossiblyAllowed("bad", NOW), false);
    // どのタイムゾーンでも、今日 ±1 日は下見を通る
    for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12", "Asia/Tokyo", "UTC"]) {
      const { min, max } = allowedDateRange(NOW, tz);
      assert.equal(isDatePossiblyAllowed(min, NOW), true, tz);
      assert.equal(isDatePossiblyAllowed(max, NOW), true, tz);
    }
  });
});

describe("filterLocationIds", () => {
  it("keeps only the shop's locations and counts the rest by reason", () => {
    const r = filterLocationIds([L1, L9, "123", L1, "", 5, L2], known);
    assert.deepEqual(r.accepted, [L1, L2]);
    assert.deepEqual(r.rejected, {
      [REJECT_REASONS.notInShop]: 1,
      [REJECT_REASONS.badFormat]: 2,
      [REJECT_REASONS.duplicate]: 1,
    });
  });

  it("caps the number per request", () => {
    const many = Array.from({ length: 5 }, (_, i) => `gid://shopify/Location/${i + 1}`);
    const r = filterLocationIds(many, new Set(many), 3);
    assert.equal(r.accepted.length, 3);
    assert.equal(r.rejected[REJECT_REASONS.overLimit], 2);
  });

  it("rejects everything when the shop's locations could not be read", () => {
    const r = filterLocationIds([L1, L2], null);
    assert.deepEqual(r.accepted, []);
    assert.equal(r.rejected[REJECT_REASONS.lookupFailed], 2);
  });
});

describe("splitLocationIdsParam", () => {
  it("splits and counts the overflow beyond twice the cap", () => {
    assert.deepEqual(splitLocationIdsParam(""), { ids: [], overLimit: 0 });
    assert.deepEqual(splitLocationIdsParam(`${L1},${L2}`), { ids: [L1, L2], overLimit: 0 });
    const long = Array.from({ length: MAX_LOCATION_IDS_PER_EVENT * 2 + 7 }, () => L1).join(",");
    const r = splitLocationIdsParam(long);
    assert.equal(r.ids.length, MAX_LOCATION_IDS_PER_EVENT * 2);
    assert.equal(r.overLimit, 7);
  });
});

describe("validateAnalyticsEvent", () => {
  const ctx = { now: NOW, timeZone: "Asia/Tokyo", knownLocationIds: known };

  it("accepts a valid nearby_click and keeps only known locations", () => {
    const r = validateAnalyticsEvent(
      { eventType: "nearby_click", dateStr: "2026-11-24", locationIds: [L1, L9] },
      ctx
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.payload, { locationIds: [L1] });
    assert.deepEqual(r.rejected, { [REJECT_REASONS.notInShop]: 1 });
  });

  it("rejects the whole event when the date is out of range", () => {
    const r = validateAnalyticsEvent({ eventType: "area_display", dateStr: "2026-11-01" }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.reason, REJECT_REASONS.dateOutOfRange);
    assert.equal(rejectedTotal(r.rejected), 1);
  });

  it("rejects unknown events and bad dates", () => {
    assert.equal(validateAnalyticsEvent({ eventType: "x", dateStr: "2026-11-24" }, ctx).ok, false);
    const bad = validateAnalyticsEvent({ eventType: "area_display", dateStr: "2026-13-01" }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "invalid_date");
  });

  it("order_pick_click: still counts the click, drops an unknown location with a reason", () => {
    const r = validateAnalyticsEvent(
      { eventType: "order_pick_click", dateStr: "2026-11-24", locationId: L9 },
      ctx
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.payload, {});
    assert.deepEqual(r.rejected, { [REJECT_REASONS.notInShop]: 1 });

    const ok = validateAnalyticsEvent(
      { eventType: "order_pick_click", dateStr: "2026-11-24", locationId: L2 },
      ctx
    );
    assert.deepEqual(ok.payload, { locationId: L2 });
    assert.equal(rejectedTotal(ok.rejected), 0);
  });

  it("counts a non-array locationIds (POST body) as bad_format", () => {
    const r = validateAnalyticsEvent(
      { eventType: "nearby_click", dateStr: "2026-11-24", locationIds: L1 },
      ctx
    );
    assert.equal(r.ok, true);
    assert.deepEqual(r.payload, { locationIds: [] });
    assert.equal(r.rejected[REJECT_REASONS.badFormat], 1);
  });

  it("adds the overflow from the query string as over_limit", () => {
    const r = validateAnalyticsEvent(
      { eventType: "nearby_click", dateStr: "2026-11-24", locationIds: [L1], extraOverLimit: 4 },
      ctx
    );
    assert.equal(r.rejected[REJECT_REASONS.overLimit], 4);
  });
});

describe("logAnalyticsRejections", () => {
  function capture() {
    const lines = [];
    return { lines, logger: { warn: (...args) => lines.push(args) } };
  }

  it("logs counts only (no IDs, no dates)", () => {
    const { lines, logger } = capture();
    const result = validateAnalyticsEvent(
      { eventType: "nearby_click", dateStr: "2026-11-24", locationIds: [L9, "evil"] },
      { now: NOW, timeZone: "Asia/Tokyo", knownLocationIds: known }
    );
    logAnalyticsRejections("example.myshopify.com", "nearby_click", result, logger);
    assert.equal(lines.length, 1);
    const text = lines[0].join(" ");
    assert.ok(!text.includes("Location/9"));
    assert.ok(!text.includes("evil"));
    assert.ok(!text.includes("2026-11-24"));
    const body = JSON.parse(lines[0][1]);
    assert.equal(body.rejectedTotal, 2);
    assert.equal(body.event, "nearby_click");
  });

  it("does not log when nothing was rejected; masks unknown event names", () => {
    const { lines, logger } = capture();
    logAnalyticsRejections("s", "area_display", { ok: true, payload: {}, rejected: {} }, logger);
    assert.equal(lines.length, 0);
    logAnalyticsRejections("s", "<script>", { ok: false, reason: "invalid_event", rejected: {} }, logger);
    assert.equal(JSON.parse(lines[0][1]).event, "unknown");
  });
});

describe("loadAnalyticsShopContext", () => {
  it("reads shop id, time zone and all location pages", async () => {
    const calls = [];
    const pages = [
      { nodes: [{ id: L1 }], pageInfo: { hasNextPage: true, endCursor: "c1" } },
      { nodes: [{ id: L2 }], pageInfo: { hasNextPage: false, endCursor: "c2" } },
    ];
    const ctx = await loadAnalyticsShopContext(async (_q, vars) => {
      calls.push(vars.after);
      return {
        data: {
          shop: { id: "gid://shopify/Shop/1", ianaTimezone: "Asia/Tokyo" },
          locations: pages[calls.length - 1],
        },
      };
    });
    assert.deepEqual(calls, [null, "c1"]);
    assert.equal(ctx.shopId, "gid://shopify/Shop/1");
    assert.equal(ctx.timeZone, "Asia/Tokyo");
    assert.deepEqual([...ctx.locationIds], [L1, L2]);
  });

  it("passes auth failure through", async () => {
    const ctx = await loadAnalyticsShopContext(async () => ({ authFailed: true }));
    assert.deepEqual(ctx, { authFailed: true });
  });

  it("returns locationIds: null when locations are missing or a later page fails", async () => {
    const a = await loadAnalyticsShopContext(async () => ({ data: { shop: { id: "s", ianaTimezone: null } } }));
    assert.equal(a.locationIds, null);
    assert.equal(a.shopId, "s");

    let n = 0;
    const b = await loadAnalyticsShopContext(async () => {
      n += 1;
      if (n === 2) throw new Error("throttled");
      return {
        data: {
          shop: { id: "s", ianaTimezone: "UTC" },
          locations: { nodes: [{ id: L1 }], pageInfo: { hasNextPage: true, endCursor: "c" } },
        },
      };
    });
    assert.equal(b.locationIds, null);
  });

  it("throws when the first page fails (caller logs it)", async () => {
    await assert.rejects(loadAnalyticsShopContext(async () => { throw new Error("boom"); }), /boom/);
  });
});
