/**
 * deliveryProfiles → locationId ごとの配送フラグ判定（単一モジュール）。
 * App Proxy と管理画面（app.locations）で共有する。
 */

export const DELIVERY_PROFILES_QUERY = `#graphql
  query DeliveryProfilesForLocations {
    deliveryProfiles(first: 50) {
      nodes {
        profileLocationGroups {
          locationGroup {
            locations(first: 250) {
              nodes {
                id
              }
            }
          }
          locationGroupZones(first: 30) {
            nodes {
              zone {
                name
              }
              methodDefinitions(first: 50) {
                nodes {
                  active
                  name
                  rateProvider {
                    __typename
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * 配送方法名またはゾーン名から「ローカルデリバリー」かどうかを判定する
 * （API に methodType がないため名前で判定）。
 * @param {string} name
 * @returns {boolean}
 */
export function isLocalDeliveryMethodName(name) {
  if (!name || typeof name !== "string") return false;
  const n = name.toLowerCase().trim();
  return (
    n.includes("local") ||
    n.includes("ローカル") ||
    n.includes("local delivery") ||
    n.includes("localdelivery") ||
    n.includes("same-day") ||
    n.includes("sameday") ||
    n.includes("same day") ||
    n.includes("当日") ||
    n.includes("近距離") ||
    n.includes("半径") ||
    n.includes("地域配達")
  );
}

/**
 * 接続型で nodes が無い場合は edges から取り出す。
 * @param {object|null|undefined} connection
 * @returns {object[]}
 */
export function getConnectionNodes(connection) {
  if (!connection) return [];
  if (Array.isArray(connection.nodes)) return connection.nodes;
  if (Array.isArray(connection.edges)) {
    return connection.edges.map((e) => e.node).filter(Boolean);
  }
  return [];
}

/**
 * deliveryProfiles のレスポンスから locationId → { hasShipping, hasLocalDelivery } を構築。
 * @param {object} deliveryProfilesData
 * @param {{ logDebug?: boolean }} [options]
 * @returns {Map<string, { hasShipping: boolean, hasLocalDelivery: boolean }>}
 */
export function buildLocationDeliveryFlags(deliveryProfilesData, options = {}) {
  const map = new Map();
  const debugLog = [];
  const nodes = deliveryProfilesData?.deliveryProfiles?.nodes ?? [];
  for (const profile of nodes) {
    const groups = profile.profileLocationGroups ?? [];
    for (const plg of groups) {
      const locNodes = getConnectionNodes(plg.locationGroup?.locations);
      const locationIds = locNodes.map((n) => n.id).filter(Boolean);
      let hasShipping = false;
      let hasLocalDelivery = false;
      const zoneNames = [];
      const zones = getConnectionNodes(plg.locationGroupZones);
      for (const zoneNode of zones) {
        const zoneName = zoneNode.zone?.name ?? "";
        zoneNames.push(zoneName || "(空)");
        if (isLocalDeliveryMethodName(zoneName)) {
          hasLocalDelivery = true;
        }
        const methods = getConnectionNodes(zoneNode.methodDefinitions);
        for (const m of methods) {
          if (!m.active) continue;
          const rp = m.rateProvider;
          if (!rp) continue;
          const methodName = m.name ?? "";
          if (rp.__typename === "DeliveryParticipant") {
            hasShipping = true;
            if (isLocalDeliveryMethodName(methodName)) hasLocalDelivery = true;
          } else if (rp.__typename === "DeliveryRateDefinition") {
            if (isLocalDeliveryMethodName(methodName)) {
              hasLocalDelivery = true;
            } else {
              hasShipping = true;
            }
          }
        }
      }
      if (options.logDebug && (zoneNames.length > 0 || locationIds.length > 0)) {
        debugLog.push({
          locationIds,
          zoneNames,
          hasLocalDelivery,
          hasShipping,
        });
      }
      for (const lid of locationIds) {
        const cur = map.get(lid) || { hasShipping: false, hasLocalDelivery: false };
        map.set(lid, {
          hasShipping: cur.hasShipping || hasShipping,
          hasLocalDelivery: cur.hasLocalDelivery || hasLocalDelivery,
        });
      }
    }
  }
  if (options.logDebug) {
    const profileCount = nodes.length;
    const groupCount = nodes.reduce(
      (sum, p) => sum + (p.profileLocationGroups?.length ?? 0),
      0
    );
    console.warn(
      "[location-stock] deliveryProfiles: プロファイル数 =",
      profileCount,
      "ロケーショングループ数 =",
      groupCount
    );
    if (debugLog.length > 0) {
      console.warn(
        "[location-stock] deliveryProfiles debug (各グループのゾーン・ロケーション):",
        JSON.stringify(debugLog, null, 2)
      );
    }
    console.warn(
      "[location-stock] deliveryFlags map:",
      Object.fromEntries(
        [...map.entries()].map(([id, v]) => [
          id,
          { hasShipping: v.hasShipping, hasLocalDelivery: v.hasLocalDelivery },
        ])
      )
    );
  }
  return map;
}
