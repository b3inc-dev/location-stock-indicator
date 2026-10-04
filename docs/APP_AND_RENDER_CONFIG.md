> Agent運用: 以下の本番手順は参照用です。専用branchからPRを作り、main反映は承認済みPRのmergeで行います。本番手動deploy・Shopify release・本番env変更は明示承認後のみ。今回の初期設定では実行しません。

# 公開用・自社用アプリと Render の設定一覧

このプロジェクトでは **公開用** と **自社用** で **別々の Shopify Partners アプリ** と **別々の Render サービス** を使います。どの toml がどの環境を指すか、どこに情報があるかをまとめます。

---

## 1. toml と環境の対応

| ファイル | 用途 | Shopify アプリ（Partners） | Render サービス（URL） |
|----------|------|----------------------------|------------------------|
| **shopify.app.public.toml** | 公開用（App Store 等） | Location Stock（client_id: `1758d63a004d7f7d99afe5bf334d1f48`） | location-stock-indicator.onrender.com |
| **shopify.app.toml** | 自社用（カスタムアプリ） | Location Stock - Ciara（client_id: `61b474b801b754166b12f0b9cd07f450`） | location-stock-indicator-ciara.onrender.com |

- **デフォルトで使う toml**: `shopify app config link` や `shopify app deploy`、**`shopify app dev`** で「現在の設定」として使われるのは、最後に `shopify app config use <ファイル>` で指定した方です。
- 公開用でデプロイするときは `shopify.app.public.toml`、自社用のときは `shopify.app.toml` を指定してからデプロイします。

### 開発時（dev）に公開用アプリを使う

- **方法1（毎回切り替え）**: dev を起動する前に、公開用の toml を指定してから `dev` を実行します。
  ```bash
  npx shopify app config use shopify.app.public.toml
  npm run dev
  ```
- **方法2（スクリプトで一発）**: 公開用で dev を起動する専用スクリプトを使います。
  ```bash
  npm run dev:public
  ```
  自社用（カスタムアプリ）で dev したいときは `npm run dev:custom` を使います。
- 一度 `config use` した toml は、次に別の toml を指定するまで「現在の設定」として残ります。そのため、公開用で dev したあと、`npm run dev` だけ実行すると、次回も公開用のままになります。自社用に戻したいときは `npx shopify app config use shopify.app.toml` を実行してください。

### PR Preview Workflow

オープンな PR の最新 HEAD を、本体 worktree の branch を切り替えずにローカル確認するための手順です。Preview 専用 worktree はリポジトリ隣の `../ciara-system-preview` です。通常の `npm run dev`（port 3000）と競合しないよう、Preview は **port 3001** 固定です。

```text
初回: npm run preview:setup → cd ../ciara-system-preview → npm run preview:dev
以後: npm run preview:pr -- <PR番号>
ブラウザ: http://127.0.0.1:3001
確認後の指示例: 「プレビュー確認済み。問題ないので本番反映まで進めて。」→ 既存 production release workflow へ
```

`preview:setup` / `preview:pr` は本体リポジトリで実行する。`preview:dev` は Preview worktree 内、または本体から（Preview worktree を指定して起動）のどちらでもよい。

| コマンド | 役割 |
|----------|------|
| `npm run preview:setup` | Preview 専用 worktree を安全に作成、または既存を再利用（二重作成しない）。本体 branch は切り替えない |
| `npm run preview:pr -- <PR番号>` | 指定 PR の最新 HEAD へ Preview worktree だけを切替（`gh`、失敗時は `refs/pull/<PR>/head`）。存在しない PR は明確にエラー。dirty（未コミット変更）なら破棄せず停止 |
| `npm run preview:dev` | Preview を `http://127.0.0.1:3001` で起動（`--localhost-port 3001 --use-localhost --no-update`） |

補足:

- `preview:pr` 時に `package.json` / `package-lock.json` が `origin/main` から変わっていれば、`cd ../ciara-system-preview && npm ci` が必要である旨を表示する（既存環境破壊を避けるため自動実行しない）。
- Prisma schema / migrations の差分は警告のみ。`db push`・migration apply・production DB 接続・production sync は**絶対に自動実行しない**。
- Preview worktree が dirty のとき `git reset --hard` / `git clean -fd` は使わない。
- 既定の Preview パスはリポジトリ隣の `../ciara-system-preview`。書き込み不可な環境では `LOCATION_STOCK_PREVIEW_DIR` で上書きできる。
- 本番反映（承認済み PR の main merge 等）は既存の本番リリース手順・承認ゲートに従う。本 workflow 自体は merge / deploy を行わない。

---

## 2. 各環境で必要な設定

### 2.1 toml に書く URL

- **公開用**  
  - `application_url` / `redirect_urls` / `app_proxy.url`  
  - すべて `https://location-stock-indicator.onrender.com` ベース

- **自社用**  
  - `application_url` / `redirect_urls` / `app_proxy.url`  
  - すべて `https://location-stock-indicator-ciara.onrender.com` ベース

### 2.2 Render の環境変数

- **公開用の Render（location-stock-indicator）**  
  - そのアプリの `SHOPIFY_API_KEY`（= client_id 公開用）  
  - そのアプリの `SHOPIFY_API_SECRET`  
  - `SCOPES`（read_inventory, read_locations, read_products, read_shipping, write_app_proxy, write_products など）  
  - その他: `DATABASE_URL`、必要なら `RENDER_EXTERNAL_URL` など

- **自社用の Render（location-stock-indicator-ciara）**  
  - 自社用アプリの `SHOPIFY_API_KEY`（= client_id 自社用）  
  - 自社用アプリの `SHOPIFY_API_SECRET`  
  - 同じスコープでよい場合は上記と同じ `SCOPES`  
  - **`APP_DISTRIBUTION=inhouse`**（必須）… カスタムアプリを「自社用」と判定し、プラン制限なし・全機能（Pro 相当）で動作させる。未設定だと公開アプリ同様に Lite/Pro 判定になり、Lite と表示される。  
  - その他: `DATABASE_URL`、必要なら `RENDER_EXTERNAL_URL` など

※ 詳細は `docs/DEPLOY_AND_SCOPES.md` の「6. バックエンドの環境変数」を参照してください。
※ **公開用の Render** では `APP_DISTRIBUTION` は未設定（または `public`）のままでよい。

---

## 3. 設定情報が書いてある場所

| 内容 | 記載場所 |
|------|----------|
| 公開用・自社用の **client_id / 名前 / URL** | このファイル（APP_AND_RENDER_CONFIG.md）と **各 toml ファイル** |
| デプロイの流れ・公開と自社の切り替え | `docs/DEPLOY_STEPS.md` |
| 環境変数・スコープ・missing_admin_client 対策 | `docs/DEPLOY_AND_SCOPES.md` |
| 同じアプリか別アプリか・1 回でよいか | `docs/DEPLOY_AND_SCOPES.md` の「4. デプロイは公開用と自社用に分けて実行しなくて問題ない？」 |

**注意**: API シークレットやパスワードは toml やドキュメントに **書かない** でください。Render の Environment やシークレット管理にだけ入れます。

### 2.3 公開／自社の切り分け（POS Stock との違い）

| 項目 | POS Stock | Location Stock |
|------|-----------|----------------|
| **切り分けのタイミング** | **デプロイ時**（`npm run deploy:public` / `deploy:inhouse` で `appUrl.js` の APP_MODE を書き換え→該当 toml で deploy） | **Render の環境変数**（公開用・自社用で **別サービス** なので、自社用の Render にだけ `APP_DISTRIBUTION=inhouse` を設定） |
| **理由** | POS 拡張が「どちらのバックエンド URL を呼ぶか」を **ビルド時に** 決めるため、デプロイするアプリに合わせて APP_MODE を変える必要がある | ストアフロントは App Proxy の URL が **アプリごとに Partner で設定**されているため、同じコードでよい。バックエンドは「今どちらのサービスか」を **実行時の環境変数** で判定する |
| **やること** | 公開用デプロイ時は `deploy:public`、自社用は `deploy:inhouse` を実行 | 自社用の Render に **一度** `APP_DISTRIBUTION=inhouse` を設定しておく。以降は各Renderの監視設定に従い承認済みPRのmain mergeでbackendが反映される（公開用の実設定は未確認） |

---

## 4. それぞれにデプロイする手順

公開用と自社用は **別アプリ・別 Render** なので、**両方に反映したいときはそれぞれ 1 回ずつ**、次の流れで行います。

### 共通の前提

- まず専用branchをpushしてPRを作成する。
- main反映は承認済みPRのmergeで行う。本番手順の実行前にmerge対象commitを確認する。

---

### 4.1 公開用にデプロイする

**やること**: 公開用の Shopify アプリにテーマ拡張などを反映し、公開用の Render でバックエンドを動かす。

#### Step 1: Shopify に公開用アプリをデプロイ

```bash
cd /Users/develop/ShopifyApps/location-stock-indicator

# 公開用の toml を指定
npx shopify app config use shopify.app.public.toml

# デプロイ（テーマ拡張・App Proxy の設定などが Shopify に送られる）
npx shopify app deploy --force
```

- 初回やログアウト後は `npx shopify auth login --store=公開用で使うストア.myshopify.com` でログインが必要な場合があります。
- 成功すると、Partners の「Location Stock」アプリに新しいバージョンがリリースされます。

#### Step 2: 公開用の Render にバックエンドをデプロイ

- **自動デプロイ**: 公開用の Render サービス（location-stock-indicator）が **mainを監視しauto-deployが有効**な場合、承認済みPRのmain mergeでbackendのビルド・deployが始まります（外部実設定は未確認）。
- **手動デプロイ（明示承認後のみ）**: Render ダッシュボード → 公開用の Web サービス → **Manual Deploy** → **Deploy latest commit** を実行。

※ 公開用の Render には、**公開用アプリの** `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` を設定してください（`docs/DEPLOY_AND_SCOPES.md` の「6. バックエンドの環境変数」参照）。

---

### 4.2 自社用にデプロイする

**やること**: 自社用の Shopify アプリ（Location Stock - Ciara）にテーマ拡張などを反映し、自社用の Render でバックエンドを動かす。

#### Step 1: Shopify に自社用アプリをデプロイ

```bash
cd /Users/develop/ShopifyApps/location-stock-indicator

# 自社用の toml を指定
npx shopify app config use shopify.app.toml

# デプロイ
npx shopify app deploy --force
```

- 成功すると、Partners の「Location Stock - Ciara」アプリに新しいバージョンがリリースされます。

#### Step 2: 自社用の Render にバックエンドをデプロイ

- **自動デプロイ**: 自社用 `location-stock-indicator-ciara` はGitHub main監視・On Commit auto-deployを2026-10-04に確認済み。承認済みmain mergeでbackend production build/deployが始まります（末尾の再監査参照）。
- **手動デプロイ（明示承認後のみ）**: Render ダッシュボード → 自社用の Web サービス → **Manual Deploy** → **Deploy latest commit** を実行。

※ 自社用の Render には、**自社用アプリの** `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` を設定してください。

---

### 4.3 両方に一度に反映したいときの流れ（まとめ）

| 順番 | やること | コマンド・操作 |
|------|----------|----------------|
| 1 | 専用branchをpushしPR作成 | `git push origin <feature-branch>`。main反映は承認済みPRのmerge |
| 2 | 公開用の Shopify にデプロイ | `npx shopify app config use shopify.app.public.toml` → `npx shopify app deploy --force` |
| 3 | 自社用の Shopify にデプロイ | `npx shopify app config use shopify.app.toml` → `npx shopify app deploy --force` |
| 4 | 公開用・自社用の Render | main監視かつauto-deploy有効なら承認済みPRのmain mergeで自動。手動deployは別途明示承認後のみ |

- **Shopify のデプロイ**は toml を切り替えて **2 回**実行します（公開用 1 回・自社用 1 回）。
- **Render** は公開用・自社用で **別サービス** なので、両方がmain監視かつauto-deploy有効なら、承認済みPRのmain mergeで両方のbackendが更新されます。片方だけ手動でデプロイしたい場合は、該当する Render のダッシュボードからだけ実行すればよいです。

---

## 5. デプロイ時のコマンド例（参照用）

```bash
# 公開用でデプロイ（Shopify にアプリを公開）
npx shopify app config use shopify.app.public.toml
npx shopify app deploy --force

# 自社用でデプロイ
npx shopify app config use shopify.app.toml
npx shopify app deploy --force
```

バックエンド（Node サーバー）は、それぞれのRenderサービスがmainを監視しauto-deploy有効なら、承認済みPRのmain mergeで自動deployされます。明示承認後に手動で行う場合のみ、各 Render のダッシュボードから **Manual Deploy** を実行してください。


## Cursor・Codex・Claude Code 共通開発運用

GitHub のコード・Issue・PR を正本とし、共通指示は `AGENTS.md` と本書に保存する。ツールの個人メモだけで仕様を確定しない。

`AGENTS.md`は入口と制約、PROJECT_CONTEXT / ARCHITECTURE / BUSINESS_RULES / SHOPIFY / DECISIONSは横断調査サマリ、本書はowner・引き継ぎ・作業分離・品質・release条件の正本とする。横断サマリから本書へ参照し、共通workflowを複製しない。既存deploy docsのmain直push記述はPR経由に読み替える。

- 1 logical workstream = 1 owner agent/tool = 1 branch/worktree/PR。同じworkstreamを3ツールが同時編集しない。
- 開始前にGitHub Issue/PRでownerを確認し、担当未確定なら確定してから編集する。別workstreamも変更範囲の重複を確認する。
- mainへのdirect commit/push・force pushは禁止。GitHub正本から専用branch/worktreeを作り、変更ファイルだけをstageする。他者の未コミット変更・Theme Editor由来commitを保持する。
- Backlogは候補一覧であり実行指示ではない。依頼された範囲以外へ勝手に着手しない。
- 調査→設計→実装→品質確認→独立レビュー→Readyの順。仕様競合は編集前に報告する。既存のSMALL/MEDIUM/HIGH RISK分類・DoD・自動merge条件がある場合は維持し、出典不明なら推測で補わない。
- HIGH RISKはReadyで停止し、人間の明示承認後のみmergeする。今回の初期設定ではproduction releaseを伴うmergeも承認待ち。本番手動deploy/publish/rollbackは行わない。
- secrets/token/本番credentialsをrepo・Issue・PR・ログへ保存しない。.env.exampleは必要な変数名と非secretの例のみ。既存接続を置換せず、MCP追加は必要性・権限・credential保存先を先に確認する。

### 3ツール間の引き継ぎ

前ownerは編集・自動処理を止め、commitと作業状態をIssue/PRへ記録して所有権を解放する。次ownerは記録・HEAD・未コミット差分を確認して引き継ぎを明記してから編集する。ownerが不明なら同時着手しない。

Issue本文またはPR本文/コメントに以下を記録する（secretを含めない）:

```text
Workstream:
Owner tool / agent: Cursor | Codex | Claude Code / 担当名
State: Investigating | Working | Ready | Handing off | Done
Branch / worktree:
Base / HEAD commit:
Scope / files:
Risk / 既存分類の根拠:
Quality: コマンド・結果・未実行理由
Independent review:
Unfinished / blockers:
Next action:
Release impact / approval:
Handoff: 前owner停止確認・次owner受領
```

### ツールの読込・権限確認

- Cursor: repo rootのAGENTS.mdと`.cursor/rules/shared-agent-entry.mdc`から共通docsを読む。既存のscoped rule・User/Team Rulesも確認する。
- Codex: repo rootから起動してAGENTS.mdを読む。`.codex/config.toml`は`approval_policy = "on-request"`・`sandbox_mode = "workspace-write"`を指定。信頼済みprojectのみproject configを読込む。管理設定・起動引数・ユーザー設定が上書きする可能性を確認する。
- Claude Code: CLAUDE.mdの`@AGENTS.md` importを使う。既存CLAUDE.md・個人設定・MCP接続を保持する。`/context`のMemory filesと`/memory`で読込先を確認する。
- 全ツールでFull Access・承認全面省略へ変更しない。docsは行動指示であり、GitHub保護や各ツールの実権限の代わりではない。
- 新規セッションで「読込済み指示ファイル、owner、PR base、本番操作の停止条件を挙げて。編集・外部操作はしない」と依頼し、回答と実際のファイルを照合する。別ツールを検証する際もownerを変更しない。

読込仕様の参照: [Cursor Rules](https://cursor.com/docs/rules)、[Codex AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)、[Claude Code memory/imports](https://code.claude.com/docs/en/memory)。

### Shopify App のリリース境界と品質

OAuth・scopes・webhooks・App Proxy・billing・inventory/order mutation・本番env変更はHIGH RISK。手動production deployは明示承認時のみ。旧手順のmain直pushは使わず、PR経由に読み替える。`shopify app deploy`によるShopify設定/拡張のreleaseと、hosted backendのdeployは別経路。開発時も本番アプリのURLを更新しないようapp/config/storeの接続先を確認する。

Renderの下記確認済みサービスはmainを監視しOn Commit auto-deploy。main merge = backend production releaseとして扱い、今回は人間承認までmergeしない。Shopify app config/extension releaseは別経路で、Render deployだけではShopify版のreleaseを意味しない。

品質ゲートはpackage.jsonに存在するlint/typecheck/buildを実行し、存在しないtestコマンドを捏造しない。開発用credentialsが必要な検証は未実行理由をPRに残す。本番DBへのmigrationや接続を品質確認に使わない。

外部API変更時は既存helperのretry上限/backoff・429/GraphQL throttle・error/userErrors処理を確認する。mutationはタイムアウト後の成功不明状態を含めidempotencyと再送を確認し、read用retryをそのまま適用しない。全経路の網羅性・rate limit・secret/log redactionが未確認なら注意点として残し、初期設定ではrefactorしない。

### repoから確認した運用証拠（2026-10-04）

`shopify.app.toml`はLocation Stock - CiaraのURL、`shopify.app.public.toml`は公開用URLを指定。既存本書にRender public/inhouse手順があるが、GitHub→RenderのCiara用サービスはDashboardでGitHub main/On Commit auto-deployを確認。公開用サービスの実設定は未確認。`package.json`のdeployはShopify release、backend build/startと別経路。既存billing idempotency参照: `app/utils/billing.js`、`app/utils/shopPlan.server.js`。外部API全体の共通retry/429処理・idempotency・error/log redactionの網羅性は未確認。

### 初期設定監査（2026-10-04、本番コード/deploy設定変更なし）

main protectionなし（API404 Branch not protected）、rulesetなし。GitHub Actions workflowなし、GitHub auto-merge機能は無効。ツールによる既存merge運用とこのAPI設定は別物として扱う。提案はmainのPR必須・force push/削除禁止・必須人間review 0・bypassなし。存在しないCI checkをrequiredに追加しない。保護設定適用は差分を提示して人間承認後のみ。

品質: build/typecheck成功。lint失敗: 72 errors / 2 warnings。 実行Nodeは24.11.1、既存ローカルnode_modulesを再利用したためNode20での完全再現は未確認。アプリコードの差分はなし。既存gateエラーは初期設定PRでrefactorせず別課題とする。

ツール: Cursor desktop CLI 3.23.12、Codex CLI 0.160.0、Claude Code 2.1.246、Shopify CLI 3.88.1。Codexはread-only実セッションで共通指示と参照docsを読み、owner/PR/停止条件/引き継ぎを確認。Cursorの実Agent読込は未確認（cursor-agentは未検出）、Claude Codeは未ログインで実セッション未確認。rootから起動して上記の無編集確認promptを実行し、Claudeは/contextのMemory files、Cursorは適用ルールを照合する。

既存権限/接続: Codexユーザー設定にapproval/sandboxの明示キーはなく、このPRはrepo側だけsafe defaultを追加。repo設定はon-request/workspace-writeを維持するが、再監査時のこのCodex desktop sessionは起動側のdanger-full-access/approval neverで上書きされている。repo設定だけでは実効権限を保証できないため、通常開発ではdesktopの承認・sandbox表示を確認して開始する。今回こちらからFull Accessへ変更した事実はない。Cursor CLIはapprovalMode=allowlistだがsandbox.mode=disabled（既存ユーザー設定を保持、要確認）。Claudeユーザー設定はallow 28件・defaultMode明示なし。Edit(**)、git push、npx prisma、gcloud buildsの広いallowがある。production禁止はdocs上の指示でありpermission denyではない。未ログインのため実効モードとimportは未確認。個人権限は変更していない。Codex/ Cursorの既存MCP、App repoのShopify MCPは保持し、新規MCP・credentialsを追加しない。個人認証/接続情報はコピーしていない。

承認後の更新: 2026-10-04にユーザー承認を受けmain ruleset `main-pr-required-no-force-push` をactiveで適用し、有効ルールをGETで再確認済み。PR必須、force push/削除禁止、required approvals=0、追加承認/Code Owner/last push approvalは無効、bypassなし。required checksは追加せず、既存auto-merge設定は変更していない。

独立レビュー: 別Agentによる読み取りレビューで旧deploy手順の矛盾を修正し、重大な追加指摘なし。実行できないツール/外部設定と既存品質エラーは上記・PRで未確認/未完了として残す。

### 外部設定・品質再監査（2026-10-04）

Render `location-stock-indicator-ciara`（srv-d4qd9qeuk2gs73fl1970）は `b3inc-dev/location-stock-indicator` / main / On Commit。Root Directory/Build Filters未指定、build=`npm install && npm run build`、preDeploy空、start=`npm run setup && npm run start`。公開用 `location-stock-indicator`（srv-d4mglachg0os73bqvbq0）のSettingsはブラウザ操作対象が切り替わり未確認。Dashboard→各サービス→SettingsでSource/Branch/Auto-Deploy/Build Filtersを確認する。

GitHub main `d374f0be` とPRを同じNode24/依存/envで比較し、lint 72 errors/2 warningsの指摘が同一、双方typecheck成功。今回差分による新規失敗なし。正式Green baselineは未成立。

### 依頼ごとに自動で行う作業分離

ユーザーは変更内容を通常の言葉で依頼するだけでよい。Cursor・Codex・Claude Codeの担当toolは、編集前に次を自律実行し、branch/worktreeの作成・再利用について毎回の確認を求めない。

1. 実作業path・GitHub remote・branch・dirty状態・既存worktreeを確認し、GitHub Issue/PRの進行中workstream/owner/範囲/依存と照合する。依頼が読み取りだけならworktree作成は不要。
2. 同じworkstreamを自分が継続中なら専用branch/worktree/PRを再利用する。他toolがownerなら編集せず、停止とhandoffを確認する。新しい独立workstreamならGitHubの最新base（Themeはstaging、他repoはmain）から専用branch＋isolated worktreeを作る。Codex新規branchはcodex/を既定とし、各toolの既存命名規約を保持する。
3. 原checkoutの未commit変更を勝手に移動・stash・破棄しない。作業pathが専用worktree、branchが保護base以外、ownerが自分であることを確かめてから編集する。base追従は現在のworkstreamと競合を確認し、他者の履歴を書き換えない。
4. owner tool/agent・branch/worktree・base/HEAD・scope・quality・未完了・次actionをIssue/PRへ記録し、関連品質確認と必要な独立reviewまで進める。依頼外Backlogへ着手しない。merge/releaseは既存の分類・DoD・承認条件に従う。本依頼のproduction merge停止は継続する。

実行環境がworktree作成を許可しない場合は共有mainへ編集せず、具体的な制約と最小限の対応を報告する。これは各toolの読込後の行動規則であり、GUIでworktree作成を強制する仕組みや権限の全面省略ではない。PR未mergeの間はこのbranchの規則を読めるセッションで利用し、共有baseへの反映後は新規セッションで読込を確認する。
