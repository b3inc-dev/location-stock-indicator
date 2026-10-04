#!/usr/bin/env node
/**
 * npm run preview:pr -- <PR番号>
 * Switch the Preview worktree to the latest HEAD of the given PR.
 * Does not change the main worktree branch. Stops safely if dirty.
 */

import {
  checkoutPrInPreview,
  die,
  info,
  PREVIEW_URL,
  reportPackageAndPrismaChanges,
  requirePreviewWorktree,
  resolvePrHead,
  repoRoot,
} from "./preview-lib.mjs";

const root = repoRoot();
const prArg = process.argv[2];

if (!prArg) {
  die(
    [
      "使い方: npm run preview:pr -- <PR番号>",
      "例: npm run preview:pr -- 27",
    ].join("\n  "),
  );
}

const previewDir = requirePreviewWorktree(root);
const pr = resolvePrHead(prArg, root);
info(`PR #${pr.number} HEAD を解決しました (${pr.source}): ${pr.sha.slice(0, 7)}`);

checkoutPrInPreview(pr, previewDir, root);
reportPackageAndPrismaChanges(previewDir, root);

console.log("");
info(`確認: cd ${previewDir} && npm run preview:dev`);
info(`ブラウザ: ${PREVIEW_URL}`);
console.log("");
