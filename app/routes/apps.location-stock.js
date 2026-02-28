// app/routes/apps.location-stock.js

import shopify from "../shopify.server";
import { recordAnalyticsEvent } from "../analytics.server";

/**
 * バリアント在庫 + ショップメタフィールド(location_stock.config) をまとめて取得
 * location に localPickupSettingsV2 を含め、店舗受け取り対応の有無を判定する
 */
const VARIANT_INVENTORY_WITH_CONFIG_QUERY = `#graphql
  query VariantInventoryWithConfig($id: ID!) {
    productVariant(id: $id) {
      id
      title
      inventoryItem {
        id
        inventoryLevels(first: 50) {
          edges {
            node {
              id
              location {
                id
                name
                fulfillsOnlineOrders
                localPickupSettingsV2 {
                  pickupTime
                }
                address {
                  city
                  provinceCode
                  countryCode
                  latitude
                  longitude
                }
              }
              quantities(names: "available") {
                name
                quantity
              }
            }
          }
        }
      }
    }
    shop {
      metafield(namespace: "location_stock", key: "config") {
        value
      }
    }
  }
`;

/**
 * 配送プロファイルから locationId → { hasShipping, hasLocalDelivery } を構築（read_shipping が必要）
 */
const DELIVERY_PROFILES_QUERY = `#graphql
  query DeliveryProfilesForLocations {
    deliveryProfiles(first: 50) {
      nodes {
        profileLocationGroups {
          locationGroup {
            locations(first: 100) {
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

const SHOP_ID_QUERY = `#graphql
  query ShopId { shop { id } }
`;

/**
 * 配送方法名から「ローカルデリバリー」かどうかを判定する（API に methodType がないため名前で判定）
 */
function isLocalDeliveryMethodName(name) {
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
 * 接続型で nodes が無い場合は edges から取り出す（REQUIREMENTS §6 と管理画面と同じフォールバック）
 */
function getNodes(connection) {
  if (!connection) return [];
  if (Array.isArray(connection.nodes)) return connection.nodes;
  if (Array.isArray(connection.edges)) return connection.edges.map((e) => e.node).filter(Boolean);
  return [];
}

function buildLocationDeliveryFlags(deliveryProfilesData) {
  const map = new Map();
  const nodes = deliveryProfilesData?.deliveryProfiles?.nodes ?? [];
  for (const profile of nodes) {
    const groups = profile.profileLocationGroups ?? [];
    for (const plg of groups) {
      const locsRaw = plg.locationGroup?.locations;
      const locNodes = getNodes(locsRaw);
      const locationIds = locNodes.map((n) => n.id).filter(Boolean);
      let hasShipping = false;
      let hasLocalDelivery = false;
      const zones = getNodes(plg.locationGroupZones);
      for (const zoneNode of zones) {
        const zoneName = zoneNode.zone?.name ?? "";
        if (isLocalDeliveryMethodName(zoneName)) {
          hasLocalDelivery = true;
        }
        const methods = getNodes(zoneNode.methodDefinitions);
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
      for (const lid of locationIds) {
        const cur = map.get(lid) || { hasShipping: false, hasLocalDelivery: false };
        map.set(lid, {
          hasShipping: cur.hasShipping || hasShipping,
          hasLocalDelivery: cur.hasLocalDelivery || hasLocalDelivery,
        });
      }
    }
  }
  return map;
}

/**
 * エラー時にショップ・variant_id・コード・メッセージを JSON で console.error（要件 4）
 */
function logAppProxyError(shop, variantId, code, message, err) {
  console.error(
    "[location-stock] App Proxy error",
    JSON.stringify(
      { shop, variantId, code, message, err: err ? String(err) : undefined },
      null,
      2
    )
  );
}

/**
 * 正常系レスポンス
 */
function successJson(body) {
  return new Response(
    JSON.stringify({
      ok: true,
      ...body,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * エラー系レスポンス
 */
function errorJson(code, message) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: code,
      message,
    }),
    {
      status: 200, // Shopify のエラーページを避ける
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * メタフィールドの config(locations 配列) を stocks に適用
 * - publicName / sortOrder / enabled を反映
 * - custom_from_app 用に fromConfig フラグを付与
 */
function applyConfigToStocks(stocks, config) {
  const locationsConfig = Array.isArray(config?.locations)
    ? config.locations
    : [];
  const regionGroups = Array.isArray(config?.regionGroups)
    ? config.regionGroups
    : [];
  const regionGroupById = new Map(regionGroups.filter((g) => g && g.id).map((g) => [g.id, g.name]));

  // 設定が無い場合:
  //  - ラベル = 元ロケーション名
  //  - sortOrder = 999999
  //  - fromConfig = false（custom_from_app のときは何も出さない想定）
  if (!locationsConfig.length) {
    return stocks.map((s) => ({
      ...s,
      displayName: s.locationName,
      sortOrder: 999999,
      fromConfig: false,
      excludeFromNearby: false,
    }));
  }

  // locationId → 設定 のマップ
  const mapById = new Map();
  locationsConfig.forEach((loc) => {
    if (!loc || !loc.locationId) return;
    mapById.set(loc.locationId, loc);
  });

  const decorated = stocks
    .map((stock) => {
      const cfg = mapById.get(stock.locationId);

      // config にエントリが無い場合:
      //  - 表示はする（all / online_only モード用）
      //  - fromConfig = false（custom_from_app では除外したい）
      if (!cfg) {
        return {
          ...stock,
          displayName: stock.locationName,
          sortOrder: 999999,
          fromConfig: false,
          excludeFromNearby: false,
        };
      }

      // enabled === false のものは非表示
      if (cfg.enabled === false) {
        return null;
      }

      const pinnedLocationId = typeof config?.pinnedLocationId === "string" && config.pinnedLocationId.trim() !== ""
        ? config.pinnedLocationId.trim()
        : null;
      // 上部固定のロケーションはエリアから抜き出し（最優先で単体表示するため __pinned__ を付与）
      const regionKey =
        pinnedLocationId && stock.locationId === pinnedLocationId
          ? "__pinned__"
          : cfg.regionGroupId && regionGroupById.has(cfg.regionGroupId)
            ? regionGroupById.get(cfg.regionGroupId)
            : "未設定";

      // メタフィールドで明示設定されたロケーション
      return {
        ...stock,
        displayName: cfg.publicName || stock.locationName,
        sortOrder:
          typeof cfg.sortOrder === "number" ? cfg.sortOrder : 999999,
        fromConfig: true,
        regionKey,
        excludeFromNearby: !!cfg.excludeFromNearby,
      };
    })
    .filter(Boolean);

  // sort_by = "none" のとき、この順番のままフロントに渡る
  // → sortOrder → locationName の順で安定ソート
  decorated.sort((a, b) => {
    const ao = a.sortOrder ?? 999999;
    const bo = b.sortOrder ?? 999999;
    if (ao !== bo) return ao - bo;
    return (a.locationName || "").localeCompare(b.locationName || "");
  });

  return decorated;
}

// メタフィールドの JSON から「グローバル設定 config」を組み立てる
// - 足りないところはデフォルトで補完
// - thresholds / quantity / symbols / labels / locations / click / future / sort / messages / notice
function buildGlobalConfig(raw) {
  const defaultConfig = {
    thresholds: {
      outOfStockMax: 0,
      inStockMin: 5,
    },
    quantity: {
      showQuantity: true,
      showQuantityLabel: true,
      quantityLabel: "在庫",
      wrapperBefore: "(",
      wrapperAfter: ")",
      rowContentMode: "symbol_and_quantity",
    },
    symbols: {
      inStock: "◯",
      lowStock: "△",
      outOfStock: "✕",
    },
    labels: {
      inStock: "在庫あり",
      lowStock: "残りわずか",
      outOfStock: "在庫なし",
    },
    locations: {
      mode: "all",          // all / online_only / custom_from_app
      usePublicName: false, // メタフィールド publicName を使うかどうか
    },
    click: {
      action: "none", // none / open_map / open_url
      mapUrlTemplate: "https://maps.google.com/?q={location_name}",
      urlTemplate: "/pages/store-{location_id}",
    },
    future: {
      groupByRegion: false,
      regionAccordionEnabled: false,
      nearbyFirstEnabled: false,
      nearbyOtherCollapsible: false,
      nearbyOtherHeading: "",
      showOrderPickButton: false,
      orderPickButtonLabel: "この店舗で受け取る",
      orderPickRedirectToCheckout: false,
      regionUnsetLabel: "その他",
    },
    sort: {
      mode: "none", // none / location_name_asc / quantity_desc / quantity_asc
    },
    messages: {
      loading: "在庫を読み込み中...",
      empty: "現在、この商品の店舗在庫はありません。",
      error: "在庫情報の取得に失敗しました。時間をおいて再度お試しください。",
    },
  };

  const safe = raw && typeof raw === "object" ? raw : {};

  // thresholds
  const thresholdsRaw = safe.thresholds || {};
  const thresholds = {
    outOfStockMax:
      typeof thresholdsRaw.outOfStockMax === "number"
        ? thresholdsRaw.outOfStockMax
        : defaultConfig.thresholds.outOfStockMax,
    inStockMin:
      typeof thresholdsRaw.inStockMin === "number"
        ? thresholdsRaw.inStockMin
        : defaultConfig.thresholds.inStockMin,
  };

  // quantity
  const quantityRaw = safe.quantity || {};
  const quantity = { ...defaultConfig.quantity };
  if (typeof quantityRaw.showQuantity === "boolean") {
    quantity.showQuantity = quantityRaw.showQuantity;
  }
  if (typeof quantityRaw.showQuantityLabel === "boolean") {
    quantity.showQuantityLabel = quantityRaw.showQuantityLabel;
  }
  if (typeof quantityRaw.quantityLabel === "string") {
    quantity.quantityLabel = quantityRaw.quantityLabel;
  }
  if (typeof quantityRaw.wrapperBefore === "string") {
    quantity.wrapperBefore = quantityRaw.wrapperBefore;
  }
  if (typeof quantityRaw.wrapperAfter === "string") {
    quantity.wrapperAfter = quantityRaw.wrapperAfter;
  }
  if (typeof quantityRaw.rowContentMode === "string") {
    quantity.rowContentMode = quantityRaw.rowContentMode;
  }

  // symbols
  const symbolsRaw = safe.symbols || {};
  const symbols = { ...defaultConfig.symbols };
  if (typeof symbolsRaw.inStock === "string") {
    symbols.inStock = symbolsRaw.inStock;
  }
  if (typeof symbolsRaw.lowStock === "string") {
    symbols.lowStock = symbolsRaw.lowStock;
  }
  if (typeof symbolsRaw.outOfStock === "string") {
    symbols.outOfStock = symbolsRaw.outOfStock;
  }

  // labels
  const labelsRaw = safe.labels || {};
  const labels = { ...defaultConfig.labels };
  if (typeof labelsRaw.inStock === "string") {
    labels.inStock = labelsRaw.inStock;
  }
  if (typeof labelsRaw.lowStock === "string") {
    labels.lowStock = labelsRaw.lowStock;
  }
  if (typeof labelsRaw.outOfStock === "string") {
    labels.outOfStock = labelsRaw.outOfStock;
  }

  // locations（表示ルール）
  const locations = {
    mode:
      typeof safe.locationsMode === "string"
        ? safe.locationsMode
        : defaultConfig.locations.mode,
    usePublicName:
      typeof safe.usePublicName === "boolean"
        ? safe.usePublicName
        : defaultConfig.locations.usePublicName,
  };

  // click
  const clickRaw = safe.click || {};
  const click = { ...defaultConfig.click };
  if (typeof clickRaw.action === "string") {
    click.action = clickRaw.action;
  }
  if (typeof clickRaw.mapUrlTemplate === "string") {
    click.mapUrlTemplate = clickRaw.mapUrlTemplate;
  }
  if (typeof clickRaw.urlTemplate === "string") {
    click.urlTemplate = clickRaw.urlTemplate;
  }

  // future
  const futureRaw = safe.future || {};
  const future = { ...defaultConfig.future };
  if (typeof futureRaw.groupByRegion === "boolean") {
    future.groupByRegion = futureRaw.groupByRegion;
  }
  if (typeof futureRaw.regionAccordionEnabled === "boolean") {
    future.regionAccordionEnabled = futureRaw.regionAccordionEnabled;
  }
  if (typeof futureRaw.nearbyFirstEnabled === "boolean") {
    future.nearbyFirstEnabled = futureRaw.nearbyFirstEnabled;
  }
  if (typeof futureRaw.nearbyOtherCollapsible === "boolean") {
    future.nearbyOtherCollapsible = futureRaw.nearbyOtherCollapsible;
  }
  if (typeof futureRaw.nearbyOtherHeading === "string") {
    future.nearbyOtherHeading = futureRaw.nearbyOtherHeading.trim();
  }
  if (typeof futureRaw.showOrderPickButton === "boolean") {
    future.showOrderPickButton = futureRaw.showOrderPickButton;
  }
  if (typeof futureRaw.orderPickButtonLabel === "string") {
    future.orderPickButtonLabel = futureRaw.orderPickButtonLabel;
  }
  if (typeof futureRaw.orderPickRedirectToCheckout === "boolean") {
    future.orderPickRedirectToCheckout = futureRaw.orderPickRedirectToCheckout;
  }
  if (typeof futureRaw.regionUnsetLabel === "string") {
    future.regionUnsetLabel = futureRaw.regionUnsetLabel.trim() || "その他";
  }

  // sort
  const sortRaw = safe.sort || {};
  const sort = {
    mode:
      typeof sortRaw.mode === "string"
        ? sortRaw.mode
        : defaultConfig.sort.mode,
  };

  // messages（メッセージ文言）
  const messagesRaw = safe.messages || {};
  const messages = { ...defaultConfig.messages };
  if (typeof messagesRaw.loading === "string") {
    messages.loading = messagesRaw.loading;
  }
  if (typeof messagesRaw.empty === "string") {
    messages.empty = messagesRaw.empty;
  }
  if (typeof messagesRaw.error === "string") {
    messages.error = messagesRaw.error;
  }

  // notice（共通注意書き）
  let notice = null;
  if (
    safe.notice &&
    typeof safe.notice.text === "string" &&
    safe.notice.text.trim() !== ""
  ) {
    notice = { text: safe.notice.text };
  }

  // 上部固定（1 ロケーションだけ先頭に表示）
  const pinnedLocationId =
    typeof safe.pinnedLocationId === "string" && safe.pinnedLocationId.trim() !== ""
      ? safe.pinnedLocationId.trim()
      : null;

  // エリアグループ（表示順をスニペットに渡す。sortOrder でソート）
  const regionGroupsRaw = Array.isArray(safe.regionGroups)
    ? safe.regionGroups.filter((g) => g && g.id && g.name)
    : [];
  const regionGroups = regionGroupsRaw
    .map((g, i) => ({ ...g, sortOrder: typeof g.sortOrder === "number" ? g.sortOrder : i + 1 }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    thresholds,
    quantity,
    symbols,
    labels,
    locations,
    click,
    future,
    sort,
    messages,
    notice,
    pinnedLocationId,
    regionGroups,
  };
}

export async function loader({ request }) {
  try {
    const auth = await shopify.authenticate.public.appProxy(request);
    const { admin, session } = auth || {};

    if (!admin) {
      logAppProxyError(
        session?.shop,
        null,
        "missing_admin_client",
        "管理画面 API クライアントの初期化に失敗しました。アプリの設定（APIキーなど）を確認してください。",
        null
      );
      return errorJson(
        "missing_admin_client",
        "管理画面 API クライアントの初期化に失敗しました。アプリの設定（APIキーなど）を確認してください。"
      );
    }

    const url = new URL(request.url);
    // 分析イベント（App Proxy は GET のみのためクエリで受信）
    if (url.searchParams.get("action") === "analytics") {
      const eventType = url.searchParams.get("event");
      const dateStr = url.searchParams.get("date");
      if (eventType && dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const allowed = ["area_display", "nearby_click", "order_pick_click"];
        if (allowed.includes(eventType)) {
          try {
            const shopIdRes = await admin.graphql(SHOP_ID_QUERY);
            const shopIdJson = await shopIdRes.json();
            const shopId = shopIdJson?.data?.shop?.id;
            if (shopId) {
              const payload = {};
              if (eventType === "nearby_click") {
                const ids = url.searchParams.get("locationIds");
                payload.locationIds = ids ? ids.split(",").filter(Boolean) : [];
              }
              if (eventType === "order_pick_click") {
                const id = url.searchParams.get("locationId");
                if (id) payload.locationId = id;
              }
              await recordAnalyticsEvent(admin, shopId, dateStr, eventType, payload);
            }
          } catch (analyticsErr) {
            console.error("[location-stock] analytics record error:", analyticsErr);
          }
        }
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const variantId = url.searchParams.get("variant_id");

    if (!variantId) {
      logAppProxyError(session?.shop, null, "missing_variant_id", "variant_id が指定されていません。", null);
      return errorJson("missing_variant_id", "variant_id が指定されていません。");
    }

    const variantGid = `gid://shopify/ProductVariant/${variantId}`;

    const gqlResponse = await admin.graphql(
      VARIANT_INVENTORY_WITH_CONFIG_QUERY,
      {
        variables: { id: variantGid },
      }
    );

    const result = await gqlResponse.json();

    if (result.errors && result.errors.length > 0) {
      logAppProxyError(session?.shop, variantId, "graphql_error", "在庫情報の取得中にエラーが発生しました。", result.errors);
      return errorJson("graphql_error", "在庫情報の取得中にエラーが発生しました。");
    }

    const variant = result?.data?.productVariant;
    const metafieldValue = result?.data?.shop?.metafield?.value;

    if (!variant || !variant.inventoryItem) {
      return successJson({
        variantId,
        variantTitle: variant?.title ?? null,
        stocks: [],
        config: buildGlobalConfig(null),
      });
    }

    // 配送プロファイルから locationId → { hasShipping, hasLocalDelivery } を取得（read_shipping が必要）
    let deliveryFlagsByLocationId = new Map();
    try {
      const dpRes = await admin.graphql(DELIVERY_PROFILES_QUERY);
      const dpResult = await dpRes.json();
      if (dpResult.errors?.length) {
        console.warn(
          "[location-stock] deliveryProfiles query returned GraphQL errors (要因: スコープ未付与 or API 制限):",
          JSON.stringify(dpResult.errors, null, 2)
        );
      } else if (dpResult.data) {
        deliveryFlagsByLocationId = buildLocationDeliveryFlags(dpResult.data);
      }
    } catch (dpErr) {
      console.warn("[location-stock] deliveryProfiles fetch failed:", dpErr);
    }

    // 在庫レベルをベースの stocks に変換（配送・店舗受け取りフラグを付与）
    const levels = variant.inventoryItem.inventoryLevels?.edges ?? [];
    const baseStocks = levels.map((edge) => {
      const node = edge.node;
      const location = node.location;
      const quantities = node.quantities ?? [];
      const availableEntry = quantities.find((q) => q.name === "available");
      const quantity = availableEntry?.quantity ?? 0;
      const flags = deliveryFlagsByLocationId.get(location?.id) ?? {
        hasShipping: false,
        hasLocalDelivery: false,
      };

      const address = location?.address;
      const regionKey =
        [address?.city, address?.provinceCode, address?.countryCode]
          .filter(Boolean)
          .join("_") || location?.name || "Unknown";

      return {
        locationId: location.id ?? null,
        locationName: location.name ?? "Unknown location",
        fulfillsOnlineOrders: !!location.fulfillsOnlineOrders,
        quantity,
        hasShipping: flags.hasShipping,
        hasLocalDelivery: flags.hasLocalDelivery,
        storePickupEnabled: !!location?.localPickupSettingsV2,
        regionKey,
        latitude: address?.latitude ?? null,
        longitude: address?.longitude ?? null,
      };
    });

    // メタフィールド JSON をパース
    let rawConfig = null;
    if (metafieldValue) {
      try {
        rawConfig = JSON.parse(metafieldValue);
      } catch (e) {
        console.error("Failed to parse location_stock.config JSON:", e);
      }
    }

    // ロケーション装飾
    const stocks = applyConfigToStocks(baseStocks, rawConfig || {});

    // グローバル設定（config）を構築
    const globalConfig = buildGlobalConfig(rawConfig || {});

    return successJson({
      variantId,
      variantTitle: variant.title,
      stocks,
      config: globalConfig,
    });
  } catch (error) {
    let variantId = null;
    try {
      variantId = new URL(request.url).searchParams.get("variant_id");
    } catch (_) { /* URL パース失敗時 */ }
    logAppProxyError(
      null,
      variantId,
      "internal_error",
      error instanceof Error ? error.message : String(error),
      error
    );
    return errorJson(
      "internal_error",
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * 分析イベント受信（ストアフロントから POST）
 * body: { event: "area_display"|"nearby_click"|"order_pick_click", date: "YYYY-MM-DD", locationId?: string, locationIds?: string[] }
 */
export async function action({ request }) {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const auth = await shopify.authenticate.public.appProxy(request);
    const { admin, session } = auth || {};
    if (!admin) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const shopIdRes = await admin.graphql(SHOP_ID_QUERY);
    const shopIdJson = await shopIdRes.json();
    const shopId = shopIdJson?.data?.shop?.id;
    if (!shopId) {
      return new Response(JSON.stringify({ ok: false, error: "Shop not found" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    let body = {};
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const eventType = body?.event;
    const dateStr = body?.date;
    if (!eventType || !dateStr) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing event or date" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid date format (use YYYY-MM-DD)" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const allowed = ["area_display", "nearby_click", "order_pick_click"];
    if (!allowed.includes(eventType)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid event type" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const payload = {};
    if (eventType === "nearby_click" && Array.isArray(body.locationIds)) {
      payload.locationIds = body.locationIds;
    }
    if (eventType === "order_pick_click" && body.locationId) {
      payload.locationId = body.locationId;
    }
    await recordAnalyticsEvent(admin, shopId, dateStr, eventType, payload);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[location-stock] analytics action error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
