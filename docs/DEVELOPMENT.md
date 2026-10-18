# Codex継続開発・検証手順

共通owner/引き継ぎ運用の正本は [APP_AND_RENDER_CONFIG.md](APP_AND_RENDER_CONFIG.md)、仕様は [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) と既存詳細docs。通常ownerはCodex。ユーザーはこのチャットで依頼し、合理的に判断できる作業はPR作成まで進める。

## 1. 毎回の開始順

1. `git fetch origin`。
2. `git status --short --branch`、remote、既存worktree、open PRのowner/範囲/HEADを確認。dirty変更を移動・stash・破棄しない。
3. GitHub `origin/main` の最新commitを確認。共有mainを無理にpullせず、新規作業は最新baseから `codex/<workstream>` の専用branch/worktreeを作る。継続中なら担当worktreeを再利用する。
4. `shopify.app*.toml` のclient_id・URL・scope・Webhookを照合。販売用=`shopify.app.public.toml`、Ciara用=`shopify.app.toml`。不存在のciara設定名やCLIの前回選択へ依存しない。
5. App Proxy → Admin GraphQL → config/stocks → Theme JS/Liquidの依存を確認。API version・response shape・variantイベントを調査する。
6. Renderの監視branch・auto-deploy・build/start・env参照を確認。最新の監査証拠をPRに記載し、外部設定を取得できなければ未確認と記す。

他tool ownerのopen PRは読み取り参照だけ。編集は停止とhandoffを確認してから。2026-10-04時点のPR #3はCursor担当のPreview作業で、npm preview scriptsはmain未反映。本手順はその完了を前提にしない。

## 2. 専用worktreeの準備

Nodeはpackage.json enginesに従う。DockerfileはNode20、直近ローカル監査はNode24.11.1で、同じ実行環境とは扱わない。既存repoで `shopify app init` やconfig linkをやり直さない。

```bash
# <worktree-path> は他checkoutと異なる新規パス
# <workstream> は依頼内容に対応する名称
git worktree add -b codex/<workstream> <worktree-path> origin/main
cd <worktree-path>
npm ci
```

開発ストアdomain・開発用app/client_id・テーマ・検証商品variant ID・プラン条件は検証開始前に確定し、secret以外をPRへ記録する。未確定ならローカル品質確認を先に進める。secret/tokenはログ・PR・repoに保存しない。

env一覧とコード参照は [SHOPIFY.md](SHOPIFY.md) §5。`SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` / `SCOPES` / `SHOPIFY_APP_URL` は環境別。Ciaraの `APP_DISTRIBUTION=inhouse` と公開版のLite/Proを混同しない。`CUSTOM_APP_STORE_IDS`、`FORCE_PLAN_LITE`は挙動に影響するので検証条件に含める。値を取得・複写せず、既存のsecret管理を使う。

Prismaは `prisma/schema.prisma` の `file:dev.sqlite` 固定で、DATABASE_URLを読んでいない。dev起動はshopify.web.tomlのPrisma migrationを伴うため、専用worktreeの開発SQLiteであることを確認する。両tomlの `automatically_update_urls_on_dev=true` に注意し、本番appへ接続した通常devでURLを更新しない。承認された開発接続でCLIの `--no-update` 対応を確認してからpreviewを起動する。本番URL/scope/ストア設定変更は承認待ち。

## 3. 品質確認

```bash
npm run lint
npm run typecheck
npm run build
```

test scriptが追加された場合は `npm test` も実行する。現時点ではscript・unit/integrationテストなし。未実行を成功と記さず、挙動変更に必要なテストだけ追加する。既存baselineはlint72 errors/2 warnings、typecheck/build成功（2026-10-04監査）。既存失敗は同条件のbaseと比較し、指摘一致を確認してPRに残す。過去の例外承認は新PRへ流用しない。

### App Proxy・GraphQL

- 開発ストアの商品ページから署名付きApp Proxyを通し、正常variant、在庫なし/空配列、variant_id欠落、取得失敗を確認。Renderの直接URLは認証付きProxy検証の代わりにならない。
- HTTP statusだけでなく `ok` / `error` / `message` を確認。正常時 `variantId` / `variantTitle` / `stocks` / `config`、stockのlocationId/locationName/displayName/quantity/fulfillsOnlineOrdersと設定を既存contractと比較する。
- inventoryLevelsはfirst250、配送クエリにも固定上限がある。GraphQLのnodes/edges、null、errors/userErrorsとavailable数量の扱いを確認する。API versionはshopify.server.jsとtomlのWebhookで別。
- mutationのidempotency・失敗/再送を確認。SDK内部retryをrepo共通のretry保証と推測しない。
- `getShopPlan`は販売用本番Pro条件で従量課金報告を行う。ProxyのGETも本番で無副作用とは限らない。分析イベントもmetafieldを書き込む。本番ストアをテスト先に使わない。

### Theme表示

開発ストアの非公開テーマ/extension previewでdesktopとmobileを確認。variant切替（variant:change/input change）、閾値以下/中間/以上、数量・凡例・空/エラー表示、並び/公開名/非表示、LiteとPro/inhouseの差を変更範囲に応じて確認。近隣/店舗受取変更は位置情報・カートへの影響も確認。画像・検証条件をPRに残す。接続不可ならコード追跡の結果と未確認項目を明記し、表示確認済みと扱わない。

## 4. 自己レビュー・PR

変更ファイルだけをstage。App Proxy後方互換性、GraphQL response shape、Theme、両版、credentials/DB、依頼外変更を自己レビューする。既存方針で必要な独立レビューは読み取りで行う。結果と未完了を記録し、feature branchをpushしてmain向けPRを作成する。

PR本文の必須項目:

- Workstream / owner Codex / state / branch・worktree / base・HEAD / scope
- 販売版への影響、Ciara版への影響
- App Proxy変更有無、GraphQL変更有無、Theme Extension変更有無
- lint/typecheck/test/build結果と実行環境、実ストア/表示検証の結果または未実行理由
- 自己レビュー・必要な独立レビュー、未完了、次action
- deploy時の注意点、release影響、承認待ちの操作

main merge、production Shopify/Render deploy、本番env・ストア設定変更、App Proxy URL/OAuth scope変更はこのチャットの明示承認まで停止。公開用/Ciara用片方だけのbackend反映は現在の共通main経路では保証できない。手順は [DEPLOY_STEPS.md](DEPLOY_STEPS.md)。
