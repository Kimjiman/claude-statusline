// Claude Code 상태 표시줄 (install.js가 settings.json의 statusLine에 등록)
// 📁 프로젝트 │ 🌿 브랜치 ●미커밋 │ ⏱ 경과 시간
// ╭─ ✻ Claude │ 모델 (effort)        ← 이름만 주황 굵게, 테두리는 흰색
// │ 🧠 Context / ⏳ 5H / 📅 7D 막대
// ╰ 업데이트(있을 때만)
// ╭─ ◈ Codex  │ 모델 (effort)        ← 이름 Codex 청록(#0D9488) 굵게, 테두리는 흰색
// │ ⏳ 5H / 📅 7D 막대
// ╰ 업데이트(있을 때만)
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const RESET = '\x1b[0m', BOLD = '\x1b[1m', DIM = '\x1b[2m', DARK = '\x1b[90m';
const ORANGE = '\x1b[38;5;208m', CODEX_TEAL = '\x1b[38;2;13;148;136m', WHITE = '\x1b[97m', BLUE = '\x1b[38;5;75m';
const GREEN = '\x1b[32m', YELLOW = '\x1b[33m', RED = '\x1b[31m', PURPLE = '\x1b[35m', CYAN = '\x1b[36m';
// 캐시는 이 파일 하나에 모은다 (한도·버전·Codex 한도·git). 지워도 다시 생긴다.
const CACHE = path.join(__dirname, 'statusline-cache.json');
const loadCache = () => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; } };
// 백그라운드 버전 확인과 겹쳐도 서로의 키를 지우지 않도록 저장 직전에 다시 읽어 합친다
const saveCache = patch => { try { fs.writeFileSync(CACHE, JSON.stringify({ ...loadCache(), ...patch })); } catch {} };
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
// Windows의 Git Bash에서는 GNU tar가 먼저 잡혀 Codex 설치가 실패하므로 System32를 PATH 앞에 둔다
const CODEX_UPDATE_CMD = process.platform === 'win32' ? 'PATH="/c/Windows/System32:$PATH" codex update' : 'codex update';
const BAR = 20;
// 터미널이 이보다 작으면 블록마다 한 줄로 줄여 3줄로 보여 준다 (Claude Code가 COLUMNS·LINES로 현재 크기를 넘겨준다)
const COMPACT_MAX_COLS = 80, COMPACT_MAX_LINES = 25;
const isCompact = () => {
  const cols = +process.env.COLUMNS, rows = +process.env.LINES;
  return (cols > 0 && cols < COMPACT_MAX_COLS) || (rows > 0 && rows < COMPACT_MAX_LINES);
};

let raw = '';
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => {
  let j = {};
  try { j = JSON.parse(raw || '{}'); } catch {}
  const versions = readVersions();
  const compact = isCompact();
  const lines = [headerLine(j), ...claudeBlock(j, versions, compact), ...codexBlock(versions, compact)];
  process.stdout.write(lines.join('\n'));
});

// ───────────── 공통 ─────────────
const k = n => (n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
const pctColor = p => (p < 50 ? GREEN : p < 80 ? YELLOW : RED);
const pad2 = n => String(n).padStart(2, '0');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hm = d => pad2(d.getHours()) + ':' + pad2(d.getMinutes());
const dur = ms => {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m >= 60 * 24) return Math.floor(m / 1440) + 'd' + Math.floor((m % 1440) / 60) + 'h';
  if (m >= 60) return Math.floor(m / 60) + 'h' + pad2(m % 60) + 'm';
  if (m >= 1) return m + 'm';
  return Math.max(0, Math.floor(ms / 1000)) + 's';
};
const bar = p => {
  const fill = Math.max(0, Math.min(BAR, Math.round((p / 100) * BAR)));
  return pctColor(p) + '█'.repeat(fill) + RESET + DARK + '░'.repeat(BAR - fill) + RESET;
};
const emptyBar = () => DARK + '░'.repeat(BAR) + RESET;
const pctText = p => pctColor(p) + String(p).padStart(3) + '%' + RESET;
// 아이콘 + 라벨을 같은 너비로 맞춰 막대 시작 열을 일치시킨다 (아이콘은 모두 이모지라 너비가 같다)
const label = (icon, name) => icon + ' ' + WHITE + name.padEnd(7) + RESET;
const info = s => (s ? '  ' + WHITE + s + RESET : '');
// 사용량 한 줄: 막대 + % + "초기화 시각 · 남은 시간". 값이 없으면 '?', 초기화 시각이 지났으면 0%·Reset
function usageRow(icon, name, pct, resetsAt, weekly) {
  if (pct == null) return label(icon, name) + ' ' + emptyBar() + '     ' + WHITE + '?' + RESET;
  const now = Date.now() / 1000;
  if (resetsAt && resetsAt < now) return label(icon, name) + ' ' + bar(0) + '  ' + pctText(0) + info('Reset');
  const p = Math.round(pct);
  let extra = '';
  if (resetsAt) {
    const d = new Date(resetsAt * 1000);
    const when = DAYS[d.getDay()] + ' ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm(d);
    extra = when + ' · ' + dur((resetsAt - now) * 1000) + ' left';
  }
  return label(icon, name) + ' ' + bar(p) + '  ' + pctText(p) + info(extra);
}
// "모델(effort)" → "모델 (effort)", effort만 흐리게
function modelText(s) {
  const m = String(s || '?').match(/^(.*?)\s*\(([^)]*)\)\s*(.*)$/);
  return m ? m[1] + ' (' + m[2] + ')' + (m[3] ? ' ' + m[3] : '') : String(s || '?');
}
const blockHead = (color, icon, name, model) =>
  WHITE + BOLD + '╭─ ' + RESET + color + BOLD + icon + ' ' + name.padEnd(6) + RESET + WHITE + BOLD + ' │' + RESET + ' ' + WHITE + modelText(model) + RESET;
// 블록 몸통: 마지막 줄만 ╰ 로 닫는다
const blockBody = rows => rows.map((r, i) => WHITE + BOLD + (i === rows.length - 1 ? '╰' : '│') + RESET + ' ' + r);
// 작은 화면용 한 줄: "✻ 모델 │ 🧠 37%  ⏳ 21%  📅 41%" (업데이트가 있으면 끝에 ⬆)
const shownPct = (pct, resetsAt) => (pct == null ? null : resetsAt && resetsAt < Date.now() / 1000 ? 0 : Math.round(pct));
const miniItem = (icon, p, empty) => icon + ' ' + (p == null ? WHITE + String(empty).padStart(3) + ' ' + RESET : pctText(p));
const compactLine = (color, icon, model, items, update) =>
  color + BOLD + icon + RESET + ' ' + WHITE + modelText(model) + RESET + WHITE + BOLD + ' │' + RESET + ' ' + items.join('  ')
  + (update ? '  ' + PURPLE + '⬆' + RESET : '');

// ───────────── 1줄: 프로젝트·브랜치·경과 시간 ─────────────
function headerLine(j) {
  const ws = j.workspace || {};
  const root = ws.project_dir || j.cwd || process.cwd();
  const parts = [BLUE + '📁 ' + path.basename(root) + RESET];
  const g = gitInfo(root);
  if (g) parts.push(GREEN + '🌿 ' + g.branch + RESET + (g.dirty ? ' ' + YELLOW + '●' + g.dirty + RESET : ''));
  const ms = j.cost && j.cost.total_duration_ms;
  if (ms != null) parts.push(WHITE + '⏱ ' + dur(ms) + RESET);
  return parts.join(' │ ');
}

// 브랜치와 미커밋 파일 수. git 호출은 5초 캐시
function gitInfo(dir) {
  const c = loadCache().git;
  if (c && c.dir === dir && Date.now() - c.at < 5000) return c.info;
  let info = null;
  try {
    const out = String(cp.execSync('git status --porcelain=v1 -b', { cwd: dir, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }));
    const lines = out.split('\n').filter(Boolean);
    const head = (lines[0] || '').replace(/^## /, '');
    const branch = head.startsWith('No commits yet on ') ? head.slice(18)
      : head.startsWith('HEAD (no branch)') ? 'detached' : head.split('...')[0];
    info = { branch, dirty: lines.length - 1 };
  } catch {}
  saveCache({ git: { dir, at: Date.now(), info } });
  return info;
}

// ───────────── Claude 블록 ─────────────
function claudeBlock(j, versions, compact) {
  const cw = j.context_window || {};
  const model = ((j.model && (j.model.id || j.model.display_name)) || '?') + (j.effort && j.effort.level ? '(' + j.effort.level + ')' : '');

  // 현재 컨텍스트 사용량
  let size = cw.context_window_size || (/\[1m\]/i.test((j.model && j.model.id) || '') ? 1e6 : 2e5);
  let used = null;
  const cu = cw.current_usage;
  if (cu) used = (cu.input_tokens || 0) + (cu.cache_creation_input_tokens || 0) + (cu.cache_read_input_tokens || 0);
  if (used == null && j.transcript_path) {
    try {
      const lines = fs.readFileSync(j.transcript_path, 'utf8').trim().split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const row = JSON.parse(lines[i]);
        // 압축 직후: 아직 API 호출 전이라 usage가 없으므로 압축 결과 토큰 수를 쓴다
        if (row.type === 'system' && row.subtype === 'compact_boundary') {
          const post = row.compactMetadata && row.compactMetadata.postTokens;
          if (post != null) used = post;
          break;
        }
        const u = row.message && row.message.usage;
        if (u && !row.isSidechain) {
          used = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
          break;
        }
      }
    } catch {}
  }
  // 창 크기를 못 받았는데 200k를 넘었다면 1M 창으로 본다
  if (!cw.context_window_size && used > size) size = 1e6;
  // current_usage가 없으면(압축 직후 등) used_percentage는 0으로 오므로 기록에서 구한 값을 우선한다
  const pct = cw.used_percentage != null && cu ? Math.round(cw.used_percentage)
    : used != null ? Math.round((used / size) * 100) : null;
  const ctxRow = pct == null
    ? label('🧠', 'Context') + ' ' + emptyBar() + '     ' + WHITE + '-' + RESET
    : label('🧠', 'Context') + ' ' + bar(pct) + '  ' + pctText(pct) + (used != null ? info(k(used) + ' / ' + k(size)) : '');

  // 사용량 한도: 세션 시작 직후엔 rate_limits가 없으므로 마지막 값을 캐시해 대신 쓴다
  let rl = j.rate_limits;
  if (rl && (rl.five_hour || rl.seven_day)) {
    if (JSON.stringify(rl) !== JSON.stringify(loadCache().claudeRateLimit)) saveCache({ claudeRateLimit: rl });
  } else {
    rl = loadCache().claudeRateLimit || {};
  }
  const r5 = rl.five_hour || {}, r7 = rl.seven_day || {};
  const rows = [
    ctxRow,
    usageRow('⏳', '5H', r5.used_percentage, r5.resets_at, false),
    usageRow('📅', '7D', r7.used_percentage, r7.resets_at, true),
  ];
  const upd = claudeUpdateHint(j.version, versions);
  if (compact) {
    return [compactLine(ORANGE, '✻', model, [miniItem('🧠', pct, '-'),
      miniItem('⏳', shownPct(r5.used_percentage, r5.resets_at), '?'), miniItem('📅', shownPct(r7.used_percentage, r7.resets_at), '?')], upd)];
  }
  if (upd) rows.push(upd);
  return [blockHead(ORANGE, '✻', 'Claude', model), ...blockBody(rows)];
}

// 새 버전이 있으면 업데이트 명령, 이미 설치됐는데 이 세션이 옛 버전이면 재시작 안내
function claudeUpdateHint(running, v) {
  const installed = v.claudeInstalled;
  const newest = [running, installed].filter(Boolean).reduce((a, b) => (isNewer(b, a) ? b : a), '0');
  if (v.claudeLatest && isNewer(v.claudeLatest, newest)) {
    return PURPLE + '⬆ ' + newest + ' → ' + v.claudeLatest + RESET + '   ' + WHITE + BOLD + '! claude update' + RESET;
  }
  if (running && installed && isNewer(installed, running)) {
    return CYAN + '↻ ' + installed + ' installed · restart to apply' + RESET;
  }
  return '';
}

// ───────────── Codex 블록 ─────────────
function codexBlock(versions, compact) {
  if (!fs.existsSync(CODEX_HOME)) return [];
  const rl = codexRateLimits() || {};
  const p = rl.primary || {}, s = rl.secondary || {};
  const rows = [
    usageRow('⏳', '5H', p.used_percent, p.resets_at, false),
    usageRow('📅', '7D', s.used_percent, s.resets_at, true),
  ];
  const { codexInstalled, codexLatest } = versions;
  const hasUpdate = codexInstalled && codexLatest && isNewer(codexLatest, codexInstalled);
  if (compact) {
    return [compactLine(CODEX_TEAL, '◈', codexModel(), [miniItem('⏳', shownPct(p.used_percent, p.resets_at), '?'),
      miniItem('📅', shownPct(s.used_percent, s.resets_at), '?')], hasUpdate)];
  }
  if (hasUpdate) {
    rows.push(PURPLE + '⬆ ' + codexInstalled + ' → ' + codexLatest + RESET + '   ' + WHITE + BOLD + '! ' + CODEX_UPDATE_CMD + RESET);
  }
  return [blockHead(CODEX_TEAL, '◈', 'Codex', codexModel()), ...blockBody(rows)];
}

// 가장 최근 Codex 세션에서 실제로 쓴 모델(turn_context)을 보여 주고, 없으면 config.toml 기본값에 default 표시
function codexModel() {
  const used = codexUsedModel();
  if (used) return used;
  const def = codexDefaultModel();
  return def === '?' ? def : def + ' default';
}

function codexUsedModel() {
  const file = latestCodexSession();
  if (!file) return null;
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  const c = loadCache().codexUsedModel;
  if (c && c.file === file && c.mtime === mtime && c.model) return c.model;
  let model = readUsedModel(file);
  // 막 시작한 세션은 turn_context가 아직 없을 수 있다 → 이전 세션에서 찾는다
  if (!model) {
    for (const f of recentCodexSessions(10)) {
      if (f === file) continue;
      model = readUsedModel(f);
      if (model) break;
    }
  }
  saveCache({ codexUsedModel: { file, mtime, model } });
  return model;
}

function readUsedModel(file) {
  let model = null;
  try {
    const lines = fs.readFileSync(file, 'utf8').split(String.fromCharCode(10));
    for (let i = lines.length - 1; i >= 0 && !model; i--) {
      if (!lines[i].includes('"turn_context"')) continue;
      try {
        const p = JSON.parse(lines[i]).payload || {};
        if (p.model) model = p.model + (p.effort ? `(${p.effort})` : '');
      } catch {}
    }
  } catch {}
  return model;
}

function codexDefaultModel() {
  try {
    const toml = fs.readFileSync(path.join(CODEX_HOME, 'config.toml'), 'utf8');
    const top = toml.split(/^\s*\[/m)[0]; // 최상위 키만 본다
    const model = (top.match(/^\s*model\s*=\s*"([^"]+)"/m) || [])[1];
    const effort = (top.match(/^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m) || [])[1];
    return model ? model + (effort ? `(${effort})` : '') : '?';
  } catch { return '?'; }
}

// 가장 최근 Codex 세션 로그의 마지막 rate_limits를 읽는다 (파일 수정 시각이 같으면 캐시 사용)
function codexRateLimits() {
  const file = latestCodexSession();
  if (!file) return null;
  let mtime = 0;
  try { mtime = fs.statSync(file).mtimeMs; } catch { return null; }
  const c = loadCache().codexLimit;
  if (c && c.file === file && c.mtime === mtime && c.rl) return c.rl;
  let rl = readRateLimits(file);
  // 막 시작한 세션은 첫 응답 전까지 rate_limits가 없다 → 이전 세션 파일에서 찾는다
  if (!rl) {
    for (const f of recentCodexSessions(10)) {
      if (f === file) continue;
      rl = readRateLimits(f);
      if (rl) break;
    }
  }
  saveCache({ codexLimit: { file, mtime, rl } });
  return rl;
}

// 세션 파일 끝 512KB에서 마지막 rate_limits를 찾는다
function readRateLimits(file) {
  let rl = null;
  try {
    const fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, 512 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0 && !rl; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      try {
        const r = JSON.parse(lines[i]).payload.rate_limits;
        if (r && (r.primary || r.secondary)) rl = r;
      } catch {}
    }
  } catch {}
  return rl;
}

// sessions/YYYY/MM/DD/rollout-*.jsonl 중 가장 최근 것
function latestCodexSession() {
  return recentCodexSessions(1)[0] || null;
}

// 최근 날짜 폴더부터 거슬러 올라가며 세션 파일을 수정 시각 역순으로 n개
function recentCodexSessions(n) {
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= n) return;
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    if (depth < 3) {
      for (const d of names.filter(x => /^\d+$/.test(x)).sort().reverse()) {
        walk(path.join(dir, d), depth + 1);
        if (out.length >= n) return;
      }
      return;
    }
    const files = names.filter(x => x.endsWith('.jsonl'))
      .map(x => { const p = path.join(dir, x); let t = 0; try { t = fs.statSync(p).mtimeMs; } catch {} return { p, t }; })
      .sort((a, b) => b.t - a.t);
    for (const f of files) { if (out.length >= n) return; out.push(f.p); }
  };
  walk(path.join(CODEX_HOME, 'sessions'), 0);
  return out;
}

// ───────────── 버전 확인 (백그라운드, 상태줄 지연 없음) ─────────────
// 설치 버전은 10분마다, npm 최신 버전은 6시간마다 갱신한다.
function readVersions() {
  const cache = loadCache();
  const now = Date.now();
  const needLatest = !cache.latestCheckedAt || now - cache.latestCheckedAt > 6 * 3600 * 1000;
  const needInstalled = !cache.installedCheckedAt || now - cache.installedCheckedAt > 10 * 60 * 1000;
  if (needLatest || needInstalled) refreshVersions(needLatest, needInstalled);
  // Codex 최신 버전은 Codex가 직접 기록하는 version.json을 쓴다
  // npm 조회값(캐시)과 version.json 중 높은 쪽을 쓴다 — version.json은 Codex가 실행될 때만 갱신돼 오래될 수 있다
  let codexLatest = cache.codexLatest || null;
  try {
    const v = JSON.parse(fs.readFileSync(path.join(CODEX_HOME, 'version.json'), 'utf8')).latest_version;
    if (v && (!codexLatest || isNewer(v, codexLatest))) codexLatest = v;
  } catch {}
  return {
    claudeLatest: cache.claudeLatest,
    claudeInstalled: cache.claudeInstalled,
    codexInstalled: cache.codexInstalled,
    codexLatest,
  };
}

function refreshVersions(needLatest, needInstalled) {
  const now = Date.now();
  // 실패해도 다음 갱신 주기까지 다시 시도하지 않도록 먼저 시각을 기록한다
  const patch = {};
  if (needLatest) patch.latestCheckedAt = now;
  if (needInstalled) patch.installedCheckedAt = now;
  saveCache(patch);

  const script = `
    const fs = require('fs'), cp = require('child_process');
    const file = process.argv[1], needLatest = process.argv[2] === '1', needInstalled = process.argv[3] === '1';
    const ver = s => ((String(s).match(/\\d+\\.\\d+\\.\\d+/) || [])[0]);
    const save = patch => {
      let c = {}; try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
      try { fs.writeFileSync(file, JSON.stringify({ ...c, ...patch })); } catch {}
    };
    if (needInstalled) {
      const run = cmd => { try { return ver(cp.execSync(cmd, { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })); } catch { return undefined; } };
      save({ claudeInstalled: run('claude --version'), codexInstalled: run('codex --version') });
    }
    if (needLatest) {
      require('https').get('https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags', { timeout: 5000 }, res => {
        let b = ''; res.on('data', c => (b += c));
        res.on('end', () => { try { save({ claudeLatest: JSON.parse(b).latest }); } catch {} });
      }).on('error', () => {});
      require('https').get('https://registry.npmjs.org/-/package/@openai/codex/dist-tags', { timeout: 5000 }, res => {
        let b = ''; res.on('data', c => (b += c));
        res.on('end', () => { try { save({ codexLatest: JSON.parse(b).latest }); } catch {} });
      }).on('error', () => {});
    }`;
  try {
    require('child_process').spawn(process.execPath, ['-e', script, CACHE, needLatest ? '1' : '0', needInstalled ? '1' : '0'],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {}
}

function isNewer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}
