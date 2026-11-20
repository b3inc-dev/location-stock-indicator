/**
 * ロケーションの「表示チェック」と、商品ページに出るかを分ける。
 * enabled === false は App Proxy で除外される。
 * online_only / custom_from_app は、残った行をスニペット filterLocations がさらに落とす。
 */

const LOCATIONS_MODES = ["all", "online_only", "custom_from_app"];

export function normalizeLocationsMode(mode) {
  return LOCATIONS_MODES.includes(mode) ? mode : "all";
}

/**
 * @returns {"shown" | "hidden" | "excluded_by_mode"}
 */
export function classifyLocationVisibility({
  enabled,
  fromConfig,
  fulfillsOnlineOrders,
  locationsMode,
}) {
  if (enabled === false) return "hidden";
  const mode = normalizeLocationsMode(locationsMode);
  if (mode === "online_only" && !fulfillsOnlineOrders) return "excluded_by_mode";
  if (mode === "custom_from_app" && !fromConfig) return "excluded_by_mode";
  return "shown";
}

export function exclusionReason(state, locationsMode) {
  if (state !== "excluded_by_mode") return "";
  const mode = normalizeLocationsMode(locationsMode);
  if (mode === "online_only") {
    return "表示はオンですが、オンライン注文を履行しないため商品ページには出ません。";
  }
  if (mode === "custom_from_app") {
    return "表示はオンですが、保存済みの設定に含まれないため商品ページには出ません。";
  }
  return "現在の表示モードでは商品ページに出ません。";
}

export function locationsModeNote(locationsMode) {
  const mode = normalizeLocationsMode(locationsMode);
  if (mode === "online_only") {
    return "「表示」かつオンライン注文を履行する店舗だけが商品ページに出ます。履行しない店舗は「対象外」です。";
  }
  if (mode === "custom_from_app") {
    return "保存済みの設定に含まれ、「表示」になっている店舗だけが商品ページに出ます。設定に無い店舗は「対象外」です。";
  }
  return "「表示」の店舗が商品ページの対象です。";
}

/** ロケーション一覧は保存時に読み込んだ全行を config に書く。バッジはその保存後の状態。 */
export function locationsModeDraftNote(locationsMode) {
  const mode = normalizeLocationsMode(locationsMode);
  if (mode === "online_only") {
    return "表示状態は、この一覧を保存したあとの商品ページです。チェックがオンで、オンライン注文を履行する店舗だけが出ます。";
  }
  if (mode === "custom_from_app") {
    return "表示状態は、この一覧を保存したあとの商品ページです。保存すると一覧の全店舗が設定に入るので、チェックがオンの店舗が対象です。";
  }
  return "表示状態は、この一覧を保存したあとの商品ページです。チェックがオンの店舗が対象です。";
}

export function locationsModeLabel(locationsMode) {
  const mode = normalizeLocationsMode(locationsMode);
  if (mode === "online_only") return "オンライン注文を履行するロケーションのみ";
  if (mode === "custom_from_app") return "アプリで設定したもののみ";
  return "すべてのロケーション";
}

/**
 * 管理画面の編集可否。プロキシの isProFeaturesAllowed と揃える。
 * 自社版と開発ストアは Pro 相当。公開版 Lite / 未選択はエリア・近隣除外を編集しない。
 */
export function describeDistributionEditing(shopPlan) {
  if (!shopPlan) {
    return "プラン情報がないため、エリアと近隣除外は編集できません。";
  }
  if (shopPlan.distribution === "inhouse") {
    return "自社版です。表示のオンオフ、エリア、近隣除外を編集できます。";
  }
  if (shopPlan.isDevelopmentStore) {
    return "開発ストアです。表示のオンオフ、エリア、近隣除外を編集できます。";
  }
  if (shopPlan.plan === "pro") {
    return "公開版 Pro です。表示のオンオフ、エリア、近隣除外を編集できます。";
  }
  if (shopPlan.plan === "lite") {
    return "公開版 Lite です。表示のオンオフは編集できます。エリアと近隣除外は編集できません。";
  }
  return "公開版でプランが未選択です。表示のオンオフは編集できます。エリアと近隣除外は編集できません。";
}

export function buildStoreVisibility(locations, config) {
  const locationsConfig = Array.isArray(config?.locations) ? config.locations : [];
  const byId = new Map();
  locationsConfig.forEach((cfg) => {
    if (cfg && cfg.locationId) byId.set(cfg.locationId, cfg);
  });
  const locationsMode = normalizeLocationsMode(config?.locationsMode);
  const usePublicName = typeof config?.usePublicName === "boolean" ? config.usePublicName : true;
  const items = (Array.isArray(locations) ? locations : []).map((loc) => {
    const cfg = byId.get(loc?.id);
    const enabled = cfg ? cfg.enabled !== false : true;
    const fromConfig = !!cfg;
    const publicName = cfg && typeof cfg.publicName === "string" ? cfg.publicName.trim() : "";
    const state = classifyLocationVisibility({
      enabled,
      fromConfig,
      fulfillsOnlineOrders: !!loc?.fulfillsOnlineOrders,
      locationsMode,
    });
    return {
      id: loc?.id ?? "",
      name: loc?.name || "",
      publicName,
      usePublicName,
      state,
    };
  });
  return { locationsMode, usePublicName, items };
}

export function filterLocationRows(rows, {
  query = "",
  filter = "all",
  locationsMode = "all",
  savedLocationsMode,
  draft = false,
} = {}) {
  const q = String(query || "").trim().toLowerCase();
  const mode = normalizeLocationsMode(locationsMode);
  const publishedMode = normalizeLocationsMode(savedLocationsMode ?? locationsMode);
  const matched = (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!q) return true;
    const name = String(row?.shopifyName || "").toLowerCase();
    const pub = String(row?.publicName || "").toLowerCase();
    return name.includes(q) || pub.includes(q);
  });
  const counts = { all: matched.length, shown: 0, hidden: 0, excluded_by_mode: 0 };
  const decorated = matched.map((row) => {
    const enabled = row?.enabled !== false;
    const state = classifyLocationVisibility({
      enabled,
      // 一覧の保存は読み込んだ全行を config に書く。下書きの表示は保存後に合わせる。
      fromConfig: draft ? true : !!row?.fromConfig,
      fulfillsOnlineOrders: !!row?.fulfillsOnlineOrders,
      locationsMode: mode,
    });
    const savedState = classifyLocationVisibility({
      enabled: typeof row?.savedEnabled === "boolean" ? row.savedEnabled : enabled,
      fromConfig: !!row?.fromConfig,
      fulfillsOnlineOrders: !!row?.fulfillsOnlineOrders,
      locationsMode: publishedMode,
    });
    counts[state] += 1;
    return { row, state, savedState };
  });
  const visible =
    filter === "shown" || filter === "hidden" || filter === "excluded_by_mode"
      ? decorated.filter((item) => item.state === filter)
      : decorated;
  return { counts, visible };
}
