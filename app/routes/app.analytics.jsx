// app/routes/app.analytics.jsx

import { useState, useMemo, useCallback } from "react";
import { useLoaderData } from "react-router";
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

const inputBaseStyle = {
  padding: "6px 8px",
  fontSize: 14,
  borderRadius: 4,
  border: "1px solid #c9cccf",
  boxSizing: "border-box",
};

/** CSV のセルをエスケープ（ダブルクォートは二重に） */
function csvEscape(str) {
  const s = String(str ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export default function AppAnalytics() {
  const { locations, dailyData: initialDailyData } = useLoaderData();
  const [startDate, setStartDate] = useState(() => getDefaultDateRange().startStr);
  const [endDate, setEndDate] = useState(() => getDefaultDateRange().endStr);
  // 空 = 全て選択。ロケーションIDの Set で「選択中」を表す（空なら全ロケーション表示）
  const [selectedLocationIds, setSelectedLocationIds] = useState(() => new Set());

  const dailyData = useMemo(() => {
    return initialDailyData
      .filter((row) => row.date >= startDate && row.date <= endDate)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [initialDailyData, startDate, endDate]);

  // 表示するロケーション（未選択＝全て）
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

  // 選択ロケーションのみの合計：近隣店舗クリック数・店舗受け取りボタンクリック数（合計行用）
  const nearbyClickTotal = useMemo(() => {
    return filteredLocations.reduce((sum, loc) => sum + (totals.nearbyDisplayByLocation[loc.id] ?? 0), 0);
  }, [filteredLocations, totals.nearbyDisplayByLocation]);
  const orderPickClickTotal = useMemo(() => {
    return filteredLocations.reduce((sum, loc) => sum + (totals.orderPickByLocation[loc.id] ?? 0), 0);
  }, [filteredLocations, totals.orderPickByLocation]);

  const toggleLocation = useCallback(
    (locId) => {
      setSelectedLocationIds((prev) => {
        if (prev.size === 0) {
          // 現在「全て」→ この1つを外す = この1つ以外を表示
          return new Set(locations.filter((l) => l.id !== locId).map((l) => l.id));
        }
        const next = new Set(prev);
        if (next.has(locId)) next.delete(locId);
        else next.add(locId);
        return next.size === 0 ? new Set() : next;
      });
    },
    [locations]
  );

  const selectAllLocations = useCallback(() => {
    setSelectedLocationIds(new Set());
  }, []);

  const isAllLocationsSelected = selectedLocationIds.size === 0;

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

  return (
    <s-page heading="分析">
      <div style={{ padding: "16px", maxWidth: "1200px", paddingBottom: "40px" }}>
        <div style={{ display: "flex", gap: "24px", alignItems: "flex-start", flexWrap: "wrap" }}>
          {/* 左: フィルター */}
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>分析</div>
            <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5, marginBottom: 16 }}>
              期間とロケーションで絞り込みます。選択したロケーションの合計が「近隣店舗クリック数」「店舗受け取りボタンクリック数」になります。
            </div>
            <div
              style={{
                background: "#ffffff",
                borderRadius: 12,
                boxShadow: "0 0 0 1px #e1e3e5",
                padding: 16,
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12, color: "#202223" }}>フィルター</div>
              <div style={{ fontSize: 13, color: "#6d7175", marginBottom: 12 }}>表示期間</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={inputBaseStyle}
                />
                <span style={{ color: "#6d7175", fontSize: 14 }}>〜</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={inputBaseStyle}
                />
              </div>
              <div style={{ fontSize: 13, color: "#6d7175", marginBottom: 8 }}>ロケーション（複数選択可）</div>
              <div
                style={{
                  maxHeight: 200,
                  overflowY: "auto",
                  border: "1px solid #e1e3e5",
                  borderRadius: 8,
                  padding: 6,
                }}
              >
                <div
                  onClick={selectAllLocations}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 6,
                    cursor: "pointer",
                    backgroundColor: isAllLocationsSelected ? "#eff6ff" : "transparent",
                    border: isAllLocationsSelected ? "1px solid #2563eb" : "1px solid transparent",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isAllLocationsSelected}
                    readOnly
                    style={{ width: 16, height: 16, flexShrink: 0 }}
                  />
                  <span style={{ fontWeight: isAllLocationsSelected ? 600 : 500 }}>全て</span>
                </div>
                {locations.map((loc) => {
                  const isSelected = isAllLocationsSelected || selectedLocationIds.has(loc.id);
                  return (
                    <div
                      key={loc.id}
                      onClick={() => toggleLocation(loc.id)}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 6,
                        cursor: "pointer",
                        backgroundColor: isSelected ? "#eff6ff" : "transparent",
                        border: isSelected ? "1px solid #2563eb" : "1px solid transparent",
                        marginTop: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        readOnly
                        style={{ width: 16, height: 16, flexShrink: 0 }}
                      />
                      <span
                        style={{
                          fontWeight: isSelected ? 600 : 500,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {loc.name}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 右: 表 + CSV */}
          <div style={{ flex: "1 1 400px", minWidth: 0, width: "100%" }}>
            <div
              style={{
                background: "#ffffff",
                borderRadius: 12,
                boxShadow: "0 0 0 1px #e1e3e5",
                padding: 16,
                overflow: "hidden",
              }}
            >
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
                <span style={{ fontSize: 14, color: "#6d7175" }}>
                  表示: {filteredLocations.length} ロケーション
                </span>
                <button
                  type="button"
                  onClick={handleDownloadCSV}
                  style={{
                    padding: "8px 14px",
                    fontSize: 14,
                    fontWeight: 600,
                    borderRadius: 6,
                    border: "1px solid #2c6ecb",
                    background: "#2c6ecb",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  CSVダウンロード
                </button>
              </div>

              {dailyData.length === 0 ? (
                <div
                  style={{
                    padding: "40px 24px",
                    textAlign: "center",
                    color: "#6d7175",
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  指定期間にデータがありません。
                  <br />
                  分析データの収集は今後実装予定です。データがたまると、ここに合計と日別の数値が表示されます。
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e1e3e5", background: "#f6f6f7" }}>
                        <th style={{ padding: "10px 12px", textAlign: "left", fontWeight: 600, color: "#202223" }}>
                          日付
                        </th>
                        <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "#202223" }}>
                          エリア表示回数
                        </th>
                        <th style={{ padding: "10px 12px", textAlign: "right", fontWeight: 600, color: "#202223" }}>
                          近隣店舗クリック数
                        </th>
                        {filteredLocations.map((loc) => (
                          <th
                            key={loc.id}
                            style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              fontWeight: 600,
                              color: "#202223",
                            }}
                          >
                            {loc.name} 表示
                          </th>
                        ))}
                        <th
                          style={{
                            padding: "10px 12px",
                            textAlign: "right",
                            fontWeight: 600,
                            color: "#202223",
                          }}
                        >
                          店舗受け取りボタンクリック数
                        </th>
                        {filteredLocations.map((loc) => (
                          <th
                            key={loc.id}
                            style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              fontWeight: 600,
                              color: "#202223",
                            }}
                          >
                            {loc.name} クリック
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr
                        style={{
                          borderBottom: "1px solid #e1e3e5",
                          background: "#fafbfb",
                          fontWeight: 600,
                        }}
                      >
                        <td style={{ padding: "10px 12px", color: "#202223" }}>合計</td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {totals.areaDisplayCount}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {nearbyClickTotal}
                        </td>
                        {filteredLocations.map((loc) => (
                          <td key={loc.id} style={{ padding: "10px 12px", textAlign: "right" }}>
                            {totals.nearbyDisplayByLocation[loc.id] ?? 0}
                          </td>
                        ))}
                        <td style={{ padding: "10px 12px", textAlign: "right" }}>
                          {orderPickClickTotal}
                        </td>
                        {filteredLocations.map((loc) => (
                          <td key={loc.id} style={{ padding: "10px 12px", textAlign: "right" }}>
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
                          <tr key={row.date} style={{ borderBottom: "1px solid #e1e3e5" }}>
                            <td style={{ padding: "10px 12px", color: "#202223" }}>
                              {formatDisplayDate(row.date)}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right" }}>
                              {row.areaDisplayCount ?? 0}
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right" }}>{rowNearby}</td>
                            {filteredLocations.map((loc) => (
                              <td key={loc.id} style={{ padding: "10px 12px", textAlign: "right" }}>
                                {row.nearbyDisplayByLocation?.[loc.id] ?? 0}
                              </td>
                            ))}
                            <td style={{ padding: "10px 12px", textAlign: "right" }}>
                              {rowOrderPick}
                            </td>
                            {filteredLocations.map((loc) => (
                              <td key={loc.id} style={{ padding: "10px 12px", textAlign: "right" }}>
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
