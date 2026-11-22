// app/routes/app.pos-lite.jsx
// POS Lite（店頭受取・持ち帰りと配送）の設定の要約と、会計のあとに止まった注文（要確認）の再処理。
// 設定は 4 つの区分に分け、入力は区分ごとの編集の画面（app.pos-lite_.$section.jsx）で行う（T 11/23 5:10 の案 A）。
// 書き込みのスイッチはすべて既定オフ。オンにするのは T（店の担当者）。

import { useActionData, useLoaderData, useNavigation, useOutletContext } from "react-router";
import {
  AdminBlock,
  AdminIntro,
  ConfirmAction,
  EmptyState,
  PrimaryLink,
  StateBadge,
  StatusBanner,
  SuccessToast,
  SummaryRows,
} from "../components/admin-ui";
import { authenticate } from "../shopify.server";
import { getShopPlan } from "../utils/shopPlan.server.js";
import { listReviewOrders, loadConfig, processSale, requestFromAdmin, withOrderLock } from "../utils/posLiteSale.js";
import { loadPosLiteLocations } from "../utils/posLiteLocations.js";
import { POS_LITE_SECTIONS, POS_LITE_SECTION_KEYS, sectionPath, sectionSummary } from "../utils/posLiteSections.js";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getShopPlan(admin, session?.shop, { reportUsage: false });
  if (!plan?.features?.storePickup) return { allowed: false };
  const run = requestFromAdmin(admin);
  let loadError = null;
  let locations = [];
  let config = null;
  let reviews = [];
  try {
    locations = await loadPosLiteLocations(run);
    config = (await loadConfig(run)).config;
  } catch (error) {
    loadError = error instanceof Error ? error.message : "設定を読めませんでした。";
  }
  try {
    // 注文を読む権限（read_orders）が入る前は読めない。そのときは一覧だけ出さない
    reviews = config ? await listReviewOrders(run) : [];
  } catch (error) {
    reviews = null;
    console.error("[location-stock]", { route: "app.pos-lite", shop: session?.shop }, error instanceof Error ? error.message : "review list failed");
  }
  return { allowed: true, locations, config, reviews, loadError };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const plan = await getShopPlan(admin, session?.shop, { reportUsage: false });
  if (!plan?.features?.storePickup) return { ok: false, error: "この機能は Pro プランで使えます。" };
  const run = requestFromAdmin(admin);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "retry") {
    const orderId = String(form.get("orderId") || "");
    if (!/^gid:\/\/shopify\/Order\/\d+$/.test(orderId)) return { ok: false, error: "注文を確かめてください。" };
    const { config } = await loadConfig(run);
    if (!config.deliveryEnabled) return { ok: false, error: "「持ち帰りと配送の履行」がオフなので再処理できません。" };
    const result = await withOrderLock(`${session.shop}:${orderId}`, () => processSale(run, orderId, { config }));
    if (result.phase === "done" || result.reason === "already_done") return { ok: true, message: `${result.orderName || "注文"}: ${result.message}`, at: Date.now() };
    // retry: 出荷指示がまだ無い（印は付けない）。理由をそのまま出す
    return { ok: false, error: `${result.orderName || "注文"}: ${result.message || "再処理できませんでした。"}` };
  }

  return { ok: false, error: "操作を確かめてください。" };
};

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}/${get("month")}/${get("day")} ${get("hour")}:${get("minute")}`;
}

export default function PosLitePage() {
  const data = useLoaderData();
  const result = useActionData();
  const navigation = useNavigation();
  const outlet = useOutletContext();
  const busyIntent = navigation.state !== "idle" ? navigation.formData?.get("intent") : null;
  const busyOrder = navigation.state !== "idle" ? navigation.formData?.get("orderId") : null;

  if (!data.allowed) {
    return (
      <s-page heading="店頭受取・配送">
        <div className="Admin-body">
          <AdminBlock wide title="店頭受取・配送は Pro プランで使えます">
            <p className="Admin-note">POS のタイルで受取待ちの一覧・準備完了・引渡し完了と、持ち帰りと配送を分けた会計が使えます。</p>
            {outlet?.shopPlan?.distribution === "public" ? <PrimaryLink to="/app/plan">料金プランを見る</PrimaryLink> : null}
          </AdminBlock>
        </div>
      </s-page>
    );
  }

  const { locations, config, reviews, loadError } = data;
  // お知らせ枠は 1 つだけ（失敗 → 注意 → 案内の順。UI ルール 5章）
  let notice = null;
  if (result && !result.ok) {
    notice = (
      <StatusBanner tone="critical" heading="処理できませんでした">
        {result.error}
      </StatusBanner>
    );
  } else if (loadError) {
    notice = <StatusBanner tone="critical" heading="設定を読めませんでした">{loadError} 画面を開き直してください。</StatusBanner>;
  } else if (reviews === null) {
    notice = (
      <StatusBanner tone="warning" heading="要確認の注文を読めませんでした">
        注文を読む権限がまだ承認されていない可能性があります。アプリの権限の更新を承認してから開き直してください。
      </StatusBanner>
    );
  }

  return (
    <s-page heading="店頭受取・配送">
      <SuccessToast message={result?.ok ? result.message : null} trigger={result?.at} />
      <div className="Admin-body">
        <AdminIntro>
          POS Lite の店舗で、受取待ちの注文の準備完了・引渡し完了と、持ち帰りと配送を分けた会計をアプリで行います。どれも最初はオフです。
        </AdminIntro>
        {notice}
        {config ? (
          <AdminBlock wide title="設定" description="区分ごとに編集します。外へ書くスイッチ（受取の記録・履行・取り消し）はどれも最初はオフです。">
            <SummaryRows
              rows={POS_LITE_SECTION_KEYS.map((key) => ({
                key,
                title: POS_LITE_SECTIONS[key].title,
                text: sectionSummary(key, config, locations),
                to: sectionPath(key),
              }))}
            />
          </AdminBlock>
        ) : null}
        {Array.isArray(reviews) ? (
          <AdminBlock wide title="要確認の注文" description="会計のあとに配送・持ち帰りの処理が止まった注文です。理由を直してから再処理します。">
            {reviews.length === 0 ? (
              <EmptyState heading="要確認の注文はありません">止まった注文があると、ここに出ます。</EmptyState>
            ) : (
              <div className="History-scroll">
                <table className="History-table">
                  <thead>
                    <tr><th>注文</th><th>日時</th><th>店舗</th><th>理由</th><th aria-label="操作" /></tr>
                  </thead>
                  <tbody>
                    {reviews.map((order) => (
                      <tr key={order.id}>
                        <td data-label="注文" className="History-keep">{order.name}</td>
                        <td data-label="日時" className="History-keep">{formatDate(order.createdAt)}</td>
                        <td data-label="店舗">{order.locationName || "—"}</td>
                        <td data-label="理由"><StateBadge label="要確認" /> {order.reason}</td>
                        <td data-label="操作" className="History-keep">
                          {/* 再処理は履行を作る（あとで戻しにくい）ので、確認の窓を出す（UI ルール 4章） */}
                          <ConfirmAction
                            trigger="secondary"
                            label={busyIntent === "retry" && busyOrder === order.id ? "処理中…" : "再処理"}
                            heading={`${order.name} を再処理しますか`}
                            message={
                              config?.cancelStoreFulfillment
                                ? "配送分を出荷元へ移し、持ち帰り分を通知なしで履行します。店頭で履行済みの配送分は、店舗での履行を取り消してから移します。"
                                : "配送分を出荷元へ移し、持ち帰り分を通知なしで履行します。"
                            }
                            confirmLabel="再処理する"
                            fields={{ intent: "retry", orderId: order.id }}
                            disabled={busyIntent === "retry"}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminBlock>
        ) : null}
      </div>
    </s-page>
  );
}
