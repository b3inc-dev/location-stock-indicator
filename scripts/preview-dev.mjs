#!/usr/bin/env node
/**
 * npm run preview:dev
 * Run shopify app dev on fixed port 3001 (http://127.0.0.1:3001).
 * From the main checkout: launch against the Preview worktree.
 * From inside the Preview worktree: run in place.
 */

import fs from "node:fs";
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

function real(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

const root = repoRoot();
const cwd = process.cwd();
const target = previewPath(root);

let previewDir;
if (real(cwd) === real(target) && isGitWorktreePath(cwd) && sameGitCommonDir(root, cwd)) {
  previewDir = cwd;
} else if (real(cwd) === real(root)) {
  previewDir = requirePreviewWorktree(root);
} else {
  die(
    [
      `Preview worktree 内、または本体リポジトリで実行してください。`,
      `  想定: ${root} または ${target}`,
      `  現在: ${cwd}`,
    ].join("\n"),
  );
}

runPreviewDev(previewDir);
