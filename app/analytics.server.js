/**
 * 分析データのメタフィールド（月単位: location_stock.analytics_YYYY_MM）の読み書き
 * - 1日分: { areaDisplayCount, nearbyClickCount, nearbyDisplayByLocation: { [locationId]: count }, orderPickClickCount, orderPickByLocation: { [locationId]: count } }
 */

const NAMESPACE = "location_stock";

function getMonthKey(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  return `analytics_${match[1]}_${match[2]}`;
}

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
  const id = String(locationId);
  if (!id) return;
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
      }
    }
  }
`;

const METAFIELD_SET_MUTATION = `#graphql
  mutation SetAnalyticsMetafield($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id namespace key }
      userErrors { field message }
    }
  }
`;

/**
 * 指定月の分析JSONを取得
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
 * 指定月の分析JSONを保存
 */
export async function setMonthAnalytics(admin, shopId, key, data) {
  const value = JSON.stringify(data);
  const res = await admin.graphql(METAFIELD_SET_MUTATION, {
    variables: {
      metafields: [
        {
          namespace: NAMESPACE,
          key,
          type: "json",
          ownerId: shopId,
          value,
        },
      ],
    },
  });
  const json = await res.json();
  const errors = json?.data?.metafieldsSet?.userErrors || [];
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join("; "));
  }
}

/**
 * 1件のイベントをその日のデータに加算してメタフィールドを更新
 * @param {object} admin - GraphQL admin client
 * @param {string} shopId - shop GID (gid://shopify/Shop/...)
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} eventType - "area_display" | "nearby_click" | "order_pick_click"
 * @param {object} payload - nearby_click: { locationIds: string[] }. order_pick_click: { locationId: string }
 */
export async function recordAnalyticsEvent(admin, shopId, dateStr, eventType, payload = {}) {
  const key = getMonthKey(dateStr);
  if (!key) return;

  const monthData = await getMonthAnalytics(admin, shopId, key);
  const day = ensureDay(monthData[dateStr]);

  if (eventType === "area_display") {
    day.areaDisplayCount += 1;
  } else if (eventType === "nearby_click") {
    day.nearbyClickCount += 1;
    const ids = Array.isArray(payload.locationIds) ? payload.locationIds : [];
    ids.forEach((id) => {
      day.nearbyDisplayByLocation = incrementLocationMap(day.nearbyDisplayByLocation, id) || day.nearbyDisplayByLocation;
    });
  } else if (eventType === "order_pick_click") {
    day.orderPickClickCount += 1;
    const id = payload.locationId;
    if (id) {
      day.orderPickByLocation = incrementLocationMap(day.orderPickByLocation, id) || day.orderPickByLocation;
    }
  }

  monthData[dateStr] = day;
  await setMonthAnalytics(admin, shopId, key, monthData);
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

/**
 * 期間内の日別データを取得（分析画面用）
 */
export async function getAnalyticsDailyData(admin, shopId, startDate, endDate) {
  const keys = getMonthKeysInRange(startDate, endDate);
  const byDate = {};

  for (const key of keys) {
    const monthData = await getMonthAnalytics(admin, shopId, key);
    for (const [date, day] of Object.entries(monthData)) {
      if (date >= startDate && date <= endDate) {
        byDate[date] = ensureDay(day);
      }
    }
  }

  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => ({
      date,
      areaDisplayCount: day.areaDisplayCount,
      nearbyClickCount: day.nearbyClickCount,
      nearbyDisplayByLocation: day.nearbyDisplayByLocation,
      orderPickClickCount: day.orderPickClickCount,
      orderPickByLocation: day.orderPickByLocation,
    }));
}
