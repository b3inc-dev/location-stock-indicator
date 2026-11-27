import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { createHmac } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { createServer } from "vite";
import "@shopify/shopify-api/adapters/node";
import { setAbstractFetchFunc } from "@shopify/shopify-api/runtime";
import { isolatedPostgresUrl } from "./helpers/isolated-pg-guard.mjs";

const db = new PrismaClient({ datasources: { db: { url: isolatedPostgresUrl() } } });
const SECRET = "synthetic-compliance-reinstall-0026";
const fixtures = ["installed", "removed", "uncertain", "online-only", "unrelated"].map((kind) => ({
  kind, shop: `compliance-${kind}-0026.myshopify.com`, token: `synthetic-${kind}-0026`,
}));
const calls = [];
const envKeys = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SCOPES", "APP_DISTRIBUTION"];
const priorEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]));
let vite, route, oldFetch;

function requestFor(f, topic = "shop/redact") {
  const body = JSON.stringify({ shop_domain: f.shop });
  return new Request("https://synthetic-app.invalid/webhooks/compliance", {
    method: "POST", body,
    headers: {
      "content-type": "application/json", "x-shopify-shop-domain": f.shop,
      "x-shopify-topic": topic, "x-shopify-api-version": "2025-10",
      "x-shopify-webhook-id": `synthetic-${f.kind}-0026`,
      "x-shopify-hmac-sha256": createHmac("sha256", SECRET).update(body).digest("base64"),
    },
  });
}

async function syntheticFetch(input, init) {
  const req = new Request(input, init), url = new URL(req.url);
  const f = fixtures.find((x) => x.shop === url.hostname);
  assert.ok(f, "Only these exact synthetic tenant endpoints are permitted");
  assert.equal(req.method, "POST");
  assert.equal(url.pathname, "/admin/api/2026-07/graphql.json");
  assert.equal(req.headers.get("x-shopify-access-token"), f.token);
  const wire = JSON.parse(await req.text());
  assert.match(wire.query, /query ComplianceInstallProbe/);
  assert.doesNotMatch(wire.query, /\bmutation\b/i);
  calls.push({ kind: f.kind, operation: "ComplianceInstallProbe" });
  if (f.kind === "removed") return Response.json({ errors: "Unauthorized" }, { status: 401 });
  if (f.kind === "uncertain") return Response.json({ errors: "Forbidden" }, { status: 403 });
  assert.equal(f.kind, "installed", "No lookup is allowed for online-only or unrelated sessions");
  return Response.json({ data: { shop: { id: "gid://shopify/Shop/260028" } } }, {
    headers: { "x-shopify-api-version": "2025-10" },
  });
}

before(async () => {
  Object.assign(process.env, {
    SHOPIFY_API_KEY: "0123456789abcdef0123456789abcdef", SHOPIFY_API_SECRET: SECRET,
    SHOPIFY_APP_URL: "https://synthetic-app.invalid", SCOPES: "read_products", APP_DISTRIBUTION: "public",
  });
  globalThis.prismaGlobal = db;
  oldFetch = globalThis.fetch; globalThis.fetch = syntheticFetch; setAbstractFetchFunc(syntheticFetch);
  for (const f of fixtures) {
    // No expiring or refreshable credentials: this test exercises the existing install probe, not token refresh.
    await db.session.create({ data: {
      id: (f.kind === "online-only" ? "online_" : "offline_") + f.shop,
      shop: f.shop, state: "synthetic", isOnline: f.kind === "online-only",
      scope: "read_products", accessToken: f.token,
    } });
  }
  vite = await createServer({ configFile: false, appType: "custom", server: { middlewareMode: true, hmr: false } });
  route = await vite.ssrLoadModule("/app/routes/webhooks.compliance.jsx");
  setAbstractFetchFunc(syntheticFetch);
});

after(async () => {
  try { await db.session.deleteMany({ where: { shop: { in: fixtures.map((f) => f.shop) } } }); }
  finally {
    await vite?.close(); await db.$disconnect(); delete globalThis.prismaGlobal;
    globalThis.fetch = oldFetch; setAbstractFetchFunc(oldFetch);
    for (const k of envKeys) { if (priorEnv[k] === undefined) delete process.env[k]; else process.env[k] = priorEnv[k]; }
  }
});

test("LOC-COMPLIANCE-PG-001: actual signed action and install probe preserve reinstalled/uncertain tenants and delete only removed tenant sessions", async () => {
  const allRows = () => db.session.findMany({ where: { shop: { in: fixtures.map((f) => f.shop) } }, orderBy: { shop: "asc" } });
  const beforeRows = await allRows();
  const [installed, removed, uncertain, onlineOnly, unrelated] = fixtures;
  assert.equal((await route.action({ request: requestFor(installed) })).status, 200);
  assert.deepEqual(await allRows(), beforeRows, "Reinstallation protects every existing row");
  assert.equal((await route.action({ request: requestFor(uncertain) })).status, 500);
  assert.deepEqual(await allRows(), beforeRows, "Unknown installation state requests retry without deleting");
  assert.equal((await route.action({ request: requestFor(removed) })).status, 200);
  assert.equal(await db.session.count({ where: { shop: removed.shop } }), 0);
  assert.equal((await route.action({ request: requestFor(onlineOnly) })).status, 200);
  assert.equal(await db.session.count({ where: { shop: onlineOnly.shop } }), 0);
  const retained = beforeRows.filter((row) => row.shop !== removed.shop && row.shop !== onlineOnly.shop);
  assert.deepEqual(await allRows(), retained, "Only the selected tenants' Session rows may change");
  assert.equal((await route.action({ request: requestFor(unrelated, "customers/redact") })).status, 200);
  assert.deepEqual(await allRows(), retained, "Customer redaction does not delete the app's shop sessions");
  assert.ok(calls.some((c) => c.kind === "installed"));
  assert.ok(calls.some((c) => c.kind === "removed"));
  assert.ok(calls.some((c) => c.kind === "uncertain"));
  assert.ok(calls.every((c) => ["installed", "removed", "uncertain"].includes(c.kind)));
});
