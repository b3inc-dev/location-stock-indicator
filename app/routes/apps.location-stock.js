// app/routes/apps.location-stock.js

import shopify from "../shopify.server";
import { recordAnalyticsEvent } from "../analytics.server";
import { getShopPlan } from "../utils/shopPlan.server.js";
import {
  isProFeaturesAllowed,
  isStorefrontInventoryAllowed,
} from "../utils/planGate.js";
import {
  ensureOfflineAccessTokenFresh,
  isAdminAuthFailure,
} from "../utils/refresh-offline-session.js";
import {
  DELIVERY_PROFILES_QUERY,
  buildLocationDeliveryFlags,
} from "../utils/deliveryProfiles.js";
import { cacheGet, cacheSet } from "../utils/shortCache.js";

/** deliveryProfiles 短命キャッシュ（ms）— Admin API 連打緩和 */
const DELIVERY_PROFILES_TTL_MS = 60_000;

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
        inventoryLevels(first: 250) {
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

const SHOP_ID_QUERY = `#graphql
  query ShopId { shop { id } }
`;

/**
 * エラー時にショップ・variant_id・コード・メッセージを JSON で console.error（要件 4）
 * correlation 用に refreshStatus 等の非秘密フィールドを載せる。
 */
function logAppProxyError(shop, variantId, code, message, err, extra = {}) {
  console.error(
    "[location-stock] App Proxy error",
    JSON.stringify(
      {
        shop,
        variantId,
        code,
        message,
        err: err ? String(err) : undefined,
        ...extra,
      },
      null,
      2
    )
  );
}

/**
 * App Proxy 開始時の offline token 確保。
 * refresh / migration 失敗かつ needsReauth のときはエラー応答を返す（握りつぶさない）。
 * @returns {Promise<null | Response>}
 */
async function ensureSessionOrErrorResponse(session, admin, context) {
  if (!session) {
    return null;
  }
  let refreshResult;
  try {
    refreshResult = await ensureOfflineAccessTokenFresh(session);
  } catch (refreshErr) {
    logAppProxyError(
      session?.shop,
      context?.variantId ?? null,
      "offline_token_refresh_exception",
      "オフライントークンの更新中に例外が発生しました。",
      refreshErr,
      { route: context?.route }
    );
    return errorJson(
      "session_reauth_required",
      "アプリの再認可が必要です。Shopify 管理画面からアプリを開いてください。"
    );
  }

  if (refreshResult && !refreshResult.ok && refreshResult.needsReauth) {
    logAppProxyError(
      session.shop,
      context?.variantId ?? null,
      "session_reauth_required",
      "オフラインセッションの更新に失敗しました。管理画面からアプリを開いて再認可してください。",
      null,
      {
        route: context?.route,
        refreshStatus: refreshResult.status,
        refreshDetail: refreshResult.detail,
      }
    );
    return errorJson(
      "session_reauth_required",
      "アプリの再認可が必要です。Shopify 管理画面からアプリを開いてください。"
    );
  }

  if (refreshResult && !refreshResult.ok) {
    // needsReauth 以外の失敗（credentials 不足等）も GraphQL 継続せず明示エラー
    logAppProxyError(
      session.shop,
      context?.variantId ?? null,
      "offline_token_unusable",
      "オフライントークンを利用できません。",
      null,
      {
        route: context?.route,
        refreshStatus: refreshResult.status,
        refreshDetail: refreshResult.detail,
      }
    );
    return errorJson(
      "offline_token_unusable",
      "在庫情報を取得できません。しばらくしてから再度お試しください。"
    );
  }

  if (!admin) {
    return null;
  }
  return null;
}

/**
 * admin.graphql は認証失敗時に Response ではなく例外を投げる
 * （HttpResponseError / GraphqlQueryError）。成功時のみ JSON body を返す。
 * @returns {Promise<{ ok: true, result: object } | { ok: false, authFailure: boolean, error: unknown, httpStatus?: number, result?: object }>}
 */
async function runAdminGraphql(admin, query, variables) {
  try {
    const gqlResponse = await admin.graphql(
      query,
      variables ? { variables } : undefined
    );
    const result = await gqlResponse.json();
    // ライブラリが throw しない経路で errors が載る場合にも対応
    if (isAdminAuthFailure(result?.errors, gqlResponse?.status)) {
      return {
        ok: false,
        authFailure: true,
        error: result.errors,
        httpStatus: gqlResponse?.status,
        result,
      };
    }
    return { ok: true, result };
  } catch (error) {
    const httpStatus = error?.response?.code;
    const authFailure = isAdminAuthFailure(error, httpStatus);
    return { ok: false, authFailure, error, httpStatus };
  }
}

/**
 * admin.graphql → JSON。認証失敗なら force refresh を 1 回だけ行い再試行する。
 * 非認証エラーの throw はそのまま再送出せず呼び出し側へ伝播させる。
 * @returns {Promise<{ result: object, retried: boolean, refreshStatus?: string } | { authFailed: true, refreshStatus?: string, result?: object }>}
 */
async function graphqlWithAuthRetry(admin, session, query, variables, context) {
  const first = await runAdminGraphql(admin, query, variables);
  if (first.ok) {
    return { result: first.result, retried: false };
  }
  if (!first.authFailure) {
    // throttle / 5xx / 通常 GraphQL エラー等は従来どおり外枠で扱う
    throw first.error;
  }

  logAppProxyError(
    session?.shop,
    context?.variantId ?? null,
    "graphql_auth_failure",
    "Admin GraphQL が認証エラーを返しました。refresh 後に 1 回再試行します。",
    first.error,
    { route: context?.route, httpStatus: first.httpStatus }
  );

  if (!session) {
    return { authFailed: true, result: first.result, refreshStatus: "no_session" };
  }

  let refreshResult;
  try {
    refreshResult = await ensureOfflineAccessTokenFresh(session, { force: true });
  } catch (e) {
    logAppProxyError(
      session.shop,
      context?.variantId ?? null,
      "offline_token_refresh_exception",
      "認証エラー後の refresh で例外が発生しました。",
      e,
      { route: context?.route }
    );
    return { authFailed: true, result: first.result, refreshStatus: "exception" };
  }

  if (!refreshResult?.ok) {
    logAppProxyError(
      session.shop,
      context?.variantId ?? null,
      "session_reauth_required",
      "認証エラー後の refresh に失敗しました。",
      null,
      {
        route: context?.route,
        refreshStatus: refreshResult?.status,
        refreshDetail: refreshResult?.detail,
      }
    );
    return {
      authFailed: true,
      result: first.result,
      refreshStatus: refreshResult?.status,
    };
  }

  const second = await runAdminGraphql(admin, query, variables);
  if (second.ok) {
    return {
      result: second.result,
      retried: true,
      refreshStatus: refreshResult.status,
    };
  }
  if (!second.authFailure) {
    throw second.error;
  }

  logAppProxyError(
    session?.shop,
    context?.variantId ?? null,
    "graphql_auth_failure_after_refresh",
    "refresh 後も Admin GraphQL が認証エラーです。",
    second.error,
    {
      route: context?.route,
      httpStatus: second.httpStatus,
      refreshStatus: refreshResult.status,
    }
  );
  return {
    authFailed: true,
    result: second.result,
    refreshStatus: refreshResult.status,
  };
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
  // 未設定は true（従来の displayName = publicName || locationName と互換）
  const usePublicName =
    typeof config?.usePublicName === "boolean" ? config.usePublicName : true;

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
      linkUrl: "",
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
          linkUrl: "",
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

      // メタフィールドで明示設定されたロケーション（リンクURLは「リンクを表示する」がONのときのみ使用）
      const linkUrl = (cfg && typeof cfg.linkUrl === "string" && cfg.linkUrl.trim() !== "") ? cfg.linkUrl.trim() : "";
      const displayName =
        usePublicName && cfg.publicName
          ? cfg.publicName
          : stock.locationName;
      return {
        ...stock,
        displayName,
        sortOrder:
          typeof cfg.sortOrder === "number" ? cfg.sortOrder : 999999,
        fromConfig: true,
        regionKey,
        excludeFromNearby: !!cfg.excludeFromNearby,
        linkUrl,
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
      // 未設定時は true（従来どおり publicName || locationName）。明示 false のみ Shopify 名
      usePublicName: true,
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
      nearbyHeading: "",
      nearbyOtherHeading: "",
      showOrderPickButton: false,
      orderPickButtonLabel: "この店舗で受け取る",
      orderPickAddingLabel: "",
      orderPickAddedLabel: "追加しました",
      orderPickOutOfStockLabel: "Sold Out",
      orderPickModalTitle: "カートに追加しました（{count}点）",
      orderPickModalBody: "チェックアウトページでお届け先を「受取」を選択して受取ご希望の店舗をご選択ください。",
      orderPickRedirectToCheckout: false,
      regionUnsetLabel: "その他",
      showLocationLinks: false,
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
  if (typeof futureRaw.nearbyHeading === "string") {
    future.nearbyHeading = futureRaw.nearbyHeading.trim();
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
  if (typeof futureRaw.orderPickAddingLabel === "string") {
    future.orderPickAddingLabel = futureRaw.orderPickAddingLabel.trim();
  }
  if (typeof futureRaw.orderPickAddedLabel === "string") {
    future.orderPickAddedLabel = futureRaw.orderPickAddedLabel.trim() || "追加しました";
  }
  if (typeof futureRaw.orderPickOutOfStockLabel === "string") {
    future.orderPickOutOfStockLabel = futureRaw.orderPickOutOfStockLabel.trim() || "Sold Out";
  }
  if (typeof futureRaw.orderPickModalTitle === "string") {
    future.orderPickModalTitle = futureRaw.orderPickModalTitle.trim() || "カートに追加しました（{count}点）";
  }
  if (typeof futureRaw.orderPickModalBody === "string") {
    future.orderPickModalBody = futureRaw.orderPickModalBody.trim();
  }
  if (typeof futureRaw.orderPickRedirectToCheckout === "boolean") {
    future.orderPickRedirectToCheckout = futureRaw.orderPickRedirectToCheckout;
  }
  if (typeof futureRaw.regionUnsetLabel === "string") {
    future.regionUnsetLabel = futureRaw.regionUnsetLabel.trim() || "その他";
  }
  if (typeof futureRaw.showLocationLinks === "boolean") {
    future.showLocationLinks = futureRaw.showLocationLinks;
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

  // 表示ルール（凡例・注意書きの表示、区切り文字）。行の表示内容は quantity.rowContentMode
  const displayRaw = safe.display || {};
  const display = {
    showLegend: typeof displayRaw.showLegend === "boolean" ? displayRaw.showLegend : true,
    showNotice: typeof displayRaw.showNotice === "boolean" ? displayRaw.showNotice : false,
    listSeparator: typeof displayRaw.listSeparator === "string" ? displayRaw.listSeparator : "： ",
  };

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
    display,
    pinnedLocationId,
    regionGroups,
  };
}

export async function loader({ request }) {
  try {
    const auth = await shopify.authenticate.public.appProxy(request);
    const { admin, session } = auth || {};

    const sessionGate = await ensureSessionOrErrorResponse(session, admin, {
      route: "loader",
    });
    if (sessionGate) return sessionGate;

    if (!admin) {
      logAppProxyError(
        session?.shop,
        null,
        "missing_admin_client",
        "管理画面 API クライアントの初期化に失敗しました。アプリの設定（APIキーなど）を確認してください。",
        null,
        { route: "loader", hasSession: Boolean(session) }
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
            // Lite / plan null では記録しない（features.analytics）
            let analyticsPlan = null;
            try {
              analyticsPlan = await getShopPlan(admin, session?.shop, {
                reportUsage: false,
              });
            } catch (planErr) {
              console.error(
                "[location-stock] getShopPlan failed (analytics skip):",
                planErr
              );
            }
            if (analyticsPlan?.features?.analytics) {
              const shopIdAttempt = await graphqlWithAuthRetry(
                admin,
                session,
                SHOP_ID_QUERY,
                undefined,
                { route: "loader_analytics" }
              );
              if (!shopIdAttempt.authFailed) {
                const shopId = shopIdAttempt.result?.data?.shop?.id;
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
              }
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

    const inventoryAttempt = await graphqlWithAuthRetry(
      admin,
      session,
      VARIANT_INVENTORY_WITH_CONFIG_QUERY,
      { id: variantGid },
      { route: "loader", variantId }
    );

    if (inventoryAttempt.authFailed) {
      return errorJson(
        "session_reauth_required",
        "アプリの再認可が必要です。Shopify 管理画面からアプリを開いてください。"
      );
    }

    const result = inventoryAttempt.result;

    if (result.errors && result.errors.length > 0) {
      logAppProxyError(
        session?.shop,
        variantId,
        "graphql_error",
        "在庫情報の取得中にエラーが発生しました。",
        result.errors,
        { retried: inventoryAttempt.retried, refreshStatus: inventoryAttempt.refreshStatus }
      );
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

    // 配送プロファイル（短命キャッシュ。read_shipping が必要）
    let deliveryFlagsByLocationId = new Map();
    const dpCacheKey = `deliveryProfiles:${session?.shop || "unknown"}`;
    try {
      const cached = cacheGet(dpCacheKey);
      if (cached instanceof Map) {
        deliveryFlagsByLocationId = cached;
      } else {
        const dpAttempt = await graphqlWithAuthRetry(
          admin,
          session,
          DELIVERY_PROFILES_QUERY,
          undefined,
          { route: "loader_delivery", variantId }
        );
        const dpResult = dpAttempt.authFailed ? null : dpAttempt.result;
        if (dpResult?.errors?.length) {
          console.warn(
            "[location-stock] deliveryProfiles query returned GraphQL errors (要因: スコープ未付与 or API 制限):",
            JSON.stringify(dpResult.errors, null, 2)
          );
        } else if (dpResult?.data) {
          deliveryFlagsByLocationId = buildLocationDeliveryFlags(dpResult.data);
          cacheSet(dpCacheKey, deliveryFlagsByLocationId, DELIVERY_PROFILES_TTL_MS);
        }
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
    let globalConfig = buildGlobalConfig(rawConfig || {});

    // 課金ゲート: 公開・未契約は在庫非表示。Pro 専用は Lite/未契約で強制 OFF。
    // プラン取得失敗時は fail-closed（無料開放・Pro バイパスをしない）。
    let shopPlan = null;
    try {
      shopPlan = await getShopPlan(admin, session?.shop, {
        reportUsage: false,
      });
    } catch (planErr) {
      console.error("[location-stock] getShopPlan failed (fail-closed):", planErr);
    }

    if (!isStorefrontInventoryAllowed(shopPlan)) {
      logAppProxyError(
        session?.shop,
        variantId,
        "plan_required",
        "料金プラン未選択のためストアフロント在庫を返しません。",
        null
      );
      return errorJson(
        "plan_required",
        "料金プランを選択すると在庫が表示されます。Shopify 管理画面のアプリからプランを選択してください。"
      );
    }

    if (!isProFeaturesAllowed(shopPlan)) {
      globalConfig = {
        ...globalConfig,
        future: {
          ...globalConfig.future,
          groupByRegion: false,
          regionAccordionEnabled: false,
          nearbyFirstEnabled: false,
          nearbyOtherCollapsible: false,
          showOrderPickButton: false,
        },
      };
    }

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

    const sessionGate = await ensureSessionOrErrorResponse(session, admin, {
      route: "action",
    });
    if (sessionGate) {
      // loader は HTTP 200 + ok:false。action は 401 だが error code は gate と揃える
      const gateBody = await sessionGate.json();
      return new Response(JSON.stringify(gateBody), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!admin) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const shopIdAttempt = await graphqlWithAuthRetry(
      admin,
      session,
      SHOP_ID_QUERY,
      undefined,
      { route: "action" }
    );
    if (shopIdAttempt.authFailed) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "session_reauth_required",
          message:
            "アプリの再認可が必要です。Shopify 管理画面からアプリを開いてください。",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    const shopId = shopIdAttempt.result?.data?.shop?.id;
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
    let analyticsPlan = null;
    try {
      analyticsPlan = await getShopPlan(admin, session?.shop, {
        reportUsage: false,
      });
    } catch (planErr) {
      console.error(
        "[location-stock] getShopPlan failed (analytics action skip):",
        planErr
      );
    }
    if (!analyticsPlan?.features?.analytics) {
      return new Response(JSON.stringify({ ok: true, skipped: "analytics_not_allowed" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
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
