import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <style>{`
          body {
            margin: 0;
            font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", Meiryo, "Noto Sans JP", "Noto Sans CJK JP", "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: #202223;
          }
          a:focus-visible,
          button:focus-visible,
          input:focus-visible,
          select:focus-visible,
          textarea:focus-visible {
            outline: 2px solid #2c6ecb;
            outline-offset: 2px;
          }
        `}</style>
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
