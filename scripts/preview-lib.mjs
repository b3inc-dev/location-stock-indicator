#!/usr/bin/env node
/**
 * Shared helpers for Preview worktree npm scripts.
 * Never runs db push / migrate deploy / production DB ops.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PREVIEW_DIR_NAME = "ciara-system-preview";
export const PREVIEW_BRANCH = "preview/worktree";
export const PREVIEW_PORT = 3001;
export const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function repoRoot() {
  return path.resolve(__dirname, "..");
}

/**
 * Default: repo sibling `../ciara-system-preview`.
 * Override with LOCATION_STOCK_PREVIEW_DIR when the sibling path is not writable
 * (e.g. cloud agents whose checkout lives at /workspace).
 */
export function previewPath(root = repoRoot()) {
  const override = process.env.LOCATION_STOCK_PREVIEW_DIR?.trim();
  if (override) {
    return path.resolve(override);
  }
  return path.resolve(root, "..", PREVIEW_DIR_NAME);
}

function assertParentWritable(target) {
  const parent = path.dirname(target);
  try {
    fs.mkdirSync(parent, { recursive: true });
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    die(
      [
        `Preview worktree の親ディレクトリに書き込めません: ${parent}`,
        `  既定パス: <repo>/../${PREVIEW_DIR_NAME}`,
        `  回避: LOCATION_STOCK_PREVIEW_DIR=/writable/path/${PREVIEW_DIR_NAME} npm run preview:setup`,
      ].join("\n"),
    );
  }
}

export function runGit(args, { cwd, stdio = "pipe", allowFail = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: stdio === "inherit" ? "inherit" : ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0 && !allowFail) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
    const err = new Error(
      detail || `git ${args.join(" ")} failed (exit ${result.status})`,
    );
    err.exitCode = result.status ?? 1;
    throw err;
  }
  return {
    status: result.status ?? 1,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || "").trim(),
  };
}

export function gitOutput(args, cwd) {
  return runGit(args, { cwd }).stdout;
}

export function die(message, code = 1) {
  console.error(`\n❌ ${message}\n`);
  process.exit(code);
}

export function info(message) {
  console.log(`ℹ️  ${message}`);
}

export function ok(message) {
  console.log(`✅ ${message}`);
}

export function warn(message) {
  console.warn(`⚠️  ${message}`);
}

export function assertMainRepo(root = repoRoot()) {
  const top = gitOutput(["rev-parse", "--show-toplevel"], root);
  if (path.resolve(top) !== path.resolve(root)) {
    die(`リポジトリルートで実行してください: ${root}`);
  }
}

export function isGitWorktreePath(dir) {
  if (!fs.existsSync(dir)) return false;
  try {
    gitOutput(["rev-parse", "--is-inside-work-tree"], dir);
    return true;
  } catch {
    return false;
  }
}

export function sameGitCommonDir(a, b) {
  const commonA = gitOutput(["rev-parse", "--git-common-dir"], a);
  const commonB = gitOutput(["rev-parse", "--git-common-dir"], b);
  return path.resolve(a, commonA) === path.resolve(b, commonB);
}

export function isWorktreeDirty(dir) {
  const porcelain = gitOutput(["status", "--porcelain"], dir);
  return porcelain.length > 0;
}

export function assertPreviewClean(dir) {
  if (!isWorktreeDirty(dir)) return;
  die(
    [
      `Preview worktree に未コミット変更があります。破棄せず安全停止します。`,
      `  path: ${dir}`,
      `  対処: 変更を commit / stash / 退避してから再実行してください。`,
      `  禁止: git reset --hard / git clean -fd は使いません。`,
    ].join("\n"),
  );
}

export function ensurePreviewWorktree(root = repoRoot()) {
  assertMainRepo(root);
  const target = previewPath(root);

  if (fs.existsSync(target)) {
    if (!isGitWorktreePath(target)) {
      die(
        `${target} は既に存在しますが Git worktree ではありません。手動で確認してください。`,
      );
    }
    if (!sameGitCommonDir(root, target)) {
      die(
        `${target} は別リポジトリの worktree の可能性があります。削除せず安全停止します。`,
      );
    }
    ok(`既存の Preview worktree を再利用します: ${target}`);
    return { path: target, created: false };
  }

  assertParentWritable(target);

  // Ensure we have origin/main for a clean base without touching current branch.
  runGit(["fetch", "origin", "main"], { cwd: root, stdio: "inherit", allowFail: true });

  const baseRef = (() => {
    const remoteMain = runGit(["rev-parse", "--verify", "origin/main"], {
      cwd: root,
      allowFail: true,
    });
    if (remoteMain.status === 0) return "origin/main";
    return "HEAD";
  })();

  const branchExists = runGit(["show-ref", "--verify", "--quiet", `refs/heads/${PREVIEW_BRANCH}`], {
    cwd: root,
    allowFail: true,
  }).status === 0;

  if (branchExists) {
    // Branch exists but worktree missing — attach worktree to existing branch.
    info(`branch ${PREVIEW_BRANCH} は既存のため、worktree のみ追加します。`);
    runGit(["worktree", "add", target, PREVIEW_BRANCH], {
      cwd: root,
      stdio: "inherit",
    });
  } else {
    runGit(["worktree", "add", "-b", PREVIEW_BRANCH, target, baseRef], {
      cwd: root,
      stdio: "inherit",
    });
  }

  ok(`Preview worktree を作成しました: ${target}`);
  info(`本体 worktree の branch は変更していません。`);
  return { path: target, created: true };
}

export function requirePreviewWorktree(root = repoRoot()) {
  const target = previewPath(root);
  if (!fs.existsSync(target) || !isGitWorktreePath(target)) {
    die(
      `Preview worktree がありません: ${target}\n  先に実行: npm run preview:setup`,
    );
  }
  if (!sameGitCommonDir(root, target)) {
    die(`${target} はこのリポジトリの Preview worktree ではありません。`);
  }
  return target;
}

/**
 * Resolve PR head SHA via gh, with refs/pull/<n>/head fallback.
 */
export function resolvePrHead(prNumber, root = repoRoot()) {
  if (!/^\d+$/.test(String(prNumber))) {
    die(`PR番号は正の整数で指定してください: ${prNumber}`);
  }
  const n = String(prNumber);

  const gh = spawnSync(
    "gh",
    ["pr", "view", n, "--json", "number,url,headRefOid,headRefName,state,title"],
    { cwd: root, encoding: "utf8" },
  );

  if (gh.status === 0) {
    const data = JSON.parse(gh.stdout);
    if (!data.headRefOid) {
      die(`PR #${n} の HEAD を取得できませんでした。`);
    }
    return {
      number: data.number,
      url: data.url,
      sha: data.headRefOid,
      headRefName: data.headRefName,
      title: data.title,
      state: data.state,
      source: "gh",
    };
  }

  const ghErr = (gh.stderr || gh.stdout || "").trim();
  if (/Could not resolve to a PullRequest|not found|does not exist/i.test(ghErr)) {
    die(
      [
        `PR #${n} は存在しません。`,
        ghErr,
        `確認: gh pr view ${n}`,
      ].join("\n  "),
    );
  }

  // Fallback: fetch pull ref (e.g. gh unavailable / auth issue)
  info(`gh で PR #${n} を取得できませんでした。refs/pull/${n}/head を試します…`);
  const fetch = runGit(["fetch", "origin", `pull/${n}/head:refs/preview/pr-${n}`], {
    cwd: root,
    allowFail: true,
  });
  if (fetch.status !== 0) {
    die(
      [
        `PR #${n} が見つからないか取得できませんでした。`,
        ghErr || fetch.stderr || "gh / git fetch の両方に失敗",
        `確認: gh pr view ${n}`,
      ].join("\n  "),
    );
  }
  const sha = gitOutput(["rev-parse", `refs/preview/pr-${n}`], root);
  return {
    number: Number(n),
    url: null,
    sha,
    headRefName: `refs/pull/${n}/head`,
    title: null,
    state: null,
    source: "pull-ref",
  };
}

export function checkoutPrInPreview(pr, previewDir, root = repoRoot()) {
  assertPreviewClean(previewDir);

  // Fetch latest PR head into the main repo object store (shared with worktrees).
  const fetchRef = `pull/${pr.number}/head`;
  info(`fetch origin ${fetchRef} …`);
  const fetch = runGit(["fetch", "origin", fetchRef], {
    cwd: root,
    allowFail: true,
  });
  if (fetch.status !== 0) {
    // Retry with gh-resolved SHA
    runGit(["fetch", "origin", pr.sha], { cwd: root, stdio: "inherit" });
  }

  const fetchedSha =
    fetch.status === 0
      ? gitOutput(["rev-parse", "FETCH_HEAD"], root)
      : pr.sha;

  // Update preview branch tip without touching the main worktree branch.
  runGit(["checkout", "-B", PREVIEW_BRANCH, fetchedSha], {
    cwd: previewDir,
    stdio: "inherit",
  });

  const head = gitOutput(["rev-parse", "HEAD"], previewDir);
  ok(`Preview worktree を PR #${pr.number} HEAD (${head.slice(0, 7)}) に切り替えました。`);
  if (pr.url) info(`PR: ${pr.url}`);
  if (pr.title) info(`title: ${pr.title}`);
  return head;
}

function listChangedPaths(fromRef, toRef, root, pathspecs) {
  const args = ["diff", "--name-only", fromRef, toRef, "--", ...pathspecs];
  const result = runGit(args, { cwd: root, allowFail: true });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function reportPackageAndPrismaChanges(previewDir, root = repoRoot()) {
  // Compare preview HEAD vs origin/main (fallback: main)
  let base = "origin/main";
  const hasOriginMain = runGit(["rev-parse", "--verify", "origin/main"], {
    cwd: root,
    allowFail: true,
  });
  if (hasOriginMain.status !== 0) {
    base = "main";
  }

  const head = "HEAD";
  const packageFiles = listChangedPaths(base, head, previewDir, [
    "package.json",
    "package-lock.json",
  ]);
  const prismaFiles = listChangedPaths(base, head, previewDir, [
    "prisma/schema.prisma",
    "prisma/migrations",
  ]);

  console.log("");
  if (packageFiles.length > 0) {
    warn(
      [
        `${base} から package 関連ファイルが変更されています:`,
        ...packageFiles.map((f) => `  - ${f}`),
        `  → Preview worktree で依存関係の再インストールが必要です:`,
        `     cd ${previewDir} && npm ci`,
        `  （既存環境を壊さないため、自動では実行しません）`,
      ].join("\n"),
    );
  } else {
    ok(`${base} と比べて package.json / package-lock.json の差分はありません。`);
  }

  if (prismaFiles.length > 0) {
    warn(
      [
        `Prisma schema / migrations に変更があります（警告のみ）:`,
        ...prismaFiles.map((f) => `  - ${f}`),
        `  自動実行しません: db push / migrate deploy / production DB 接続`,
        `  必要ならローカル開発用 DB を人間が明示的に用意してください。`,
      ].join("\n"),
    );
  }

  return { packageFiles, prismaFiles, base };
}

export function runPreviewDev(previewDir) {
  if (!fs.existsSync(previewDir)) {
    die(`Preview worktree がありません: ${previewDir}\n  先に: npm run preview:setup`);
  }

  const env = {
    ...process.env,
    PORT: String(PREVIEW_PORT),
    FRONTEND_PORT: String(PREVIEW_PORT),
  };

  const args = [
    "shopify",
    "app",
    "dev",
    "--localhost-port",
    String(PREVIEW_PORT),
    "--use-localhost",
    "--no-update",
  ];

  info(`Preview dev を起動します（port ${PREVIEW_PORT} 固定）`);
  info(`URL: ${PREVIEW_URL}`);
  info(`cwd: ${previewDir}`);
  info(`通常の npm run dev（port 3000）とは競合しません。`);

  const result = spawnSync("npx", args, {
    cwd: previewDir,
    env,
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}
