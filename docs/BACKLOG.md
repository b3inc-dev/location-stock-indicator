# BACKLOG — 継続開発の候補

2026-10-04調査。依頼ではなく候補一覧。Codexは指定された範囲だけ着手し、owner/open PR/重複を再確認する。影響・承認条件は [DEVELOPMENT.md](DEVELOPMENT.md)。

| 候補 | 根拠・現状 | 次の確認 |
|---|---|---|
| lint baseline解消 | 72 errors/2 warnings、docs初期設定時も既存失敗 | app変更の独立PRで原因と両版への影響を評価 |
| 自動テスト・CI | test script/テスト/Actionsなし | Proxy/config/配送判定の意味のある回帰テストとCIを設計 |
| Preview worktree | [PR #3](https://github.com/b3inc-dev/location-stock-indicator/pull/3)、Cursor owner、未merge | owner停止・handoff・最新HEADと品質を確認。本PRで取り込まない |
| 検証環境の確定 | 開発app/store/theme/variantの固定情報不足 | secretを保存せず開発接続・両版のテストデータを記録 |
| online_only管理UI | BUSINESS_RULES §3、コードは存在し管理UI保存経路未確認 | プロダクト意図を確認して実装範囲を決める |
| 配送判定の重複 | ARCHITECTURE §8、Proxyと管理locationsに重複 | 既存挙動とGraphQL形状を保持する共通化の設計 |
| Theme容量/スキーマ | REQUIREMENTS §3/§12、FINAL_ADJUSTMENTS | 現行CLIでの検証結果と実容量を確認、必要時だけ対応 |
| 分析保持・同時更新 | FINAL_ADJUSTMENTS §2.3、月別metafield | ローテーション・競合・集計の挙動を開発環境で確認 |
| API制限・再送・ログ | DECISIONS §C、共通retry保証未確認 | fixed first上限、throttle、mutation再送、secret redactionを監査 |
| SQLite運用 | schemaはfile:dev.sqlite、Render startにmigration | persistent disk/保存先/backupは外部実設定を確認、本番変更は承認待ち |
| 欠落UI規則 | ADMIN_UI_DESIGN_RULES.mdは参照だけで不存在 | 元資料の所在を調査。規則を推測で作らない |

完了状態は実装・検証・PRの証拠に基づき更新し、古いTODOを現行未実装と断定しない。
