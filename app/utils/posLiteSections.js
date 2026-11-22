// 「店頭受取・配送」の設定を 4 つの区分に分ける（T さん 11/23 5:10 の案 A。UI ルール v1.1 2章）。
// 親の画面は区分ごとの 1 行の要約、入力は区分ごとの編集の画面。保存はその区分の値だけを置きかえる。
// 店の設定は 1 つのメタフィールド（location_stock.pos_lite）の JSON なので、サーバーで今の値を読み、
// その区分のキーだけを入れかえて書く（ほかの区分の値は変えない）。

import { numericId, validateConfig } from "../../extensions/pos-lite/src/logic.js";

/** 区分の一覧（並べる順）。keys はその区分で保存する設定のキー。 */
export const POS_LITE_SECTIONS = {
  pickup: {
    title: "店頭受取",
    description: "POS の「店頭受取・配送」タイルで、自店の受取待ちを一覧にし、準備完了・引渡し完了を記録します。",
    keys: ["pickupEnabled", "pickupNotifyOnHandover"],
  },
  delivery: {
    title: "持ち帰りと配送の履行",
    description: "会計の前に、商品と数量ごとに配送する分・配送先・送料を POS で決めます。会計のあと、持ち帰り分だけを履行し、配送分は出荷元に未発送で残します。",
    keys: ["deliveryEnabled", "cancelStoreFulfillment"],
  },
  fee: {
    title: "送料の行",
    description: "配送のある会計でカートに入れる送料の行の税と、POS Receipt・Shop Point に渡す印の値を決めます。",
    keys: ["shippingTaxable", "feeCountsAsSales", "feeEarnsPoints"],
  },
  locations: {
    title: "店舗ごとの配送",
    description: "配送を受け付ける店舗に印を付け、送料を決めます。出荷元は会計ごとに POS で必ず選びます（ここで決めるのは最初に選んでおく値）。送料は配送が 1 点以上のとき 1 回だけ足します。",
    keys: ["locations"],
  },
};

export const POS_LITE_SECTION_KEYS = Object.keys(POS_LITE_SECTIONS);

export function isPosLiteSection(section) {
  return Object.prototype.hasOwnProperty.call(POS_LITE_SECTIONS, String(section || ""));
}

export function sectionPath(section) {
  return `/app/pos-lite/${section}`;
}

/** 区分の 1 行の要約（親の画面）。 */
export function sectionSummary(section, config, locations = []) {
  const c = config || {};
  if (section === "pickup") {
    if (!c.pickupEnabled) return "オフ（POS の受取待ちは見るだけ）";
    return c.pickupNotifyOnHandover ? "オン・引渡しのときお客様に知らせる" : "オン・引渡しのときお客様に知らせない";
  }
  if (section === "delivery") {
    if (!c.deliveryEnabled) return "オフ（会計のあとは何もしない）";
    return c.cancelStoreFulfillment
      ? "オン・店頭で履行済みの配送分は取り消して出荷元へ移す"
      : "オン・店頭で履行済みの配送分は取り消さない（要確認で止める）";
  }
  if (section === "fee") {
    return [
      c.shippingTaxable === false ? "税なし" : "税あり",
      c.feeCountsAsSales === false ? "売上に含めない" : "売上に含める",
      c.feeEarnsPoints === true ? "ポイントの対象にする" : "ポイントの対象にしない",
    ].join("・");
  }
  if (section === "locations") {
    const known = new Set((locations || []).map((l) => numericId(l.id)));
    const rows = (c.locations || []).filter((row) => row.enabled && known.has(numericId(row.locationId)));
    if (!rows.length) return `配送を受け付ける店舗はありません（${known.size} 店舗）`;
    const fees = [...new Set(rows.map((row) => Number(row.shippingFee || 0)))];
    const fee = fees.length === 1 ? `送料 ${fees[0].toLocaleString("ja-JP")} 円` : "送料は店舗ごと";
    return `配送を受け付ける店舗 ${rows.length} / ${known.size}・${fee}`;
  }
  return "";
}

/** 編集の画面のフォームから、その区分の値だけを読む。 */
export function sectionInputFromForm(section, form, locations = []) {
  const on = (name) => form.get(name) === "on";
  if (section === "pickup") return { pickupEnabled: on("pickupEnabled"), pickupNotifyOnHandover: on("pickupNotifyOnHandover") };
  if (section === "delivery") return { deliveryEnabled: on("deliveryEnabled"), cancelStoreFulfillment: on("cancelStoreFulfillment") };
  if (section === "fee") return { shippingTaxable: on("shippingTaxable"), feeCountsAsSales: on("feeCountsAsSales"), feeEarnsPoints: on("feeEarnsPoints") };
  if (section === "locations") {
    return {
      locations: (locations || []).map((location) => ({
        locationId: location.id,
        enabled: form.get(`enabled_${location.id}`) === "on",
        warehouseLocationId: String(form.get(`warehouse_${location.id}`) || ""),
        shippingFee: String(form.get(`fee_${location.id}`) ?? ""),
        shippingTitle: String(form.get(`title_${location.id}`) ?? ""),
      })),
    };
  }
  return {};
}

/**
 * 今の設定のうち、その区分のキーだけを入れかえる。誤りが 1 つでもあれば errors を返し、何も保存しない（UI ルール 7章）。
 * 店舗ごとの配送以外の区分では、店舗の行は確かめずに今の値をそのまま残す（消えたロケーションの行があっても、
 * ほかの区分の保存を止めない）。
 * @returns {{errors: string[], config: object|null}}
 */
export function mergeSection(current, section, input, knownLocations = []) {
  if (!isPosLiteSection(section)) return { errors: ["設定の区分が分かりません。画面を開き直してください。"], config: null };
  const base = { ...(current || {}) };
  for (const key of POS_LITE_SECTIONS[section].keys) base[key] = input?.[key];
  if (section !== "locations") {
    const { errors, config } = validateConfig({ ...base, locations: [] }, knownLocations);
    if (errors.length) return { errors, config: null };
    return { errors: [], config: { ...config, locations: Array.isArray(current?.locations) ? current.locations : [] } };
  }
  const { errors, config } = validateConfig(base, knownLocations);
  return errors.length ? { errors, config: null } : { errors: [], config };
}
