// app/routes/app.locations.jsx

import { useRef, useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher, useRevalidator, useOutletContext } from "react-router";
import shopify from "../shopify.server";
import { getShopPlan } from "../utils/shopPlan.server.js";
import {
  createT,
  getStorefrontConfigDefaults,
  resolveAdminLocale,
} from "../i18n/adminI18n.js";

/**
 * ロケーション一覧 + shop メタフィールド(location_stock.config) を取得
 * - localPickupSettingsV2: 店舗受け取り対応の有無（read_locations または read_shipping が必要）
 */
import { loadLocationDeliveryFlags } from "../utils/deliveryProfiles.js";

const LOCATIONS_AND_CONFIG_QUERY = `#graphql
  query LocationsAndConfig {
    shop {
      id
      metafield(namespace: "location_stock", key: "config") {
        value
      }
    }
    locations(first: 250) {
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
  const shopPlan = await getShopPlan(admin, session?.shop);
  const locale = resolveAdminLocale(shopPlan);
  const defaults = getStorefrontConfigDefaults(locale);

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
    const debugDelivery =
      typeof request !== "undefined" &&
      new URL(request.url).searchParams.get("debug") === "delivery";
    const locationIds = locations.map((loc) => loc.id).filter(Boolean);
    const loaded = await loadLocationDeliveryFlags(admin, session, {
      allLocationIds: locationIds,
      logDebug: debugDelivery,
    });
    deliveryFlagsByLocationId = loaded.flags;
    if (loaded.source === "none") {
      console.warn(
        "[location-stock]",
        { route: "app.locations", shop },
        "配送フラグを取得できませんでした（read_shipping / read_markets 未付与、API 制限、または MDS 読取失敗の可能性）。"
      );
    } else if (loaded.source === "deliveryProfiles" && deliveryFlagsByLocationId.size === 0) {
      console.warn(
        "[location-stock]",
        { route: "app.locations", shop },
        "deliveryProfiles 由来のフラグが 0 件です。設定 > 配送で配送プロファイルが作成されているか確認してください。"
      );
    }
  } catch (e) {
    console.warn(
      "[location-stock]",
      { route: "app.locations", shop },
      "Delivery flags query failed (scope or network):",
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
        linkUrl: (cfg && typeof cfg.linkUrl === "string") ? cfg.linkUrl.trim() : "",
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
    nearbyHeading: (config?.future?.nearbyHeading && String(config.future.nearbyHeading).trim()) || "",
    nearbyOtherHeading: (config?.future?.nearbyOtherHeading && String(config.future.nearbyOtherHeading).trim()) || "",
    showOrderPickButton: !!config?.future?.showOrderPickButton,
    orderPickButtonLabel: config?.future?.orderPickButtonLabel ?? defaults.orderPickButtonLabel,
    orderPickAddingLabel: config?.future?.orderPickAddingLabel ?? "",
    orderPickAddedLabel: config?.future?.orderPickAddedLabel ?? defaults.orderPickAddedLabel,
    orderPickOutOfStockLabel: config?.future?.orderPickOutOfStockLabel ?? defaults.orderPickOutOfStockLabel,
    orderPickModalTitle: config?.future?.orderPickModalTitle ?? defaults.orderPickModalTitle,
    orderPickModalBody: config?.future?.orderPickModalBody ?? defaults.orderPickModalBody,
    orderPickRedirectToCheckout: !!config?.future?.orderPickRedirectToCheckout,
    regionUnsetLabel: (config?.future?.regionUnsetLabel && String(config.future.regionUnsetLabel).trim()) || defaults.regionUnsetLabel,
    showLocationLinks: !!config?.future?.showLocationLinks,
  };

  const allowedLocationsModes = ["all", "online_only", "custom_from_app"];
  const locationsMode =
    typeof config?.locationsMode === "string" &&
    allowedLocationsModes.includes(config.locationsMode)
      ? config.locationsMode
      : "all";
  // 未設定は true（Proxy の applyConfigToStocks と互換）
  const usePublicName =
    typeof config?.usePublicName === "boolean" ? config.usePublicName : true;

  return {
    shopId: shopData.id,
    rows,
    sortMode,
    pinnedLocationId,
    regionGroups,
    future,
    locationsMode,
    usePublicName,
  };
}

export async function action({ request }) {
  const { admin, session } = await shopify.authenticate.admin(request);
  const shop = session?.shop ?? "(unknown)";
  const shopPlan = await getShopPlan(admin, session?.shop);
  const locale = resolveAdminLocale(shopPlan);
  const defaults = getStorefrontConfigDefaults(locale);
  const t = createT(locale);
  const formData = await request.formData();

  const shopId = formData.get("shopId");
  if (!shopId) {
    return {
      ok: false,
      error: t("errors.shopIdNotSent"),
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
  const linkUrls = formData.getAll("linkUrl").map((v) => (typeof v === "string" ? v : "").trim());

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
    const linkUrl = linkUrls[index] ?? "";

    return {
      locationId,
      enabled: enabledIds.has(locationId),
      publicName: publicName || "",
      sortOrder,
      regionGroupId: regionGroupId || undefined,
      excludeFromNearby: excludeFromNearbyIds.has(locationId),
      linkUrl: linkUrl || "",
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
    nearbyHeading: (formData.get("future_nearby_heading") || "").toString().trim(),
    nearbyOtherHeading: (formData.get("future_nearby_other_heading") || "").toString().trim(),
    showOrderPickButton: formData.get("future_show_order_pick_button") === "on",
    orderPickButtonLabel: (formData.get("future_order_pick_button_label") || defaults.orderPickButtonLabel).toString().trim(),
    orderPickAddingLabel: (formData.get("future_order_pick_adding_label") ?? "").toString().trim(),
    orderPickAddedLabel: (formData.get("future_order_pick_added_label") || defaults.orderPickAddedLabel).toString().trim(),
    orderPickOutOfStockLabel: (formData.get("future_order_pick_out_of_stock_label") || defaults.orderPickOutOfStockLabel).toString().trim(),
    orderPickModalTitle: (formData.get("future_order_pick_modal_title") || defaults.orderPickModalTitle).toString().trim(),
    orderPickModalBody: (formData.get("future_order_pick_modal_body") || defaults.orderPickModalBody).toString().trim(),
    orderPickRedirectToCheckout: formData.get("future_order_pick_redirect_to_checkout") === "on",
    regionUnsetLabel: (formData.get("future_region_unset_label") || defaults.regionUnsetLabel).toString().trim() || defaults.regionUnsetLabel,
    showLocationLinks: formData.get("future_show_location_links") === "on",
  };

  const allowedLocationsModes = ["all", "online_only", "custom_from_app"];
  const locationsModeRaw = (formData.get("locationsMode") || "").toString();
  const locationsMode = allowedLocationsModes.includes(locationsModeRaw)
    ? locationsModeRaw
    : "all";
  const usePublicName = formData.get("usePublicName") === "on";

  const nextConfig = {
    ...currentConfig,
    locations,
    locationsMode,
    usePublicName,
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
      error: t("errors.metafieldSaveFailed"),
      userErrors,
    };
  }

  return { ok: true };
}

/**
 * ロケーション設定（表示ルール + 一覧テーブル、固定フッターで破棄・保存）
 */
function buildDefaultFuture(defaults) {
  return {
    groupByRegion: false,
    regionAccordionEnabled: false,
    nearbyFirstEnabled: false,
    nearbyOtherCollapsible: false,
    nearbyHeading: "",
    nearbyOtherHeading: "",
    showOrderPickButton: false,
    orderPickButtonLabel: defaults.orderPickButtonLabel,
    orderPickAddingLabel: "",
    orderPickAddedLabel: defaults.orderPickAddedLabel,
    orderPickOutOfStockLabel: defaults.orderPickOutOfStockLabel,
    orderPickModalTitle: defaults.orderPickModalTitle,
    orderPickModalBody: defaults.orderPickModalBody,
    orderPickRedirectToCheckout: false,
    regionUnsetLabel: defaults.regionUnsetLabel,
    showLocationLinks: false,
  };
}

/** Pro プラン用バッジ（タイトル横に表示） */
function ProBadge() {
  return (
    <span
      style={{
        fontSize: 11,
        padding: "2px 6px",
        background: "#2c6ecb",
        color: "#fff",
        borderRadius: 4,
        fontWeight: 600,
      }}
    >
      Pro
    </span>
  );
}

/** Lite のとき Pro 専用セクションをグレーアウト＋編集不可にするラッパー */
function ProSectionWrapper({ isPro, children, t }) {
  if (isPro) return children;
  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(240, 240, 240, 0.82)",
          zIndex: 10,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          paddingTop: 48,
          borderRadius: 12,
          pointerEvents: "auto",
        }}
      >
        <span
          style={{
            background: "#6d7175",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {t("common.proOnly")}
        </span>
      </div>
      <div style={{ pointerEvents: "none", userSelect: "none" }}>{children}</div>
    </div>
  );
}

export default function LocationsConfigPage() {
  const loaderData = useLoaderData();
  const outletContext = useOutletContext();
  const shopPlan = outletContext?.shopPlan ?? null;
  const locale = outletContext?.locale || resolveAdminLocale(shopPlan);
  const t = outletContext?.t || createT(locale);
  const storefrontDefaults = useMemo(
    () => getStorefrontConfigDefaults(locale),
    [locale]
  );
  const defaultFuture = useMemo(
    () => buildDefaultFuture(storefrontDefaults),
    [storefrontDefaults]
  );
  const isPro = shopPlan?.distribution === "inhouse" || shopPlan?.plan === "pro";
  const {
    rows: initialRows,
    shopId,
    sortMode: initialSortMode,
    pinnedLocationId: initialPinnedLocationId,
    regionGroups: initialRegionGroups,
    future: initialFuture,
    locationsMode: initialLocationsMode,
    usePublicName: initialUsePublicName,
  } = loaderData;
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [rows, setRows] = useState(initialRows);
  const [sortMode, setSortMode] = useState(initialSortMode);
  const [pinnedLocationId, setPinnedLocationId] = useState(initialPinnedLocationId);
  const [regionGroups, setRegionGroups] = useState(initialRegionGroups || []);
  const [future, setFuture] = useState(initialFuture || defaultFuture);
  const [locationsMode, setLocationsMode] = useState(initialLocationsMode || "all");
  const [usePublicName, setUsePublicName] = useState(
    typeof initialUsePublicName === "boolean" ? initialUsePublicName : true
  );
  const justSavedRef = useRef(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const lastHandledSaveRef = useRef(null);
  const tableScrollRef = useRef(null);

  /** 横スクロール領域でホイールの横方向を吸収し、ブラウザの戻る／進むに取られないようにする */
  const handleTableScrollWheel = (e) => {
    const el = tableScrollRef.current;
    if (!el || e.deltaX === 0) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const canScrollLeft = scrollLeft > 0;
    const canScrollRight = scrollLeft < scrollWidth - clientWidth - 1;
    if ((e.deltaX < 0 && canScrollRight) || (e.deltaX > 0 && canScrollLeft)) {
      e.preventDefault();
      el.scrollLeft += e.deltaX;
    }
  };

  const isDirty = useMemo(
    () =>
      JSON.stringify(rows) !== JSON.stringify(initialRows) ||
      sortMode !== initialSortMode ||
      (pinnedLocationId || "") !== (initialPinnedLocationId || "") ||
      JSON.stringify(regionGroups) !== JSON.stringify(initialRegionGroups || []) ||
      JSON.stringify(future) !== JSON.stringify(initialFuture || defaultFuture) ||
      locationsMode !== (initialLocationsMode || "all") ||
      usePublicName !==
        (typeof initialUsePublicName === "boolean" ? initialUsePublicName : true),
    [
      rows,
      initialRows,
      sortMode,
      initialSortMode,
      pinnedLocationId,
      initialPinnedLocationId,
      regionGroups,
      initialRegionGroups,
      future,
      initialFuture,
      locationsMode,
      initialLocationsMode,
      usePublicName,
      initialUsePublicName,
      defaultFuture,
    ]
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
    setLocationsMode(loaderData.locationsMode || "all");
    setUsePublicName(
      typeof loaderData.usePublicName === "boolean" ? loaderData.usePublicName : true
    );
  }, [loaderData, defaultFuture]);

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
    setLocationsMode(initialLocationsMode || "all");
    setUsePublicName(
      typeof initialUsePublicName === "boolean" ? initialUsePublicName : true
    );
  };

  const handleSave = () => {
    // Lite のときは Pro 専用項目を保存しない（OFF で送る）
    const formFuture = isPro
      ? future
      : {
          ...future,
          groupByRegion: false,
          regionAccordionEnabled: false,
          nearbyFirstEnabled: false,
          nearbyOtherCollapsible: false,
          nearbyHeading: "",
          nearbyOtherHeading: "",
          showOrderPickButton: false,
          orderPickButtonLabel: storefrontDefaults.orderPickButtonLabel,
          orderPickAddingLabel: "",
          orderPickAddedLabel: storefrontDefaults.orderPickAddedLabel,
          orderPickOutOfStockLabel: storefrontDefaults.orderPickOutOfStockLabel,
          orderPickModalTitle: storefrontDefaults.orderPickModalTitle,
          orderPickModalBody: storefrontDefaults.orderPickModalBody,
          orderPickRedirectToCheckout: false,
        };
    const formData = new FormData();
    formData.set("shopId", shopId);
    formData.set("sort_mode", sortMode);
    formData.set("locationsMode", locationsMode);
    formData.set("usePublicName", usePublicName ? "on" : "");
    if (pinnedLocationId) formData.set("pinnedLocationId", pinnedLocationId);
    formData.set("region_groups_json", JSON.stringify(regionGroups));
    formData.set("future_group_by_region", formFuture.groupByRegion ? "on" : "");
    formData.set("future_region_accordion", formFuture.regionAccordionEnabled ? "on" : "");
    formData.set("future_nearby_first", formFuture.nearbyFirstEnabled ? "on" : "");
    formData.set("future_nearby_other_collapsible", formFuture.nearbyOtherCollapsible ? "on" : "");
    formData.set("future_nearby_heading", formFuture.nearbyHeading || "");
    formData.set("future_nearby_other_heading", formFuture.nearbyOtherHeading || "");
    formData.set("future_show_order_pick_button", formFuture.showOrderPickButton ? "on" : "");
    formData.set("future_order_pick_button_label", formFuture.orderPickButtonLabel || storefrontDefaults.orderPickButtonLabel);
    formData.set("future_order_pick_adding_label", formFuture.orderPickAddingLabel ?? "");
    formData.set("future_order_pick_added_label", formFuture.orderPickAddedLabel || storefrontDefaults.orderPickAddedLabel);
    formData.set("future_order_pick_out_of_stock_label", formFuture.orderPickOutOfStockLabel || storefrontDefaults.orderPickOutOfStockLabel);
    formData.set("future_order_pick_modal_title", formFuture.orderPickModalTitle ?? storefrontDefaults.orderPickModalTitle);
    formData.set("future_order_pick_modal_body", formFuture.orderPickModalBody ?? storefrontDefaults.orderPickModalBody);
    formData.set("future_order_pick_redirect_to_checkout", formFuture.orderPickRedirectToCheckout ? "on" : "");
    formData.set("future_region_unset_label", formFuture.regionUnsetLabel || storefrontDefaults.regionUnsetLabel);
    formData.set("future_show_location_links", formFuture.showLocationLinks ? "on" : "");
    rows.forEach((r) => {
      formData.append("locationId", r.locationId);
      formData.append("publicName", r.publicName || "");
      formData.append("sortOrder", String(r.sortOrder));
      // Lite のときはエリア・近隣除外は保存しない（Pro 専用のため空で送る）
      formData.append("regionGroupId", isPro ? (r.locationId === pinnedLocationId ? "" : (r.regionGroupId || "")) : "");
      formData.append("linkUrl", r.linkUrl || "");
      if (r.enabled) formData.append("enabledLocationId", r.locationId);
      if (isPro && r.excludeFromNearby) formData.append("excludeFromNearbyLocationId", r.locationId);
    });
    fetcher.submit(formData, { method: "post" });
  };

  const addRegionGroup = () => {
    setRegionGroups((prev) => {
      const maxOrder = prev.length === 0 ? 0 : Math.max(...prev.map((g) => g.sortOrder ?? 0));
      return [...prev, { id: "rg-" + Date.now(), name: storefrontDefaults.newRegionGroupName, sortOrder: maxOrder + 1 }];
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
    ? t("common.saveError", { error: saveErr })
    : saving
      ? t("common.saving")
      : isDirty
        ? t("common.unsavedChanges")
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
    <s-page heading={t("locations.heading")}>
      <div style={{ padding: "16px", maxWidth: "1200px", paddingBottom: "88px" }}>
        {/* 表示ロケーション：locationsMode + usePublicName */}
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
              {t("locations.displayTitle")}
            </div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              {t("locations.displayDesc")}
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
                {t("locations.displayMode")}
              </label>
              <select
                value={locationsMode}
                onChange={(e) => setLocationsMode(e.target.value)}
                style={{ ...selectBaseStyle, marginBottom: 12 }}
              >
                <option value="all">{t("locations.modeAll")}</option>
                <option value="online_only">{t("locations.modeOnlineOnly")}</option>
                <option value="custom_from_app">{t("locations.modeCustom")}</option>
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={!!usePublicName}
                  onChange={(e) => setUsePublicName(e.target.checked)}
                />
                <span>{t("locations.usePublicName")}</span>
              </label>
              <div style={{ fontSize: 12, color: "#6d7175", marginTop: 4 }}>
                {t("locations.usePublicNameHint")}
              </div>
            </div>
          </div>
        </div>

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
              {t("locations.sortTitle")}
            </div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              {t("locations.sortDesc")}
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
                {t("locations.sortLabel")}
              </label>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value)}
                style={selectBaseStyle}
              >
                <option value="none">{t("locations.sortNone")}</option>
                <option value="location_name_asc">{t("locations.sortNameAsc")}</option>
                <option value="quantity_desc">{t("locations.sortQtyDesc")}</option>
                <option value="quantity_asc">{t("locations.sortQtyAsc")}</option>
                <option value="in_stock_first">{t("locations.sortInStockFirst")}</option>
                <option value="store_pickup_first">{t("locations.sortPickupFirst")}</option>
                <option value="shipping_first">{t("locations.sortShippingFirst")}</option>
                <option value="local_delivery_first">{t("locations.sortLocalDeliveryFirst")}</option>
              </select>
            </div>
          </div>
        </div>

        {/* エリア/近隣店舗のデザイン（Pro）：エリア設定＋近隣店舗表示設定の見出し */}
        <ProSectionWrapper isPro={isPro} t={t}>
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: "#202223" }}>{t("locations.areaDesignTitle")}</span>
              <ProBadge />
            </div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              {t("locations.areaDesignDesc")}
            </div>
            <div style={{ fontSize: 13, color: "#6d7175", lineHeight: 1.5, marginTop: 8 }}>
              <strong>{t("locations.areaUnsetNoteLabel")}</strong>{t("locations.areaUnsetNote")}
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
                <span>{t("locations.groupByRegion")}</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, marginBottom: 16 }}>
                <input type="checkbox" checked={!!future.regionAccordionEnabled} onChange={(e) => setFuture((f) => ({ ...f, regionAccordionEnabled: e.target.checked }))} />
                <span>{t("locations.regionAccordion")}</span>
              </label>
              <div style={{ marginBottom: 16, paddingTop: 12, borderTop: "1px solid #e1e3e5" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>{t("locations.regionUnsetLabel")}</label>
                <input
                  type="text"
                  value={future.regionUnsetLabel || storefrontDefaults.regionUnsetLabel}
                  onChange={(e) => setFuture((f) => ({ ...f, regionUnsetLabel: e.target.value.trim() || storefrontDefaults.regionUnsetLabel }))}
                  style={{ ...selectBaseStyle, width: "100%" }}
                  placeholder={storefrontDefaults.regionUnsetLabel}
                />
                <div style={{ fontSize: 12, color: "#6d7175", marginTop: 4 }}>{t("locations.regionUnsetHint")}</div>
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
                <div style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "#6d7175" }}>{t("locations.groupName")}</div>
                <div style={{ width: 120, fontSize: 14, fontWeight: 600, color: "#6d7175" }}>{t("locations.sortOrderCol")}</div>
                <div style={{ width: 70, fontSize: 14, fontWeight: 600, color: "#6d7175", textAlign: "right" }}>{t("locations.actionsCol")}</div>
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
                      {t("common.delete")}
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addRegionGroup} style={{ marginTop: 12, padding: "8px 14px", fontSize: 14, border: "1px solid #2c6ecb", borderRadius: 6, background: "#2c6ecb", color: "#fff", cursor: "pointer" }}>{t("locations.addArea")}</button>
            </div>
          </div>
        </div>
        </ProSectionWrapper>

        {/* 近隣店舗表示設定：左＝タイトル・説明、右＝カード（Pro） */}
        <ProSectionWrapper isPro={isPro} t={t}>
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "24px" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: "#202223" }}>{t("locations.nearbyTitle")}</span>
              <ProBadge />
            </div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              {t("locations.nearbyDesc")}
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 0 0 1px #e1e3e5", padding: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, marginBottom: 12 }}>
                <input type="checkbox" checked={!!future.nearbyFirstEnabled} onChange={(e) => setFuture((f) => ({ ...f, nearbyFirstEnabled: e.target.checked }))} />
                <span>{t("locations.nearbyEnable")}</span>
              </label>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>{t("locations.nearbyHeading")}</label>
                <input
                  type="text"
                  value={future.nearbyHeading ?? ""}
                  onChange={(e) => setFuture((f) => ({ ...f, nearbyHeading: e.target.value }))}
                  style={{ ...selectBaseStyle, width: "100%" }}
                  placeholder={t("locations.nearbyHeadingPh")}
                />
                <div style={{ fontSize: 12, color: "#6d7175", marginTop: 4 }}>{t("locations.nearbyHeadingHint")}</div>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>{t("locations.nearbyOtherHeading")}</label>
                <input
                  type="text"
                  value={future.nearbyOtherHeading ?? ""}
                  onChange={(e) => setFuture((f) => ({ ...f, nearbyOtherHeading: e.target.value }))}
                  style={{ ...selectBaseStyle, width: "100%" }}
                  placeholder={t("locations.nearbyOtherHeadingPh")}
                />
                <div style={{ fontSize: 12, color: "#6d7175", marginTop: 4 }}>{t("locations.nearbyOtherHeadingHint")}</div>
              </div>
            </div>
          </div>
        </div>
        </ProSectionWrapper>

        {/* 店舗受取設定：左＝タイトル・説明、右＝カード（Pro） */}
        <ProSectionWrapper isPro={isPro} t={t}>
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "24px" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: "#202223" }}>{t("locations.orderPickTitle")}</span>
              <ProBadge />
            </div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              {t("locations.orderPickDesc")}
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 0 0 1px #e1e3e5", padding: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14, marginBottom: 12 }}>
                <input type="checkbox" checked={!!future.showOrderPickButton} onChange={(e) => setFuture((f) => ({ ...f, showOrderPickButton: e.target.checked }))} />
                <span>{t("locations.orderPickEnable")}</span>
              </label>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>{t("locations.orderPickButtonLabel")}</label>
                <input type="text" value={future.orderPickButtonLabel} onChange={(e) => setFuture((f) => ({ ...f, orderPickButtonLabel: e.target.value }))} style={selectBaseStyle} placeholder={storefrontDefaults.orderPickButtonLabel} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>{t("locations.orderPickAdding")}</label>
                <input type="text" value={future.orderPickAddingLabel} onChange={(e) => setFuture((f) => ({ ...f, orderPickAddingLabel: e.target.value }))} style={selectBaseStyle} placeholder={t("locations.orderPickAddingPh")} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>{t("locations.orderPickAdded")}</label>
                <input type="text" value={future.orderPickAddedLabel} onChange={(e) => setFuture((f) => ({ ...f, orderPickAddedLabel: e.target.value }))} style={selectBaseStyle} placeholder={storefrontDefaults.orderPickAddedLabel} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>{t("locations.orderPickOutOfStock")}</label>
                <input type="text" value={future.orderPickOutOfStockLabel} onChange={(e) => setFuture((f) => ({ ...f, orderPickOutOfStockLabel: e.target.value }))} style={selectBaseStyle} placeholder={storefrontDefaults.orderPickOutOfStockLabel} />
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>{t("locations.orderPickModalTitle")}</label>
                <input type="text" value={future.orderPickModalTitle} onChange={(e) => setFuture((f) => ({ ...f, orderPickModalTitle: e.target.value }))} style={selectBaseStyle} placeholder={storefrontDefaults.orderPickModalTitle} />
                <div style={{ fontSize: 12, color: "#6d7175", marginTop: 4 }}>{t("locations.orderPickModalTitleHint")}</div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>{t("locations.orderPickModalBody")}</label>
                <textarea value={future.orderPickModalBody} onChange={(e) => setFuture((f) => ({ ...f, orderPickModalBody: e.target.value }))} style={{ ...selectBaseStyle, minHeight: 60 }} placeholder={storefrontDefaults.orderPickModalBody} rows={3} />
              </div>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
                <input type="checkbox" checked={!!future.orderPickRedirectToCheckout} onChange={(e) => setFuture((f) => ({ ...f, orderPickRedirectToCheckout: e.target.checked }))} />
                <span>{t("locations.orderPickRedirect")}</span>
              </label>
            </div>
          </div>
        </div>
        </ProSectionWrapper>

        {/* ロケーション名のリンク設定：一括でリンク表示ON/OFF ＋ 行ごとにURL入力 */}
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap", marginBottom: "24px" }}>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>{t("locations.linkTitle")}</div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              {t("locations.linkDesc")}
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 0 0 1px #e1e3e5", padding: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 14 }}>
                <input type="checkbox" checked={!!future.showLocationLinks} onChange={(e) => setFuture((f) => ({ ...f, showLocationLinks: e.target.checked }))} />
                <span>{t("locations.showLinks")}</span>
              </label>
              <div style={{ fontSize: 12, color: "#6d7175", marginTop: 8 }}>
                {t("locations.showLinksHint")}
              </div>
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
            {t("locations.listTitle")}
          </div>
          <div
            style={{
              fontSize: 14,
              color: "#6d7175",
              lineHeight: 1.5,
            }}
          >
            {t("locations.listDesc")}
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
            ref={tableScrollRef}
            onWheel={handleTableScrollWheel}
            style={{
              overflowX: "auto",
              WebkitOverflowScrolling: "touch",
              width: "100%",
            }}
          >
            <table
              style={{
                width: "100%",
                minWidth: 1000,
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
                      {t("locations.colName")}
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
                      {t("locations.colPublicName")}
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
                      {t("locations.colArea")}
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
                      {t("locations.colSort")}
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
                      <div>{t("locations.colPin")}</div>
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
                          {t("common.clear")}
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
                      {t("locations.colVisible")}
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
                      title={t("locations.colNearbyExcludeTitle")}
                    >
                      {t("locations.colNearbyExclude")}
                    </th>
                    <th
                      style={{
                        textAlign: "left",
                        borderBottom: "1px solid #c9cccf",
                        padding: "8px 12px",
                        minWidth: 200,
                        fontSize: 14,
                        fontWeight: 600,
                        color: "#6d7175",
                      }}
                      title={t("locations.colLinkUrlTitle")}
                    >
                      {t("locations.colLinkUrl")}
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
                            {row.hasShipping && <div>{t("locations.badgeShipping")}</div>}
                            {row.hasLocalDelivery && <div>{t("locations.badgeLocalDelivery")}</div>}
                            {row.storePickupEnabled && <div>{t("locations.badgeStorePickup")}</div>}
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
                          ...(!isPro ? { background: "rgba(240,240,240,0.5)", color: "#6d7175" } : {}),
                        }}
                      >
                        {!isPro ? (
                          <span style={{ fontSize: 13, color: "#6d7175" }} title={t("locations.proEditTitle")}>
                            {row.regionGroupId
                              ? (regionGroups.find((g) => g.id === row.regionGroupId)?.name ?? "—")
                              : "—"}
                          </span>
                        ) : row.locationId === pinnedLocationId ? (
                          <span style={{ fontSize: 13, color: "#6d7175" }}>{t("locations.pinBlocksArea")}</span>
                        ) : (
                          <select
                            value={row.regionGroupId || ""}
                            onChange={(e) => updateRowRegionGroup(row.locationId, e.target.value)}
                            style={{ ...selectBaseStyle, minWidth: 100 }}
                          >
                            <option value="">{t("common.unset")}</option>
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
                          ...(!isPro ? { background: "rgba(240,240,240,0.5)" } : {}),
                        }}
                      >
                        {!isPro ? (
                          <span style={{ fontSize: 13, color: "#6d7175" }} title={t("locations.proEditTitle")}>
                            {row.excludeFromNearby ? "ON" : "—"}
                          </span>
                        ) : (
                          <input
                            type="checkbox"
                            checked={!!row.excludeFromNearby}
                            onChange={(e) =>
                              updateRow(row.locationId, {
                                excludeFromNearby: e.target.checked,
                              })
                            }
                            style={{ width: 16, height: 16 }}
                            title={t("locations.nearbyExcludeTitle")}
                          />
                        )}
                      </td>
                      <td
                        style={{
                          borderBottom: "1px solid #e1e3e5",
                          padding: "8px 12px",
                          minWidth: 200,
                        }}
                      >
                        <input
                          type="text"
                          value={row.linkUrl ?? ""}
                          onChange={(e) =>
                            updateRow(row.locationId, {
                              linkUrl: e.target.value,
                            })
                          }
                          placeholder={t("locations.linkUrlPh")}
                          style={{
                            width: "100%",
                            minWidth: 160,
                            padding: "6px 8px",
                            borderRadius: 4,
                            border: "1px solid #c9cccf",
                            fontSize: 14,
                            boxSizing: "border-box",
                          }}
                          title={t("locations.linkUrlTitle")}
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
            {showSavedFeedback && !isDirty ? t("common.saved") : footerStatusText}
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
              {t("common.discard")}
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
              {saving ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </div>
      )}
    </s-page>
  );
}
