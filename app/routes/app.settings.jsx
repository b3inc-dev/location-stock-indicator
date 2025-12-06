// app/routes/app.settings.jsx

import {
  useLoaderData,
  useActionData,
  Form,
  Link,
} from "react-router";
import { authenticate } from "../shopify.server";

// shop の location_stock.config を読むクエリ
const SHOP_CONFIG_QUERY = `#graphql
  query LocationStockConfig {
    shop {
      id
      metafield(namespace: "location_stock", key: "config") {
        id
        type
        value
      }
    }
  }
`;

// location_stock.config を保存するミューテーション
const SET_LOCATION_STOCK_CONFIG_MUTATION = `#graphql
  mutation SetLocationStockConfig($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

/**
 * loader:
 * 現在の config から
 * - symbols.inStock / lowStock / outOfStock
 * - sort.mode
 * - click.*
 * - quantity の文言（label / wrapper）
 * - labels.*
 * - messages.*
 * - notice.text
 * を抜き出して UI に渡す
 */
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);

  const gqlResponse = await admin.graphql(SHOP_CONFIG_QUERY);
  const result = await gqlResponse.json();

  const shopId = result?.data?.shop?.id;
  const metafield = result?.data?.shop?.metafield;

  if (!shopId) {
    console.error("shopId is null in LocationStockConfig");
    return {
      ok: false,
      error: "shop ID が取得できませんでした。（metafieldsSet の ownerId）",
    };
  }

  let rawConfig = {};

  if (metafield && metafield.value) {
    try {
      rawConfig = JSON.parse(metafield.value);
    } catch (e) {
      console.error("Failed to parse location_stock.config JSON in loader:", e);
      rawConfig = {};
    }
  }

  // 在庫マーク
  const symbols = {
    inStock: rawConfig?.symbols?.inStock ?? "◯",
    lowStock: rawConfig?.symbols?.lowStock ?? "△",
    outOfStock: rawConfig?.symbols?.outOfStock ?? "✕",
  };

  // 並び順
  const sortMode = rawConfig?.sort?.mode ?? "none";

  // クリック設定
  const click = {
    action: rawConfig?.click?.action ?? "none",
    mapUrlTemplate:
      rawConfig?.click?.mapUrlTemplate ??
      "https://maps.google.com/?q={location_name}",
    urlTemplate:
      rawConfig?.click?.urlTemplate ??
      "/pages/store-{location_id}",
  };

  // 在庫数テキスト・単位（quantity の文言系）
  const quantityTexts = {
    label: rawConfig?.quantity?.quantityLabel ?? "在庫",
    wrapperBefore: rawConfig?.quantity?.wrapperBefore ?? "(",
    wrapperAfter: rawConfig?.quantity?.wrapperAfter ?? ")",
  };

  // ステータスラベル
  const labels = {
    inStock: rawConfig?.labels?.inStock ?? "在庫あり",
    lowStock: rawConfig?.labels?.lowStock ?? "残りわずか",
    outOfStock: rawConfig?.labels?.outOfStock ?? "在庫なし",
  };

  // メッセージ文言
  const messages = {
    loading:
      rawConfig?.messages?.loading ?? "在庫を読み込み中...",
    empty:
      rawConfig?.messages?.empty ??
      "現在、この商品の店舗在庫はありません。",
    error:
      rawConfig?.messages?.error ??
      "在庫情報の取得に失敗しました。時間をおいて再度お試しください。",
  };

  // 共通注意書き（空なら非表示）
  const notice = {
    text: rawConfig?.notice?.text ?? "",
  };

  return {
    shop: session.shop,
    symbols,
    sortMode,
    click,
    quantityTexts,
    labels,
    messages,
    notice,
    rawConfig,
  };
}

/**
 * action: フォーム送信された値で
 * - symbols.xxx
 * - sort.mode
 * - click.*
 * - quantity の文言
 * - labels.*
 * - messages.*
 * - notice.text
 * だけを上書きして config を保存
 */
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  // 在庫マーク
  const symbolInStock =
    (formData.get("symbol_in_stock") || "").toString() || "◯";
  const symbolLowStock =
    (formData.get("symbol_low_stock") || "").toString() || "△";
  const symbolOutOfStock =
    (formData.get("symbol_out_of_stock") || "").toString() || "✕";

  // 並び順
  const sortMode =
    (formData.get("sort_mode") || "").toString() || "none";

  // クリックアクション
  const clickAction =
    (formData.get("click_action") || "").toString() || "none";
  const mapUrlTemplate =
    (formData.get("map_url_template") || "").toString() ||
    "https://maps.google.com/?q={location_name}";
  const urlTemplate =
    (formData.get("url_template") || "").toString() ||
    "/pages/store-{location_id}";

  // quantity の文言
  const quantityLabel = (formData.get("quantity_label") || "")
    .toString()
    .trim();
  const quantityWrapperBefore = (
    formData.get("quantity_wrapper_before") || ""
  )
    .toString()
    .trim();
  const quantityWrapperAfter = (
    formData.get("quantity_wrapper_after") || ""
  )
    .toString()
    .trim();

  // ステータスラベル
  const labelInStock = (formData.get("label_in_stock") || "")
    .toString()
    .trim();
  const labelLowStock = (formData.get("label_low_stock") || "")
    .toString()
    .trim();
  const labelOutOfStock = (formData.get("label_out_of_stock") || "")
    .toString()
    .trim();

  // メッセージ文言
  const messageLoading = (formData.get("message_loading") || "")
    .toString()
    .trim();
  const messageEmpty = (formData.get("message_empty") || "")
    .toString()
    .trim();
  const messageError = (formData.get("message_error") || "")
    .toString()
    .trim();

  // 共通注意書き
  const noticeText = (formData.get("notice_text") || "")
    .toString()
    .trim();

  try {
    // まず現在の config を取得
    const gqlResponse = await admin.graphql(SHOP_CONFIG_QUERY);
    const result = await gqlResponse.json();

    const shopId = result?.data?.shop?.id;
    const metafield = result?.data?.shop?.metafield;
    let rawConfig = {};

    if (!shopId) {
      console.error("shopId is null in LocationStockConfig (action)");
      return {
        ok: false,
        error:
          "shop ID が取得できませんでした。（metafieldsSet の ownerId）",
      };
    }

    if (metafield && metafield.value) {
      try {
        rawConfig = JSON.parse(metafield.value);
      } catch (e) {
        console.error(
          "Failed to parse location_stock.config JSON in action:",
          e
        );
        rawConfig = {};
      }
    }

    // 既存設定を保ちつつ、一部だけ上書き
    const nextConfig = {
      ...rawConfig,
      // 在庫マーク
      symbols: {
        ...(rawConfig.symbols || {}),
        inStock: symbolInStock,
        lowStock: symbolLowStock,
        outOfStock: symbolOutOfStock,
      },
      // 並び順
      sort: {
        ...(rawConfig.sort || {}),
        mode: sortMode,
      },
      // クリック設定
      click: {
        ...(rawConfig.click || {}),
        action: clickAction,
        mapUrlTemplate,
        urlTemplate,
      },
      // quantity の文言（showQuantity など他のキーは保つ）
      quantity: {
        ...(rawConfig.quantity || {}),
        quantityLabel: quantityLabel || "在庫",
        wrapperBefore: quantityWrapperBefore || "(",
        wrapperAfter: quantityWrapperAfter || ")",
      },
      // ステータスラベル
      labels: {
        ...(rawConfig.labels || {}),
        inStock: labelInStock || "在庫あり",
        lowStock: labelLowStock || "残りわずか",
        outOfStock: labelOutOfStock || "在庫なし",
      },
      // メッセージ文言
      messages: {
        ...(rawConfig.messages || {}),
        loading:
          messageLoading ||
          rawConfig?.messages?.loading ||
          "在庫を読み込み中...",
        empty:
          messageEmpty ||
          rawConfig?.messages?.empty ||
          "現在、この商品の店舗在庫はありません。",
        error:
          messageError ||
          rawConfig?.messages?.error ||
          "在庫情報の取得に失敗しました。時間をおいて再度お試しください。",
      },
      // 共通注意書き
      notice: {
        ...(rawConfig.notice || {}),
        text: noticeText || "",
      },
    };

    // JSON 文字列にして metafieldsSet で保存
    const saveResponse = await admin.graphql(
      SET_LOCATION_STOCK_CONFIG_MUTATION,
      {
        variables: {
          metafields: [
            {
              ownerId: shopId,
              namespace: "location_stock",
              key: "config",
              type: "json",
              value: JSON.stringify(nextConfig),
            },
          ],
        },
      }
    );

    const saveResult = await saveResponse.json();
    const userErrors =
      saveResult?.data?.metafieldsSet?.userErrors || [];

    if (userErrors.length > 0) {
      console.error("metafieldsSet userErrors:", userErrors);
      return {
        ok: false,
        error: userErrors
          .map((e) => e.message || "保存に失敗しました。")
          .join("\n"),
      };
    }

    // フロント側で即座に反映できるよう、更新後の値も返す
    const symbols = {
      inStock: nextConfig.symbols.inStock,
      lowStock: nextConfig.symbols.lowStock,
      outOfStock: nextConfig.symbols.outOfStock,
    };

    const click = {
      action: nextConfig.click.action,
      mapUrlTemplate: nextConfig.click.mapUrlTemplate,
      urlTemplate: nextConfig.click.urlTemplate,
    };

    const quantityTexts = {
      label: nextConfig.quantity.quantityLabel,
      wrapperBefore: nextConfig.quantity.wrapperBefore,
      wrapperAfter: nextConfig.quantity.wrapperAfter,
    };

    const labels = {
      inStock: nextConfig.labels.inStock,
      lowStock: nextConfig.labels.lowStock,
      outOfStock: nextConfig.labels.outOfStock,
    };

    const messages = {
      loading: nextConfig.messages.loading,
      empty: nextConfig.messages.empty,
      error: nextConfig.messages.error,
    };

    const notice = {
      text: nextConfig.notice.text,
    };

    return {
      ok: true,
      symbols,
      sortMode,
      click,
      quantityTexts,
      labels,
      messages,
      notice,
      savedConfig: nextConfig,
    };
  } catch (error) {
    console.error("Error in /app/settings action:", error);
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "予期せぬエラーが発生しました。",
    };
  }
}

/**
 * /app/settings の画面
 */
export default function AppSettings() {
  const loaderData = useLoaderData();
  const actionData = useActionData();

  const effectiveSymbols = actionData?.symbols || loaderData.symbols;
  const effectiveSortMode =
    actionData?.sortMode || loaderData.sortMode;
  const effectiveClick =
    actionData?.click || loaderData.click;
  const effectiveQuantityTexts =
    actionData?.quantityTexts || loaderData.quantityTexts;
  const effectiveLabels =
    actionData?.labels || loaderData.labels;
  const effectiveMessages =
    actionData?.messages || loaderData.messages;
  const effectiveNotice =
    actionData?.notice || loaderData.notice;

  const formKey = JSON.stringify({
    symbols: effectiveSymbols,
    sortMode: effectiveSortMode,
    click: effectiveClick,
    quantityTexts: effectiveQuantityTexts,
    labels: effectiveLabels,
    messages: effectiveMessages,
    notice: effectiveNotice,
  });

  const inputBaseStyle = {
    width: "100%",
    padding: "6px 8px",
    fontSize: "0.9rem",
    borderRadius: "4px",
    border: "1px solid #d0d5dd",
    boxSizing: "border-box",
  };

  const textareaBaseStyle = {
    ...inputBaseStyle,
    minHeight: "60px",
    resize: "vertical",
  };

  const selectBaseStyle = {
    ...inputBaseStyle,
    background: "#fff",
  };

  return (
    <div style={{ padding: "24px", maxWidth: "960px" }}>
      <h1 style={{ fontSize: "1.6rem", marginBottom: "0.75rem" }}>
        グローバル設定（location_stock.config）
      </h1>

      <p
        style={{
          marginBottom: "0.75rem",
          color: "#4a4a4a",
          fontSize: "0.95rem",
        }}
      >
        ここで設定した値は、すべての商品ページの在庫表示に共通で使われます。
      </p>
      <p
        style={{
          marginBottom: "1.5rem",
          color: "#6b6b6b",
          fontSize: "0.85rem",
        }}
      >
        文言や在庫マークなどのロジック系はアプリ側で、見た目やレイアウトはテーマ側の
        App Block で調整します。
      </p>

      {actionData?.ok && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 12px",
            borderRadius: "6px",
            border: "1px solid #c6f2d5",
            background: "#f1fff7",
            color: "#0b6b3a",
            fontSize: "0.9rem",
          }}
        >
          設定を保存しました。
        </div>
      )}

      {actionData && actionData.ok === false && actionData.error && (
        <div
          style={{
            marginBottom: "16px",
            padding: "10px 12px",
            borderRadius: "6px",
            border: "1px solid #f5c2c0",
            background: "#fff4f4",
            color: "#b3261e",
            whiteSpace: "pre-wrap",
            fontSize: "0.9rem",
          }}
        >
          保存時にエラーが発生しました：
          <br />
          {actionData.error}
        </div>
      )}

      <Form method="post" key={formKey}>
        {/* 1段目：在庫マーク／並び順 */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          {/* 左カラム：在庫マーク */}
          <div
            style={{
              flex: "1 1 260px",
              padding: "16px 18px",
              borderRadius: "8px",
              border: "1px solid #e1e3e5",
              background: "#fff",
            }}
          >
            <h2
              style={{
                fontSize: "1.05rem",
                margin: "0 0 0.75rem",
                fontWeight: 600,
              }}
            >
              在庫マーク
            </h2>

            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.85rem",
                color: "#555",
              }}
            >
              商品ページの在庫表示と凡例に使うマークをまとめて変更します。
              顔文字や絵文字（例: 😊 / ⚠️ / ❌）も利用できます。
            </p>

            <div style={{ marginBottom: "0.75rem" }}>
              <label
                htmlFor="symbol_in_stock"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                在庫ありマーク
              </label>
              <input
                id="symbol_in_stock"
                name="symbol_in_stock"
                type="text"
                defaultValue={effectiveSymbols.inStock}
                style={inputBaseStyle}
              />
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <label
                htmlFor="symbol_low_stock"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                低在庫マーク
              </label>
              <input
                id="symbol_low_stock"
                name="symbol_low_stock"
                type="text"
                defaultValue={effectiveSymbols.lowStock}
                style={inputBaseStyle}
              />
            </div>

            <div>
              <label
                htmlFor="symbol_out_of_stock"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                在庫なしマーク
              </label>
              <input
                id="symbol_out_of_stock"
                name="symbol_out_of_stock"
                type="text"
                defaultValue={effectiveSymbols.outOfStock}
                style={inputBaseStyle}
              />
            </div>
          </div>

          {/* 右カラム：並び順 */}
          <div
            style={{
              flex: "1 1 260px",
              padding: "16px 18px",
              borderRadius: "8px",
              border: "1px solid #e1e3e5",
              background: "#fff",
            }}
          >
            <h2
              style={{
                fontSize: "1.05rem",
                margin: "0 0 0.75rem",
                fontWeight: 600,
              }}
            >
              並び順（sort.mode）
            </h2>

            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.85rem",
                color: "#555",
              }}
            >
              在庫リスト全体の並び順をアプリ側で一括制御します。
            </p>

            <div style={{ marginBottom: "0.75rem" }}>
              <label
                htmlFor="sort_mode"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                並び順モード
              </label>
              <select
                id="sort_mode"
                name="sort_mode"
                defaultValue={effectiveSortMode}
                style={selectBaseStyle}
              >
                <option value="none">
                  変更しない（config.sort を使わない）
                </option>
                <option value="location_name_asc">
                  ロケーション名 昇順（A→Z）
                </option>
                <option value="quantity_desc">
                  在庫数の多い順（desc）
                </option>
                <option value="quantity_asc">
                  在庫数の少ない順（asc）
                </option>
              </select>
            </div>

            <p
              style={{
                margin: 0,
                fontSize: "0.8rem",
                color: "#777",
              }}
            >
              ※ テーマ側の sort 設定は削除済みなので、ここで指定した値がそのまま
              フロントの並び順に使われます。
            </p>
          </div>
        </div>

        {/* 2段目：在庫数テキスト／ステータスラベル */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          {/* 左：在庫数テキスト・単位 */}
          <div
            style={{
              flex: "1 1 260px",
              padding: "16px 18px",
              borderRadius: "8px",
              border: "1px solid #e1e3e5",
              background: "#fff",
            }}
          >
            <h2
              style={{
                fontSize: "1.05rem",
                margin: "0 0 0.75rem",
                fontWeight: 600,
              }}
            >
              在庫数のテキスト・単位
            </h2>

            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.85rem",
                color: "#555",
              }}
            >
              在庫数の前後につけるラベルやカッコ、単位を設定します。
              表示／非表示や構成（マークのみ、数量のみなど）はテーマ側の
              App Block で制御します。
            </p>

            <div style={{ marginBottom: "0.75rem" }}>
              <label
                htmlFor="quantity_label"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                在庫数ラベル
              </label>
              <input
                id="quantity_label"
                name="quantity_label"
                type="text"
                defaultValue={effectiveQuantityTexts.label}
                placeholder="例: 在庫"
                style={inputBaseStyle}
              />
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              <div style={{ flex: "1 1 0" }}>
                <label
                  htmlFor="quantity_wrapper_before"
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.25rem",
                  }}
                >
                  前に付ける文字
                </label>
                <input
                  id="quantity_wrapper_before"
                  name="quantity_wrapper_before"
                  type="text"
                  defaultValue={effectiveQuantityTexts.wrapperBefore}
                  placeholder="例: ("
                  style={inputBaseStyle}
                />
              </div>
              <div style={{ flex: "1 1 0" }}>
                <label
                  htmlFor="quantity_wrapper_after"
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.25rem",
                  }}
                >
                  後ろに付ける文字
                </label>
                <input
                  id="quantity_wrapper_after"
                  name="quantity_wrapper_after"
                  type="text"
                  defaultValue={effectiveQuantityTexts.wrapperAfter}
                  placeholder="例: )"
                  style={inputBaseStyle}
                />
              </div>
            </div>
          </div>

          {/* 右：在庫ステータスラベル */}
          <div
            style={{
              flex: "1 1 260px",
              padding: "16px 18px",
              borderRadius: "8px",
              border: "1px solid #e1e3e5",
              background: "#fff",
            }}
          >
            <h2
              style={{
                fontSize: "1.05rem",
                margin: "0 0 0.75rem",
                fontWeight: 600,
              }}
            >
              在庫ステータスのラベル
            </h2>

            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.85rem",
                color: "#555",
              }}
            >
              在庫マークと一緒に表示するステータスラベルを設定します。
              凡例と在庫リストの両方でこのラベルが使われます（テーマ側で上書きしない限り）。
            </p>

            <div style={{ marginBottom: "0.75rem" }}>
              <label
                htmlFor="label_in_stock"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                在庫ありラベル
              </label>
              <input
                id="label_in_stock"
                name="label_in_stock"
                type="text"
                defaultValue={effectiveLabels.inStock}
                placeholder="例: 在庫あり"
                style={inputBaseStyle}
              />
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <label
                htmlFor="label_low_stock"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                残りわずかラベル
              </label>
              <input
                id="label_low_stock"
                name="label_low_stock"
                type="text"
                defaultValue={effectiveLabels.lowStock}
                placeholder="例: 残りわずか"
                style={inputBaseStyle}
              />
            </div>

            <div>
              <label
                htmlFor="label_out_of_stock"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                在庫なしラベル
              </label>
              <input
                id="label_out_of_stock"
                name="label_out_of_stock"
                type="text"
                defaultValue={effectiveLabels.outOfStock}
                placeholder="例: 在庫なし"
                style={inputBaseStyle}
              />
            </div>
          </div>
        </div>

        {/* 3段目：メッセージ文言／注意書き */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "20px",
            marginBottom: "24px",
          }}
        >
          {/* 左：メッセージ文言 */}
          <div
            style={{
              flex: "1 1 260px",
              padding: "16px 18px",
              borderRadius: "8px",
              border: "1px solid #e1e3e5",
              background: "#fff",
            }}
          >
            <h2
              style={{
                fontSize: "1.05rem",
                margin: "0 0 0.75rem",
                fontWeight: 600,
              }}
            >
              メッセージ文言
            </h2>

            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.85rem",
                color: "#555",
              }}
            >
              読み込み中・在庫なし・エラー時に表示するメッセージを設定します。
              空欄の場合はアプリのデフォルト文言が使われます。
            </p>

            <div style={{ marginBottom: "0.75rem" }}>
              <label
                htmlFor="message_loading"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                読み込み中メッセージ
              </label>
              <textarea
                id="message_loading"
                name="message_loading"
                defaultValue={effectiveMessages.loading}
                style={textareaBaseStyle}
              />
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <label
                htmlFor="message_empty"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                在庫なしメッセージ
              </label>
              <textarea
                id="message_empty"
                name="message_empty"
                defaultValue={effectiveMessages.empty}
                style={textareaBaseStyle}
              />
            </div>

            <div>
              <label
                htmlFor="message_error"
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  fontWeight: 600,
                  marginBottom: "0.25rem",
                }}
              >
                エラーメッセージ
              </label>
              <textarea
                id="message_error"
                name="message_error"
                defaultValue={effectiveMessages.error}
                style={textareaBaseStyle}
              />
            </div>
          </div>

          {/* 右：注意書き */}
          <div
            style={{
              flex: "1 1 260px",
              padding: "16px 18px",
              borderRadius: "8px",
              border: "1px solid #e1e3e5",
              background: "#fff",
            }}
          >
            <h2
              style={{
                fontSize: "1.05rem",
                margin: "0 0 0.75rem",
                fontWeight: 600,
              }}
            >
              注意書き
            </h2>

            <p
              style={{
                margin: "0 0 0.75rem",
                fontSize: "0.85rem",
                color: "#555",
              }}
            >
              すべての商品ページで共通して表示したい注意書きがあれば設定します。
            </p>

            <label
              htmlFor="message_error"
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 600,
                marginBottom: "0.25rem",
              }}
            >
              注意書きテキスト
            </label>
            <textarea
              id="notice_text"
              name="notice_text"
              defaultValue={effectiveNotice.text}
              style={textareaBaseStyle}
              placeholder="例: 在庫は店舗間で移動する場合があります。ご来店前に店舗へ在庫をご確認ください。"
            />
          </div>
        </div>

        {/* クリックアクション */}
        <div
          style={{
            marginBottom: "24px",
            padding: "16px 18px",
            borderRadius: "8px",
            border: "1px solid #e1e3e5",
            background: "#fff",
          }}
        >
          <h2
            style={{
              fontSize: "1.05rem",
              margin: "0 0 0.75rem",
              fontWeight: 600,
            }}
          >
            ロケーション名クリック時の動作
          </h2>

          <p
            style={{
              margin: "0 0 0.75rem",
              fontSize: "0.85rem",
              color: "#555",
            }}
          >
            在庫リスト内のロケーション名をクリックしたときの動作を設定します。
            クリックで Google マップを開いたり、任意のストアページに遷移させることができます。
          </p>

          <div style={{ marginBottom: "0.75rem" }}>
            <label
              htmlFor="click_action"
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 600,
                marginBottom: "0.25rem",
              }}
            >
              クリック時の動作
            </label>
            <select
              id="click_action"
              name="click_action"
              defaultValue={effectiveClick.action}
              style={selectBaseStyle}
            >
              <option value="none">何もしない（テキストのまま）</option>
              <option value="open_map">
                Google マップを開く（open_map）
              </option>
              <option value="open_url">
                任意の URL に遷移（open_url）
              </option>
            </select>
          </div>

          <div style={{ marginBottom: "0.75rem" }}>
            <label
              htmlFor="map_url_template"
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 600,
                marginBottom: "0.25rem",
              }}
            >
              マップ URL テンプレート（open_map のとき）
            </label>
            <input
              id="map_url_template"
              name="map_url_template"
              type="text"
              defaultValue={effectiveClick.mapUrlTemplate}
              style={inputBaseStyle}
            />
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.8rem",
                color: "#777",
              }}
            >
              例: https://maps.google.com/?q=&#123;location_name&#125; など。
              &#123;location_name&#125; の部分がロケーション名で置き換えられます。
            </p>
          </div>

          <div>
            <label
              htmlFor="url_template"
              style={{
                display: "block",
                fontSize: "0.85rem",
                fontWeight: 600,
                marginBottom: "0.25rem",
              }}
            >
              任意 URL テンプレート（open_url のとき）
            </label>
            <input
              id="url_template"
              name="url_template"
              type="text"
              defaultValue={effectiveClick.urlTemplate}
              style={inputBaseStyle}
            />
            <p
              style={{
                margin: "0.25rem 0 0",
                fontSize: "0.8rem",
                color: "#777",
              }}
            >
              例: /pages/store-&#123;location_id&#125; など。
              &#123;location_id&#125; はロケーションの ID、&#123;location_name&#125; はロケーション名で置き換えられます。
            </p>
          </div>
        </div>

        <div style={{ marginBottom: "24px" }}>
          <button
            type="submit"
            style={{
              padding: "0.55rem 1.4rem",
              borderRadius: "4px",
              border: "none",
              background: "#008060",
              color: "#fff",
              fontSize: "0.95rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            設定を保存する
          </button>
          <span
            style={{
              marginLeft: "12px",
              fontSize: "0.8rem",
              color: "#777",
            }}
          >
            保存後は商品ページをリロードして表示を確認してください。
          </span>
        </div>
      </Form>

      <div
        style={{
          padding: "14px 16px",
          borderRadius: "8px",
          border: "1px dashed #d0d5dd",
          background: "#f9fafb",
          fontSize: "0.8rem",
          color: "#555",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "6px",
          }}
        >
          <span>現在の raw config（参考用）</span>
          <Link
            to="/app"
            style={{
              fontSize: "0.8rem",
              textDecoration: "none",
              color: "#0b6b3a",
              fontWeight: 600,
            }}
          >
            ← Home に戻る
          </Link>
        </div>
        <pre
          style={{
            margin: 0,
            maxHeight: "240px",
            overflow: "auto",
            background: "#fff",
            borderRadius: "4px",
            padding: "8px 10px",
            border: "1px solid #e1e3e5",
          }}
        >
{JSON.stringify(loaderData.rawConfig, null, 2)}
        </pre>
      </div>
    </div>
  );
}
