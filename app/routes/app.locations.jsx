// app/routes/app.locations.jsx

import { useLoaderData, useActionData, Form } from "react-router";
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

/**
 * メタフィールドを保存する mutation
 */
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
 * loader: ロケーションと現在の config を読み込んで、UI 用の rows に整形
 */
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

  const rows = locations.map((loc) => {
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
  });

  return {
    shopId: shop.id,
    rows,
  };
}

/**
 * action: フォームから送られてきたロケーション設定を JSON にしてメタフィールドへ保存
 */
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
 * 管理画面 UI コンポーネント
 */
export default function LocationsConfigPage() {
  const { rows, shopId } = useLoaderData();
  const actionData = useActionData();

  return (
    <div style={{ padding: "24px", maxWidth: "960px" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>
        ロケーション在庫設定
      </h1>

      <p style={{ marginBottom: "1rem" }}>
        各ロケーションの「表示 / 非表示」、「表示名」、「並び順」を設定できます。
      </p>
      <ul style={{ marginBottom: "1rem", paddingLeft: "1.2rem" }}>
        <li>
          並び順は <code>sortOrder</code> の小さい順に表示されます。
        </li>
        <li>
          <strong>セクション設定の sort_by が「none」</strong> の場合、
          この順番がそのままフロントに反映されます。
        </li>
      </ul>

      {actionData?.ok && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.5rem 0.75rem",
            borderRadius: "4px",
            background: "#e6ffed",
            border: "1px solid #b3f5c3",
          }}
        >
          設定を保存しました。
        </div>
      )}

      {actionData?.ok === false && (
        <div
          style={{
            marginBottom: "1rem",
            padding: "0.5rem 0.75rem",
            borderRadius: "4px",
            background: "#ffecec",
            border: "1px solid #ffb3b3",
          }}
        >
          <p style={{ margin: 0 }}>
            エラー: {actionData.error || "保存に失敗しました。"}
          </p>
        </div>
      )}

      <Form method="post">
        <input type="hidden" name="shopId" value={shopId} />

        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginBottom: "1rem",
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #ddd",
                  padding: "0.5rem",
                }}
              >
                Shopify ロケーション名
              </th>
              <th
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #ddd",
                  padding: "0.5rem",
                }}
              >
                公開名（表示名）
              </th>
              <th
                style={{
                  textAlign: "left",
                  borderBottom: "1px solid #ddd",
                  padding: "0.5rem",
                  width: "120px",
                }}
              >
                並び順 sortOrder
              </th>
              <th
                style={{
                  textAlign: "center",
                  borderBottom: "1px solid #ddd",
                  padding: "0.5rem",
                  width: "120px",
                }}
              >
                表示
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.locationId}>
                {/* locationId は hidden で送信して配列化 */}
                <input
                  type="hidden"
                  name="locationId"
                  value={row.locationId}
                />
                <td
                  style={{
                    borderBottom: "1px solid #f0f0f0",
                    padding: "0.5rem",
                  }}
                >
                  <div>{row.shopifyName}</div>
                  {row.fulfillsOnlineOrders && (
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "#555",
                        marginTop: "0.2rem",
                      }}
                    >
                      オンライン注文対応ロケーション
                    </div>
                  )}
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #f0f0f0",
                    padding: "0.5rem",
                  }}
                >
                  <input
                    name="publicName"
                    defaultValue={row.publicName}
                    style={{
                      width: "100%",
                      padding: "0.25rem 0.4rem",
                      borderRadius: "4px",
                      border: "1px solid #ccc",
                    }}
                  />
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #f0f0f0",
                    padding: "0.5rem",
                  }}
                >
                  <input
                    type="number"
                    name="sortOrder"
                    defaultValue={row.sortOrder}
                    style={{
                      width: "100%",
                      padding: "0.25rem 0.4rem",
                      borderRadius: "4px",
                      border: "1px solid #ccc",
                    }}
                  />
                </td>
                <td
                  style={{
                    borderBottom: "1px solid #f0f0f0",
                    padding: "0.5rem",
                    textAlign: "center",
                  }}
                >
                  <input
                    type="checkbox"
                    name="enabledLocationId"
                    value={row.locationId}
                    defaultChecked={row.enabled}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <button
          type="submit"
          style={{
            padding: "0.5rem 1.2rem",
            borderRadius: "4px",
            border: "none",
            background: "#008060",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          設定を保存する
        </button>
      </Form>
    </div>
  );
}
