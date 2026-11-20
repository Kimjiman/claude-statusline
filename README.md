# claude-statusline

Claude Code 상태 표시줄과 Codex CLI 자동 업데이트 훅.

```
📁 my-project │ 🌿 main ●3 │ ⏱ 1h12m
╭─ ✻ Claude │ claude-opus-5-5 (medium)
│ 🧠 Context ███████░░░░░░░░░░░░░   37%  369k / 1M
│ ⏳ 5H      ████░░░░░░░░░░░░░░░░   21%  Fri 11/20 14:20 · 4h05m left
╰ 📅 7D      ████████░░░░░░░░░░░░   41%  Mon 11/23 01:00 · 2d14h left
╭─ ◈ Codex  │ gpt-6.2-sol (medium)
│ ⏳ 5H      ░░░░░░░░░░░░░░░░░░░░    0%  Reset
╰ 📅 7D      ████████████████░░░░   80%  Fri 11/20 10:16 · 2m left
```

- 1줄: 프로젝트 이름, 브랜치와 커밋 안 된 파일 수(`●N`), 세션 경과 시간
- Claude: 모델 ID(추론 강도), 컨텍스트, 5시간·7일 사용 한도
- Codex: 최근 Codex 세션에서 쓴 모델(추론 강도), 5시간·7일 사용 한도
- 사용률 색: 50% 미만 초록, 80% 미만 노랑, 그 이상 빨강
- 새 버전이 있으면 블록 마지막 줄에 업데이트 명령을 `! 명령` 형태로 표시(입력창에 그대로 붙여 넣기)
- Codex 블록은 `~/.codex`가 있을 때만 표시

### 작은 터미널 (3줄 모드)

터미널 폭이 80칸 미만이거나 높이가 25줄 미만이면 블록마다 한 줄로 줄여 3줄로 표시합니다.

```
📁 my-project │ 🌿 main ●3 │ ⏱ 1h12m
✻ claude-opus-5-5 (medium) │ 🧠  37%  ⏳  21%  📅  41%
◈ gpt-6.2-sol (medium) │ ⏳   0%  📅  80%  ⬆
```

- 🧠 컨텍스트, ⏳ 5시간 한도, 📅 7일 한도 사용률만 색과 함께 표시
- 업데이트가 있으면 줄 끝에 `⬆`만 표시(명령은 창을 키우면 보임)
- 크기는 Claude Code가 넘겨주는 `COLUMNS`·`LINES`로 판단하며, 창 크기를 바꾼 뒤 다음 갱신 때 반영
- 기준값은 `statusline.cjs`의 `COMPACT_MAX_COLS`(80), `COMPACT_MAX_LINES`(25)에서 변경

## 요구 사항

- Node.js (Claude Code가 쓰는 것과 같은 것으로 충분)
- 이모지·트루컬러를 지원하는 터미널(Windows Terminal, iTerm2 등)

## 설치

```sh
git clone https://github.com/Kimjiman/claude-statusline.git
cd claude-statusline
node install.js
```

설치 범위를 묻습니다.

| 선택 | 스크립트 위치 | 설정 파일 |
| --- | --- | --- |
| `1) project` | `<프로젝트>/.claude/` | `<프로젝트>/.claude/settings.local.json` (개인 설정, 공유 안 됨) |
| `2) all` | `~/.claude/` | `~/.claude/settings.json` (모든 프로젝트) |

옵션으로 바로 지정할 수도 있습니다.

```sh
node install.js --scope project C:/git-repo/my-project
node install.js --scope all
node install.js --scope all --no-codex-update   # Codex 자동 업데이트 훅 없이
```

- 기존 설정은 지우지 않고 합칩니다. 쓰기 전에 설정 파일을 `.bak`으로 백업합니다.
- 다시 실행해도 중복되지 않습니다. 업데이트는 `git pull` 후 같은 명령을 다시 실행합니다.
- project 설치 시 그 프로젝트가 git 저장소면, 복사한 파일과 `settings.local.json`이 커밋되지 않도록 `.gitignore`에 추가합니다(이미 무시되면 건드리지 않음).
- 새 세션부터 적용됩니다. 지금 세션은 `/hooks`를 한 번 열거나 재시작합니다.

## 제거

```sh
node install.js --uninstall                     # 범위를 묻는다
node install.js --uninstall --scope all
```

우리가 넣은 `statusLine`과 훅만 지우고, 다른 설정과 훅은 그대로 둡니다.

## Codex 자동 업데이트 훅 (`codex-auto-update.cjs`)

세션을 새로 열거나 이어서 열 때(`SessionStart`, `startup|resume`) Codex 새 버전이 있으면 백그라운드로 `codex update`를 실행합니다.

- Codex가 실행 중이면 건너뜁니다(파일 잠금).
- 같은 버전은 1시간 안에 다시 시도하지 않습니다.
- 진행 기록: 설치 폴더의 `codex-update.log`
- Claude Code는 내장 자동 업데이트를 쓰므로 다루지 않습니다(상태줄이 알림만 표시).

### Windows 참고

Git Bash에서 `codex update`를 실행하면 Git의 GNU `tar`가 Windows `tar`보다 먼저 잡혀 `Cannot connect to C: resolve failed`로 실패합니다. 그래서

- 훅은 PATH 맨 앞에 `System32`를 두고 PowerShell로 업데이트를 실행합니다.
- 상태줄의 수동 업데이트 안내도 `PATH="/c/Windows/System32:$PATH" codex update`로 표시합니다.

## 파일

| 파일 | 역할 |
| --- | --- |
| `statusline.cjs` | 상태 표시줄 |
| `codex-auto-update.cjs` | Codex 자동 업데이트 훅 |
| `install.js` | 설치·제거 |
| `statusline-cache.json` | 실행 중 생기는 캐시(사용 한도·버전·git). 지워도 다시 생김 |
