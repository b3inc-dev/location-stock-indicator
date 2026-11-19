import {accessFromInstallation, POS_ACCESS_QUERY} from "./logic.js";
import {adminRequest} from "./admin.js";

const DENIED = "この機能は Pro プランで利用できます。";

export async function loadPosAccess() {
  const data = await adminRequest(POS_ACCESS_QUERY, {});
  return accessFromInstallation({
    apiKey: data.currentAppInstallation?.app?.apiKey,
    partnerDevelopment: data.shop?.plan?.partnerDevelopment,
    subscriptions: data.currentAppInstallation?.activeSubscriptions,
  });
}

export async function requirePosAccess() {
  const access = await loadPosAccess();
  if (!access.allowed) {
    const error = new Error(DENIED);
    error.code = "plan";
    throw error;
  }
  return access;
}

export {DENIED};
