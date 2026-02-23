// app/routes/app.locations.jsx

import { useRef, useState, useMemo, useEffect } from "react";
import { useLoaderData, useFetcher, useRevalidator } from "react-router";
import shopify from "../shopify.server";

/**
 * ロケーション一覧 + shop メタフィールド(location_stock.config) を取得
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

      return {
        locationId: loc.id,
        shopifyName: loc.name,
        fulfillsOnlineOrders: !!loc.fulfillsOnlineOrders,
        enabled: cfg ? cfg.enabled !== false : true,
        publicName: cfg?.publicName || loc.name,
        sortOrder:
          typeof cfg?.sortOrder === "number" ? cfg.sortOrder : 999999,
        fromConfig: !!cfg,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    shopId: shop.id,
    rows,
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

  const config = { locations };

  const saveResponse = await admin.graphql(SAVE_CONFIG_MUTATION, {
    variables: {
      metafields: [
        {
          namespace: "location_stock",
          key: "config",
          type: "json",
          ownerId: shopId,
          value: JSON.stringify(config),
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
 * ロケーション設定（POS Stock 同様：左＝タイトル＋説明のみ、右＝設定カード、固定フッターで破棄・保存）
 */
export default function LocationsConfigPage() {
  const { rows: initialRows, shopId } = useLoaderData();
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  const [rows, setRows] = useState(initialRows);
  const justSavedRef = useRef(false);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const lastHandledSaveRef = useRef(null);

  const isDirty = useMemo(
    () => JSON.stringify(rows) !== JSON.stringify(initialRows),
    [rows, initialRows]
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

  // 保存後に revalidate で initialRows が更新されたときだけ rows を同期（idle 時点の古い initialRows で上書きしない）
  useEffect(() => {
    if (!justSavedRef.current) return;
    justSavedRef.current = false;
    setRows(initialRows);
  }, [initialRows]);

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
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.set("shopId", shopId);
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

  return (
    <s-page heading="ロケーション設定">
      <div style={{ padding: "16px", maxWidth: "1200px", paddingBottom: "88px" }}>
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
            ロケーション設定
          </div>
          <div
            style={{
              fontSize: 14,
              color: "#6d7175",
              lineHeight: 1.5,
            }}
          >
            各ロケーションの「表示／非表示」「表示名」「並び順」を設定できます。
            並び順は上下ボタンで変更でき、セクション設定の sort_by が「none」の場合はこの順番がそのまま商品ページに反映されます。
          </div>
        </div>

        {/* 100% 幅の設定カード */}
        <div
          style={{
            background: "#ffffff",
            borderRadius: 12,
            boxShadow: "0 0 0 1px #e1e3e5",
            padding: 16,
          }}
        >
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        borderBottom: "1px solid #c9cccf",
                        padding: "8px 12px",
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
                          fontSize: 14,
                          color: "#202223",
                        }}
                      >
                        <div>{row.shopifyName}</div>
                        {row.fulfillsOnlineOrders && (
                          <div
                            style={{
                              fontSize: 13,
                              color: "#6d7175",
                              marginTop: 4,
                            }}
                          >
                            オンライン注文対応
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
