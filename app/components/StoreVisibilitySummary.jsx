/* eslint-disable react/prop-types -- 管理画面の既存コンポーネントと同じく PropTypes は付けない */
import { useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  exclusionReason,
  locationsModeLabel,
  locationsModeNote,
} from "../utils/locationVisibility.js";

const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 14,
  borderRadius: 4,
  border: "1px solid #c9cccf",
  boxSizing: "border-box",
  background: "#fff",
  color: "#202223",
};

function matchesQuery(item, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    String(item.name || "").toLowerCase().includes(q) ||
    String(item.publicName || "").toLowerCase().includes(q)
  );
}

function StoreColumn({ title, items, locationsMode, emptyLabel }) {
  return (
    <section style={{ flex: "1 1 200px", minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#6d7175", marginBottom: 8 }}>
        {title}
        <span style={{ marginLeft: 6, fontWeight: 600, color: "#202223" }}>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div style={{ fontSize: 14, color: "#6d7175", padding: "8px 0" }}>{emptyLabel}</div>
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            maxHeight: 280,
            overflow: "auto",
            border: "1px solid #e1e3e5",
            borderRadius: 8,
            background: "#fff",
          }}
        >
          {items.map((item) => {
            const reason = exclusionReason(item.state, locationsMode);
            const titleText = [item.name, item.publicName && item.publicName !== item.name ? `公開名 ${item.publicName}` : "", reason]
              .filter(Boolean)
              .join(" / ");
            return (
              <li
                key={item.id || item.name}
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid #e1e3e5",
                  minWidth: 0,
                }}
              >
                <span className="lsi-vis-name" title={titleText}>
                  {item.name || "（名称なし）"}
                </span>
                {item.usePublicName && item.publicName && item.publicName !== item.name && (
                  <span className="lsi-vis-sub" title={item.publicName}>
                    公開名: {item.publicName}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * 在庫表示設定の先頭で、保存済みの対象店舗と表示状態を左右に並べる。
 * 編集はロケーション設定側。ここは見比べ専用。
 */
export function StoreVisibilitySummary({ summary }) {
  const location = useLocation();
  const [query, setQuery] = useState("");
  const data = summary ?? { items: [], locationsMode: "all", error: null, hasNextPage: false };
  const filtered = useMemo(() => {
    const items = Array.isArray(data.items) ? data.items : [];
    return items.filter((item) => matchesQuery(item, query));
  }, [data.items, query]);
  const shown = filtered.filter((item) => item.state === "shown");
  const hidden = filtered.filter((item) => item.state === "hidden");
  const excluded = filtered.filter((item) => item.state === "excluded_by_mode");
  const locationsHref = `/app/locations${location.search || ""}`;

  return (
    <div style={{ marginBottom: 24 }}>
      <style>{`
        .lsi-vis-name, .lsi-vis-sub {
          display: block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          min-width: 0;
        }
        .lsi-vis-name { font-size: 14px; color: #202223; }
        .lsi-vis-sub { font-size: 14px; color: #6d7175; margin-top: 2px; }
        @media (max-width: 767px) {
          .lsi-vis-name, .lsi-vis-sub {
            white-space: normal;
            overflow: visible;
            text-overflow: unset;
          }
        }
      `}</style>
      <div
        style={{
          display: "flex",
          gap: 24,
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: "1 1 260px", minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4, color: "#202223" }}>
            対象店舗と表示状態
          </div>
          <div style={{ fontSize: 14, color: "#6d7175", lineHeight: 1.5 }}>
            保存済みの設定です。店舗名と、商品ページに出るかを並べています。表示モードは「{locationsModeLabel(data.locationsMode)}」。
            {locationsModeNote(data.locationsMode)}
          </div>
          <div style={{ marginTop: 8 }}>
            <Link to={locationsHref} style={{ fontSize: 14, color: "#2c6ecb" }}>
              ロケーション設定で変更
            </Link>
          </div>
        </div>
        <div style={{ flex: "2 1 420px", minWidth: 0 }}>
          <div
            style={{
              background: "#ffffff",
              borderRadius: 12,
              boxShadow: "0 0 0 1px #e1e3e5",
              padding: 16,
            }}
          >
            {data.error && (
              <div
                role="alert"
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
                {data.error}
              </div>
            )}
            {data.hasNextPage && (
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
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, marginBottom: 4, color: "#202223" }}>
              店舗を検索
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="店舗名または公開名"
                style={{ ...inputStyle, marginTop: 4, fontWeight: 400 }}
              />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16 }}>
              <StoreColumn title="表示" items={shown} locationsMode={data.locationsMode} emptyLabel="なし" />
              <StoreColumn title="非表示" items={hidden} locationsMode={data.locationsMode} emptyLabel="なし" />
              <StoreColumn title="対象外" items={excluded} locationsMode={data.locationsMode} emptyLabel="なし" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
