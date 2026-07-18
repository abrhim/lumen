#!/usr/bin/env node
// Harness for the feature-workflow skill. Structural validator.
//
// Modes:
//   --quick : invoked at step 0 of the flow. Asserts the skill is intact AND
//             that pre-flight conditions hold (clean tree, no in-progress lock).
//   --done  : invoked at step 15. Asserts per-feature artifacts are complete.
//             Requires FEATURE_SLUG env var.
//
// Exit codes:
//   0 — all assertions passed
//   1 — at least one assertion failed
//   2 — usage error or unexpected crash
//
// (default mode = --quick)

import { execSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(__dirname, '..');

// Resolve repo root via git when possible; fall back to relative.
function repoRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
  } catch {
    return resolve(SKILL_ROOT, '../../..');
  }
}

const REPO_ROOT = repoRoot();
const args = new Set(process.argv.slice(2));
const MODE = args.has('--done') ? 'done' : 'quick';
const FEATURE_SLUG = process.env.FEATURE_SLUG || null;
const ALLOW_DIRTY = process.env.ALLOW_DIRTY === '1';

const REQUIRED_REFERENCES = [
  'tiers.md',
  'panel-roles.md',
  'adversarial.md',
  'harness-template.md',
  'bug-filter.md',
  'retro-template.md',
  'quality-signals.md',
];

const REQUIRED_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'Task', 'TodoWrite'];

// Panel-1 caught Agent vs Task in the plan-stage adversarial review;
// keep this as a guard so future edits don't silently regress.
const FORBIDDEN_TOOLS = ['Agent'];

const REQUIRED_RETRO_HEADINGS = [
  'Plan accuracy',
  'Panel signal',
  'Harness coverage',
  'Wasted effort',
  'Recommendations',
  'Quality signals',
  'Provenance histogram',
];

const failures = [];
const passes = [];
const warnings = [];

function check(name, condition, detail = '') {
  if (condition) passes.push(name);
  else failures.push(`${name}${detail ? ': ' + detail : ''}`);
}

function warn(name, detail = '') {
  warnings.push(`${name}${detail ? ': ' + detail : ''}`);
}

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function readText(path) {
  return readFile(path, 'utf8');
}

// Minimal frontmatter parser. Hardened for the shapes we actually use:
// scalar-only `key: value` lines (no nested mappings, no multi-line values).
// Strips inline comments and outer quotes. NOT a YAML conformant parser.
function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const raw of match[1].split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = raw.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    // strip trailing inline comment if not inside quotes
    if (!/^['"]/.test(value)) {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    // strip outer matched quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fm[m[1]] = value;
  }
  return fm;
}

async function checkSkillIntegrity() {
  const skillPath = join(SKILL_ROOT, 'SKILL.md');
  check('SKILL.md exists', await exists(skillPath));
  if (!(await exists(skillPath))) return;

  const skillText = await readText(skillPath);
  const fm = parseFrontmatter(skillText);
  check('SKILL.md has YAML frontmatter', fm !== null);
  if (!fm) return;

  check('frontmatter.name is feature-workflow', fm.name === 'feature-workflow', `got "${fm.name}"`);
  check('frontmatter.description present', typeof fm.description === 'string' && fm.description.length > 30);
  check('frontmatter.allowed-tools present', typeof fm['allowed-tools'] === 'string' && fm['allowed-tools'].length > 0);
  check('frontmatter.version present', typeof fm.version === 'string' && /^\d+\.\d+\.\d+$/.test(fm.version), `got "${fm.version}"`);

  const allowedTools = (fm['allowed-tools'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  for (const t of REQUIRED_TOOLS) {
    check(`allowed-tools contains ${t}`, allowedTools.includes(t));
  }
  for (const t of FORBIDDEN_TOOLS) {
    check(`allowed-tools does NOT contain ${t}`, !allowedTools.includes(t), 'use Task');
  }

  // SKILL.md is meant to be terse — ceiling check.
  check('SKILL.md is terse (< 6500 chars)', skillText.length < 6500, `${skillText.length} chars`);

  // Required references exist
  for (const ref of REQUIRED_REFERENCES) {
    check(`references/${ref} exists`, await exists(join(SKILL_ROOT, 'references', ref)));
  }

  // SKILL.md should reference every required file
  for (const ref of REQUIRED_REFERENCES) {
    check(`SKILL.md links to references/${ref}`, skillText.includes(`references/${ref}`));
  }

  // Reference content assertions — non-tautological checks of contract claims.
  const tiersText = (await exists(join(SKILL_ROOT, 'references/tiers.md')))
    ? await readText(join(SKILL_ROOT, 'references/tiers.md'))
    : '';
  check('tiers.md mentions auth/crypto always-escalate', /auth.*crypto|crypto.*auth/i.test(tiersText));
  check('tiers.md mentions panel sizes 3 / 6 / 8', /\b3\b/.test(tiersText) && /\b6\b/.test(tiersText) && /\b8\b/.test(tiersText));

  const panelRolesText = (await exists(join(SKILL_ROOT, 'references/panel-roles.md')))
    ? await readText(join(SKILL_ROOT, 'references/panel-roles.md'))
    : '';
  check('panel-roles.md mentions security and correctness as mandatory', /security/i.test(panelRolesText) && /correctness/i.test(panelRolesText));

  const retroTemplate = (await exists(join(SKILL_ROOT, 'references/retro-template.md')))
    ? await readText(join(SKILL_ROOT, 'references/retro-template.md'))
    : '';
  for (const h of REQUIRED_RETRO_HEADINGS) {
    check(`retro-template.md mentions section "${h}"`, retroTemplate.includes(h));
  }

  // State directory
  const stateDir = join(SKILL_ROOT, 'state');
  check('state/ directory exists', await exists(stateDir));
  check('state/learnings.md exists', await exists(join(stateDir, 'learnings.md')));
  check('state/corrections.md exists', await exists(join(stateDir, 'corrections.md')));

  if (await exists(join(stateDir, 'learnings.md'))) {
    const learningsText = await readText(join(stateDir, 'learnings.md'));
    check('state/learnings.md has expected header', /^#\s+Learnings/i.test(learningsText));
  }

  // Tests + fixtures
  check('tests/fixtures/example-feature.md exists', await exists(join(SKILL_ROOT, 'tests/fixtures/example-feature.md')));
  check('tests/expected-tier-decision.md exists', await exists(join(SKILL_ROOT, 'tests/expected-tier-decision.md')));
  check('CHANGELOG.md exists', await exists(join(SKILL_ROOT, 'CHANGELOG.md')));
}

async function checkPreflight() {
  // Dirty working tree — warning by default; pass with ALLOW_DIRTY=1.
  try {
    const dirty = execSync('git status --porcelain', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    if (dirty) {
      if (ALLOW_DIRTY) {
        warn('git working tree dirty (ALLOW_DIRTY=1, continuing)');
      } else {
        warn('git working tree dirty (set ALLOW_DIRTY=1 to suppress; or commit / stash before starting a feature)');
      }
    } else {
      passes.push('git working tree clean');
    }
  } catch {
    warn('git status check skipped (not a git repo or git unavailable)');
  }

  // Lock scan: presence of plan.md without retro.md = in-progress feature.
  // Skip the slug currently being run via FEATURE_SLUG so step 0 of an in-flight
  // feature doesn't collide with itself.
  const featuresDir = join(REPO_ROOT, 'docs/features');
  if (await exists(featuresDir)) {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(featuresDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (FEATURE_SLUG && e.name === FEATURE_SLUG) continue;
      const slugDir = join(featuresDir, e.name);
      const hasPlan = await exists(join(slugDir, 'plan.md'));
      const hasRetro = await exists(join(slugDir, 'retro.md'));
      check(
        `no in-progress lock from "${e.name}"`,
        !(hasPlan && !hasRetro),
        'plan.md exists without retro.md — finish or abort that feature first',
      );
    }
  }
}

async function quickChecks() {
  await checkSkillIntegrity();
  await checkPreflight();
}

async function doneChecks() {
  if (!FEATURE_SLUG) {
    failures.push('--done requires FEATURE_SLUG env var (e.g. FEATURE_SLUG=feature-workflow-skill)');
    return 'usage';
  }

  const featureDir = join(REPO_ROOT, 'docs/features', FEATURE_SLUG);
  check(`docs/features/${FEATURE_SLUG}/ exists`, await exists(featureDir));
  if (!(await exists(featureDir))) return;

  // Per-feature artifacts the synthesized plan promised.
  for (const f of ['plan.md', 'retro.md']) {
    check(`${FEATURE_SLUG}/${f} exists`, await exists(join(featureDir, f)));
  }
  // Optional but expected for any non-trivial feature.
  for (const f of ['bugs.md']) {
    check(`${FEATURE_SLUG}/${f} exists`, await exists(join(featureDir, f)));
  }

  // Plan.md must contain the post-synthesis Decisions section + Drift baseline.
  const planPath = join(featureDir, 'plan.md');
  if (await exists(planPath)) {
    const planText = await readText(planPath);
    // For the bootstrap dogfood feature, decisions live in synthesized-plan.md
    // alongside plan.md. Accept either.
    const synthesizedPath = join(featureDir, 'synthesized-plan.md');
    const synthesizedText = (await exists(synthesizedPath)) ? await readText(synthesizedPath) : '';
    const combined = planText + '\n' + synthesizedText;
    check('plan/synthesized contains "## Decisions" or equivalent', /^##\s+Decisions/m.test(combined) || /Decisions on /m.test(combined));
  }

  // retro.md must contain required sections (heading match, not substring).
  const retroPath = join(featureDir, 'retro.md');
  if (await exists(retroPath)) {
    const retro = await readText(retroPath);
    for (const heading of REQUIRED_RETRO_HEADINGS) {
      const re = new RegExp(`^#{2,3}\\s+\\d?\\.?\\s*${heading}`, 'mi');
      check(`retro.md contains heading for "${heading}"`, re.test(retro));
    }
    // Quality-signals JSON block must parse.
    const jsonBlock = retro.match(/```json\s*([\s\S]*?)```/);
    check('retro.md has a ```json``` quality-signals block', jsonBlock !== null);
    if (jsonBlock) {
      try {
        const parsed = JSON.parse(jsonBlock[1]);
        check('retro.md JSON has feature_slug', typeof parsed.feature_slug === 'string');
        check('retro.md JSON has tier', typeof parsed.tier === 'string');
        check('retro.md JSON has plan_to_code_drift', Number.isFinite(parsed.plan_to_code_drift));
        check('retro.md JSON has panel_2_dissent_rate', Number.isFinite(parsed.panel_2_dissent_rate));
      } catch (err) {
        failures.push(`retro.md JSON failed to parse: ${err.message}`);
      }
    }
  }

  // learnings.md must mention the slug after retro is written.
  const learningsPath = join(SKILL_ROOT, 'state/learnings.md');
  if (await exists(learningsPath)) {
    const learnings = await readText(learningsPath);
    check(`state/learnings.md mentions ${FEATURE_SLUG}`, learnings.includes(FEATURE_SLUG));
  }

  // Harness initial-fail proof, if a behavior-tier feature claimed harness-first.
  const harnessLog = join(featureDir, 'harness-initial.log');
  if (await exists(harnessLog)) {
    const log = await readText(harnessLog);
    // node's spec reporter prints "ℹ fail 1" (no colon) — accept both formats
    check('harness-initial.log records a non-zero initial exit', /EXIT=\s*[1-9]/i.test(log) || /pass:?\s*0\b/i.test(log) || /fail:?\s*[1-9]/.test(log) || /✖ failing tests/.test(log));
  }
}

async function main() {
  console.log(`feature-workflow validate (${MODE})`);
  console.log(`SKILL_ROOT=${SKILL_ROOT}`);
  console.log(`REPO_ROOT=${REPO_ROOT}`);
  if (FEATURE_SLUG) console.log(`FEATURE_SLUG=${FEATURE_SLUG}`);

  let outcome = null;
  if (MODE === 'quick') await quickChecks();
  else outcome = await doneChecks();

  for (const p of passes) console.log(`  ✓ ${p}`);
  for (const w of warnings) console.log(`  ! ${w}`);
  for (const f of failures) console.log(`  ✗ ${f}`);

  console.log('---');
  console.log(`pass: ${passes.length}  warn: ${warnings.length}  fail: ${failures.length}`);

  if (outcome === 'usage') process.exit(2);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('validator crashed:', err);
  process.exit(2);
});
