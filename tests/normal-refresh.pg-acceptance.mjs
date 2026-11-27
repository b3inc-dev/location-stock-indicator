import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createServer } from "vite";
import "@shopify/shopify-api/adapters/node";
import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import { isolatedPostgresUrl } from "./helpers/isolated-pg-guard.mjs";

// Normal SDK refresh wire is sourced from shopify-app-js 7399c4f:
// shopify-api@12.3.0 / shopify-app-react-router@1.1.1 (same official tag commit).
// This calls the existing business helper, not a webhook or new authentication probe.
const db = new PrismaClient({ datasources: { db: { url: isolatedPostgresUrl() } } });
const fixtures = ["refreshable", "unavailable", "unrelated"].map((kind) => ({
  kind, shop: `normal-refresh-${kind}-0221.myshopify.com`,
  access: `synthetic-old-${kind}-0221`, refresh: `synthetic-refresh-${kind}-0221`,
}));
const API_KEY = "0123456789abcdef0123456789abcdef", SECRET = "synthetic-normal-refresh-0221";
const calls = [];
const keys = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SCOPES", "APP_DISTRIBUTION"];
const previous = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
let vite, probe, oldFetch;

async function syntheticFetch(input, init) {
  const req = new Request(input, init), url = new URL(req.url);
  const f = fixtures.find((x) => x.shop === url.hostname);
  assert.ok(f && f.kind !== "unrelated", "Only the exact selected synthetic tenants may be contacted");
  assert.equal(url.protocol, "https:"); assert.equal(url.search, ""); assert.equal(req.method, "POST");
  const body = JSON.parse(await req.text());
  if (url.pathname === "/admin/oauth/access_token") {
    assert.deepEqual(body, { client_id: API_KEY, client_secret: SECRET, refresh_token: f.refresh, grant_type: "refresh_token" });
    calls.push({ kind: f.kind, operation: "refresh" });
    if (f.kind === "unavailable") return Response.json({ error: "temporarily_unavailable" }, { status: 503 });
    return Response.json({ access_token: "synthetic-new-access-0221", scope: "read_products", expires_in: 3600,
      refresh_token: "synthetic-new-refresh-0221", refresh_token_expires_in: 86400 });
  }
  assert.equal(url.pathname, "/admin/api/2025-10/graphql.json");
  assert.equal(f.kind, "refreshable");
  assert.equal(req.headers.get("x-shopify-access-token"), "synthetic-new-access-0221");
  assert.match(body.query, /query ComplianceInstallProbe/); assert.doesNotMatch(body.query, /\bmutation\b/i);
  calls.push({ kind: f.kind, operation: "read-install-probe" });
  return Response.json({ data: { shop: { id: "gid://shopify/Shop/260221" } } }, { headers: { "x-shopify-api-version": "2025-10" } });
}

before(async () => {
  Object.assign(process.env, { SHOPIFY_API_KEY: API_KEY, SHOPIFY_API_SECRET: SECRET,
    SHOPIFY_APP_URL: "https://synthetic-app.invalid", SCOPES: "read_products", APP_DISTRIBUTION: "public" });
  globalThis.prismaGlobal = db;
  oldFetch = globalThis.fetch; globalThis.fetch = syntheticFetch; setAbstractFetchFunc(syntheticFetch);
  for (const f of fixtures) await db.session.create({ data: { id: "offline_" + f.shop, shop: f.shop,
    state: "synthetic", isOnline: false, scope: "read_products", accessToken: f.access,
    expires: new Date(Date.now() - 60000), refreshToken: f.refresh, refreshTokenExpires: new Date(Date.now() + 86400000) } });
  vite = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, hmr: false } });
  probe = await vite.ssrLoadModule("/app/utils/shopInstallProbe.server.js"); setAbstractFetchFunc(syntheticFetch);
});
after(async () => {
  try { await db.session.deleteMany({ where: { shop: { in: fixtures.map((f) => f.shop) } } }); }
  finally { await vite?.close(); await db.$disconnect(); delete globalThis.prismaGlobal;
    globalThis.fetch = oldFetch; setAbstractFetchFunc(oldFetch);
    for (const k of keys) { if (previous[k] === undefined) delete process.env[k]; else process.env[k] = previous[k]; } }
});

test("LOC-REFRESH-PG-001: existing install probe refreshes a normal expiring offline session through SDK, persists rotation, and preserves all rows on upstream unavailability", async () => {
  const rows = () => db.session.findMany({ where: { shop: { in: fixtures.map((f) => f.shop) } }, orderBy: { shop: "asc" } });
  const [selected, unavailable, unrelated] = fixtures;
  const beforeRows = await rows(), started = Date.now();
  assert.equal(await probe.isShopStillInstalled(selected.shop), true);
  const stored = await db.session.findUniqueOrThrow({ where: { id: "offline_" + selected.shop } });
  assert.equal(stored.accessToken, "synthetic-new-access-0221"); assert.equal(stored.refreshToken, "synthetic-new-refresh-0221");
  assert.equal(stored.isOnline, false); assert.equal(stored.scope, "read_products"); assert.equal(stored.state, "");
  assert.ok(stored.expires.getTime() >= started + 3599000 && stored.expires.getTime() <= Date.now() + 3601000);
  assert.ok(stored.refreshTokenExpires.getTime() >= started + 86399000 && stored.refreshTokenExpires.getTime() <= Date.now() + 86401000);
  for (const f of [unavailable, unrelated]) assert.deepEqual((await rows()).find((r) => r.shop === f.shop), beforeRows.find((r) => r.shop === f.shop));
  const afterRefresh = await rows();
  assert.equal(await probe.isShopStillInstalled(selected.shop), true);
  assert.deepEqual(await rows(), afterRefresh, "Second read reuses the stored unexpired token without rewriting");
  await assert.rejects(() => probe.isShopStillInstalled(unavailable.shop), (e) => e instanceof Response && e.status === 500);
  assert.deepEqual(await rows(), afterRefresh, "Unknown upstream refresh failure must not delete or rotate any Session");
  assert.deepEqual(calls.map((c) => c.operation), ["refresh", "read-install-probe", "read-install-probe", "refresh"]);
  assert.equal(await db.session.count({ where: { shop: { in: fixtures.map((f) => f.shop) } } }), fixtures.length);
});
