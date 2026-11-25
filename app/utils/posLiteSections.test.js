// 「店頭受取・配送」の設定を 4 つの区分に分けた形の試験（T 11/23 5:10 の案 A）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultConfig, parseConfig } from "../../extensions/pos-lite/src/logic.js";
import {
  POS_LITE_SECTIONS,
  POS_LITE_SECTION_KEYS,
  isPosLiteSection,
  mergeSection,
  sectionInputFromForm,
  sectionPath,
  sectionSummary,
} from "./posLiteSections.js";

const LOCATIONS = [
  { id: "101", name: "渋谷店" },
  { id: "202", name: "倉庫" },
  { id: "303", name: "新宿店" },
];

function current() {
  return parseConfig({
    pickupEnabled: true,
    pickupNotifyOnHandover: false,
    deliveryEnabled: true,
    cancelStoreFulfillment: false,
    shippingTaxable: true,
    feeCountsAsSales: true,
    feeEarnsPoints: false,
    locations: [
      { locationId: "101", enabled: true, warehouseLocationId: "202", shippingFee: 800, shippingTitle: "送料" },
      { locationId: "303", enabled: false, warehouseLocationId: "", shippingFee: 0, shippingTitle: "送料" },
    ],
  });
}

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

const others = (config, section) => {
  const copy = { ...config };
  for (const key of POS_LITE_SECTIONS[section].keys) delete copy[key];
  return copy;
};

test("区分は 4 つで、設定のキーはどれか 1 つの区分にだけ入る（version は除く）", () => {
  assert.deepEqual(POS_LITE_SECTION_KEYS, ["pickup", "delivery", "fee", "locations"]);
  const keys = POS_LITE_SECTION_KEYS.flatMap((s) => POS_LITE_SECTIONS[s].keys);
  assert.equal(new Set(keys).size, keys.length, "2 つの区分に同じキーが無い");
  assert.deepEqual([...keys].sort(), Object.keys(defaultConfig()).filter((k) => k !== "version").sort(), "保存できないキーが無い");
  assert.equal(sectionPath("fee"), "/app/pos-lite/fee");
  assert.equal(isPosLiteSection("fee"), true);
  assert.equal(isPosLiteSection("constructor"), false);
  assert.equal(isPosLiteSection(""), false);
});

for (const section of ["pickup", "delivery", "fee"]) {
  test(`区分「${POS_LITE_SECTIONS[section].title}」の保存は、ほかの区分の値を変えない`, () => {
    const before = current();
    // 全部をひっくり返した入力（その区分のキーだけが効くこと）
    const input = { pickupEnabled: false, pickupNotifyOnHandover: true, deliveryEnabled: false, cancelStoreFulfillment: true, rescanEnabled: true, shippingTaxable: false, feeCountsAsSales: false, feeEarnsPoints: true, locations: [] };
    const { errors, config } = mergeSection(before, section, input, LOCATIONS);
    assert.deepEqual(errors, []);
    assert.deepEqual(others(config, section), others(before, section));
    for (const key of POS_LITE_SECTIONS[section].keys) assert.equal(config[key], input[key], key);
    assert.deepEqual(config.locations, before.locations, "店舗の行はそのまま");
  });
}

test("区分「店舗ごとの配送」の保存は、スイッチと送料の行の値を変えない", () => {
  const before = current();
  const input = sectionInputFromForm("locations", form({ enabled_101: "on", warehouse_101: "202", fee_101: "1000", title_101: "配送料", enabled_303: "on", warehouse_303: "202", fee_303: "500", title_303: "" }), LOCATIONS);
  const { errors, config } = mergeSection(before, "locations", input, LOCATIONS);
  assert.deepEqual(errors, []);
  assert.deepEqual(others(config, "locations"), others(before, "locations"));
  assert.deepEqual(
    config.locations.map((r) => [r.locationId, r.enabled, r.warehouseLocationId, r.shippingFee, r.shippingTitle]),
    [["101", true, "202", 1000, "配送料"], ["202", false, "", 0, "送料"], ["303", true, "202", 500, "送料"]],
  );
});

test("誤りが 1 つでもあれば何も保存しない（config を返さない）", () => {
  const input = sectionInputFromForm("locations", form({ enabled_101: "on", warehouse_101: "101", fee_101: "-1" }), LOCATIONS);
  const { errors, config } = mergeSection(current(), "locations", input, LOCATIONS);
  assert.equal(config, null);
  assert.ok(errors.some((e) => /既定の出荷元は、販売する店舗と別/.test(e)));
  assert.ok(errors.some((e) => /送料は 0 以上の整数/.test(e)));
  assert.deepEqual(mergeSection(current(), "nope", {}, LOCATIONS).config, null);
});

test("消えたロケーションの行が残っていても、ほかの区分は保存できて、その行も残す", () => {
  const before = parseConfig({ ...current(), locations: [...current().locations, { locationId: "999", enabled: true, warehouseLocationId: "202", shippingFee: 300 }] });
  const { errors, config } = mergeSection(before, "pickup", { pickupEnabled: false, pickupNotifyOnHandover: false }, LOCATIONS);
  assert.deepEqual(errors, []);
  assert.equal(config.locations.length, 3);
  assert.equal(config.pickupEnabled, false);
});

test("フォームからはその区分のチェックだけを読む（無いチェックはオフ）", () => {
  assert.deepEqual(sectionInputFromForm("pickup", form({ pickupEnabled: "on" })), { pickupEnabled: true, pickupNotifyOnHandover: false });
  assert.deepEqual(sectionInputFromForm("delivery", form({ cancelStoreFulfillment: "on", pickupEnabled: "on" })), { deliveryEnabled: false, cancelStoreFulfillment: true, rescanEnabled: false });
  assert.equal(sectionInputFromForm("delivery", form({ rescanEnabled: "on" })).rescanEnabled, true);
  assert.deepEqual(sectionInputFromForm("fee", form({ shippingTaxable: "on" })), { shippingTaxable: true, feeCountsAsSales: false, feeEarnsPoints: false });
});

test("既定の設定（何も保存していない店）の要約は、どれもオフ・最初の値", () => {
  const config = defaultConfig();
  assert.equal(sectionSummary("pickup", config, LOCATIONS), "オフ（POS の受取待ちは見るだけ）");
  assert.equal(sectionSummary("delivery", config, LOCATIONS), "オフ（会計のあとは何もしない）");
  assert.equal(sectionSummary("fee", config, LOCATIONS), "税あり・売上に含める・ポイントの対象にしない");
  assert.equal(sectionSummary("locations", config, LOCATIONS), "配送を受け付ける店舗はありません（3 店舗）");
});

test("要約の文はオン・オフと値で変わる", () => {
  const config = current();
  assert.equal(sectionSummary("pickup", config), "オン・引渡しのときお客様に知らせない");
  assert.equal(sectionSummary("pickup", { ...config, pickupNotifyOnHandover: true }), "オン・引渡しのときお客様に知らせる");
  assert.equal(sectionSummary("delivery", config), "オン・店頭で履行済みの配送分は取り消さない（要確認で止める）");
  assert.equal(sectionSummary("delivery", { ...config, cancelStoreFulfillment: true }), "オン・店頭で履行済みの配送分は取り消して出荷元へ移す");
  assert.equal(sectionSummary("delivery", { ...config, rescanEnabled: true }), "オン・店頭で履行済みの配送分は取り消さない（要確認で止める）・印の無いまま終わった注文を拾い直す");
  assert.equal(sectionSummary("delivery", { ...config, deliveryEnabled: false, rescanEnabled: true }), "オフ（会計のあとは何もしない）", "履行がオフなら拾い直しも書かない");
  assert.equal(sectionSummary("fee", { ...config, shippingTaxable: false, feeCountsAsSales: false, feeEarnsPoints: true }), "税なし・売上に含めない・ポイントの対象にする");
  assert.equal(sectionSummary("locations", config, LOCATIONS), "配送を受け付ける店舗 1 / 3・送料 800 円");
  const two = { ...config, locations: [...config.locations.filter((r) => r.locationId !== "303"), { locationId: "303", enabled: true, warehouseLocationId: "202", shippingFee: 500, shippingTitle: "送料" }] };
  assert.equal(sectionSummary("locations", two, LOCATIONS), "配送を受け付ける店舗 2 / 3・送料は店舗ごと");
  assert.equal(sectionSummary("locations", two, LOCATIONS.slice(0, 2)), "配送を受け付ける店舗 1 / 2・送料 800 円", "消えたロケーションは数えない");
});

test("親の画面は要約と要確認の一覧だけ（入力のフォームと保存の帯を置かない）", () => {
  const source = readFileSync(new URL("../routes/app.pos-lite.jsx", import.meta.url), "utf8");
  assert.match(source, /<SummaryRows/);
  assert.doesNotMatch(source, /<SaveBar/);
  assert.doesNotMatch(source, /name="pickupEnabled"/);
  assert.doesNotMatch(source, /intent === "save"/, "親の画面では設定を保存しない");
  assert.match(source, /intent === "retry"/, "要確認の再処理は親の画面のまま");
});

test("編集の画面は区分ごとに 1 つのフォーム・保存の帯 1 つ・「←」つき", () => {
  const source = readFileSync(new URL("../routes/app.pos-lite_.$section.jsx", import.meta.url), "utf8");
  assert.equal(source.match(/<SaveBar /g).length, 1);
  assert.equal(source.match(/<Form /g).length, 1);
  assert.match(source, /<BackAction to="\/app\/pos-lite" label="店頭受取・配送へ戻る" \/>/);
  assert.match(source, /mergeSection\(current, section/, "保存の直前に今の設定を読み、その区分だけを置きかえる");
  assert.match(source, /status: 404/, "知らない区分は 404");
});

test("拾い直しのスイッチ（#77）は「持ち帰りと配送の履行」の区分にあり、ほかの区分の保存で消えない", () => {
  assert.ok(POS_LITE_SECTIONS.delivery.keys.includes("rescanEnabled"));
  const before = { ...current(), rescanEnabled: true };
  const { config } = mergeSection(before, "fee", { shippingTaxable: true, feeCountsAsSales: true, feeEarnsPoints: false }, LOCATIONS);
  assert.equal(config.rescanEnabled, true);
  const off = mergeSection(before, "delivery", sectionInputFromForm("delivery", form({ deliveryEnabled: "on" })), LOCATIONS).config;
  assert.equal(off.rescanEnabled, false, "チェックを外して保存するとオフ");
  const page = readFileSync(new URL("../routes/app.pos-lite_.$section.jsx", import.meta.url), "utf8");
  assert.match(page, /name="rescanEnabled" checked=\{config\.rescanEnabled\}/);
});
