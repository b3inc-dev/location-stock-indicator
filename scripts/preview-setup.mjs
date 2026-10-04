#!/usr/bin/env node
/**
 * npm run preview:setup
 * Create or reuse the Preview-only git worktree at ../ciara-system-preview
 * without switching the main worktree branch.
 */

import {
  ensurePreviewWorktree,
  info,
  ok,
  PREVIEW_URL,
  previewPath,
  repoRoot,
} from "./preview-lib.mjs";

const root = repoRoot();
const { path: target, created } = ensurePreviewWorktree(root);

console.log("");
ok(created ? "Preview setup 完了（新規作成）" : "Preview setup 完了（再利用）");
info(`path: ${target}`);
info(`初回起動: cd ${previewPath(root)} && npm run preview:dev`);
info(`以後の PR 切替: npm run preview:pr -- <PR番号>  （本体リポジトリで実行）`);
info(`ブラウザ: ${PREVIEW_URL}`);
console.log("");
