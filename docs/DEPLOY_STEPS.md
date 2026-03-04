# コミット後のプッシュ・公開・自社用デプロイ手順

## 1. プッシュ（未実施分）

コミットは済んでいます。リモートへプッシュするには、ターミナルで以下を実行してください。

```bash
cd /Users/develop/ShopifyApps/location-stock-indicator
git push origin main
```

- GitHub に HTTPS でプッシュする場合は、認証（パスワードまたはトークン）が求められます。
- SSH でプッシュする場合は、あらかじめ `git remote set-url origin git@github.com:...` で SSH URL に変更してください。

---

## 2. 公開（Shopify へのデプロイ）

テーマ拡張やアプリ設定を Shopify に反映するには、以下を実行します。

```bash
cd /Users/develop/ShopifyApps/location-stock-indicator
npx shopify app deploy --force
```

- 初回やログアウト後は `npx shopify auth login --store=あなたのストア.myshopify.com` でログインが必要な場合があります。
- **「Failed to access local storage (set): RangeError: Maximum call stack size exceeded」** が出た場合は、次のコマンドで CLI の設定フォルダを削除してから再度 `shopify app deploy` を実行してください。

  ```bash
  rm -rf ~/Library/Preferences/shopify-cli-app-nodejs
  npx shopify app deploy --force
  ```

- 公開用（App Store 用）の設定でデプロイする場合は、事前に次のように設定します。

  ```bash
  npx shopify app config use shopify.app.public.toml
  npx shopify app deploy --force
  ```

---

## 3. 公開用・自社用の「それぞれにデプロイ」する手順

このプロジェクトは **公開用と自社用で別アプリ・別 Render** です。**両方にデプロイする具体的な手順**は次のドキュメントにまとめています。

- **`docs/APP_AND_RENDER_CONFIG.md`** の **「4. それぞれにデプロイする手順」**

流れの要点だけここに書くと次のとおりです。

1. **`git push origin main`** でコードをリモートに反映（Render の自動デプロイを使う場合に必要）。
2. **公開用**: `npx shopify app config use shopify.app.public.toml` → `npx shopify app deploy --force`。公開用の Render は push で自動、または手動デプロイ。
3. **自社用**: `npx shopify app config use shopify.app.toml` → `npx shopify app deploy --force`。自社用の Render は push で自動、または手動デプロイ。

---

## まとめ

| やりたいこと | 手順・参照 |
|--------------|------------|
| コードをリモートに反映 | `git push origin main` |
| 公開用・自社用の**それぞれにデプロイ** | **`docs/APP_AND_RENDER_CONFIG.md` の「4. それぞれにデプロイする手順」** を参照 |
| 環境変数・スコープ・トラブルシュート | `docs/DEPLOY_AND_SCOPES.md` |
