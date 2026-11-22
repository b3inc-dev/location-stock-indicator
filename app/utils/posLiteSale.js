// 会計のあとの配送・持ち帰りの処理（orders/paid と管理画面の再処理）。
// Admin GraphQL を呼ぶ関数 request(query, variables) => data を受け取る形にして、試験で差し替えられるようにする。
// 何度呼んでも安全: いつも注文の今の状態を読み直し、済んだ分を除いて次の 1 歩だけを行う（planSale）。

import {
  CONFIG_KEY,
  CONFIG_NAMESPACE,
  HANDOFF_KEY,
  RESCAN_DAYS,
  REVIEW_KEY,
  REVIEW_TAG,
  collectPages,
  messageFor,
  missedPaidCandidate,
  parseConfig,
  planSale,
  scrubHandoff,
  scrubbedAttributes,
} from "../../extensions/pos-lite/src/logic.js";

export const CONFIG_QUERY = `query PosLiteConfig {
  shop { id metafield(namespace: "${CONFIG_NAMESPACE}", key: "${CONFIG_KEY}") { value } }
}`;

const ORDER_QUERY = `query PosLiteOrder($id: ID!, $linesAfter: String) {
  order(id: $id) {
    id name sourceName createdAt cancelledAt displayFinancialStatus returnStatus tags
    retailLocation { id }
    customAttributes { key value }
    handoff: metafield(namespace: "${CONFIG_NAMESPACE}", key: "${HANDOFF_KEY}") { value }
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
      id status
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
/** 出荷元の数の上限のつもり（1 回に 1 つの出荷元へ移す。これを超えたら要確認で止める）。 */
const MAX_MOVE_ROUNDS = 20;

const CANCEL = `mutation PosLiteCancelFulfillment($id: ID!) {
  fulfillmentCancel(id: $id) { fulfillment { id status } userErrors { field message } }
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
        id: f.id || "",
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
    // 済んだ印（配送の記録の completedAt）。ある注文はもう動かさない
    handoffCompletedAt: completedAtOf(order.handoff?.value),
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

function completedAtOf(raw) {
  try {
    const data = JSON.parse(String(raw || ""));
    return typeof data?.completedAt === "string" && data.completedAt ? data.completedAt : null;
  } catch {
    return null;
  }
}

/** 済んだ印を配送の記録に書く（記録の中身はそのまま、completedAt を足す）。 */
async function markCompleted(request, order, handoff) {
  if (!handoff) return null;
  const value = JSON.stringify({ ...handoff, completedAt: new Date().toISOString() });
  return firstUserError(
    request,
    METAFIELDS_SET,
    { metafields: [{ ownerId: order.id, namespace: CONFIG_NAMESPACE, key: HANDOFF_KEY, type: "json", value }] },
    "metafieldsSet",
  );
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
 * 1 件の注文を処理する。結果の phase:
 *   skip（対象外・何もしない）/ retry（出荷指示がまだ無い。印を付けない）/ review（人が見る）/ done（済み）。
 * 順: 配送先を注文に書く（属性の配送先は外す）→ [店頭の履行を取り消す] → 出荷元へ移す → 持ち帰り分を履行する。
 * どの 1 歩のあとも注文を読み直して次を決めるので、途中で止まっても再処理で続きから進む。
 * @param {(query: string, variables?: object) => Promise<any>} request
 * @param {string} orderId
 * @param {{config?: object, retryAsReview?: boolean, retryReason?: string}} [options]
 *   retryAsReview: 出荷指示を待つときも要確認の印を付ける（Shopify に送り直してもらえない、後ろで処理するとき）。
 *   retryReason: そのときの理由（既定は waiting_fulfillment_orders。送り直しが尽きる前は waiting_exhausted）。
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
  if (step.phase === "skip") {
    // キャンセル・済んだ注文でも、属性に配送先のコピーが残っていれば外す（住所は書かない。外せなくても止めない）
    if (step.addressInput) {
      try {
        await firstUserError(request, ORDER_UPDATE, { input: step.addressInput }, "orderUpdate");
      } catch {
        // 次に来たとき・customers/redact で外す
      }
    }
    // 済んだ注文に要確認の印が残っていれば外す
    if (step.reason === "already_done" && (order.tags || []).includes(REVIEW_TAG)) {
      try {
        await request(TAGS_REMOVE, { id: order.id, tags: [REVIEW_TAG] });
      } catch {
        // 次の再処理で外す
      }
    }
    return { ...step, addressInput: null, orderId, orderName: order.name };
  }
  if (step.phase === "retry") {
    // 待つときは何も書かない（送り直してもらう）。要確認に変えるときは、先に住所を書いて属性のコピーを外す
    if (!options.retryAsReview) return { ...step, orderId, orderName: order.name };
    const review = { ...step, phase: "review", reason: options.retryReason || step.reason, message: messageFor(options.retryReason || step.reason) };
    try {
      const sideError = await applySideEffects(request, order, { ...review, handoff: null });
      if (sideError) return finish(request, order, { phase: "review", reason: "network", message: sideError });
    } catch (error) {
      return finish(request, order, { phase: "review", reason: "network", message: error instanceof Error ? error.message : messageFor("network") });
    }
    return finish(request, order, review);
  }
  try {
    // 配送先の住所は、要確認で止まるときも先に注文へ書き、属性のコピーを外す
    const sideError = await applySideEffects(request, order, step);
    if (sideError) return finish(request, order, { phase: "review", reason: "network", message: sideError });
    if (step.phase === "review") return finish(request, order, step);

    if (step.phase === "cancel") {
      for (const cancel of step.cancels) {
        const error = await firstUserError(request, CANCEL, { id: cancel.id }, "fulfillmentCancel");
        if (error) return finish(request, order, { phase: "review", reason: "cancel", message: `${messageFor("cancel")}（${error}）` });
      }
      order = await loadSaleOrder(request, orderId);
      step = planSale(order, config);
      if (step.phase === "cancel") return finish(request, order, { ...step, phase: "review", reason: "cancel_incomplete", message: messageFor("cancel_incomplete") });
      if (step.phase === "retry") return finish(request, order, { ...step, phase: "review" });
      if (!["move", "fulfill", "done"].includes(step.phase)) return finish(request, order, step);
    }
    // 出荷元が分かれるときは、1 回に 1 つの出荷元の分を移し、読み直して次の出荷元へ（同じ手が続いたら止める）
    let lastMoves = null;
    for (let round = 0; step.phase === "move"; round += 1) {
      const signature = JSON.stringify(step.moves);
      if (round >= MAX_MOVE_ROUNDS || signature === lastMoves) {
        return finish(request, order, { ...step, phase: "review", reason: "move_incomplete", message: messageFor("move_incomplete") });
      }
      lastMoves = signature;
      for (const move of step.moves) {
        const error = await firstUserError(request, MOVE, move, "fulfillmentOrderMove");
        if (error) return finish(request, order, { phase: "review", reason: "move", message: `出荷元へ移せませんでした（${error}）。出荷元に商品の在庫の登録があるか確かめてください。` });
      }
      order = await loadSaleOrder(request, orderId);
      step = planSale(order, config);
    }
    if (step.phase !== "fulfill" && step.phase !== "done") return finish(request, order, step);
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
    // 済んだ印を残す（何度来ても、済んだ注文の履行を取り消さない。見直し 11/23 の 1）
    const markError = await markCompleted(request, order, step.handoff);
    if (markError) return finish(request, order, { phase: "review", reason: "network", message: `済んだ印を注文に書けませんでした（${markError}）。再処理してください。` });
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

// ---------------------------------------------------------------------------
// 拾い直し: orders/paid の処理が、済んだ印も要確認の印も残さずに終わった注文を探す（見直し 7084505690 の 1）
// ---------------------------------------------------------------------------

/**
 * 最近の POS の注文を新しい順に読む。source_name・created_at・tag_not は Shopify の orders の検索の条件の一覧にある
 * （POS の注文の source_name が "pos" で絞れるかは開発ストアで確かめる）。配送の指定はカートの属性なので検索では絞れず、
 * 読んでから missedPaidCandidate で絞る。
 */
export const RESCAN_ORDERS_QUERY = `query PosLiteRescanOrders($after: String, $query: String!) {
  orders(first: 50, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt cancelledAt sourceName tags
      retailLocation { id name }
      customAttributes { key value }
      handoff: metafield(namespace: "${CONFIG_NAMESPACE}", key: "${HANDOFF_KEY}") { value }
    }
  }
}`;
/** 1 回の拾い直しで読む注文の上限（50 件 × 5 ページ）。超えた分は次の回に回さず、truncated で知らせる。 */
export const RESCAN_MAX_PAGES = 5;

/**
 * 拾い直し。何度呼んでも同じ結果になる（印を付けた注文は次から対象にならない）。cron から呼んでも安全なように、
 * 読む件数に上限があり、注文の配送・履行には一切触れない（書くのは要確認のタグと理由だけ）。
 * @param {(query: string, variables?: object) => Promise<any>} request
 * @param {{config: object, now?: number, days?: number}} options
 *   書くのは config.rescanEnabled と config.deliveryEnabled がどちらもオンのときだけ。オフなら探して返すだけ。
 * @returns {Promise<{found: {id: string, name: string, createdAt: string, locationName: string}[], marked: number, failed: number, wrote: boolean, truncated: boolean}>}
 */
export async function rescanMissedOrders(request, { config, now = Date.now(), days = RESCAN_DAYS } = {}) {
  const since = new Date(now - days * 24 * 60 * 60 * 1000).toISOString();
  const query = `source_name:pos created_at:>='${since}' tag_not:'${REVIEW_TAG}'`;
  const found = [];
  let after = null;
  let truncated = false;
  for (let page = 0; ; page += 1) {
    if (page >= RESCAN_MAX_PAGES) {
      truncated = true;
      break;
    }
    const conn = (await request(RESCAN_ORDERS_QUERY, { after, query }))?.orders;
    for (const node of conn?.nodes || []) {
      const order = { ...node, handoff: node.handoff?.value ?? null };
      if (missedPaidCandidate(order, now)) {
        found.push({ id: node.id, name: node.name, createdAt: node.createdAt, locationName: node.retailLocation?.name || "" });
      }
    }
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break;
    after = conn.pageInfo.endCursor;
  }
  const wrote = config?.rescanEnabled === true && config?.deliveryEnabled === true;
  let marked = 0;
  let failed = 0;
  if (wrote) {
    for (const order of found) {
      try {
        // 理由を先に書き、タグはあと（タグが付けば一覧に出る。タグを付けられなければ次の拾い直しでもう一度試す）
        const reasonError = await firstUserError(
          request,
          METAFIELDS_SET,
          { metafields: [{ ownerId: order.id, namespace: CONFIG_NAMESPACE, key: REVIEW_KEY, type: "single_line_text_field", value: messageFor("missed_paid").slice(0, 250) }] },
          "metafieldsSet",
        );
        const tagError = reasonError ? null : await firstUserError(request, TAGS_ADD, { id: order.id, tags: [REVIEW_TAG] }, "tagsAdd");
        if (reasonError || tagError) failed += 1;
        else marked += 1;
      } catch {
        failed += 1;
      }
    }
  }
  return { found, marked, failed, wrote, truncated };
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

// ---------------------------------------------------------------------------
// orders/paid: 先に短く確かめて返し、重い処理は後ろで行う（Shopify の 5 秒の内に返す）
// ---------------------------------------------------------------------------

const PAID_PRECHECK_QUERY = `query PosLitePaidPrecheck($id: ID!) {
  shop { metafield(namespace: "${CONFIG_NAMESPACE}", key: "${CONFIG_KEY}") { value } }
  order(id: $id) {
    id
    fulfillmentOrders(first: 1) { nodes { id } }
    fulfillments(first: 1) { id }
  }
}`;

/**
 * orders/paid で最初に 1 回だけ呼ぶ。
 * @returns {Promise<{action: "ignore"|"retry"|"process", config: object}>}
 *   ignore: スイッチがオフ / retry: 出荷指示がまだ無い（500 を返して送り直してもらう）/ process: 後ろで処理する
 */
export async function precheckPaid(request, orderId) {
  const data = await request(PAID_PRECHECK_QUERY, { id: orderId });
  const config = parseConfig(data?.shop?.metafield?.value);
  if (!config.deliveryEnabled) return { action: "ignore", config };
  const order = data?.order;
  if (!order) return { action: "retry", config };
  const hasFo = (order.fulfillmentOrders?.nodes || []).length > 0;
  const hasFulfillment = (order.fulfillments || []).length > 0;
  return { action: hasFo || hasFulfillment ? "process" : "retry", config };
}

/**
 * Shopify の送り直し（8 回・約 4 時間）が尽きる前か。最初に送られた時刻（X-Shopify-Triggered-At）から 3 時間を過ぎたら true。
 * 尽きる前に「待ち」をやめて要確認の印を付ける（印も記録も無いまま消えないように。見直し 11/23 の 3）。読めない時刻は false。
 */
export const WAIT_LIMIT_MS = 3 * 60 * 60 * 1000;
export function retriesNearlyExhausted(triggeredAt, now = Date.now()) {
  const at = Date.parse(String(triggeredAt || ""));
  if (!Number.isFinite(at)) return false;
  return now - at >= WAIT_LIMIT_MS;
}

/**
 * 後ろで処理する（応答を返したあと）。失敗しても投げない。結果は注文の印と記録に残す。
 * @param {{request: Function, orderId: string, config: object, allowed: () => Promise<boolean>, lockKey: string, log?: Function}} args
 */
export async function processPaidInBackground({ request, orderId, config, allowed, lockKey, log = console.log, retryReason }) {
  try {
    if (!(await allowed())) return { phase: "skip", reason: "plan", orderId };
    const result = await withOrderLock(lockKey, () => processSale(request, orderId, { config, retryAsReview: true, retryReason }));
    // 顧客の値（住所など）は記録に出さない。注文の ID と結果だけ
    log("[location-stock] pos-lite sale", { orderId, phase: result.phase, reason: result.reason || null });
    return result;
  } catch (error) {
    log("[location-stock] pos-lite sale failed", { orderId }, error instanceof Error ? error.message : "failed");
    return { phase: "review", reason: "network", orderId };
  }
}

// ---------------------------------------------------------------------------
// customers/redact: 注文に残したアプリのコピーから配送先を消す
// ---------------------------------------------------------------------------

const REDACT_ORDER_QUERY = `query PosLiteRedactOrder($id: ID!) {
  order(id: $id) {
    id
    customAttributes { key value }
    metafield(namespace: "${CONFIG_NAMESPACE}", key: "${HANDOFF_KEY}") { value }
  }
}`;
const REDACT_ATTRIBUTES = `mutation PosLiteRedactAttributes($input: OrderInput!) {
  orderUpdate(input: $input) { order { id } userErrors { field message } }
}`;

/**
 * お客様の削除の依頼（customers/redact の orders_to_redact）の注文から、
 * カートの属性 _lsi_delivery の配送先と、配送の記録の配送先（前の版の destination）を消す。
 * 注文そのものの配送先住所は Shopify の持ち物なので触らない。何度呼んでも同じ結果になる。
 * 1 件でも消せなければ投げる（500 にして、Shopify にもう一度送ってもらう）。
 * @param {(query: string, variables?: object) => Promise<any>} request
 * @param {Array<string|number>} orderIds
 */
export async function redactPosLiteOrders(request, orderIds) {
  let scrubbed = 0;
  for (const raw of Array.isArray(orderIds) ? orderIds : []) {
    const id = String(raw).startsWith("gid://") ? String(raw) : `gid://shopify/Order/${String(raw).replace(/\D/g, "")}`;
    if (!/^gid:\/\/shopify\/Order\/\d+$/.test(id)) continue;
    let data;
    try {
      data = await request(REDACT_ORDER_QUERY, { id });
    } catch (error) {
      // 注文を読む権限（read_orders）をまだ承認していない店は、POS Lite の配送を使えていないので消すものが無い
      if (/access denied|ACCESS_DENIED|read_orders/i.test(error instanceof Error ? error.message : "")) return { scrubbed, skipped: "no_access" };
      throw error;
    }
    const order = data?.order;
    if (!order) continue;
    const attributes = scrubbedAttributes(order.customAttributes);
    if (attributes) {
      const error = await firstUserError(request, REDACT_ATTRIBUTES, { input: { id, customAttributes: attributes } }, "orderUpdate");
      if (error) throw new Error(`注文の属性から配送先を消せませんでした（${error}）`);
      scrubbed += 1;
    }
    const handoff = scrubHandoff(order.metafield?.value);
    if (handoff) {
      const error = await firstUserError(
        request,
        METAFIELDS_SET,
        { metafields: [{ ownerId: id, namespace: CONFIG_NAMESPACE, key: HANDOFF_KEY, type: "json", value: handoff }] },
        "metafieldsSet",
      );
      if (error) throw new Error(`配送の記録から配送先を消せませんでした（${error}）`);
      scrubbed += 1;
    }
  }
  return { scrubbed };
}
