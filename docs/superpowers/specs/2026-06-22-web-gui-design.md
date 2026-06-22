# 웹 GUI + 원격 실행 기반 (조각 A) 설계

> 작성일: 2026-06-22
> 범위: 로드맵 조각 **A — 웹 서비스 + GUI**
> 다음 조각: B(친구 원격 접속), C(중복 제거), D(자연어 쿼리)는 각자 별도 spec

## 배경 & 목표

현재 Wanted Job Matcher는 CLI 도구다. `resume.txt`를 읽어 원티드 공고를 수집·채점하고
`report.html`을 생성한다. 이를 **브라우저에서 쓸 수 있는 웹 앱**으로 진화시킨다.

이번 조각(A)의 목표:

- 브라우저 화면에서 이력서를 붙여넣고 실행 → 진행률을 실시간으로 보며 → 결과를 카드로 확인
- 기존 CLI 동작은 그대로 유지 (회귀 없음)
- 이후 B(친구 원격 접속)의 기반이 되는 구조 마련

**비목표 (이번 조각 아님):** 친구 원격 접속/터널링(B), 중복 제거(C), 자연어 쿼리(D),
실행 중도 취소, 다중 사용자 대기열.

## 전체 요약

- **스택:** Node + Express + 바닐라 프론트엔드. 진행률은 `fetch()` POST + 응답 스트림(SSE 형식).
- **CSS:** 원티드(wanted.co.kr) 스타일 — 흰 배경, 둥근 카드, 원티드 블루 포인트색,
  Pretendard/Noto Sans KR 폰트, 넉넉한 여백, 태그 칩. 결과 카드는 원티드 공고 카드 느낌.
- **구조:** `pipeline.ts`로 수집→채점 오케스트레이션을 공유. CLI와 웹이 동일 함수를 재사용하되
  진행 출력만 각자(콜백→console.log / 콜백→SSE)로 연결.
- **안전:** 단일 실행 잠금(GPU 1개 현실 반영), try/finally로 잠금 해제 보장, 친절한 에러 배너.
- **테스트:** Node 내장 `node:test`로 입력검증·잠금·SSE포맷·pipeline 콜백 단위 테스트.

## 아키텍처 & 파일 구조

```
src/
  wanted.ts        (무수정) 공고 수집
  scorer.ts        (소폭 수정) console.log 진행출력 → onScored 콜백으로 교체
  reporter.ts      (무수정) CLI용 report.html 생성
  types.ts         (확장) ProgressEvent 타입 추가
  pipeline.ts      (신규) 수집→채점을 묶고 진행상황을 콜백으로 emit하는 공유 함수
  index.ts         (수정) pipeline 호출 + 콜백을 console.log로 연결 (CLI)
  server.ts        (신규) Express 서버: 화면 서빙 + POST /run(SSE) + 단일 실행 잠금
public/
  index.html       (신규) GUI 한 화면 (이력서 입력 + 옵션 + 진행률 + 결과 카드)
  app.js           (신규) fetch 스트리밍 수신 + 카드 라이브 렌더
  style.css        (신규) 원티드풍 스타일
```

**설계 원칙:** 기존 동작이 깨질 위험을 최소화한다. `wanted.ts`·`reporter.ts`는 손대지 않고,
`scorer.ts`는 진행 출력 부분만 콜백화한다(콜백 없으면 기존처럼 동작 → 하위호환). 나머지는 신규 파일.

## 데이터 흐름

`EventSource`는 GET 전용이라 이력서(긴 텍스트)를 POST 본문으로 못 보낸다.
따라서 **`fetch()` POST + 응답 스트림 읽기(`response.body.getReader()`)**를 사용한다.
한 번의 요청으로 이력서를 올리고 진행률을 `text/event-stream` 형식으로 내려받는다.

```
[브라우저]                          [Express 서버]                    [기존 로직]
   │  ① 이력서+개수 입력, 실행 클릭       │
   │── POST /run {resume, limit} ───────▶│
   │                                     │── 잠금 확인 (실행중이면 409 즉시 반환)
   │                                     │── 잠금 획득, SSE 헤더 전송
   │◀── event: status ───────────────────│   "공고 수집 중..."
   │                                     │──────────▶ fetchJobsWithDetails()
   │◀── event: status ───────────────────│   "N개 채점 시작"
   │                                     │──────────▶ scoreAllJobs(onScored)
   │◀── event: scored {index,total,job} ─│   ...한 건씩 반복...
   │◀── event: done {count} ─────────────│── 잠금 해제
```

### 진행 이벤트 4종

| 이벤트 | 페이로드 | 화면 동작 |
|--------|----------|-----------|
| `status` | `{message}` | 상단 상태줄 갱신 |
| `scored` | `{index, total, job}` | 진행바 갱신 + 카드 1개 추가 |
| `done` | `{count}` | 카드 점수순 정렬 + "완료" 표시 |
| `error` | `{message}` | 에러 배너 표시 + 잠금 해제 |

클라이언트는 `getReader()` 청크를 줄 단위로 파싱해 이벤트별 DOM을 갱신한다.
채점된 공고는 들어오는 즉시 카드로 append하고, `done`에서 점수순 재정렬한다.

## 컴포넌트 세부

### `pipeline.ts` (신규) — 공유 오케스트레이션

```ts
export type ProgressEvent =
  | { type: 'status'; message: string }
  | { type: 'scored'; index: number; total: number; job: ScoredJob }
  | { type: 'done'; count: number }
  | { type: 'error'; message: string };

// 수집→채점을 묶고, 단계마다 onProgress 호출. 최종 결과 배열 반환.
export async function runPipeline(
  resume: string,
  limit: number,
  onProgress: (e: ProgressEvent) => void
): Promise<ScoredJob[]>;
```

내부에서 `fetchJobsWithDetails(limit)` → `scoreAllJobs(jobs, resume, onScored)` 호출.
CLI든 웹이든 이 함수 하나만 부르고, 차이는 `onProgress`를 어디로 연결하느냐뿐.

### `scorer.ts` (소폭 수정)

- `scoreAllJobs(jobs, resume)` → `scoreAllJobs(jobs, resume, onScored?)` 콜백 파라미터 추가
- 현재 `console.log(...)` 자리에서 `onScored?.({ index, total, job })` 호출
- 콜백이 없으면 기존처럼 동작 → 하위호환 유지(index.ts 안 깨짐).
  CLI는 콜백으로 console.log를 넘겨 동일 출력 유지.

### `server.ts` (신규) — Express

| 라우트 | 역할 |
|--------|------|
| `GET /` | `public/index.html` 서빙 (`express.static`) |
| `POST /run` | 본문 `{resume, limit}` 검증 → 잠금 확인 → SSE로 `runPipeline` 진행률 전송 |
| (정적) | `express.static('public')`로 `app.js`, `style.css` 자동 서빙 |

- **단일 실행 잠금:** 모듈 스코프 `let running = false`. `POST /run` 진입 시 `running`이면
  **409 + "이미 실행 중"** 즉시 반환. 아니면 `running=true`, `finally`에서 항상 `running=false`
  (에러·연결끊김 포함).
- **입력 검증(수동):** `resume` 비었으면 400. `limit`는 숫자·1~100 클램프(기존 CLI 검증 재사용).
- **포트:** `PORT ?? 3000`.

### `public/` — 프론트 (바닐라)

- `index.html`: 이력서 textarea + 개수 input(기본 50) + 실행 버튼 + 상태줄 + 진행바 + 결과 카드 컨테이너
- `app.js`: 실행 클릭 → `fetch('/run', POST)` → `getReader()` 루프 → 이벤트별 DOM 갱신.
  실행 중 버튼 비활성화.
- `style.css`: 원티드풍 스타일(카드/색상/폰트/여백)

### `index.ts` (CLI, 수정)

현재의 수집·채점 인라인 코드를 `runPipeline(resume, limit, cb)` 호출로 교체.
`cb`는 기존 console.log 출력을 재현. 그 뒤 `reporter.ts`로 `report.html` 생성(기존 동일).

## 에러 처리 & 엣지케이스

| 상황 | 처리 |
|------|------|
| Ollama 미실행(ECONNREFUSED) | 기존 친절 메시지를 `error` 이벤트 → 화면 배너 |
| 이미 실행 중 | `POST /run` 409 + "이미 실행 중입니다", 새 실행 차단 |
| 이력서 비었음 | 400 + 안내(프론트에서도 빈값이면 버튼 비활성) |
| 개수 범위 밖 | 1~100 클램프, 잘못된 값은 50 |
| 수집 0건 | `done` count=0 → "조건에 맞는 공고가 없습니다" |
| 개별 공고 채점 실패 | 기존 동작 유지 — 0점 + "분석 실패" 카드, 전체 중단 안 함 |
| 실행 중 브라우저 닫음/새로고침 | 응답 스트림 `close` 감지 시 `running=false`. 채점 루프는 끝까지 돌되 잠금은 해제 |
| 잠금 데드락 방지 | `runPipeline`을 try/finally로 감싸 어떤 경로로 끝나도 `running=false` 보장 |

**트레이드오프(승인됨):** 실행 중 브라우저를 닫아도 GPU 작업은 끝까지 돈다.
중도 취소는 이번에 넣지 않는다(복잡도 대비 이득 작음 + B 단계의 취소 기능과 함께 설계가 자연스러움).
잠금만 해제돼 새 실행은 가능.

## 테스트 전략

외부 I/O(원티드 API, Ollama)는 비결정적·느림 → 순수 로직과 서버 동작에 집중, 외부는 모킹/스킵.
프레임워크는 Node 내장 `node:test`(새 의존성 0개).

| 대상 | 테스트 |
|------|--------|
| 입력 검증/클램프 | limit 0·음수·문자→50, 101→100, 빈 이력서→거부 |
| 단일 실행 잠금 | 실행 중 두 번째 요청 409 / 끝나면 다시 200 |
| SSE 포맷팅 | `ProgressEvent` → `event: ...\ndata: {...}\n\n` 규격 직렬화 |
| pipeline 진행 콜백 | mock 주입 시 status→scored×N→done 순서 호출 |
| 잠금 해제 보장 | pipeline이 에러 던져도 `running=false` 복구 |

**테스트 안 하는 것:** 실제 원티드 API, 실제 LLM 채점, 프론트 DOM(수동 확인).
**핵심:** 검증·잠금·SSE포맷을 순수 함수로 떼어내 테스트를 쉽게 만든다.
`package.json`에 `"test": "tsx --test src/**/*.test.ts"` 추가.

## 결정 기록 (왜 이렇게 했나)

| 결정 | 골랐다 | 왜 | 포기한 것 |
|------|--------|-----|-----------|
| 진행 표시 | 실시간 진행률(SSE) | 몇 분 걸리는 작업, "멈춘 줄 알고 닫음" 방지. B의 전제 | 제출 후 대기 / 백그라운드 큐 |
| 이력서 입력 | 브라우저 붙여넣기 | 어차피 B에서 각자 이력서 필요 → 지금 만들어두면 이어짐 | 서버 resume.txt 고정 |
| 웹 스택 | Express | 확장성(C·D에서 엔드포인트 증가 대비), 자료 풍부 | 무프레임워크 / 풀 프론트 프레임워크 |
| 프레임워크 | express(>fastify) | 병목이 GPU라 속도 무의미, 자료·성숙도 우선 | fastify |
| 결과 렌더 | 브라우저 라이브 카드 | SSE 결과 그대로 활용, report.html 단계 생략 | report.html 재사용 / 둘 다 |
| 동시성 | 단일 실행 잠금 | GPU 1개 현실, 단순·안전. B에서 대기열로 확장 | 대기열 / 무방비 |
| SSE 전송 | fetch POST + 스트림 | EventSource는 POST 본문 불가(이력서 못 올림) | EventSource(GET) |

## RAID-lite

| 항목 | 내용 |
|------|------|
| **Risk** | 원티드 API 구조 변동 시 수집 0건(기존에도 존재하던 리스크). express SSE에서 compression 미들웨어 쓰면 버퍼링 함정 → compression 미사용으로 회피. |
| **Assumption** | 사용자 PC에서 Ollama가 실행 중이고 모델(gemma4:12b)이 pull됨. 사용자는 로컬 네트워크/로컬호스트에서 접속(원격 노출은 B). |
| **Issue** | 없음(신규 조각). |
| **Dependency** | 신규 런타임 의존성 `express` 1개. 기존 `ollama`, 내장 `http`/`fs`. |
