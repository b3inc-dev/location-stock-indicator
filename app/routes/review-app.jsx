// app/routes/review-app.jsx
// 他アプリのレビュー用認証エンドポイント用レイアウト（自社用 Render のみで使用）
// Location Stock のサーバーを借りて /review-app および /review-app/auth/callback を提供する

import { Outlet } from "react-router";

export default function ReviewAppLayout() {
  return <Outlet />;
}
