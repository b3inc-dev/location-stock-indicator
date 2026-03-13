// app/routes/review-app._index.jsx
// GET /review-app — 他アプリのレビュー用。自社用 Render（APP_DISTRIBUTION=inhouse）のみ有効。

export const loader = async () => {
  if (process.env.APP_DISTRIBUTION !== "inhouse") {
    return new Response("Not Found", { status: 404 });
  }
  return new Response("review app ok", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};

export default function ReviewAppIndex() {
  return null;
}
