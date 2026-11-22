/**
 * ストアフロントから来る分析の入力（日付・ロケーション ID）をサーバーで確かめる。
 *
 * - 日付: 店のタイムゾーン（Shop.ianaTimezone。取れないときは Asia/Tokyo）の「今日」の前後 1 日だけ受ける。
 *   ストアフロントはお客様のブラウザの日付を送る（location-stock-indicator.js の getTodayDateStr）ので、
 *   店とお客様のタイムゾーンのずれを前後 1 日で吸収する。
 * - ロケーション ID: その店にあるロケーション（Admin API の locations）だけ受ける。1 回に受ける数に上限を付ける。
 * - はじいた分は黙って捨てない。理由ごとの件数を返し、記録（ログ）に出す（ID の中身・お客様の情報は出さない）。
 */

export const FALLBACK_TIME_ZONE = "Asia/Tokyo";

/** 1 回のイベントで受けるロケーション ID の数の上限（ストアフロントは今 1 件だけ送る） */
export const MAX_LOCATION_IDS_PER_EVENT = 20;

/** locations を読むページ数の上限（250 件 × 4 = 1,000 か所まで） */
export const MAX_LOCATION_PAGES = 4;
const LOCATIONS_PAGE_SIZE = 250;

export const ANALYTICS_EVENT_TYPES = ["area_display", "nearby_click", "order_pick_click"];

/** はじいた理由 */
export const REJECT_REASONS = {
  dateOutOfRange: "date_out_of_range",
  badFormat: "bad_format",
  notInShop: "not_in_shop",
  duplicate: "duplicate",
  overLimit: "over_limit",
  lookupFailed: "lookup_failed",
};

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCATION_GID_RE = /^gid:\/\/shopify\/Location\/\d+$/;

function isValidTimeZone(timeZone) {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** その時刻の、タイムゾーンでの日付（YYYY-MM-DD） */
export function dateInTimeZone(now, timeZone) {
  const tz = isValidTimeZone(timeZone) ? timeZone : FALLBACK_TIME_ZONE;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function shiftDate(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 本当にある日付か（2026-02-30 などをはじく） */
export function isRealDate(dateStr) {
  if (typeof dateStr !== "string" || !DATE_RE.test(dateStr)) return false;
  const d = new Date(`${dateStr}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dateStr;
}

/** 受けてよい日付の幅 { min, max, today }（店のタイムゾーンの今日 ±1 日） */
export function allowedDateRange(now, timeZone) {
  const today = dateInTimeZone(now, timeZone);
  return { min: shiftDate(today, -1), max: shiftDate(today, 1), today };
}

export function isDateAllowed(dateStr, now, timeZone) {
  if (!isRealDate(dateStr)) return false;
  const { min, max } = allowedDateRange(now, timeZone);
  return dateStr >= min && dateStr <= max;
}

/**
 * 店のタイムゾーンを読む前の、API を呼ばない下見。
 * どの店のタイムゾーン（UTC-12〜UTC+14）でも「今日」は UTC の今日の前後 1 日に入るので、
 * UTC の今日 ±2 日を外れる日付は、どの店でも受けない。
 */
export function isDatePossiblyAllowed(dateStr, now) {
  if (!isRealDate(dateStr)) return false;
  const utcToday = now.toISOString().slice(0, 10);
  return dateStr >= shiftDate(utcToday, -2) && dateStr <= shiftDate(utcToday, 2);
}

function addReason(rejected, reason, n = 1) {
  rejected[reason] = (rejected[reason] || 0) + n;
}

/**
 * ロケーション ID の一覧を確かめる。
 * @param {unknown[]} rawIds
 * @param {Set<string>|null} knownIds - 店のロケーション ID。null は読めなかったとき（全部はじく）
 * @param {number} max
 * @returns {{ accepted: string[], rejected: Record<string, number> }}
 */
export function filterLocationIds(rawIds, knownIds, max = MAX_LOCATION_IDS_PER_EVENT) {
  const accepted = [];
  const rejected = {};
  const seen = new Set();
  const list = Array.isArray(rawIds) ? rawIds : [];
  for (const raw of list) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id) {
      // 空の文字は前から数えていない（incrementLocationMap）。文字でないものは形の違いとして数える
      if (typeof raw !== "string") addReason(rejected, REJECT_REASONS.badFormat);
      continue;
    }
    if (!LOCATION_GID_RE.test(id)) {
      addReason(rejected, REJECT_REASONS.badFormat);
      continue;
    }
    if (seen.has(id)) {
      addReason(rejected, REJECT_REASONS.duplicate);
      continue;
    }
    seen.add(id);
    if (!knownIds) {
      addReason(rejected, REJECT_REASONS.lookupFailed);
      continue;
    }
    if (!knownIds.has(id)) {
      addReason(rejected, REJECT_REASONS.notInShop);
      continue;
    }
    if (accepted.length >= max) {
      addReason(rejected, REJECT_REASONS.overLimit);
      continue;
    }
    accepted.push(id);
  }
  return { accepted, rejected };
}

/** カンマ区切りのクエリ文字を配列に（長すぎる文字は先頭だけ見る） */
export function splitLocationIdsParam(value, max = MAX_LOCATION_IDS_PER_EVENT) {
  if (!value || typeof value !== "string") return { ids: [], overLimit: 0 };
  const parts = value.split(",");
  // 確かめるのは上限の 2 倍まで（重なりや形違いを除いたあとで上限に届くように）。残りは over_limit で数える
  const keep = max * 2;
  return { ids: parts.slice(0, keep), overLimit: Math.max(0, parts.length - keep) };
}

/**
 * 1 件の分析イベントを確かめる。
 * @param {{ eventType: unknown, dateStr: unknown, locationIds?: unknown, locationId?: unknown, extraOverLimit?: number }} input
 * @param {{ now: Date, timeZone?: string|null, knownLocationIds: Set<string>|null, maxLocationIds?: number }} ctx
 * @returns {{ ok: true, payload: object, rejected: Record<string, number> } | { ok: false, reason: string, rejected: Record<string, number> }}
 */
export function validateAnalyticsEvent(input, ctx) {
  const rejected = {};
  const { eventType, dateStr } = input;
  if (typeof eventType !== "string" || !ANALYTICS_EVENT_TYPES.includes(eventType)) {
    return { ok: false, reason: "invalid_event", rejected };
  }
  if (!isRealDate(dateStr)) {
    addReason(rejected, REJECT_REASONS.badFormat);
    return { ok: false, reason: "invalid_date", rejected };
  }
  if (!isDateAllowed(dateStr, ctx.now, ctx.timeZone)) {
    addReason(rejected, REJECT_REASONS.dateOutOfRange);
    return { ok: false, reason: REJECT_REASONS.dateOutOfRange, rejected };
  }

  const max = ctx.maxLocationIds ?? MAX_LOCATION_IDS_PER_EVENT;
  const payload = {};
  if (eventType === "nearby_click") {
    const raw = input.locationIds;
    if (raw !== undefined && raw !== null && !Array.isArray(raw)) {
      addReason(rejected, REJECT_REASONS.badFormat);
    }
    const r = filterLocationIds(Array.isArray(raw) ? raw : [], ctx.knownLocationIds, max);
    payload.locationIds = r.accepted;
    for (const [k, n] of Object.entries(r.rejected)) addReason(rejected, k, n);
  }
  if (eventType === "order_pick_click" && input.locationId !== undefined && input.locationId !== null && input.locationId !== "") {
    const r = filterLocationIds([input.locationId], ctx.knownLocationIds, 1);
    if (r.accepted[0]) payload.locationId = r.accepted[0];
    for (const [k, n] of Object.entries(r.rejected)) addReason(rejected, k, n);
  }
  if (input.extraOverLimit > 0) addReason(rejected, REJECT_REASONS.overLimit, input.extraOverLimit);
  return { ok: true, payload, rejected };
}

export function rejectedTotal(rejected) {
  return Object.values(rejected || {}).reduce((s, n) => s + (Number(n) || 0), 0);
}

/**
 * はじいた分を記録（ログ）に出す。出すのはストア・イベントの種類・理由ごとの件数だけ
 * （日付やロケーション ID の中身、お客様の情報は出さない）。
 */
export function logAnalyticsRejections(shop, eventType, result, logger = console) {
  const total = rejectedTotal(result.rejected);
  if (result.ok && total === 0) return;
  logger.warn(
    "[analytics] storefront input rejected",
    JSON.stringify({
      shop: shop ?? null,
      event: typeof eventType === "string" && ANALYTICS_EVENT_TYPES.includes(eventType) ? eventType : "unknown",
      eventRejected: !result.ok,
      reason: result.ok ? null : result.reason,
      rejected: result.rejected,
      rejectedTotal: total,
    })
  );
}

export const ANALYTICS_SHOP_CONTEXT_QUERY = `#graphql
  query AnalyticsShopContext($first: Int!, $after: String) {
    shop { id ianaTimezone }
    locations(first: $first, after: $after) {
      nodes { id }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/**
 * 店の ID・タイムゾーン・ロケーション ID を読む。
 * @param {(query: string, variables: object) => Promise<{ data?: any, authFailed?: boolean }>} read
 *   1 ページ目はルート側の認証の再試行（graphqlWithAuthRetry）を通す
 * @returns {Promise<{ authFailed: true } | { shopId: string|null, timeZone: string|null, locationIds: Set<string>|null }>}
 */
export async function loadAnalyticsShopContext(read) {
  let after = null;
  const ids = new Set();
  let shopId = null;
  let timeZone = null;
  for (let page = 0; page < MAX_LOCATION_PAGES; page++) {
    let res;
    try {
      res = await read(ANALYTICS_SHOP_CONTEXT_QUERY, { first: LOCATIONS_PAGE_SIZE, after });
    } catch (err) {
      if (page === 0) throw err;
      // 2 ページ目より後が読めないときは、ロケーションの確かめができないとする
      return { shopId, timeZone, locationIds: null };
    }
    if (res?.authFailed) return { authFailed: true };
    const data = res?.data;
    if (page === 0) {
      shopId = data?.shop?.id ?? null;
      timeZone = data?.shop?.ianaTimezone ?? null;
    }
    const conn = data?.locations;
    if (!conn || !Array.isArray(conn.nodes)) return { shopId, timeZone, locationIds: null };
    for (const node of conn.nodes) if (node?.id) ids.add(node.id);
    if (!conn.pageInfo?.hasNextPage) return { shopId, timeZone, locationIds: ids };
    after = conn.pageInfo.endCursor;
  }
  // 1,000 か所を超える店: 読めた分だけで確かめる（超えた分は not_in_shop として数えて記録に出る）
  return { shopId, timeZone, locationIds: ids };
}
