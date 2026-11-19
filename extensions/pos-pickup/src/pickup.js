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
