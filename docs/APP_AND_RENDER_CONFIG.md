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
| **やること** | 公開用デプロイ時は `deploy:public`、自社用は `deploy:inhouse` を実行 | 自社用の Render に **一度** `APP_DISTRIBUTION=inhouse` を設定しておく。以降は push で両方デプロイされる |

---

## 4. それぞれにデプロイする手順

公開用と自社用は **別アプリ・別 Render** なので、**両方に反映したいときはそれぞれ 1 回ずつ**、次の流れで行います。

### 共通の前提

- コードの変更は **main にコミット済み** であること。
- まず `git push origin main` でリモートにプッシュしておく（Render の自動デプロイを使う場合に必要）。

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

- **自動デプロイ**: 公開用の Render サービス（location-stock-indicator）が **このリポジトリの main を監視**している場合は、`git push origin main` で自動的にビルド・デプロイされます。
- **手動デプロイ**: Render ダッシュボード → 公開用の Web サービス → **Manual Deploy** → **Deploy latest commit** を実行。

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

- **自動デプロイ**: 自社用の Render サービス（location-stock-indicator-ciara）が **このリポジトリの main を監視**している場合は、`git push origin main` で自動的にビルド・デプロイされます。
- **手動デプロイ**: Render ダッシュボード → 自社用の Web サービス → **Manual Deploy** → **Deploy latest commit** を実行。

※ 自社用の Render には、**自社用アプリの** `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` を設定してください。

---

### 4.3 両方に一度に反映したいときの流れ（まとめ）

| 順番 | やること | コマンド・操作 |
|------|----------|----------------|
| 1 | コードをリモートに反映 | `git push origin main` |
| 2 | 公開用の Shopify にデプロイ | `npx shopify app config use shopify.app.public.toml` → `npx shopify app deploy --force` |
| 3 | 自社用の Shopify にデプロイ | `npx shopify app config use shopify.app.toml` → `npx shopify app deploy --force` |
| 4 | 公開用・自社用の Render | それぞれのサービスが main を監視していれば push で自動。そうでなければ各 Render ダッシュボードから手動デプロイ |

- **Shopify のデプロイ**は toml を切り替えて **2 回**実行します（公開用 1 回・自社用 1 回）。
- **Render** は公開用・自社用で **別サービス** なので、main に push すると両方のサービスで自動デプロイが走る構成にしていれば、push 1 回で両方のバックエンドが更新されます。片方だけ手動でデプロイしたい場合は、該当する Render のダッシュボードからだけ実行すればよいです。

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

バックエンド（Node サーバー）は、それぞれの Render サービスが main ブランチを参照している場合、`git push origin main` でそれぞれ自動デプロイされます。手動で行う場合は、各 Render のダッシュボードから **Manual Deploy** を実行してください。

---

## 6. 他アプリのレビュー用エンドポイント（自社用 Render のみ）

Location Stock の自社用 Render（location-stock-indicator-ciara）を「借りて」、**別の Shopify アプリ**の審査用に次のパスを用意しています。認証だけ通したい場合に利用します。

| パス | 説明 |
|------|------|
| `GET /review-app` | レビュー用トップ。200 で `review app ok` を返す。 |
| `GET /review-app/auth/callback` | レビュー用認証コールバック。200 で `review auth callback ok` を返す。 |

- **有効になる条件**: 環境変数 `APP_DISTRIBUTION=inhouse` のときのみ 200 を返す。公開用 Render では 404 を返す。
- **実装**: `app/routes/review-app.jsx`（レイアウト）、`app/routes/review-app._index.jsx`、`app/routes/review-app.auth.callback.jsx`。
- **使い方**: 他アプリの Partners 設定で、App URL や認証コールバック URL を  
  `https://location-stock-indicator-ciara.onrender.com/review-app` および  
  `https://location-stock-indicator-ciara.onrender.com/review-app/auth/callback` に設定する。
