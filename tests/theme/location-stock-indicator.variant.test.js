import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";

// バリアントの切り替え（#20 §3・#26）を合成の DOM で確かめる。
// 通信は手で返す（遅い応答・順番の逆転・失敗を作れる）。タイマーも手で進める。
const SCRIPT = readFileSync(
  new URL(
    "../../extensions/location-stock-theme/assets/location-stock-indicator.js",
    import.meta.url
  ),
  "utf8"
);

const GENERIC_ERROR = "在庫情報の取得に失敗しました。時間をおいて再度お試しください。";

function makeField(name, value) {
  return { name, value: String(value), form: null };
}

function makeForm({ action = "/cart/add", productId, variantId }) {
  const idField = makeField("id", variantId);
  const pidField = productId != null ? makeField("product-id", productId) : null;
  const form = {
    attrs: { action },
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    elements: {
      namedItem(name) {
        if (name === "id") return idField;
        if (name === "product-id") return pidField;
        return null;
      },
    },
    querySelector(selector) {
      if (selector === '[name="product-id"]') return pidField;
      if (selector.startsWith('[name="id"]')) return idField;
      return null;
    },
  };
  idField.form = form;
  if (pidField) pidField.form = form;
  return { form, idField };
}

function openIndicator(options = {}) {
  const {
    initialVariant = "111",
    variantIds = "111,222,333",
    variantsCount = "3",
    productId = "9001",
    search = "",
    forms = [],
  } = options;
  const requests = [];
  const analytics = [];
  const timers = [];
  const listeners = new Map();
  const windowListeners = new Map();

  const body = {
    classList: { add() {}, remove() {} },
    textContent: "",
    innerHTML: "",
  };
  const rootAttrs = {
    "data-variant-id": initialVariant,
    "data-product-id": productId,
    "data-variant-ids": variantIds,
    "data-variants-count": variantsCount,
  };
  const root = {
    isConnected: true,
    dataset: {
      get variantId() {
        return rootAttrs["data-variant-id"];
      },
      set variantId(v) {
        rootAttrs["data-variant-id"] = String(v);
      },
    },
    getAttribute(name) {
      return rootAttrs[name] ?? null;
    },
    setAttribute(name, v) {
      rootAttrs[name] = String(v);
    },
    querySelector(selector) {
      return selector === ".lsi-body" ? body : null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };
  const boot = {
    textContent: '{"rootId":"stock"}',
    attrs: {},
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    setAttribute(name, v) {
      this.attrs[name] = v;
    },
  };
  const location = { search };
  const document = {
    readyState: "complete",
    getElementById(id) {
      return id === "stock" ? root : null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith("script")) return [boot];
      if (selector.startsWith("form")) return forms.map((f) => f.form);
      return [];
    },
    querySelector() {
      return null;
    },
    addEventListener(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
    },
  };
  const win = {
    location,
    addEventListener(event, handler) {
      if (!windowListeners.has(event)) windowListeners.set(event, []);
      windowListeners.get(event).push(handler);
    },
  };

  class FakeAbortController {
    constructor() {
      this.signal = { aborted: false, onabort: null };
    }
    abort() {
      this.signal.aborted = true;
      if (this.signal.onabort) this.signal.onabort();
    }
  }

  runInNewContext(SCRIPT, {
    document,
    window: win,
    console: { error() {} },
    AbortController: FakeAbortController,
    setTimeout(handler, delay) {
      const timer = { handler, delay, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) {
      if (timer) timer.cleared = true;
    },
    fetch(path, init) {
      const url = new URL(path, "https://store.example");
      if (url.searchParams.has("action")) {
        analytics.push(url.searchParams.get("event"));
        return Promise.resolve({ ok: true });
      }
      return new Promise((resolve, reject) => {
        const req = {
          id: url.searchParams.get("variant_id"),
          signal: init && init.signal,
          fail: reject,
          respond(payload) {
            resolve({ ok: true, json: async () => payload });
          },
        };
        if (req.signal) {
          req.signal.onabort = () => reject(new Error("AbortError"));
        }
        requests.push(req);
      });
    },
  });

  function fire(event, payload) {
    (listeners.get(event) || []).forEach((h) => h(payload));
  }
  function pending(delay) {
    return timers.filter((t) => !t.cleared && t.delay === delay);
  }
  function runTimers(delay) {
    const due = pending(delay);
    due.forEach((t) => {
      t.cleared = true;
      t.handler();
    });
  }
  return {
    requests,
    analytics,
    body,
    root,
    location,
    pending,
    runTimers,
    ids() {
      return requests.map((r) => r.id);
    },
    select(id, eventName = "variant:change") {
      fire(eventName, { detail: { variant: { id } } });
    },
    fire,
    changeField(field) {
      fire("change", { target: field });
    },
    popstate() {
      (windowListeners.get("popstate") || []).forEach((h) => h({}));
    },
  };
}

const row = (locationName) => ({
  ok: true,
  stocks: [{ locationName, quantity: 7 }],
  config: {},
});

describe("variant switching race (A→B→A)", () => {
  it("keeps the latest A when the stale B and the first A answer late", async () => {
    const ind = openIndicator();
    ind.select(222);
    ind.select(111);
    assert.deepEqual(ind.ids(), ["111", "222", "111"]);

    const [firstA, b, currentA] = ind.requests;
    currentA.respond(row("Latest A"));
    await setImmediate();
    assert.match(ind.body.innerHTML, /Latest A/);
    const latest = ind.body.innerHTML;

    b.respond(row("Stale B"));
    firstA.respond(row("Stale A"));
    await setImmediate();
    assert.equal(ind.body.innerHTML, latest);
    assert.deepEqual(ind.analytics, ["area_display"]);
  });

  it("aborts the previous request when a new variant is selected", () => {
    const ind = openIndicator();
    ind.select(222);
    assert.equal(ind.requests[0].signal.aborted, true);
    assert.equal(ind.requests[1].signal.aborted, false);
  });

  it("ignores a stale failure: no error text and no retry", async () => {
    const ind = openIndicator();
    ind.select(222);
    ind.select(111);
    const [firstA, b, currentA] = ind.requests;
    currentA.respond(row("Latest A"));
    await setImmediate();
    const before = ind.body.innerHTML;
    b.fail(new Error("offline"));
    firstA.respond({ ok: false, error: "graphql_error", message: "old" });
    await setImmediate();
    assert.equal(ind.body.innerHTML, before);
    assert.equal(ind.pending(3000).length, 0);
  });

  it("drops a scheduled retry after switching away and back", async () => {
    const ind = openIndicator();
    ind.requests[0].respond({ ok: false, error: "graphql_error" });
    await setImmediate();
    assert.equal(ind.body.textContent, GENERIC_ERROR);
    assert.equal(ind.pending(3000).length, 1);
    const retry = ind.pending(3000)[0];

    ind.select(222);
    ind.select(111);
    assert.equal(retry.cleared, true);
    // 予約が残っていても、走らせたときに古い選択なら通信しない
    retry.handler();
    assert.deepEqual(ind.ids(), ["111", "222", "111"]);
  });

  it("a late B response does not overwrite A after B's retry was scheduled", async () => {
    const ind = openIndicator();
    ind.requests[0].respond(row("A"));
    await setImmediate();
    ind.select(222);
    ind.requests[1].respond({ ok: false, error: "upstream_inventory_unavailable" });
    await setImmediate();
    assert.equal(ind.pending(3000).length, 1);
    const retryB = ind.pending(3000)[0];
    ind.select(111);
    ind.requests[2].respond(row("A again"));
    await setImmediate();
    retryB.handler();
    await setImmediate();
    assert.deepEqual(ind.ids(), ["111", "222", "111"]);
    assert.match(ind.body.innerHTML, /A again/);
  });

  it("retries the current selection once, then recovers on another variant", async () => {
    const ind = openIndicator();
    ind.requests[0].fail(new Error("offline"));
    await setImmediate();
    ind.runTimers(3000);
    assert.deepEqual(ind.ids(), ["111", "111"]);
    ind.requests[1].fail(new Error("still offline"));
    await setImmediate();
    assert.equal(ind.pending(3000).length, 0);
    assert.equal(ind.body.textContent, GENERIC_ERROR);

    ind.select(222);
    ind.requests[2].respond(row("B ok"));
    await setImmediate();
    assert.match(ind.body.innerHTML, /B ok/);
  });

  it("does not retry a permanent reason and shows the server message", async () => {
    const ind = openIndicator();
    ind.requests[0].respond({
      ok: false,
      error: "plan_required",
      message: "料金プランを選択すると在庫が表示されます。",
    });
    await setImmediate();
    assert.equal(ind.body.textContent, "料金プランを選択すると在庫が表示されます。");
    assert.equal(ind.pending(3000).length, 0);
  });

  it("uses the shop's error message for a temporary reason even if the server sends one", async () => {
    const ind = openIndicator();
    ind.requests[0].respond({ ok: false, error: "internal_error", message: "boom" });
    await setImmediate();
    assert.equal(ind.body.textContent, GENERIC_ERROR);
    assert.equal(ind.pending(3000).length, 1);
  });
});

describe("variant detection across themes", () => {
  it("numeric events, gid strings and form strings share one request", () => {
    const { form, idField } = makeForm({ productId: "9001", variantId: "111" });
    const ind = openIndicator({ forms: [{ form }] });
    ind.select(222);
    ind.select("gid://shopify/ProductVariant/222");
    idField.value = "222";
    ind.changeField(idField);
    assert.deepEqual(ind.ids(), ["111", "222"]);
  });

  it("accepts other theme event shapes (variant:update / resource, variantId)", () => {
    const ind = openIndicator();
    ind.fire("variant:update", { detail: { resource: { id: 222 } } });
    ind.fire("on:variant:change", { detail: { variantId: "333" } });
    assert.deepEqual(ind.ids(), ["111", "222", "333"]);
  });

  it("ignores variants of other products (recommendations / quick add)", () => {
    const main = makeForm({ productId: "9001", variantId: "111" });
    const other = makeForm({ productId: "7777", variantId: "555" });
    const ind = openIndicator({ forms: [other, main] });
    ind.select(555);
    other.idField.value = "556";
    ind.changeField(other.idField);
    assert.deepEqual(ind.ids(), ["111"]);
    main.idField.value = "333";
    ind.changeField(main.idField);
    assert.deepEqual(ind.ids(), ["111", "333"]);
  });

  it("follows any of several product forms, even ones without product-id", () => {
    const first = makeForm({ variantId: "111" });
    const second = makeForm({ action: "/en/cart/add", variantId: "111" });
    const ind = openIndicator({ forms: [first, second] });
    second.idField.value = "222";
    ind.changeField(second.idField);
    assert.deepEqual(ind.ids(), ["111", "222"]);
  });

  it("starts from ?variant= in the URL when it belongs to this product", () => {
    const ind = openIndicator({ search: "?variant=333" });
    assert.deepEqual(ind.ids(), ["333"]);
    const other = openIndicator({ search: "?variant=999" });
    assert.deepEqual(other.ids(), ["111"]);
  });

  it("picks up a silent change of the id field or the URL after an option change", () => {
    const main = makeForm({ productId: "9001", variantId: "111" });
    const ind = openIndicator({ forms: [main] });
    // オプションのボタンを押した → テーマが name="id" を change なしで書きかえる
    main.idField.value = "222";
    ind.changeField({ name: "Color", value: "Red" });
    ind.runTimers(50);
    assert.deepEqual(ind.ids(), ["111", "222"]);
    // URL だけ変わる（戻る・進む）
    ind.location.search = "?variant=333";
    ind.popstate();
    ind.runTimers(50);
    assert.deepEqual(ind.ids(), ["111", "222", "333"]);
  });

  it("a lagging form does not pull the display back after an event switched it", () => {
    const main = makeForm({ productId: "9001", variantId: "111" });
    const ind = openIndicator({ forms: [main] });
    ind.select(222);
    // フォームはまだ 111 のまま。読みに行っても 111 には戻さない
    ind.changeField({ name: "Size", value: "M" });
    ind.runTimers(50);
    ind.runTimers(300);
    assert.deepEqual(ind.ids(), ["111", "222"]);
  });

  it("accepts unknown variants when the product has more variants than Liquid lists", () => {
    const ids = Array.from({ length: 250 }, (_, i) => String(1000 + i)).join(",");
    const ind = openIndicator({ initialVariant: "1000", variantIds: ids, variantsCount: "600" });
    ind.select(5000);
    assert.deepEqual(ind.ids(), ["1000", "5000"]);
  });

  it("stops requesting after the block is removed from the page", () => {
    const ind = openIndicator();
    ind.root.isConnected = false;
    ind.select(222);
    assert.deepEqual(ind.ids(), ["111"]);
  });
});
