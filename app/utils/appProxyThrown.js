/**
 * App Proxy の catch に入った値を分ける。
 * authenticate.public.appProxy は署名が無効なとき Response（status 400）を throw する。
 * それは期待される応答であり、予期しない障害として文字列化しない。
 */

/**
 * @param {unknown} error
 * @returns {error is Response}
 */
function isResponse(error) {
  return typeof Response !== "undefined" && error instanceof Response;
}

/**
 * @param {unknown} error
 * @returns
 *   | { kind: "expected_response", response: Response, log: { status: number } }
 *   | { kind: "unexpected", message: string, logMessage: string }
 */
export function classifyAppProxyThrown(error) {
  if (isResponse(error)) {
    return {
      kind: "expected_response",
      response: error,
      log: { status: error.status },
    };
  }

  if (error instanceof Error) {
    return {
      kind: "unexpected",
      message: error.message,
      logMessage: error.message,
    };
  }

  return {
    kind: "unexpected",
    message: "在庫情報の取得中にエラーが発生しました。",
    logMessage: "non_error",
  };
}
