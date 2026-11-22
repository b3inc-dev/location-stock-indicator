# App Store 提出の材料 — Location Stock（公開版）

- 作った日: 2026-11-22（`main` = `16d198e` と、開いている PR #48・#50 のコードを見て書いた）
- 提出のチェック表（何が済んでいて何が残っているか）は PR #40 の `docs/APP_STORE_SUBMISSION.md`。この folder は「入力欄にそのまま貼る文」と「T が押すボタンの順番」をまとめたもの。
- docs だけ。アプリのコード・設定・本番・Partner の画面は何も変えていない。

## ファイル

| ファイル | 中身 | 貼る場所 |
|---|---|---|
| [ja.md](ja.md) | 日本語のリスティング文（名前・サブタイトル・紹介文・詳細・良いところ・機能・料金） | Partner Dashboard → アプリ → Distribution → App Store listing（日本語） |
| [en.md](en.md) | 英語のリスティング文 | 同じ（English） |
| [screenshots.md](screenshots.md) | スクリーンショットの撮影リスト | 同じ（Screenshots） |
| [screencast.md](screencast.md) | 審査用の画面録画の台本（英語字幕つき）とテスト手順 | 提出フォーム |
| [privacy-policy.md](privacy-policy.md) | プライバシーポリシーの案（日本語・英語） | 会社サイトなどに置き、URL をリスティングへ |
| [support-faq.md](support-faq.md) | サポートページと FAQ の案（日本語・英語） | サポートページ |
| [partner-dashboard-steps.md](partner-dashboard-steps.md) | Partner Dashboard（プラン・メーター `pro_location`・Partner API client）と公開用 Render の環境変数 | T が上から順に押す |

## 印の意味

| 印 | 意味 |
|---|---|
| 【事実】 | コード・設定・shopify.dev で確かめた。根拠を書いている |
| 【推測】 | 確かめていない。理由を書いている |
| 【T】 | T が決める・入れる値。決まるまでは `{{…}}` のまま |

## T が決めること

| # | 決めること | 今の案 | 使うファイル |
|---|---|---|---|
| 1 | 無料体験の日数 | 今の `main` のコード（Billing API の作り）の値: Lite 7 日・Pro 14 日 | ja.md / en.md / partner-dashboard-steps.md |
| 2 | サポートのメール・サポートページとプライバシーポリシーの URL | **決まり（T 2026-11-23 1:35）**: サポート https://commercore.b3-inc.com/apps/location-stock-indicator/support/・プライバシーポリシー https://commercore.b3-inc.com/apps/location-stock-indicator/privacy/（commercor-site PR #14）。問い合わせはフォーム https://b3-inc.com/contact。サポートのメールは全アプリ共通の app-support@b3-inc.com（T 2026-11-23 1:54・2:00。届いたら自動の返事でフォームを案内） | privacy-policy.md / support-faq.md |
| 3 | 会社名・住所の表記 | **決まり（T 2026-11-22 22:15）**: 株式会社B3・東京都目黒区青葉台1-15-3 AK-4ビル2F | privacy-policy.md |
| 4 | 設定と分析のメタフィールドをアンインストールのあと残すか（今は残る） | privacy-policy.md 1.4 | privacy-policy.md |
| 5 | 英語のリスティングを出すか | 画面とテーマのブロックの設定名は日本語だけ（英語の画面は PR #18） | en.md |

月額（Lite $20・Pro $20 ＋ 1 か所 $2）は T が決めた値（location-stock-indicator#49、2026-11-21）。
