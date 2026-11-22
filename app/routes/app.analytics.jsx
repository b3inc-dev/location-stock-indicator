// app/routes/app.analytics.jsx

import { useState, useMemo, useCallback } from "react";
import { useLoaderData, useOutletContext } from "react-router";
import { PickList, PrimaryLink, StatusBanner } from "../components/admin-ui";
import { authenticate } from "../shopify.server";
import { getAnalyticsDailyData } from "../analytics.server";

/**
 * 分析ページ用: shop と locations を1クエリで取得（app.locations と同じ形式で構文エラーを防ぐ）。
 */
const ANALYTICS_LOADER_QUERY = `#graphql
  query AnalyticsLoader {
    shop {
      id
    }
    locations(first: 100) {
      nodes {
        id
        name
      }
    }
  }
`;

function getDefaultLoaderRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 89);
  const y = (d) => d.getFullYear();
  const m = (d) => String(d.getMonth() + 1).padStart(2, "0");
  const day = (d) => String(d.getDate()).padStart(2, "0");
  return {
    startStr: `${y(start)}-${m(start)}-${day(start)}`,
    endStr: `${y(end)}-${m(end)}-${day(end)}`,
  };
}

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);

  const range = getDefaultLoaderRange();
  let locations = [];
  let dailyData = [];

  try {
    const gqlResponse = await admin.graphql(ANALYTICS_LOADER_QUERY);
    const result = await gqlResponse.json();

    if (result?.errors?.length) {
      console.error("[app.analytics] GraphQL errors:", result.errors);
      return { locations: [], dailyData: [] };
    }

    const shopId = result?.data?.shop?.id;
    const nodes = result?.data?.locations?.nodes ?? [];
    locations = nodes.map((loc) => ({ id: loc.id, name: loc.name }));

    if (shopId) {
      dailyData = await getAnalyticsDailyData(admin, shopId, range.startStr, range.endStr);
    }
  } catch (err) {
    console.error("[app.analytics] loader error:", err);
    return { locations: [], dailyData: [] };
  }

  return {
    locations,
    dailyData,
  };
}

function formatDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${m}/${d}`;
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return { startStr: formatDateKey(start), endStr: formatDateKey(end) };
}

/** CSV のセルをエスケープ（ダブルクォートは二重に） */
function csvEscape(str) {
  const s = String(str ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export default function AppAnalytics() {
  const { locations, dailyData: initialDailyData } = useLoaderData();
  const outletContext = useOutletContext();
  const shopPlan = outletContext?.shopPlan ?? null;
  const isPro = shopPlan?.distribution === "inhouse" || shopPlan?.plan === "pro";

  if (!isPro && shopPlan?.distribution === "public") {
    return (
      <s-page heading="分析">
        <div className="Admin-body">
          <div className="Admin-card" style={{ maxWidth: "560px" }}>
            <div className="Admin-title">分析は Pro プランでご利用いただけます</div>
            <p className="Admin-note" style={{ margin: "0 0 16px" }}>
              エリア表示回数・近隣店舗クリック・店舗受け取りボタンクリックなどの分析機能は、Pro プランにアップグレードするとご利用できます。
            </p>
            {/* 文字だけのリンクにせず、共通のボタンにする（UI ルール v1.1 4章） */}
            <PrimaryLink to="/app/plan">料金プランを見る</PrimaryLink>
          </div>
        </div>
      </s-page>
    );
  }

  const [startDate, setStartDate] = useState(() => getDefaultDateRange().startStr);
  const [endDate, setEndDate] = useState(() => getDefaultDateRange().endStr);
  // 空 = 全て選択。ロケーションIDの Set で「選択中」を表す（空なら全ロケーション表示）
  const [selectedLocationIds, setSelectedLocationIds] = useState(() => new Set());

  const dailyData = useMemo(() => {
    return initialDailyData
      .filter((row) => row.date >= startDate && row.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [initialDailyData, startDate, endDate]);

  // 表示するロケーション（「全て」選択時は全件、それ以外は選択した ID のみ）
  const filteredLocations = useMemo(() => {
    if (selectedLocationIds.size === 0) return locations;
    return locations.filter((loc) => selectedLocationIds.has(loc.id));
  }, [locations, selectedLocationIds]);

  const totals = useMemo(() => {
    const t = {
      areaDisplayCount: 0,
      nearbyDisplayByLocation: {},
      orderPickByLocation: {},
    };
    for (const row of dailyData) {
      t.areaDisplayCount += row.areaDisplayCount ?? 0;
      for (const [locId, count] of Object.entries(row.nearbyDisplayByLocation ?? {})) {
        t.nearbyDisplayByLocation[locId] = (t.nearbyDisplayByLocation[locId] ?? 0) + count;
      }
      for (const [locId, count] of Object.entries(row.orderPickByLocation ?? {})) {
        t.orderPickByLocation[locId] = (t.orderPickByLocation[locId] ?? 0) + count;
      }
    }
    return t;
  }, [dailyData]);

  // 1 日分の記録の上限のため、ロケーション別に足せなかった件数（黙って捨てずに画面に出す）
  const sizeLimitSkipped = useMemo(() => {
    const days = dailyData.filter((row) => (row.sizeLimitSkippedCount ?? 0) > 0);
    return {
      count: days.reduce((sum, row) => sum + row.sizeLimitSkippedCount, 0),
      days: days.map((row) => formatDisplayDate(row.date)),
    };
  }, [dailyData]);

  // 選択ロケーションのみの合計：近隣店舗クリック数・店舗受け取りボタンクリック数（合計行用）
  const nearbyClickTotal = useMemo(() => {
    return filteredLocations.reduce((sum, loc) => sum + (totals.nearbyDisplayByLocation[loc.id] ?? 0), 0);
  }, [filteredLocations, totals.nearbyDisplayByLocation]);
  const orderPickClickTotal = useMemo(() => {
    return filteredLocations.reduce((sum, loc) => sum + (totals.orderPickByLocation[loc.id] ?? 0), 0);
  }, [filteredLocations, totals.orderPickByLocation]);

  const handleDownloadCSV = useCallback(() => {
    const headers = [
      "日付",
      "エリア表示回数",
      "近隣店舗クリック数",
      ...filteredLocations.map((loc) => `${loc.name} 表示`),
      "店舗受け取りボタンクリック数",
      ...filteredLocations.map((loc) => `${loc.name} クリック`),
    ];
    const rows = [];

    const toNearbyTotal = (row) =>
      filteredLocations.reduce((s, loc) => s + (row.nearbyDisplayByLocation?.[loc.id] ?? 0), 0);
    const toOrderPickTotal = (row) =>
      filteredLocations.reduce((s, loc) => s + (row.orderPickByLocation?.[loc.id] ?? 0), 0);

    rows.push([
      "合計",
      totals.areaDisplayCount,
      nearbyClickTotal,
      ...filteredLocations.map((loc) => totals.nearbyDisplayByLocation[loc.id] ?? 0),
      orderPickClickTotal,
      ...filteredLocations.map((loc) => totals.orderPickByLocation[loc.id] ?? 0),
    ]);
    dailyData.forEach((row) => {
      rows.push([
        formatDisplayDate(row.date),
        row.areaDisplayCount ?? 0,
        toNearbyTotal(row),
        ...filteredLocations.map((loc) => row.nearbyDisplayByLocation?.[loc.id] ?? 0),
        toOrderPickTotal(row),
        ...filteredLocations.map((loc) => row.orderPickByLocation?.[loc.id] ?? 0),
      ]);
    });

    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => csvEscape(cell)).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `分析_${startDate}_${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [
    filteredLocations,
    totals,
    dailyData,
    nearbyClickTotal,
    orderPickClickTotal,
    startDate,
    endDate,
  ]);

  const cell = { padding: "10px 12px" };

  return (
    <s-page heading="分析">
      <div className="Admin-body" style={{ paddingBottom: "40px" }}>
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* 左: フィルター */}
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div className="Admin-title">分析</div>
            <p className="Admin-note" style={{ margin: "0 0 16px" }}>
              期間とロケーションで絞り込みます。選択したロケーションの合計が「近隣店舗クリック数」「店舗受け取りボタンクリック数」になります。
            </p>
            <div className="Admin-card">
              <div className="Admin-title" style={{ marginBottom: 12 }}>フィルター</div>
              <div className="Admin-field-label" style={{ marginBottom: 8 }}>表示期間</div>
              {/* 期間の欄は同じ幅にする（9章）。日付欄は共通の CSS で枠からはみ出さない（13章） */}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)", alignItems: "center", gap: 8, marginBottom: 16 }}>
                <input
                  type="date"
                  className="Admin-input"
                  aria-label="開始日"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <span className="Admin-note">〜</span>
                <input
                  type="date"
                  className="Admin-input"
                  aria-label="終了日"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div className="Admin-field-label" style={{ marginBottom: 8 }}>ロケーション（複数選択可）</div>
              {/* 検索付きの選択リスト（6章）。空＝全て、は今までと同じ */}
              <PickList
                label="ロケーション"
                allLabel="全て"
                items={locations.map((loc) => ({ id: loc.id, name: loc.name }))}
                value={[...selectedLocationIds]}
                onChange={(ids) => setSelectedLocationIds(new Set(ids))}
              />
            </div>
          </div>

          {/* 右: 表 + CSV */}
          <div style={{ flex: "1 1 400px", minWidth: 0, width: "100%" }}>
            <div className="Admin-card" style={{ overflow: "hidden" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <span className="Admin-note">
                  表示: {filteredLocations.length} ロケーション
                </span>
                {/* 書き出しは白いボタン（4章） */}
                <button type="button" className="Admin-secondary" onClick={handleDownloadCSV}>
                  CSV を書き出す
                </button>
              </div>

              {sizeLimitSkipped.count > 0 && (
                <StatusBanner tone="warning" heading="ロケーション別の数の一部を保存できませんでした">
                  {sizeLimitSkipped.days.join("・")} は 1 日分の記録の上限（Shopify のメタフィールドの 128KB）に届いたため、ロケーション別の数 {sizeLimitSkipped.count} 件を足していません。エリア表示回数などの合計の数は保存しています。
                </StatusBanner>
              )}
              {dailyData.length === 0 ? (
                // 絞り込みの結果が空のときは文字だけ（5章）。開発の予定の文言はストアに出さない（10章）
                <p className="Admin-note" style={{ padding: "24px 8px", textAlign: "center", margin: 0 }}>
                  指定期間にデータがありません。
                </p>
              ) : (
                <div className="History-scroll">
                  {/* スマホは 1 件 1 枚のカード、数値は右寄せ（8章） */}
                  <table className="History-table">
                    <thead>
                      <tr>
                        <th>日付</th>
                        <th className="History-num">エリア表示回数</th>
                        <th className="History-num">近隣店舗クリック数</th>
                        {filteredLocations.map((loc) => (
                          <th key={loc.id} className="History-num">{loc.name} 表示</th>
                        ))}
                        <th className="History-num">店舗受け取りボタンクリック数</th>
                        {filteredLocations.map((loc) => (
                          <th key={loc.id} className="History-num">{loc.name} クリック</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ background: "#fafbfb", fontWeight: 600 }}>
                        <td data-label="日付" className="History-keep" style={cell}>合計</td>
                        <td data-label="エリア表示回数" className="History-num" style={cell}>
                          {totals.areaDisplayCount}
                        </td>
                        <td data-label="近隣店舗クリック数" className="History-num" style={cell}>
                          {nearbyClickTotal}
                        </td>
                        {filteredLocations.map((loc) => (
                          <td key={loc.id} data-label={`${loc.name} 表示`} className="History-num" style={cell}>
                            {totals.nearbyDisplayByLocation[loc.id] ?? 0}
                          </td>
                        ))}
                        <td data-label="店舗受け取りボタンクリック数" className="History-num" style={cell}>
                          {orderPickClickTotal}
                        </td>
                        {filteredLocations.map((loc) => (
                          <td key={loc.id} data-label={`${loc.name} クリック`} className="History-num" style={cell}>
                            {totals.orderPickByLocation[loc.id] ?? 0}
                          </td>
                        ))}
                      </tr>
                      {dailyData.map((row) => {
                        const rowNearby = filteredLocations.reduce(
                          (s, loc) => s + (row.nearbyDisplayByLocation?.[loc.id] ?? 0),
                          0
                        );
                        const rowOrderPick = filteredLocations.reduce(
                          (s, loc) => s + (row.orderPickByLocation?.[loc.id] ?? 0),
                          0
                        );
                        return (
                          <tr key={row.date}>
                            <td data-label="日付" className="History-keep" style={cell}>
                              {formatDisplayDate(row.date)}
                            </td>
                            <td data-label="エリア表示回数" className="History-num" style={cell}>
                              {row.areaDisplayCount ?? 0}
                            </td>
                            <td data-label="近隣店舗クリック数" className="History-num" style={cell}>{rowNearby}</td>
                            {filteredLocations.map((loc) => (
                              <td key={loc.id} data-label={`${loc.name} 表示`} className="History-num" style={cell}>
                                {row.nearbyDisplayByLocation?.[loc.id] ?? 0}
                              </td>
                            ))}
                            <td data-label="店舗受け取りボタンクリック数" className="History-num" style={cell}>
                              {rowOrderPick}
                            </td>
                            {filteredLocations.map((loc) => (
                              <td key={loc.id} data-label={`${loc.name} クリック`} className="History-num" style={cell}>
                                {row.orderPickByLocation?.[loc.id] ?? 0}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </s-page>
  );
}
