// app/routes/app.pos-lite_.$section.jsx
// 「店頭受取・配送」の設定の 1 区分だけを編集する画面（T 11/23 5:10 の案 A。UI ルール v1.1 2章・3章）。
// 区分: pickup（店頭受取）/ delivery（持ち帰りと配送の履行）/ fee（送料の行）/ locations（店舗ごとの配送）。
// 保存するのはその区分の値だけ（サーバーで今の設定を読み、その区分のキーだけを置きかえる）。
// 書き込みのスイッチはすべて既定オフ。オンにするのは T（店の担当者）。

import { Form, useActionData, useLoaderData } from "react-router";
import {
  AdminBlock,
  BackAction,
  EditCell,
  EditRow,
  EditTable,
  SaveBar,
  StatusBanner,
  SuccessToast,
  UnitInput,
} from "../components/admin-ui";
import { authenticate } from "../shopify.server";
import { getShopPlan } from "../utils/shopPlan.server.js";
import { loadConfig, requestFromAdmin } from "../utils/posLiteSale.js";
import { loadPosLiteLocations } from "../utils/posLiteLocations.js";
import { POS_LITE_SECTIONS, isPosLiteSection, mergeSection, sectionInputFromForm } from "../utils/posLiteSections.js";
import { CONFIG_KEY, CONFIG_NAMESPACE } from "../../extensions/pos-lite/src/logic.js";

const SAVE_MUTATION = `#graphql
  mutation PosLiteSave($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
  }
`;

function sectionOf(params) {
  const section = String(params?.section || "");
  if (!isPosLiteSection(section)) throw new Response("見つかりません", { status: 404 });
  return section;
}

export const loader = async ({ request, params }) => {
  const section = sectionOf(params);
  const { admin, session } = await authenticate.admin(request);
  const plan = await getShopPlan(admin, session?.shop, { reportUsage: false });
  if (!plan?.features?.storePickup) return { allowed: false, section };
  const run = requestFromAdmin(admin);
  try {
    const locations = await loadPosLiteLocations(run);
    const { config } = await loadConfig(run);
    return { allowed: true, section, locations, config, loadError: null };
  } catch (error) {
    return { allowed: true, section, locations: [], config: null, loadError: error instanceof Error ? error.message : "設定を読めませんでした。" };
  }
};

export const action = async ({ request, params }) => {
  const section = sectionOf(params);
  const { admin, session } = await authenticate.admin(request);
  const plan = await getShopPlan(admin, session?.shop, { reportUsage: false });
  if (!plan?.features?.storePickup) return { ok: false, error: "この機能は Pro プランで使えます。" };
  const run = requestFromAdmin(admin);
  const form = await request.formData();
  if (String(form.get("intent") || "") !== "save") return { ok: false, error: "操作を確かめてください。" };
  const locations = await loadPosLiteLocations(run);
  // 保存の直前に今の設定を読み直し、この区分のキーだけを置きかえる（ほかの区分の値は変えない）
  const { shopId, config: current } = await loadConfig(run);
  const { errors, config } = mergeSection(current, section, sectionInputFromForm(section, form, locations), locations);
  if (errors.length) return { ok: false, error: "保存していません。入力を直してください。", errors };
  const data = await run(SAVE_MUTATION, {
    metafields: [{ ownerId: shopId, namespace: CONFIG_NAMESPACE, key: CONFIG_KEY, type: "json", value: JSON.stringify(config) }],
  });
  const userErrors = data?.metafieldsSet?.userErrors || [];
  if (userErrors.length) {
    console.error("[location-stock]", { route: "app.pos-lite.section", section, shop: session?.shop }, "metafieldsSet userErrors:", userErrors.map((e) => e.message));
    return { ok: false, error: `保存できませんでした（Shopify: ${userErrors[0].message}）` };
  }
  return { ok: true, message: "保存しました", at: Date.now() };
};

function Check({ name, checked, children }) {
  return (
    <label>
      <input type="checkbox" name={name} defaultChecked={checked} />
      <span>{children}</span>
    </label>
  );
}

function PickupFields({ config }) {
  return (
    <>
      <Check name="pickupEnabled" checked={config.pickupEnabled}>POS で準備完了・引渡し完了を記録する</Check>
      <p className="Admin-note">準備完了を押すと、Shopify からお客様に「受取の準備ができました」のメールが届きます。</p>
      <Check name="pickupNotifyOnHandover" checked={config.pickupNotifyOnHandover}>引渡し完了のときにお客様へ知らせる</Check>
    </>
  );
}

function DeliveryFields({ config }) {
  return (
    <>
      <Check name="deliveryEnabled" checked={config.deliveryEnabled}>会計のあと、配送分を出荷元へ移し、持ち帰り分を履行する</Check>
      <p className="Admin-note">配送のある会計では、POS のカートで「フルフィルメント済みにする」をオフにしてから会計します。</p>
      <Check name="cancelStoreFulfillment" checked={config.cancelStoreFulfillment}>店頭で履行済みになった配送分を取り消して出荷元へ移す</Check>
      <p className="Admin-note">「フルフィルメント済みにする」をオフにできない店舗用です。店舗での履行を取り消してから出荷元へ移し、持ち帰り分はもう一度通知なしで履行します。在庫の戻り方を開発ストアで確かめてからオンにします。</p>
    </>
  );
}

function FeeFields({ config }) {
  return (
    <>
      <Check name="shippingTaxable" checked={config.shippingTaxable}>送料に消費税をかける</Check>
      <p className="Admin-note">送料の行を税ありでカートに入れます（最初は税あり）。変えると、次に配送を確定したカートから効きます。</p>
      <Check name="feeCountsAsSales" checked={config.feeCountsAsSales}>送料の行を売上に含める</Check>
      <Check name="feeEarnsPoints" checked={config.feeEarnsPoints}>送料の行をポイントの対象にする</Check>
      <p className="Admin-note">送料の行には印が付き、会計のときのこの 2 つの値も行に残ります。POS Receipt と Shop Point がこの印を読みます（それぞれのアプリが対応してから効きます）。</p>
    </>
  );
}

function LocationFields({ config, locations }) {
  const rowFor = (id) => config?.locations?.find((row) => row.locationId === id) || null;
  return (
    <>
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
    </>
  );
}

const FIELDS = { pickup: PickupFields, delivery: DeliveryFields, fee: FeeFields, locations: LocationFields };

export default function PosLiteSectionPage() {
  const data = useLoaderData();
  const result = useActionData();
  const meta = POS_LITE_SECTIONS[data.section];

  if (!data.allowed) {
    return (
      <s-page heading={meta.title} inlineSize="base">
        <BackAction to="/app/pos-lite" label="店頭受取・配送へ戻る" />
        <div className="Admin-body Admin-edit-body">
          <AdminBlock wide title="店頭受取・配送は Pro プランで使えます">
            <p className="Admin-note">POS のタイルで受取待ちの一覧・準備完了・引渡し完了と、持ち帰りと配送を分けた会計が使えます。</p>
          </AdminBlock>
        </div>
      </s-page>
    );
  }

  const { config, locations, loadError } = data;
  // お知らせ枠は 1 つだけ（失敗 → 案内の順。UI ルール 5章）
  let notice = null;
  if (result && !result.ok) {
    notice = (
      <StatusBanner tone="critical" heading="保存できませんでした">
        {result.error}
        {result.errors ? <ul>{result.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
      </StatusBanner>
    );
  } else if (loadError) {
    notice = <StatusBanner tone="critical" heading="設定を読めませんでした">{loadError} 画面を開き直してください。</StatusBanner>;
  }
  const Fields = FIELDS[data.section];
  // 表の区分（店舗ごとの配送）は幅の広い形（形 3）、ほかはチェックだけの形（形 1）
  const wide = data.section === "locations";

  return (
    <s-page heading={meta.title} inlineSize={wide ? undefined : "base"}>
      <BackAction to="/app/pos-lite" label="店頭受取・配送へ戻る" />
      <SuccessToast message={result?.ok ? result.message : null} trigger={result?.at} />
      <div className="Admin-body Admin-edit-body">
        {notice}
        {config ? (
          <Form method="post" data-pos-lite-section={data.section}>
            <input type="hidden" name="intent" value="save" />
            <SaveBar failed={Boolean(result && !result.ok)} />
            <AdminBlock wide={wide} title={meta.title} description={meta.description}>
              <Fields config={config} locations={locations} />
            </AdminBlock>
          </Form>
        ) : null}
      </div>
    </s-page>
  );
}
