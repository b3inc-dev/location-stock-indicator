import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  __resetAppEventsTokenForTest,
  __resetUsageRecheckForTest,
  buildIdempotencyKey,
  computeProLocationUsage,
  describeUsageReportForMerchant,
  getEventHandle,
  MISSING_PERIOD_END,
  normalizePeriodEnd,
  pickUsagePeriodEnd,
  reportProLocationUsage,
  usagePeriodKey,
  PERIOD_END_MARGIN_MS,
  RETRY_AFTER_MS,
} from "./appEventsUsage.server.js";

const SHOP = "demo.myshopify.com";
const GID = "gid://shopify/Shop/12345678";
// 期間の終わりは遠い先にする（今の時計で動くテストが、日付が過ぎて period_ended にならないように）
const PERIOD = "2099-12-21T00:00:00Z";
const ENV_ON = { APP_EVENTS_USAGE_ENABLED: "1", APP_EVENTS_CLIENT_ID: "cid", APP_EVENTS_CLIENT_SECRET: "sec" };

/** Prisma の appUsageReport の偽物（(shop, periodEnd) と idempotencyKey の一意を守る） */
function fakeStore() {
  const rows = [];
  let seq = 0;
  let clock = 0;
  const stamp = () => new Date(1_000_000 + ++clock);
  return {
    rows,
    async findUnique({ where }) {
      const k = where.shop_periodEnd;
      const r = rows.find((x) => x.shop === k.shop && x.periodEnd === k.periodEnd);
      return r ? { ...r } : null;
    },
    async create({ data }) {
      if (rows.some((x) => (x.shop === data.shop && x.periodEnd === data.periodEnd) || x.idempotencyKey === data.idempotencyKey)) {
        throw new Error("Unique constraint failed");
      }
      const now = stamp();
      const r = { id: `r${++seq}`, httpStatus: null, lastError: null, attempts: 0, sentAt: null, createdAt: now, ...data, updatedAt: now };
      rows.push(r);
      return { ...r };
    },
    async updateMany({ where, data }) {
      const r = rows.find((x) => x.id === where.id && x.status === where.status && x.updatedAt.getTime() === new Date(where.updatedAt).getTime());
      if (!r) return { count: 0 };
      Object.assign(r, data, { updatedAt: stamp() });
      return { count: 1 };
    },
    async update({ where, data }) {
      const r = rows.find((x) => x.id === where.id);
      Object.assign(r, data, { updatedAt: stamp() });
      return { ...r };
    },
  };
}

function fakeFetch(eventStatuses = [202]) {
  const calls = [];
  let i = 0;
  const fn = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
    if (url.endsWith("/auth/access_token")) {
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ access_token: "tok", token_type: "Bearer" }) };
    }
    const status = eventStatuses[Math.min(i++, eventStatuses.length - 1)];
    if (status === "throw") throw new Error("network down");
    return { status, headers: { get: () => null }, text: async () => JSON.stringify(status === 202 ? { success: true } : { success: false, error: "x" }) };
  };
  fn.calls = calls;
  fn.events = () => calls.filter((c) => c.url.includes("/events"));
  return fn;
}

const input = (over = {}) => ({ shop: SHOP, shopGid: GID, plan: "pro", locationsCount: 13, periodEnd: PERIOD, ...over });

beforeEach(() => {
  __resetUsageRecheckForTest();
  __resetAppEventsTokenForTest();
});

describe("数の計算とキー", () => {
  test("Pro は全ロケーション × $2、Lite と未契約は 0", () => {
    assert.deepEqual(computeProLocationUsage("pro", 13), { locationsCount: 13, units: 13, unitPriceUsd: 2, amountUsd: 26 });
    assert.deepEqual(computeProLocationUsage("pro", 1), { locationsCount: 1, units: 1, unitPriceUsd: 2, amountUsd: 2 });
    assert.equal(computeProLocationUsage("lite", 8).units, 0);
    assert.equal(computeProLocationUsage(null, 8).units, 0);
  });

  test("キーは店と期間で決まり、64 文字以内", () => {
    const k = buildIdempotencyKey(GID, PERIOD);
    assert.equal(k, "lsi-loc-12345678-20991221");
    assert.equal(buildIdempotencyKey(GID, "2099-12-21T00:00:00.000Z"), k);
    // 同じ日なら秒・時刻がずれても同じキー（UTC の日付）
    assert.equal(buildIdempotencyKey(GID, "2099-12-21T00:00:07Z"), k);
    assert.equal(buildIdempotencyKey(GID, "2099-12-21T09:00:00+09:00"), k);
    assert.equal(usagePeriodKey("2099-12-21T23:59:59Z"), "2099-12-21");
    assert.equal(usagePeriodKey(null), null);
    assert.ok(k.length <= 64);
    assert.equal(buildIdempotencyKey("bad", PERIOD), null);
    assert.equal(buildIdempotencyKey(GID, "not a date"), null);
  });

  test("handle は env で変えられる", () => {
    assert.equal(getEventHandle({}), "pro_location");
    assert.equal(getEventHandle({ APP_EVENTS_HANDLE_PRO: "loc_pro" }), "loc_pro");
  });
});

describe("1 店・1 期間に 1 回", () => {
  test("送る body は shopify.dev の形（shop_id / event_handle / timestamp / idempotency_key / attributes.value）", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch();
    const r = await reportProLocationUsage(input(), { store, env: ENV_ON, fetchImpl, now: () => Date.parse("2026-11-25T03:04:05.678Z") });
    assert.equal(r.outcome, "sent");
    const [ev] = fetchImpl.events();
    assert.equal(ev.url, "https://api.shopify.com/app/2026-10/events");
    assert.equal(ev.headers.Authorization, "Bearer tok");
    assert.deepEqual(ev.body, {
      shop_id: GID,
      event_handle: "pro_location",
      timestamp: "2026-11-25T03:04:05Z",
      idempotency_key: "lsi-loc-12345678-20991221",
      attributes: { value: 13 },
    });
    assert.equal(store.rows[0].status, "sent");
  });

  test("何度呼んでも、同時に呼んでも、送るのは 1 回", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch();
    const deps = { store, env: ENV_ON, fetchImpl, force: true };
    const results = await Promise.all([1, 2, 3, 4].map(() => reportProLocationUsage(input(), deps)));
    assert.equal(results.filter((r) => r.outcome === "sent").length, 1);
    const again = await reportProLocationUsage(input({ locationsCount: 20 }), deps);
    assert.equal(again.outcome, "already_sent");
    assert.equal(fetchImpl.events().length, 1);
    assert.equal(store.rows.length, 1);
  });

  test("次の期間はもう一度送る（キーが変わる）", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch();
    await reportProLocationUsage(input(), { store, env: ENV_ON, fetchImpl });
    await reportProLocationUsage(input({ periodEnd: "2027-01-20T00:00:00Z" }), { store, env: ENV_ON, fetchImpl });
    const keys = fetchImpl.events().map((e) => e.body.idempotency_key);
    assert.equal(new Set(keys).size, 2);
  });

  test("Lite は何もしない（DB にも書かない）", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch();
    const r = await reportProLocationUsage(input({ plan: "lite" }), { store, env: ENV_ON, fetchImpl });
    assert.deepEqual(r, { outcome: "skipped", reason: "no_usage" });
    assert.equal(store.rows.length, 0);
    assert.equal(fetchImpl.calls.length, 0);
  });
});

describe("スイッチ・上限・失敗", () => {
  test("既定オフ: 送らずに数を disabled で残す。オンにすると同じ行を送る", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch();
    const off = await reportProLocationUsage(input(), { store, env: {}, fetchImpl, force: true });
    assert.equal(off.outcome, "disabled");
    assert.equal(store.rows[0].units, 13);
    assert.equal(fetchImpl.calls.length, 0);
    const on = await reportProLocationUsage(input(), { store, env: ENV_ON, fetchImpl, force: true });
    assert.equal(on.outcome, "sent");
    assert.equal(store.rows.length, 1);
  });

  test("アプリ側の上限を超えたら送らず over_limit で残す", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch();
    const r = await reportProLocationUsage(input({ locationsCount: 30 }), {
      store,
      env: { ...ENV_ON, APP_EVENTS_USAGE_MAX_UNITS: "15" },
      fetchImpl,
    });
    assert.equal(r.outcome, "over_limit");
    assert.match(store.rows[0].lastError, /上限/);
    assert.equal(fetchImpl.events().length, 0);
  });

  test("失敗は failed で残し、時間をおいて同じキー・同じ数で送り直す", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch([503, 202]);
    let now = Date.parse("2026-11-25T00:00:00Z");
    const deps = { store, env: ENV_ON, fetchImpl, now: () => now, force: false };
    const first = await reportProLocationUsage(input(), deps);
    assert.equal(first.outcome, "failed");
    assert.equal(store.rows[0].httpStatus, 503);
    assert.equal(store.rows[0].attempts, 1);

    // 店がロケーションを増やしても、一度送ろうとした数は変えない
    now += RETRY_AFTER_MS + 1;
    const second = await reportProLocationUsage(input({ locationsCount: 18 }), deps);
    assert.equal(second.outcome, "sent");
    const evs = fetchImpl.events();
    assert.equal(evs.length, 2);
    assert.equal(evs[0].body.idempotency_key, evs[1].body.idempotency_key);
    assert.equal(evs[1].body.attributes.value, 13);
    assert.equal(store.rows[0].attempts, 2);
  });

  test("通信の失敗も failed で残す（投げない）", async () => {
    const store = fakeStore();
    const r = await reportProLocationUsage(input(), { store, env: ENV_ON, fetchImpl: fakeFetch(["throw"]) });
    assert.equal(r.outcome, "failed");
    assert.equal(store.rows[0].httpStatus, null);
    assert.match(store.rows[0].lastError, /network down/);
  });

  test("400 / 403 は自動で送り直さない（T が見る）", async () => {
    const store = fakeStore();
    let now = 0;
    const fetchImpl = fakeFetch([403]);
    await reportProLocationUsage(input(), { store, env: ENV_ON, fetchImpl, now: () => now });
    now += RETRY_AFTER_MS * 10;
    const r = await reportProLocationUsage(input(), { store, env: ENV_ON, fetchImpl, now: () => now });
    assert.deepEqual(r, { outcome: "skipped", reason: "not_retryable" });
    assert.equal(fetchImpl.events().length, 1);
  });

  test("鍵が無いときは failed で理由を残す", async () => {
    const store = fakeStore();
    const r = await reportProLocationUsage(input(), { store, env: { APP_EVENTS_USAGE_ENABLED: "1" }, fetchImpl: fakeFetch() });
    assert.equal(r.outcome, "failed");
    assert.match(store.rows[0].lastError, /APP_EVENTS_CLIENT_ID/);
  });

  test("期間や店の ID が分からないときは送らない", async () => {
    const store = fakeStore();
    assert.equal((await reportProLocationUsage(input({ periodEnd: null }), { store, env: ENV_ON })).outcome, "missing_period");
    assert.equal((await reportProLocationUsage(input({ shopGid: null }), { store, env: ENV_ON })).reason, "missing_shop_id");
  });

  test("請求期間が終わった（終わりそう）なら、古い期間のキーで送らない（次の期間と 2 重にしない）", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch([503, 202]);
    let now = Date.parse(PERIOD) - PERIOD_END_MARGIN_MS - 60_000;
    const deps = { store, env: ENV_ON, fetchImpl, now: () => now, force: true };
    assert.equal((await reportProLocationUsage(input(), deps)).outcome, "failed");
    now = Date.parse(PERIOD) + 1;
    assert.equal((await reportProLocationUsage(input(), deps)).reason, "period_ended");
    now = Date.parse(PERIOD) - PERIOD_END_MARGIN_MS + 1;
    assert.equal((await reportProLocationUsage(input(), deps)).reason, "period_ended");
    assert.equal(fetchImpl.events().length, 1);
    assert.equal(store.rows[0].status, "failed");
  });

  test("店に見せる文", () => {
    assert.match(describeUsageReportForMerchant({ status: "sent" }), /報告済み/);
    assert.match(describeUsageReportForMerchant(null), /まだ/);
  });
});

describe("従量を数える請求期間（Partner API と Admin API）", () => {
  const PARTNER_END = "2099-12-21T00:00:00Z";
  const ADMIN_END = "2099-11-30T00:00:00.000Z";

  test("Partner で契約を読んだときは Partner の期間を先に使う（Admin に契約が無くても）", () => {
    assert.deepEqual(pickUsagePeriodEnd({ planSource: "partner", partnerPeriodEnd: PARTNER_END, adminSubscriptions: [] }), {
      periodEnd: "2099-12-21T00:00:00.000Z",
      periodSource: "partner",
    });
    assert.equal(
      pickUsagePeriodEnd({ planSource: "partner", partnerPeriodEnd: PARTNER_END, adminSubscriptions: [{ status: "ACTIVE", currentPeriodEnd: ADMIN_END }] }).periodSource,
      "partner"
    );
  });

  test("Partner の期間が無い（試用中など）・Admin で決めたときは Admin の ACTIVE な契約の期間", () => {
    const admin = [{ status: "CANCELLED", currentPeriodEnd: "2099-01-01T00:00:00Z" }, { status: "ACTIVE", currentPeriodEnd: ADMIN_END }];
    assert.deepEqual(pickUsagePeriodEnd({ planSource: "partner", partnerPeriodEnd: null, adminSubscriptions: admin }), { periodEnd: ADMIN_END, periodSource: "admin" });
    assert.deepEqual(pickUsagePeriodEnd({ planSource: "admin", partnerPeriodEnd: PARTNER_END, adminSubscriptions: admin }), { periodEnd: ADMIN_END, periodSource: "admin" });
  });

  test("どこにも期間が無ければ null（送らない）", async () => {
    assert.deepEqual(pickUsagePeriodEnd({ planSource: "partner", partnerPeriodEnd: null, adminSubscriptions: [] }), { periodEnd: null, periodSource: null });
    assert.equal(normalizePeriodEnd("not a date"), null);
    const fetchImpl = fakeFetch();
    assert.equal((await reportProLocationUsage(input({ periodEnd: null }), { store: fakeStore(), env: ENV_ON, fetchImpl })).outcome, "missing_period");
    assert.equal(fetchImpl.calls.length, 0);
  });

  test("Partner の endTime と Admin の currentPeriodEnd が数秒ずれても、同じ行・同じキーで 1 回だけ送る", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch([202]);
    const viaPartner = pickUsagePeriodEnd({ planSource: "partner", partnerPeriodEnd: "2099-12-21T00:00:00Z", adminSubscriptions: [] }).periodEnd;
    const viaAdmin = pickUsagePeriodEnd({ planSource: "admin", adminSubscriptions: [{ status: "ACTIVE", currentPeriodEnd: "2099-12-21T00:00:04.000Z" }] }).periodEnd;
    assert.notEqual(viaPartner, viaAdmin);
    assert.equal(buildIdempotencyKey(GID, viaPartner), buildIdempotencyKey(GID, viaAdmin));
    assert.equal((await reportProLocationUsage(input({ periodEnd: viaPartner }), { store, env: ENV_ON, fetchImpl })).outcome, "sent");
    __resetUsageRecheckForTest();
    const r = await reportProLocationUsage(input({ periodEnd: viaAdmin }), { store, env: ENV_ON, fetchImpl });
    assert.equal(r.outcome, "already_sent");
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].periodEnd, "2099-12-21");
    assert.equal(fetchImpl.events().length, 1);
    assert.equal(fetchImpl.events()[0].body.idempotency_key, "lsi-loc-12345678-20991221");
  });

  test("期間の終わりが UTC の 0 時をまたいでずれても（23:59:58 と 00:00:01）同じ期間として 1 回だけ送る", async () => {
    const before = "2099-12-20T23:59:58Z";
    const after = "2099-12-21T00:00:01Z";
    assert.notEqual(usagePeriodKey(before), usagePeriodKey(after));
    for (const [first, second] of [[before, after], [after, before]]) {
      const store = fakeStore();
      const fetchImpl = fakeFetch([202]);
      __resetUsageRecheckForTest();
      assert.equal((await reportProLocationUsage(input({ periodEnd: first }), { store, env: ENV_ON, fetchImpl })).outcome, "sent");
      __resetUsageRecheckForTest();
      assert.equal((await reportProLocationUsage(input({ periodEnd: second }), { store, env: ENV_ON, fetchImpl })).outcome, "already_sent");
      assert.equal(store.rows.length, 1);
      assert.equal(fetchImpl.events().length, 1);
    }
  });

  test("前後 1 日の行が送りかけ（failed）なら、その行のキーで送り直す（新しいキーで 2 回目を作らない）", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch([503, 202]);
    const before = "2099-12-20T23:59:58Z";
    assert.equal((await reportProLocationUsage(input({ periodEnd: before }), { store, env: ENV_ON, fetchImpl, force: true })).outcome, "failed");
    assert.equal((await reportProLocationUsage(input({ periodEnd: "2099-12-21T00:00:01Z" }), { store, env: ENV_ON, fetchImpl, force: true })).outcome, "sent");
    assert.equal(store.rows.length, 1);
    assert.deepEqual(fetchImpl.events().map((e) => e.body.idempotency_key), [buildIdempotencyKey(GID, before), buildIdempotencyKey(GID, before)]);
  });

  test("2 日以上離れた行は別の期間（前の期間の行があっても送る）", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch([202]);
    assert.equal((await reportProLocationUsage(input({ periodEnd: "2099-11-21T00:00:00Z" }), { store, env: ENV_ON, fetchImpl })).outcome, "sent");
    assert.equal((await reportProLocationUsage(input({ periodEnd: "2099-12-21T00:00:00Z" }), { store, env: ENV_ON, fetchImpl })).outcome, "sent");
    assert.equal(store.rows.length, 2);
  });

  test("期間が分からないときは送らずに missing_period で数と理由を残す（1 店 1 行・数は新しくする）", async () => {
    const store = fakeStore();
    const fetchImpl = fakeFetch();
    assert.equal((await reportProLocationUsage(input({ periodEnd: null }), { store, env: ENV_ON, fetchImpl })).outcome, "missing_period");
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].periodEnd, MISSING_PERIOD_END);
    assert.equal(store.rows[0].status, "missing_period");
    assert.equal(store.rows[0].units, 13);
    assert.equal(store.rows[0].attempts, 0);
    assert.match(store.rows[0].lastError, /請求期間/);
    assert.equal((await reportProLocationUsage(input({ periodEnd: null }), { store, env: ENV_ON, fetchImpl })).reason, "recently_checked");
    assert.equal((await reportProLocationUsage(input({ periodEnd: "", locationsCount: 15 }), { store, env: ENV_ON, fetchImpl, force: true })).outcome, "missing_period");
    assert.equal(store.rows.length, 1);
    assert.equal(store.rows[0].units, 15);
    // スイッチがオフでも同じ
    __resetUsageRecheckForTest();
    assert.equal((await reportProLocationUsage(input({ periodEnd: null }), { store, env: {}, fetchImpl })).outcome, "missing_period");
    assert.equal(fetchImpl.calls.length, 0);
    // 期間が分かれば別の行で送る
    assert.equal((await reportProLocationUsage(input(), { store, env: ENV_ON, fetchImpl })).outcome, "sent");
    assert.equal(store.rows.length, 2);
    assert.match(describeUsageReportForMerchant({ status: "missing_period" }), /請求期間を読めない/);
  });

  test("期間の終わり 10 分前の止めは、日付ではなく正確な時刻で見る", async () => {
    const fetchImpl = fakeFetch([202]);
    const end = "2099-12-21T12:00:00Z";
    let now = Date.parse(end) - PERIOD_END_MARGIN_MS - 1000;
    assert.equal((await reportProLocationUsage(input({ periodEnd: end }), { store: fakeStore(), env: ENV_ON, fetchImpl, now: () => now })).outcome, "sent");
    const store2 = fakeStore();
    now = Date.parse(end) - 5 * 60_000;
    assert.equal((await reportProLocationUsage(input({ periodEnd: end }), { store: store2, env: ENV_ON, fetchImpl, now: () => now, force: true })).reason, "period_ended");
    assert.equal(store2.rows.length, 0);
  });
});

describe("つなぎ方（ソースの確認）", () => {
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
  test("Billing API の従量（appUsageRecordCreate）は使っていない", () => {
    for (const p of ["app/utils/billing.js", "app/utils/shopPlan.server.js", "app/utils/appEventsUsage.server.js"]) {
      const src = read(p).replace(/^\s*(\/\/|\*).*$/gm, "");
      assert.doesNotMatch(src, /appUsageRecordCreate|appSubscriptionCreate/, p);
    }
  });
  test("料金プラン画面は前後 1 日も探し、期間が分からないときは missing_period を出す", () => {
    const src = read("app/routes/app.plan.jsx");
    assert.match(src, /findUsageReportForPeriod\(prisma\.appUsageReport/);
    assert.match(src, /\{ status: "missing_period" \}/);
  });
  test("報告を頼むのは管理画面のレイアウトだけ（ストアフロントの App Proxy は頼まない）", () => {
    assert.match(read("app/routes/app.jsx"), /getShopPlan\(admin, session\?\.shop, \{ reportUsage: true \}\)/);
    assert.doesNotMatch(read("app/routes/apps.location-stock.js"), /reportUsage/);
    const plan = read("app/utils/shopPlan.server.js");
    assert.match(plan, /distribution === "public" && !forceInhouse && plan === "pro"/);
    assert.match(plan, /options\?\.reportUsage === true/);
  });
});
