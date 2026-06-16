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

MODEL="${OLLAMA_MODEL:-gemma4:12b}"
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
