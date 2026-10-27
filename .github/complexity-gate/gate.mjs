/**
 * CI complexity gate: cognitive complexity <= 15,
 * enforced ONLY on the functions a PR adds or modifies (not whole files, so touching a
 * legacy file doesn't fail on its pre-existing complexity, and existing code isn't retro-gated).
 *
 *   cognitive <= 15 : eslint + eslint-plugin-sonarjs (sonarjs/cognitive-complexity)
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COGNITIVE_MAX = 15;

const gateDir = dirname(fileURLToPath(import.meta.url));
const requireCog = createRequire(join(gateDir, "cognitive", "package.json"));
const ts = requireCog("typescript");
const { ESLint } = requireCog("eslint");
const tsParserPath = requireCog.resolve("@typescript-eslint/parser");

const repoRoot = process.env.GITHUB_WORKSPACE || resolve(gateDir, "..", "..");
// quotePath=false keeps non-ASCII paths raw so changed files are not silently dropped.
const git = (args) => execFileSync("git", ["-C", repoRoot, "-c", "core.quotePath=false", ...args], { encoding: "utf8" });

const baseRef = process.env.GITHUB_BASE_REF || "main";
try {
  git(["fetch", "--no-tags", "--depth=200", "origin", baseRef]);
} catch {
  /* base history may already be present */
}
let range;
try {
  range = git(["merge-base", `origin/${baseRef}`, "HEAD"]).trim();
} catch {
  console.error(`Complexity gate could not determine the PR diff range against origin/${baseRef}; failing closed.`);
  process.exit(1);
}

const changedFiles = git(["diff", "-z", "--name-only", "--diff-filter=ACMR", range, "HEAD"])
  .split("\0")
  .filter(Boolean)
  // .tsx is excluded from the gate for now: cognitive complexity on JSX is noisy, so
  // big-but-clean components fail for no real reason. Gate runs on .ts only until
  // coupling/cohesion metrics that actually fit components land.
  .filter((f) => /\.ts$/.test(f))
  .filter((f) => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(f))
  .filter((f) => !f.endsWith(".d.ts"))
  .filter((f) => existsSync(join(repoRoot, f)));

// New-side line numbers a PR added/modified per file (unified=0 → tight hunks).
function changedLines(file) {
  const set = new Set();
  let diff = "";
  try {
    diff = git(["diff", "--unified=0", range, "HEAD", "--", file]);
  } catch {
    return null;
  }
  for (const line of diff.split("\n")) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m) {
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      for (let i = 0; i < count; i++) set.add(start + i);
    }
  }
  return set;
}

const isFn = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n);

const violations = [];

const eslint = new ESLint({
  useEslintrc: false,
  resolvePluginsRelativeTo: join(gateDir, "cognitive"),
  cwd: repoRoot,
  overrideConfig: {
    parser: tsParserPath,
    parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
    plugins: ["sonarjs"],
    rules: { "sonarjs/cognitive-complexity": ["error", COGNITIVE_MAX] },
  },
});

for (const file of changedFiles) {
  const lines = changedLines(file);
  if (lines === null) {
    violations.push(`${file} — could not compute changed lines (git diff failed; failing closed)`);
    continue;
  }
  if (lines.size === 0) continue;
  const code = readFileSync(join(repoRoot, file), "utf8");
  const isTsx = file.endsWith("tsx");
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // touched functions = function nodes whose line range intersects the changed lines
  const touched = [];
  const visit = (node) => {
    if (isFn(node)) {
      const startLine = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      const endLine = sf.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      let hit = false;
      for (let l = startLine; l <= endLine && !hit; l++) if (lines.has(l)) hit = true;
      if (hit) touched.push({ startLine, endLine });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const [res] = await eslint.lintFiles([join(repoRoot, file)]);
  const firstFatal = (res?.messages ?? []).find((m) => m.fatal === true);
  if (res?.fatalErrorCount > 0 || firstFatal) {
    violations.push(`${file} — ESLint could not parse file (failing closed): ${firstFatal?.message ?? "fatal error"}`);
  }
  if (touched.length === 0) continue;

  const inTouched = (line) => touched.some((t) => line >= t.startLine && line <= t.endLine);

  // cognitive — only messages landing inside a touched function
  for (const m of res?.messages ?? []) {
    if (m.ruleId === "sonarjs/cognitive-complexity" && inTouched(m.line)) {
      violations.push(`${file}:${m.line} — cognitive complexity: ${m.message}`);
    }
  }
}

if (violations.length > 0) {
  console.error(`\nComplexity gate FAILED (cognitive <= ${COGNITIVE_MAX}) on added/modified functions:`);
  for (const v of violations) console.error(`  - ${v}`);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}
console.log(`Complexity gate passed (cognitive <= ${COGNITIVE_MAX}).`);
