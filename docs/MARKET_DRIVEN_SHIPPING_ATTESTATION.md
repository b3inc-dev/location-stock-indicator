# マーケット主導配送 — 互換性自己申告手順（フォーム送信はしない）

本アプリは merchant-owned `deliveryProfiles` を**読み取る**在庫表示アプリ。公式 Option B（`Market.delivery` + `ShopFeatures.marketDrivenShipping` 分岐）のコード対応は PR #12（`cursor/market-driven-shipping-0b95`）。  
**このドキュメントは手順のみ。Partners／Dev Dashboard の申告フォームは送信しない**（ユーザーが検証後に実施）。

公式: [Upgrade your app for market-driven shipping](https://shopify.dev/docs/apps/build/orders-fulfillment/market-driven-shipping/upgrade-your-app)

---

## 1. コード反映後の前提

1. PR #12 を承認・merge（本手順では merge しない）。
2. 公開用・自社用それぞれ `shopify app deploy`（scopes に `read_markets`）。
3. 各 Render の `SCOPES` に `read_markets` を追加（toml と一致）。
4. 既存インストールで「権限の更新」または再インストール（`read_markets` 承認）。

---

## 2. 検証（申告前）

1. **Legacy 店**: 既存の配送プロファイル店で App Proxy／ロケーション設定の「配送対応」「ローカルデリバリー対応」が従来どおり付くこと。
2. **MDS preview 店**: Dev store 作成時に Market-driven shipping feature preview を有効化し、同様にフラグが付くこと（`Market.delivery.shipping` 経路）。
3. 失敗時は Render ログの `markets delivery` / `deliveryProfiles` 警告とスコープを確認（秘密は出さない）。

---

## 3. 互換性自己申告（ユーザー作業）

検証合格後、公式の **compatibility self-attestation** フォームを提出する（Dev Dashboard の警告クリア・商家自動移行の円滑化）。  
自動検出もあるが、フォーム提出が保証。**エージェント／本 PR ではフォームを送らない。**

---

## 4. 実施状況

| 項目 | 状態 |
|------|------|
| コード（Option B） | PR #12（draft） |
| Shopify deploy / 再認可 | **未実施** |
| MDS preview 実地検証 | **未実施** |
| 互換性自己申告フォーム | **未実施**（送信しない） |
