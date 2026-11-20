#!/usr/bin/env node
// claude-statusline 설치/제거
//
//   node install.js                         대화형: 설치 범위(project/all)를 묻는다
//   node install.js --scope project [dir]   지정한 프로젝트(기본: 현재 폴더)에만 설치
//   node install.js --scope all             모든 프로젝트(~/.claude)에 설치
//   node install.js --no-codex-update       Codex 자동 업데이트 훅 없이 설치
//   node install.js --uninstall [--scope ...] 제거
//
// - project: <dir>/.claude/ 에 스크립트를 복사하고 <dir>/.claude/settings.local.json 에 등록한다(개인 설정, 공유 안 됨)
// - all:     ~/.claude/ 에 스크립트를 복사하고 ~/.claude/settings.json 에 등록한다
// - 기존 설정은 지우지 않고 합친다. 쓰기 전에 settings 파일을 .bak 으로 백업한다. 여러 번 실행해도 중복되지 않는다.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const readline = require('readline');

const SRC = __dirname;
const FILES = ['statusline.cjs', 'codex-auto-update.cjs'];
const GENERATED = ['statusline-cache.json', 'codex-update.log'];
const HOOK_MARK = 'codex-auto-update.cjs';
const STATUS_MARK = 'statusline.cjs';

function parseArgs(argv) {
  const a = { scope: null, dir: null, codexUpdate: true, uninstall: false };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--scope') {
      a.scope = argv[++i];
      if (a.scope === 'project' && argv[i + 1] && !argv[i + 1].startsWith('--')) a.dir = argv[++i];
    } else if (v === '--no-codex-update') a.codexUpdate = false;
    else if (v === '--uninstall') a.uninstall = true;
    else if (v === '-h' || v === '--help') { printHelp(); process.exit(0); }
    else { console.error('알 수 없는 옵션: ' + v); printHelp(); process.exit(1); }
  }
  if (a.scope && !['project', 'all'].includes(a.scope)) { console.error('--scope 는 project 또는 all'); process.exit(1); }
  return a;
}

function printHelp() {
  console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
}

// 입력 줄을 큐에 모아 두고 질문마다 하나씩 꺼낸다(파이프 입력처럼 줄이 한꺼번에 와도 잃지 않는다)
let rl = null;
const lines = [], waiters = [];
let inputClosed = false;
function ask(q) {
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin });
    rl.on('line', l => (waiters.length ? waiters.shift()(l.trim()) : lines.push(l.trim())));
    rl.on('close', () => { inputClosed = true; while (waiters.length) waiters.shift()(''); });
  }
  process.stdout.write(q);
  if (lines.length) return Promise.resolve(lines.shift());
  if (inputClosed) return Promise.resolve('');
  return new Promise(resolve => waiters.push(resolve));
}
const closeAsk = () => { if (rl) { rl.close(); rl = null; } };

async function resolveTarget(a) {
  let scope = a.scope;
  if (!scope) {
    console.log('설치 범위를 고르세요');
    console.log('  1) project  - 특정 프로젝트에만 (<프로젝트>/.claude/settings.local.json)');
    console.log('  2) all      - 모든 프로젝트 (~/.claude/settings.json)');
    const ans = await ask('번호 [1]: ');
    scope = ans === '2' || /^all$/i.test(ans) ? 'all' : 'project';
  }
  if (scope === 'all') {
    const dir = path.join(os.homedir(), '.claude');
    return { scope, installDir: dir, settingsFile: path.join(dir, 'settings.json'), projectDir: null };
  }
  let projectDir = a.dir;
  if (!projectDir) {
    const def = process.cwd() === SRC ? '' : process.cwd();
    const ans = await ask(`프로젝트 경로${def ? ` [${def}]` : ''}: `);
    projectDir = ans || def;
  }
  if (!projectDir) { console.error('프로젝트 경로가 필요합니다.'); process.exit(1); }
  projectDir = path.resolve(projectDir);
  if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) { console.error('폴더가 없습니다: ' + projectDir); process.exit(1); }
  const dir = path.join(projectDir, '.claude');
  return { scope, installDir: dir, settingsFile: path.join(dir, 'settings.local.json'), projectDir };
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8');
  try { return text.trim() ? JSON.parse(text) : {}; }
  catch (e) { console.error(`${file} 이 올바른 JSON이 아니어서 중단합니다: ${e.message}`); process.exit(1); }
}

function writeJson(file, obj) {
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

const nodeCmd = file => `node "${file.split(path.sep).join('/')}"`;

// 우리 훅만 걸러 낸다(다른 SessionStart 훅은 그대로 둔다)
function withoutOurHook(settings) {
  const groups = (settings.hooks && settings.hooks.SessionStart) || [];
  const kept = groups
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !(h.command || '').includes(HOOK_MARK)) }))
    .filter(g => g.hooks.length);
  if (!settings.hooks) return settings;
  const hooks = { ...settings.hooks };
  if (kept.length) hooks.SessionStart = kept; else delete hooks.SessionStart;
  const out = { ...settings, hooks };
  if (!Object.keys(hooks).length) delete out.hooks;
  return out;
}

// 프로젝트 설치 시 복사한 파일과 개인 설정이 커밋되지 않도록 .gitignore를 확인한다
function ensureGitignore(projectDir) {
  let isRepo = false;
  try { cp.execSync('git rev-parse --is-inside-work-tree', { cwd: projectDir, stdio: 'ignore' }); isRepo = true; } catch {}
  if (!isRepo) return;
  const want = ['settings.local.json', ...FILES, ...GENERATED, 'settings.local.json.bak'].map(f => '.claude/' + f);
  const missing = want.filter(rel => {
    try { cp.execSync(`git check-ignore -q "${rel}"`, { cwd: projectDir, stdio: 'ignore' }); return false; } catch { return true; }
  });
  if (!missing.length) return;
  const gi = path.join(projectDir, '.gitignore');
  const prev = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  const nl = prev.includes('\r\n') ? '\r\n' : '\n';
  const block = (prev && !prev.endsWith('\n') ? nl : '') + '# claude-statusline' + nl + missing.map(m => '/' + m).join(nl) + nl;
  fs.writeFileSync(gi, prev + block);
  console.log(`.gitignore 에 ${missing.length}개 항목 추가`);
}

function install(t, a) {
  fs.mkdirSync(t.installDir, { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(SRC, f), path.join(t.installDir, f));

  let s = withoutOurHook(readJson(t.settingsFile));
  const prevStatus = s.statusLine && s.statusLine.command;
  if (prevStatus && !prevStatus.includes(STATUS_MARK)) console.log('기존 statusLine 설정을 교체합니다 (이전 값은 .bak 에 있음): ' + prevStatus);
  s.statusLine = { type: 'command', command: nodeCmd(path.join(t.installDir, 'statusline.cjs')), padding: 0 };
  if (a.codexUpdate) {
    s.hooks = s.hooks || {};
    s.hooks.SessionStart = [...(s.hooks.SessionStart || []), {
      matcher: 'startup|resume',
      hooks: [{ type: 'command', command: nodeCmd(path.join(t.installDir, 'codex-auto-update.cjs')), timeout: 20 }],
    }];
  }
  writeJson(t.settingsFile, s);
  if (t.projectDir) ensureGitignore(t.projectDir);

  console.log(`설치 완료 (${t.scope})`);
  console.log('  스크립트: ' + t.installDir);
  console.log('  설정:     ' + t.settingsFile);
  console.log('  Codex 자동 업데이트 훅: ' + (a.codexUpdate ? '켬' : '끔'));
  console.log('새 세션부터 적용됩니다. 지금 세션은 /hooks 를 한 번 열거나 재시작하세요.');
}

function uninstall(t) {
  let s = withoutOurHook(readJson(t.settingsFile));
  if (s.statusLine && (s.statusLine.command || '').includes(STATUS_MARK)) delete s.statusLine;
  if (fs.existsSync(t.settingsFile)) writeJson(t.settingsFile, s);
  for (const f of [...FILES, ...GENERATED]) {
    const p = path.join(t.installDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  console.log(`제거 완료 (${t.scope}): ${t.settingsFile}`);
}

(async () => {
  const a = parseArgs(process.argv.slice(2));
  const t = await resolveTarget(a);
  closeAsk();
  if (a.uninstall) uninstall(t); else install(t, a);
})();
