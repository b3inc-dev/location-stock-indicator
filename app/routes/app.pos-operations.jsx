import {useState} from "react";
import {useFetcher, useLoaderData} from "react-router";
import {authenticate} from "../shopify.server";
import {distributionForShop} from "../utils/shopPlan.server.js";
import {normalizeOperations} from "../../extensions/pos-pickup/src/logic.js";

const QUERY = `#graphql
  query PosOperationsSettings {
    shop {
      id
      metafield(namespace: "location_stock", key: "pos_operations") { value }
    }
    locations(first: 250) { nodes { id name } }
  }
`;

const SAVE = `#graphql
  mutation SavePosOperations($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields { id }
      userErrors { field message }
    }
  }
`;

function toIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function toLocalInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function loader({request}) {
  const {admin, session} = await authenticate.admin(request);
  if (distributionForShop(session?.shop) !== "inhouse") return {locked: true, rows: []};
  const response = await admin.graphql(QUERY);
  const payload = await response.json();
  if (payload.errors?.length) throw new Response("設定を取得できませんでした", {status: 500});
  let saved = [];
  try {
    saved = JSON.parse(payload.data.shop.metafield?.value || "{}").locations || [];
  } catch {
    saved = [];
  }
  const rows = (payload.data.locations.nodes || []).map((location) => {
    const config = saved.find((item) => item.locationId === location.id) || {};
    return {
      locationId: location.id,
      name: location.name,
      active: Boolean(config.active),
      startsAt: toLocalInput(config.startsAt),
      endsAt: toLocalInput(config.endsAt),
      deliveryEnabled: Boolean(config.deliveryEnabled),
      warehouseLocationId: config.warehouseLocationId || "",
      shippingFee: Number.isInteger(config.shippingFee) ? config.shippingFee : 0,
      shippingTitle: config.shippingTitle || "送料",
    };
  });
  return {locked: false, rows, shopId: payload.data.shop.id};
}

export async function action({request}) {
  const {admin, session} = await authenticate.admin(request);
  if (distributionForShop(session?.shop) !== "inhouse") {
    return {errors: ["この設定は自社版でのみ使えます。"]};
  }
  const form = await request.formData();
  let submitted = [];
  try {
    submitted = JSON.parse(String(form.get("payload") || "[]"));
  } catch {
    return {errors: ["入力を確認してください。"]};
  }
  const current = await admin.graphql(QUERY);
  const payload = await current.json();
  const knownIds = (payload.data?.locations?.nodes || []).map((location) => location.id);
  let previous = {locations: []};
  try {
    previous = JSON.parse(payload.data?.shop?.metafield?.value || "{}");
  } catch {
    previous = {locations: []};
  }
  const normalized = normalizeOperations(
    submitted.map((row) => ({
      ...row,
      startsAt: toIso(row.startsAt),
      endsAt: toIso(row.endsAt),
      shippingFee: Number(row.shippingFee),
    })),
    knownIds,
    previous,
    new Date().toISOString(),
  );
  if (normalized.errors.length) return {errors: normalized.errors};
  const saved = await admin.graphql(SAVE, {
    variables: {
      metafields: [{
        ownerId: payload.data.shop.id,
        namespace: "location_stock",
        key: "pos_operations",
        type: "json",
        value: JSON.stringify({locations: normalized.locations}),
      }],
    },
  });
  const result = await saved.json();
  const userErrors = result.data?.metafieldsSet?.userErrors || [];
  if (result.errors?.length || userErrors.length) return {errors: ["設定を保存できませんでした。"]};
  return {errors: [], saved: true};
}

export default function PosOperations() {
  const data = useLoaderData();
  const fetcher = useFetcher();
  const [rows, setRows] = useState(data.rows || []);
  if (data.locked) return <p>この設定は自社版でのみ使えます。</p>;
  const errors = fetcher.data?.errors || [];
  const update = (locationId, patch) => {
    setRows((current) => current.map((row) => (row.locationId === locationId ? {...row, ...patch} : row)));
  };
  return (
    <main style={{padding: 20, maxWidth: 1100}}>
      <h1 style={{fontSize: 20}}>店舗の配送と引渡</h1>
      <p>
        対象期間の支払済みPOS販売だけを処理します。POSの自動履行は対象端末でオフにしてください。配送は店舗ごとに初期オフです。停止するときは対象を外すと、空の終了日時を現在時刻で閉じます。終了日時より前の注文は、遅れて届いても処理します。
      </p>
      {errors.map((error) => <p key={error}>{error}</p>)}
      {fetcher.data?.saved && <p>保存しました。</p>}
      <form onSubmit={(event) => {
        event.preventDefault();
        const body = new FormData();
        body.set("payload", JSON.stringify(rows));
        fetcher.submit(body, {method: "post"});
      }}>
        <table style={{width: "100%", borderCollapse: "collapse"}}>
          <thead>
            <tr>
              {["店舗", "対象", "開始", "終了", "配送", "出荷元", "送料", "送料名"].map((label) => (
                <th key={label} style={{textAlign: "left", padding: 8}}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.locationId}>
                <td style={{padding: 8}}>{row.name}</td>
                <td><input type="checkbox" checked={row.active} onChange={(event) => update(row.locationId, {active: event.target.checked})} /></td>
                <td><input type="datetime-local" value={row.startsAt} onChange={(event) => update(row.locationId, {startsAt: event.target.value})} /></td>
                <td><input type="datetime-local" value={row.endsAt} onChange={(event) => update(row.locationId, {endsAt: event.target.value})} /></td>
                <td><input type="checkbox" checked={row.deliveryEnabled} onChange={(event) => update(row.locationId, {deliveryEnabled: event.target.checked})} /></td>
                <td>
                  <select value={row.warehouseLocationId} onChange={(event) => update(row.locationId, {warehouseLocationId: event.target.value})}>
                    <option value="">選択</option>
                    {rows.filter((location) => location.locationId !== row.locationId).map((location) => <option key={location.locationId} value={location.locationId}>{location.name}</option>)}
                  </select>
                </td>
                <td><input type="number" min="0" step="1" value={row.shippingFee} onChange={(event) => update(row.locationId, {shippingFee: event.target.value})} style={{width: 90}} /></td>
                <td><input value={row.shippingTitle} onChange={(event) => update(row.locationId, {shippingTitle: event.target.value})} style={{width: 100}} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="submit" style={{marginTop: 16}}>保存</button>
      </form>
    </main>
  );
}
