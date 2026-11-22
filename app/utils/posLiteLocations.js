// 「店頭受取・配送」の画面で使うロケーションの一覧（親の画面と区分の編集の画面で同じものを使う）。
import { numericId } from "../../extensions/pos-lite/src/logic.js";

export const POS_LITE_LOCATIONS_QUERY = `#graphql
  query PosLiteLocations {
    locations(first: 250, includeInactive: false) { nodes { id name } }
  }
`;

/** @param {(query: string, variables?: object) => Promise<any>} run */
export async function loadPosLiteLocations(run) {
  const data = await run(POS_LITE_LOCATIONS_QUERY, {});
  return (data?.locations?.nodes || []).map((node) => ({ id: numericId(node.id), name: node.name }));
}
