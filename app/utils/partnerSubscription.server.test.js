import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  ACTIVE_SUBSCRIPTION_QUERY,
  PARTNER_API_DEFAULT_VERSION,
  PARTNER_CACHE_FOUND_MS,
  PARTNER_CACHE_NONE_MS,
  __clearPartnerSubscriptionCacheForTest,
  fetchPartnerActiveSubscription,
  getPartnerActiveSubscription,
  parseActiveSubscriptionResponse,
  partnerApiEndpoint,
  partnerSubscriptionToAdminShape,
  readPartnerApiConfig,
  toShopifyGid,
} from "./partnerSubscription.server.js";
import { getPlanFromActiveSubscriptions } from "./billing.js";
import { getShopPlan } from "./shopPlan.server.js";
import { PUBLIC_CLIENT_ID } from "./planDistribution.js";

const TOKEN = "prtapi_secret_token_value";
const ENV = {
  PARTNER_API_SUBSCRIPTION_ENABLED: "1",
  PARTNER_API_TOKEN: TOKEN,
  PARTNER_API_ORG_ID: "1234567",
  PARTNER_API_APP_ID: "987654",
};
const config = () => readPartnerApiConfig(ENV).config;
const SHOP = "gid://shopify/Shop/555";

const ok = (body, status = 200) => async () => ({ status, text: async () => JSON.stringify(body) });
const subBody = (handles, extra = {}) => ({
  data: {
    activeSubscription: {
      billingPeriod: "EVERY_30_DAYS",
      cancelAtEndOfCycle: false,
      trialEndsAt: null,
      legacySubscriptionId: "gid://shopify/AppSubscription/42",
      currentBillingCycle: { startTime: "2026-11-01T00:00:00Z", endTime: "2026-12-01T00:00:00Z" },
      items: handles.map((handle) => ({ handle })),
      ...extra,
    },
  },
});

function captureWarn(fn) {
  const lines = [];
  const orig = console.warn;
  console.warn = (...a) => lines.push(a.map(String).join(" "));
  return Promise.resolve(fn()).finally(() => {
    console.warn = orig;
  }).then((v) => ({ v, lines }));
}

beforeEach(() => __clearPartnerSubscriptionCacheForTest());

describe("設定: 既定オフ・全部そろったときだけ使う", () => {
  test("スイッチが無ければオフ", () => {
    assert.deepEqual(readPartnerApiConfig({ ...ENV, PARTNER_API_SUBSCRIPTION_ENABLED: "" }), { enabled: false, reason: "switch_off" });
    assert.deepEqual(readPartnerApiConfig({ ...ENV, PARTNER_API_SUBSCRIPTION_ENABLED: "true" }), { enabled: false, reason: "switch_off" });
  });
  test("足りない設定は名前だけ返す（値を返さない）", () => {
    const r = readPartnerApiConfig({ PARTNER_API_SUBSCRIPTION_ENABLED: "1", PARTNER_API_TOKEN: TOKEN });
    assert.equal(r.enabled, false);
    assert.deepEqual(r.missing, ["PARTNER_API_ORG_ID", "PARTNER_API_APP_ID"]);
    assert.ok(!JSON.stringify(r).includes(TOKEN));
  });
  test("そろえば有効。版の既定は 2026-10。アプリ ID は gid://shopify/App/ にそろえる", () => {
    const r = readPartnerApiConfig(ENV);
    assert.equal(r.enabled, true);
    assert.equal(r.config.apiVersion, PARTNER_API_DEFAULT_VERSION);
    assert.equal(PARTNER_API_DEFAULT_VERSION, "2026-10");
    assert.equal(r.config.appGid, "gid://shopify/App/987654");
    assert.equal(readPartnerApiConfig({ ...ENV, PARTNER_API_APP_ID: "gid://partners/App/987654" }).config.appGid, "gid://shopify/App/987654");
    assert.equal(readPartnerApiConfig({ ...ENV, PARTNER_API_VERSION: "2026-07" }).config.apiVersion, "2026-07");
  });
  test("Partner ID が数字でなければ設定不足", () => {
    assert.deepEqual(readPartnerApiConfig({ ...ENV, PARTNER_API_ORG_ID: "abc" }).missing, ["PARTNER_API_ORG_ID"]);
  });
  test("toShopifyGid", () => {
    assert.equal(toShopifyGid("Shop", "gid://shopify/Shop/1"), "gid://shopify/Shop/1");
    assert.equal(toShopifyGid("Shop", "1"), "gid://shopify/Shop/1");
    assert.equal(toShopifyGid("Shop", "gid://shopify/App/1"), null);
    assert.equal(toShopifyGid("App", ""), null);
    assert.equal(toShopifyGid("App", "x/1"), null);
  });
});

describe("Partner API への送り方", () => {
  test("URL・ヘッダー・変数", async () => {
    let seen;
    const r = await fetchPartnerActiveSubscription({
      config: config(),
      shopGid: "555",
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return { status: 200, text: async () => JSON.stringify(subBody(["pro-10"])) };
      },
    });
    assert.equal(seen.url, "https://partners.shopify.com/1234567/api/2026-10/graphql.json");
    assert.equal(seen.url, partnerApiEndpoint(config()));
    assert.equal(seen.init.method, "POST");
    assert.equal(seen.init.headers["X-Shopify-Access-Token"], TOKEN);
    const body = JSON.parse(seen.init.body);
    assert.equal(body.query, ACTIVE_SUBSCRIPTION_QUERY);
    assert.deepEqual(body.variables, { appId: "gid://shopify/App/987654", shopId: SHOP });
    assert.equal(r.ok, true);
    assert.deepEqual(r.subscription.handles, ["pro-10"]);
    assert.equal(r.subscription.currentPeriodEnd, "2026-12-01T00:00:00Z");
  });
  test("店の ID がおかしければ送らない", async () => {
    let called = false;
    const r = await fetchPartnerActiveSubscription({ config: config(), shopGid: "nope", fetchImpl: async () => { called = true; } });
    assert.deepEqual(r, { ok: false, reason: "bad_shop_id" });
    assert.equal(called, false);
  });
  test("timeout と通信の失敗", async () => {
    const t = await fetchPartnerActiveSubscription({
      config: config(),
      shopGid: SHOP,
      timeoutMs: 10,
      fetchImpl: (_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    });
    assert.deepEqual(t, { ok: false, reason: "timeout" });
    const n = await fetchPartnerActiveSubscription({ config: config(), shopGid: SHOP, fetchImpl: async () => { throw new Error("ECONNRESET"); } });
    assert.deepEqual(n, { ok: false, reason: "network_error" });
  });
});

describe("答えの読み方", () => {
  test("null は契約なし（失敗ではない）", () => {
    assert.deepEqual(parseActiveSubscriptionResponse(200, JSON.stringify({ data: { activeSubscription: null } })), { ok: true, subscription: null, cached: false });
  });
  test("429 と 200 の Too many requests は throttled", () => {
    assert.equal(parseActiveSubscriptionResponse(429, "").reason, "throttled");
    const body = JSON.stringify({ errors: [{ message: "Too many requests", extensions: { code: "429" } }] });
    assert.equal(parseActiveSubscriptionResponse(200, body).reason, "throttled");
  });
  test("GraphQL のエラー（公開アプリでない等）・HTTP エラー・壊れた答え", () => {
    const e = JSON.stringify({ errors: [{ message: "Only public app must can access active subscription" }], data: { activeSubscription: null } });
    assert.equal(parseActiveSubscriptionResponse(200, e).reason, "graphql_error");
    assert.equal(parseActiveSubscriptionResponse(401, "{}").reason, "http_error");
    assert.equal(parseActiveSubscriptionResponse(500, "oops").reason, "http_error");
    assert.equal(parseActiveSubscriptionResponse(200, "not json").reason, "bad_response");
    assert.equal(parseActiveSubscriptionResponse(200, JSON.stringify({ data: {} })).reason, "bad_response");
  });
  test("試用中（currentBillingCycle が null）", () => {
    const r = parseActiveSubscriptionResponse(200, JSON.stringify(subBody(["lite-3"], { currentBillingCycle: null, trialEndsAt: "2026-12-05T00:00:00Z" })));
    assert.equal(r.subscription.currentPeriodEnd, null);
    assert.equal(r.subscription.trialEndsAt, "2026-12-05T00:00:00Z");
  });
});

describe("店ごとに少し覚える", () => {
  test("見つかったら 60 秒、なしは 15 秒。失敗は覚えない", async () => {
    let t = 1_000;
    let calls = 0;
    const fetchImpl = async () => { calls++; return { status: 200, text: async () => JSON.stringify(subBody(["pro"])) }; };
    const args = { config: config(), shopGid: SHOP, fetchImpl, now: () => t };
    assert.equal((await getPartnerActiveSubscription(args)).cached, false);
    t += PARTNER_CACHE_FOUND_MS - 1;
    assert.equal((await getPartnerActiveSubscription(args)).cached, true);
    t += 2;
    assert.equal((await getPartnerActiveSubscription(args)).cached, false);
    assert.equal(calls, 2);

    __clearPartnerSubscriptionCacheForTest();
    calls = 0;
    const none = async () => { calls++; return { status: 200, text: async () => JSON.stringify({ data: { activeSubscription: null } }) }; };
    await getPartnerActiveSubscription({ ...args, fetchImpl: none });
    t += PARTNER_CACHE_NONE_MS + 1;
    await getPartnerActiveSubscription({ ...args, fetchImpl: none });
    assert.equal(calls, 2);

    __clearPartnerSubscriptionCacheForTest();
    calls = 0;
    const fail = async () => { calls++; return { status: 503, text: async () => "" }; };
    await captureWarn(async () => {
      await getPartnerActiveSubscription({ ...args, fetchImpl: fail });
      await getPartnerActiveSubscription({ ...args, fetchImpl: fail });
    });
    assert.equal(calls, 2);
  });
  test("同時の呼び出しは 1 回にまとめる", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return { status: 200, text: async () => JSON.stringify(subBody(["lite"])) }; };
    await Promise.all([1, 2, 3].map(() => getPartnerActiveSubscription({ config: config(), shopGid: SHOP, fetchImpl })));
    assert.equal(calls, 1);
  });
  test("失敗のログにトークンを出さない", async () => {
    const { lines } = await captureWarn(() =>
      getPartnerActiveSubscription({ config: config(), shopGid: SHOP, shop: "x.myshopify.com", fetchImpl: async () => ({ status: 401, text: async () => `bad token ${TOKEN}` }) })
    );
    assert.equal(lines.length, 1);
    assert.match(lines[0], /reason=http_error status=401 shop=x\.myshopify\.com/);
    assert.ok(!lines.join("\n").includes(TOKEN));
  });
});

describe("プランの判定は今と同じ決まり（名前に Pro / Lite）", () => {
  test("handle から Lite / Pro と 3/10 か所", () => {
    const pro = parseActiveSubscriptionResponse(200, JSON.stringify(subBody(["pro-10"]))).subscription;
    const shaped = partnerSubscriptionToAdminShape(pro, SHOP);
    assert.deepEqual(shaped, { id: "gid://shopify/AppSubscription/42", name: "pro-10", status: "ACTIVE", currentPeriodEnd: "2026-12-01T00:00:00Z" });
    assert.equal(getPlanFromActiveSubscriptions([shaped]), "pro");
    const lite = parseActiveSubscriptionResponse(200, JSON.stringify(subBody(["lite-3"], { legacySubscriptionId: null }))).subscription;
    const s2 = partnerSubscriptionToAdminShape(lite, SHOP);
    assert.equal(s2.id, `partner:${SHOP}`);
    assert.equal(getPlanFromActiveSubscriptions([s2]), "lite");
  });
});

describe("getShopPlan と Partner API", () => {
  const KEYS = ["APP_DISTRIBUTION", "CUSTOM_APP_STORE_IDS", "SHOPIFY_API_KEY", ...Object.keys(ENV)];
  let saved;
  let origFetch;
  let fetchCalls;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
    process.env.SHOPIFY_API_KEY = PUBLIC_CLIENT_ID;
    origFetch = globalThis.fetch;
    fetchCalls = 0;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const setPartner = (respond) => {
    Object.assign(process.env, ENV);
    globalThis.fetch = async (...a) => {
      fetchCalls++;
      return respond(...a);
    };
  };
  const admin = (subs, { shopId = SHOP, throws = false } = {}) => ({
    graphql: async () => {
      if (throws) throw new Error("network");
      return {
        json: async () => ({
          data: {
            shop: { id: shopId, plan: { partnerDevelopment: false } },
            locations: { nodes: [] },
            currentAppInstallation: subs === undefined ? {} : { activeSubscriptions: subs },
          },
        }),
      };
    },
  });

  test("スイッチがオフなら Partner に聞かない（今と同じ）", async () => {
    globalThis.fetch = async () => { fetchCalls++; throw new Error("should not call"); };
    const p = await getShopPlan(admin([{ name: "Lite", status: "ACTIVE" }]), "s.myshopify.com");
    assert.equal(p.plan, "lite");
    assert.equal(p.planSource, undefined);
    assert.equal(fetchCalls, 0);
  });
  test("自社用は Partner に聞かない", async () => {
    setPartner(ok(subBody(["pro"])));
    process.env.APP_DISTRIBUTION = "inhouse";
    const p = await getShopPlan(admin([]), "ciara.myshopify.com");
    assert.equal(p.plan, "pro");
    assert.equal(fetchCalls, 0);
  });
  test("Partner で見つかれば正にする（Admin が空でも）", async () => {
    setPartner(ok(subBody(["pro"])));
    const p = await getShopPlan(admin([]), "s.myshopify.com");
    assert.equal(p.plan, "pro");
    assert.equal(p.planSource, "partner");
    assert.equal(p.planRequired, undefined);
  });
  test("Partner が契約なし → Admin の結果を使う", async () => {
    setPartner(ok({ data: { activeSubscription: null } }));
    const p = await getShopPlan(admin([{ name: "Lite", status: "ACTIVE" }]), "s.myshopify.com");
    assert.equal(p.plan, "lite");
    assert.equal(p.planSource, undefined);
  });
  test("Partner が契約なし・Admin の契約一覧が無い → 未契約（読めなかったとは言わない）", async () => {
    setPartner(ok({ data: { activeSubscription: null } }));
    const p = await getShopPlan(admin(undefined), "s.myshopify.com");
    assert.equal(p.plan, null);
    assert.equal(p.planRequired, true);
    assert.equal(p.planCheckFailed, undefined);
  });
  test("Partner が失敗 → Admin の結果のまま。両方だめなら今まで通り planCheckFailed", async () => {
    setPartner(async () => ({ status: 429, text: async () => "" }));
    await captureWarn(async () => {
      const a = await getShopPlan(admin([{ name: "Pro", status: "ACTIVE" }]), "s.myshopify.com");
      assert.equal(a.plan, "pro");
      const b = await getShopPlan(admin(undefined), "s.myshopify.com");
      assert.equal(b.plan, null);
      assert.equal(b.planCheckFailed, true);
      const c = await getShopPlan(admin([], { throws: true }), "s.myshopify.com");
      assert.equal(c.planCheckFailed, true);
    });
  });
});
