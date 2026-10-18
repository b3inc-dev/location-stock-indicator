# 環境別デプロイ手順（承認後のみ）

設定・共通運用の正本は [APP_AND_RENDER_CONFIG.md](APP_AND_RENDER_CONFIG.md)。開発・検証は [DEVELOPMENT.md](DEVELOPMENT.md)。以下は参照用であり実行承認ではない。main直push・force pushは禁止。

## 1. 対象と影響を確定する

| 対象 | 設定ファイル | Render |
|---|---|---|
| 販売用 | `shopify.app.public.toml` | location-stock-indicator |
| Ciara | `shopify.app.toml` | location-stock-indicator-ciara |

`shopify.app.ciara.toml`は存在しない。設定名の変更・複製は今回行っていない。CLIの最後のconfig選択や設定指定なしdeployに依存せず、client_id・URL・scope・対象アプリ名を実ファイルと照合する。

両Renderがrepo main / On Commitを監視することは2026-10-04の [PR #2最終監査](https://github.com/b3inc-dev/location-stock-indicator/pull/2) に記録済み。build=`npm install && npm run build`、preDeploy空、start=`npm run setup && npm run start`。setupはPrisma migrationを含む。これはGitHub監査記録に基づく情報で、実行直前に再確認する。Dockerfileの存在だけでRenderをDocker deployと判断しない。

共通backend変更をmainへmergeすると両サービスが更新される。片方だけに反映したい場合はこの経路を実行せず、影響の分離方法を設計・レビューする。監視設定・env変更を無断で行わない。

## 2. 承認前に揃えるもの

- 対象PR・base/HEAD、変更範囲、販売用/Ciara用への影響
- 品質結果・App Proxy/GraphQL/Theme検証・未確認項目
- 対象Shopify app/client_idとRenderサービス、現在の設定・release状態
- backendとextensionの互換性に応じた反映順、確認項目、rollback候補と承認条件

main merge・production deploy・本番env/ストア設定・App Proxy URL/OAuth scope変更はユーザーの明示承認を得る。過去の承認を再利用しない。

## 3. 承認後のShopify反映

```bash
# 販売用
shopify app deploy --config shopify.app.public.toml

# Ciara用
shopify app deploy --config shopify.app.toml
```

承認された対象だけを実行。CLIのアプリ名・client_idを照合し、不一致なら停止。確認省略のforceフラグは通常手順に含めない。Shopify deployは設定・extensionsのapp version作成/releaseであり、hosted backendはdeployしない。[Shopify公式](https://shopify.dev/docs/api/shopify-cli/app/app-deploy)

## 4. 承認後のbackend反映・確認

main mergeは承認されたPR/commitだけ。両Renderのauto-deployを監視し、Live SHA・build/startログ・応答を確認する。手動Render deploy/rollbackは別途明示承認時のみ。

backendのHTTP200だけで成功と扱わない。対象ストアのProxy認証・レスポンスok・variant切替・Theme表示・両版のプラン制御を、承認された確認範囲で検証する。販売用GETには課金報告経路、分析には書込みがあるため、本番確認の副作用も事前に示す。障害時は記録して停止し、無断でrollbackしない。

CLI認証エラー時は状態・公式仕様を調査する。credential保存先を削除する旧復旧手順は採用しない。
