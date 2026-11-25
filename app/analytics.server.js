import { randomUUID } from "node:crypto";

/**
 * 分析データのメタフィールドの読み書き
 * - 書く: 日ごと location_stock.analytics_YYYY_MM_DD（1 日分の JSON）
 * - 読む: 日ごとのキーと、前の形の月ごと location_stock.analytics_YYYY_MM（1 か月分 { [YYYY-MM-DD]: 1日分 }）を足し合わせる
 * - 1日分: { areaDisplayCount, nearbyClickCount, nearbyDisplayByLocation: { [locationId]: count }, orderPickClickCount, orderPickByLocation: { [locationId]: count } }
 */

const NAMESPACE = "location_stock";

function getDayKey(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return `analytics_${match[1]}_${match[2]}_${match[3]}`;
}

/**
 * 1 日分の JSON の上限（バイト）。Shopify の JSON メタフィールドの 128KB（API 2026-04 以降）より少し下にする。
 * 1 日分はふつう数 KB（ロケーション 1 件 45 バイトほど × 2 つの表）。1,000 か所を超える店でないと届かない（推測）。
 */
export const MAX_DAY_BYTES = 120_000;
export const SIZE_LIMIT_REASON = "size_limit";

const EMPTY_DAY = {
  areaDisplayCount: 0,
  nearbyClickCount: 0,
  nearbyDisplayByLocation: {},
  orderPickClickCount: 0,
  orderPickByLocation: {},
};

function ensureDay(obj) {
  return {
    areaDisplayCount: Number(obj?.areaDisplayCount) || 0,
    nearbyClickCount: Number(obj?.nearbyClickCount) || 0,
    nearbyDisplayByLocation:
      obj?.nearbyDisplayByLocation && typeof obj.nearbyDisplayByLocation === "object"
        ? obj.nearbyDisplayByLocation
        : {},
    orderPickClickCount: Number(obj?.orderPickClickCount) || 0,
    orderPickByLocation:
      obj?.orderPickByLocation && typeof obj.orderPickByLocation === "object"
        ? obj.orderPickByLocation
        : {},
  };
}

function incrementLocationMap(map, locationId, delta = 1) {
  const id = String(locationId ?? "").trim();
  if (!id) return undefined;
  const next = { ...map };
  next[id] = (next[id] || 0) + delta;
  return next;
}

const SHOP_ID_QUERY = `#graphql
  query ShopId { shop { id } }
`;

const METAFIELD_GET_QUERY = `#graphql
  query AnalyticsMetafield($key: String!) {
    shop {
      id
      metafield(namespace: "location_stock", key: $key) {
        value
        compareDigest
      }
    }
  }
`;

const METAFIELD_SET_MUTATION = `#graphql
  mutation SetAnalyticsMetafield($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { code field message }
    }
  }
`;

/**
 * 1 本の分析 JSON を取得（月ごと・日ごとのどちらのキーでも使える）
 */
export async function getMonthAnalytics(admin, shopId, key) {
  const res = await admin.graphql(METAFIELD_GET_QUERY, { variables: { key } });
  const json = await res.json();
  const value = json?.data?.shop?.metafield?.value;
  if (!value) return {};
  try {
    const data = JSON.parse(value);
    return typeof data === "object" && data !== null ? data : {};
  } catch {
    return {};
  }
}

/**
 * 1 本の分析 JSON を保存（今は日ごとのキーだけに書く）
 */
export async function setMonthAnalytics(admin, shopId, key, data, compareDigest) {
  const value = JSON.stringify(data);
  const res = await admin.graphql(METAFIELD_SET_MUTATION, {
    variables: {
      metafields: [
        {
          namespace: NAMESPACE,
          key,
          type: "json",
          ownerId: shopId,
          compareDigest,
          value,
        },
      ],
    },
  });
  const json = await res.json();
  const result = json?.data?.metafieldsSet;
  if (json.errors?.length || !Array.isArray(result?.userErrors)) {
    throw new Error("Analytics mutation result unavailable");
  }
  const errors = result.userErrors;
  if (errors.length && errors.every(error => error.code === "STALE_OBJECT")) return false;
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
  if (!result.metafields?.[0]?.id) throw new Error("Analytics mutation result unavailable");
  return true;
}

/**
 * 1件のイベントをその日のデータに加算してメタフィールドを更新
 * 書き先は日ごとのキー `analytics_YYYY_MM_DD`（1 日分だけの小さな JSON）。
 * 前は月ごとのキー `analytics_YYYY_MM` に 1 か月分をまとめて書いていたが、
 * API 2026-04 以降の JSON メタフィールドの 128KB の上限に、ロケーションが多い店で届くため分けた。
 * 月ごとのキーは読むだけ（getAnalyticsDailyData で日ごとのキーと足し合わせる）。
 * @param {object} admin - GraphQL admin client
 * @param {string} shopId - shop GID (gid://shopify/Shop/...)
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} eventType - "area_display" | "nearby_click" | "order_pick_click"
 * @param {object} payload - nearby_click: { locationIds: string[] }. order_pick_click: { locationId: string }
 */
export async function recordAnalyticsEvent(admin, shopId, dateStr, eventType, payload = {}) {
  const key = getDayKey(dateStr);
  if (!key) return;

  const eventId = randomUUID();
  let uncertain = false;
  let snapshot = await readForUpdate(admin, key);
  for (let attempt = 0; attempt < 3; attempt++) {
    const updated = incrementDay(snapshot.data, eventType, payload, eventId);
    try {
      if (await setMonthAnalytics(admin, shopId, key, updated, snapshot.digest)) {
        if (updated.sizeLimitSkipped?.lastEventId === eventId) {
          // 黙って捨てない: 記録できなかった件数と理由を記録（ログ）にも出す。画面にも出る（getAnalyticsDailyData）。
          console.warn(
            "[analytics] location counts skipped by size limit",
            JSON.stringify({ key, skipped: updated.sizeLimitSkipped.count, reason: SIZE_LIMIT_REASON })
          );
        }
        return;
      }
    } catch (error) {
      // An upstream internal error can arrive after the mutation committed.
      if (!isInternalError(error)) throw error;
      const observed = await readForUpdate(admin, key);
      if (observed.data.lastAnalyticsEventId === eventId) return;
      if (observed.digest !== snapshot.digest || attempt > 0) throw error;
      uncertain = true;
      snapshot = observed;
      continue;
    }
    if (uncertain) {
      const observed = await readForUpdate(admin, key);
      if (observed.data.lastAnalyticsEventId === eventId) return;
      throw new Error("Analytics update outcome unknown");
    }
    // An explicit stale digest guarantees the increment did not commit.
    if (attempt < 2) snapshot = await readForUpdate(admin, key);
  }
  throw new Error("Analytics update conflicted");
}

function isInternalError(error) {
  const errors = error?.body?.errors?.graphQLErrors ?? error?.body?.errors;
  if (Array.isArray(errors) && errors.some(item => item?.extensions?.code === "INTERNAL_SERVER_ERROR")) return true;
  return error?.constructor?.name === "GraphqlQueryError" && /^Internal error\b/i.test(error.message);
}

async function readForUpdate(admin, key) {
  const res = await admin.graphql(METAFIELD_GET_QUERY, { variables: { key } });
  const json = await res.json();
  const field = json?.data?.shop?.metafield;
  if (json.errors?.length || field === undefined) throw new Error("Analytics read unavailable");
  if (field === null) return { data: {}, digest: null };
  const data = JSON.parse(field.value);
  if (!data || typeof data !== "object" || Array.isArray(data) || !field.compareDigest) {
    throw new Error("Invalid analytics day");
  }
  return { data, digest: field.compareDigest };
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/**
 * 1 日分のデータにイベントを足した新しいオブジェクトを返す（引数は書き換えない）。
 * ロケーション別の数を足すと 1 日分が上限（MAX_DAY_BYTES）を超えるときは、
 * 合計の数だけ足し、ロケーション別に足せなかった件数を sizeLimitSkipped に残す。
 */
export function incrementDay(dayData, eventType, payload, eventId) {
  const base = ensureDay(dayData);
  const prevSkipped = Number(dayData?.sizeLimitSkipped?.count) || 0;
  const day = { ...base };
  let locationIncrements = 0;

  if (eventType === "area_display") {
    day.areaDisplayCount += 1;
  } else if (eventType === "nearby_click") {
    day.nearbyClickCount += 1;
    const ids = Array.isArray(payload.locationIds) ? payload.locationIds : [];
    ids.forEach((id) => {
      const next = incrementLocationMap(day.nearbyDisplayByLocation, id);
      if (next) {
        day.nearbyDisplayByLocation = next;
        locationIncrements += 1;
      }
    });
  } else if (eventType === "order_pick_click") {
    day.orderPickClickCount += 1;
    const next = incrementLocationMap(day.orderPickByLocation, payload.locationId);
    if (next) {
      day.orderPickByLocation = next;
      locationIncrements += 1;
    }
  }

  let result = { ...day, lastAnalyticsEventId: eventId };
  if (prevSkipped > 0) result.sizeLimitSkipped = { ...dayData.sizeLimitSkipped, count: prevSkipped };

  if (locationIncrements > 0 && byteLength(result) > MAX_DAY_BYTES) {
    // ロケーション別の数は足さず、合計の数だけ足す。足せなかった件数と理由を残す。
    result = {
      ...base,
      areaDisplayCount: day.areaDisplayCount,
      nearbyClickCount: day.nearbyClickCount,
      orderPickClickCount: day.orderPickClickCount,
      lastAnalyticsEventId: eventId,
      sizeLimitSkipped: {
        count: prevSkipped + locationIncrements,
        reason: SIZE_LIMIT_REASON,
        lastEventId: eventId,
      },
    };
  }
  return result;
}

/**
 * 期間に含まれる月キーを列挙（YYYY-MM-DD の start/end）
 */
function getMonthKeysInRange(startDate, endDate) {
  const keys = new Set();
  const [sy, sm] = startDate.split("-").map(Number);
  const [ey, em] = endDate.split("-").map(Number);
  for (let y = sy; y <= ey; y++) {
    const mStart = y === sy ? sm : 1;
    const mEnd = y === ey ? em : 12;
    for (let m = mStart; m <= mEnd; m++) {
      keys.add(`analytics_${y}_${String(m).padStart(2, "0")}`);
    }
  }
  return Array.from(keys);
}

/** 期間に含まれる日を YYYY-MM-DD で列挙（UTC で数える。日付の文字だけを扱う） */
function getDatesInRange(startDate, endDate) {
  const dates = [];
  const cur = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(end.getTime())) return dates;
  while (cur <= end && dates.length <= MAX_RANGE_DAYS) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

const MAX_RANGE_DAYS = 400;
const KEYS_PER_QUERY = 50;

/** 複数のキーを 1 回の GraphQL でまとめて読む（別名 k0, k1, … を付ける） */
function buildMultiKeyQuery(count) {
  const vars = [];
  const fields = [];
  for (let i = 0; i < count; i++) {
    vars.push(`$k${i}: String!`);
    fields.push(`k${i}: metafield(namespace: "${NAMESPACE}", key: $k${i}) { value }`);
  }
  return `#graphql
  query AnalyticsMetafields(${vars.join(", ")}) {
    shop {
      ${fields.join("\n      ")}
    }
  }
`;
}

async function readManyKeys(admin, keys) {
  const values = {};
  for (let i = 0; i < keys.length; i += KEYS_PER_QUERY) {
    const chunk = keys.slice(i, i + KEYS_PER_QUERY);
    const variables = {};
    chunk.forEach((key, j) => { variables[`k${j}`] = key; });
    const res = await admin.graphql(buildMultiKeyQuery(chunk.length), { variables });
    const json = await res.json();
    const shop = json?.data?.shop;
    if (json?.errors?.length || !shop) throw new Error("Analytics read unavailable");
    chunk.forEach((key, j) => {
      const value = shop[`k${j}`]?.value;
      if (!value) return;
      try {
        const data = JSON.parse(value);
        if (data && typeof data === "object" && !Array.isArray(data)) values[key] = data;
      } catch {
        // 壊れた 1 本は読み飛ばす（前と同じ）。ほかの日・月は出す。
      }
    });
  }
  return values;
}

function addLocationMaps(a, b) {
  const out = { ...a };
  for (const [id, count] of Object.entries(b || {})) {
    out[id] = (Number(out[id]) || 0) + (Number(count) || 0);
  }
  return out;
}

function skippedCount(day) {
  return Number(day?.sizeLimitSkippedCount ?? day?.sizeLimitSkipped?.count) || 0;
}

/** 同じ日の 2 つのデータを足す（前の形の月ごとのキーと、新しい日ごとのキー） */
function mergeDays(a, b) {
  const x = ensureDay(a);
  const y = ensureDay(b);
  return {
    areaDisplayCount: x.areaDisplayCount + y.areaDisplayCount,
    nearbyClickCount: x.nearbyClickCount + y.nearbyClickCount,
    nearbyDisplayByLocation: addLocationMaps(x.nearbyDisplayByLocation, y.nearbyDisplayByLocation),
    orderPickClickCount: x.orderPickClickCount + y.orderPickClickCount,
    orderPickByLocation: addLocationMaps(x.orderPickByLocation, y.orderPickByLocation),
    sizeLimitSkippedCount: skippedCount(a) + skippedCount(b),
  };
}

/**
 * 期間内の日別データを取得（分析画面用）
 * 前の形（月ごと）と新しい形（日ごと）の両方を読み、同じ日は足し合わせる。
 * sizeLimitSkippedCount: 上限のためロケーション別に足せなかった件数（画面に出す）。
 */
export async function getAnalyticsDailyData(admin, shopId, startDate, endDate) {
  const monthKeys = getMonthKeysInRange(startDate, endDate);
  const dates = getDatesInRange(startDate, endDate);
  const dayKeys = dates.map(getDayKey);
  const values = await readManyKeys(admin, [...monthKeys, ...dayKeys]);

  const byDate = {};
  for (const key of monthKeys) {
    for (const [date, day] of Object.entries(values[key] || {})) {
      if (date >= startDate && date <= endDate) byDate[date] = mergeDays(byDate[date], day);
    }
  }
  dates.forEach((date, i) => {
    const day = values[dayKeys[i]];
    if (day) byDate[date] = mergeDays(byDate[date], day);
  });

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({
      date,
      areaDisplayCount: day.areaDisplayCount,
      nearbyClickCount: day.nearbyClickCount,
      nearbyDisplayByLocation: day.nearbyDisplayByLocation,
      orderPickClickCount: day.orderPickClickCount,
      orderPickByLocation: day.orderPickByLocation,
      sizeLimitSkippedCount: day.sizeLimitSkippedCount,
    }));
}
