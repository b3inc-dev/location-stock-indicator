/**
 * Admin UI locale helpers.
 * Locale rule: inhouse → ja, otherwise → en (App Store public).
 */

import { adminMessages } from "./adminMessages.js";

/**
 * @param {{ distribution?: string } | null | undefined} shopPlan
 * @returns {"en"|"ja"}
 */
export function resolveAdminLocale(shopPlan) {
  return shopPlan?.distribution === "inhouse" ? "ja" : "en";
}

/**
 * Dot-key lookup with {var} interpolation.
 * @param {"en"|"ja"|string} locale
 * @returns {(key: string, vars?: Record<string, string|number>) => string}
 */
export function createT(locale) {
  const dict = adminMessages[locale] || adminMessages.en;
  const fallback = adminMessages.en;

  return function t(key, vars) {
    const parts = String(key || "").split(".");
    let cur = dict;
    for (const p of parts) {
      if (cur == null || typeof cur !== "object") {
        cur = undefined;
        break;
      }
      cur = cur[p];
    }
    if (typeof cur !== "string") {
      let fb = fallback;
      for (const p of parts) {
        if (fb == null || typeof fb !== "object") {
          fb = undefined;
          break;
        }
        fb = fb[p];
      }
      cur = typeof fb === "string" ? fb : key;
    }
    if (!vars) return cur;
    return cur.replace(/\{(\w+)\}/g, (_, name) =>
      vars[name] != null ? String(vars[name]) : `{${name}}`
    );
  };
}

/**
 * Locale-aware metafield / storefront config defaults (only when empty).
 * Existing saved metafield values must not be overwritten by callers.
 * @param {"en"|"ja"|string} locale
 */
export function getStorefrontConfigDefaults(locale) {
  const t = createT(locale);
  return {
    quantityLabel: t("defaults.quantityLabel"),
    labels: {
      inStock: t("defaults.labels.inStock"),
      lowStock: t("defaults.labels.lowStock"),
      outOfStock: t("defaults.labels.outOfStock"),
    },
    messages: {
      loading: t("defaults.messages.loading"),
      empty: t("defaults.messages.empty"),
      error: t("defaults.messages.error"),
    },
    orderPickButtonLabel: t("defaults.orderPickButtonLabel"),
    orderPickAddedLabel: t("defaults.orderPickAddedLabel"),
    orderPickOutOfStockLabel: t("defaults.orderPickOutOfStockLabel"),
    orderPickModalTitle: t("defaults.orderPickModalTitle"),
    orderPickModalBody: t("defaults.orderPickModalBody"),
    regionUnsetLabel: t("defaults.regionUnsetLabel"),
    newRegionGroupName: t("defaults.newRegionGroupName"),
  };
}
