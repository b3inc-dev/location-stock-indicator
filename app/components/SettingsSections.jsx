/* eslint-disable react/prop-types -- 管理画面の既存コンポーネントと同じく PropTypes は付けない */
import "./settings-sections.css";

export function SettingsSections({ labels, selected, onSelect }) {
  return (
    <nav className="location-settings-tabs" aria-label="設定の分類">
      {labels.map((label) => (
        <button key={label} type="button" aria-pressed={selected === label} onClick={() => onSelect(label)}>
          {label}
        </button>
      ))}
    </nav>
  );
}
