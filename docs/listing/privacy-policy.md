# プライバシーポリシーの案 — Location Stock（公開版）

- 中身は `main`（`16d198e`）と PR #48/#50 のコードに合わせた。**コードが変わったら、この文も直す**（`prisma/schema.prisma`・`app/utils/complianceWebhook.js`・`app/analytics.server.js`・テーマの JS）。
- 1 章は根拠（公開しない）。2 章（日本語）と 3 章（English）が公開する本文。`{{…}}` は T が入れる【T】。

- **公開する本文の正本は commercor-site の `editorial/app_policies.py`**（b3inc-dev/commercor-site PR #14、T の決定 2026-11-23 1:35「紹介サイトに置く・連絡先はフォーム」、1:54・2:00「サポートのメールは全アプリ共通の app-support@b3-inc.com」。commercor-site PR #15）。公開の URL: プライバシーポリシー https://commercore.b3-inc.com/apps/location-stock-indicator/privacy/・サポート https://commercore.b3-inc.com/apps/location-stock-indicator/support/。この案は根拠として残す。文を変えるときは commercor-site も同じ PR の流れで直す。
- 【アプリの直しは途中】T の決定（2026-11-23 1:50、commercor-site #1）で、shop/redact のときに `AppUsageReport` も消す（POS Stock と同じ）。今のコード（#50、未マージ）は消さないので、直しの PR が要る。
- まだ `{{…}}` のまま: `UPDATED_DATE`（公開申請の日に入れる）、`LOG_RETENTION_DAYS`（commercor-site の公開の文には、ログの日数を書いていない）。

---

## 1. 根拠（公開しない）

### 1.1 アプリの DB（公開用 Render の PostgreSQL）【事実: `prisma/schema.prisma`】

| テーブル | 中身 | 消える時 |
|---|---|---|
| `Session` | 店のドメイン、アクセストークン・リフレッシュトークン、スコープ、期限（スタッフの氏名・メールの欄もあるが、【推測】オフラインのトークンだけなのでふつうは空） | `app/uninstalled`（`webhooks.app.uninstalled.jsx`）と `shop/redact` |
| `AppUsageReport`（PR #50 で増える） | 請求期間・プラン・ロケーション数・送った単位・結果 | **今は消さない**【T】 |

- 在庫・ロケーション・配送の設定は DB に入れない。App Proxy が配送の設定と店の設定を、サーバーのメモリに少しのあいだだけ覚える（`app/utils/shortCache.js`「プロセス内の短命キャッシュ」）【事実】。

### 1.2 店の Shopify の中（ショップのメタフィールド）【事実: `docs/REQUIREMENTS.md` 14.4、`app/analytics.server.js`】

| キー | 中身 |
|---|---|
| `location_stock.config` | 在庫表示・ロケーション（表示名・リンク URL・エリア・並び順）・受け取りボタンなどの設定 |
| `location_stock.analytics_YYYY_MM` | 日ごとの数だけ: エリアの表示回数・近い店舗のクリック数・受け取りボタンのクリック数（ロケーション ID ごと）。Pro のときだけ書く |

- ショップに付くメタフィールドなので、**アンインストールしても残る**。アンインストールのあとはトークンが無く、アプリからは消せない【事実: #40 の 4.1「データ」の行】。古い月の分析を消す処理も無い【事実: `analytics.server.js` に削除が無い】。

### 1.3 ストアのお客様のブラウザ【事実: `extensions/location-stock-theme/assets/location-stock-indicator.js`】

- 商品ページは `/apps/location-stock?variant_id=…` を呼ぶだけ。アプリは Shopify の App Proxy が付ける顧客 ID（`logged_in_customer_id`）を読まない（`app/routes/apps.location-stock.js` に参照が無い）。
- 「近い店舗」はブラウザの位置情報（`navigator.geolocation`）を**ブラウザの中だけ**で使い、いちばん近い店舗を選ぶ。緯度・経度はサーバーへ送らない。送るのは分析のイベント名・日付・ロケーション ID だけ。
- 受け取りボタンは、ブラウザから Shopify のカート（`/cart/add.js`）へ直接入れる。アプリのサーバーを通らない。

### 1.4 必須 webhook の動き【事実: `app/utils/complianceWebhook.js`】

| topic | 動き |
|---|---|
| `customers/data_request` | 顧客ごとのデータが無いので渡すものはない（記録して 200） |
| `customers/redact` | 消すものはない（200） |
| `shop/redact` | その店の `Session` を消す。48 時間のうちに入れ直した店では消さない |

### 1.5 決まっていない・合っていないこと【T】

- 設定と分析のメタフィールドがアンインストールのあと残ること。本文ではそのまま書いた（店が Shopify の管理画面やアプリを入れ直して消せる、とは書いていない。消し方を用意するなら別の PR）。
- `AppUsageReport` を `shop/redact` で消すか（POS Stock と同じ論点）。
- サーバーの地域とログの保存日数。
- POS Lite（PR #21〜#23）を入れると注文・顧客に触れる。そのときはこの文を作り直す。

---

## 2. 本文（日本語）

```
# Location Stock プライバシーポリシー

最終更新日: {{UPDATED_DATE}}

株式会社B3（以下「当社」）は、Shopify アプリ「Location Stock」（以下「本アプリ」）を提供しています。このポリシーは、本アプリをインストールした店舗（以下「店舗」）と、その店舗のオンラインストアを訪れるお客様のデータを、本アプリがどう扱うかを説明します。

## 1. 集める情報

- 店舗の情報: ストアのドメイン、Shopify から発行されるアクセストークン
- 在庫とロケーションの情報: 商品のバリエーションごとの在庫数、ロケーションの名前・住所・位置・受け取りや配送の設定（Shopify の API から読むだけで、本アプリのデータベースには保存しません）
- 店舗の設定: 在庫の表示のしかた、ロケーションの表示名・リンク・並び順など（店舗の Shopify ストアの中に保存します）
- 利用の数（Pro プラン）: 日ごと・ロケーションごとの、表示とボタンのクリックの回数だけ（店舗の Shopify ストアの中に保存します）
- 料金の情報: 契約しているプランとロケーション数（使用量の請求のため）

本アプリは、お客様の氏名・メールアドレス・電話番号・住所・支払いの情報を集めません。
「近くの店舗」の機能では、お客様が許可したときだけ、ブラウザが現在地を使って近い店舗を選びます。現在地は本アプリのサーバーへ送らず、保存もしません。

## 2. 使う目的

- 商品ページに、ロケーションごとの在庫を表示するため
- 店舗が決めた表示のしかたを反映するため
- 店舗に、表示とクリックの回数を見せるため（Pro プラン）
- 契約しているプランを確かめ、ロケーション数による使用量を Shopify に報告するため
- 不具合を調べ、サポートの問い合わせに答えるため

広告や、本アプリの提供と関係のない目的には使いません。販売もしません。

## 3. 保存する場所と、渡す先

- 本アプリのサーバーとデータベース（ホスティング: Render。地域: 米国（オレゴン））: アクセストークンと料金の記録だけ
- 店舗の Shopify ストアの中（ショップのメタフィールド）: 設定と利用の数

情報を渡すのは、本アプリを動かすための Shopify（API と請求）とホスティングの会社だけです。法令で求められたときを除き、ほかの第三者には渡しません。通信は HTTPS で暗号化しています。

## 4. 保存する期間と削除

- 本アプリをアンインストールすると、すぐにアクセストークンを削除します。アンインストールの 48 時間後に Shopify から届く削除の依頼（shop/redact）でも、もう一度削除します（その前にもう一度インストールした場合は削除しません）。
- 設定と利用の数は、店舗の Shopify ストアの中に保存しているため、アンインストールのあとも店舗のストアに残ります。アンインストールのあとは、本アプリからは削除できません。削除を希望する店舗は、アンインストールの前に、お問い合わせフォーム（https://b3-inc.com/contact）からご連絡ください。
- 使用量の報告の記録も、shop/redact のときに削除します。
- お客様ごとのデータを持たないため、Shopify からのお客様のデータの開示・削除の依頼（customers/data_request・customers/redact）では、渡すものも削除するものもありません。
- サーバーのログは {{LOG_RETENTION_DAYS}} 日で消えます。

## 5. 店舗の権利

店舗は、本アプリが保存している自分の店舗のデータについて、確認・訂正・削除を求められます。

## 6. 変更

このポリシーを変えるときは、このページで知らせ、最終更新日を変えます。

## 7. 問い合わせ

株式会社B3
東京都目黒区青葉台1-15-3 AK-4ビル2F
お問い合わせフォーム: https://b3-inc.com/contact
メール: app-support@b3-inc.com（自動の返事でお問い合わせフォームをご案内します）
```

`USAGE_RECORD_RETENTION`（**決まり: 消す**。T 2026-11-23 1:20・1:50）:
- 消すなら: 「使用量の報告の記録も、shop/redact のときに削除します。」
- 残すなら: 「使用量の報告の記録（プラン・ロケーション数・請求期間。個人の情報は含みません）は、請求の確認のため {{N}} か月保存します。」

---

## 3. Policy text (English)

```
# Location Stock Privacy Policy

Last updated: {{UPDATED_DATE}}

B3, Inc. ("we") provides the Shopify app "Location Stock" (the "App"). This policy explains how the App handles data of the stores that install it ("merchants") and of the shoppers who visit their online stores.

## 1. Information we collect

- Store information: the store's myshopify domain and the access token issued by Shopify
- Inventory and location information: stock quantities per variant, and location names, addresses, coordinates, and pickup and shipping settings (read from the Shopify API; not saved in our database)
- Merchant settings: how stock is shown, location display names, links and order (saved in the merchant's Shopify store)
- Usage counts (Pro plan): only daily counts of views and button clicks per location (saved in the merchant's Shopify store)
- Billing information: the merchant's plan and number of locations (for usage charges)

The App does not collect shoppers' names, email addresses, phone numbers, addresses or payment information.
For the "nearby store" feature, the shopper's browser uses their location, only if they allow it, to choose the nearest store. The location is not sent to our servers and is not stored.

## 2. How we use it

- To show stock by location on product pages
- To apply the display settings chosen by the merchant
- To show the merchant counts of views and clicks (Pro plan)
- To check the merchant's plan and report location-based usage to Shopify
- To investigate problems and answer support requests

We do not use this information for advertising or for any purpose unrelated to the App, and we do not sell it.

## 3. Where it is stored and who receives it

- Our servers and database (hosted on Render, region: US (Oregon)): only the access token and billing records
- The merchant's Shopify store (shop metafields): settings and usage counts

We share information only with Shopify (API and billing) and our hosting provider, as needed to run the App, unless the law requires otherwise. All traffic is encrypted with HTTPS.

## 4. Retention and deletion

- When the App is uninstalled, we delete the access token right away. We delete it again when Shopify sends the shop/redact request 48 hours after uninstall (unless the App was installed again).
- Settings and usage counts are saved in the merchant's Shopify store, so they stay in the store after uninstall. After uninstall, the App can no longer delete them. Merchants who want them deleted should contact us through our contact form (https://b3-inc.com/contact) before uninstalling.
- Usage report records are deleted on shop/redact.
- We hold no data per shopper, so there is nothing to provide or delete for customers/data_request or customers/redact.
- Server logs are deleted after {{LOG_RETENTION_DAYS}} days.

## 5. Merchant rights

Merchants can ask us to show, correct or delete the data we hold about their store.

## 6. Changes

If we change this policy, we will post the new version on this page and update the date above.

## 7. Contact

B3, Inc.
AK-4 Bldg. 2F, 1-15-3 Aobadai, Meguro-ku, Tokyo, Japan
Contact form: https://b3-inc.com/contact
Email: app-support@b3-inc.com (an automatic reply will guide you to the contact form)
```

`USAGE_RECORD_RETENTION_EN`（**決まり: 消す**）:
- Delete: "Usage report records are deleted on shop/redact."
- Keep: "Usage report records (plan, number of locations and billing period; no personal data) are kept for {{N}} months to check billing."
