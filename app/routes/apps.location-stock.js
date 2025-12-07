// app/routes/apps.location-stock.js

import shopify from "../shopify.server";

/**
 * バリアント在庫 + ショップメタフィールド(location_stock.config) をまとめて取得
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
        };
      }

      // enabled === false のものは非表示
      if (cfg.enabled === false) {
        return null;
      }

      // メタフィールドで明示設定されたロケーション
      return {
        ...stock,
        displayName: cfg.publicName || stock.locationName,
        sortOrder:
          typeof cfg.sortOrder === "number" ? cfg.sortOrder : 999999,
        fromConfig: true,
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
      showOrderPickButton: false,
      orderPickButtonLabel: "この店舗で受け取る",
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
  if (typeof futureRaw.showOrderPickButton === "boolean") {
    future.showOrderPickButton = futureRaw.showOrderPickButton;
  }
  if (typeof futureRaw.orderPickButtonLabel === "string") {
    future.orderPickButtonLabel = futureRaw.orderPickButtonLabel;
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
  };
}

export async function loader({ request }) {
  try {
    const auth = await shopify.authenticate.public.appProxy(request);
    const { admin, session } = auth || {};

    if (!admin) {
      console.error("Admin client is undefined in app proxy loader", {
        shop: session?.shop,
        sessionType: session?.isOnline ? "online" : "offline",
      });

      return errorJson(
        "missing_admin_client",
        "管理画面 API クライアントの初期化に失敗しました。アプリの設定（APIキーなど）を確認してください。"
      );
    }

    const url = new URL(request.url);
    const variantId = url.searchParams.get("variant_id");

    if (!variantId) {
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
      console.error("VariantInventoryWithConfig errors:", result.errors);
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

    // 在庫レベルをベースの stocks に変換
    const levels = variant.inventoryItem.inventoryLevels?.edges ?? [];
    const baseStocks = levels.map((edge) => {
      const node = edge.node;
      const location = node.location;
      const quantities = node.quantities ?? [];
      const availableEntry = quantities.find((q) => q.name === "available");
      const quantity = availableEntry?.quantity ?? 0;

      return {
        locationId: location.id ?? null,
        locationName: location.name ?? "Unknown location",
        fulfillsOnlineOrders: !!location.fulfillsOnlineOrders,
        quantity,
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
    console.error("location-stock loader error:", error);
    return errorJson(
      "internal_error",
      error instanceof Error ? error.message : String(error)
    );
  }
}
