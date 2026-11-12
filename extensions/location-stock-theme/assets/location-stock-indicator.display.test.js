import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(
  new URL("./location-stock-indicator.js", import.meta.url)
);
const SCRIPT = readFileSync(SCRIPT_PATH, "utf8");

const GENERIC_ERROR =
  "在庫情報の取得に失敗しました。時間をおいて再度お試しください。";
const EMPTY_MESSAGE = "現在、この商品の店舗在庫はありません。";
const SECRET = "signature=deadbeef&logged_in_customer_id=9";

class ClassList {
  constructor() {
    this.names = new Set();
  }
  add(...items) {
    items.forEach((name) => this.names.add(name));
  }
  remove(...items) {
    items.forEach((name) => this.names.delete(name));
  }
  contains(name) {
    return this.names.has(name);
  }
}

class El {
  constructor(tag) {
    this.tag = tag;
    this.attrs = new Map();
    this.children = [];
    this.classList = new ClassList();
    this.style = {};
    this.id = "";
    this.textContent = "";
    this.innerHTML = "";
  }

  append(child) {
    child.parent = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name, value) {
    this.attrs.set(name, String(value));
    if (name === "id") this.id = String(value);
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }

  addEventListener() {}

  get dataset() {
    const el = this;
    return {
      get variantId() {
        return el.getAttribute("data-variant-id");
      },
      set variantId(value) {
        el.setAttribute("data-variant-id", value);
      },
    };
  }

  querySelectorAll(selector) {
    const found = [];
    const parts = String(selector)
      .split(",")
      .map((part) => part.trim());
    const visit = (node) => {
      node.children.forEach((child) => {
        if (parts.some((part) => matches(child, part))) found.push(child);
        visit(child);
      });
    };
    visit(this);
    return found;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function matches(el, selector) {
  if (selector === ".lsi-body") return el.classList.contains("lsi-body");
  if (selector === ".lsi-legend") return el.classList.contains("lsi-legend");
  if (selector === ".lsi-notice") return el.classList.contains("lsi-notice");
  if (selector === '[data-role="legend"]') {
    return el.getAttribute("data-role") === "legend";
  }
  if (selector === '[data-role="notice"]') {
    return el.getAttribute("data-role") === "notice";
  }
  if (selector === 'script[type="application/json"][data-lsi-boot]') {
    return (
      el.tag === "script" &&
      el.getAttribute("type") === "application/json" &&
      el.hasAttribute("data-lsi-boot")
    );
  }
  if (selector === ".lsi-nearby-header") {
    return el.classList.contains("lsi-nearby-header");
  }
  return false;
}

function element(tag, attrs, className) {
  const node = new El(tag);
  if (className) className.split(/\s+/).forEach((name) => node.classList.add(name));
  Object.entries(attrs || {}).forEach(([name, value]) => node.setAttribute(name, value));
  return node;
}

const BOOT = {
  rootId: "lsi-synthetic",
  layoutType: "list",
  inStockColor: "#111111",
  lowStockColor: "#222222",
  outOfStockColor: "#333333",
  locationColWidth: 70,
  legendPosition: "bottom",
  noticePosition: "bottom",
  noticeAlign: "left",
  rowPaddingY: 8,
  accordionIcon: "chevron",
  regionHeadingBackground: "",
  regionHeadingColor: "",
  regionHeadingFontSize: "",
  regionHeadingPadding: "",
  regionHeadingAlign: "left",
  orderPickBtnStyle: "solid_round",
  orderPickBtnAlign: "right",
  orderPickColWidth: 25,
  orderPickBtnPadding: "",
  orderPickBtnFontSize: "",
  orderPickBtnBackground: "",
  orderPickBtnColor: "",
};

async function renderIndicator(response) {
  const document = new El("document");
  const root = element("div", { id: "lsi-synthetic", "data-variant-id": "1001" });
  root.id = "lsi-synthetic";
  root.append(
    element("div", { "data-role": "legend", "data-legend-position": "bottom" }, "lsi-legend")
  );
  root.append(
    element("div", { "data-role": "notice", "data-notice-position": "bottom" }, "lsi-notice")
  );
  const body = element("div", {}, "lsi-body lsi-message--loading");
  body.textContent = "在庫を読み込み中...";
  root.append(body);
  const boot = element(
    "script",
    { type: "application/json", "data-lsi-boot": "" },
    ""
  );
  boot.textContent = JSON.stringify(BOOT);
  document.append(root);
  document.append(boot);

  const calls = [];
  const logs = [];
  const sandbox = {
    console: {
      error(...args) {
        logs.push(
          args
            .map((item) => (item instanceof Error ? item.message : String(item)))
            .join(" ")
        );
      },
    },
    setTimeout(fn, delay) {
      if (!delay) queueMicrotask(fn);
      return 0;
    },
    clearTimeout() {},
    queueMicrotask,
    addEventListener() {},
    fetch(url) {
      calls.push(String(url));
      return Promise.resolve({
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => response.body,
        text: async () => response.text || "",
      });
    },
  };
  sandbox.window = sandbox;
  sandbox.document = {
    readyState: "complete",
    getElementById(id) {
      const found = [];
      const visit = (node) => {
        node.children.forEach((child) => {
          found.push(child);
          visit(child);
        });
      };
      visit(document);
      return found.find((node) => node.id === id || node.getAttribute("id") === id) || null;
    },
    querySelector(selector) {
      return document.querySelector(selector);
    },
    querySelectorAll(selector) {
      return document.querySelectorAll(selector);
    },
    addEventListener() {},
  };
  const context = createContext(sandbox);
  try {
    runInContext(SCRIPT, context);
  } catch (error) {
    throw new Error(`indicator script failed: ${error && error.stack ? error.stack : error}`);
  }
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => {
      queueMicrotask(resolve);
    });
  }
  return { body, calls, logs, root };
}

function assertNoSecret(value) {
  const text = String(value);
  assert.equal(text.includes("deadbeef"), false);
  assert.equal(text.includes("logged_in_customer_id"), false);
  assert.equal(text.includes("[object Response]"), false);
}

describe("location stock storefront display", () => {
  it("shows the generic error for an expected non-OK response and hides its body", async () => {
    const { body, calls, logs } = await renderIndicator({
      status: 400,
      body: null,
      text: SECRET,
    });

    assert.equal(body.textContent, GENERIC_ERROR);
    assert.equal(body.classList.contains("lsi-message--error"), true);
    assertNoSecret(body.textContent);
    assertNoSecret(logs.join("\n"));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].includes("variant_id=1001"), true);
  });

  it("shows the generic error for an unexpected internal_error payload", async () => {
    const { body, logs } = await renderIndicator({
      status: 200,
      body: {
        ok: false,
        error: "internal_error",
        message: `[object Response] ${SECRET}`,
      },
    });

    assert.equal(body.textContent, GENERIC_ERROR);
    assert.equal(body.classList.contains("lsi-message--error"), true);
    assertNoSecret(body.textContent);
    assertNoSecret(body.innerHTML);
    assertNoSecret(logs.join("\n"));
    assert.equal(logs.some((line) => line.includes("internal_error")), true);
  });

  it("shows the generic error for a plan_required payload on the current theme", async () => {
    const { body } = await renderIndicator({
      status: 200,
      body: {
        ok: false,
        error: "plan_required",
        message: "料金プランを選択すると在庫が表示されます。",
      },
    });

    assert.equal(body.textContent, GENERIC_ERROR);
    assert.equal(body.textContent.includes("料金プラン"), false);
  });

  it("shows the empty message when synthetic stocks are empty", async () => {
    const { body } = await renderIndicator({
      status: 200,
      body: {
        ok: true,
        variantId: "1001",
        stocks: [],
        config: {},
      },
    });

    assert.equal(body.textContent, EMPTY_MESSAGE);
    assert.equal(body.classList.contains("lsi-message--empty"), true);
  });

  it("renders synthetic stock symbols and keeps the legend labels", async () => {
    const { body, root } = await renderIndicator({
      status: 200,
      body: {
        ok: true,
        variantId: "1001",
        stocks: [
          {
            locationId: "gid://shopify/Location/1",
            locationName: "合成店舗A",
            displayName: "合成店舗A",
            quantity: 8,
            fulfillsOnlineOrders: true,
          },
          {
            locationId: "gid://shopify/Location/2",
            locationName: "合成店舗B",
            displayName: "合成店舗B",
            quantity: 2,
            fulfillsOnlineOrders: true,
          },
          {
            locationId: "gid://shopify/Location/3",
            locationName: "合成店舗C",
            displayName: "合成店舗C",
            quantity: 0,
            fulfillsOnlineOrders: false,
          },
        ],
        config: {},
      },
    });

    assert.equal(body.innerHTML.includes("合成店舗A"), true);
    assert.equal(body.innerHTML.includes("合成店舗B"), true);
    assert.equal(body.innerHTML.includes("合成店舗C"), true);
    assert.equal(body.innerHTML.includes("◯"), true);
    assert.equal(body.innerHTML.includes("△"), true);
    assert.equal(body.innerHTML.includes("✕"), true);
    assert.equal(body.innerHTML.includes("(8)"), true);
    assert.equal(body.innerHTML.includes("(2)"), true);
    assert.equal(body.innerHTML.includes("(0)"), true);
    const legend = root.querySelector(".lsi-legend");
    assert.equal(legend.textContent.includes("在庫あり"), true);
    assert.equal(legend.textContent.includes("残りわずか"), true);
    assert.equal(legend.textContent.includes("在庫なし"), true);
    assert.equal(body.textContent.includes(GENERIC_ERROR), false);
    assert.equal(body.classList.contains("lsi-message--error"), false);
  });
});
