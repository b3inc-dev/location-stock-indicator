// Only replay an unanswered query. Authentication refresh, throttling and writes
// have separate policies. Share the one retry across both sides of a refresh.
function isUnansweredFetch(result) {
  return !result.ok && !result.authFailure && result.error instanceof Error &&
    result.error.message === "Http request error, no response available: GraphQL Client: fetch failed";
}

export function createInventoryRead(read, signal) {
  let canRetry = true;
  return async (...args) => {
    let result = await read(...args);
    if (isUnansweredFetch(result) && canRetry && !signal?.aborted) {
      canRetry = false;
      result = await read(...args);
    }
    return isUnansweredFetch(result) ? { unavailable: true } : result;
  };
}
