/**
 * ロケーション単位の配送フラグ判定（単一モジュール）。
 * - Legacy: merchant-owned deliveryProfiles
 * - Market-driven shipping (MDS): Market.delivery.shipping（Admin API 2026-07+）
 * App Proxy と管理画面（app.locations）で共有する。
 *
 * 公式 Option B:
 * https://shopify.dev/docs/apps/build/orders-fulfillment/market-driven-shipping/upgrade-your-app
 */

/** MDS / ShopFeatures.marketDrivenShipping に必要な Admin API バージョン */
export const MARKET_DRIVEN_SHIPPING_API_VERSION = "2026-07";

export const DELIVERY_PROFILES_QUERY = `#graphql
  query DeliveryProfilesForLocations($after: String) {
    deliveryProfiles(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        profileLocationGroups {
          locationGroup {
            id
            locations(first: 250) {
              pageInfo { hasNextPage endCursor }
              nodes {
                id
              }
            }
          }
          locationGroupZones(first: 30) {
            pageInfo { hasNextPage endCursor }
            edges { cursor node {
              zone {
                id name
              }
              methodDefinitions(first: 50) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  active
                  name
                  rateProvider {
                    __typename
                  }
                }
              }
            }
          } }
        }
      }
    }
  }
`;

export const SHOP_MARKET_DRIVEN_SHIPPING_QUERY = `#graphql
  query ShopMarketDrivenShipping {
    shop {
      features {
        marketDrivenShipping
      }
    }
  }
`;

export const MARKETS_DELIVERY_QUERY = `#graphql
  query MarketsDeliveryForLocations($after: String) {
    markets(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        name
        delivery {
          shipping {
            isEnabled
            optionDefinitions(first: 50, active: true) {
              pageInfo { hasNextPage endCursor }
              edges { cursor node {
                id
                __typename
                isActive
                description
                includedLocations(first: 250) {
                  pageInfo { hasNextPage endCursor }
                  nodes {
                    id
                  }
                }
                ... on DeliveryFlatRateOptionDefinition {
                  name
                }
                ... on DeliveryValueBasedOptionDefinition {
                  name
                }
                ... on DeliveryWeightBasedOptionDefinition {
                  name
                }
              } }
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

/**
 * Market.delivery.shipping レスポンスから locationId → フラグを構築（MDS）。
 * includedLocations が空のオプションは allLocationIds（指定時）全体に適用。
 * hasLocalDelivery はオプション名／description のヒューリスティック（MDS に methodType 無し）。
 *
 * @param {object} marketsData
 * @param {{ allLocationIds?: string[], logDebug?: boolean }} [options]
 * @returns {Map<string, { hasShipping: boolean, hasLocalDelivery: boolean }>}
 */
export function buildLocationDeliveryFlagsFromMarkets(marketsData, options = {}) {
  const map = new Map();
  const allLocationIds = Array.isArray(options.allLocationIds)
    ? options.allLocationIds.filter(Boolean)
    : [];
  const debugLog = [];
  const markets = getConnectionNodes(marketsData?.markets);

  for (const market of markets) {
    const shipping = market?.delivery?.shipping;
    if (!shipping || shipping.isEnabled === false) continue;
    const optionsNodes = getConnectionNodes(shipping.optionDefinitions);
    for (const opt of optionsNodes) {
      if (opt?.isActive === false) continue;
      const label = [opt.name, opt.description].filter(Boolean).join(" ");
      const isLocal = isLocalDeliveryMethodName(label);
      const locNodes = getConnectionNodes(opt.includedLocations);
      let locationIds = locNodes.map((n) => n.id).filter(Boolean);
      if (locationIds.length === 0 && allLocationIds.length > 0) {
        locationIds = allLocationIds;
      }
      if (options.logDebug) {
        debugLog.push({
          marketId: market.id,
          option: opt.name || opt.__typename,
          locationIds,
          isLocal,
        });
      }
      for (const lid of locationIds) {
        const cur = map.get(lid) || { hasShipping: false, hasLocalDelivery: false };
        map.set(lid, {
          hasShipping: true,
          hasLocalDelivery: cur.hasLocalDelivery || isLocal,
        });
      }
    }
  }

  if (options.logDebug) {
    console.warn(
      "[location-stock] markets delivery debug:",
      JSON.stringify(debugLog, null, 2)
    );
    console.warn(
      "[location-stock] markets deliveryFlags map:",
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

/**
 * Admin GraphQL を明示 API バージョンで実行（ライブラリの固定 apiVersion より新しいフィールド用）。
 * session.accessToken が必要。失敗時は { errors } を返す。
 *
 * @param {{ shop?: string, accessToken?: string } | null | undefined} session
 * @param {string} query
 * @param {object} [variables]
 * @param {string} [apiVersion]
 * @returns {Promise<{ data?: object, errors?: object[] }>}
 */
export async function graphqlAdminAtVersion(
  session,
  query,
  variables,
  apiVersion = MARKET_DRIVEN_SHIPPING_API_VERSION
) {
  const shop = session?.shop;
  const token = session?.accessToken;
  if (!shop || !token) {
    return {
      errors: [{ message: "missing_session_for_versioned_graphql" }],
    };
  }
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => null);
  if (!json) {
    return { errors: [{ message: `versioned_graphql_http_${res.status}` }] };
  }
  return json;
}

/**
 * ShopFeatures.marketDrivenShipping を 2026-07 で読む。
 * @param {{ shop?: string, accessToken?: string } | null | undefined} session
 * @returns {Promise<boolean|null>} true/false、判定不能時 null
 */
export async function detectMarketDrivenShipping(session) {
  try {
    const result = await graphqlAdminAtVersion(
      session,
      SHOP_MARKET_DRIVEN_SHIPPING_QUERY
    );
    if (result.errors?.length) {
      console.warn(
        "[location-stock] marketDrivenShipping detect errors:",
        JSON.stringify(result.errors)
      );
      return null;
    }
    const flag = result.data?.shop?.features?.marketDrivenShipping;
    return typeof flag === "boolean" ? flag : null;
  } catch (e) {
    console.warn(
      "[location-stock] marketDrivenShipping detect failed:",
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

function isThrottleError(error) {
  return error?.extensions?.code === "THROTTLED" || error?.message === "Throttled";
}

async function readDeliveryProfiles(admin, query = DELIVERY_PROFILES_QUERY, variables = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await admin.graphql(query, { variables });
      const result = await response.json();
      if (attempt > 0 || !result.errors?.length || !result.errors.every(isThrottleError)) {
        return result;
      }
    } catch (error) {
      if (attempt > 0 || !isThrottleError(error)) throw error;
    }
    // Only a throttled, read-only query gets a second attempt.
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * MDS / legacy を分岐して location 配送フラグ Map を返す。
 * @param {object} admin - admin.graphql を持つクライアント（legacy 用）
 * @param {{ shop?: string, accessToken?: string } | null | undefined} session
 * @param {{ allLocationIds?: string[], logDebug?: boolean }} [options]
 * @returns {Promise<{ flags: Map<string, { hasShipping: boolean, hasLocalDelivery: boolean }>, source: "markets"|"deliveryProfiles"|"none" }>}
 */
export async function loadLocationDeliveryFlags(admin, session, options = {}) {
  const empty = new Map();
  const mds = await detectMarketDrivenShipping(session);

  if (mds === true) {
    try {
      const marketsResult = await collectDeliveryPages(
        (query, variables) => graphqlAdminAtVersion(session, query, variables),
        MARKETS_DELIVERY_QUERY, "markets"
      );
      if (marketsResult.errors?.length) {
        console.warn(
          "[location-stock] markets delivery query errors:",
          JSON.stringify(marketsResult.errors)
        );
      } else if (marketsResult.data) {
        return {
          flags: buildLocationDeliveryFlagsFromMarkets(marketsResult.data, options),
          source: "markets",
        };
      }
    } catch (e) {
      console.warn(
        "[location-stock] markets delivery fetch failed:",
        e instanceof Error ? e.message : e
      );
    }
    // MDS 判定済みで markets 失敗時は stale deliveryProfiles に頼らない
    return { flags: empty, source: "none" };
  }

  // legacy（false）または判定不能（null）→ deliveryProfiles
  try {
    const dpResult = await collectDeliveryPages(
      (query, variables) => readDeliveryProfiles(admin, query, variables),
      DELIVERY_PROFILES_QUERY, "deliveryProfiles"
    );
    if (dpResult.errors?.length) {
      console.warn(
        "[location-stock] deliveryProfiles query returned GraphQL errors (要因: スコープ未付与 or API 制限):",
        JSON.stringify(dpResult.errors, null, 2)
      );
      return { flags: empty, source: "none" };
    }
    if (dpResult.data) {
      return {
        flags: buildLocationDeliveryFlags(dpResult.data, options),
        source: "deliveryProfiles",
      };
    }
  } catch (e) {
    console.warn(
      "[location-stock] deliveryProfiles fetch failed:",
      e instanceof Error ? e.message : e
    );
  }
  return { flags: empty, source: "none" };
}

const PAGE = "pageInfo { hasNextPage endCursor }";
const METHOD = "active name rateProvider { __typename }";
const OPTION = "__typename id isActive description ... on DeliveryFlatRateOptionDefinition { name } ... on DeliveryValueBasedOptionDefinition { name } ... on DeliveryWeightBasedOptionDefinition { name }";
const LOCATION_PAGE_QUERY = `query DeliveryGroupLocations($id: ID!, $after: String) {
  node(id: $id) { ... on DeliveryLocationGroup { locations(first:250, after:$after) { ${PAGE} nodes { id } } } }
}`;
const ZONE_PAGE_QUERY = `query DeliveryGroupZones($id: ID!, $group: ID!, $after: String) {
  deliveryProfile(id:$id) { profileLocationGroups(locationGroupId:$group) { locationGroup { id }
    locationGroupZones(first:30, after:$after) { ${PAGE} edges { cursor node { zone { id name }
      methodDefinitions(first:50) { ${PAGE} nodes { ${METHOD} } } } } } } }
}`;
const METHOD_PAGE_QUERY = `query DeliveryZoneMethods($id: ID!, $group: ID!, $zoneAfter: String, $after: String) {
  deliveryProfile(id:$id) { profileLocationGroups(locationGroupId:$group) {
    locationGroupZones(first:1, after:$zoneAfter) { edges { cursor node { zone { id }
      methodDefinitions(first:50, after:$after) { ${PAGE} nodes { ${METHOD} } } } } } } }
}`;
const OPTION_PAGE_QUERY = `query MarketDeliveryOptions($id: ID!, $after: String) {
  market(id:$id) { delivery { shipping { optionDefinitions(first:50, after:$after, active:true) {
    ${PAGE} edges { cursor node { ${OPTION} includedLocations(first:250) { ${PAGE} nodes { id } } } }
  } } } }
}`;
const INCLUDED_PAGE_QUERY = `query MarketOptionLocations($id: ID!, $optionAfter: String, $after: String) {
  market(id:$id) { delivery { shipping { optionDefinitions(first:1, after:$optionAfter, active:true) {
    edges { cursor node { id includedLocations(first:250, after:$after) { ${PAGE} nodes { id } } } }
  } } } }
}`;

function checkedData(result) {
  if (!result?.data || result.errors?.length) throw new Error("delivery_page_unavailable");
  return result.data;
}
function entries(connection) {
  if (!connection || (!Array.isArray(connection.nodes) && !Array.isArray(connection.edges))) throw new Error("delivery_connection_missing");
  return Array.isArray(connection.edges)
    ? connection.edges.map(e => ({ node:e.node, cursor:e.cursor }))
    : connection.nodes.map(node => ({ node, cursor:null }));
}
async function completeConnection(initial, nextPage) {
  let page=initial, after=null;
  const all=[], seen=new Set();
  for(let count=0;count<1000;count++){
    const rows=entries(page);
    for(let i=0;i<rows.length;i++) all.push({...rows[i], before:i===0 ? after : rows[i-1].cursor});
    if(!page.pageInfo || typeof page.pageInfo.hasNextPage!=="boolean") throw new Error("delivery_page_info_missing");
    if(page.pageInfo.hasNextPage === false) return all;
    const cursor=page.pageInfo.endCursor;
    if(typeof cursor!=="string" || !cursor || seen.has(cursor) || rows.length===0) throw new Error("delivery_cursor_invalid");
    seen.add(cursor);after=cursor;page=await nextPage(cursor);
  }
  throw new Error("delivery_page_limit");
}
function onlyGroup(data, id) {
  const groups=data?.deliveryProfile?.profileLocationGroups;
  const g=groups?.find(g=>g.locationGroup?.id===id) ?? (groups?.length===1?groups[0]:null);
  if(!g) throw new Error("delivery_group_missing");
  return g;
}
async function collectDeliveryPages(read, query, root) {
  const first=checkedData(await read(query,{}));
  const rows=await completeConnection(first[root],async after=>checkedData(await read(query,{after}))[root]);
  const nodes=[];
  for(const {node:entity} of rows){
    if(root==="deliveryProfiles"){
      for(const group of entity.profileLocationGroups??[]){
        const groupId=group.locationGroup?.id;
        const locations=await completeConnection(group.locationGroup?.locations,async after=>{
          if(!groupId)throw new Error("delivery_group_id_missing");
          return checkedData(await read(LOCATION_PAGE_QUERY,{id:groupId,after})).node?.locations;
        });
        group.locationGroup.locations={nodes:locations.map(r=>r.node)};
        const zones=await completeConnection(group.locationGroupZones,async after=>{
          if(!entity.id||!groupId)throw new Error("delivery_profile_id_missing");
          return onlyGroup(checkedData(await read(ZONE_PAGE_QUERY,{id:entity.id,group:groupId,after})),groupId).locationGroupZones;
        });
        for(const z of zones){
          const methods=await completeConnection(z.node.methodDefinitions,async after=>{
            if(!entity.id||!groupId||z.before===undefined||(!z.before&&zones[0]!==z))throw new Error("delivery_zone_cursor_missing");
            const g=onlyGroup(checkedData(await read(METHOD_PAGE_QUERY,{id:entity.id,group:groupId,zoneAfter:z.before,after})),groupId);
            const target=entries(g.locationGroupZones)[0]?.node;
            if(!target||target.zone?.id!==z.node.zone?.id)throw new Error("delivery_zone_changed");
            return target.methodDefinitions;
          });
          z.node.methodDefinitions={nodes:methods.map(r=>r.node)};
        }
        group.locationGroupZones={nodes:zones.map(r=>r.node)};
      }
    }else{
      const shipping=entity.delivery?.shipping;
      if(shipping&&shipping.isEnabled!==false){
        const options=await completeConnection(shipping.optionDefinitions,async after=>{
          if(!entity.id)throw new Error("delivery_market_id_missing");
          return checkedData(await read(OPTION_PAGE_QUERY,{id:entity.id,after})).market?.delivery?.shipping?.optionDefinitions;
        });
        for(const opt of options){
          // null includedLocations means unrestricted, matching the existing builder.
          if(opt.node.includedLocations==null)continue;
          const locations=await completeConnection(opt.node.includedLocations,async after=>{
            if(!entity.id||!opt.node.id||(!opt.before&&options[0]!==opt))throw new Error("delivery_option_cursor_missing");
            const page=checkedData(await read(INCLUDED_PAGE_QUERY,{id:entity.id,optionAfter:opt.before,after})).market?.delivery?.shipping?.optionDefinitions;
            const target=entries(page)[0]?.node;
            if(target?.id!==opt.node.id)throw new Error("delivery_option_changed");
            return target.includedLocations;
          });
          opt.node.includedLocations={nodes:locations.map(r=>r.node)};
        }
        shipping.optionDefinitions={nodes:options.map(r=>r.node)};
      }
    }
    nodes.push(entity);
  }
  return {data:{[root]:{nodes}}};
}
