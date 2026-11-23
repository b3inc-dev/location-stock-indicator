# サポートページと FAQ の案 — Location Stock

- サポートページは Shopify 向けの専用ページにする【事実: Best practices】。置き場所は T（PR #25 の利用者ヘルプと同じサイトが自然）【T】。
- 答えはコードで確かめたことだけ。根拠は最後の `<!-- -->`。

---

## 日本語

```
# Location Stock サポート

お問い合わせ: {{SUPPORT_EMAIL}}
受付: {{SUPPORT_HOURS}}（日本時間）。{{SUPPORT_REPLY_DAYS}} 営業日以内にお返事します。
ストアのドメイン（xxx.myshopify.com）と、困っている商品ページの URL を書いてください。

## はじめかた

1. Shopify 管理画面の「アプリ」から Location Stock を開き、「料金プラン」でプランを選びます。
2. 「ロケーション設定」で、表示する店舗・表示名・並び順を決めて保存します。
3. 「在庫表示設定」で、在庫の印と境目を決めて保存します。
4. オンラインストア → テーマ → カスタマイズ で商品ページを開き、ブロック「Location stock indicator」を追加して保存します。

## よくある質問

Q. 商品ページに在庫が出ません。
A. 次を確かめてください。(1) 料金プランを選んでいるか（プランを選ぶまでは在庫を表示しません）。(2) 商品ページのテンプレートにブロックを追加して保存したか。(3) ロケーション設定で、その店舗を表示する設定にしているか。

Q. 表示される店舗を減らしたい。
A. ロケーション設定で、表示しない店舗のチェックを外して保存してください。

Q. 「在庫あり」「残りわずか」「在庫なし」の境目を変えたい。
A. 在庫表示設定で数を変えてください。印と文言も変えられます。

Q. Lite と Pro の違いは。
A. Lite はロケーション 10 か所までで、店舗ごとの在庫の表示・印・並び順・表示名・リンクが使えます。Pro はロケーション数の制限がなく、エリアごとの表示・近い店舗・受け取りボタン・分析も使えます。

Q. Lite でロケーションが 11 か所以上あると。
A. 管理画面が料金プランの画面に移ります。Pro に変えてください。

Q. Pro の料金は。
A. 月 US$20 に、ロケーション 1 か所ごとに月 US$2 を加えた額です（例: 5 か所なら US$30）。Shopify の請求に載ります。

Q. 近い店舗の機能で、お客様の現在地は保存されますか。
A. 保存しません。お客様が許可したときだけ、ブラウザの中で使い、いちばん近い店舗を選びます。アプリのサーバーへは送りません。

Q. 受け取りボタンを押すと何が起きますか。
A. その商品が 1 つカートに入ります。設定によっては、そのまま購入手続きの画面へ進みます。

Q. テーマのコードは変わりますか。
A. 変わりません。テーマエディタでアプリのブロックを足すだけです。外すときはブロックを削除してください。

Q. アンインストールすると設定はどうなりますか。
A. 設定と分析の数は、ストアの中（メタフィールド）に残ります。詳しくはプライバシーポリシー（{{PRIVACY_URL}}）をご覧ください。

Q. 対応している言語は。
A. 管理画面とブロックの設定は日本語です。
```

<!--
根拠:
- プランを選ぶまで在庫を出さない: app/utils/planGate.js isStorefrontInventoryAllowed、App Proxy の plan_required
- 表示する店舗: BUSINESS_RULES.md 3 章 enabled（enabledLocationId）
- Lite 10 か所・11 か所で料金プランへ: billing.js LITE_MAX_LOCATIONS、app.jsx の locationPlanMismatch
- Pro の数え方: PR #50 computeProLocationUsage（全ロケーション × $2）。#50 が main に入るまで Q「Pro の料金」の数え方は出さない
- 現在地: location-stock-indicator.js onNearbyBtnClick（送るのはロケーション ID だけ）
- 受け取りボタン: 同じファイルの /cart/add.js と orderPickRedirectToCheckout
- アンインストール後に残る: privacy-policy.md 1.2
-->

---

## English

```
# Location Stock Support

Contact: {{SUPPORT_EMAIL}}
Hours: {{SUPPORT_HOURS}} (Japan time). We reply within {{SUPPORT_REPLY_DAYS}} business days.
Please include your store domain (xxx.myshopify.com) and the product page URL.
The admin screens are in Japanese.

## Getting started

1. Open Location Stock from Apps in Shopify admin and choose a plan in "料金プラン" (Plan).
2. In "ロケーション設定" (Location settings), choose locations, names and order, then save.
3. In "在庫表示設定" (Display settings), set symbols and thresholds, then save.
4. In Online Store > Themes > Customize, open a product page, add the "Location stock indicator" block and save.

## FAQ

Q. No stock appears on the product page.
A. Check that (1) you have chosen a plan (no stock is shown until you do), (2) the block is added to the product template and saved, and (3) the location is turned on in Location settings.

Q. How do I hide some locations?
A. Untick them in Location settings and save.

Q. How do I change the In stock / Low stock / Out of stock thresholds?
A. Change the numbers in Display settings. You can also change the symbols and labels.

Q. What is the difference between Lite and Pro?
A. Lite supports up to 10 locations, with stock by location, symbols, order, names and links. Pro has no location limit and adds area groups, the nearest store, the pickup button and analytics.

Q. I am on Lite and have 11 or more locations.
A. The admin opens the plan page. Please change to Pro.

Q. How much is Pro?
A. US$20 per month plus US$2 per location per month (for example, US$30 for 5 locations), on your Shopify bill.

Q. Is the shopper's location stored?
A. No. Only if the shopper allows it, the browser uses it to choose the nearest store. It is not sent to our servers.

Q. What does the pickup button do?
A. It adds one of the item to the cart. Depending on your settings, it then goes to checkout.

Q. Does the app change my theme code?
A. No. You add an app block in the theme editor. Remove the block to stop showing it.

Q. What happens to my settings when I uninstall?
A. Settings and analytics counts stay in your store (metafields). See our privacy policy ({{PRIVACY_URL}}).
```
