// 期限付きのオフライントークンへの移行まわりの試験（ライブラリも DB も使わない）。
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  isExpiringTokenMigrationEnabled,
  migrateOfflineSessionOnAdmin,
  needsExpiringMigration,
} from "./offlineTokenMigration.js";
import { authenticateWebhookSafely, isValidWebhookHmac, toTopicConst } from "./webhookAuth.js";
import { isOfflineSessionUnrefreshable, probeShopStillInstalled } from "./shopInstallProbe.js";

const quiet = () => {};
const SECRET = "test-secret";

function sign(body, secret = SECRET) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function webhookRequest(body, { hmac = sign(body), topic = "app/uninstalled", shop = "a.myshopify.com" } = {}) {
  return new Request("https://example.test/webhooks/app/uninstalled", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": shop,
      "x-shopify-api-version": "2025-10",
      "x-shopify-webhook-id": "wh-1",
    },
    body,
  });
}

describe("ライブラリの版（future フラグが効く版か）", () => {
  it("@shopify/shopify-app-react-router は 1.1 以上・1.2 未満に固定（1.0 は expiringOfflineAccessTokens を知らない）", () => {
    const pkg = JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    const lock = JSON.parse(fs.readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8"));
    assert.equal(pkg.dependencies["@shopify/shopify-app-react-router"], "~1.1.1");
    const rr = lock.packages["node_modules/@shopify/shopify-app-react-router"].version;
    const api = lock.packages["node_modules/@shopify/shopify-api"].version;
    const [rrMaj, rrMin] = rr.split(".").map(Number);
    assert.ok(rrMaj === 1 && rrMin === 1, `react-router ${rr}`);
    const [apiMaj, apiMin] = api.split(".").map(Number);
    assert.ok(apiMaj === 12 && apiMin >= 2, `shopify-api ${api}（12.2 で refreshToken と expiring が入った）`);
  });

  it("shopify.server.js で future.expiringOfflineAccessTokens が true", () => {
    const src = fs.readFileSync(new URL("../shopify.server.js", import.meta.url), "utf8");
    assert.match(src, /expiringOfflineAccessTokens:\s*true/);
  });

  it("Session の表に refreshToken と refreshTokenExpires がある", () => {
    const schema = fs.readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    assert.match(schema, /refreshToken\s+String\?/);
    assert.match(schema, /refreshTokenExpires\s+DateTime\?/);
  });
});

describe("needsExpiringMigration", () => {
  it("期限もリフレッシュトークンも無いオフラインだけ移す", () => {
    assert.equal(needsExpiringMigration({ isOnline: false, accessToken: "shpat_x" }), true);
    assert.equal(needsExpiringMigration({ isOnline: false, accessToken: "x", expires: new Date() }), false);
    assert.equal(needsExpiringMigration({ isOnline: false, accessToken: "x", refreshToken: "r" }), false);
    assert.equal(needsExpiringMigration({ isOnline: true, accessToken: "x" }), false);
    assert.equal(needsExpiringMigration({ isOnline: false, accessToken: "" }), false);
    assert.equal(needsExpiringMigration(null), false);
  });
});

describe("isExpiringTokenMigrationEnabled（既定オフ）", () => {
  it("on / 1 / true のときだけオン", () => {
    assert.equal(isExpiringTokenMigrationEnabled({}), false);
    assert.equal(isExpiringTokenMigrationEnabled({ EXPIRING_TOKEN_MIGRATION: "off" }), false);
    assert.equal(isExpiringTokenMigrationEnabled({ EXPIRING_TOKEN_MIGRATION: "ON" }), true);
    assert.equal(isExpiringTokenMigrationEnabled({ EXPIRING_TOKEN_MIGRATION: "1" }), true);
    assert.equal(isExpiringTokenMigrationEnabled({ EXPIRING_TOKEN_MIGRATION: "true" }), true);
  });
});

describe("migrateOfflineSessionOnAdmin", () => {
  const old = { shop: "a.myshopify.com", isOnline: false, accessToken: "shpat_old" };

  it("スイッチがオフなら交換を呼ばない", async () => {
    let called = 0;
    const r = await migrateOfflineSessionOnAdmin({ ...old }, { enabled: false, ensureFresh: async () => (called++, {}), log: quiet });
    assert.equal(r, "disabled");
    assert.equal(called, 0);
  });

  it("期限付きのセッションなら何もしない", async () => {
    let called = 0;
    const r = await migrateOfflineSessionOnAdmin(
      { ...old, expires: new Date(Date.now() + 3600e3), refreshToken: "r" },
      { enabled: true, ensureFresh: async () => (called++, {}), log: quiet },
    );
    assert.equal(r, "not_needed");
    assert.equal(called, 0);
  });

  it("オンで古いトークンなら交換する", async () => {
    const r = await migrateOfflineSessionOnAdmin({ ...old }, { enabled: true, ensureFresh: async () => ({ ok: true, status: "migrated" }), log: quiet });
    assert.equal(r, "migrated");
  });

  it("交換に失敗しても投げない（画面は止めない）", async () => {
    const r1 = await migrateOfflineSessionOnAdmin({ ...old }, { enabled: true, ensureFresh: async () => ({ ok: false, status: "migrate_failed", httpStatus: 400 }), log: quiet });
    assert.equal(r1, "failed");
    const r2 = await migrateOfflineSessionOnAdmin({ ...old }, { enabled: true, ensureFresh: async () => { throw new Error("network"); }, log: quiet });
    assert.equal(r2, "failed");
  });
});

describe("authenticateWebhookSafely（外した店の Webhook を 500 にしない）", () => {
  const body = JSON.stringify({ id: 1, domain: "a.myshopify.com" });

  it("ライブラリが成功したらそのまま返す", async () => {
    const ctx = { shop: "a.myshopify.com", topic: "APP_UNINSTALLED", session: { id: "s" } };
    const r = await authenticateWebhookSafely(webhookRequest(body), { authenticateWebhook: async () => ctx, apiSecret: SECRET, log: quiet });
    assert.equal(r, ctx);
  });

  it("ライブラリが 500 を投げ、HMAC が正しければ、セッション無しで返す", async () => {
    const r = await authenticateWebhookSafely(webhookRequest(body), {
      authenticateWebhook: async (req) => {
        await req.text(); // ライブラリは本文を読む
        throw new Response(undefined, { status: 500 });
      },
      apiSecret: SECRET,
      log: quiet,
    });
    assert.equal(r.shop, "a.myshopify.com");
    assert.equal(r.topic, "APP_UNINSTALLED");
    assert.equal(r.session, undefined);
    assert.equal(r.admin, undefined);
    assert.deepEqual(r.payload, { id: 1, domain: "a.myshopify.com" });
    assert.equal(r.webhookId, "wh-1");
    assert.equal(r.sessionRefreshFailed, true);
  });

  it("500 のあと HMAC が合わなければ 401", async () => {
    await assert.rejects(
      authenticateWebhookSafely(webhookRequest(body, { hmac: sign(body, "wrong") }), {
        authenticateWebhook: async () => { throw new Response(undefined, { status: 500 }); },
        apiSecret: SECRET,
        log: quiet,
      }),
      (e) => e instanceof Response && e.status === 401,
    );
  });

  it("500 以外の Response（401 など）と、ふつうの例外はそのまま投げる", async () => {
    await assert.rejects(
      authenticateWebhookSafely(webhookRequest(body), {
        authenticateWebhook: async () => { throw new Response(undefined, { status: 401 }); },
        apiSecret: SECRET,
        log: quiet,
      }),
      (e) => e instanceof Response && e.status === 401,
    );
    await assert.rejects(
      authenticateWebhookSafely(webhookRequest(body), {
        authenticateWebhook: async () => { throw new Error("db down"); },
        apiSecret: SECRET,
        log: quiet,
      }),
      /db down/,
    );
  });

  it("HMAC と topic の形", () => {
    assert.equal(isValidWebhookHmac(body, sign(body), SECRET), true);
    assert.equal(isValidWebhookHmac(body, sign(body + "x"), SECRET), false);
    assert.equal(isValidWebhookHmac(body, null, SECRET), false);
    assert.equal(isValidWebhookHmac(body, sign(body), ""), false);
    assert.equal(toTopicConst("customers/data_request"), "CUSTOMERS_DATA_REQUEST");
    assert.equal(toTopicConst("app/scopes_update"), "APP_SCOPES_UPDATE");
  });
});

describe("isOfflineSessionUnrefreshable と shop/redact の確かめ", () => {
  const now = Date.parse("2026-11-23T00:00:00Z");
  const past = new Date(now - 1000);
  const future = new Date(now + 3600e3);

  it("期限の無い古いトークン・まだ切れていないものは false", () => {
    assert.equal(isOfflineSessionUnrefreshable({}, now), false);
    assert.equal(isOfflineSessionUnrefreshable({ expires: future, refreshToken: "r" }, now), false);
    assert.equal(isOfflineSessionUnrefreshable({ expires: past, refreshToken: "r", refreshTokenExpires: future }, now), false);
  });

  it("切れていて、リフレッシュトークンが無いか切れていれば true", () => {
    assert.equal(isOfflineSessionUnrefreshable({ expires: past }, now), true);
    assert.equal(isOfflineSessionUnrefreshable({ expires: past, refreshToken: "r", refreshTokenExpires: past }, now), true);
  });

  it("更新できないセッションなら Admin API を呼ばずに「入っていない」", async () => {
    let probed = 0;
    const installed = await probeShopStillInstalled({
      shop: "a.myshopify.com",
      findOfflineSession: async () => ({ expires: new Date(Date.now() - 1000), refreshToken: "r", refreshTokenExpires: new Date(Date.now() - 1000) }),
      runProbeQuery: async () => { probed++; },
    });
    assert.equal(installed, false);
    assert.equal(probed, 0);
  });
});
