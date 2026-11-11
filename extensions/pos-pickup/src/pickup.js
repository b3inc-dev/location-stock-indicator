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
