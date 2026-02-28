// app/routes/app.locations.jsx

import { useRef, useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import shopify from "../shopify.server";

/**
 * ロケーション一覧 + shop メタフィールド(location_stock.config) を取得
 * - localPickupSettingsV2: 店舗受け取り対応の有無（read_locations または read_shipping が必要）
 */
const LOCATIONS_AND_CONFIG_QUERY = `#graphql
  query LocationsAndConfig {
    shop {
      id
      metafield(namespace: "location_stock", key: "config") {
        value
      }
    }
    locations(first: 100) {
      nodes {
        id
        name
        fulfillsOnlineOrders
        localPickupSettingsV2 {
          pickupTime
        }
      }
    }
  }
`;

/**
 * 配送プロファイルから「配送対応」「ローカルデリバリー対応」をロケーション単位で集計する（read_shipping が必要）
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

const SAVE_CONFIG_MUTATION = `#graphql
  mutation SaveLocationStockConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
      }
      userErrors {
        field
        message
      }
    }
  }
`;

/**
 * 配送方法名またはゾーン名から「ローカルデリバリー」かどうかを判定する（API に methodType がないため名前で判定）。
 * 管理画面で「Local Delivery」と表示されるのはゾーン名のため、ゾーン名も参照する。
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
 * deliveryProfiles のレスポンスから locationId → { hasShipping, hasLocalDelivery } を構築
 * @param {object} deliveryProfilesData - deliveryProfiles クエリのレスポンス
 * @param {{ logDebug?: boolean }} options - logDebug: true でゾーン名・ロケーションIDを console.warn
 */
function buildLocationDeliveryFlags(deliveryProfilesData, options = {}) {
  const map = new Map();
  const debugLog = [];
  const nodes = deliveryProfilesData?.deliveryProfiles?.nodes ?? [];
  for (const profile of nodes) {
    const groups = profile.profileLocationGroups ?? [];
    for (const plg of groups) {
      const locsRaw = plg.locationGroup?.locations;
      const locNodes = locsRaw?.nodes ?? (Array.isArray(locsRaw?.edges) ? locsRaw.edges.map((e) => e.node) : []) ?? [];
      const locationIds = locNodes.map((n) => n.id).filter(Boolean);
      let hasShipping = false;
      let hasLocalDelivery = false;
      const zoneNames = [];
      const zonesRaw = plg.locationGroupZones;
      const zones =
        zonesRaw?.nodes ??
        (Array.isArray(zonesRaw?.edges) ? zonesRaw.edges.map((e) => e.node) : []) ??
        [];
      for (const zoneNode of zones) {
        const zoneName = zoneNode.zone?.name ?? "";
        zoneNames.push(zoneName || "(空)");
        if (isLocalDeliveryMethodName(zoneName)) {
          hasLocalDelivery = true;
        }
        const methodsRaw = zoneNode.methodDefinitions;
        const methods =
          methodsRaw?.nodes ??
          (Array.isArray(methodsRaw?.edges) ? methodsRaw.edges.map((e) => e.node) : []) ??
          [];
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
    const groupCount = nodes.reduce((sum, p) => sum + (p.profileLocationGroups?.length ?? 0), 0);
    console.warn(
      "[location-stock] deliveryProfiles: プロファイル数 =",
      profileCount,
      "ロケーショングループ数 =",
      groupCount
    );
    if (debugLog.length > 0) {
      console.warn("[location-stock] deliveryProfiles debug (各グループのゾーン・ロケーション):", JSON.stringify(debugLog, null, 2));
    }
    console.warn(
      "[location-stock] deliveryFlags map:",
      Object.fromEntries(
        Array.from(map.entries()).map(([k, v]) => [k, v])
      )
    );
  }
  return map;
}

/** 管理画面エラー時に shop・ルートをログに含める（REQUIREMENTS §8） */
function logLocationsError(shop, context, message, detail) {
  const prefix = "[location-stock]";
  const ctx = { route: "app.locations", shop: shop || "(unknown)" };
  if (detail !== undefined) console.error(prefix, ctx, message, detail);
  else console.error(prefix, ctx, message);
}

export async function loader({ request }) {
  const { admin, session } = await shopify.authenticate.admin(request);
  const shop = session?.shop ?? "(unknown)";

  const res = await admin.graphql(LOCATIONS_AND_CONFIG_QUERY);
  const result = await res.json();

  if (result.errors && result.errors.length > 0) {
    logLocationsError(shop, "loader", "LocationsAndConfig errors:", result.errors);
    throw new Response("Failed to load locations", { status: 500 });
  }

  const shopData = result.data.shop;
  const locations = result.data.locations.nodes || [];
  const metafieldValue = shopData.metafield?.value;

  let deliveryFlagsByLocationId = new Map();
  try {
    const dpRes = await admin.graphql(DELIVERY_PROFILES_QUERY);
    const dpResult = await dpRes.json();

    if (dpResult.errors?.length) {
      console.warn(
        "[location-stock]",
        { route: "app.locations", shop },
        "deliveryProfiles query returned GraphQL errors (要因: スコープ未付与 or API 制限):",
        JSON.stringify(dpResult.errors, null, 2)
      );
    }
    if (dpResult.data && !dpResult.errors?.length) {
      const debugDelivery =
        typeof request !== "undefined" &&
        new URL(request.url).searchParams.get("debug") === "delivery";
      deliveryFlagsByLocationId = buildLocationDeliveryFlags(dpResult.data, {
        logDebug: debugDelivery,
      });
      const profileCount = dpResult.data?.deliveryProfiles?.nodes?.length ?? 0;
      if (profileCount === 0) {
        console.warn(
          "[location-stock]",
          { route: "app.locations", shop },
          "deliveryProfiles が 0 件です。設定 > 配送で配送プロファイルが作成されているか、merchantOwnedOnly の対象か確認してください。"
        );
      }
    }
  } catch (e) {
    console.warn(
      "[location-stock]",
      { route: "app.locations", shop },
      "Delivery profiles query failed (scope or network):",
      e instanceof Error ? e.message : e
    );
  }

  let config = null;
  if (metafieldValue) {
    try {
      config = JSON.parse(metafieldValue);
    } catch (e) {
      logLocationsError(shop, "loader", "Failed to parse location_stock.config JSON:", e);
    }
  }

  const locationsConfig = Array.isArray(config?.locations)
    ? config.locations
    : [];

  const regionGroupsRaw = Array.isArray(config?.regionGroups)
    ? config.regionGroups.filter((g) => g && g.id && g.name)
    : [];
  const regionGroups = regionGroupsRaw
    .map((g, i) => ({ ...g, sortOrder: typeof g.sortOrder === "number" ? g.sortOrder : i + 1 }))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const rows = locations
    .map((loc) => {
      const cfg = locationsConfig.find((c) => c.locationId === loc.id);
      const flags = deliveryFlagsByLocationId.get(loc.id) || {
        hasShipping: false,
        hasLocalDelivery: false,
      };

      return {
        locationId: loc.id,
        shopifyName: loc.name,
        fulfillsOnlineOrders: !!loc.fulfillsOnlineOrders,
        hasShipping: flags.hasShipping,
        hasLocalDelivery: flags.hasLocalDelivery,
        storePickupEnabled: !!loc.localPickupSettingsV2,
        enabled: cfg ? cfg.enabled !== false : true,
        publicName: cfg?.publicName || loc.name,
        sortOrder:
          typeof cfg?.sortOrder === "number" ? cfg.sortOrder : 999999,
        fromConfig: !!cfg,
        regionGroupId: cfg?.regionGroupId ?? "",
        excludeFromNearby: !!cfg?.excludeFromNearby,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const allowedSortModes = [
    "location_name_asc",
    "quantity_desc",
    "quantity_asc",
    "in_stock_first",
    "store_pickup_first",
    "shipping_first",
    "local_delivery_first",
  ];
  const sortMode =
    config?.sort?.mode && allowedSortModes.includes(config.sort.mode)
      ? config.sort.mode
      : "none";
  const pinnedLocationId =
    typeof config?.pinnedLocationId === "string" && config.pinnedLocationId.trim() !== ""
      ? config.pinnedLocationId.trim()
      : null;

  const future = {
    groupByRegion: !!config?.future?.groupByRegion,
    regionAccordionEnabled: !!config?.future?.regionAccordionEnabled,
    nearbyFirstEnabled: !!config?.future?.nearbyFirstEnabled,
    nearbyOtherCollapsible: !!config?.future?.nearbyOtherCollapsible,
    nearbyOtherHeading: (config?.future?.nearbyOtherHeading && String(config.future.nearbyOtherHeading).trim()) || "",
    showOrderPickButton: !!config?.future?.showOrderPickButton,
    orderPickButtonLabel: config?.future?.orderPickButtonLabel ?? "この店舗で受け取る",
    orderPickRedirectToCheckout: !!config?.future?.orderPickRedirectToCheckout,
    regionUnsetLabel: (config?.future?.regionUnsetLabel && String(config.future.regionUnsetLabel).trim()) || "その他",
  };

  return {
    shopId: shopData.id,
    rows,
    sortMode,
    pinnedLocationId,
    regionGroups,
    future,
  };
}

export async function action({ request }) {
  const { admin, session } = await shopify.authenticate.admin(request);
  const shop = session?.shop ?? "(unknown)";
  const formData = await request.formData();

  const shopId = formData.get("shopId");
  if (!shopId) {
    return {
      ok: false,
      error: "shopId が送信されていません。",
    };
  }

  // 既存の config を取得（在庫表示設定など他項目を上書きしないため）
  const configRes = await admin.graphql(LOCATIONS_AND_CONFIG_QUERY);
  const configResult = await configRes.json();
  const metafieldValue = configResult?.data?.shop?.metafield?.value;
  let currentConfig = {};
  if (metafieldValue) {
    try {
      currentConfig = JSON.parse(metafieldValue);
    } catch (e) {
      logLocationsError(shop, "action", "Failed to parse location_stock.config in action:", e);
    }
  }

  const locationIds = formData.getAll("locationId").map(String);
  const publicNames = formData.getAll("publicName").map(String);
  const sortOrdersRaw = formData.getAll("sortOrder").map(String);
  const regionGroupIds = formData.getAll("regionGroupId").map((id) => (id === "" ? null : id));

  const enabledIds = new Set(
    formData.getAll("enabledLocationId").map(String)
  );
  const excludeFromNearbyIds = new Set(
    formData.getAll("excludeFromNearbyLocationId").map(String)
  );

  let regionGroups = currentConfig.regionGroups;
  const regionGroupsJson = formData.get("region_groups_json");
  if (typeof regionGroupsJson === "string" && regionGroupsJson.trim() !== "") {
    try {
      const parsed = JSON.parse(regionGroupsJson);
      const list = Array.isArray(parsed) ? parsed.filter((g) => g && g.id && g.name) : regionGroups;
      regionGroups = list
        .map((g, i) => ({ ...g, sortOrder: typeof g.sortOrder === "number" ? g.sortOrder : i + 1 }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
    } catch (_) { /* JSON パース失敗時は既存を維持 */ }
  }
  if (!Array.isArray(regionGroups)) regionGroups = [];

  const locations = locationIds.map((locationId, index) => {
    const publicName = publicNames[index] || "";
    const sortOrderStr = sortOrdersRaw[index] || "";
    const parsedSort = Number.parseInt(sortOrderStr, 10);
    const sortOrder = Number.isFinite(parsedSort) ? parsedSort : 999999;
    const regionGroupId = regionGroupIds[index] ?? null;

    return {
      locationId,
      enabled: enabledIds.has(locationId),
      publicName: publicName || "",
      sortOrder,
      regionGroupId: regionGroupId || undefined,
      excludeFromNearby: excludeFromNearbyIds.has(locationId),
    };
  });

  const allowedSortModes = [
    "location_name_asc",
    "quantity_desc",
    "quantity_asc",
    "in_stock_first",
    "store_pickup_first",
    "shipping_first",
    "local_delivery_first",
  ];
  const sortModeRaw = (formData.get("sort_mode") || "").toString();
  const sortMode = allowedSortModes.includes(sortModeRaw) ? sortModeRaw : "none";
  const pinnedLocationIdRaw = (formData.get("pinnedLocationId") || "").toString().trim();
  const pinnedLocationId = pinnedLocationIdRaw !== "" ? pinnedLocationIdRaw : null;

  const future = {
    ...(currentConfig.future || {}),
    groupByRegion: formData.get("future_group_by_region") === "on",
    regionAccordionEnabled: formData.get("future_region_accordion") === "on",
    nearbyFirstEnabled: formData.get("future_nearby_first") === "on",
    nearbyOtherCollapsible: formData.get("future_nearby_other_collapsible") === "on",
    nearbyOtherHeading: (formData.get("future_nearby_other_heading") || "").toString().trim(),
    showOrderPickButton: formData.get("future_show_order_pick_button") === "on",
    orderPickButtonLabel: (formData.get("future_order_pick_button_label") || "この店舗で受け取る").toString().trim(),
    orderPickRedirectToCheckout: formData.get("future_order_pick_redirect_to_checkout") === "on",
    regionUnsetLabel: (formData.get("future_region_unset_label") || "その他").toString().trim() || "その他",
  };

  const nextConfig = {
    ...currentConfig,
    locations,
    sort: { ...(currentConfig.sort || {}), mode: sortMode },
    pinnedLocationId: pinnedLocationId ?? null,
    regionGroups,
    future,
  };

  const saveResponse = await admin.graphql(SAVE_CONFIG_MUTATION, {
    variables: {
      metafields: [
        {
          namespace: "location_stock",
          key: "config",
          type: "json",
          ownerId: shopId,
          value: JSON.stringify(nextConfig),
        },
      ],
    },
  });

  const saveResult = await saveResponse.json();
  const userErrors = saveResult.data?.metafieldsSet?.userErrors || [];

  if (userErrors.length > 0) {
    logLocationsError(shop, "action", "metafieldsSet userErrors:", userErrors);
    return {
      ok: false,
      error: "メタフィールド保存中にエラーが発生しました。",
      userErrors,
    };
  }

  return { ok: true };
}

/**
 * ロケーション設定（表示ルール + 一覧テーブル、固定フッターで破棄・保存）
 */
const defaultFuture = {
  groupByRegion: false,
  regionAccordionEnabled: false,
  nearbyFirstEnabled: false,
  nearbyOtherCollapsible: false,
  nearbyOtherHeading: "",
  showOrderPickButton: false,
  orderPickButtonLabel: "この店舗で受け取る",
  orderPickRedirectToCheckout: false,
  regionUnsetLabel: "その他",
};

export default function LocationsConfigPage() {
  const loaderData = useLoaderData();
  const {
    rows: initialRows,
    shopId,
    sortMode: initialSortMode,
    pinnedLocationId: initialPinnedLocationId,
    regionGroups: initialRegionGroups,
    future: initialFuture,
  } = loaderData;
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [rows, setRows] = useState(initialRows);
  const [sortMode, setSortMode] = useState(initialSortMode);
  const [pinnedLocationId, setPinnedLocationId] = useState(initialPinnedLocationId);
  const [regionGroups, setRegionGroups] = useState(initialRegionGroups || []);
  const [future, setFuture] = useState(initialFuture || defaultFuture);
  const justSavedRef = useRef(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const lastHandledSaveRef = useRef(null);

  const isDirty = useMemo(
    () =>
      JSON.stringify(rows) !== JSON.stringify(initialRows) ||
      sortMode !== initialSortMode ||
      (pinnedLocationId || "") !== (initialPinnedLocationId || "") ||
      JSON.stringify(regionGroups) !== JSON.stringify(initialRegionGroups || []) ||
      JSON.stringify(future) !== JSON.stringify(initialFuture || defaultFuture),
    [rows, initialRows, sortMode, initialSortMode, pinnedLocationId, initialPinnedLocationId, regionGroups, initialRegionGroups, future, initialFuture]
  );

  const saving = fetcher.state !== "idle";
  const saveOk = fetcher.data && fetcher.data.ok === true;
  const saveErr = fetcher.data && fetcher.data.ok === false ? fetcher.data.error : null;

  // 保存成功は「同じレスポンス」に対して1回だけ処理（毎回の再レンダーで繰り返さない）
  useEffect(() => {
    if (!saveOk || !fetcher.data) return;
    if (lastHandledSaveRef.current === fetcher.data) return;
    lastHandledSaveRef.current = fetcher.data;
    justSavedRef.current = true;
    setShowSavedFeedback(true);
    revalidator.revalidate();
  }, [saveOk, fetcher.data, revalidator]);

  // 保存後に revalidate で loaderData が更新されたときだけ state を同期
  useEffect(() => {
    if (!justSavedRef.current) return;
    justSavedRef.current = false;
    setRows(loaderData.rows);
    setSortMode(loaderData.sortMode);
    setPinnedLocationId(loaderData.pinnedLocationId);
    setRegionGroups(loaderData.regionGroups || []);
    setFuture(loaderData.future || defaultFuture);
  }, [loaderData]);

  // 保存直後にユーザーが再編集した場合は、後から届いた initialRows で上書きしない
  useEffect(() => {
    if (isDirty) justSavedRef.current = false;
  }, [isDirty]);

  // 保存完了メッセージを約3秒表示してから非表示
  useEffect(() => {
    if (!showSavedFeedback) return;
    const t = setTimeout(() => setShowSavedFeedback(false), 3000);
    return () => clearTimeout(t);
  }, [showSavedFeedback]);

  const handleDiscard = () => {
    setRows(initialRows);
    setSortMode(initialSortMode);
    setPinnedLocationId(initialPinnedLocationId);
    setRegionGroups(initialRegionGroups || []);
    setFuture(initialFuture || defaultFuture);
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.set("shopId", shopId);
    formData.set("sort_mode", sortMode);
    if (pinnedLocationId) formData.set("pinnedLocationId", pinnedLocationId);
    formData.set("region_groups_json", JSON.stringify(regionGroups));
    formData.set("future_group_by_region", future.groupByRegion ? "on" : "");
    formData.set("future_region_accordion", future.regionAccordionEnabled ? "on" : "");
    formData.set("future_nearby_first", future.nearbyFirstEnabled ? "on" : "");
    formData.set("future_nearby_other_collapsible", future.nearbyOtherCollapsible ? "on" : "");
    formData.set("future_nearby_other_heading", future.nearbyOtherHeading || "");
    formData.set("future_show_order_pick_button", future.showOrderPickButton ? "on" : "");
    formData.set("future_order_pick_button_label", future.orderPickButtonLabel || "この店舗で受け取る");
    formData.set("future_order_pick_redirect_to_checkout", future.orderPickRedirectToCheckout ? "on" : "");
    formData.set("future_region_unset_label", future.regionUnsetLabel || "その他");
    rows.forEach((r) => {
      formData.append("locationId", r.locationId);
      formData.append("publicName", r.publicName || "");
      formData.append("sortOrder", String(r.sortOrder));
      formData.append("regionGroupId", r.locationId === pinnedLocationId ? "" : (r.regionGroupId || ""));
      if (r.enabled) formData.append("enabledLocationId", r.locationId);
      if (r.excludeFromNearby) formData.append("excludeFromNearbyLocationId", r.locationId);
    });
    fetcher.submit(formData, { method: "post" });
  };

  const addRegionGroup = () => {
    setRegionGroups((prev) => {
      const maxOrder = prev.length === 0 ? 0 : Math.max(...prev.map((g) => g.sortOrder ?? 0));
      return [...prev, { id: "rg-" + Date.now(), name: "新規グループ", sortOrder: maxOrder + 1 }];
    });
  };
  const updateRegionGroup = (id, name) => {
    setRegionGroups((prev) => prev.map((g) => (g.id === id ? { ...g, name } : g)));
  };
  const updateRegionGroupSortOrder = (id, value) => {
    const v = parseInt(value, 10);
    if (!Number.isFinite(v) || v < 1) return;
    setRegionGroups((prev) =>
      prev
        .map((g) => (g.id === id ? { ...g, sortOrder: v } : g))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    );
  };
  const removeRegionGroup = (id) => {
    setRegionGroups((prev) => prev.filter((g) => g.id !== id));
    setRows((prev) => prev.map((r) => (r.regionGroupId === id ? { ...r, regionGroupId: "" } : r)));
  };
  const moveRegionGroupUp = (index) => {
    if (index <= 0) return;
    setRegionGroups((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((g, i) => ({ ...g, sortOrder: i + 1 }));
    });
  };
  const moveRegionGroupDown = (index) => {
    if (index < 0 || index >= regionGroups.length - 1) return;
    setRegionGroups((prev) => {
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((g, i) => ({ ...g, sortOrder: i + 1 }));
    });
  };

  const updateRow = (locationId, patch) => {
    setRows((prev) =>
      prev.map((r) =>
        r.locationId === locationId ? { ...r, ...patch } : r
      )
    );
  };
  const updateRowRegionGroup = (locationId, regionGroupId) => {
    updateRow(locationId, { regionGroupId: regionGroupId || "" });
  };

  const moveRowUp = (locationId) => {
    setRows((prev) => {
      const index = prev.findIndex((r) => r.locationId === locationId);
      if (index <= 0) return prev;
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next.map((r, i) => ({ ...r, sortOrder: i + 1 }));
    });
  };

  const moveRowDown = (locationId) => {
    setRows((prev) => {
      const index = prev.findIndex((r) => r.locationId === locationId);
      if (index < 0 || index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next.map((r, i) => ({ ...r, sortOrder: i + 1 }));
    });
  };

  // 「保存しました」は showSavedFeedback のときだけ表示。ここでは送信中・未保存・エラーのみ
  const footerStatusText = saveErr
    ? `保存エラー: ${saveErr}`
    : saving
      ? "保存中..."
      : isDirty
        ? "未保存の変更があります"
        : "";

  const selectBaseStyle = {
    width: "100%",
    padding: "6px 8px",
    fontSize: 14,
    borderRadius: 4,
    border: "1px solid #c9cccf",
    background: "#fff",
    boxSizing: "border-box",
  };

  return (
    <s-page heading="ロケーション設定">
      <div style={{ padding: "16px", maxWidth: "1200px", paddingBottom: "88px" }}>
        {/* 並び順：左＝説明、右＝カード */}
        <div
          style={{
            display: "flex",
            gap: "24px",
            alignItems: "flex-start",
            flexWrap: "wrap",
            marginBottom: "24px",
          }}
        >
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>
              並び順
            </div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              商品ページの在庫リストの並び方を選びます。「一覧の並び順を使う」にすると、下の一覧で決めた順（並び順の数値・上下ボタン）がそのまま反映されます。
              下部の「上部固定」で 1 店舗を選ぶと、その店舗だけ常に先頭に表示され、残りはここで選んだ並び順で並びます。
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div
              style={{
                background: "#ffffff",
                borderRadius: 12,
                boxShadow: "0 0 0 1px #e1e3e5",
                padding: 16,
              }}
            >
              <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>
                並び順
              </label>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                style={selectBaseStyle}
              >
                <option value="none">一覧の並び順を使う</option>
                <option value="location_name_asc">ロケーション名 昇順（A→Z）</option>
                <option value="quantity_desc">在庫数の多い順</option>
                <option value="quantity_asc">在庫数の少ない順</option>
                <option value="in_stock_first">在庫ありのロケーションを優先</option>
                <option value="store_pickup_first">店舗受け取りのロケーションを優先</option>
                <option value="shipping_first">配送対応のロケーションを優先</option>
                <option value="local_delivery_first">ローカルデリバリー対応のロケーションを優先</option>
              </select>
            </div>
          </div>
        </div>

        {/* エリア設定：最上部にグルーピング・折りたたみ・未設定見出し、その下にグループ一覧 */}
        <div
          style={{
            display: "flex",
            gap: "24px",
            alignItems: "flex-start",
            flexWrap: "wrap",
            marginBottom: "24px",
          }}
        >
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>エリア設定</div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              「エリアでグルーピング」をONにしたとき、ここで登録したグループ名で商品ページの在庫がまとまって表示されます。表示順は右のカードの並び順（数字・上下ボタン）の通りです。下のロケーション一覧の「エリア」列で各ロケーションをどのグループに含めるか選べます。
            </div>
            <div style={{ fontSize: 13, color: "#6d7175", lineHeight: 1.5, marginTop: 8 }}>
              <strong>「エリア」が未設定のロケーション：</strong>「未設定の見出し」で文言を変更できます（デフォルトは「その他」）。見出しのデザインはテーマのカスタマイザーで設定できます。
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div
              style={{
                background: "#ffffff",
                borderRadius: 12,
                boxShadow: "0 0 0 1px #e1e3e5",
                padding: 16,
              }}
            >
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, marginBottom: 12 }}>
                <input type="checkbox" checked={!!future.groupByRegion} onChange={(e) => setFuture((f) => ({ ...f, groupByRegion: e.target.checked }))} />
                <span>エリアでグルーピング</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, marginBottom: 16 }}>
                <input type="checkbox" checked={!!future.regionAccordionEnabled} onChange={(e) => setFuture((f) => ({ ...f, regionAccordionEnabled: e.target.checked }))} />
                <span>エリアごとに折りたたみ表示</span>
              </label>
              <div style={{ marginBottom: 16, paddingTop: 12, borderTop: "1px solid #e1e3e5" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>未設定の見出し</label>
                <input
                  type="text"
                  value={future.regionUnsetLabel || "その他"}
                  onChange={(e) => setFuture((f) => ({ ...f, regionUnsetLabel: e.target.value.trim() || "その他" }))}
                  style={{ ...selectBaseStyle, width: "100%" }}
                  placeholder="その他"
                />
                <div style={{ fontSize: 12, color: "#6d7175", marginTop: 4 }}>エリア未設定のロケーションをまとめる見出しの文言です。</div>
              </div>
              {/* 見出し行（グループ名 → 並び順 → 操作） */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 0",
                  marginBottom: 4,
                  borderBottom: "1px solid #c9cccf",
                }}
              >
                <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#6d7175" }}>グループ名</div>
                <div style={{ width: 120, fontSize: 14, fontWeight: 600, color: "#6d7175" }}>並び順</div>
                <div style={{ width: 70, fontSize: 14, fontWeight: 600, color: "#6d7175", textAlign: "right" }}>操作</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {regionGroups.map((g, index) => (
                  <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="text"
                      value={g.name}
                      onChange={(e) => updateRegionGroup(g.id, e.target.value)}
                      style={{ flex: 1, padding: "6px 8px", fontSize: 14, border: "1px solid #c9cccf", borderRadius: 4, minWidth: 0 }}
                    />
                    {/* 並び順：数字（増減可能）＋矢印（ロケーション一覧と同じ） */}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, width: 120 }}>
                      <input
                        type="number"
                        min={1}
                        value={g.sortOrder ?? index + 1}
                        onChange={(e) => updateRegionGroupSortOrder(g.id, e.target.value)}
                        style={{
                          width: 44,
                          padding: "4px 6px",
                          borderRadius: 4,
                          border: "1px solid #c9cccf",
                          fontSize: 14,
                          textAlign: "center",
                          boxSizing: "border-box",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => moveRegionGroupUp(index)}
                        disabled={index === 0}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 4,
                          border: "1px solid #c9cccf",
                          background: "#fff",
                          fontSize: 14,
                          cursor: index === 0 ? "not-allowed" : "pointer",
                          opacity: index === 0 ? 0.5 : 1,
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveRegionGroupDown(index)}
                        disabled={index === regionGroups.length - 1}
                        style={{
                          padding: "4px 8px",
                          borderRadius: 4,
                          border: "1px solid #c9cccf",
                          background: "#fff",
                          fontSize: 14,
                          cursor: index === regionGroups.length - 1 ? "not-allowed" : "pointer",
                          opacity: index === regionGroups.length - 1 ? 0.5 : 1,
                        }}
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeRegionGroup(g.id)}
                      style={{ padding: "6px 10px", fontSize: 13, border: "1px solid #c9cccf", borderRadius: 4, background: "#fff", cursor: "pointer", flexShrink: 0 }}
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addRegionGroup} style={{ marginTop: 12, padding: "8px 14px", fontSize: 14, border: "1px solid #2c6ecb", borderRadius: 6, background: "#2c6ecb", color: "#fff", cursor: "pointer" }}>エリアを追加</button>
            </div>
          </div>
        </div>

        {/* 近隣店舗表示設定：左＝タイトル・説明、右＝カード */}
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "24px" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>近隣店舗表示設定</div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              チェックを入れると商品ページの在庫一覧の最上部に「近隣店舗」アコーディオンが表示されます。顧客がクリックすると位置情報の許可が求められ、許可すると一番近い店舗がアコーディオン内に表示されます。本社・倉庫など近隣検索から除外したいロケーションは、下のロケーション一覧の「近隣除外」でONにしてください。
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 0 0 1px #e1e3e5", padding: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, marginBottom: 12 }}>
                <input type="checkbox" checked={!!future.nearbyFirstEnabled} onChange={(e) => setFuture((f) => ({ ...f, nearbyFirstEnabled: e.target.checked }))} />
                <span>近隣店舗を表示</span>
              </label>
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>その他ロケーションの見出し</label>
                <input
                  type="text"
                  value={future.nearbyOtherHeading ?? ""}
                  onChange={(e) => setFuture((f) => ({ ...f, nearbyOtherHeading: e.target.value }))}
                  style={{ ...selectBaseStyle, width: "100%" }}
                  placeholder="例：店舗一覧（未入力の場合は見出しは表示されません）"
                />
                <div style={{ fontSize: 12, color: "#6d7175", marginTop: 4 }}>近隣店舗を表示にしたとき、近隣店舗の下に並ぶ「その他」ロケーション一覧の直前に表示する見出しです。入力があった場合のみ見出しを表示し、未入力の場合は見出し行は出さずロケーションのみ表示します。</div>
              </div>
            </div>
          </div>
        </div>

        {/* 店舗受取設定：左＝タイトル・説明、右＝カード */}
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "24px" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>店舗受取設定</div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              「この店舗で受け取る」ボタンを表示すると、各ロケーション行に店舗受け取り用のボタンが表示されます。ボタンをタップするとデフォルトでカートに追加されます。「ボタンタップ後にチェックアウトまでリダイレクトする」をONにすると、カートに追加したあとそのままチェックアウトページへ移動します。ボタンの見た目はテーマのカスタマイザーで変更できます。
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 0 0 1px #e1e3e5", padding: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, marginBottom: 12 }}>
                <input type="checkbox" checked={!!future.showOrderPickButton} onChange={(e) => setFuture((f) => ({ ...f, showOrderPickButton: e.target.checked }))} />
                <span>「この店舗で受け取る」ボタンを表示</span>
              </label>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>ボタンラベル</label>
                <input type="text" value={future.orderPickButtonLabel} onChange={(e) => setFuture((f) => ({ ...f, orderPickButtonLabel: e.target.value }))} style={selectBaseStyle} placeholder="この店舗で受け取る" />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
                <input type="checkbox" checked={!!future.orderPickRedirectToCheckout} onChange={(e) => setFuture((f) => ({ ...f, orderPickRedirectToCheckout: e.target.checked }))} />
                <span>ボタンタップ後にチェックアウトまでリダイレクトする</span>
              </label>
            </div>
          </div>
        </div>

        {/* タイトル＋説明（カードなし・上段） */}
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 14,
              marginBottom: 4,
              color: "#202223",
            }}
          >
            ロケーション一覧
          </div>
          <div
            style={{
              fontSize: 14,
              color: "#6d7175",
              lineHeight: 1.5,
            }}
          >
            チェックが入っているロケーションだけが商品ページに表示されます。
            公開名を入力・保存した場合はその名前で表示され、未入力の場合は Shopify のロケーション名が使われます。
            並び順は数値と上下ボタンで変更でき、「一覧の並び順を使う」のときはこの順番が商品ページに反映されます。上部固定にしたロケーションは常に先頭に表示され、エリアの選択はできません。
          </div>
        </div>

        {/* 100% 幅の設定カード（スマホでは横スクロール） */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: 12,
            boxShadow: "0 0 0 1px #e1e3e5",
            padding: 16,
          }}
        >
          <div
            style={{
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
            }}
          >
            <table
              style={{
                width: "100%",
                minWidth: 640,
                borderCollapse: "collapse",
              }}
            >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        borderBottom: "1px solid #c9cccf",
                        padding: "8px 12px",
                        minWidth: 160,
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#6d7175",
                      }}
                    >
                      ロケーション名
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        borderBottom: "1px solid #c9cccf",
                        padding: "8px 12px",
                        minWidth: 240,
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#6d7175",
                      }}
                    >
                      公開名（表示名）
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        borderBottom: "1px solid #c9cccf",
                        padding: "8px 12px",
                        minWidth: 120,
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#6d7175",
                      }}
                    >
                      エリア
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        borderBottom: "1px solid #c9cccf",
                        padding: "8px 12px",
                        width: 120,
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#6d7175",
                      }}
                    >
                      並び順
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        borderBottom: "1px solid #c9cccf",
                        padding: "8px 12px",
                        width: 100,
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#6d7175",
                      }}
                    >
                      <div>上部固定</div>
                      {pinnedLocationId && (
                        <button
                          type="button"
                          onClick={() => setPinnedLocationId(null)}
                          style={{
                            marginTop: 4,
                            padding: "2px 8px",
                            fontSize: 12,
                            border: "1px solid #c9cccf",
                            borderRadius: 4,
                            background: "#fff",
                            cursor: "pointer",
                            color: "#6d7175",
                          }}
                        >
                          解除
                        </button>
                      )}
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        borderBottom: "1px solid #c9cccf",
                        padding: "8px 12px",
                        width: 80,
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#6d7175",
                      }}
                    >
                      表示
                    </th>
                    <th
                      style={{
                        textAlign: "center",
                        borderBottom: "1px solid #c9cccf",
                        padding: "8px 12px",
                        width: 90,
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#6d7175",
                      }}
                      title="オンストア・本社・倉庫など、近隣検索に含めたくないロケーションでONにします"
                    >
                      近隣除外
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={row.locationId}>
                      <td
                        style={{
                          borderBottom: "1px solid #e1e3e5",
                          padding: "8px 12px",
                          minWidth: 160,
                          fontSize: 14,
                          color: "#202223",
                        }}
                      >
                        <div>{row.shopifyName}</div>
                        {(row.hasShipping || row.hasLocalDelivery || row.storePickupEnabled) && (
                          <div
                            style={{
                              fontSize: 13,
                              color: "#6d7175",
                              marginTop: 4,
                              display: "flex",
                              flexDirection: "column",
                              gap: 2,
                            }}
                          >
                            {row.hasShipping && <div>配送対応</div>}
                            {row.hasLocalDelivery && <div>ローカルデリバリー対応</div>}
                            {row.storePickupEnabled && <div>店舗受け取り対応</div>}
                          </div>
                        )}
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #e1e3e5",
                          padding: "8px 12px",
                          minWidth: 240,
                        }}
                      >
                        <input
                          value={row.publicName}
                          onChange={(e) =>
                            updateRow(row.locationId, {
                              publicName: e.target.value,
                            })
                          }
                          style={{
                            width: "100%",
                            padding: "6px 8px",
                            borderRadius: 4,
                            border: "1px solid #c9cccf",
                            fontSize: 14,
                            boxSizing: "border-box",
                          }}
                        />
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #e1e3e5",
                          padding: "8px 12px",
                          minWidth: 120,
                          verticalAlign: "middle",
                        }}
                      >
                        {row.locationId === pinnedLocationId ? (
                          <span style={{ fontSize: 13, color: "#6d7175" }}>上部固定のためエリアは変更できません</span>
                        ) : (
                          <select
                            value={row.regionGroupId || ""}
                            onChange={(e) => updateRowRegionGroup(row.locationId, e.target.value)}
                            style={{ ...selectBaseStyle, minWidth: 100 }}
                          >
                            <option value="">未設定</option>
                            {regionGroups.map((g) => (
                              <option key={g.id} value={g.id}>{g.name}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #e1e3e5",
                          padding: "8px 12px",
                          width: 120,
                          verticalAlign: "middle",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                          <input
                            type="number"
                            min={1}
                            value={row.sortOrder}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10);
                              if (!Number.isFinite(v) || v < 1) return;
                              setRows((prev) =>
                                prev
                                  .map((r) =>
                                    r.locationId === row.locationId ? { ...r, sortOrder: v } : r
                                  )
                                  .sort((a, b) => a.sortOrder - b.sortOrder)
                              );
                            }}
                            style={{
                              width: 44,
                              padding: "4px 6px",
                              borderRadius: 4,
                              border: "1px solid #c9cccf",
                              fontSize: 14,
                              textAlign: "center",
                              boxSizing: "border-box",
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => moveRowUp(row.locationId)}
                            disabled={index === 0}
                            style={{
                              padding: "4px 8px",
                              borderRadius: 4,
                              border: "1px solid #c9cccf",
                              background: "#fff",
                              fontSize: 14,
                              cursor: index === 0 ? "not-allowed" : "pointer",
                              opacity: index === 0 ? 0.5 : 1,
                            }}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            onClick={() => moveRowDown(row.locationId)}
                            disabled={index === rows.length - 1}
                            style={{
                              padding: "4px 8px",
                              borderRadius: 4,
                              border: "1px solid #c9cccf",
                              background: "#fff",
                              fontSize: 14,
                              cursor: index === rows.length - 1 ? "not-allowed" : "pointer",
                              opacity: index === rows.length - 1 ? 0.5 : 1,
                            }}
                          >
                            ↓
                          </button>
                        </div>
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #e1e3e5",
                          padding: "8px 12px",
                          width: 100,
                          textAlign: "center",
                          verticalAlign: "middle",
                        }}
                      >
                        <input
                          type="radio"
                          name="pinnedLocationId"
                          value={row.locationId}
                          checked={pinnedLocationId === row.locationId}
                          onChange={() => setPinnedLocationId(row.locationId)}
                          style={{ width: 16, height: 16 }}
                        />
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #e1e3e5",
                          padding: "8px 12px",
                          textAlign: "center",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          onChange={(e) =>
                            updateRow(row.locationId, {
                              enabled: e.target.checked,
                            })
                          }
                          style={{ width: 16, height: 16 }}
                        />
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #e1e3e5",
                          padding: "8px 12px",
                          textAlign: "center",
                          verticalAlign: "middle",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!!row.excludeFromNearby}
                          onChange={(e) =>
                            updateRow(row.locationId, {
                              excludeFromNearby: e.target.checked,
                            })
                          }
                          style={{ width: 16, height: 16 }}
                          title="ONにすると近隣店舗の検索対象から外れます（本社・倉庫など）"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
          </div>
        </div>
      </div>

      {/* 固定フッター：変更時または保存直後（「保存しました」を約3秒表示） */}
      {(isDirty || showSavedFeedback) && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "#fff",
            borderTop: "1px solid #e1e3e5",
            padding: "12px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 -2px 6px rgba(0,0,0,0.06)",
            zIndex: 100,
          }}
        >
          <span style={{ fontSize: 14, color: "#6d7175" }}>
            {showSavedFeedback && !isDirty ? "保存しました" : footerStatusText}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={saving || (showSavedFeedback && !isDirty)}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "1px solid #c9cccf",
                background: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: saving || (showSavedFeedback && !isDirty) ? "not-allowed" : "pointer",
                color: "#202223",
              }}
            >
              破棄
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || (showSavedFeedback && !isDirty)}
              style={{
                padding: "8px 16px",
                borderRadius: 6,
                border: "none",
                background: "#2c6ecb",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: saving || (showSavedFeedback && !isDirty) ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      )}
    </s-page>
  );
}
