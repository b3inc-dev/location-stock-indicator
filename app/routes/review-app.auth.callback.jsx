// app/routes/review-app.auth.callback.jsx
// GET /review-app/auth/callback — 他アプリのレビュー用認証コールバック。自社用 Render のみ有効。

export const loader = async () => {
  if (process.env.APP_DISTRIBUTION !== "inhouse") {
    return new Response("Not Found", { status: 404 });
  }
  return new Response("review auth callback ok", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};

export default function ReviewAppAuthCallback() {
  return null;
}
