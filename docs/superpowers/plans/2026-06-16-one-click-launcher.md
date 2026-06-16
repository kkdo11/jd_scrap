# 원클릭 런처 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Windows 바탕화면 `.bat` 더블클릭 한 번으로 안정성 점검·자동 복구·실행·리포트 열기를 끝내는 로컬 원클릭 런처를 만든다.

**Architecture:** 진짜 로직은 리포 안 `run.sh`(bash) 한 곳에 모은다 — 8단계 점검/자동복구/실행/리포트오픈. Windows용 `win/원티드매칭.bat`은 WSL 안으로 들어가 `run.sh`를 호출하는 얇은 래퍼. 모든 출력은 화면+`run.log`에 기록.

**Tech Stack:** bash, Windows 배치(.bat), WSL2 interop(`wslpath`/`explorer.exe`), 기존 npm/tsx/Ollama 파이프라인.

> **테스트 방식 메모:** 본 리포에 자동화 테스트 인프라가 없으므로(README: `tsc --noEmit`만), 각 태스크는 "실패 테스트 먼저" 대신 **구체적 수동 검증 명령 + 예상 출력**으로 검증한다. 설계 문서: `docs/superpowers/specs/2026-06-16-one-click-launcher-design.md`.

> **커밋 메모:** 전역 규칙상 무단 커밋 금지. 각 태스크의 commit 스텝은 **사용자 승인 후** 실행한다(실행 단계에서 확인).

---

## 파일 구조

- **Create:** `run.sh` — 메인 런처. 8단계 점검/자동복구/실행/리포트오픈. (실행 권한)
- **Create:** `win/원티드매칭.bat` — Windows 더블클릭 래퍼.
- **Modify:** `README.md` — "원클릭 실행" 섹션 추가.
- `run.log` — 런타임 자동 생성. `.gitignore`의 `*.log`로 이미 제외됨(수정 불필요).

---

## Task 1: `run.sh` 뼈대 — 위치 고정·로깅·에러 트랩·헬퍼

**Files:**
- Create: `run.sh`

- [ ] **Step 1: `run.sh` 작성 (뼈대만)**

```bash
#!/usr/bin/env bash
# Wanted Job Matcher 원클릭 런처
# 8단계: node → node_modules → resume.txt → ollama → 서버 → 모델 → 실행 → 리포트
set -euo pipefail

# --- 스크립트 위치로 이동 (어디서 호출돼도 리포 루트 기준) ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# --- 로그: 화면 + run.log 동시 기록 ---
LOG_FILE="$SCRIPT_DIR/run.log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "================================================================"
echo "  Wanted Job Matcher 실행  $(date '+%Y-%m-%d %H:%M:%S')"
echo "================================================================"

MODEL="${OLLAMA_MODEL:-exaone3.5:7.8b}"
OLLAMA_PORT=11434

# --- 출력 헬퍼 ---
ok()   { echo "  ✓ $1"; }
info() { echo "  … $1"; }
fail() { echo "  ✗ $1" >&2; }

die() {
  fail "$1"
  echo ""
  echo "----------------------------------------------------------------"
  echo "  실행이 중단되었습니다. 위 메시지를 확인하세요."
  echo "  자세한 로그: $LOG_FILE"
  echo "----------------------------------------------------------------"
  exit 1
}

trap 'die "예상치 못한 오류가 발생했습니다 (line $LINENO)."' ERR

echo ""
echo "(뼈대 동작 확인용 임시 줄 — Task 2에서 제거)"
```

- [ ] **Step 2: 실행 권한 부여**

Run: `chmod +x /home/kdw03/scrap/run.sh`
Expected: 출력 없음(성공)

- [ ] **Step 3: 뼈대 실행 검증**

Run: `cd /home/kdw03/scrap && ./run.sh`
Expected: 헤더 배너 + 날짜 + "(뼈대 동작 확인용 임시 줄 …)" 가 화면에 출력되고, `run.log` 파일이 생성되며 같은 내용이 들어있음. 종료코드 0.

- [ ] **Step 4: 로그 기록 검증**

Run: `tail -n 3 /home/kdw03/scrap/run.log`
Expected: 방금 출력한 임시 줄이 로그에도 남아있음.

- [ ] **Step 5: Commit (사용자 승인 후)**

```bash
git add run.sh
git commit -m "feat: 원클릭 런처 run.sh 뼈대 추가 (로깅·에러 트랩)"
```

---

## Task 2: 점검 1~2단계 — Node.js / node_modules

**Files:**
- Modify: `run.sh`

- [ ] **Step 1: 임시 줄을 1~2단계 점검 로직으로 교체**

`run.sh`에서 아래 임시 줄을

```bash
echo ""
echo "(뼈대 동작 확인용 임시 줄 — Task 2에서 제거)"
```

다음으로 교체:

```bash
# ---------------- [1/8] Node.js ----------------
echo ""
echo "[1/8] Node.js 확인"
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  fail "Node.js / npm 이 설치되어 있지 않습니다."
  echo "      WSL 터미널에서 아래로 설치하세요:"
  echo "        sudo apt update && sudo apt install -y nodejs npm"
  echo "        (또는 nvm: https://github.com/nvm-sh/nvm)"
  die "Node.js 설치 후 다시 실행하세요."
fi
ok "Node $(node -v) / npm v$(npm -v)"

# ---------------- [2/8] 의존성 ----------------
echo ""
echo "[2/8] 의존성(node_modules) 확인"
if [ ! -d node_modules ]; then
  info "node_modules 가 없어 npm install 을 실행합니다 (처음 한 번, 1~2분)…"
  npm install || die "npm install 실패. 위 로그를 확인하세요."
  ok "의존성 설치 완료"
else
  ok "이미 설치됨"
fi
```

- [ ] **Step 2: 정상 경로 검증**

Run: `cd /home/kdw03/scrap && ./run.sh`
Expected: `[1/8] Node.js 확인` → `✓ Node vXX / npm vYY`, `[2/8] … ✓ 이미 설치됨`(node_modules 존재하므로) 출력. 종료코드 0.

- [ ] **Step 3: 자동복구 경로 검증 (node_modules 없음)**

Run:
```bash
cd /home/kdw03/scrap && mv node_modules node_modules.bak && ./run.sh; echo "exit=$?"
```
Expected: `[2/8]` 에서 "node_modules 가 없어 npm install …" 후 설치 진행, `✓ 의존성 설치 완료` 출력.

- [ ] **Step 4: 원복**

Run:
```bash
cd /home/kdw03/scrap && rm -rf node_modules && mv node_modules.bak node_modules 2>/dev/null || npm install
```
Expected: node_modules 복구됨. (백업이 있으면 그대로, 없으면 재설치)

- [ ] **Step 5: Commit (사용자 승인 후)**

```bash
git add run.sh
git commit -m "feat: 런처 1~2단계 — Node/node_modules 점검·자동설치"
```

---

## Task 3: 점검 3단계 — resume.txt 존재·내용 확인 + 템플릿 생성

**Files:**
- Modify: `run.sh`

- [ ] **Step 1: 2단계 블록 바로 뒤에 3단계 추가**

`run.sh`의 `[2/8]` 블록(위 `ok "이미 설치됨" ... fi`) 다음 줄에 추가:

```bash
# ---------------- [3/8] 이력서 ----------------
echo ""
echo "[3/8] 이력서(resume.txt) 확인"
RESUME_MIN_BYTES=50
if [ ! -f resume.txt ] || [ "$(wc -c < resume.txt)" -lt "$RESUME_MIN_BYTES" ]; then
  if [ ! -f resume.txt ]; then
    cat > resume.txt <<'TEMPLATE'
# 이력서 (이 파일을 본인 내용으로 채우세요)

## 학력


## 경력


## 기술 스택


## 프로젝트

TEMPLATE
    fail "resume.txt 가 없어 템플릿을 만들었습니다."
  else
    fail "resume.txt 내용이 거의 비어 있습니다."
  fi
  echo "      resume.txt 를 열어 본인 이력서를 채운 뒤 다시 실행하세요."
  echo "      (PDF 이력서가 있으면 전체 복사해서 붙여넣으면 됩니다)"
  die "이력서를 채운 뒤 다시 실행하세요."
fi
ok "이력서 준비됨 ($(wc -c < resume.txt) bytes)"
```

- [ ] **Step 2: 정상 경로 검증 (resume.txt 존재)**

Run: `cd /home/kdw03/scrap && ./run.sh`
Expected: `[3/8] 이력서(resume.txt) 확인` → `✓ 이력서 준비됨 (NNNN bytes)` 출력 후 다음 단계로 진행(현재는 4단계 미구현이라 여기서 끝나도 됨). 종료코드 0.

- [ ] **Step 3: 자동복구/중단 경로 검증 (resume.txt 없음)**

Run:
```bash
cd /home/kdw03/scrap && mv resume.txt resume.txt.bak && ./run.sh; echo "exit=$?"
```
Expected: "resume.txt 가 없어 템플릿을 만들었습니다." + 안내 메시지 + `exit=1`. 그리고 새 `resume.txt`(템플릿)가 생성됨.

- [ ] **Step 4: 원복**

Run: `cd /home/kdw03/scrap && mv -f resume.txt.bak resume.txt`
Expected: 원래 이력서 복구.

- [ ] **Step 5: Commit (사용자 승인 후)**

```bash
git add run.sh
git commit -m "feat: 런처 3단계 — resume.txt 점검·템플릿 생성"
```

---

## Task 4: 점검 4~5단계 — Ollama 설치 + 서버 자동 시작

**Files:**
- Modify: `run.sh`

- [ ] **Step 1: 3단계 블록 뒤에 4~5단계 추가**

`run.sh`의 `[3/8]` 블록 다음에 추가:

```bash
# ---------------- [4/8] Ollama 설치 ----------------
echo ""
echo "[4/8] Ollama 설치 확인"
if ! command -v ollama >/dev/null 2>&1; then
  fail "Ollama 가 설치되어 있지 않습니다."
  echo "      WSL 터미널에서 아래로 설치하세요:"
  echo "        curl -fsSL https://ollama.com/install.sh | sh"
  die "Ollama 설치 후 다시 실행하세요."
fi
ok "Ollama 설치됨"

# ---------------- [5/8] Ollama 서버 ----------------
echo ""
echo "[5/8] Ollama 서버 확인"
server_up() { curl -s "http://localhost:${OLLAMA_PORT}/api/tags" >/dev/null 2>&1; }
if server_up; then
  ok "서버 이미 실행 중"
else
  info "서버가 꺼져 있어 시작합니다…"
  nohup ollama serve >> "$LOG_FILE" 2>&1 &
  for i in $(seq 1 30); do
    if server_up; then break; fi
    sleep 1
  done
  if server_up; then
    ok "서버 시작 완료"
  else
    die "Ollama 서버가 30초 내에 준비되지 않았습니다. 'ollama serve' 를 수동으로 확인하세요."
  fi
fi
```

- [ ] **Step 2: 정상/자동시작 경로 검증**

Run: `cd /home/kdw03/scrap && ./run.sh`
Expected: `[4/8] … ✓ Ollama 설치됨`. `[5/8]` 에서 서버가 켜져 있으면 `✓ 서버 이미 실행 중`, 꺼져 있으면 "서버가 꺼져 있어 시작합니다…" 후 `✓ 서버 시작 완료`. 종료코드 0.

- [ ] **Step 3: 서버 응답 직접 확인**

Run: `curl -s http://localhost:11434/api/tags | head -c 80; echo`
Expected: JSON(예: `{"models":[...]}`) 출력 — 서버가 실제로 응답함.

- [ ] **Step 4: Commit (사용자 승인 후)**

```bash
git add run.sh
git commit -m "feat: 런처 4~5단계 — Ollama 설치 점검·서버 자동 시작"
```

---

## Task 5: 점검 6단계 — 모델 존재 확인 + 자동 pull

**Files:**
- Modify: `run.sh`

- [ ] **Step 1: 5단계 블록 뒤에 6단계 추가**

`run.sh`의 `[5/8]` 블록 다음에 추가:

```bash
# ---------------- [6/8] 모델 ----------------
echo ""
echo "[6/8] 모델($MODEL) 확인"
if ollama list 2>/dev/null | grep -q "$MODEL"; then
  ok "모델 준비됨"
else
  info "모델이 없어 다운로드합니다 (~5GB, 네트워크에 따라 수 분)…"
  ollama pull "$MODEL" || die "모델 다운로드 실패. 네트워크/모델명($MODEL)을 확인하세요."
  ok "모델 다운로드 완료"
fi
```

- [ ] **Step 2: 정상 경로 검증 (모델 존재 시)**

Run: `cd /home/kdw03/scrap && ./run.sh`
Expected: `[6/8] 모델(exaone3.5:7.8b) 확인` → 모델이 이미 받아져 있으면 `✓ 모델 준비됨`. 없으면 다운로드가 시작됨(진행률 표시). 종료코드 0.

- [ ] **Step 3: 모델 목록 직접 확인**

Run: `ollama list`
Expected: `exaone3.5:7.8b` (또는 `$OLLAMA_MODEL`로 지정한 모델)이 목록에 보임.

- [ ] **Step 4: Commit (사용자 승인 후)**

```bash
git add run.sh
git commit -m "feat: 런처 6단계 — 모델 존재 점검·자동 pull"
```

---

## Task 6: 7~8단계 — 분석 실행 + 리포트 자동 열기 + 마무리 배너

**Files:**
- Modify: `run.sh`

- [ ] **Step 1: 6단계 블록 뒤에 7~8단계 + 마무리 추가**

`run.sh`의 `[6/8]` 블록 다음(파일 끝)에 추가:

```bash
# ---------------- [7/8] 분석 실행 ----------------
echo ""
echo "[7/8] 공고 분석 실행"
echo "  (GPU에 따라 5~10분 정도 걸립니다. 진행 상황이 아래 출력됩니다)"
echo "----------------------------------------------------------------"
if ! npm start -- "$@"; then
  die "분석 실행 중 오류가 발생했습니다. 위 로그를 확인하세요."
fi
echo "----------------------------------------------------------------"
ok "분석 완료"

# ---------------- [8/8] 리포트 열기 ----------------
echo ""
echo "[8/8] 리포트 열기"
if [ -f report.html ]; then
  if command -v wslpath >/dev/null 2>&1 && command -v explorer.exe >/dev/null 2>&1; then
    explorer.exe "$(wslpath -w report.html)" || true
    ok "report.html 을 Windows 기본 브라우저로 열었습니다"
  else
    ok "report.html 생성됨: $SCRIPT_DIR/report.html (브라우저로 직접 여세요)"
  fi
else
  fail "report.html 이 생성되지 않았습니다. 로그를 확인하세요: $LOG_FILE"
fi

echo ""
echo "================================================================"
echo "  완료! 추천 공고는 브라우저(report.html)에서 확인하세요."
echo "================================================================"
```

> 참고: `npm start` 스크립트는 `tsx src/index.ts`. `npm start -- "$@"` 로 공고 수 인자(예: `50`)를 그대로 전달한다. 인자가 없으면 `npm start --` 가 되어 기본값(40개)으로 동작.

- [ ] **Step 2: 전체 정상 경로 검증 (실제 분석 1회)**

Run: `cd /home/kdw03/scrap && ./run.sh 5`
Expected: 1~6단계 ✓ 통과 → `[7/8]` 에서 5개 공고 분석 진행(콘솔에 TOP 미리보기) → `✓ 분석 완료` → `[8/8]` 에서 `report.html` 생성·열림 → 마무리 배너. 종료코드 0. (적은 수 `5`로 빠르게 검증)

- [ ] **Step 3: 리포트 생성 확인**

Run: `ls -la /home/kdw03/scrap/report.html`
Expected: 방금 갱신된 타임스탬프의 `report.html` 존재.

- [ ] **Step 4: 멱등성 검증 (연속 2회)**

Run: `cd /home/kdw03/scrap && ./run.sh 5 && ./run.sh 5`
Expected: 두 번 모두 끝까지 성공(이미 충족된 단계는 ✓로 건너뜀). 종료코드 0.

- [ ] **Step 5: Commit (사용자 승인 후)**

```bash
git add run.sh
git commit -m "feat: 런처 7~8단계 — 분석 실행·리포트 자동 열기"
```

---

## Task 7: Windows 더블클릭 래퍼 `win/원티드매칭.bat`

**Files:**
- Create: `win/원티드매칭.bat`

- [ ] **Step 1: `win/원티드매칭.bat` 작성**

```bat
@echo off
chcp 65001 > nul
title Wanted Job Matcher
echo Wanted Job Matcher 를 실행합니다...
echo.
wsl -e bash -lc "cd ~/scrap && ./run.sh"
echo.
echo ================================================================
echo  창을 닫으려면 아무 키나 누르세요.
echo ================================================================
pause > nul
```

> 참고: 리포가 `~/scrap`가 아닌 다른 WSL 경로면 `cd ~/scrap` 부분을 실제 경로로 바꿔야 한다(README에 안내). `chcp 65001`은 한글 깨짐 방지, `pause`는 실행/에러 후 창 유지.

- [ ] **Step 2: 파일 생성 확인**

Run: `cat /home/kdw03/scrap/win/원티드매칭.bat`
Expected: 위 내용 그대로 출력.

- [ ] **Step 3: WSL interop 경로 동작 검증 (래퍼가 부르는 명령과 동일)**

Run: `bash -lc "cd ~/scrap && echo OK-경로존재 && test -x ./run.sh && echo OK-실행권한"`
Expected: `OK-경로존재` 와 `OK-실행권한` 둘 다 출력 — `.bat`이 호출할 명령이 정상.

- [ ] **Step 4: Commit (사용자 승인 후)**

```bash
git add win/원티드매칭.bat
git commit -m "feat: Windows 더블클릭 래퍼 .bat 추가"
```

---

## Task 8: README "원클릭 실행" 섹션 추가

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README의 "## 사용법" 섹션 바로 앞에 새 섹션 삽입**

`README.md`에서 다음 줄을 찾는다:

```markdown
## 사용법
```

그 줄 **바로 앞**에 아래 블록을 삽입:

```markdown
## ⚡ 원클릭 실행 (Windows + WSL)

매번 터미널 열고 명령 치기 귀찮다면, **더블클릭 한 번**으로 끝낼 수 있습니다.

### 준비 (처음 한 번)
1. 이 리포가 WSL의 `~/scrap`에 있다고 가정합니다. 다른 경로면 `win/원티드매칭.bat` 안의 `cd ~/scrap`를 실제 경로로 바꾸세요.
2. `win/원티드매칭.bat` 파일을 **Windows 바탕화면에 복사**하거나, 바로가기를 만드세요.
   - WSL에서 바탕화면으로 복사 예시:
     ```bash
     cp ~/scrap/win/원티드매칭.bat /mnt/c/Users/<윈도우계정>/Desktop/
     ```

### 실행
- 바탕화면의 **원티드매칭.bat 더블클릭** → 끝나면 브라우저에 `report.html`이 자동으로 뜹니다.

### 자동으로 해주는 것 (안정성 점검 + 자동 복구)
더블클릭하면 `run.sh`가 순서대로 점검하고, 빠진 건 알아서 복구합니다:

| 단계 | 점검 | 문제 시 |
| --- | --- | --- |
| 1 | Node.js/npm | 없으면 설치 안내 후 중단 |
| 2 | node_modules | 없으면 `npm install` 자동 |
| 3 | resume.txt | 없으면 템플릿 생성 후 "채우세요" 안내 |
| 4 | Ollama 설치 | 없으면 설치 명령 안내 후 중단 |
| 5 | Ollama 서버 | 꺼져 있으면 자동 시작 |
| 6 | 모델 | 없으면 자동 다운로드(~5GB) |
| 7 | 공고 분석 | 실행 |
| 8 | report.html | Windows 기본 브라우저로 자동 열기 |

> 진행 로그는 `run.log`에 쌓입니다. 문제가 생기면 이 파일을 확인하세요.

### 터미널에서 쓰고 싶다면
`.bat` 없이 WSL 터미널에서 직접:
```bash
./run.sh        # 기본 40개
./run.sh 20     # 20개만 빠르게
```

---

```

- [ ] **Step 2: 삽입 위치/내용 검증**

Run: `grep -n "원클릭 실행" /home/kdw03/scrap/README.md`
Expected: 새 섹션 헤더 줄 번호가 기존 `## 사용법` 보다 앞에 위치.

- [ ] **Step 3: Commit (사용자 승인 후)**

```bash
git add README.md
git commit -m "docs: README에 원클릭 실행 섹션 추가"
```

---

## 최종 검증 (전체 통합)

- [ ] **Step 1: 깨끗한 상태에서 전 구간 검증**

Run: `cd /home/kdw03/scrap && ./run.sh 5; echo "exit=$?"`
Expected: 1~8단계 전부 ✓, `report.html` 열림, `exit=0`.

- [ ] **Step 2: 타입 체크 (기존 코드 무손상 확인)**

Run: `cd /home/kdw03/scrap && npx tsc --noEmit; echo "exit=$?"`
Expected: `exit=0` (런처는 TS 코드를 건드리지 않으므로 기존과 동일).

- [ ] **Step 3: 산출물 점검**

Run: `ls -la /home/kdw03/scrap/run.sh /home/kdw03/scrap/win/원티드매칭.bat`
Expected: `run.sh`(실행권한 `x`), `win/원티드매칭.bat` 둘 다 존재.
