// SessionStart(startup|resume) 훅: Codex CLI 새 버전이 있으면 백그라운드로 설치한다.
// - Claude Code는 내장 자동 업데이트를 쓰므로 여기서 다루지 않는다. 알림은 statusline.cjs가 맡는다.
// - Windows: Git Bash 환경을 물려받으면 GNU tar가 먼저 잡혀 설치가 실패하므로 PATH 맨 앞에 System32를 둔다.
// - Codex가 실행 중이면(파일 잠금) 건너뛰고, 같은 버전은 1시간 안에 다시 시도하지 않는다.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const https = require('https');

const CACHE = path.join(__dirname, 'statusline-cache.json');
const LOG = path.join(__dirname, 'codex-update.log');
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const loadCache = () => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch { return {}; } };
const saveCache = patch => { try { fs.writeFileSync(CACHE, JSON.stringify({ ...loadCache(), ...patch })); } catch {} };
const ver = s => ((String(s).match(/\d+\.\d+\.\d+/) || [])[0]);
const isNewer = (a, b) => {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
};
const npmLatest = () => new Promise(resolve => {
  const req = https.get('https://registry.npmjs.org/-/package/@openai/codex/dist-tags', { timeout: 5000 }, res => {
    let b = '';
    res.on('data', c => (b += c));
    res.on('end', () => { try { resolve(JSON.parse(b).latest); } catch { resolve(undefined); } });
  });
  req.on('timeout', () => { req.destroy(); resolve(undefined); });
  req.on('error', () => resolve(undefined));
});
const codexRunning = () => {
  try {
    if (process.platform === 'win32') {
      const out = cp.execSync('tasklist /FI "IMAGENAME eq codex.exe" /NH', { timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      return /codex\.exe/i.test(String(out));
    }
    cp.execSync('pgrep -x codex', { timeout: 5000, stdio: 'ignore' });
    return true; // pgrep은 찾으면 0, 못 찾으면 1(예외)
  } catch { return false; }
};
const log = line => { try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + line + '\n'); } catch {} };

(async () => {
  if (!fs.existsSync(CODEX_HOME)) return;
  let installed;
  try { installed = ver(cp.execSync('codex --version', { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })); } catch {}
  const latest = (await npmLatest()) || loadCache().codexLatest;
  if (installed) saveCache({ codexInstalled: installed });
  if (latest) saveCache({ codexLatest: latest });
  if (!installed || !latest || !isNewer(latest, installed)) return;

  const last = loadCache().codexUpdateAttempt || {};
  if (last.version === latest && Date.now() - (last.at || 0) < 3600 * 1000) return;
  if (codexRunning()) { log(`skip ${installed} -> ${latest}: codex 실행 중`); return; }
  saveCache({ codexUpdateAttempt: { version: latest, at: Date.now() } });

  const env = { ...process.env, CODEX_NON_INTERACTIVE: '1' };
  log(`start ${installed} -> ${latest}`);
  const out = fs.openSync(LOG, 'a');
  const opts = { env, detached: true, stdio: ['ignore', out, out], windowsHide: true };
  if (process.platform === 'win32') {
    // Git Bash 환경을 물려받으면 GNU tar가 먼저 잡혀 설치가 실패하므로 System32를 PATH 맨 앞에 둔다
    const key = Object.keys(env).find(k => k.toLowerCase() === 'path') || 'PATH';
    env[key] = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') + path.delimiter + (env[key] || '');
    cp.spawn('powershell', ['-NoProfile', '-Command', 'codex update'], opts).unref();
  } else {
    cp.spawn('codex', ['update'], opts).unref();
  }
  process.stdout.write(JSON.stringify({
    systemMessage: `⬆ Codex CLI ${installed} → ${latest} 백그라운드 업데이트 시작 (기록: ${LOG})`,
  }));
})();
