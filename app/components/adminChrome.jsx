/* eslint-disable react/prop-types -- 管理画面の既存コンポーネントと同じく PropTypes は付けない */
/**
 * POS Stock の固定フッター（破棄＝副操作、保存＝主操作）を管理画面で共有する。
 * 文言色・角丸・14px は基準実装に合わせ、狭い幅ではボタンがステータス文に押し出されないよう折り返す。
 */
export function AdminSaveBar({
  visible,
  statusText,
  onDiscard,
  onSave,
  discardDisabled,
  saveDisabled,
  saveLabel,
}) {
  if (!visible) return null;
  return (
    <div
      role="region"
      aria-label="保存"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        background: "#fff",
        borderTop: "1px solid #e1e3e5",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: 8,
        boxShadow: "0 -2px 6px rgba(0,0,0,0.06)",
        zIndex: 100,
        boxSizing: "border-box",
      }}
    >
      <span style={{ fontSize: 14, color: "#6d7175", flex: "1 1 180px", minWidth: 0 }}>
        {statusText}
      </span>
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          onClick={onDiscard}
          disabled={discardDisabled}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "1px solid #c9cccf",
            background: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: discardDisabled ? "not-allowed" : "pointer",
            color: "#202223",
          }}
        >
          破棄
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={saveDisabled}
          style={{
            padding: "8px 16px",
            borderRadius: 6,
            border: "none",
            background: "#2c6ecb",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: saveDisabled ? "not-allowed" : "pointer",
          }}
        >
          {saveLabel}
        </button>
      </div>
    </div>
  );
}
