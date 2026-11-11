import prisma from "../db.server";
import {unauthenticated} from "../shopify.server";
import {distributionForShop} from "./shopPlan.server.js";
import {ORDER_LOCK_STALE_MS, coordinatePaidOrder, coordinateRetry, reprocessSale} from "../../extensions/pos-pickup/src/logic.js";

function graphql(admin) {
  return async (query, variables) => {
    const response = await admin.graphql(query, {variables});
    const payload = await response.json();
    if (payload.errors?.length || !payload.data) throw new Error("注文の参照に失敗しました。");
    return payload.data;
  };
}

export function prismaClaimRepo(db = prisma) {
  return {
    get: (id) => db.posWebhookClaim.findUnique({where: {id}}),
    start: (data) => db.posWebhookClaim.create({data}),
    finish: (id, data) => db.posWebhookClaim.update({where: {id}, data}),
  };
}

export function prismaOrderLockRepo(db = prisma) {
  return {
    get: (id) => db.posOrderLock.findUnique({where: {id}}),
    create: (data) => db.posOrderLock.create({data}),
    takeover: async (id, owner, staleBefore) => {
      const result = await db.posOrderLock.updateMany({
        where: {id, updatedAt: {lte: staleBefore}},
        data: {owner},
      });
      return result.count;
    },
    release: (id, owner) => db.posOrderLock.deleteMany({where: {id, owner}}),
  };
}

export async function processPaidOrder({shop, webhookId, orderId, staffMemberId, repo, locks, request, now = Date.now()}) {
  return coordinatePaidOrder({
    repo,
    locks,
    shop,
    webhookId,
    orderId,
    owner: webhookId,
    now,
    staleMs: ORDER_LOCK_STALE_MS,
    distribution: distributionForShop(shop),
    work: () => reprocessSale(request, orderId, staffMemberId),
  });
}

export async function retryPaidOrder({shop, orderId, owner, locks, request, now = Date.now()}) {
  if (distributionForShop(shop) !== "inhouse") return {state: "skipped"};
  return coordinateRetry({
    locks,
    shop,
    orderId,
    owner,
    now,
    staleMs: ORDER_LOCK_STALE_MS,
    work: () => reprocessSale(request, orderId),
  });
}

export async function adminForShop(shop) {
  const {admin} = await unauthenticated.admin(shop);
  return graphql(admin);
}
