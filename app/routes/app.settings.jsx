// app/routes/app.settings.jsx

import { useState, useMemo, useEffect, useRef } from "react";
import { useLoaderData, useFetcher } from "react-router";
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
 * - click.*
 * - quantity の文言（label / wrapper）
 * - labels.*
 * - messages.*
 * - notice.text
 * を抜き出して UI に渡す（並び順はロケーション設定で編集）
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

  // 閾値（在庫ステータス判定）
  const thresholds = {
    outOfStockMax:
      typeof rawConfig?.thresholds?.outOfStockMax === "number"
        ? rawConfig.thresholds.outOfStockMax
        : 0,
    inStockMin:
      typeof rawConfig?.thresholds?.inStockMin === "number"
        ? rawConfig.thresholds.inStockMin
        : 5,
  };

  // 在庫マーク
  const symbols = {
    inStock: rawConfig?.symbols?.inStock ?? "◯",
    lowStock: rawConfig?.symbols?.lowStock ?? "△",
    outOfStock: rawConfig?.symbols?.outOfStock ?? "✕",
  };

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
    thresholds,
    symbols,
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
 * - click.*
 * - quantity の文言
 * - labels.*
 * - messages.*
 * - notice.text
 * だけを上書きして config を保存（並び順・上部固定はロケーション設定で編集）
 */
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();

  // 閾値
  const outOfStockMaxRaw = formData.get("threshold_out_of_stock_max");
  const inStockMinRaw = formData.get("threshold_in_stock_min");
  const outOfStockMax = Number.parseInt(String(outOfStockMaxRaw ?? ""), 10);
  const inStockMin = Number.parseInt(String(inStockMinRaw ?? ""), 10);
  const thresholdOutOfStockMax = Number.isFinite(outOfStockMax)
    ? Math.max(0, outOfStockMax)
    : 0;
  const thresholdInStockMin = Number.isFinite(inStockMin)
    ? Math.max(0, inStockMin)
    : 5;

  // 在庫マーク
  const symbolInStock =
    (formData.get("symbol_in_stock") || "").toString() || "◯";
  const symbolLowStock =
    (formData.get("symbol_low_stock") || "").toString() || "△";
  const symbolOutOfStock =
    (formData.get("symbol_out_of_stock") || "").toString() || "✕";

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
      // 閾値
      thresholds: {
        ...(rawConfig.thresholds || {}),
        outOfStockMax: thresholdOutOfStockMax,
        inStockMin: thresholdInStockMin,
      },
      // 在庫マーク
      symbols: {
        ...(rawConfig.symbols || {}),
        inStock: symbolInStock,
        lowStock: symbolLowStock,
        outOfStock: symbolOutOfStock,
      },
      // クリック設定（並び順はロケーション設定で編集するためここでは上書きしない）
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
    const thresholds = {
      outOfStockMax: nextConfig.thresholds.outOfStockMax,
      inStockMin: nextConfig.thresholds.inStockMin,
    };

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
      thresholds,
      symbols,
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

const inputBaseStyle = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 14,
  borderRadius: 4,
  border: "1px solid #c9cccf",
  boxSizing: "border-box",
};

const textareaBaseStyle = {
  ...inputBaseStyle,
  minHeight: 60,
  resize: "vertical",
};

const selectBaseStyle = { ...inputBaseStyle, background: "#fff" };

/**
 * /app/settings の画面（POS Stock 同様：各セクション左＝タイトル＋説明のみ、右＝カード、固定フッターで破棄・保存）
 */
export default function AppSettings() {
  const loaderData = useLoaderData();
  const fetcher = useFetcher();

  const [initial, setInitial] = useState(() => ({
    thresholds: loaderData.thresholds ?? { outOfStockMax: 0, inStockMin: 5 },
    symbols: loaderData.symbols,
    click: loaderData.click,
    quantityTexts: loaderData.quantityTexts,
    labels: loaderData.labels,
    messages: loaderData.messages,
    notice: loaderData.notice,
  }));

  const [state, setState] = useState(initial);
  const [showSavedFeedback, setShowSavedFeedback] = useState(false);
  const lastAppliedFetcherDataRef = useRef(null);

  // 保存成功時に state と initial を両方更新（同じ fetcher.data で二重適用しない）
  useEffect(() => {
    if (!fetcher.data || fetcher.data.ok !== true || !fetcher.data.symbols) return;
    if (lastAppliedFetcherDataRef.current === fetcher.data) return;
    lastAppliedFetcherDataRef.current = fetcher.data;
    const next = {
      thresholds: fetcher.data.thresholds ?? initial.thresholds,
      symbols: fetcher.data.symbols,
      click: fetcher.data.click,
      quantityTexts: fetcher.data.quantityTexts,
      labels: fetcher.data.labels,
      messages: fetcher.data.messages,
      notice: fetcher.data.notice,
    };
    setState(next);
    setInitial(next);
    setShowSavedFeedback(true);
  }, [fetcher.data]);

  // 保存完了メッセージを約3秒表示してから非表示
  useEffect(() => {
    if (!showSavedFeedback) return;
    const t = setTimeout(() => setShowSavedFeedback(false), 3000);
    return () => clearTimeout(t);
  }, [showSavedFeedback]);

  const isDirty = useMemo(
    () => JSON.stringify(state) !== JSON.stringify(initial),
    [state, initial]
  );

  const saving = fetcher.state !== "idle";
  const saveOk = fetcher.data && fetcher.data.ok === true;
  const saveErr = fetcher.data && fetcher.data.ok === false ? fetcher.data.error : null;

  const handleDiscard = () => setState(initial);
  const handleSave = () => {
    const fd = new FormData();
    fd.set("threshold_out_of_stock_max", String(state.thresholds.outOfStockMax));
    fd.set("threshold_in_stock_min", String(state.thresholds.inStockMin));
    fd.set("symbol_in_stock", state.symbols.inStock);
    fd.set("symbol_low_stock", state.symbols.lowStock);
    fd.set("symbol_out_of_stock", state.symbols.outOfStock);
    fd.set("click_action", state.click.action);
    fd.set("map_url_template", state.click.mapUrlTemplate);
    fd.set("url_template", state.click.urlTemplate);
    fd.set("quantity_label", state.quantityTexts.label);
    fd.set("quantity_wrapper_before", state.quantityTexts.wrapperBefore);
    fd.set("quantity_wrapper_after", state.quantityTexts.wrapperAfter);
    fd.set("label_in_stock", state.labels.inStock);
    fd.set("label_low_stock", state.labels.lowStock);
    fd.set("label_out_of_stock", state.labels.outOfStock);
    fd.set("message_loading", state.messages.loading);
    fd.set("message_empty", state.messages.empty);
    fd.set("message_error", state.messages.error);
    fd.set("notice_text", state.notice.text);
    fetcher.submit(fd, { method: "post" });
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
    <s-page heading="在庫表示設定">
      <div style={{ padding: "16px", maxWidth: "1200px", paddingBottom: "88px" }}>
        {/* セクション：閾値 — 一番上 */}
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
              閾値
            </div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              在庫数を「在庫なし」「残りわずか」「在庫あり」のどれとみなすかの境界を設定します。この値以下を在庫なし、この値以上を在庫ありとし、その間は残りわずかになります。
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
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>
                  この値以下を「在庫なし」とする（outOfStockMax）
                </label>
                <input
                  type="number"
                  min={0}
                  value={state.thresholds.outOfStockMax}
                  onChange={(e) => {
                    const v = e.target.value === "" ? 0 : Math.max(0, Number.parseInt(e.target.value, 10) || 0);
                    setState((s) => ({
                      ...s,
                      thresholds: { ...s.thresholds, outOfStockMax: Number.isFinite(v) ? v : 0 },
                    }));
                  }}
                  style={inputBaseStyle}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>
                  この値以上を「在庫あり」とする（inStockMin）
                </label>
                <input
                  type="number"
                  min={0}
                  value={state.thresholds.inStockMin}
                  onChange={(e) => {
                    const v = e.target.value === "" ? 5 : Math.max(0, Number.parseInt(e.target.value, 10) || 5);
                    setState((s) => ({
                      ...s,
                      thresholds: { ...s.thresholds, inStockMin: Number.isFinite(v) ? v : 5 },
                    }));
                  }}
                  style={inputBaseStyle}
                />
              </div>
            </div>
          </div>
        </div>

        {/* セクション：在庫マーク — 左（タイトル＋説明のみ）/ 右（カード） */}
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
              在庫マーク
            </div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              商品ページの在庫表示と凡例に使うマークをまとめて変更します。顔文字や絵文字（例: 😊 / ⚠️ / ❌）も利用できます。
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
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>在庫ありマーク</label>
                <input
                  type="text"
                  value={state.symbols.inStock}
                  onChange={(e) => setState((s) => ({ ...s, symbols: { ...s.symbols, inStock: e.target.value } }))}
                  style={inputBaseStyle}
                />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>低在庫マーク</label>
                <input
                  type="text"
                  value={state.symbols.lowStock}
                  onChange={(e) => setState((s) => ({ ...s, symbols: { ...s.symbols, lowStock: e.target.value } }))}
                  style={inputBaseStyle}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>在庫なしマーク</label>
                <input
                  type="text"
                  value={state.symbols.outOfStock}
                  onChange={(e) => setState((s) => ({ ...s, symbols: { ...s.symbols, outOfStock: e.target.value } }))}
                  style={inputBaseStyle}
                />
              </div>
            </div>
          </div>
        </div>

        {/* セクション：在庫数のテキスト・単位 */}
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
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>在庫数のテキスト・単位</div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              在庫数の前後につけるラベルやカッコ、単位を設定します。表示／非表示や構成（マークのみ、数量のみなど）はテーマ側の App Block で制御します。
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 0 0 1px #e1e3e5", padding: 16 }}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>在庫数ラベル</label>
                <input type="text" value={state.quantityTexts.label} onChange={(e) => setState((s) => ({ ...s, quantityTexts: { ...s.quantityTexts, label: e.target.value } }))} placeholder="例: 在庫" style={inputBaseStyle} />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: "1 1 0" }}>
                  <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>前に付ける文字</label>
                  <input type="text" value={state.quantityTexts.wrapperBefore} onChange={(e) => setState((s) => ({ ...s, quantityTexts: { ...s.quantityTexts, wrapperBefore: e.target.value } }))} placeholder="例: (" style={inputBaseStyle} />
                </div>
                <div style={{ flex: "1 1 0" }}>
                  <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>後ろに付ける文字</label>
                  <input type="text" value={state.quantityTexts.wrapperAfter} onChange={(e) => setState((s) => ({ ...s, quantityTexts: { ...s.quantityTexts, wrapperAfter: e.target.value } }))} placeholder="例: )" style={inputBaseStyle} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* セクション：在庫ステータスのラベル */}
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
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>在庫ステータスのラベル</div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              在庫マークと一緒に表示するステータスラベルを設定します。凡例と在庫リストの両方でこのラベルが使われます。
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 0 0 1px #e1e3e5", padding: 16 }}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>在庫ありラベル</label>
                <input type="text" value={state.labels.inStock} onChange={(e) => setState((s) => ({ ...s, labels: { ...s.labels, inStock: e.target.value } }))} placeholder="例: 在庫あり" style={inputBaseStyle} />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>残りわずかラベル</label>
                <input type="text" value={state.labels.lowStock} onChange={(e) => setState((s) => ({ ...s, labels: { ...s.labels, lowStock: e.target.value } }))} placeholder="例: 残りわずか" style={inputBaseStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>在庫なしラベル</label>
                <input type="text" value={state.labels.outOfStock} onChange={(e) => setState((s) => ({ ...s, labels: { ...s.labels, outOfStock: e.target.value } }))} placeholder="例: 在庫なし" style={inputBaseStyle} />
              </div>
            </div>
          </div>
        </div>

        {/* セクション：メッセージ文言 */}
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
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>メッセージ文言</div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              読み込み中・在庫なし・エラー時に表示するメッセージを設定します。空欄の場合はアプリのデフォルト文言が使われます。
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 0 0 1px #e1e3e5", padding: 16 }}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>読み込み中メッセージ</label>
                <textarea value={state.messages.loading} onChange={(e) => setState((s) => ({ ...s, messages: { ...s.messages, loading: e.target.value } }))} style={textareaBaseStyle} />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>在庫なしメッセージ</label>
                <textarea value={state.messages.empty} onChange={(e) => setState((s) => ({ ...s, messages: { ...s.messages, empty: e.target.value } }))} style={textareaBaseStyle} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>エラーメッセージ</label>
                <textarea value={state.messages.error} onChange={(e) => setState((s) => ({ ...s, messages: { ...s.messages, error: e.target.value } }))} style={textareaBaseStyle} />
              </div>
            </div>
          </div>
        </div>

        {/* セクション：注意書き */}
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
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>注意書き</div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              すべての商品ページで共通して表示したい注意書きがあれば設定します。
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 0 0 1px #e1e3e5", padding: 16 }}>
              <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>注意書きテキスト</label>
              <textarea value={state.notice.text} onChange={(e) => setState((s) => ({ ...s, notice: { ...s.notice, text: e.target.value } }))} style={textareaBaseStyle} placeholder="例: 在庫は店舗間で移動する場合があります。ご来店前に店舗へ在庫をご確認ください。" />
            </div>
          </div>
        </div>

        {/* セクション：ロケーション名クリック時の動作 */}
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
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>ロケーション名クリック時の動作</div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
              在庫リスト内のロケーション名をクリックしたときの動作を設定します。クリックで Google マップを開いたり、任意のストアページに遷移させることができます。
            </div>
          </div>
          <div style={{ flex: "1 1 320px", minWidth: 280 }}>
            <div style={{ background: "#ffffff", borderRadius: 12, boxShadow: "0 0 0 1px #e1e3e5", padding: 16 }}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>クリック時の動作</label>
                <select value={state.click.action} onChange={(e) => setState((s) => ({ ...s, click: { ...s.click, action: e.target.value } }))} style={selectBaseStyle}>
                  <option value="none">何もしない（テキストのまま）</option>
                  <option value="open_map">Google マップを開く（open_map）</option>
                  <option value="open_url">任意の URL に遷移（open_url）</option>
                </select>
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>マップ URL テンプレート（open_map のとき）</label>
                <input type="text" value={state.click.mapUrlTemplate} onChange={(e) => setState((s) => ({ ...s, click: { ...s.click, mapUrlTemplate: e.target.value } }))} style={inputBaseStyle} />
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6d7175" }}>例: https://maps.google.com/?q=&#123;location_name&#125; など。&#123;location_name&#125; の部分がロケーション名で置き換えられます。</p>
              </div>
              <div>
                <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>任意 URL テンプレート（open_url のとき）</label>
                <input type="text" value={state.click.urlTemplate} onChange={(e) => setState((s) => ({ ...s, click: { ...s.click, urlTemplate: e.target.value } }))} style={inputBaseStyle} />
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6d7175" }}>例: /pages/store-&#123;location_id&#125; など。&#123;location_id&#125; はロケーションの ID、&#123;location_name&#125; はロケーション名で置き換えられます。</p>
              </div>
            </div>
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
