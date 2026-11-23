# DATA_RETENTION_AND_UNINSTALL.md — アンインストール後のデータの扱い

Issue #20「4. テーマ導入・削除」の「セッション削除を確認し、設定・分析データの保持／削除・再インストール時の扱いを明文化する」に対応する文書。

- 根拠: main `1b43ebc` のコード（下表の「根拠」列）と Shopify 公式 docs。
- **この文書は「今のコードで何が起きるか」の記録**。保持期間などの「方針」は T が決めるまで未決（§5）。
- Shopify 側の挙動のうち公式 docs に書かれていないものは「未確認」とし、実機テスト（[`RELEASE_DEVICE_TEST_CHECKLIST.md`](./RELEASE_DEVICE_TEST_CHECKLIST.md) の U 系）で確かめる。

## 1. アプリが持つデータの一覧

| データ | 保存先 | 中身 | 書く場所（根拠） |
|--------|--------|------|------------------|
| セッション | アプリの DB（Render Postgres、Prisma `Session` テーブル） | ショップドメイン、アクセストークン、リフレッシュトークン、スコープ、期限。オンラインセッションなら操作したスタッフの氏名・メール等 | `@shopify/shopify-app-session-storage-prisma`（`app/shopify.server.js`、`prisma/schema.prisma`） |
| 表示設定 | ショップのメタフィールド `location_stock.config`（JSON） | 閾値、ロケーション表示ルール、並び順、エリア・近隣・店舗受け取りの設定、文言 | `app/routes/app.settings.jsx`、`app/routes/app.locations.jsx` |
| 分析の集計 | ショップのメタフィールド `location_stock.analytics_YYYY_MM`（月ごとの JSON） | 日別の表示回数・クリック回数（ロケーション ID ごとの回数を含む）。個人を特定する値は無い | `app/analytics.server.js`（App Proxy `action=analytics` から） |
| テーマブロックの設定 | テーマのファイル（テーマエディタで保存した JSON） | ブロックの見た目の設定 | Shopify のテーマが持つ。アプリは書かない |
| サーバーログ | Render のログ | ショップドメイン、Webhook のトピック、エラー内容 | `console.log` / `console.error`（各 route） |

- `prisma/schema.prisma` のモデルは `Session` だけ。設定・分析は DB に置いていない。
- 顧客ごとのデータは持たない（`app/utils/complianceWebhook.js` のコメント、`docs/APP_REVIEW_SUBMISSION.md` §3）。
- ストアフロントの JS は `localStorage` / `sessionStorage` / Cookie を使っていない（`extensions/` を検索して該当なし）。
- メタフィールドの名前空間 `location_stock` は**アプリ専用の名前空間（`$app`）ではない**。Shopify の分類ではストアが持つ（merchant-owned）メタフィールドで、ストアとほかのアプリも読み書きできる（[About metafields](https://shopify.dev/docs/apps/build/metafields)）。
- アプリはメタフィールド定義（definition）を作っていない（`metafieldDefinitionCreate` も toml の定義も無い）。

## 2. アンインストールのときに起きること

| 時点 | 起きること | 根拠 |
|------|-----------|------|
| アンインストール直後 | Shopify が `app/uninstalled` Webhook を送る。アプリはその店の `Session` 行を**すべて削除**する（`deleteMany({ where: { shop } })`。何度来ても安全。セッションが無いときも削除を試みる） | `app/routes/webhooks.app.uninstalled.jsx` |
| 同上 | アクセストークンは Shopify 側で無効になる。以後アプリはその店の Admin API を呼べない | Shopify の仕様（実機で U-03 を確認） |
| 約 48 時間後 | Shopify が `shop/redact` を送る。アプリは「まだ入っているか」を確かめ、入っていなければ `Session` 行を削除する。入れ直していれば削除しない | `app/utils/complianceWebhook.js`、`app/utils/shopInstallProbe.js` |
| `customers/data_request` / `customers/redact` | 顧客データを持たないので、ログに残して 200 を返すだけ | `app/utils/complianceWebhook.js` |

### アンインストール後も残るもの

| データ | 残るか | 理由 |
|--------|--------|------|
| `Session` 行 | **残らない**（`app/uninstalled` で削除、`shop/redact` でも再度削除） | 上表 |
| `location_stock.config` | **残る（今のコード）** | アプリは削除するコードを持たない（`metafieldsDelete` を呼ぶ箇所が無い）。アンインストール後はトークンが無いので、`shop/redact` の時点でも消せない。Shopify の docs はストアが持つメタフィールドをアンインストールで消すとは書いていない（docs は記載なし。実機 U-05 で確認） |
| `location_stock.analytics_YYYY_MM` | **残る（今のコード）** | 同上。月ごとのキーは古い月も消さない（保持の上限も無い） |
| テーマブロックの設定 | テーマのファイルに残る | Shopify のテーマが持つ。アンインストールしたアプリのブロックをテーマが表示しないかは実機 U-01 で確認 |
| Render のログ | Render の保持期間による | このリポジトリに保持期間の記載は無い |
| 課金（公開版のサブスクリプション） | Shopify が扱う | アプリは課金の取り消しを実装していない（実機 U-04 で確認） |

## 3. 再インストールのときに起きること

| データ | 扱い | 根拠 |
|--------|------|------|
| `Session` | 新しく作られる（OAuth / トークン交換） | `@shopify/shopify-app-react-router` |
| `location_stock.config` | メタフィールドが残っていれば、**前の設定がそのまま読まれる**（管理画面も App Proxy も `metafield(namespace: "location_stock", key: "config")` を読むだけで、インストール日時で分けていない） | `app.settings.jsx`、`app.locations.jsx`、`apps.location-stock.js` |
| 分析 | 同じく残っていれば、前の期間の集計も分析画面に出る | `analytics.server.js` の `getAnalyticsDailyData` |
| プラン | 再インストールのあとで改めて選ぶ（公開版）。自社版は `CUSTOM_APP_STORE_IDS` / `APP_DISTRIBUTION` で決まる | `app/utils/shopPlan.server.js`、`docs/PLAN_SETTINGS_DESIGN.md` |

- 「設定を初期化して入れ直す」操作は今は無い。前の設定を消したいときは、ストアの管理画面（設定 → カスタムデータ → ショップ）で `location_stock` のメタフィールドを手で消すしかない（Shopify 管理画面の表示は実機 U-06 で確認）。

## 4. 参考: アプリ専用の名前空間なら

Shopify の docs では、アプリが持つ定義（`$app` など）の場合「アンインストールで定義を消し、値は期間を保証せずに一時的に残す。期間内に入れ直せば元に戻る」とある（[Manage metafield definitions — App uninstall and reinstall](https://shopify.dev/docs/apps/build/metafields/definitions)）。本アプリは `location_stock`（ストアが持つ名前空間）を使っているので、この説明は当てはまらない。

## 5. 未決事項（T が決める）

1. 設定・分析をアンインストール後も残すか。残すなら、そのことをプライバシーポリシー・掲載文に書くか。
2. 残さない場合のやり方（例: 管理画面に「データを消す」操作を足す、`$app` 名前空間へ移す）。どれもアプリコードの変更が要り、別 PR になる。
3. 分析の月ごとのキーの保持上限（今は上限なし）。

決まったら、この文書の §2・§3 と `APP_REVIEW_SUBMISSION.md` §3 を合わせて直す。
