// POS Lite の安全のための 2 つの試験（#76 の 3 回目の見直し 7084505690 の「気になること」1・2）。
// (a) 送料の行に印を付けられなかったあと、もう一度「配送を確定」を押しても送料の行が二重にならない。
// (b) orders/paid の処理が印を残さずに終わった注文を拾い直し、「要確認」に出す（既定オフ。オフのときは書かない）。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DELIVERY_ATTRIBUTE,
  FEE_PROPERTY,
  HANDOFF_KEY,
  RESCAN_MIN_AGE_MS,
  REVIEW_KEY,
  REVIEW_TAG,
  messageFor,
  missedPaidCandidate,
  parseConfig,
  planFeeLine,
  unmarkedFeeLines,
  validateConfig,
} from "../../extensions/pos-lite/src/logic.js";
import { applyFee } from "../../extensions/pos-lite/src/modal.js";
import { RESCAN_MAX_PAGES, rescanMissedOrders } from "./posLiteSale.js";

const CONFIG = parseConfig({ deliveryEnabled: true, locations: [{ locationId: "101", enabled: true, warehouseLocationId: "202", shippingFee: 800, shippingTitle: "送料" }] });
const PRODUCT = { uuid: "p1", variantId: 9, title: "T シャツ", price: 3000, quantity: 3, properties: {} };
const marked = (uuid, price = 800) => ({ uuid, variantId: null, title: "送料", price, quantity: 1, taxable: true, properties: { [FEE_PROPERTY]: "1" } });
const unmarked = (uuid, price = 800) => ({ uuid, variantId: null, title: "送料", price, quantity: 1, taxable: true, properties: {} });

// ---------------------------------------------------------------------------
// (a) planFeeLine（決めるだけ）
// ---------------------------------------------------------------------------

test("planFeeLine: アプリが足して印を付けられなかった行は、足さずにその行へ印を付ける", () => {
  const plan = planFeeLine([PRODUCT, unmarked("u1")], "送料", 800, true, { ownUnmarked: new Set(["u1"]) });
  assert.deepEqual(plan, { remove: [], add: null, adopt: "u1", conflict: [] });
});

test("planFeeLine: アプリの行でも送料・税が変わっていたら消して入れ直す", () => {
  const plan = planFeeLine([PRODUCT, unmarked("u1", 500)], "送料", 800, true, { ownUnmarked: ["u1"] });
  assert.deepEqual(plan.remove, ["u1"]);
  assert.deepEqual(plan.add, { title: "送料", price: "800.00", quantity: 1, taxable: true });
  assert.equal(plan.adopt, null);
  const taxChanged = planFeeLine([PRODUCT, unmarked("u2")], "送料", 800, false, { ownUnmarked: ["u2"] });
  assert.deepEqual(taxChanged.remove, ["u2"]);
  assert.equal(taxChanged.add.taxable, false);
});

test("planFeeLine: 印のある行があるのにアプリの印の無い行も残っていたら、印の無い方を消す（二重を直す）", () => {
  const plan = planFeeLine([PRODUCT, marked("m1"), unmarked("u1")], "送料", 800, true, { ownUnmarked: ["u1"] });
  assert.deepEqual(plan, { remove: ["u1"], add: null, adopt: null, conflict: [] });
});

test("planFeeLine: アプリの行と分からない、印の無い同じ名前の行があれば足さずに止める（消さない・印も付けない）", () => {
  const plan = planFeeLine([PRODUCT, unmarked("x1")], "送料", 800, true, { ownUnmarked: new Set() });
  assert.deepEqual(plan, { remove: [], add: null, adopt: null, conflict: ["x1"] });
  // 名前の違う手入れの行は関係ない
  const other = planFeeLine([PRODUCT, { ...unmarked("x2"), title: "ギフト包装" }], "送料", 800);
  assert.deepEqual(other.conflict, []);
  assert.ok(other.add);
  // 商品の行は送料の行と見なさない
  assert.deepEqual(planFeeLine([{ ...PRODUCT, title: "送料" }], "送料", 800).conflict, []);
});

test("planFeeLine: 配送を取り消す（送料 0）ときは、アプリが足した印の無い行も消す。手入れの行は消さない", () => {
  const plan = planFeeLine([PRODUCT, marked("m1"), unmarked("u1"), unmarked("x1")], "送料", 0, true, { ownUnmarked: ["u1"] });
  assert.deepEqual(plan.remove.sort(), ["m1", "u1"]);
  assert.equal(plan.add, null);
  assert.deepEqual(plan.conflict, []);
});

test("planFeeLine: 何も無いカートは今までどおり 1 行足す", () => {
  assert.deepEqual(planFeeLine([PRODUCT], "送料", 800), { remove: [], add: { title: "送料", price: "800.00", quantity: 1, taxable: true }, adopt: null, conflict: [] });
});

// ---------------------------------------------------------------------------
// (a) applyFee（POS のカートの代わりを使って、「確定」を 2 回押す流れ）
// ---------------------------------------------------------------------------

function fakeCart(lines, { failMarks = 0, returnUuid = false, dropAdd = false } = {}) {
  const cart = { lineItems: structuredClone(lines) };
  let next = 1;
  let fails = failMarks;
  const calls = [];
  globalThis.shopify = {
    cart: {
      current: { get value() { return cart; } },
      async addCustomSale(input) {
        calls.push("add");
        const uuid = `new-${next++}`;
        if (dropAdd) return undefined; // 足したことになったのに、カートに行が出ない
        cart.lineItems = [...cart.lineItems, { uuid, variantId: null, title: input.title, price: Number(input.price), quantity: input.quantity, taxable: input.taxable, properties: {} }];
        return returnUuid ? uuid : undefined;
      },
      async removeLineItem(uuid) {
        calls.push(`remove:${uuid}`);
        cart.lineItems = cart.lineItems.filter((line) => line.uuid !== uuid);
      },
      async addLineItemProperties(uuid, props) {
        calls.push(`mark:${uuid}`);
        if (fails > 0) {
          fails -= 1;
          throw new Error("通信が切れました");
        }
        const line = cart.lineItems.find((l) => l.uuid === uuid);
        line.properties = { ...line.properties, ...props };
      },
    },
  };
  return { cart, calls };
}

const feeLines = (cart) => cart.lineItems.filter((line) => !line.variantId && line.title === "送料");

test("applyFee: 印付けに失敗 → もう一度確定しても、送料の行は 1 つのまま（印が付く）", async () => {
  const { cart, calls } = fakeCart([PRODUCT], { failMarks: 1 });
  await assert.rejects(applyFee("送料", 800, CONFIG), /印を付けられませんでした.*送料の行は増えません/);
  assert.equal(feeLines(cart).length, 1, "1 回目のあと、印の無い送料の行が 1 つ残る");
  assert.equal(feeLines(cart)[0].properties[FEE_PROPERTY], undefined);
  await applyFee("送料", 800, CONFIG);
  assert.equal(feeLines(cart).length, 1, "2 回目は足さない（前は印のある行がもう 1 つ増えて二重だった）");
  assert.equal(feeLines(cart)[0].properties[FEE_PROPERTY], "1");
  assert.equal(calls.filter((c) => c === "add").length, 1);
  // 3 回目（印のある行がもうある）も何もしない
  await applyFee("送料", 800, CONFIG);
  assert.equal(feeLines(cart).length, 1);
  assert.equal(calls.filter((c) => c === "add").length, 1);
});

test("applyFee: 足した行の uuid が返る版でも同じ", async () => {
  const { cart } = fakeCart([PRODUCT], { failMarks: 2, returnUuid: true });
  await assert.rejects(applyFee("送料", 800, CONFIG));
  await assert.rejects(applyFee("送料", 800, CONFIG), "2 回目も印付けに失敗");
  assert.equal(feeLines(cart).length, 1, "失敗が続いても行は増えない");
  await applyFee("送料", 800, CONFIG);
  assert.equal(feeLines(cart).length, 1);
  assert.equal(feeLines(cart)[0].properties[FEE_PROPERTY], "1");
});

test("applyFee: 印付けに失敗したあと配送を取り消すと、その行も消える", async () => {
  const { cart } = fakeCart([PRODUCT], { failMarks: 1 });
  await assert.rejects(applyFee("送料", 800, CONFIG));
  await applyFee("送料", 0, CONFIG);
  assert.equal(feeLines(cart).length, 0);
});

test("applyFee: 覚えていない印の無い「送料」の行（手入れ・画面を開き直したあと）があれば、足さずに止める", async () => {
  const { cart, calls } = fakeCart([PRODUCT, unmarked("hand-1")]);
  await assert.rejects(applyFee("送料", 800, CONFIG), /印の無い「送料」の行があります.*二重にならないように止めました/);
  assert.deepEqual(calls, [], "カートに何もしない");
  assert.equal(feeLines(cart).length, 1);
  assert.equal(feeLines(cart)[0].properties[FEE_PROPERTY], undefined, "手入れの行に印を付けない");
});

test("applyFee: 送料を変えたときは、印のある前の行を消して入れ直す（今までどおり）", async () => {
  const { cart } = fakeCart([PRODUCT, marked("m1", 500)]);
  await applyFee("送料", 800, CONFIG);
  assert.equal(feeLines(cart).length, 1);
  assert.equal(feeLines(cart)[0].price, 800);
  assert.equal(feeLines(cart)[0].properties[FEE_PROPERTY], "1");
});

test("applyFee: 足したあと送料の行が見つからないときは、「確定しました」にせず理由を出して止める", async () => {
  const { cart } = fakeCart([PRODUCT], { dropAdd: true });
  await assert.rejects(applyFee("送料", 800, CONFIG), /「送料」の行をカートで見つけられませんでした/);
  assert.equal(feeLines(cart).length, 0);
});

test("unmarkedFeeLines: 商品の無い同じ名前の印の無い行だけ（配送を取り消すときに残っていれば知らせる）", () => {
  const lines = [PRODUCT, marked("m1"), unmarked("x1"), { ...unmarked("x2"), title: "ギフト包装" }, { ...PRODUCT, uuid: "p2", title: "送料" }];
  assert.deepEqual(unmarkedFeeLines(lines, "送料").map((l) => l.uuid), ["x1"]);
  assert.deepEqual(unmarkedFeeLines([], "送料"), []);
});

test("POS の画面: 配送を取り消したあと印の無い送料の行が残っていれば、注意の色で知らせる", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../extensions/pos-lite/src/modal.js", import.meta.url), "utf8");
  const cancelAt = source.indexOf("await applyFee(row.shippingTitle, 0, state.config);");
  const after = source.slice(cancelAt, cancelAt + 800);
  assert.match(after, /unmarkedFeeLines\(/);
  assert.match(after, /setAttribute\("tone", "warning"\)/);
});

test("POS の画面: 確定はカートに書く前に二重の確かめをする", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../extensions/pos-lite/src/modal.js", import.meta.url), "utf8");
  const confirmAt = source.indexOf("assertNoFeeConflict(built.title");
  const firstWrite = source.indexOf("for (const item of built.lineProperties)");
  assert.ok(confirmAt > 0 && confirmAt < firstWrite, "明細・カートの属性を書く前に止める");
});

// ---------------------------------------------------------------------------
// (b) 拾い直し
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-11-23T12:00:00Z");
const OLD = new Date(NOW - RESCAN_MIN_AGE_MS - 60_000).toISOString();
const delivery = [{ key: DELIVERY_ATTRIBUTE, value: JSON.stringify({ v: 1, mode: "all", from: "202", fee: 800, title: "送料" }) }];

function candidate(overrides = {}) {
  return { sourceName: "pos", createdAt: OLD, cancelledAt: null, tags: [], customAttributes: delivery, handoff: null, ...overrides };
}

test("missedPaidCandidate: 印の無いまま終わった POS の配送の注文だけを拾う", () => {
  assert.equal(missedPaidCandidate(candidate(), NOW), true);
  assert.equal(missedPaidCandidate(candidate({ handoff: JSON.stringify({ salesLocationId: "101" }) }), NOW), true, "記録はあるが済んだ印が無い");
  assert.equal(missedPaidCandidate(candidate({ handoff: "{壊れた" }), NOW), true);
  assert.equal(missedPaidCandidate(candidate({ handoff: JSON.stringify({ completedAt: "2026-11-23T01:00:00Z" }) }), NOW), false, "済んだ印がある");
  assert.equal(missedPaidCandidate(candidate({ tags: [REVIEW_TAG] }), NOW), false, "もう要確認");
  assert.equal(missedPaidCandidate(candidate({ cancelledAt: OLD }), NOW), false, "キャンセル");
  assert.equal(missedPaidCandidate(candidate({ sourceName: "web" }), NOW), false, "POS 以外");
  assert.equal(missedPaidCandidate(candidate({ customAttributes: [] }), NOW), false, "配送の指定なし");
  assert.equal(missedPaidCandidate(candidate({ tags: ["精算"] }), NOW), false, "精算・点検の注文");
  assert.equal(missedPaidCandidate(candidate({ createdAt: new Date(NOW - RESCAN_MIN_AGE_MS + 60_000).toISOString() }), NOW), false, "新しい注文は送り直しの途中かもしれない");
  assert.equal(missedPaidCandidate(candidate({ createdAt: "" }), NOW), false);
});

/** 拾い直しの Shopify の代わり。注文の一覧と、タグ・理由の書き込みを状態に反映する。 */
function fakeOrders(orders, { pageSize = 50, failTag = new Set() } = {}) {
  const state = structuredClone(orders);
  const calls = [];
  const writes = [];
  const request = async (query, variables) => {
    const name = query.match(/(query|mutation)\s+(\w+)/)[2];
    calls.push({ name, variables });
    if (name === "PosLiteRescanOrders") {
      assert.match(variables.query, /source_name:pos/);
      assert.match(variables.query, new RegExp(`tag_not:'${REVIEW_TAG}'`));
      const start = variables.after ? Number(variables.after) : 0;
      const nodes = state
        .filter((o) => !(o.tags || []).includes(REVIEW_TAG))
        .slice(start, start + pageSize)
        .map((o) => ({ ...o, retailLocation: { id: "gid://shopify/Location/101", name: "渋谷店" }, handoff: o.handoff ? { value: o.handoff } : null }));
      const hasNextPage = start + pageSize < state.filter((o) => !(o.tags || []).includes(REVIEW_TAG)).length;
      return { orders: { pageInfo: { hasNextPage, endCursor: hasNextPage ? String(start + pageSize) : null }, nodes } };
    }
    if (name === "PosLiteMetafields") {
      writes.push(name);
      const field = variables.metafields[0];
      const order = state.find((o) => o.id === field.ownerId);
      order.metafields = { ...(order.metafields || {}), [field.key]: field.value };
      return { metafieldsSet: { metafields: [{ id: "m" }], userErrors: [] } };
    }
    if (name === "PosLiteTag") {
      writes.push(name);
      if (failTag.has(variables.id)) return { tagsAdd: { userErrors: [{ message: "だめ" }] } };
      const order = state.find((o) => o.id === variables.id);
      order.tags = [...(order.tags || []), ...variables.tags];
      return { tagsAdd: { userErrors: [] } };
    }
    throw new Error(`知らない呼び出し ${name}`);
  };
  return { request, state, calls, writes };
}

function orders() {
  return [
    { id: "gid://shopify/Order/1", name: "#1001", ...candidate() },
    { id: "gid://shopify/Order/2", name: "#1002", ...candidate({ handoff: JSON.stringify({ completedAt: OLD }) }) },
    { id: "gid://shopify/Order/3", name: "#1003", ...candidate({ customAttributes: [] }) },
    { id: "gid://shopify/Order/4", name: "#1004", ...candidate({ handoff: JSON.stringify({ salesLocationId: "101" }) }) },
  ];
}

test("拾い直し: スイッチが既定（オフ）のときは探すだけで、注文に何も書かない", async () => {
  assert.equal(parseConfig(null).rescanEnabled, false, "既定はオフ");
  assert.equal(parseConfig("{壊れた").rescanEnabled, false);
  const shop = fakeOrders(orders());
  const result = await rescanMissedOrders(shop.request, { config: CONFIG, now: NOW });
  assert.deepEqual(result.found.map((o) => o.name), ["#1001", "#1004"]);
  assert.equal(result.wrote, false);
  assert.equal(result.marked, 0);
  assert.deepEqual(shop.writes, [], "書き込みは 0 回");
  // 期間は直近 7 日
  assert.match(shop.calls[0].variables.query, /created_at:>='2026-11-16T12:00:00.000Z'/);
});

test("拾い直し: 配送の履行（deliveryEnabled）がオフなら、拾い直しのスイッチがオンでも書かない", async () => {
  const shop = fakeOrders(orders());
  const result = await rescanMissedOrders(shop.request, { config: { ...CONFIG, deliveryEnabled: false, rescanEnabled: true }, now: NOW });
  assert.equal(result.wrote, false);
  assert.deepEqual(shop.writes, []);
});

test("拾い直し: スイッチがオンなら要確認のタグと理由を書く。2 回目は同じ注文を拾わない", async () => {
  const shop = fakeOrders(orders());
  const config = { ...CONFIG, rescanEnabled: true };
  const first = await rescanMissedOrders(shop.request, { config, now: NOW });
  assert.equal(first.wrote, true);
  assert.equal(first.marked, 2);
  assert.equal(first.failed, 0);
  for (const id of ["gid://shopify/Order/1", "gid://shopify/Order/4"]) {
    const order = shop.state.find((o) => o.id === id);
    assert.ok(order.tags.includes(REVIEW_TAG));
    assert.equal(order.metafields[REVIEW_KEY], messageFor("missed_paid"));
    assert.equal(order.metafields[HANDOFF_KEY], undefined, "配送の記録には触れない");
  }
  assert.ok(!shop.state.find((o) => o.id === "gid://shopify/Order/2").tags.includes(REVIEW_TAG), "済んだ注文は印を付けない");
  // 書くのはタグと理由だけ（配送・履行・住所の mutation は呼ばない）
  assert.deepEqual([...new Set(shop.writes)].sort(), ["PosLiteMetafields", "PosLiteTag"]);
  const again = await rescanMissedOrders(shop.request, { config, now: NOW });
  assert.equal(again.found.length, 0, "何度呼んでも同じ（cron から呼んでも重ならない）");
});

test("拾い直し: タグを付けられなかった注文は失敗として数え、次の回にもう一度拾う", async () => {
  const shop = fakeOrders(orders(), { failTag: new Set(["gid://shopify/Order/1"]) });
  const config = { ...CONFIG, rescanEnabled: true };
  const result = await rescanMissedOrders(shop.request, { config, now: NOW });
  assert.equal(result.marked, 1);
  assert.equal(result.failed, 1);
  const again = await rescanMissedOrders(fakeOrders(shop.state).request, { config, now: NOW });
  assert.deepEqual(again.found.map((o) => o.name), ["#1001"]);
});

test("拾い直し: 読む件数に上限がある（cron から呼んでも重くならない）", async () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ id: `gid://shopify/Order/${100 + i}`, name: `#${100 + i}`, ...candidate() }));
  const shop = fakeOrders(many, { pageSize: 2 });
  const result = await rescanMissedOrders(shop.request, { config: CONFIG, now: NOW });
  assert.equal(shop.calls.filter((c) => c.name === "PosLiteRescanOrders").length, RESCAN_MAX_PAGES);
  assert.equal(result.truncated, true);
  assert.equal(result.found.length, RESCAN_MAX_PAGES * 2);
});

test("設定: 拾い直しのスイッチは保存した値を読む（オンにするのは T）", () => {
  const { config, errors } = validateConfig({ rescanEnabled: true, locations: [] }, []);
  assert.deepEqual(errors, []);
  assert.equal(config.rescanEnabled, true);
  assert.equal(parseConfig(JSON.stringify(config)).rescanEnabled, true);
  assert.equal(validateConfig({ locations: [] }, []).config.rescanEnabled, false);
});

test("管理画面: 拾い直しのボタンとスイッチがあり、オフのときは書かないと出す", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../routes/app.pos-lite.jsx", import.meta.url), "utf8");
  assert.match(source, /intent === "rescan"/);
  assert.match(source, /name="rescanEnabled"/);
  assert.match(source, /注文には何も書いていません/);
  assert.match(source, /探しています…/, "押したあと終わるまで処理中を出す");
});
