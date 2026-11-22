// 会計のあとの配送・持ち帰りの処理（orders/paid と管理画面の再処理）。
// Admin GraphQL を呼ぶ関数 request(query, variables) => data を受け取る形にして、試験で差し替えられるようにする。
// 何度呼んでも安全: いつも注文の今の状態を読み直し、済んだ分を除いて次の 1 歩だけを行う（planSale）。

import {
  CONFIG_KEY,
  CONFIG_NAMESPACE,
  HANDOFF_KEY,
  REVIEW_KEY,
  REVIEW_TAG,
  collectPages,
  messageFor,
  parseConfig,
  planSale,
} from "../../extensions/pos-lite/src/logic.js";

export const CONFIG_QUERY = `query PosLiteConfig {
  shop { id metafield(namespace: "${CONFIG_NAMESPACE}", key: "${CONFIG_KEY}") { value } }
}`;

const ORDER_QUERY = `query PosLiteOrder($id: ID!, $linesAfter: String) {
  order(id: $id) {
    id name sourceName createdAt cancelledAt displayFinancialStatus returnStatus tags
    retailLocation { id }
    customAttributes { key value }
    refunds { id }
    shippingAddress { lastName firstName zip provinceCode city address1 address2 phone }
    lineItems(first: 100, after: $linesAfter) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id sku title currentQuantity
        customAttributes { key value }
        originalUnitPriceSet { shopMoney { amount } }
        variant { id }
      }
    }
    fulfillments {
      status
      location { id }
      fulfillmentLineItems(first: 100) {
        pageInfo { hasNextPage }
        nodes { quantity lineItem { id } }
      }
    }
  }
}`;

const FULFILLMENT_ORDERS_QUERY = `query PosLiteFulfillmentOrders($id: ID!, $after: String) {
  order(id: $id) {
    fulfillmentOrders(first: 20, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id status requestStatus
        deliveryMethod { methodType }
        assignedLocation { location { id } }
        lineItems(first: 100) {
          pageInfo { hasNextPage }
          nodes { id remainingQuantity lineItem { id } }
        }
      }
    }
  }
}`;

const ORDER_UPDATE = `mutation PosLiteShippingAddress($input: OrderInput!) {
  orderUpdate(input: $input) { order { id } userErrors { field message } }
}`;
const METAFIELDS_SET = `mutation PosLiteMetafields($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } }
}`;
const MOVE = `mutation PosLiteMove($id: ID!, $newLocationId: ID!, $fulfillmentOrderLineItems: [FulfillmentOrderLineItemInput!]) {
  fulfillmentOrderMove(id: $id, newLocationId: $newLocationId, fulfillmentOrderLineItems: $fulfillmentOrderLineItems) {
    movedFulfillmentOrder { id }
    userErrors { field message }
  }
}`;
const FULFILL = `mutation PosLiteFulfill($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status } userErrors { field message } }
}`;
const TAGS_ADD = `mutation PosLiteTag($id: ID!, $tags: [String!]!) { tagsAdd(id: $id, tags: $tags) { userErrors { field message } } }`;
const TAGS_REMOVE = `mutation PosLiteUntag($id: ID!, $tags: [String!]!) { tagsRemove(id: $id, tags: $tags) { userErrors { field message } } }`;

export const REVIEW_ORDERS_QUERY = `query PosLiteReviewOrders($after: String) {
  orders(first: 50, after: $after, query: "tag:'${REVIEW_TAG}'", sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt
      retailLocation { id name }
      metafield(namespace: "${CONFIG_NAMESPACE}", key: "${REVIEW_KEY}") { value }
    }
  }
}`;

/** admin.graphql を request(query, variables) => data の形にする。GraphQL の errors は理由つきで投げる。 */
export function requestFromAdmin(admin) {
  return async (query, variables = {}) => {
    const response = await admin.graphql(query, { variables });
    const payload = await response.json();
    if (payload?.errors?.length || !payload?.data) {
      const reason = payload?.errors?.[0]?.message || "応答が空";
      throw new Error(`Shopify の API で失敗しました（${String(reason).slice(0, 120)}）`);
    }
    return payload.data;
  };
}

export async function loadConfig(request) {
  const data = await request(CONFIG_QUERY, {});
  return { shopId: data?.shop?.id || null, config: parseConfig(data?.shop?.metafield?.value) };
}

/** 注文を planSale の形で読む（明細・出荷指示は全ページ）。 */
export async function loadSaleOrder(request, orderId) {
  const first = await request(ORDER_QUERY, { id: orderId, linesAfter: null });
  const order = first?.order;
  if (!order) throw new Error("注文が見つかりません。");
  const lineNodes = await collectPages(async (after) =>
    after ? (await request(ORDER_QUERY, { id: orderId, linesAfter: after })).order.lineItems : order.lineItems,
  );
  const foNodes = await collectPages(async (after) =>
    (await request(FULFILLMENT_ORDERS_QUERY, { id: orderId, after })).order.fulfillmentOrders,
  );
  const fulfillmentOrders = foNodes.map((fo) => {
    if (fo.lineItems?.pageInfo?.hasNextPage) throw new Error(messageFor("pagination"));
    return {
      id: fo.id,
      status: fo.status,
      requestStatus: fo.requestStatus,
      method: fo.deliveryMethod?.methodType || "",
      locationId: fo.assignedLocation?.location?.id || "",
      lines: (fo.lineItems?.nodes || []).map((line) => ({
        id: line.id,
        lineItemId: line.lineItem?.id || "",
        remaining: Number(line.remainingQuantity || 0),
      })),
    };
  });
  const fulfillments = (order.fulfillments || [])
    .filter((f) => f.status === "SUCCESS")
    .map((f) => {
      if (f.fulfillmentLineItems?.pageInfo?.hasNextPage) throw new Error(messageFor("pagination"));
      return {
        locationId: f.location?.id || "",
        lines: (f.fulfillmentLineItems?.nodes || []).map((n) => ({ lineItemId: n.lineItem?.id || "", quantity: Number(n.quantity || 0) })),
      };
    });
  return {
    id: order.id,
    name: order.name,
    sourceName: order.sourceName,
    createdAt: order.createdAt,
    cancelledAt: order.cancelledAt,
    displayFinancialStatus: order.displayFinancialStatus,
    returnStatus: order.returnStatus,
    tags: order.tags || [],
    salesLocationId: order.retailLocation?.id || null,
    customAttributes: order.customAttributes || [],
    refundCount: order.refunds?.length || 0,
    shippingAddress: order.shippingAddress || null,
    lines: lineNodes.map((line) => ({
      id: line.id,
      sku: line.sku || "",
      title: line.title || "",
      quantity: Number(line.currentQuantity || 0),
      unitPrice: Number(line.originalUnitPriceSet?.shopMoney?.amount || 0),
      variantId: line.variant?.id || null,
      customAttributes: line.customAttributes || [],
    })),
    fulfillmentOrders,
    fulfillments,
  };
}

async function firstUserError(request, query, variables, key) {
  const data = await request(query, variables);
  const errors = data?.[key]?.userErrors;
  if (!Array.isArray(errors)) return `${key} の結果を確かめられませんでした。`;
  return errors.length ? String(errors[0].message || key) : null;
}

async function applySideEffects(request, order, step) {
  if (step.addressInput) {
    const error = await firstUserError(request, ORDER_UPDATE, { input: step.addressInput }, "orderUpdate");
    if (error) return `配送先を注文に書けませんでした（${error}）`;
  }
  if (step.handoff) {
    const error = await firstUserError(
      request,
      METAFIELDS_SET,
      { metafields: [{ ownerId: order.id, namespace: CONFIG_NAMESPACE, key: HANDOFF_KEY, type: "json", value: JSON.stringify(step.handoff) }] },
      "metafieldsSet",
    );
    if (error) return `配送の記録を注文に書けませんでした（${error}）`;
  }
  return null;
}

/**
 * 1 件の注文を処理する。結果の phase: skip（対象外・何もしない）/ review（人が見る）/ done（済み）。
 * @param {(query: string, variables?: object) => Promise<any>} request
 * @param {string} orderId
 * @param {{config?: object}} [options]
 */
export async function processSale(request, orderId, options = {}) {
  const config = options.config || (await loadConfig(request)).config;
  let order;
  try {
    order = await loadSaleOrder(request, orderId);
  } catch (error) {
    return { phase: "review", reason: "network", message: error instanceof Error ? error.message : messageFor("network"), orderId };
  }
  let step = planSale(order, config);
  if (step.phase === "skip") return { ...step, orderId };
  if (step.phase === "review") return finish(request, order, step);
  try {
    const sideError = await applySideEffects(request, order, step);
    if (sideError) return finish(request, order, { phase: "review", reason: "network", message: sideError });
    if (step.phase === "move") {
      for (const move of step.moves) {
        const error = await firstUserError(request, MOVE, move, "fulfillmentOrderMove");
        if (error) return finish(request, order, { phase: "review", reason: "move", message: `出荷元へ移せませんでした（${error}）。出荷元に商品の在庫の登録があるか確かめてください。` });
      }
      order = await loadSaleOrder(request, orderId);
      step = planSale(order, config);
      if (step.phase === "move") return finish(request, order, { ...step, phase: "review", reason: "move_incomplete", message: messageFor("move_incomplete") });
      if (step.phase !== "fulfill" && step.phase !== "done") return finish(request, order, step);
    }
    for (const fulfill of step.fulfills) {
      const error = await firstUserError(
        request,
        FULFILL,
        { fulfillment: { notifyCustomer: false, lineItemsByFulfillmentOrder: [fulfill] } },
        "fulfillmentCreate",
      );
      if (error) return finish(request, order, { phase: "review", reason: "fulfill", message: `持ち帰り分を履行できませんでした（${error}）` });
    }
    const message = step.storeQuantity ? `持ち帰り ${step.storeQuantity} 点を履行しました。配送分は出荷元に未発送で残しています。` : "配送分を出荷元に移しました。持ち帰りはありません。";
    return finish(request, order, { ...step, phase: "done", message });
  } catch (error) {
    return finish(request, order, { phase: "review", reason: "network", message: error instanceof Error ? error.message : messageFor("network") });
  }
}

/** 結果を注文に残す。要確認はタグと理由、済んだらタグを外す。 */
async function finish(request, order, step) {
  const result = { ...step, orderId: order.id, orderName: order.name };
  try {
    if (step.phase === "review") {
      await request(TAGS_ADD, { id: order.id, tags: [REVIEW_TAG] });
      await request(METAFIELDS_SET, {
        metafields: [{ ownerId: order.id, namespace: CONFIG_NAMESPACE, key: REVIEW_KEY, type: "single_line_text_field", value: String(step.message || messageFor(step.reason)).slice(0, 250) }],
      });
    } else if (step.phase === "done" && (order.tags || []).includes(REVIEW_TAG)) {
      await request(TAGS_REMOVE, { id: order.id, tags: [REVIEW_TAG] });
    }
  } catch (error) {
    result.markError = error instanceof Error ? error.message : "要確認の印を書けませんでした。";
  }
  return result;
}

/** 要確認の注文の一覧（管理画面）。 */
export async function listReviewOrders(request) {
  const nodes = await collectPages(async (after) => (await request(REVIEW_ORDERS_QUERY, { after })).orders);
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    locationName: node.retailLocation?.name || "",
    reason: node.metafield?.value || messageFor(""),
  }));
}

/** 同じ注文を同時に 2 つ処理しない（このサーバーの中だけ。2 台目のサーバーとは planSale の読み直しで重ならないようにしている）。 */
const running = new Map();
export async function withOrderLock(orderId, work) {
  const previous = running.get(orderId) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  running.set(orderId, next);
  try {
    return await next;
  } finally {
    if (running.get(orderId) === next) running.delete(orderId);
  }
}
