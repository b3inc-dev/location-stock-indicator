import prisma from "../db.server";
import {unauthenticated} from "../shopify.server";
import {distributionForShop} from "./shopPlan.server.js";
import {claimDecision, claimState, reprocessSale} from "../../extensions/pos-pickup/src/logic.js";

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

export async function processPaidOrder({shop, webhookId, orderId, staffMemberId, repo, request}) {
  const existing = await repo.get(webhookId);
  const decision = claimDecision(existing);
  if (decision === "stop") return {state: existing.state};
  if (decision === "start") {
    try {
      await repo.start({id: webhookId, shop, orderId, state: "processing"});
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      const raced = await repo.get(webhookId);
      if (claimDecision(raced) === "stop") return {state: raced.state};
    }
  }
  if (distributionForShop(shop) !== "inhouse") {
    await repo.finish(webhookId, {state: "skipped", reason: "public", orderId});
    return {state: "skipped"};
  }
  const result = await reprocessSale(request, orderId, staffMemberId);
  const state = claimState(result.phase);
  await repo.finish(webhookId, {state, reason: result.reason || null, orderId});
  return {state, result};
}

export async function adminForShop(shop) {
  const {admin} = await unauthenticated.admin(shop);
  return graphql(admin);
}
