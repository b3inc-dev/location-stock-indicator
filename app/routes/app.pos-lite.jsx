// app/routes/app.pos-lite.jsx
// POS Lite（店頭受取・持ち帰りと配送）の設定と、会計のあとに止まった注文（要確認）の再処理。
// 書き込みのスイッチはすべて既定オフ。オンにするのは T（店の担当者）。

import { Form, useActionData, useLoaderData, useNavigation, useOutletContext } from "react-router";
import {
  AdminBlock,
  AdminIntro,
  ConfirmAction,
  EditCell,
  EditRow,
  EditTable,
  EmptyState,
  PrimaryLink,
  SaveBar,
  StateBadge,
  StatusBanner,
  SuccessToast,
  UnitInput,
} from "../components/admin-ui";
import { authenticate } from "../shopify.server";
import { getShopPlan } from "../utils/shopPlan.server.js";
import { listReviewOrders, loadConfig, processSale, requestFromAdmin, rescanMissedOrders, withOrderLock } from "../utils/posLiteSale.js";
import { CONFIG_KEY, CONFIG_NAMESPACE, RESCAN_DAYS, numericId, validateConfig } from "../../extensions/pos-lite/src/logic.js";

const LOCATIONS_QUERY = `#graphql
  query PosLiteLocations {
    locations(first: 250, includeInactive: false) { nodes { id name } }
  }
`;

const SAVE_MUTATION = `#graphql
  mutation PosLiteSave($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
  }
`;

async function loadLocations(run) {
  const data = await run(LOCATIONS_QUERY, {});
  return (data?.locations?.nodes || []).map((node) => ({ id: numericId(node.id), name: node.name }));
}

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
    locations = await loadLocations(run);
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

  if (intent === "rescan") {
    // 拾い直し: 印の無いまま終わった注文を探す。書く（要確認のタグと理由）のはスイッチがオンのときだけ
    const { config } = await loadConfig(run);
    let scan;
    try {
      scan = await rescanMissedOrders(run, { config });
    } catch (error) {
      console.error("[location-stock]", { route: "app.pos-lite", shop: session?.shop }, error instanceof Error ? error.message : "rescan failed");
      return { ok: false, error: "注文を読めませんでした。注文を読む権限が承認されているか確かめて、もう一度押してください。" };
    }
    // 記録（ログ）には件数だけ（注文の中身・お客様の値は出さない）
    console.log("[location-stock] pos-lite rescan", { shop: session?.shop, found: scan.found.length, marked: scan.marked, failed: scan.failed, wrote: scan.wrote });
    const more = scan.truncated ? "（読む上限に届いたので、古い注文は見ていません）" : "";
    if (!scan.found.length) return { ok: true, message: `印の無いまま終わった注文はありませんでした${more}`, at: Date.now() };
    if (!scan.wrote) return { ok: true, message: `${scan.found.length} 件見つかりました（スイッチがオフなので、注文には何も書いていません）${more}`, at: Date.now(), rescan: scan };
    if (scan.failed) return { ok: false, error: `${scan.found.length} 件のうち ${scan.failed} 件に要確認の印を付けられませんでした。もう一度押してください。`, rescan: scan };
    return { ok: true, message: `${scan.marked} 件を「要確認の注文」に出しました${more}`, at: Date.now() };
  }

  if (intent !== "save") return { ok: false, error: "操作を確かめてください。" };
  const locations = await loadLocations(run);
  const rows = locations.map((location) => ({
    locationId: location.id,
    enabled: form.get(`enabled_${location.id}`) === "on",
    warehouseLocationId: String(form.get(`warehouse_${location.id}`) || ""),
    shippingFee: String(form.get(`fee_${location.id}`) ?? ""),
    shippingTitle: String(form.get(`title_${location.id}`) ?? ""),
  }));
  const { errors, config } = validateConfig(
    {
      pickupEnabled: form.get("pickupEnabled") === "on",
      pickupNotifyOnHandover: form.get("pickupNotifyOnHandover") === "on",
      deliveryEnabled: form.get("deliveryEnabled") === "on",
      cancelStoreFulfillment: form.get("cancelStoreFulfillment") === "on",
      shippingTaxable: form.get("shippingTaxable") === "on",
      feeCountsAsSales: form.get("feeCountsAsSales") === "on",
      feeEarnsPoints: form.get("feeEarnsPoints") === "on",
      rescanEnabled: form.get("rescanEnabled") === "on",
      locations: rows,
    },
    locations,
  );
  if (errors.length) return { ok: false, error: "保存していません。入力を直してください。", errors };
  const shopData = await run(`#graphql
    query PosLiteShopId { shop { id } }`, {});
  const data = await run(SAVE_MUTATION, {
    metafields: [{ ownerId: shopData.shop.id, namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value: JSON.stringify(config) }],
  });
  const userErrors = data?.metafieldsSet?.userErrors || [];
  if (userErrors.length) {
    console.error("[location-stock]", { route: "app.pos-lite", shop: session?.shop }, "metafieldsSet userErrors:", userErrors.map((e) => e.message));
    return { ok: false, error: `保存できませんでした（Shopify: ${userErrors[0].message}）` };
  }
  return { ok: true, message: "保存しました", at: Date.now() };
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
      <StatusBanner tone="critical" heading={result.errors ? "保存できませんでした" : "処理できませんでした"}>
        {result.error}
        {result.errors ? <ul>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
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
  const rowFor = (id) => config?.locations?.find((row) => row.locationId === id) || null;

  return (
    <s-page heading="店頭受取・配送">
      <SuccessToast message={result?.ok ? result.message : null} trigger={result?.at} />
      <div className="Admin-body">
        <AdminIntro>
          POS Lite の店舗で、受取待ちの注文の準備完了・引渡し完了と、持ち帰りと配送を分けた会計をアプリで行います。どれも最初はオフです。
        </AdminIntro>
        {notice}
        {config ? (
          <Form method="post" data-pos-lite-settings>
            <input type="hidden" name="intent" value="save" />
            <SaveBar failed={Boolean(result && !result.ok && result.errors)} />
            <AdminBlock title="店頭受取" description="POS の「店頭受取・配送」タイルで、自店の受取待ちを一覧にし、準備完了・引渡し完了を記録します。">
              <label>
                <input type="checkbox" name="pickupEnabled" defaultChecked={config.pickupEnabled} />
                <span>POS で準備完了・引渡し完了を記録する</span>
              </label>
              <p className="Admin-note">準備完了を押すと、Shopify からお客様に「受取の準備ができました」のメールが届きます。</p>
              <label>
                <input type="checkbox" name="pickupNotifyOnHandover" defaultChecked={config.pickupNotifyOnHandover} />
                <span>引渡し完了のときにお客様へ知らせる</span>
              </label>
            </AdminBlock>
            <AdminBlock title="持ち帰りと配送" description="会計の前に、商品と数量ごとに配送する分・配送先・送料を POS で決めます。会計のあと、持ち帰り分だけを履行し、配送分は出荷元に未発送で残します。">
              <label>
                <input type="checkbox" name="deliveryEnabled" defaultChecked={config.deliveryEnabled} />
                <span>会計のあと、配送分を出荷元へ移し、持ち帰り分を履行する</span>
              </label>
              <p className="Admin-note">配送のある会計では、POS のカートで「フルフィルメント済みにする」をオフにしてから会計します。</p>
              <label>
                <input type="checkbox" name="cancelStoreFulfillment" defaultChecked={config.cancelStoreFulfillment} />
                <span>店頭で履行済みになった配送分を取り消して出荷元へ移す</span>
              </label>
              <p className="Admin-note">「フルフィルメント済みにする」をオフにできない店舗用です。店舗での履行を取り消してから出荷元へ移し、持ち帰り分はもう一度通知なしで履行します。在庫の戻り方を開発ストアで確かめてからオンにします。</p>
              <label>
                <input type="checkbox" name="rescanEnabled" defaultChecked={config.rescanEnabled} />
                <span>印の無いまま終わった注文を拾い直して「要確認の注文」に出す</span>
              </label>
              <p className="Admin-note">会計のあとの処理が、済んだ印も要確認の印も残さずに終わった注文を探し、注文に要確認のタグと理由を書きます。配送・履行には触れません。オフのときは探して件数を出すだけで、注文には何も書きません。</p>
            </AdminBlock>
            <AdminBlock wide title="店舗ごとの配送" description="配送を受け付ける店舗に印を付け、送料を決めます。出荷元は会計ごとに POS で必ず選びます（ここで決めるのは最初に選んでおく値）。送料は配送が 1 点以上のとき 1 回だけ足します。">
              <EditTable
                columns={[
                  { label: "店舗", width: "minmax(140px, 1.4fr)" },
                  { label: "配送を受け付ける", width: "minmax(96px, 0.8fr)" },
                  { label: "既定の出荷元", width: "minmax(160px, 1.4fr)" },
                  { label: "送料", width: "minmax(120px, 1fr)" },
                  { label: "送料の名前", width: "minmax(120px, 1fr)" },
                ]}
              >
                {locations.map((location) => {
                  const row = rowFor(location.id);
                  return (
                    <EditRow key={location.id}>
                      <EditCell label="店舗"><span>{location.name}</span></EditCell>
                      <EditCell label="配送を受け付ける">
                        <input type="checkbox" name={`enabled_${location.id}`} aria-label={`${location.name}で配送を受け付ける`} defaultChecked={row?.enabled === true} />
                      </EditCell>
                      <EditCell label="既定の出荷元">
                        <select className="Admin-select" name={`warehouse_${location.id}`} aria-label={`${location.name}の既定の出荷元`} defaultValue={row?.warehouseLocationId || ""}>
                          <option value="">選ばない</option>
                          {locations.filter((l) => l.id !== location.id).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </EditCell>
                      <EditCell label="送料">
                        <UnitInput label={`${location.name}の送料`} unit="円" name={`fee_${location.id}`} inputMode="numeric" defaultValue={row ? String(row.shippingFee) : "0"} />
                      </EditCell>
                      <EditCell label="送料の名前">
                        <input className="Admin-input" name={`title_${location.id}`} aria-label={`${location.name}の送料の名前`} maxLength={30} defaultValue={row?.shippingTitle || "送料"} />
                      </EditCell>
                    </EditRow>
                  );
                })}
              </EditTable>
              <p className="Admin-note">出荷元には、配送する商品の在庫の登録が要ります（無いと出荷元へ移せず「要確認」になります）。</p>
              <label>
                <input type="checkbox" name="shippingTaxable" defaultChecked={config.shippingTaxable} />
                <span>送料に消費税をかける</span>
              </label>
              <p className="Admin-note">送料の行を税ありでカートに入れます（最初は税あり）。変えると、次に配送を確定したカートから効きます。</p>
              <label>
                <input type="checkbox" name="feeCountsAsSales" defaultChecked={config.feeCountsAsSales} />
                <span>送料の行を売上に含める</span>
              </label>
              <label>
                <input type="checkbox" name="feeEarnsPoints" defaultChecked={config.feeEarnsPoints} />
                <span>送料の行をポイントの対象にする</span>
              </label>
              <p className="Admin-note">送料の行には印が付き、会計のときのこの 2 つの値も行に残ります。POS Receipt と Shop Point がこの印を読みます（それぞれのアプリが対応してから効きます）。</p>
            </AdminBlock>
          </Form>
        ) : null}
        {Array.isArray(reviews) ? (
          <AdminBlock
            wide
            title="要確認の注文"
            description={`会計のあとに配送・持ち帰りの処理が止まった注文です。理由を直してから再処理します。「拾い直す」は、直近 ${RESCAN_DAYS} 日の POS の注文のうち、印の無いまま終わったもの（作られてから 5 時間を過ぎたもの）を探します。`}
            action={
              <Form method="post">
                <input type="hidden" name="intent" value="rescan" />
                <button type="submit" className="Admin-secondary" disabled={busyIntent === "rescan"}>
                  {busyIntent === "rescan" ? "探しています…" : "拾い直す"}
                </button>
              </Form>
            }
          >
            {result?.rescan && !result.rescan.wrote && result.rescan.found.length ? (
              <div className="History-scroll" data-pos-lite-rescan>
                <p className="Admin-note">見つかった注文（スイッチ「印の無いまま終わった注文を拾い直して「要確認の注文」に出す」がオフなので、注文には何も書いていません）</p>
                <table className="History-table">
                  <thead>
                    <tr><th>注文</th><th>日時</th><th>店舗</th></tr>
                  </thead>
                  <tbody>
                    {result.rescan.found.map((order) => (
                      <tr key={order.id}>
                        <td data-label="注文" className="History-keep">{order.name}</td>
                        <td data-label="日時" className="History-keep">{formatDate(order.createdAt)}</td>
                        <td data-label="店舗">{order.locationName || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
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
