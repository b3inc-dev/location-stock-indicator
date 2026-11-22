# POS Lite（#76）を公開用の Location Stock で開発ストア bbbincbbb で動かす手順書

2026-11-23 作成（とりまとめ側）。T さん 11/23 5:10 の決定「#76 は開発ストアで確かめてから main」のための手順書です。

- 対象のコード: PR #76（ブランチ `claude/loc-pos-lite`）。#77（送料の行の二重を防ぐ・拾い直し）を #76 に入れたあとなら、その版で行います。
- 対象のアプリ: **公開用**の Location Stock（`shopify.app.public.toml`・client_id `1758d63a004d7f7d99afe5bf334d1f48`）。
- 対象の店: 開発ストア **bbbincbbb** だけ（新しく作らない）。
- この手順書は docs だけです。アプリのコード・設定は変えません。
- 「推測」と書いた所は、Shopify の文書で確かめられなかった所です。見えたことを記録してください。

---

## 1. やり方は 2 つ。勧めるのは A（`npm run dev:public`）

| | A. ブランチから `npm run dev:public`（勧める） | B. 公開用のアプリの版を配備（`shopify app deploy`） |
|---|---|---|
| 何が動くか | T さんの PC で #76 のサーバーが動き、Shopify の CLI のトンネル（Cloudflare）でつながる。POS の拡張・`orders/paid`・権限も #76 の toml のもの | Shopify 側（拡張・権限・Webhook）だけが #76 の版になる。サーバーは公開用の Render（`location-stock-indicator.onrender.com`）で、**main のコード**のまま |
| ほかの店への影響 | **無し**。Shopify の文書:「This change is isolated to the chosen dev store and does not affect the app URL on other stores.」（dev preview） | **有る**。リリースした版は公開用のアプリを入れている店すべてに出る（権限の追加の承認・POS のタイル・`orders/paid`） |
| 動くか | 動く | **動かない**。main には `/app/pos-lite`・`/webhooks/orders/paid` が無いので、管理画面と会計のあとの処理が 404 になる。動かすには Render を #76 のブランチに向ける（本番の操作）しかない |
| 後片づけ | `shopify app dev clean` で、開発ストアだけ今リリースしている版に戻る | 前の版をもう一度リリースする（ほかの店にも出る） |
| 費用 | 無し | 無し（ただし本番の操作） |
| 注意 | 確かめるあいだ、PC で `app dev` を動かしたまま・スリープさせない（`orders/paid` はトンネルに届く） | — |

**A を勧めます。** B は本番（ほかの店）に出るうえ、サーバーが main のままなので #76 を確かめられません。

---

## 2. 前の準備（1 回だけ・約 20 分）

### 2.1 PC の準備
1. Node は `>=20.19 <22` か `>=22.12`（`package.json` の `engines`）。`node -v` で見る。
2. Shopify CLI を入れる（入っていれば `shopify version` で見る）。
3. PostgreSQL をローカルで動かす（セッションの保存に使う。SQLite は使えない）。例（Docker）:
   ```bash
   docker run -d --name lsi-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
   ```
4. リポジトリで #76 のブランチにする:
   ```bash
   git fetch origin
   git switch claude/loc-pos-lite
   git pull
   npm ci
   ```
5. `.env.example` を `.env` に写し、`DATABASE_URL` だけを入れる（`SHOPIFY_API_KEY` などは CLI が入れるので空でよい。**秘密の値をコミットしない**）。

### 2.2 保護された顧客データ（名前・住所・電話）の申請（開発ストアだけなら審査なし）
Shopify の文書:「you can access customer data in development after Step 6」「You don't need to submit for review.」

1. Dev Dashboard（Partner の画面）→ アプリ → **Location Stock**（公開用）→ 設定（Settings）→ **Access requests**。
2. **Protected customer data** の「Manage」→「Customer data」を選び、理由を書く（例: POS の配送で注文の配送先を書く）。
3. 項目ごとに **Name・Address・Phone** を選び、それぞれ理由を書いて「Apply reasons」。
4. データの守り方（Data protection details）を書いて「Save」。
   - 配布の方法（公開）を先に選んでいないと申請できない（文書の前提）。
   - App Store に出すときの審査は別。ここでは出さない。

### 2.3 ロケーションと商品（開発ストアの管理画面）
1. ロケーションを 2 つ: **店舗 A**（POS で売る店）と **倉庫 W**。商品ごとの確かめ用に **倉庫 W2** も。
2. 確かめに使う商品 X（と Y）の在庫を、A・W（・W2）の全部に登録する（例: A 10・W 10）。W に登録が無いと「出荷元へ移せませんでした」になる。
3. 使うのは合成のお客様・合成の住所だけ。

---

## 3. 公開用のアプリを #76 で動かす（毎回・約 5 分）

1. 公開用の設定を選び、開発ストアで動かす:
   ```bash
   npx shopify app config use shopify.app.public.toml
   npx shopify app dev --store bbbincbbb.myshopify.com
   ```
   （`npm run dev:public` でも同じ。店を聞かれたら bbbincbbb を選ぶ）
2. 「Ready, watching for changes in your app.」が出るまで待つ。この画面は閉じない。
3. 記録（ログ）はこの画面に出る（Render ではない）。住所・名前が出ていないことも見る。

### 3.1 権限の承認のし直し
1. ターミナルに出た Preview URL か、開発ストアの管理画面 → アプリ → Location Stock を開く。
2. 「権限の更新」の画面が出たら、足した 4 つ（注文を読む・注文を書く・自店で管理する出荷指示を読む・書く。`read_orders`・`write_orders`・`read_merchant_managed_fulfillment_orders`・`write_merchant_managed_fulfillment_orders`）があることを見て **承認（Update / Install）**。
3. アプリのナビに「店頭受取・配送」が出ることを見る。開いて、上に「要確認の注文を読めませんでした（権限…）」が**出ない**ことを見る（出たら承認できていない）。
4. 推測: 公開用のアプリをまだ入れていない店なら、ここでインストールの画面になる。同じく承認する。

### 3.2 POS の端末でタイルを出す（Shopify の文書の手順）
1. ターミナルで `p` を押す → Dev Console が開く。
2. 端末（iPad / iPhone）の POS アプリで、bbbincbbb の **店舗 A** にログインしておく。
3. Dev Console の **Mobile** のプレビューのリンク → QR コードを端末で読み、出たリンクから POS アプリを開く。
4. POS のホームに「店頭受取・配送」のタイルが出る（出なければ POS の設定 → スマートグリッドの編集でタイルを足す）。

---

## 4. POS Lite の準備（店舗 A を Lite にする）

stock-transfer-pos の PR #106（`docs/POS_LITE_READINESS.md` 5.2）と同じ手順です（T さん 11/23 4:15 の決定: まず開発ストアでロケーションを POS Pro から外せるか試す）。

1. 管理画面 → 販売チャネル → Point of Sale → 設定 → **POS Pro Subscription**。
2. 店舗 A を選び「Cancel POS Pro」→「Confirm downgrade」。
3. 結果を書き留める:
   - **すぐ Lite になった** → 5 章へ（これで「Lite で動く」を確かめられる）。
   - **30 日の期間の終わりまで Pro のまま**、またはボタンが無い → 開発ストアでは Lite を試せない。5 章は Pro のまま行い、結果は「Pro で確認・Lite は未確認」と書く。Lite の確かめは、Ciara の 1 店で試す案を T さんが改めて決める（11/23 4:15）。
4. Lite になったかは、POS アプリで A にログインし、標準の店頭受取の一覧などが出ない・使えないことで見る（画面の出方は推測。見えたものを書く）。
5. 推測: 開発ストアに POS Pro の契約がもともと無い（＝はじめから Lite）こともある。そのときは 3 のどちらでもなく「はじめから Lite」と書く。

---

## 5. スイッチをオンにする（管理画面「店頭受取・配送」）

**オンにする前に**（全部オフのまま）:
1. 4 つのスイッチ（＋#77 を入れた版なら「拾い直し」で 5 つ）が**オフ**であること、「要確認の注文」が空であることを見る。
2. POS のタイル →「受取待ち」が見るだけ（ボタンが出ない）、「配送の分け」が「オフです」になることを見る。**ここまで何も書かれていない。**

**オンにする**（T さん）:
| スイッチ | 最初の値 |
|---|---|
| POS で準備完了・引渡し完了を記録する | **オン** |
| 引渡し完了のときにお客様へ知らせる | オフのまま |
| 会計のあと、配送分を出荷元へ移し、持ち帰り分を履行する | **オン** |
| 店頭で履行済みになった配送分を取り消して出荷元へ移す | **オフのまま**（#76 の手順 14〜18 で在庫の戻り方を見るときだけオン） |
| （#77）印の無いまま終わった注文を拾い直して「要確認の注文」に出す | オフのまま（#77 の手順で見るときだけオン） |

「店舗ごとの配送」の店舗 A の行: 「配送を受け付ける」に印・既定の出荷元 W・送料 800 円 →「保存」。既定の出荷元を A にすると保存できないこと、「送料に消費税をかける」に印があることも見る。

---

## 6. 確かめる（#76 の本文の手順 5〜20）

#76 の本文「開発ストア（bbbincbbb）で確かめる手順」の 5〜20 をそのまま行います（店頭受取・持ち帰りと配送の 3 点の会計・後日の返品・止まる場合・取り消して移す道の在庫の戻り方）。ここでは、とくに見落としやすい所だけ書きます。

- 会計の前に、カートの「**フルフィルメント済みにする**」を**オフ**にできるか（Lite でできるか）を必ず書き留める。できなければ、#76 の手順 14〜18（取り消して移す道）が本番の道になる。
- 手順 10: 送料の明細に `_lsi_fee` などの印が**注文まで届いているか**（3 回目の見直しの「気になること 3」。届かないと POS Receipt・Shop Point が送料の行を見分けられない）。
- 手順 10: 2 点が倉庫 W に未発送であること（見直しの「気になること 4」。最初から販売店舗の外に出荷指示が無いことの確かめ）。
- 記録（ログ）は 3 章のターミナルに出る（#76 の本文の「Render の記録」はこの画面と読みかえる）。
- #77 を入れた版なら、#77 の本文の「開発ストアで確かめること」1〜4 も行う。

---

## 7. 終わったら（毎回）

1. スイッチを**全部オフ**に戻して「保存」。
2. ターミナルで `Ctrl + C`（`app dev` を止める）。
3. 開発ストアを今リリースしている版に戻す:
   ```bash
   npx shopify app dev clean --store bbbincbbb.myshopify.com
   ```
   Shopify の文書:「restores the app's active version to the selected development store.」 dev で足した拡張・設定が消えると、それに結びついたデータも消える（文書）。注文・注文のメタフィールドは Shopify の注文に残る（推測）。
4. 店舗 A を POS Pro に戻すかは T さんが決める（戻すと費用がかかる場合がある）。
5. 結果を連絡帳 #49 と #76 に書く: 対象の版（コミット）・Lite にできたか・「フルフィルメント済みにする」をオフにできたか・手順ごとの期待と見えたこと・合否。**店の情報・トークン・お客様の値・生のログは書かない。**

---

## 8. main に入れるまで（この手順のあと）

- 開発ストアで合格したら、#76 を main に入れる承認を T さんに取る（★ なのでマージの前の承認が要る）。
- 本番に出す前に要ること（#76 の本文のとおり）: Render の環境変数 `SCOPES`（公開用・自社用）に 4 つを足す・保護された顧客データの申請（自社用も）・プライバシーポリシーの作り直し（別の docs の PR）。
- 設定画面を 4 つに分ける案 A（T さん 5:10）は、#76 のあとに別の PR で入れる。

## 出典（2026-11-23 に開いて確かめた）

- dev preview は選んだ開発ストアだけ: https://shopify.dev/docs/apps/build/cli-for-apps/test-apps-locally
- `shopify app dev clean`: https://shopify.dev/docs/api/shopify-cli/app/app-dev-clean
- 保護された顧客データ（開発ストアは審査なし）: https://shopify.dev/docs/apps/launch/protected-customer-data
- POS UI extensions のプレビュー（Dev Console・QR コード）: https://shopify.dev/docs/apps/build/pos/getting-started
