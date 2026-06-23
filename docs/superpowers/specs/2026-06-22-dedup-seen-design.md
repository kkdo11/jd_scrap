# 조각 C — 중복 제거(수동 "확인함") 설계

> 상태: 설계 확정 (2026-06-22)
> 범위: 웹 전용. CLI 동작 불변.
> 선행: 조각 A(웹 GUI + runPipeline) 완료. 후행: 조각 D(자연어 쿼리)는 이 위에 얹음.

## 1. 목표와 동작 모델

매일 같은 이력서로 공고를 돌릴 때 **이미 확인한 공고가 매번 다시 뜨는** 문제를 없앤다.
자동 dedup이 아니라 **사용자가 명시적으로 "확인함" 체크한 공고만** 숨긴다(통제권은 사용자).

- 웹 결과 카드마다 **"확인함" 체크박스**. 체크하면 영속 저장.
- 다음 실행 때, **그 이력서로 체크된 공고 id는 상세 fetch·채점에서 제외** → Ollama 토큰 절약.
- 체크 목록은 **이력서별 네임스페이스**(이력서 텍스트 해시 키). 이력서를 바꾸면 그 이력서의 셋이 적용되고, 되돌아오면 복원된다.
- **"확인함 초기화" 버튼**: 현재 이력서의 체크 셋만 비운다.
- 체크한 카드는 **현재 화면에서는 흐리게만** 표시(즉시 사라지지 않음) → 오체크 시 되돌리기 쉬움. 실제 제외는 다음 실행부터.
- **CLI는 그대로** — seen 스토어를 읽지도 쓰지도 않는다.

### 비목표 (YAGNI)
- 자동 dedup(가져온 것 전부 숨김) — 채택 안 함.
- 부족분 백필(seen 제외로 결과가 limit 미만이어도 더 가져오지 않음).
- 멀티유저 동시성(조각 B에서 다룸).
- CLI에서의 체크/초기화.

## 2. 데이터 모델 / 저장

- 신규 파일 `.data/seen-jobs.json` (`.gitignore`에 `.data/` 추가).
- 구조:
  ```json
  { "<resumeHash>": [353114, 412900] }
  ```
  - 키: `resumeHash = sha256(resume.trim())` (hex 문자열).
  - 값: 해당 이력서로 "확인함" 처리된 Wanted 공고 id(number) 배열.
- 기존 `.cache/job-details.json`(상세 본문 캐시, 토큰 절약용)과 **별개 파일**. 역할이 달라 섞지 않는다.

## 3. 백엔드

### 3.1 신규 모듈 `src/seenStore.ts`
작고 독립적으로 테스트 가능한 단위. JSON 파일 경로를 주입 가능(테스트용).
- `hashResume(text: string): string` — `sha256(text.trim())` hex.
- `getSeen(hash: string): Set<number>` — 없으면 빈 셋.
- `toggleSeen(hash: string, jobId: number, seen: boolean): void` — read-modify-write.
- `resetSeen(hash: string): void` — 해당 네임스페이스 키 삭제.
- 파일 없으면 빈 객체로 시작. 쓰기는 전체 JSON 직렬화(기존 캐시와 동일 패턴).

### 3.2 파이프라인 스레딩
- `runPipeline(resume, limit, onProgress, deps, excludeIds?: Set<number>)` — 선택적 `excludeIds` 추가(기본 빈 셋). CLI는 미전달 → 동작 불변.
- `fetchJobsWithDetails(limit, excludeIds?)` — **기존 over-fetch(1.3x, 병역특례 보정)는 그대로** 두고, 리스트를 받은 뒤 `excludeIds`에 든 id를 **상세 fetch 전에 제외**. 결과가 `limit` 미만이어도 허용(부족하면 부족한 대로).
- `deps.fetchJobs` 시그니처에 `excludeIds` 전달 경로 추가.

### 3.3 엔드포인트 (`src/server.ts`)
- `POST /run` — 기존 동작 + 서버가 `hashResume(body.resume)` 계산 → `getSeen(hash)`를 `excludeIds`로 파이프라인에 주입. **SSE `done` 이벤트 payload에 `resumeHash` 동봉**(프론트가 이후 체크/초기화 호출에 사용).
- `POST /seen` `{ resumeHash, jobId, seen }` → `toggleSeen`. 검증: resumeHash는 hex 문자열, jobId는 양의 정수, seen은 boolean.
- `POST /seen/reset` `{ resumeHash }` → `resetSeen`.

## 4. 프론트 (`public/app.js`, `public/index.html`)

- `done` 이벤트에서 받은 `resumeHash`를 모듈 변수에 보관.
- 각 결과 카드에 "확인함" 체크박스. change 시 `POST /seen` 호출, 체크되면 카드에 흐림 클래스 토글(CSS, 예: `opacity: .5`).
- 결과 영역 상단에 "확인함 초기화" 버튼. 클릭 시 `POST /seen/reset` 호출 후 현재 화면 카드들의 흐림/체크 해제(시각적 리셋만; 재수집은 다음 실행).

## 5. 엣지 / 동시성 / 테스트

- 동시성: 기존 **단일 실행 잠금**이 `/run`을 직렬화. `/seen`·`/seen/reset`은 짧은 read-modify-write이며 단일 사용자 가정. 멀티유저 안전성은 조각 B 범위.
- `resume`이 비거나 무효면 기존 `isValidResume` 검증이 `/run`에서 먼저 막음 → resumeHash 계산 도달 안 함.
- `.data/` 디렉토리는 첫 쓰기 시 생성.
- 테스트:
  - `src/seenStore.test.ts` — 토글, 이력서별 네임스페이스 격리, 초기화, 파일 라운드트립(임시 경로 주입).
  - `src/server.test.ts` 보강 — `/seen`·`/seen/reset` 엔드포인트, `done` 이벤트의 `resumeHash` 포함.
  - `src/pipeline.test.ts` 보강 — `excludeIds`가 fetch 대상에서 제외되는지(주입 deps로 확인).

## 6. RAID-lite

| 항목 | 내용 |
|---|---|
| Risk | over-fetch로도 seen 누적 시 새 공고가 `limit` 미만 → 의도된 자연 축소, 허용. |
| Assumption | 단일 사용자·로컬 단일 GPU. 웹에서만 체크. |
| Issue | 없음(현재). |
| Dependency | 기존 단일 실행 잠금, SSE `done` 이벤트(payload 확장), `.gitignore`. |

## 7. 결정 로그 (왜 이렇게)

- **자동 dedup 대신 수동 체크**: 사용자가 행동 안 한 공고를 잃지 않게. 통제권 우선. (원래 C 메모는 자동이었으나 사용자 요구로 전환 — ADR 0001.)
- **이력서별 네임스페이스(전역 셋 대신)**: 이력서를 바꾸면 매칭 기준이 달라져 재평가가 자연스럽고, 여러 이력서를 번갈아 쓸 때 각자의 확인 상태를 보존. (ADR 0001.)
- **seen 스토어를 기존 detail 캐시와 분리**: 수명·의미가 다름(영구 사용자 데이터 vs 토큰 절약용 임시 캐시).
