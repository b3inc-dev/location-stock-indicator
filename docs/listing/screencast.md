# 審査用の画面録画の台本 — Location Stock

## 決まり【事実: App Store requirements 4.5.3】

- 初期設定から主な機能まで順に見せる。**英語の音声か英語字幕が必須**。画面が日本語なので英語字幕を付ける（下の Subtitle）。
- 録るのは開発ストア（Ciara ではない店）。本物の店名・メールは写さない。3〜4 分。
- テーマエディタへのリンク（PR #46）が main に入っていれば 5 でそれを使う。入っていなければ、Shopify 管理画面 → オンラインストア → テーマ → カスタマイズ から開く。

## 台本

| # | 時間の目安 | 画面と操作 | Subtitle (English) |
|---|---|---|---|
| 1 | 0:00–0:20 | インストール → 許可の画面 → インストール | Install Location Stock and approve the permissions. |
| 2 | 0:20–0:45 | アプリのホーム → 料金プラン → Shopify のプラン選択ページで Pro を選ぶ → アプリに戻る | Choose a plan on Shopify's plan page. Development stores are not charged. Without a plan, no stock is shown on the store. |
| 3 | 0:45–1:15 | ロケーション設定: 「倉庫」を表示しない、表示名を変える、並び順を決める → 保存 | In Location settings, choose which locations to show, rename them and set their order. |
| 4 | 1:15–1:35 | 在庫表示設定: 残りわずかの境目を 5 に → 保存 | In Display settings, set the low-stock threshold and labels. |
| 5 | 1:35–2:05 | テーマエディタ → 商品ページのテンプレート → ブロックを追加 → 「Location stock indicator」→ 保存 | In the theme editor, add the Location stock indicator block to the product page. No theme code is changed. |
| 6 | 2:05–2:35 | ストアの商品ページ → 店舗ごとの在庫 → バリエーションを変える → 在庫が変わる | The product page now shows stock by store. Changing the variant updates the list. |
| 7 | 2:35–3:05 | （Pro）エリアの見出し → 近い店舗のボタン → ブラウザの位置情報を許可 → いちばん近い店舗が出る | On Pro, stores are grouped by area. Shoppers can see the nearest store; their location stays in the browser. |
| 8 | 3:05–3:25 | （Pro）受け取りボタン → カートに入る | The pickup button adds the item to the cart for that store. |
| 9 | 3:25–3:45 | 管理画面の分析 | On Pro, see daily views and clicks in Analytics. |
| 10 | 3:45–3:50 | 終わり | That's Location Stock. |

## テスト手順（提出フォームに貼る英語）

```
1. Install the app on the test store {{TEST_STORE_DOMAIN}}. Staff login: {{TEST_LOGIN_EMAIL}} / {{TEST_LOGIN_PASSWORD}} (no two-step authentication). Storefront password: {{STOREFRONT_PASSWORD}}.
2. Open the app and choose a plan on the Shopify plan page (development stores are not charged). Without a plan, the block shows no stock.
3. In "ロケーション設定" (Location settings), choose locations and save. In "在庫表示設定" (Display settings), check thresholds and save.
4. In the theme editor, add the "Location stock indicator" app block to the product template and save.
5. Open {{DEMO_PRODUCT_URL}}. Stock is shown per location. Change the variant to see it update.
6. Pro features: area groups, the nearest-store button (allow location in the browser), the pickup button, and "分析" (Analytics) in admin.
The admin UI is in Japanese. The screencast has English subtitles.
```
