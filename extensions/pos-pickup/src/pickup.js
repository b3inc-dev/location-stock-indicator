import {pickupAction, pickupMail} from "./logic.js";

const ordersQuery = `query PickupQueue($filter: String!, $after: String) {
  fulfillmentOrders(first: 50, query: $filter, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id orderName status deliveryMethod { methodType } assignedLocation { location { id } } }
  }
}`;

export async function pickupOrders(locationId, request) {
  const id = String(locationId);
  if (!/^[1-9]\d*$/.test(id)) throw new Error("POSの店舗を確認してください。");
  const filter = "assigned_location_id:" + id + " AND (status:open OR status:in_progress OR status:on_hold OR status:scheduled)";
  const result = new Map();
  const cursors = new Set();
  let after = null;
  for (;;) {
    const {fulfillmentOrders: page} = await request(ordersQuery, {filter, after});
    for (const row of page.nodes) {
      if (row.deliveryMethod?.methodType === "PICK_UP" &&
          row.assignedLocation.location?.id === "gid://shopify/Location/" + id &&
          ["OPEN", "IN_PROGRESS", "ON_HOLD", "SCHEDULED"].includes(row.status)) {
        result.set(row.id, row);
      }
    }
    if (!page.pageInfo.hasNextPage) return [...result.values()];
    after = page.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("一覧を更新してください。");
    cursors.add(after);
  }
}

const detailsQuery = `query PickupDetails($id: ID!, $after: String) {
  fulfillmentOrder(id: $id) {
    status updatedAt assignedLocation { location { id } } deliveryMethod { methodType }
    lineItems(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id productTitle variantTitle sku remainingQuantity }
    }
  }
}`;

export async function pickupDetails(orderId, locationId, request) {
  const result = new Map();
  const cursors = new Set();
  let after = null;
  let revision;
  for (;;) {
    const {fulfillmentOrder: order} = await request(detailsQuery, {id: orderId, after});
    if (!order || order.deliveryMethod?.methodType !== "PICK_UP" ||
        order.assignedLocation.location?.id !== "gid://shopify/Location/" + locationId ||
        !["OPEN", "IN_PROGRESS", "ON_HOLD", "SCHEDULED"].includes(order.status) ||
        (revision && revision !== order.updatedAt)) {
      throw new Error("受取注文が変更されました。一覧を更新してください。");
    }
    revision = order.updatedAt;
    for (const item of order.lineItems.nodes) {
      if (item.remainingQuantity > 0) result.set(item.id, item);
    }
    if (!order.lineItems.pageInfo.hasNextPage) return [...result.values()];
    after = order.lineItems.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("明細を再取得してください。");
    cursors.add(after);
  }
}

const actionQuery = `query PickupAction($id: ID!, $after: String) {
  fulfillmentOrder(id: $id) {
    status requestStatus
    order { displayFulfillmentStatus }
    deliveryMethod { methodType }
    assignedLocation { location { id } }
    supportedActions { action }
    lineItems(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id remainingQuantity }
    }
  }
}`;

const prepareMutation = `mutation PreparePickup($input: FulfillmentOrderLineItemsPreparedForPickupInput!) {
  fulfillmentOrderLineItemsPreparedForPickup(input: $input) { userErrors { field message } }
}`;

const completeMutation = `mutation CompletePickup($fulfillment: FulfillmentInput!) {
  fulfillmentCreate(fulfillment: $fulfillment) {
    fulfillment { id status }
    userErrors { field message }
  }
}`;

async function loadPickupAction(request, orderId, locationId) {
  const lines = [];
  const cursors = new Set();
  let after = null;
  let order;
  for (;;) {
    const data = await request(actionQuery, {id: orderId, after});
    order = data.fulfillmentOrder;
    if (!order) return null;
    lines.push(...order.lineItems.nodes);
    if (!order.lineItems.pageInfo.hasNextPage) break;
    after = order.lineItems.pageInfo.endCursor;
    if (!after || cursors.has(after)) throw new Error("明細を再取得してください。");
    cursors.add(after);
  }
  return {
    locationOk: order.assignedLocation?.location?.id === "gid://shopify/Location/" + locationId,
    method: order.deliveryMethod?.methodType,
    status: order.status,
    requestStatus: order.requestStatus,
    displayFulfillmentStatus: order.order?.displayFulfillmentStatus,
    supportedActions: (order.supportedActions || []).map((item) => item.action),
    lines: lines.map((line) => ({id: line.id, remaining: line.remainingQuantity})),
  };
}

async function mutateOnce(request, orderId, locationId, intent) {
  const order = await loadPickupAction(request, orderId, locationId);
  const decision = pickupAction({...order, intent});
  if (decision.error) throw new Error(decision.error);
  if (decision.already) return decision;
  if (intent === "prepare") {
    const data = await request(prepareMutation, {
      input: {lineItemsByFulfillmentOrder: [{fulfillmentOrderId: orderId, fulfillmentOrderLineItems: decision.lineItems}]},
    });
    const errors = data.fulfillmentOrderLineItemsPreparedForPickup?.userErrors || [];
    if (errors.length) throw new Error(errors[0].message || "準備完了を更新できませんでした。");
    return {status: "prepared", mail: pickupMail.prepare};
  }
  const data = await request(completeMutation, {
    fulfillment: {
      notifyCustomer: pickupMail.complete.notifyCustomer,
      lineItemsByFulfillmentOrder: [{fulfillmentOrderId: orderId, fulfillmentOrderLineItems: decision.lineItems}],
    },
  });
  const errors = data.fulfillmentCreate?.userErrors || [];
  if (errors.length) throw new Error(errors[0].message || "引渡完了を更新できませんでした。");
  return {status: "fulfilled", mail: pickupMail.complete, observed: pickupMail.observed};
}

async function withReload(request, orderId, locationId, intent) {
  try {
    return await mutateOnce(request, orderId, locationId, intent);
  } catch (error) {
    const order = await loadPickupAction(request, orderId, locationId).catch(() => null);
    const decision = order ? pickupAction({...order, intent}) : null;
    if (decision?.already) return decision;
    throw error;
  }
}

export function preparePickup(orderId, locationId, request) {
  return withReload(request, orderId, locationId, "prepare");
}

export function completePickup(orderId, locationId, request) {
  return withReload(request, orderId, locationId, "complete");
}
