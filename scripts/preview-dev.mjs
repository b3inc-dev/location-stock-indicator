#!/usr/bin/env node
/**
 * npm run preview:dev
 * Run shopify app dev on fixed port 3001 (http://127.0.0.1:3001).
 * Prefer the Preview worktree; if already inside it, run in place.
 */

import path from "node:path";

import {
  die,
  isGitWorktreePath,
  previewPath,
  repoRoot,
  requirePreviewWorktree,
  runPreviewDev,
  sameGitCommonDir,
} from "./preview-lib.mjs";

const root = repoRoot();
const cwd = process.cwd();
const target = previewPath(root);

let previewDir;
if (
  isGitWorktreePath(cwd) &&
  path.resolve(cwd) === path.resolve(target) &&
  sameGitCommonDir(root, cwd)
) {
  previewDir = cwd;
} else if (path.resolve(cwd) === path.resolve(root)) {
  previewDir = requirePreviewWorktree(root);
} else if (isGitWorktreePath(cwd) && sameGitCommonDir(root, cwd)) {
  // Already in some worktree of this repo (including preview)
  previewDir = cwd;
} else {
  die(
    [
      `Preview / 本体リポジトリで実行してください。`,
      `  想定: ${root} または ${target}`,
      `  現在: ${cwd}`,
    ].join("\n"),
  );
}

runPreviewDev(previewDir);
