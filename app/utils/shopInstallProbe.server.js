// probeShopStillInstalled を本物のセッション保存先と Admin API につなぐ。
import { sessionStorage, unauthenticated } from "../shopify.server";
import { INSTALL_PROBE_QUERY, probeShopStillInstalled } from "./shopInstallProbe.js";

export async function isShopStillInstalled(shop) {
  return probeShopStillInstalled({
    shop,
    findOfflineSession: async (s) => {
      const sessions = (await sessionStorage.findSessionsByShop(s)) ?? [];
      return sessions.find((session) => !session.isOnline) ?? null;
    },
    runProbeQuery: async (s) => {
      const { admin } = await unauthenticated.admin(s);
      const resp = await admin.graphql(INSTALL_PROBE_QUERY);
      const body = await resp.json();
      if (!body?.data?.shop?.id) {
        const err = new Error(`install probe returned no shop: ${JSON.stringify(body?.errors ?? null)}`);
        throw err;
      }
      return body;
    },
  });
}
