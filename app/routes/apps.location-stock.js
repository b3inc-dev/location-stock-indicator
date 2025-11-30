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

export async function loader({ request }) {
  try {
    const { admin } = await shopify.authenticate.public.appProxy(request);

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
    let config = null;
    if (metafieldValue) {
      try {
        config = JSON.parse(metafieldValue);
      } catch (e) {
        console.error("Failed to parse location_stock.config JSON:", e);
      }
    }

    const stocks = applyConfigToStocks(baseStocks, config);

    return successJson({
      variantId,
      variantTitle: variant.title,
      stocks,
    });
  } catch (error) {
    console.error("location-stock loader error:", error);
    return errorJson(
      "internal_error",
      error instanceof Error ? error.message : String(error)
    );
  }
}
