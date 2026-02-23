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
    deliveryProfiles(first: 50, merchantOwnedOnly: true) {
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
 * deliveryProfiles のレスポンスから locationId → { hasShipping, hasLocalDelivery } を構築
 */
function buildLocationDeliveryFlags(deliveryProfilesData) {
  const map = new Map();
  const nodes = deliveryProfilesData?.deliveryProfiles?.nodes ?? [];
  for (const profile of nodes) {
    const groups = profile.profileLocationGroups ?? [];
    for (const plg of groups) {
      const locationIds = (plg.locationGroup?.locations?.nodes ?? []).map((n) => n.id);
      let hasShipping = false;
      let hasLocalDelivery = false;
      const zones = plg.locationGroupZones?.nodes ?? [];
      for (const zone of zones) {
        const methods = zone.methodDefinitions?.nodes ?? [];
        for (const m of methods) {
          if (!m.active) continue;
          const rp = m.rateProvider;
          if (!rp) continue;
          const methodName = (m.name || "").toLowerCase();
          if (rp.__typename === "DeliveryParticipant") {
            hasShipping = true;
          } else if (rp.__typename === "DeliveryRateDefinition") {
            if (methodName.includes("local") || methodName.includes("ローカル") || methodName.includes("local delivery")) {
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

export async function loader({ request }) {
  const { admin } = await shopify.authenticate.admin(request);

  const res = await admin.graphql(LOCATIONS_AND_CONFIG_QUERY);
  const result = await res.json();

  if (result.errors && result.errors.length > 0) {
    console.error("LocationsAndConfig errors:", result.errors);
    throw new Response("Failed to load locations", { status: 500 });
  }

  const shop = result.data.shop;
  const locations = result.data.locations.nodes || [];
  const metafieldValue = shop.metafield?.value;

  let deliveryFlagsByLocationId = new Map();
  try {
    const dpRes = await admin.graphql(DELIVERY_PROFILES_QUERY);
    const dpResult = await dpRes.json();

    if (dpResult.errors?.length) {
      console.warn(
        "[location-stock] deliveryProfiles query returned GraphQL errors (要因: スコープ未付与 or API 制限):",
        JSON.stringify(dpResult.errors, null, 2)
      );
    }
    if (dpResult.data && !dpResult.errors?.length) {
      deliveryFlagsByLocationId = buildLocationDeliveryFlags(dpResult.data);
      const profileCount = dpResult.data?.deliveryProfiles?.nodes?.length ?? 0;
      if (profileCount === 0) {
        console.warn(
          "[location-stock] deliveryProfiles が 0 件です。設定 > 配送で配送プロファイルが作成されているか、merchantOwnedOnly の対象か確認してください。"
        );
      }
    }
  } catch (e) {
    console.warn(
      "[location-stock] Delivery profiles query failed (scope or network):",
      e instanceof Error ? e.message : e
    );
  }

  let config = null;
  if (metafieldValue) {
    try {
      config = JSON.parse(metafieldValue);
    } catch (e) {
      console.error("Failed to parse location_stock.config JSON:", e);
    }
  }

  const locationsConfig = Array.isArray(config?.locations)
    ? config.locations
    : [];

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

  return {
    shopId: shop.id,
    rows,
    sortMode,
    pinnedLocationId,
  };
}

export async function action({ request }) {
  const { admin } = await shopify.authenticate.admin(request);
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
      console.error("Failed to parse location_stock.config in action:", e);
    }
  }

  const locationIds = formData.getAll("locationId").map(String);
  const publicNames = formData.getAll("publicName").map(String);
  const sortOrdersRaw = formData.getAll("sortOrder").map(String);

  const enabledIds = new Set(
    formData.getAll("enabledLocationId").map(String)
  );

  const locations = locationIds.map((locationId, index) => {
    const publicName = publicNames[index] || "";
    const sortOrderStr = sortOrdersRaw[index] || "";
    const parsedSort = Number.parseInt(sortOrderStr, 10);
    const sortOrder = Number.isFinite(parsedSort) ? parsedSort : 999999;

    return {
      locationId,
      enabled: enabledIds.has(locationId),
      publicName: publicName || "",
      sortOrder,
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

  const nextConfig = {
    ...currentConfig,
    locations,
    sort: { ...(currentConfig.sort || {}), mode: sortMode },
    pinnedLocationId: pinnedLocationId ?? null,
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
    console.error("metafieldsSet userErrors:", userErrors);
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
export default function LocationsConfigPage() {
  const loaderData = useLoaderData();
  const {
    rows: initialRows,
    shopId,
    sortMode: initialSortMode,
    pinnedLocationId: initialPinnedLocationId,
  } = loaderData;
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [rows, setRows] = useState(initialRows);
  const [sortMode, setSortMode] = useState(initialSortMode);
  const [pinnedLocationId, setPinnedLocationId] = useState(initialPinnedLocationId);
  const justSavedRef = useRef(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const lastHandledSaveRef = useRef(null);

  const isDirty = useMemo(
    () =>
      JSON.stringify(rows) !== JSON.stringify(initialRows) ||
      sortMode !== initialSortMode ||
      (pinnedLocationId || "") !== (initialPinnedLocationId || ""),
    [rows, initialRows, sortMode, initialSortMode, pinnedLocationId, initialPinnedLocationId]
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
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.set("shopId", shopId);
    formData.set("sort_mode", sortMode);
    if (pinnedLocationId) formData.set("pinnedLocationId", pinnedLocationId);
    rows.forEach((r) => {
      formData.append("locationId", r.locationId);
      formData.append("publicName", r.publicName || "");
      formData.append("sortOrder", String(r.sortOrder));
      if (r.enabled) formData.append("enabledLocationId", r.locationId);
    });
    fetcher.submit(formData, { method: "post" });
  };

  const updateRow = (locationId, patch) => {
    setRows((prev) =>
      prev.map((r) =>
        r.locationId === locationId ? { ...r, ...patch } : r
      )
    );
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
            並び順は上下ボタンで変更でき、「一覧の並び順を使う」のときはこの順番が商品ページに反映されます。
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
