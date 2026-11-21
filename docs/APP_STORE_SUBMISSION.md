# App Store 提出チェックリスト — Location Stock（公開版）

- 対象: 公開アプリ「Location Stock」（`shopify.app.public.toml`、client_id `1758…1f48`、`https://location-stock-indicator.onrender.com`）
- 調べた日: 2026-11-20（Shopify の公開ページと、この時点の `main` と開いている PR）
- 目的: 12/3 までに App Store へ出すための確認表。**12 月に出す他のアプリでも同じ表を使えるように**、前半（1〜3 章）はどのアプリにも共通、後半（4 章から）はこのアプリだけの内容にしている。1〜3 章は POS Stock（`b3inc-dev/stock-transfer-pos` の `docs/APP_STORE_SUBMISSION.md`）と同じ文。
- この文書は docs だけの変更。アプリのコード・設定・本番・Partner の画面は何も変えていない。
- 既存の `docs/APP_REVIEW_SUBMISSION.md`（スコープの理由・データの扱い）と `docs/APP_STORE_SUBMISSION_RUNBOOK.md`（承認後の手順）はそのまま使う。食い違うときはこの文書を正とする。

## 印の意味

| 印 | 意味 |
|----|------|
| **【済】** | コードか設定で確かめた（根拠のファイルを書いている） |
| **【未】** | まだできていない。直す PR が要る |
| **【T】** | T が決める、または T が Partner / Render / 外部サービスで作業する |
| **【要確認】** | コードからは言い切れない。開発ストアで実際に試して確かめる |

---

## 1. いちばん大事なこと: 提出できる本数に上限がある

2026-11-10 から、Shopify は新しいアプリの提出に上限をかけている。

- **審査中にできる新しいアプリは 1 組織につき 1 本だけ**。提出してから公開されるまで、その 1 本が枠を使う。
- **すでに公開しているアプリがあるなら、その全部が「有料の Shopify プランで動いている店」10 店以上に入っていないと、次の新しいアプリを出せない**。開発ストアと無料体験中の店は数えない。数は 1 日 1 回更新。
- 公開済みアプリの更新や、審査中アプリの出し直しはこの上限に入らない。
- 新しいアプリを出す人は、Partner アカウントで**本人確認**を済ませておく必要がある。
- 却下のあと、指摘を直さずに出し直すと**待ち期間（cooldown）**が付き、繰り返すほど長くなる。
- 公開後 6 か月インストール 0 のアプリは自動で外される。

出典:
- https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review （Submission limits / App submission paused）
- https://shopify.dev/changelog/posts/shopify-app-store-submission-requirements-build-grow-then-expand

**このため「POS Stock と Location Stock を両方 12/3 までに出す」はそのままではできない。** 1 本目を出して公開され、さらに 10 店に入るまで 2 本目は出せない（b3inc にすでに公開アプリがあれば、そのアプリも 10 店が要る）。12 月の他アプリも同じ。どれを先に出すかは T が決める（8 章）。

---

## 2. 共通チェックリスト（どのアプリでも使う）

各行の「出典」は Shopify の公開ページ。番号（1.1.1 など）は App Store requirements の番号。
主な出典:
- 要件一覧: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- リスティングの書き方と数値: https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices
- 提出の手順: https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review

### 2.1 提出の前提（Partner / 組織）

| # | 確認すること | 出典 | 誰が |
|---|--------------|------|------|
| P1 | 1 章の上限にかからないか（審査中のアプリが他にない・公開済みアプリが 10 店以上） | submit-app-for-review | T |
| P2 | Partner アカウントの本人確認が済んでいる | changelog 2026-11-10 | T |
| P3 | 緊急連絡先（メール＋電話）を登録した（4.5.6） | requirements 4.5.6 | T |
| P4 | API 連絡先メールに「Shopify」の語（つづり違い・略も）が入っていない | submit-app-for-review | T |
| P5 | アプリの URL（ドメイン）に「Shopify」「Example」が入っていない | submit-app-for-review | コード側で確認 |
| P6 | 主な言語を選び、リスティングを 1 つ以上作った | submit-app-for-review | T |
| P7 | 保護された顧客データ: 要るなら申請、要らないなら「使わない」を選ぶ（**審査中は申請できない**） | submit-app-for-review | T（判断はコード調査をもとに） |
| P8 | 自動チェック（Automated checks）をすべて通した | submit-app-for-review | T（Partner で実行） |
| P9 | `noreply@shopify.com` を受信許可にした（審査の連絡が来る） | submit-app-for-review | T |

### 2.2 インストールと認証

| # | 確認すること | 出典 |
|---|--------------|------|
| A1 | インストールは Shopify の画面から始まる。**店のドメイン（myshopify.com）を手で入れさせない**（2.3.1） | requirements 2.3.1 |
| A2 | インストール直後・再インストール直後に、他の画面より先に OAuth（許可画面）が出る（2.3.2 / 2.3.4） | requirements 2.3.2, 2.3.4 |
| A3 | 許可のあと、アプリの画面へ移る（2.3.3） | requirements 2.3.3 |
| A4 | 埋め込みアプリは session token で認証し、サードパーティ Cookie なし・シークレットウィンドウでも動く（1.1.1） | requirements 1.1.1 |
| A5 | App Bridge の最新版を、ほかの script より先に読む（2.2.3） | requirements 2.2.3 |
| A6 | Admin API は GraphQL だけを使う（REST は新規の公開アプリでは不可）（2.2.4） | requirements 2.2.4 |
| A7 | 有効な TLS 証明書（3.1.1） | requirements 3.1.1 |
| A8 | **期限つきのオフライン アクセストークン**を使う（3.1.2） | requirements 3.1.2 |
| A9 | 必要なスコープだけを求める。理由を聞かれたら説明できる（3.2） | requirements 3.2 |

### 2.3 課金

| # | 確認すること | 出典 |
|---|--------------|------|
| B1 | 料金は Shopify App Pricing（旧 Managed Pricing）か Billing API だけで取る（1.2.1） | requirements 1.2.1 |
| B2 | 承認・辞退を正しく扱い、再インストール時はもう一度承認を求める（1.2.2） | requirements 1.2.2 |
| B3 | 店がサポートに連絡せず、再インストールもせずにプランを上げ下げできる（1.2.3） | requirements 1.2.3 |
| B4 | **Shopify App Pricing を使うなら、Billing API（`appSubscriptionCreate`）で新しい定期課金は作れない**。従量課金は App Events API で送り、上限額（cap）は使えない。公開プランは 8 つまで。開発ストアでは無料で試せる。プラン選択ページは `https://admin.shopify.com/store/:store_handle/charges/:app_handle/pricing_plans` | https://shopify.dev/docs/apps/launch/billing/managed-pricing |
| B5 | サブスクリプションが無い店は、プラン選択ページへ案内する | managed-pricing |
| B6 | リスティングの料金欄に、無料体験の日数や追加料金まで全部書く。画像やアイコンに値段を入れない（4.2.1〜4.2.3） | requirements 4.2 |

### 2.4 必須の webhook（顧客データの開示・削除）

| # | 確認すること | 出典 |
|---|--------------|------|
| W1 | `customers/data_request`・`customers/redact`・`shop/redact` を `compliance_topics` で登録する。**顧客データを持たないアプリも必須** | https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance |
| W2 | 受け取ったら 200 番台を返す。HMAC が正しくないときは 401 を返す。POST / JSON | privacy-law-compliance |
| W3 | 依頼された開示・削除は 30 日以内に終える。`shop/redact` はアンインストールの 48 時間後に届く | privacy-law-compliance |
| W4 | **ライブラリの `authenticate.webhook()` が返す `topic` は `CUSTOMERS_DATA_REQUEST` / `CUSTOMERS_REDACT` / `SHOP_REDACT` の大文字形**。`"customers/redact"` のような小文字・スラッシュの文字列と比べると一致せず、何も消さずに 200 を返してしまう | https://shopify.dev/docs/api/shopify-app-remix/latest/guide-webhooks （例の `switch` が大文字形） |

### 2.5 保護された顧客データ

| # | 確認すること | 出典 |
|---|--------------|------|
| D1 | 注文・返金・顧客・配送など「1 人の顧客や 1 件の注文につながるデータ」に触れるなら Level 1 以上。氏名・住所・電話・メールに触れるなら Level 2 | https://shopify.dev/docs/apps/launch/protected-customer-data |
| D2 | 公開アプリは Level 1 も Level 2 も審査がある。許可がないフィールドは消されて返る | protected-customer-data |
| D3 | Level 1 の約束: 必要最小限・目的を店に伝える・保存期間を決める・保存時も通信時も暗号化 など | protected-customer-data |

### 2.6 画面の質

| # | 確認すること | 出典 |
|---|--------------|------|
| Q1 | 審査を止めるエラー（404・500 など）や、一部を止める表示崩れがない（2.1.1 / 2.1.2） | requirements 2.1 |
| Q2 | どこから開いても画面で操作できる（2.1.3） | requirements 2.1.3 |
| Q3 | Shopify 管理画面・アプリ・他の連携先のデータが食い違わない（2.1.4） | requirements 2.1.4 |
| Q4 | テンプレートのままの画面・ダミー文言が残っていない（審査員が開いたときの印象。2.1.2 の表示の問題として指摘されうる） | requirements 2.1.2 |

### 2.7 POS UI extension（POS で動くアプリ）

| # | 確認すること | 出典 |
|---|--------------|------|
| S1 | POS で始められる操作は、すべて最後まで終えられる | best-practices（POS） |
| S2 | アプリの画面は POS のアプリ一覧（POS Apps）から開ける | best-practices（POS） |
| S3 | リスティングに POS の画面のスクリーンショットを入れる | best-practices（POS） |
| S4 | POS からサーバーへの通信は `getSessionToken()` のトークンを `Authorization` に付け、サーバー側で検証する。トークンが空のときは失敗として扱う。アプリの権限が無いスタッフではトークンが出ない | https://shopify.dev/docs/api/pos-ui-extensions/latest/target-apis/standard-apis/session-api |
| S5 | Shopify 以外の POS とつなぐアプリは不可（1.1.8） | requirements 1.1.8 |

### 2.8 テーマ拡張とストアの速さ（オンラインストアに出すアプリ）

| # | 確認すること | 出典 |
|---|--------------|------|
| T1 | テーマの変更は theme app extension だけで行う（5.1.1） | requirements 5.1.1 |
| T2 | テーマエディタとストアでエラーなく表示（5.1.2） | requirements 5.1.2 |
| T3 | アプリブロック・アプリ埋め込みの設定手順を詳しく書く。ディープリンクを強くすすめる（5.1.3） | requirements 5.1.3 |
| T4 | **Lighthouse の performance スコアを 10 点より多く下げない**。重みはホーム 17%・商品ページ 40%・コレクション 43%。何回か測って平均する | best-practices（Performance） |
| T5 | 上限: Liquid 合計 100 KB（強制）・ブロック 30 個（強制）・ロケールファイル 1 つ 15 KB（強制）・スキーマから読む JS は圧縮後 10 KB まで（目安）・CSS 100 KB まで（目安） | https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration |
| T6 | オンラインストアに機能を足すなら「オンラインストアが必要」を選ぶ（4.3.1） | requirements 4.3.1 |

### 2.9 リスティング

数値は https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices より。

| 項目 | 決まり |
|------|--------|
| アプリ名 | 30 文字以内。Dev Dashboard（toml の `name`）とリスティングで同じか、共通の語を含む（4.1.1）。他のアプリ・ブランドと紛らわしくない、独自の呼び名で始める（4.1.2） |
| アイコン | 1200×1200 px、JPEG か PNG。角は自動で丸くなるので余白をとる。文字・スクショ・Shopify の商標・他社ロゴを入れない |
| アプリカードのサブタイトル | 文字数の決まりは書かれていない。機能ではなく店にとっての良さを書く。キーワードの詰め込み・数字を入れない（4.4.1） |
| 紹介文（App introduction） | 100 文字 |
| 詳細（App details） | 500 文字。機能の並べただけにしない（4.4.2） |
| 機能リスト | 1 つ 80 文字まで |
| フィーチャー画像／動画 | 動画は 2〜3 分（画面録画は 25% まで）。画像なら 1600×900 px（16:9）、代替テキストを付ける |
| スクリーンショット | 1600×900 px（16:9）、パソコン用 3〜6 枚、少なくとも 1 枚はアプリの画面。ブラウザの枠・個人情報・値段・レビュー・成果の保証を写さない。代替テキストを付ける。POS のアプリは POS の画面も入れる。1 枚ずつ違う機能・状態にする（4.4.5） |
| デモストア URL | 開発ストアの、いちばん見せたいページへ直接リンク＋説明 |
| 検索語 | 5 つまで。1 語に 1 つの意味 |
| 料金 | 「無料」「定期」「1 回払い」から選ぶ。有料プランは 14 日の無料体験をすすめる |
| プライバシーポリシー | **必須**（URL）。利用規約は任意 |
| サポート | Shopify 向けのヘルプページ。FAQ・更新履歴などは宣伝ページでなく専用ページへ |
| 言語 | アプリの画面が対応している言語だけを書く（4.3.2） |
| 禁止 | 根拠のない数字・「初の」「一番の」「唯一の」・レビューや推薦文（4.3.3〜4.3.7） |
| インストール条件 | 必要な販売チャネル（オンラインストア / POS）と国などを指定（4.3.8） |

### 2.10 審査用の資料

| # | 確認すること | 出典 |
|---|--------------|------|
| R1 | 画面録画（デモ screencast）: 初期設定から主な機能まで順に見せる。**英語の音声か英語字幕が必須**（4.5.3） | requirements 4.5.3 |
| R2 | テスト手順にログイン情報を書き、ずっと使える状態にしておく（4.5.4） | requirements 4.5.4 |
| R3 | 二段階認証・ワンタイムコードが要らないテスト用アカウント（4.5.5） | requirements 4.5.5 |

---

## 3. 新しいアプリでこの表を使う手順

1. この文書をそのアプリのリポジトリの `docs/APP_STORE_SUBMISSION.md` にコピーする。
2. 2 章はそのまま残し、4 章以降をそのアプリ用に書き換える。
3. 2 章の各行について、そのアプリのコードで「【済】【未】【T】【要確認】」を付ける（4 章の表）。
4. 特に毎回見落としやすいもの: 2.4 の W4（topic の形）、2.2 の A1（ドメイン入力のログイン画面）、2.3 の B4（App Pricing と Billing API の混在）、1 章の提出上限。

---

## 4. Location Stock の確認結果（2026-11-20 の `main` = `6ec93f6`）

### 4.0 2026-11-21 の進み具合（`main` = `d342ec8`）

4.1・4.2 は 11/20 の調べのまま残し、そのあとの動きをここにまとめる。

| ID | 内容 | 今の状態 | PR |
|----|------|----------|----|
| G1 | 課金の承認画面へ `_top` で移る・`APP_HANDLE` の既定値 | **PR あり（draft）**。レビュー済み。開発ストアでの確認待ち → T の承認 | #43 |
| G2 | 開発ストアでテスト課金（`test: true`） | **PR あり（draft）**。#43 に入っている。本番では `SHOPIFY_BILLING_TEST` を効かせない | #43 |
| G3 | 必須 webhook の topic の形 | **済**（main に入った） | #41 |
| G4 | ドメインの入力欄・ダミー文 | **済**（main に入った）。`app.additional.jsx` も消えている（G8） | #42 |
| G4 | `redirect_urls` の食い違い（`/api/auth` だけ） | **PR あり（draft）**。公開用 toml に `/auth/callback` を足す。deploy は T | #47 |
| G5 | Admin API 2025-10 → 2026-07 | **PR あり（draft）**。レビュー済み。開発ストアで一通りの確認待ち → T の承認 | #44 |
| G6 | Lighthouse | **未**。開発ストアのストアで、アプリ無し／有りを各 3 回以上測る（JS は 69 KB・圧縮前） | — |
| G7 | テーマエディタへのリンクと設定手順（5.1.3） | **PR あり（draft）**。#17 を今の main に合わせて作り直した | #46 |
| G8 | テンプレートの「Additional page」 | **済**（main に無い） | #42 |
| G9 | 画面録画・スクショ・アイコン・プライバシーポリシー・サポート窓口 | **T** | — |
| A9 | `read_markets` の理由 | **済（この PR）**。`APP_REVIEW_SUBMISSION.md` §2 に足した | #40 |
| — | ストアの表示の安定（Render のログのエラー） | **PR あり**。レビュー済み・main に追いついた → T の承認 | #27・#30 |

- 4 つ（#27・#30・#43・#44）を一緒に main へ入れても衝突せず、テスト 69 件が通ることを確かめた（11/21）。
- T が決めること（8 章）は変わっていない。特に **T5（料金の決め方）** は #43 の作り（Billing API）をそのまま使うか、POS Stock と同じ App Pricing にそろえるかで、#43 が要るかどうかが変わる。


### 4.1 状態の一覧

| # | 項目 | 状態 | 根拠・メモ |
|---|------|------|-----------|
| A1 | ドメインを手で入れさせない | **【未】** | `app/routes/_index/route.jsx` がテンプレートのまま。アプリの URL を直接開くと「Shop domain」の入力欄と「A short heading about [your app]」のダミー文が出る。`app/routes/auth.login/route.jsx` も同じ |
| A2/A3 | インストール直後の OAuth とアプリ画面への移動 | 【済】（【要確認】） | toml の `[access_scopes]` で Shopify 管理のインストール。`app/shopify.server.js` は `AppDistribution.AppStore`。Ciara 以外の開発ストアで実際に入れて確かめる |
| A2 | 許可後の戻り先 | 【要確認】 | 公開 toml の `redirect_urls` は `/api/auth` だが、アプリの認証の道は `/auth`（`authPathPrefix: "/auth"`）。Shopify 管理のインストールでは使われないはずだが、A1 のログイン欄から入ると戻れない可能性がある。A1 を直すときに合わせて `/auth/callback` 等へそろえる |
| A4/A5 | session token・App Bridge | 【済】 | `@shopify/shopify-app-react-router` の `authenticate.admin` と `AppProvider`（`app/routes/app.jsx`） |
| A6 | GraphQL のみ | 【済】 | `admin.graphql` だけ |
| A8 | 期限つきオフライントークン | 【済】 | `app/shopify.server.js` の `future.expiringOfflineAccessTokens: true` |
| A9 | 必要なスコープだけ | 【済】（【T】） | `read_inventory,read_locations,read_products,read_shipping,read_markets,write_app_proxy`。`write_products` は外し済み。**`read_markets` の理由が `APP_REVIEW_SUBMISSION.md` §2 に無い**ので、Permission justification に足す（市場別の配送設定の判定に使う。`docs/MARKET_DRIVEN_SHIPPING_ATTESTATION.md`）。公開 Render の `SCOPES` が toml と同じかを T が確認 |
| P5 | ドメインに Shopify / Example なし | 【済】 | `location-stock-indicator.onrender.com` |
| API 版 | 期限 | **【未】** | `app/shopify.server.js` が `ApiVersion.October25`（2025-10）。Shopify は各版を少なくとも 12 か月支える約束で、2025-10 は 2026-10 ごろが目安。webhook は `2026-01`。**2026-01 以降へ上げる** |
| B1 | Shopify の課金だけ | 【済】 | Billing API（`app/utils/billing.js` の `appSubscriptionCreate`） |
| B2 | 承認画面への移動 | **【未】** | `app/routes/app.plan.jsx` の action が react-router の `redirect(confirmationUrl)` を返している。埋め込み画面（iframe）の中から Shopify の承認ページへ移るには `authenticate.admin` が返す `redirect(url, { target: "_top" })` が要る。POS Stock では同じやり方が iframe 内で拒まれた記録がある（`stock-transfer-pos` の `app/routes/app.plan.tsx` のコメント）。**課金の承認画面が開かない可能性が高い** |
| B2 | 開発ストアでの試し | **【要確認】** | `appSubscriptionCreate` に `test: true` を付けていない。開発ストアは `getShopPlan` で Pro 扱いになるので、審査員が課金の流れを見られない／見ようとすると失敗するおそれ。審査用には開発ストアで `test: true` の課金を通せるようにする |
| B4 | App Pricing と Billing API | **【T】** | このアプリは Billing API で課金を作る作り。Partner の料金設定を **「Shopify App Pricing」にすると `appSubscriptionCreate` は使えない**。POS Stock は App Pricing の作りなので、2 つのアプリでやり方が違う。6 章でそろえ方を決める |
| B4 | プラン選択 URL | **【未】** | `app.plan.jsx` の `APP_HANDLE` が環境変数 `SHOPIFY_APP_HANDLE` が無いと `"app"` になり、間違った URL になる（POS Stock は `pos-stock` を既定にして直した） |
| B5 | 未契約の店 | 【済】 | 公開・本番で未契約なら管理画面は `/app/plan` へ（`app/routes/app.jsx`）、ストアの在庫も出さない（`app/utils/planGate.js`、`apps.location-stock.js` の `plan_required`） |
| W1 | 必須 webhook の登録 | 【済】 | 公開 toml の `compliance_topics` → `/webhooks/compliance` |
| W2 | 200 / 401 | 【済】 | `app/routes/webhooks.compliance.jsx`。HMAC が違うと `authenticate.webhook` が 401 を投げる |
| W3/W4 | 実際に消す | **【未】** | `topic === "shop/redact"` などの小文字の形と比べている。ライブラリの topic は `SHOP_REDACT` の形なので一致せず、`shop/redact` でセッションを消す処理に入らない（今はアプリの DB がセッションだけで、アンインストールの webhook でも消すので害は小さい）。**PR #23（店頭受取・配送）で受取のテーブルが増えると、顧客の削除依頼が効かなくなる**。今のうちに直す |
| D1 | 保護された顧客データ | 【済】（【T】） | `main` では顧客・注文に触れない。Partner では「使わない」を選ぶ。**PR #21〜#23（POS Lite の受取・配送）を入れるなら注文に触れるので、提出前に方針を決める**（1 本目の審査には入れない方が早い） |
| Q1/Q4 | テンプレートの残り | **【未】** | `app/routes/app.additional.jsx` が残っている（URL で開ける）。`_index` のダミー文（A1） |
| T1 | theme app extension だけ | 【済】 | `extensions/location-stock-theme`（ブロック 1 つ、`target: "section"`） |
| T2 | テーマエディタで表示 | 【要確認】 | 審査で使う Dawn など無料テーマで、エディタとストアの両方を確かめる |
| T3 | 設定手順・ディープリンク | **【未】** | アプリのホームからテーマエディタへ飛ぶリンクが `main` に無い。PR #17（draft）がその案 |
| T4 | Lighthouse で 10 点より下げない | **【未】（測っていない）** | 商品ページに `assets/location-stock-indicator.js`（約 69 KB、圧縮前）を `defer` で読む。目安の「圧縮後 10 KB」を超える見込み。アプリ無し／有りで商品ページ・コレクション・ホームを各 3 回以上測り、記録を残す |
| T5 | 上限 | 【済】 | Liquid 合計 約 37 KB（ブロック 8.7 KB＋スニペット 28 KB）で 100 KB 未満。ロケールファイルは `en.default.json` だけ（141 B） |
| T6 | オンラインストアが必要 | 【T】 | Partner で「Merchant must have online store」を選ぶ |
| 言語 | 画面の言語 | **【T】** | 管理画面と、テーマエディタのブロック設定の名前（`blocks/location-stock-indicator.liquid` の `label`）が日本語だけ。リスティングの対応言語は「日本語」だけにする（4.3.2）。英語で出すなら PR #18（英語の管理画面・スキーマ）を入れてから |
| 公開版の URL | 自社用の値が混ざらない | 【済】 | 公開 toml は公開用の URL だけ。コードに Ciara の店名・URL は無い（`CUSTOM_APP_STORE_IDS` と `APP_DISTRIBUTION` の環境変数だけ）。**公開 Render でこの 2 つと `FORCE_PLAN_LITE` が空なこと**を T が確認 |
| データ | アンインストール後の設定 | 【済】（メモ） | 設定と集計はショップのメタフィールド `location_stock.config` などに残る（アンインストール後はアプリから消せない）。顧客を特定する情報は入れていない。プライバシーポリシーにこのことを書く |

### 4.2 提出を止める問題（直す順）

| 順 | ID | 内容 | 直す場所 | 大きさ |
|----|----|------|----------|--------|
| 1 | G1 | 課金の承認画面へ iframe の中から移ろうとしている＋`APP_HANDLE` の既定値 `"app"` | `app/routes/app.plan.jsx` | 小 |
| 2 | G2 | 審査員が開発ストアで課金の流れを試せない（`test: true` が無い・開発ストアは Pro 扱い） | `app/utils/billing.js`、`app/utils/shopPlan.server.js` | 小〜中 |
| 3 | G3 | 必須 webhook の topic の形の違い | `app/routes/webhooks.compliance.jsx` | 小 |
| 4 | G4 | アプリ URL を直接開くと店のドメイン入力欄とダミー文（2.3.1）＋ `redirect_urls` の食い違い | `app/routes/_index/route.jsx`、`app/routes/auth.login/route.jsx`、両 toml | 小 |
| 5 | G5 | API 版 2025-10 | `app/shopify.server.js` | 小（動作確認が要る） |
| 6 | G6 | Lighthouse を測っていない・JS が大きい | 測定 → 必要なら JS を分ける・小さくする | 中 |
| 7 | G7 | テーマエディタへのディープリンクと設定手順（5.1.3） | PR #17 | 小 |
| 8 | G8 | テンプレートの「Additional page」 | `app/routes/app.additional.jsx` を消す | 小 |
| 9 | G9 | 画面録画・スクショ・アイコン・プライバシーポリシー・サポート窓口 | 5〜7 章 / T | T |

**この PR では直していない**（docs だけ）。直すときは別の `claude/` ブランチで 1 つずつ PR にする。

### 4.3 開いている PR との関係

- #17（ホームからテーマエディタへのリンク）: G7。審査の前に入れたい。
- #18（英語の管理画面とスキーマ）: 英語のリスティングで出すなら必要。日本語だけで出すなら後でよい。
- #21〜#23（POS Lite の受取・配送）: 注文・顧客に触れ、保護された顧客データの申請が要る。**1 本目の審査には入れない**ことをすすめる（入れるなら G3 を先に）。
- #27（App Proxy の Response の扱い）・#30（在庫の読み直し）: ストアの表示の安定に関わる。審査前に入れるかは T が決める。
- #14・#29・#34・#35: 画面の見た目や切り分け。審査とは別。

---

## 5. リスティング文案（案）

文字数は空白込みで数えた目安。Partner の入力欄で最終確認する。

### 5.1 日本語

- **アプリ名**: Location Stock（14 文字）
  - 注意: 一般的な語の組み合わせ。4.1.2 で指摘されたら「B3 Location Stock」などにする。toml の `name` も合わせる。**T が決める**
- **サブタイトル**: どの店舗に在庫があるかを、商品ページでお客様に見せる
- **紹介文（100 文字以内）**: 商品ページに店舗ごとの在庫を表示。お客様が近くの店で買えるか、受け取れるかをすぐ確かめられます。（48 文字）
- **詳細（500 文字以内）**:

```
複数の店舗や倉庫がある店のためのアプリです。商品ページに、選ばれているバリエーションの在庫を店舗ごとに表示します。

表示は「在庫あり」「残りわずか」「在庫なし」の印や数で出せます。印の境目、表示する店舗、店舗の表示名と並び順は管理画面で決められます。

Pro プランでは、店舗をエリアごとにまとめて表示したり、お客様の現在地から近い店舗を先に並べたりできます。店頭受け取りができる店舗には「この店舗で受け取る」ボタンを出せます。表示やボタンが押された回数は日ごとに確認できます。

テーマエディタで商品ページにブロックを足すだけで使えます。テーマのコードは書き換えません。

お客様の氏名やメールなど、個人を特定する情報は保存しません。
```

- **機能リスト（各 80 文字以内）**:
  1. 商品ページに、選ばれたバリエーションの店舗別在庫を表示
  2. 在庫あり・残りわずか・在庫なしの境目と表示の文言を設定
  3. 表示する店舗・表示名・並び順を管理画面で決める
  4. 店舗をエリアごとにまとめ、近い店舗から並べる（Pro）
  5. 店頭受け取りができる店舗に受け取りボタンを表示（Pro）
  6. ブロックの表示とボタンのクリック数を日ごとに確認（Pro）
- **検索語（5 つまで）**: 店舗在庫 / 在庫表示 / 店頭受け取り / 複数店舗 / 在庫状況
- **販売チャネルの条件**: オンラインストアが必要
- **対応言語**: 日本語（PR #18 を入れたら English も）

### 5.2 English

- **App name**: Location Stock
- **Subtitle**: Show shoppers which of your stores has the item in stock
- **Introduction (≤100)**: Show stock by store on product pages, so shoppers know where to buy or pick up today.（85 文字）
- **Details (≤500)**:

```
For shops with more than one store or warehouse. The app shows stock for the selected variant at each location, right on the product page.

Show stock as In stock, Low stock or Out of stock, or as a number. In admin, set the thresholds, choose which locations to show, and set their names and order.

On Pro, group stores by area, list the nearest stores first, and add a Pick up here button for stores with local pickup.

Add the block in the theme editor. No theme code is changed.
```

- **Features (≤80 each)**:
  1. Show per-location stock for the selected variant on product pages
  2. Set low-stock thresholds, labels and messages
  3. Choose which locations to show, with their names and order
  4. Group stores by area and list the nearest first (Pro)
  5. Add a Pick up here button for stores with local pickup (Pro)
  6. See daily views and button clicks for the block (Pro)
- **Search terms**: store stock / local inventory / store pickup / multi location / stock status

---

## 6. 料金案（**T が決めるための案**。まだ決まっていない）

いまのコードの前提（`app/utils/billing.js`・`app/utils/planGate.js`）:
- Lite: US$20 / 30 日、10 店舗まで、基本の在庫表示と並び順。無料体験 7 日。
- Pro: US$20 / 30 日 ＋ 1 店舗 US$2 の従量（上限 US$500）。エリア・近隣・店頭受け取り・分析。無料体験 14 日。
- 未契約は在庫を出さない（無料プランなし）。
- プランの判定はサブスクリプション名（`Lite` / `Pro` を含むか）。

**案 A（すすめる）: Shopify App Pricing にそろえ、従量なしの 2 プラン**

| プラン名 | 月額 | 無料体験 | 内容 |
|---|---|---|---|
| Lite | US$15 | 14 日 | 10 店舗まで。在庫表示・印の境目・表示する店舗と並び順 |
| Pro | US$39 | 14 日 | 店舗数の制限なし。Lite＋エリア・近隣・店頭受け取り・分析 |

- 理由: POS Stock と同じやり方（App Pricing）にでき、G1・G2（承認画面への移動・開発ストアでの試し）を Shopify のプラン選択ページに任せられる。App Pricing は開発ストアで無料で試せる。
- 必要な修正: `app.plan.jsx` を POS Stock と同じ「プラン選択ページへ `_top` で移る」形に変え、`appSubscriptionCreate` と従量の報告をやめる。
- 金額は案。US$15 / US$39 は今の「Pro は店舗数で上がる」をやめて分かりやすくした場合の例。

**案 B: 今のコードのまま（Billing API で Lite $20 ／ Pro $20＋$2×店舗）**
- Partner の料金設定は App Pricing ではなく手動（Billing API）にする。G1・G2 を直す必要がある。
- 店舗が多い店ほど Pro が高くなる。上限 US$500。

**案 C: 無料プラン＋有料**
- 「Free（3 店舗まで、基本表示）」を足すと、1 章の「10 店」に届きやすい（アプリが無料でも、有料の Shopify プランの店なら数える）。

---

## 7. スクリーンショット撮影リスト

共通: 1600×900 px。開発ストアに**作った架空のデータ**（店名・住所・商品）を入れて撮る。ブラウザの枠・本物の店名・値段は写さない（商品価格が写る場合は商品ページの価格部分を外して切り取る）。代替テキストを 1 枚ずつ付ける。

| 順 | 画面 | 開き方 | 見せること | 代替テキスト（案） |
|----|------|--------|-----------|-------------------|
| 1 | 商品ページ（パソコン） | 開発ストアの商品ページ（Dawn） | ブロックの店舗別在庫の一覧。在庫あり・残りわずか・在庫なしが混ざる状態 | 商品ページに表示された店舗ごとの在庫 |
| 2 | 商品ページ（スマホ表示） | 同じ商品をスマホの幅で表示し、1600×900 の背景に置く | 近い店舗が先に並ぶ状態（Pro） | スマホの商品ページで近い店舗から並んだ在庫 |
| 3 | 店頭受け取りボタン | 受け取りができる店舗の行のボタンを押す | ボタンと案内のモーダル（Pro） | 店舗の在庫の横にある受け取りボタン |
| 4 | 管理画面 ロケーション設定 | アプリ → ロケーション設定（`/app/locations`） | 表示する店舗・表示名・並び順・エリア | 表示する店舗と並び順を決める画面 |
| 5 | 管理画面 在庫表示設定 | アプリ → 在庫表示設定（`/app/settings`） | 印の境目・ラベル・文言 | 在庫の印と境目を決める画面 |
| 6 | 管理画面 分析 | アプリ → 分析（`/app/analytics`） | 日ごとの表示回数とクリック数（架空のデータ） | ブロックの表示とクリックの日別の集計 |

予備: テーマエディタでブロックを足した画面（Shopify の画面が写るが、使い方の説明としては可。Shopify のロゴを主役にしない）。料金プラン画面（`/app/plan`）は**値段が写るので使わない**（4.2.2）。

### 画面録画（審査用・英語字幕）の流れ（3 分ほど）

1. 開発ストアでアプリをインストール → 許可 → アプリのホームが開く
2. 料金プラン → プランを選ぶ（課金の流れ。G1・G2 を直したあと）
3. ロケーション設定で表示する店舗と並び順を決めて保存
4. 在庫表示設定で印の境目を決めて保存
5. ホームのリンクからテーマエディタを開き、商品ページにブロックを足して保存
6. ストアの商品ページで店舗別の在庫を確認 → バリエーションを変えて表示が変わることを確認
7. （Pro）近い店舗の並び・受け取りボタン・分析の画面

---

## 8. T が決めること・やること

| # | 内容 | いつまで |
|---|------|----------|
| T1 | **どのアプリを最初に出すか**（1 章の上限のため 1 本ずつ）。b3inc にすでに公開アプリがあるか、その店数 | すぐ |
| T2 | Partner の本人確認・登録料・緊急連絡先・API 連絡先メール（「Shopify」を含まない） | 提出前 |
| T3 | **サポート用メールアドレス**とサポートページの URL | 提出前 |
| T4 | **プライバシーポリシーの置き場所**（会社サイトの専用ページ、または利用者ヘルプのサイト。PR #25 のヘルプのサイトと同じ場所が自然）と本文の確認。4.1 の「データ」の行の内容を入れる | 提出前 |
| T5 | 料金（6 章の案 A / B / C）。**POS Stock と同じやり方（App Pricing）にそろえるか** | G1・G2 の前 |
| T6 | 英語で出すか（PR #18）、日本語だけで出すか | リスティング作成前 |
| T7 | アプリ名を「Location Stock」のままにするか | リスティング作成前 |
| T8 | 公開 Render の環境変数: `APP_DISTRIBUTION`・`CUSTOM_APP_STORE_IDS`・`FORCE_PLAN_LITE` が空、`SCOPES` が toml と同じ、`SHOPIFY_APP_HANDLE` が公開アプリのハンドル | 提出前 |
| T9 | Ciara 以外の開発ストア（同じ Partner 組織のもの）で、インストール → プラン選択 → 設定 → ブロック追加 → 商品ページ → アンインストール → 再インストール を通す。審査用のログイン（二段階認証なし）を用意 | G1〜G4 が入ったあと |
| T10 | Lighthouse の測定（アプリ無し／有り、各 3 回以上）をだれがやるか | 提出前 |
| T11 | G1〜G8 を直す PR を出してよいか（main へのマージ・公開版の deploy は毎回 T の承認） | すぐ |

---

## 9. 参照（Shopify 公式）

- App Store requirements: https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements
- Best practices（リスティングの数値・Lighthouse）: https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices
- Submit your app for review（提出手順・上限・待ち期間）: https://shopify.dev/docs/apps/launch/app-store-review/submit-app-for-review
- 提出上限の告知（2026-11-10）: https://shopify.dev/changelog/posts/shopify-app-store-submission-requirements-build-grow-then-expand
- Privacy law compliance（必須 webhook）: https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
- Webhook の topic の形（例の `switch`）: https://shopify.dev/docs/api/shopify-app-remix/latest/guide-webhooks
- Protected customer data: https://shopify.dev/docs/apps/launch/protected-customer-data
- Shopify App Pricing: https://shopify.dev/docs/apps/launch/billing/managed-pricing
- Theme app extension の上限: https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
- App block の JS の大きさの目安（10,000 bytes）: https://shopify.dev/docs/storefronts/themes/tools/theme-check/checks/asset-size-app-block-javascript
