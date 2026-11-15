import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { runInNewContext } from "node:vm";

const asset = readFileSync(new URL("../../extensions/location-stock-theme/assets/location-stock-indicator.js", import.meta.url), "utf8");

function openStockIndicator() {
  const requests = [];
  const analytics = [];
  const retryTimers = [];
  const listeners = new Map();
  const input = { addEventListener(event, handler) { this.onChange = handler; } };
  const body = { classList: { add() {}, remove() {} }, textContent: "", innerHTML: "" };
  const root = {
    dataset: { variantId: "111" },
    querySelector(selector) { return selector === ".lsi-body" ? body : null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const boot = { textContent: '{"rootId":"stock"}', getAttribute() {}, setAttribute() {} };
  const document = {
    getElementById(id) { return id === "stock" ? root : null; },
    querySelectorAll() { return [boot]; },
    querySelector() { return input; },
    addEventListener(event, handler) { listeners.set(event, handler); },
  };
  runInNewContext(asset, {
    document,
    window: { addEventListener() {} },
    console: { error() {} },
    setTimeout(handler, delay) {
      if (delay === 3000) retryTimers.push(handler);
    },
    fetch(path) {
      const url = new URL(path, "https://store.example");
      if (url.searchParams.has("action")) {
        analytics.push(url.searchParams.get("event"));
        return Promise.resolve({ ok: true });
      }
      return new Promise((resolve, reject) => requests.push({
        id: url.searchParams.get("variant_id"),
        fail: reject,
        respond(payload) { resolve({ ok: true, json: async () => payload }); },
      }));
    },
  });
  return {
    requests, analytics, retryTimers, body,
    select(id) { listeners.get("variant:change")({ detail: { variant: { id } } }); },
    formChange(id) { input.value = id; input.onChange(); },
  };
}

const row = (locationName) => ({ stocks: [{ locationName, quantity: 7 }] });

test("an earlier B or earlier A cannot replace the latest A stock or count another display", async () => {
  const indicator = openStockIndicator();
  indicator.select(222);
  indicator.select(111);
  assert.deepEqual(indicator.requests.map(r => r.id), ["111", "222", "111"]);

  const [firstA, b, currentA] = indicator.requests;
  currentA.respond(row("Latest A"));
  await setImmediate();
  assert.match(indicator.body.innerHTML, /Latest A/);
  const latestHtml = indicator.body.innerHTML;
  b.respond(row("Stale B"));
  firstA.respond(row("Stale A"));
  await setImmediate();
  assert.equal(indicator.body.innerHTML, latestHtml);
  assert.deepEqual(indicator.analytics, ["area_display"]);
});

test("numeric variant events and string form changes reuse the same request", () => {
  const indicator = openStockIndicator();
  indicator.select(222);
  indicator.formChange("222");
  assert.deepEqual(indicator.requests.map(r => r.id), ["111", "222"]);
});

test("an obsolete failure cannot show an error or schedule a retry", async () => {
  const indicator = openStockIndicator();
  indicator.select(222);
  indicator.select(111);
  const [firstA, b, currentA] = indicator.requests;
  currentA.respond(row("Latest A"));
  await setImmediate();
  const before = indicator.body.textContent;
  b.fail(new Error("offline"));
  firstA.respond({ ok: false, error: "plan_required", message: "old error" });
  await setImmediate();
  assert.equal(indicator.body.textContent, before);
  assert.equal(indicator.retryTimers.length, 0);
  assert.deepEqual(indicator.analytics, ["area_display"]);
});

test("a scheduled retry is discarded after switching away and back", async () => {
  const indicator = openStockIndicator();
  indicator.requests[0].fail(new Error("offline"));
  await setImmediate();
  assert.equal(indicator.retryTimers.length, 1);
  indicator.select(222);
  indicator.select(111);
  indicator.retryTimers.shift()();
  assert.deepEqual(indicator.requests.map(r => r.id), ["111", "222", "111"]);
});

test("the current selection still retries once, and a permanent failure never retries", async () => {
  const indicator = openStockIndicator();
  indicator.requests[0].fail(new Error("offline"));
  await setImmediate();
  assert.equal(indicator.retryTimers.length, 1);
  indicator.retryTimers.shift()();
  assert.deepEqual(indicator.requests.map(r => r.id), ["111", "111"]);
  indicator.requests[1].fail(new Error("still offline"));
  await setImmediate();
  assert.equal(indicator.retryTimers.length, 0);
  indicator.select(222);
  indicator.requests[2].respond({ ok: false, error: "plan_required", message: "Plan needed" });
  await setImmediate();
  assert.equal(indicator.body.textContent, "Plan needed");
  assert.equal(indicator.retryTimers.length, 0);
});
