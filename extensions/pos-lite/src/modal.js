// タイルから開く画面。「受取待ち」と「配送の分け」の 2 つ。
// 受取待ち: 自店（POS の今のロケーション）の店頭受取の出荷指示を一覧にし、準備完了・引渡し完了を記録する。
// 配送の分け: 会計の前に、明細ごとの配送する数量・配送先・送料をカートに書く（会計のあとはサーバーが履行する）。
import { adminRequest, busy, button, currentLocationId, field, loadState, screen, text } from "./api.js";
import {
  DELIVERY_ATTRIBUTE,
  SHIP_QTY_PROPERTY,
  buildDeliveryCart,
  collectPages,
  deliveryUsable,
  feeSync,
  locationRow,
  parseDelivery,
  pickupAction,
  pickupLabel,
} from "./logic.js";

export default async function () {
  renderHome();
}

async function renderHome() {
  const list = screen("店頭受取・配送");
  const status = text("読み込み中…", list);
  try {
    const state = await loadState();
    status.remove();
    if (!state.access.allowed) {
      text("この機能は Pro プランで使えます。", list);
      return;
    }
    const pickup = button("受取待ち", list, "primary");
    pickup.addEventListener("click", () => renderPickup(state));
    const delivery = button("配送の分け（会計の前）", list, "secondary");
    delivery.addEventListener("click", () => renderDelivery(state));
  } catch (error) {
    status.textContent = error.message;
  }
}

function backButton(list) {
  const back = button("戻る", list, "secondary");
  back.addEventListener("click", () => renderHome());
}

// ---------------------------------------------------------------------------
// 受取待ち
// ---------------------------------------------------------------------------

const LIST_QUERY = `query PosLitePickupList($filter: String!, $after: String) {
  fulfillmentOrders(first: 50, query: $filter, after: $after, sortKey: ID, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id status requestStatus orderName
      deliveryMethod { methodType }
      assignedLocation { location { id } }
      order { displayFulfillmentStatus }
    }
  }
}`;

const DETAIL_QUERY = `query PosLitePickupDetail($id: ID!, $after: String) {
  fulfillmentOrder(id: $id) {
    id status requestStatus orderName
    deliveryMethod { methodType }
    assignedLocation { location { id } }
    order { displayFulfillmentStatus }
    supportedActions { action }
    lineItems(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id remainingQuantity productTitle variantTitle sku }
    }
  }
}`;

const PREPARE = `mutation PosLitePrepare($input: FulfillmentOrderLineItemsPreparedForPickupInput!) {
  fulfillmentOrderLineItemsPreparedForPickup(input: $input) { userErrors { field message } }
}`;

const COMPLETE = `mutation PosLiteHandover($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } }
}`;

function snapshot(fo, locationId) {
  return {
    id: fo.id,
    orderName: fo.orderName,
    status: fo.status,
    requestStatus: fo.requestStatus,
    method: fo.deliveryMethod?.methodType || "",
    locationOk: fo.assignedLocation?.location?.id === `gid://shopify/Location/${locationId}`,
    // 準備完了のあとは注文の表示が「受取の準備完了」になる（推測: 出荷指示の状態は IN_PROGRESS。実機で確かめる）
    ready: fo.status === "IN_PROGRESS" || fo.order?.displayFulfillmentStatus === "READY_FOR_PICKUP",
    supportedActions: (fo.supportedActions || []).map((item) => item.action),
  };
}

async function loadDetail(id, locationId) {
  let head = null;
  const nodes = await collectPages(async (after) => {
    const { fulfillmentOrder } = await adminRequest(DETAIL_QUERY, { id, after });
    if (!fulfillmentOrder) throw new Error("受取の注文が見つかりません。一覧を更新してください。");
    head = head || fulfillmentOrder;
    return fulfillmentOrder.lineItems;
  });
  return { ...snapshot(head, locationId), items: nodes, lines: nodes.map((n) => ({ id: n.id, remaining: n.remainingQuantity })) };
}

async function renderPickup(state) {
  const list = screen("受取待ち");
  backButton(list);
  const locationId = currentLocationId();
  const status = text("読み込み中…", list);
  const rows = document.createElement("s-stack");
  rows.setAttribute("gap", "base");
  list.append(rows);
  const refresh = button("一覧を更新", list, "secondary");
  refresh.addEventListener("click", () => busy(refresh, load));
  if (!state.config.pickupEnabled) text("管理画面で「準備完了・引渡し完了を記録する」がオフです。一覧だけ見られます。", list, "subdued");

  async function load() {
    rows.replaceChildren();
    status.textContent = "読み込み中…";
    try {
      if (!/^[1-9]\d*$/.test(locationId)) throw new Error("POS の店舗（ロケーション）が分かりません。");
      const filter = `assigned_location_id:${locationId} AND (status:open OR status:in_progress OR status:on_hold OR status:scheduled)`;
      const nodes = await collectPages(async (after) => (await adminRequest(LIST_QUERY, { filter, after })).fulfillmentOrders);
      if (locationId !== currentLocationId()) throw new Error("店舗が切り替わりました。一覧を更新してください。");
      const pickups = nodes.map((fo) => snapshot(fo, locationId)).filter((fo) => fo.method === "PICK_UP" && fo.locationOk);
      status.textContent = pickups.length ? `受取待ち ${pickups.length} 件` : "この店舗の受取待ちはありません。";
      for (const fo of pickups) {
        const open = button(`${fo.orderName}　${pickupLabel(fo)}`, rows, "secondary");
        const detail = document.createElement("s-stack");
        detail.setAttribute("gap", "small");
        rows.append(detail);
        open.addEventListener("click", () => busy(open, () => showDetail(fo, detail)));
      }
    } catch (error) {
      status.textContent = error.message;
    }
  }

  async function showDetail(fo, detail) {
    detail.replaceChildren();
    try {
      const current = await loadDetail(fo.id, locationId);
      for (const item of current.items.filter((i) => i.remainingQuantity > 0)) {
        text(`${[item.productTitle, item.variantTitle, item.sku].filter(Boolean).join(" / ")}　${item.remainingQuantity} 点`, detail);
      }
      if (!state.config.pickupEnabled) return;
      const intent = current.ready ? "complete" : "prepare";
      const decision = pickupAction({ ...current, intent }, { notifyOnHandover: state.config.pickupNotifyOnHandover });
      if (decision.error) {
        text(decision.error, detail, "critical");
        return;
      }
      const action = button(intent === "prepare" ? "準備完了にする" : "引渡し完了にする", detail, "primary");
      if (intent === "prepare") text("押すと、お客様に「受取の準備ができました」のメールが届きます。", detail, "subdued");
      action.addEventListener("click", () =>
        busy(action, async () => {
          try {
            const outcome = await runPickup(fo.id, locationId, intent, state.config);
            text(outcome, detail, "success");
            await load();
          } catch (error) {
            text(error.message, detail, "critical");
          }
        }),
      );
    } catch (error) {
      text(error.message, detail, "critical");
    }
  }

  await load();
}

/** 押す直前に読み直して決める。失敗のあとも読み直し、もう済んでいたら二重に送らない（2 台目の端末・通信切れ）。 */
async function runPickup(id, locationId, intent, config) {
  const decide = async () => pickupAction({ ...(await loadDetail(id, locationId)), intent }, { notifyOnHandover: config.pickupNotifyOnHandover });
  const decision = await decide();
  if (decision.error) throw new Error(decision.error);
  if (decision.already) return "もう記録されていました（送り直していません）。";
  try {
    if (decision.mutate === "prepare") {
      const data = await adminRequest(PREPARE, { input: { lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: id }] } });
      const errors = data.fulfillmentOrderLineItemsPreparedForPickup?.userErrors;
      if (!Array.isArray(errors)) throw new Error("準備完了の結果を確かめられませんでした。一覧を更新してください。");
      if (errors.length) throw new Error(`準備完了にできませんでした（${errors[0].message}）`);
      return "準備完了にしました。";
    }
    const data = await adminRequest(COMPLETE, {
      fulfillment: {
        notifyCustomer: decision.notifyCustomer,
        lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: id, fulfillmentOrderLineItems: decision.lineItems }],
      },
    });
    const result = data.fulfillmentCreate;
    if (!Array.isArray(result?.userErrors)) throw new Error("引渡し完了の結果を確かめられませんでした。一覧を更新してください。");
    if (result.userErrors.length) throw new Error(`引渡し完了にできませんでした（${result.userErrors[0].message}）`);
    return "引渡し完了にしました。";
  } catch (error) {
    const again = await decide().catch(() => null);
    if (again?.already) return "記録されていました（送り直していません）。";
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 配送の分け（会計の前）
// ---------------------------------------------------------------------------

async function applyFee(action) {
  for (const uuid of action.remove) if (uuid) await shopify.cart.removeLineItem(uuid);
  if (action.add) await shopify.cart.addCustomSale(action.add);
}

function renderDelivery(state) {
  const list = screen("配送の分け");
  backButton(list);
  const locationId = currentLocationId();
  if (!state.config.deliveryEnabled) {
    text("管理画面で「持ち帰り分を履行する」がオフです。オンにするまで使えません。", list);
    return;
  }
  if (!deliveryUsable(state.config, locationId)) {
    text("この店舗では配送を受け付けない設定です。管理画面の「店舗ごとの配送」を確かめてください。", list);
    return;
  }
  const row = locationRow(state.config, locationId);
  const cart = shopify.cart.current.value;
  const products = (cart.lineItems || []).filter((line) => line.variantId);
  if (!products.length) {
    text("カートに商品がありません。先に商品を入れてください。", list);
    return;
  }
  const saved = parseDelivery(cart.properties?.[DELIVERY_ATTRIBUTE]);
  text("商品ごとに、配送する数量を決めます。残りは持ち帰りです。", list);
  const ship = {};
  const fee = text("", list);
  const showFee = () => {
    const total = Object.values(ship).reduce((sum, n) => sum + n, 0);
    fee.textContent = `配送 ${total} 点・${row.shippingTitle} ¥${(total > 0 ? row.shippingFee : 0).toLocaleString("ja-JP")}`;
  };
  for (const line of products) {
    const start = Math.min(Number(line.properties?.[SHIP_QTY_PROPERTY] || 0) || 0, line.quantity);
    ship[line.uuid] = start;
    const name = [line.title, line.sku].filter(Boolean).join(" / ");
    const label = text("", list);
    const draw = () => { label.textContent = `${name}　カート ${line.quantity}・配送 ${ship[line.uuid]}・持ち帰り ${line.quantity - ship[line.uuid]}`; };
    const row2 = document.createElement("s-stack");
    row2.setAttribute("direction", "inline");
    row2.setAttribute("gap", "small");
    list.append(row2);
    const minus = button("配送 −1", row2, "secondary");
    const plus = button("配送 +1", row2, "secondary");
    const change = (delta) => {
      ship[line.uuid] = Math.min(line.quantity, Math.max(0, ship[line.uuid] + delta));
      draw();
      showFee();
    };
    minus.addEventListener("click", () => change(-1));
    plus.addEventListener("click", () => change(1));
    draw();
  }
  showFee();
  const to = saved?.to || {};
  const address = {
    lastName: field("姓", list, to.lastName || ""),
    firstName: field("名", list, to.firstName || ""),
    zip: field("郵便番号", list, to.zip || ""),
    province: field("都道府県", list, to.provinceCode || ""),
    city: field("市区町村", list, to.city || ""),
    address1: field("住所（番地まで）", list, to.address1 || ""),
    address2: field("建物名・部屋番号", list, to.address2 || ""),
    phone: field("電話番号", list, to.phone || ""),
  };
  const from = text("出荷元: 読み込み中…", list, "subdued");
  adminRequest(`query PosLiteFrom($id: ID!) { location(id: $id) { name } }`, { id: `gid://shopify/Location/${row.warehouseLocationId}` })
    .then((data) => { from.textContent = `出荷元: ${data.location?.name || "管理画面で決めたロケーション"}`; })
    .catch(() => { from.textContent = "出荷元: 管理画面で決めたロケーション"; });
  const result = text("", list);
  const confirm = button("配送を確定", list, "primary");
  confirm.addEventListener("click", () =>
    busy(confirm, async () => {
      try {
        const latest = shopify.cart.current.value;
        const built = buildDeliveryCart(
          {
            lines: (latest.lineItems || []).map((line) => ({ uuid: line.uuid, variantId: line.variantId, quantity: line.quantity, title: line.title })),
            shipQuantities: ship,
            address: Object.fromEntries(Object.entries(address).map(([key, item]) => [key, String(item.value ?? "")])),
          },
          row,
        );
        if (built.error) throw new Error(built.error);
        for (const item of built.lineProperties) {
          await shopify.cart.addLineItemProperties(item.uuid, { [SHIP_QTY_PROPERTY]: String(item.quantity) });
        }
        for (const uuid of built.clearLines) {
          const line = (latest.lineItems || []).find((l) => l.uuid === uuid);
          if (line?.properties?.[SHIP_QTY_PROPERTY]) await shopify.cart.removeLineItemProperties(uuid, [SHIP_QTY_PROPERTY]);
        }
        await shopify.cart.addCartProperties(built.cartProperties);
        await applyFee(feeSync(shopify.cart.current.value.lineItems, built.title, built.fee));
        result.setAttribute("tone", "success");
        result.textContent = `配送 ${built.shipCount} 点を確定しました。会計の前に、カートの「フルフィルメント済みにする」をオフにしてください。`;
      } catch (error) {
        result.setAttribute("tone", "critical");
        result.textContent = error.message || "配送を確定できませんでした。";
      }
    }),
  );
  const cancel = button("配送を取り消す", list, "secondary");
  cancel.addEventListener("click", () =>
    busy(cancel, async () => {
      try {
        const latest = shopify.cart.current.value;
        for (const line of latest.lineItems || []) {
          if (line.properties?.[SHIP_QTY_PROPERTY]) await shopify.cart.removeLineItemProperties(line.uuid, [SHIP_QTY_PROPERTY]);
        }
        if (latest.properties?.[DELIVERY_ATTRIBUTE]) await shopify.cart.removeCartProperties([DELIVERY_ATTRIBUTE]);
        await applyFee(feeSync(shopify.cart.current.value.lineItems, row.shippingTitle, 0));
        result.setAttribute("tone", "success");
        result.textContent = "配送を取り消しました。全部持ち帰りです。";
      } catch (error) {
        result.setAttribute("tone", "critical");
        result.textContent = error.message || "配送を取り消せませんでした。";
      }
    }),
  );
}
