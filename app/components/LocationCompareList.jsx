/* eslint-disable react/prop-types -- 管理画面の既存コンポーネントと同じく PropTypes は付けない */
import { useMemo, useState } from "react";
import {
  exclusionReason,
  filterLocationRows,
  locationsModeDraftNote,
} from "../utils/locationVisibility.js";

const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 14,
  borderRadius: 4,
  border: "1px solid #c9cccf",
  background: "#fff",
  color: "#202223",
  boxSizing: "border-box",
  minWidth: 0,
};

const secondaryButtonStyle = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #c9cccf",
  background: "#fff",
  fontSize: 14,
  fontWeight: 600,
  color: "#202223",
  cursor: "pointer",
};

function stateLabel(state) {
  if (state === "hidden") return "非表示";
  if (state === "excluded_by_mode") return "対象外";
  return "表示";
}

function domId(locationId, suffix) {
  const safe = String(locationId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `lsi-${safe}-${suffix}`;
}

/**
 * ロケーション一覧。店舗名と表示状態を隣に置き、絞り込みは表示だけに効く。
 * 保存対象の rows 自体は親が持つ。
 */
export function LocationCompareList({
  rows,
  regionGroups,
  isPro,
  distributionNote,
  locationsMode,
  pinnedLocationId,
  hasNextPage,
  onPinnedLocationId,
  onUpdateRow,
  onUpdateRegionGroup,
  onMoveRowUp,
  onMoveRowDown,
  onSortOrder,
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const groups = Array.isArray(regionGroups) ? regionGroups : [];
  const { counts, visible } = useMemo(
    () => filterLocationRows(rows, { query, filter, locationsMode, draft: true }),
    [rows, query, filter, locationsMode]
  );
  const reorderLocked = filter !== "all" || query.trim() !== "";

  const handleWheel = (e) => {
    const el = e.currentTarget;
    if (!el || e.deltaX === 0) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    const canScrollLeft = scrollLeft > 0;
    const canScrollRight = scrollLeft < scrollWidth - clientWidth - 1;
    if ((e.deltaX < 0 && canScrollRight) || (e.deltaX > 0 && canScrollLeft)) {
      e.preventDefault();
      el.scrollLeft += e.deltaX;
    }
  };

  return (
    <div>
      <style>{`
        .lsi-loc-note { font-size: 14px; color: #6d7175; line-height: 1.5; margin: 0 0 12px; }
        .lsi-loc-toolbar { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: flex-end; margin-bottom: 12px; }
        .lsi-loc-search { flex: 1 1 220px; min-width: 0; }
        .lsi-loc-filters { display: flex; flex-wrap: wrap; gap: 8px; }
        .lsi-loc-filters button {
          font-size: 14px;
          line-height: 1.4;
          padding: 6px 12px;
          border-radius: 8px;
          border: 1px solid transparent;
          background: transparent;
          color: #202223;
          cursor: pointer;
        }
        .lsi-loc-filters button[aria-pressed="true"] {
          background: #e5e7eb;
          font-weight: 600;
        }
        .lsi-loc-scroll { width: 100%; }
        .lsi-loc-list { list-style: none; margin: 0; padding: 0; }
        .lsi-loc-row {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          gap: 10px;
          padding: 12px;
          margin: 0 0 8px;
          border: 1px solid #e1e3e5;
          border-radius: 8px;
          background: #fff;
          min-width: 0;
        }
        .lsi-loc-row.is-hidden { background: #f6f6f7; }
        .lsi-loc-head { display: none; }
        .lsi-field-label { display: block; font-size: 14px; font-weight: 600; color: #6d7175; margin-bottom: 4px; }
        .lsi-loc-status { display: flex; align-items: center; gap: 8px; font-size: 14px; }
        .lsi-loc-pill {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 600;
          line-height: 1.4;
          white-space: nowrap;
        }
        .lsi-loc-pill.is-shown { background: #e3f1df; color: #0c5132; }
        .lsi-loc-pill.is-hidden { background: #f1f2f3; color: #6d7175; }
        .lsi-loc-pill.is-excluded_by_mode { background: #fff4e5; color: #5c4813; }
        .lsi-loc-name-text {
          display: block;
          font-size: 14px;
          color: #202223;
          white-space: normal;
          overflow-wrap: anywhere;
        }
        .lsi-loc-badges { font-size: 14px; color: #6d7175; margin-top: 4px; display: flex; flex-direction: column; gap: 2px; }
        .lsi-loc-sort { display: flex; align-items: center; gap: 4px; }
        .lsi-visually-hidden {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
        }
        @media (min-width: 768px) {
          .lsi-loc-scroll { overflow-x: auto; }
          .lsi-loc-head, .lsi-loc-row {
            display: grid;
            grid-template-columns: 112px minmax(160px, 1.1fr) minmax(180px, 1.3fr) minmax(140px, 0.9fr) 156px 72px 96px minmax(180px, 1.2fr);
            gap: 8px;
            align-items: center;
            min-width: 1120px;
            margin: 0;
            padding: 8px 0;
            border: none;
            border-bottom: 1px solid #e1e3e5;
            border-radius: 0;
          }
          .lsi-loc-head {
            font-size: 14px;
            font-weight: 600;
            color: #6d7175;
            border-bottom-color: #c9cccf;
            background: #fff;
          }
          .lsi-field-label {
            position: absolute;
            width: 1px;
            height: 1px;
            padding: 0;
            margin: -1px;
            overflow: hidden;
            clip: rect(0, 0, 0, 0);
            white-space: nowrap;
            border: 0;
          }
          .lsi-loc-name-text {
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            overflow-wrap: normal;
          }
          .lsi-loc-status, .lsi-loc-name { position: sticky; z-index: 1; background: #fff; }
          .lsi-loc-status { left: 0; }
          .lsi-loc-name { left: 120px; box-shadow: 4px 0 6px -4px rgba(0,0,0,0.12); }
          .lsi-loc-row > div:not(.lsi-loc-name) { position: relative; }
          .lsi-loc-head .lsi-loc-status, .lsi-loc-head .lsi-loc-name { z-index: 2; background: #fff; }
          .lsi-loc-row.is-hidden .lsi-loc-status,
          .lsi-loc-row.is-hidden .lsi-loc-name { background: #f6f6f7; }
        }
      `}</style>

      {distributionNote && <p className="lsi-loc-note">{distributionNote}</p>}
      <p className="lsi-loc-note">{locationsModeDraftNote(locationsMode)}</p>
      {hasNextPage && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 12px",
            background: "#fff4e5",
            border: "1px solid #e0b252",
            borderRadius: 6,
            fontSize: 14,
            color: "#202223",
          }}
        >
          ロケーションが250件を超えています。ここには先頭250件だけを出しています。
        </div>
      )}

      <div className="lsi-loc-toolbar">
        <label className="lsi-loc-search" style={{ fontSize: 14, fontWeight: 600, color: "#202223" }}>
          店舗を検索
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="店舗名または公開名"
            style={{ ...inputStyle, marginTop: 4, fontWeight: 400 }}
          />
        </label>
        <div className="lsi-loc-filters" role="group" aria-label="表示状態で絞り込み">
          {[
            ["all", "すべて", counts.all],
            ["shown", "表示", counts.shown],
            ["hidden", "非表示", counts.hidden],
            ["excluded_by_mode", "対象外", counts.excluded_by_mode],
          ].map(([id, label, count]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label} {count}
            </button>
          ))}
        </div>
        {pinnedLocationId && (
          <button type="button" onClick={() => onPinnedLocationId(null)} style={secondaryButtonStyle}>
            上部固定を解除
          </button>
        )}
      </div>
      {reorderLocked && (
        <p className="lsi-loc-note">
          絞り込み中は上下ボタンを止めています。並び順の数値は変更できます。保存対象は絞り込みで減りません。
        </p>
      )}

      <div className="lsi-loc-scroll" onWheel={handleWheel}>
        <div className="lsi-loc-head" aria-hidden="true">
          <div className="lsi-loc-status">表示</div>
          <div className="lsi-loc-name">店舗</div>
          <div>公開名</div>
          <div>エリア</div>
          <div>並び順</div>
          <div>上部固定</div>
          <div>近隣除外</div>
          <div>リンクURL</div>
        </div>
        {rows.length === 0 ? (
          <p className="lsi-loc-note">ロケーションがありません。</p>
        ) : visible.length === 0 ? (
          <p className="lsi-loc-note">該当する店舗はありません。</p>
        ) : (
          <ul className="lsi-loc-list">
            {visible.map(({ row, state, savedState }) => {
              const fullIndex = rows.findIndex((r) => r.locationId === row.locationId);
              const reason = exclusionReason(state, locationsMode);
              const areaName = row.regionGroupId
                ? groups.find((g) => g.id === row.regionGroupId)?.name ?? "—"
                : "—";
              return (
                <li
                  key={row.locationId}
                  className={state === "hidden" ? "lsi-loc-row is-hidden" : "lsi-loc-row"}
                >
                  <label className="lsi-loc-status">
                    <input
                      type="checkbox"
                      checked={!!row.enabled}
                      onChange={(e) => onUpdateRow(row.locationId, { enabled: e.target.checked })}
                      style={{ width: 16, height: 16, flexShrink: 0 }}
                    />
                    <span className="lsi-visually-hidden">{row.shopifyName}、{stateLabel(state)}</span>
                    <span className={`lsi-loc-pill is-${state}`} title={reason || undefined} aria-hidden="true">
                      {stateLabel(state)}
                    </span>
                  </label>

                  <div className="lsi-loc-name" style={{ minWidth: 0 }}>
                    <span className="lsi-loc-name-text" title={row.shopifyName}>
                      {row.shopifyName}
                    </span>
                    {(row.hasShipping || row.hasLocalDelivery || row.storePickupEnabled) && (
                      <div className="lsi-loc-badges">
                        {row.hasShipping && <div>配送対応</div>}
                        {row.hasLocalDelivery && <div>ローカルデリバリー対応</div>}
                        {row.storePickupEnabled && <div>店舗受け取り対応</div>}
                      </div>
                    )}
                    {reason && (
                      <div className="lsi-loc-badges">
                        <div>{reason}</div>
                      </div>
                    )}
                    {savedState && savedState !== state && (
                      <div className="lsi-loc-badges">
                        <div>未保存。保存前の商品ページでは{stateLabel(savedState)}</div>
                      </div>
                    )}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <label htmlFor={domId(row.locationId, "name")} className="lsi-field-label">
                      公開名
                    </label>
                    <input
                      id={domId(row.locationId, "name")}
                      value={row.publicName}
                      onChange={(e) => onUpdateRow(row.locationId, { publicName: e.target.value })}
                      style={inputStyle}
                    />
                  </div>

                  <div style={{ minWidth: 0, ...(!isPro ? { color: "#6d7175" } : {}) }}>
                    <span className="lsi-field-label">エリア</span>
                    {!isPro ? (
                      <span style={{ fontSize: 14 }} title="Proプランで編集可能">{areaName}</span>
                    ) : row.locationId === pinnedLocationId ? (
                      <span style={{ fontSize: 14, color: "#6d7175" }}>上部固定のためエリアは変更できません</span>
                    ) : (
                      <select
                        id={domId(row.locationId, "area")}
                        aria-label={`${row.shopifyName}のエリア`}
                        value={row.regionGroupId || ""}
                        onChange={(e) => onUpdateRegionGroup(row.locationId, e.target.value)}
                        style={inputStyle}
                      >
                        <option value="">未設定</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div>
                    <span className="lsi-field-label">並び順</span>
                    <div className="lsi-loc-sort">
                      <input
                        type="number"
                        min={1}
                        aria-label={`${row.shopifyName}の並び順`}
                        value={row.sortOrder}
                        onChange={(e) => onSortOrder(row.locationId, e.target.value)}
                        style={{ ...inputStyle, width: 72, textAlign: "center" }}
                      />
                      <button
                        type="button"
                        onClick={() => onMoveRowUp(row.locationId)}
                        disabled={reorderLocked || fullIndex <= 0}
                        aria-label={`${row.shopifyName}を上へ`}
                        style={{
                          ...secondaryButtonStyle,
                          padding: "4px 8px",
                          cursor: reorderLocked || fullIndex <= 0 ? "not-allowed" : "pointer",
                          opacity: reorderLocked || fullIndex <= 0 ? 0.5 : 1,
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => onMoveRowDown(row.locationId)}
                        disabled={reorderLocked || fullIndex < 0 || fullIndex >= rows.length - 1}
                        aria-label={`${row.shopifyName}を下へ`}
                        style={{
                          ...secondaryButtonStyle,
                          padding: "4px 8px",
                          cursor: reorderLocked || fullIndex >= rows.length - 1 ? "not-allowed" : "pointer",
                          opacity: reorderLocked || fullIndex >= rows.length - 1 ? 0.5 : 1,
                        }}
                      >
                        ↓
                      </button>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                      <span className="lsi-field-label" style={{ marginBottom: 0 }}>上部固定</span>
                      <input
                        type="radio"
                        name="pinnedLocationId"
                        value={row.locationId}
                        checked={pinnedLocationId === row.locationId}
                        onChange={() => onPinnedLocationId(row.locationId)}
                        aria-label={`${row.shopifyName}を上部固定`}
                        style={{ width: 16, height: 16 }}
                      />
                    </label>
                  </div>

                  <div>
                    <span className="lsi-field-label">近隣除外</span>
                    {!isPro ? (
                      <span style={{ fontSize: 14, color: "#6d7175" }} title="Proプランで編集可能">
                        {row.excludeFromNearby ? "ON" : "—"}
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        checked={!!row.excludeFromNearby}
                        onChange={(e) => onUpdateRow(row.locationId, { excludeFromNearby: e.target.checked })}
                        aria-label={`${row.shopifyName}を近隣検索から除外`}
                        style={{ width: 16, height: 16 }}
                      />
                    )}
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <label htmlFor={domId(row.locationId, "url")} className="lsi-field-label">
                      リンクURL
                    </label>
                    <input
                      id={domId(row.locationId, "url")}
                      type="text"
                      value={row.linkUrl ?? ""}
                      onChange={(e) => onUpdateRow(row.locationId, { linkUrl: e.target.value })}
                      placeholder="例: /pages/store-a または https://..."
                      title="「リンクを表示する」がオンのときだけ反映されます。空欄はリンクなし"
                      style={inputStyle}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
