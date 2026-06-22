# 조각 C — 중복 제거(수동 "확인함") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 웹에서 사용자가 결과 카드를 "확인함" 체크하면, 그 이력서로 체크된 공고를 다음 실행의 수집·채점에서 제외한다.

**Architecture:** 이력서 텍스트 해시별 네임스페이스로 "확인함" 공고 id를 `.data/seen-jobs.json`에 영속화하는 `seenStore` 모듈을 새로 두고, `/run` 시 서버가 해당 이력서의 seen 셋을 `excludeIds`로 파이프라인에 주입한다. 마킹/초기화는 신규 `/seen`·`/seen/reset` 엔드포인트로 처리하고, CLI 경로는 `excludeIds`를 전달하지 않아 동작이 불변이다.

**Tech Stack:** TypeScript, tsx, `node:test`, Express, 바닐라 JS 프론트, Node `crypto`/`fs`.

## Global Constraints

- 테스트 러너: `npm test` → `tsx --test "src/**/*.test.ts"`. 단일 테스트는 `npx tsx --test src/<file>.test.ts`.
- 커밋 prefix는 영어 conventional commits(`feat:`,`fix:`,`test:`,`refactor:`), 메시지 본문은 한국어 허용.
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` 추가.
- 저장 경로 키: `resumeHash = sha256(resume.trim())` hex(소문자 64자).
- seen 스토어는 `.data/seen-jobs.json`, 기존 `.cache/job-details.json`과 별개 파일.
- CLI 경로(`runPipeline`를 `excludeIds` 없이 호출)는 동작 불변이어야 한다.
- 부족분 백필 금지: `excludeIds` 제외로 결과가 `limit` 미만이어도 그대로 둔다.

---

## File Structure

- `src/seenStore.ts` (신규) — 해시 계산 + seen 셋 영속화. 단일 책임: seen 데이터 I/O.
- `src/seenStore.test.ts` (신규) — seenStore 유닛 테스트.
- `.gitignore` (수정) — `.data/` 추가.
- `src/pipeline.ts` (수정) — `runPipeline`에 `excludeIds` 파라미터, `PipelineDeps.fetchJobs` 시그니처 확장.
- `src/wanted.ts` (수정) — `fetchJobsWithDetails(limit, excludeIds)`가 상세 fetch 전에 제외.
- `src/pipeline.test.ts` (수정) — excludeIds 스레딩 테스트 추가.
- `src/types.ts` (수정) — `done` 이벤트에 `resumeHash?` 추가.
- `src/server.ts` (수정) — `/run`에서 excludeIds 주입 + done에 resumeHash 동봉, `/seen`·`/seen/reset` 추가.
- `src/server.test.ts` (수정) — 신규 엔드포인트/주입 테스트.
- `public/index.html`, `public/app.js`, `public/style.css` (수정) — 체크박스·초기화 버튼·흐림 처리.

---

## Task 1: seenStore 모듈 + .gitignore

**Files:**
- Create: `src/seenStore.ts`
- Test: `src/seenStore.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces:
  - `hashResume(resume: string): string` — `sha256(resume.trim())` hex.
  - `getSeen(hash: string, storePath?: string): Set<number>`
  - `toggleSeen(hash: string, jobId: number, seen: boolean, storePath?: string): void`
  - `resetSeen(hash: string, storePath?: string): void`
  - 기본 저장 경로: `process.env.SEEN_STORE_PATH ?? <cwd>/.data/seen-jobs.json`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/seenStore.test.ts`

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hashResume, getSeen, toggleSeen, resetSeen } from './seenStore';

function tmpPath(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'seen-')), 'seen-jobs.json');
}

test('hashResume: trim 후 동일 입력은 동일 해시, hex 64자', () => {
  const a = hashResume('  이력서 내용  ');
  const b = hashResume('이력서 내용');
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test('toggleSeen/getSeen: 추가와 제거', () => {
  const p = tmpPath();
  const h = hashResume('r1');
  assert.deepEqual([...getSeen(h, p)], []);
  toggleSeen(h, 100, true, p);
  toggleSeen(h, 200, true, p);
  assert.deepEqual([...getSeen(h, p)].sort((a, b) => a - b), [100, 200]);
  toggleSeen(h, 100, false, p);
  assert.deepEqual([...getSeen(h, p)], [200]);
});

test('네임스페이스 격리: 이력서별로 독립', () => {
  const p = tmpPath();
  const h1 = hashResume('r1');
  const h2 = hashResume('r2');
  toggleSeen(h1, 1, true, p);
  assert.deepEqual([...getSeen(h2, p)], []);
  assert.deepEqual([...getSeen(h1, p)], [1]);
});

test('resetSeen: 해당 네임스페이스만 비움', () => {
  const p = tmpPath();
  const h1 = hashResume('r1');
  const h2 = hashResume('r2');
  toggleSeen(h1, 1, true, p);
  toggleSeen(h2, 2, true, p);
  resetSeen(h1, p);
  assert.deepEqual([...getSeen(h1, p)], []);
  assert.deepEqual([...getSeen(h2, p)], [2]);
});

test('영속: 새 호출에서 디스크에서 다시 읽음', () => {
  const p = tmpPath();
  const h = hashResume('r1');
  toggleSeen(h, 42, true, p);
  assert.deepEqual([...getSeen(h, p)], [42]); // load는 매 호출 fs 읽기
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx tsx --test src/seenStore.test.ts`
Expected: FAIL — `Cannot find module './seenStore'`

- [ ] **Step 3: 최소 구현** — `src/seenStore.ts`

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

type Store = Record<string, number[]>;

export function hashResume(resume: string): string {
  return createHash('sha256').update(resume.trim()).digest('hex');
}

function defaultPath(): string {
  return process.env.SEEN_STORE_PATH ?? path.join(process.cwd(), '.data', 'seen-jobs.json');
}

function load(p: string): Store {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function save(p: string, store: Store): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store), 'utf-8');
}

export function getSeen(hash: string, storePath: string = defaultPath()): Set<number> {
  return new Set(load(storePath)[hash] ?? []);
}

export function toggleSeen(
  hash: string,
  jobId: number,
  seen: boolean,
  storePath: string = defaultPath(),
): void {
  const store = load(storePath);
  const set = new Set(store[hash] ?? []);
  if (seen) set.add(jobId);
  else set.delete(jobId);
  if (set.size > 0) store[hash] = [...set];
  else delete store[hash];
  save(storePath, store);
}

export function resetSeen(hash: string, storePath: string = defaultPath()): void {
  const store = load(storePath);
  delete store[hash];
  save(storePath, store);
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx tsx --test src/seenStore.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: .gitignore에 `.data/` 추가**

`.gitignore`의 `# 생성물` 블록을 다음으로 수정:

```gitignore
# 생성물
report.html
.cache/
.data/
```

- [ ] **Step 6: 커밋**

```bash
git add src/seenStore.ts src/seenStore.test.ts .gitignore
git commit -m "$(cat <<'EOF'
feat: 이력서별 seen 공고 영속 스토어(seenStore) 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: pipeline·wanted에 excludeIds 스레딩

**Files:**
- Modify: `src/pipeline.ts`
- Modify: `src/wanted.ts:115-166` (`fetchJobsWithDetails`)
- Test: `src/pipeline.test.ts`

**Interfaces:**
- Consumes: (없음 — Task 1과 독립)
- Produces:
  - `runPipeline(resume, limit, onProgress, deps?, excludeIds?: Set<number>)` — `excludeIds` 기본 빈 셋.
  - `PipelineDeps.fetchJobs: (limit: number, excludeIds: Set<number>) => Promise<WantedJob[]>`
  - `fetchJobsWithDetails(limit?: number, excludeIds?: Set<number>): Promise<WantedJob[]>`

- [ ] **Step 1: 실패하는 테스트 작성** — `src/pipeline.test.ts` 끝에 추가

```typescript
test('runPipeline: excludeIds를 fetchJobs로 그대로 전달', async () => {
  let received: Set<number> | undefined;
  const fakeDeps: PipelineDeps = {
    fetchJobs: async (_limit, excludeIds) => {
      received = excludeIds;
      return [];
    },
    scoreJobs: async () => [],
  };
  await runPipeline('이력서', 10, () => {}, fakeDeps, new Set([7, 8]));
  assert.deepEqual([...(received ?? new Set())].sort((a, b) => a - b), [7, 8]);
});

test('runPipeline: excludeIds 미전달 시 빈 셋', async () => {
  let received: Set<number> | undefined;
  const fakeDeps: PipelineDeps = {
    fetchJobs: async (_limit, excludeIds) => {
      received = excludeIds;
      return [];
    },
    scoreJobs: async () => [],
  };
  await runPipeline('이력서', 10, () => {}, fakeDeps);
  assert.equal(received?.size, 0);
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx tsx --test src/pipeline.test.ts`
Expected: FAIL — `fetchJobs`는 두 번째 인자를 받지 않아 `received`가 `undefined`(또는 타입 에러)

- [ ] **Step 3: pipeline.ts 수정**

`PipelineDeps.fetchJobs` 시그니처와 `runPipeline`를 수정:

```typescript
export interface PipelineDeps {
  fetchJobs: (limit: number, excludeIds: Set<number>) => Promise<WantedJob[]>;
  scoreJobs: (
    jobs: WantedJob[],
    resume: string,
    onScored?: (e: { index: number; total: number; job: ScoredJob }) => void,
  ) => Promise<ScoredJob[]>;
}
```

`runPipeline` 본문:

```typescript
export async function runPipeline(
  resume: string,
  limit: number,
  onProgress: (e: ProgressEvent) => void,
  deps: PipelineDeps = defaultDeps,
  excludeIds: Set<number> = new Set(),
): Promise<ScoredJob[]> {
  try {
    onProgress({ type: 'status', message: '공고 수집 중...' });
    const jobs = await deps.fetchJobs(limit, excludeIds);

    onProgress({ type: 'status', message: `${jobs.length}개 공고 채점 시작` });
    const result = await deps.scoreJobs(jobs, resume, (e) =>
      onProgress({ type: 'scored', index: e.index, total: e.total, job: e.job }),
    );

    onProgress({ type: 'done', count: result.length });
    return result;
  } catch (err: any) {
    onProgress({ type: 'error', message: String(err?.message ?? err) });
    throw err;
  }
}
```

- [ ] **Step 4: wanted.ts 수정** — `fetchJobsWithDetails` 시그니처와 제외 필터 추가

`src/wanted.ts:115`의 함수 선언을 수정:

```typescript
export async function fetchJobsWithDetails(
  limit: number = 40,
  excludeIds: Set<number> = new Set(),
): Promise<WantedJob[]> {
```

그리고 `src/wanted.ts:122`의 제목 필터 라인 바로 다음에 excludeIds 제외를 추가. 기존:

```typescript
  // 제목 기준 1차 필터 (상세 조회 전)
  const titleFiltered = jobs.filter((j) => !EXCLUDE_KEYWORDS.some((kw) => j.position.includes(kw)));
```

다음으로 교체:

```typescript
  // 제목 기준 1차 필터 (상세 조회 전)
  const titleFiltered = jobs
    .filter((j) => !EXCLUDE_KEYWORDS.some((kw) => j.position.includes(kw)))
    // 사용자가 '확인함' 체크한 공고는 상세 fetch·채점 전에 제외 (토큰 절약). 부족분 백필 안 함.
    .filter((j) => !excludeIds.has(j.id));
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx tsx --test src/pipeline.test.ts`
Expected: PASS (기존 2 + 신규 2 = 4 tests)

- [ ] **Step 6: 전체 테스트 회귀 확인**

Run: `npm test`
Expected: 전체 PASS (기존 테스트 깨짐 없음)

- [ ] **Step 7: 커밋**

```bash
git add src/pipeline.ts src/wanted.ts src/pipeline.test.ts
git commit -m "$(cat <<'EOF'
feat: 수집 파이프라인에 excludeIds 스레딩(확인 공고 제외)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 서버 — excludeIds 주입 + done.resumeHash + /seen 엔드포인트

**Files:**
- Modify: `src/types.ts:21` (`done` 변형)
- Modify: `src/server.ts`
- Test: `src/server.test.ts`

**Interfaces:**
- Consumes:
  - `hashResume`, `getSeen`, `toggleSeen`, `resetSeen` (Task 1)
  - `runPipeline(resume, limit, onProgress, deps?, excludeIds?)` (Task 2)
- Produces:
  - `done` 이벤트: `{ type: 'done'; count: number; resumeHash?: string }`
  - `POST /seen` `{ resumeHash, jobId, seen }` → `{ ok: true }` / 400 / 500
  - `POST /seen/reset` `{ resumeHash }` → `{ ok: true }` / 400 / 500

- [ ] **Step 1: types.ts 수정** — `done`에 `resumeHash?` 추가

`src/types.ts`의 `ProgressEvent`를 수정:

```typescript
export type ProgressEvent =
  | { type: 'status'; message: string }
  | { type: 'scored'; index: number; total: number; job: ScoredJob }
  | { type: 'done'; count: number; resumeHash?: string }
  | { type: 'error'; message: string };
```

- [ ] **Step 2a: 실패하는 테스트 작성 — import 추가** — `src/server.test.ts` 상단 import 블록(기존 `import { createApp, ServerDeps } from './server';` 다음)에 추가

```typescript
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hashResume, getSeen, toggleSeen } from './seenStore';
```

- [ ] **Step 2b: 실패하는 테스트 작성 — 테스트 본문** — `src/server.test.ts` 끝에 추가

```typescript
function withTempStore(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'srv-seen-')), 'seen.json');
  process.env.SEEN_STORE_PATH = p;
  return p;
}

test('POST /run: done 이벤트에 resumeHash 포함', async () => {
  withTempStore();
  const fakeRun = (async (_r: string, _l: number, onProgress: any) => {
    onProgress({ type: 'done', count: 0 });
    return [];
  }) as any;
  const { url, close } = await listen({ runPipeline: fakeRun });
  try {
    const res = await fetch(`${url}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: '내 이력서', limit: 5 }),
    });
    const text = await res.text();
    const doneLine = text.split('\n').find((l) => l.includes('"type":"done"'))!;
    const evt = JSON.parse(doneLine.slice('data: '.length));
    assert.equal(evt.resumeHash, hashResume('내 이력서'));
  } finally {
    await close();
  }
});

test('POST /run: 저장된 seen 셋을 excludeIds로 주입', async () => {
  withTempStore();
  toggleSeen(hashResume('내 이력서'), 999, true);
  let received: Set<number> | undefined;
  const fakeRun = (async (_r: string, _l: number, onProgress: any, _d: any, excludeIds: Set<number>) => {
    received = excludeIds;
    onProgress({ type: 'done', count: 0 });
    return [];
  }) as any;
  const { url, close } = await listen({ runPipeline: fakeRun });
  try {
    const res = await fetch(`${url}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: '내 이력서', limit: 5 }),
    });
    await res.text();
    assert.deepEqual([...(received ?? new Set())], [999]);
  } finally {
    await close();
  }
});

test('POST /seen: 토글이 스토어에 반영', async () => {
  const p = withTempStore();
  const h = hashResume('내 이력서');
  const { url, close } = await listen({ runPipeline: (async () => []) as any });
  try {
    const res = await fetch(`${url}/seen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeHash: h, jobId: 555, seen: true }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual([...getSeen(h, p)], [555]);
  } finally {
    await close();
  }
});

test('POST /seen: 잘못된 입력 400', async () => {
  withTempStore();
  const { url, close } = await listen({ runPipeline: (async () => []) as any });
  try {
    const res = await fetch(`${url}/seen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeHash: 'nothex', jobId: -1, seen: 'yes' }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('POST /seen/reset: 네임스페이스 비움', async () => {
  const p = withTempStore();
  const h = hashResume('내 이력서');
  toggleSeen(h, 1, true, p);
  const { url, close } = await listen({ runPipeline: (async () => []) as any });
  try {
    const res = await fetch(`${url}/seen/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeHash: h }),
    });
    assert.equal(res.status, 200);
    assert.deepEqual([...getSeen(h, p)], []);
  } finally {
    await close();
  }
});
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `npx tsx --test src/server.test.ts`
Expected: FAIL — `resumeHash` undefined / `/seen` 404 / excludeIds undefined

- [ ] **Step 4: server.ts 구현**

import 블록에 추가:

```typescript
import { hashResume, getSeen, toggleSeen, resetSeen } from './seenStore';
```

`/run` 핸들러에서 잠금 획득(`running = true`) 이후, `send` 정의를 다음으로 교체하고 `runPipeline` 호출에 excludeIds를 넘긴다:

```typescript
    running = true;
    const resumeHash = hashResume(body.resume);
    const excludeIds = getSeen(resumeHash);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    // done 이벤트에 resumeHash를 실어 프론트가 이후 /seen 호출에 사용하게 한다.
    const send = (e: ProgressEvent) =>
      res.write(formatSSE(e.type === 'done' ? { ...e, resumeHash } : e));

    try {
      await deps.runPipeline(body.resume, clampLimit(body.limit), send, undefined, excludeIds);
    } catch {
      // error 이벤트는 runPipeline이 이미 send 했으므로 여기선 스트림만 닫는다.
    } finally {
      running = false;
      res.end();
    }
```

`return app;` 직전에 두 엔드포인트를 추가:

```typescript
  const HEX64 = /^[a-f0-9]{64}$/;

  app.post('/seen', (req, res) => {
    const { resumeHash, jobId, seen } = req.body ?? {};
    if (
      typeof resumeHash !== 'string' || !HEX64.test(resumeHash) ||
      !Number.isInteger(jobId) || jobId <= 0 ||
      typeof seen !== 'boolean'
    ) {
      res.status(400).json({ error: '잘못된 요청' });
      return;
    }
    try {
      toggleSeen(resumeHash, jobId, seen);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: '저장 실패' });
    }
  });

  app.post('/seen/reset', (req, res) => {
    const { resumeHash } = req.body ?? {};
    if (typeof resumeHash !== 'string' || !HEX64.test(resumeHash)) {
      res.status(400).json({ error: '잘못된 요청' });
      return;
    }
    try {
      resetSeen(resumeHash);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: '저장 실패' });
    }
  });
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `npx tsx --test src/server.test.ts`
Expected: PASS (기존 2 + 신규 5 = 7 tests)

- [ ] **Step 6: 전체 테스트 회귀 확인**

Run: `npm test`
Expected: 전체 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/types.ts src/server.ts src/server.test.ts
git commit -m "$(cat <<'EOF'
feat: /run에 seen 제외 주입 + /seen·/seen/reset 엔드포인트

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: 프론트 — 확인함 체크박스·초기화 버튼·흐림 처리

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`
- Modify: `public/style.css`

**Interfaces:**
- Consumes: `done` 이벤트의 `resumeHash`, `POST /seen`, `POST /seen/reset` (Task 3)

> 프론트는 자동 테스트 하니스가 없어 TDD 대신 실제 구동으로 검증한다.

- [ ] **Step 1: index.html — 결과 위 초기화 바 추가**

`<section id="results" class="results"></section>` 바로 앞에 추가:

```html
    <div id="resultsBar" class="results-bar" hidden>
      <button id="resetSeenBtn" class="reset-btn" type="button">확인함 초기화</button>
    </div>
```

- [ ] **Step 2: app.js — resumeHash 보관 변수 추가**

파일 상단 `const $ = ...` 다음 줄에 추가:

```javascript
let resumeHash = null;
```

- [ ] **Step 3: app.js — addCard에 체크박스 추가**

`addCard`의 `el.dataset.score = job.score;` 다음에 추가:

```javascript
  el.dataset.id = job.id;
```

`card-foot` div를 다음으로 교체:

```javascript
    <div class="card-foot"><span class="score-pill">${job.score}점</span>
      <div class="card-tags">${tags}${gaps}</div>
      <label class="seen-toggle"><input type="checkbox" class="seen-box" /> 확인함</label>
    </div>`;
```

그리고 `$('results').appendChild(el);` 바로 앞에 리스너 연결을 추가:

```javascript
  el.querySelector('.seen-box').addEventListener('change', (ev) =>
    onSeenToggle(job.id, el, ev.target.checked));
```

- [ ] **Step 4: app.js — 토글/초기화 핸들러 추가**

`function setRunning(...) { ... }` 아래에 추가:

```javascript
async function onSeenToggle(jobId, cardEl, checked) {
  cardEl.classList.toggle('seen', checked);
  if (!resumeHash) return;
  try {
    await fetch('/seen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeHash, jobId, seen: checked }),
    });
  } catch (err) {
    showError('확인함 저장 실패: ' + String(err?.message ?? err));
  }
}

async function resetSeen() {
  if (!resumeHash) return;
  try {
    await fetch('/seen/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeHash }),
    });
    document.querySelectorAll('.card.seen').forEach((c) => c.classList.remove('seen'));
    document.querySelectorAll('.seen-box').forEach((b) => (b.checked = false));
  } catch (err) {
    showError('초기화 실패: ' + String(err?.message ?? err));
  }
}
```

- [ ] **Step 5: app.js — done 처리에서 resumeHash 보관 + 바 노출**

`handleChunk`의 `done` 분기를 다음으로 교체:

```javascript
  else if (e.type === 'done') { resumeHash = e.resumeHash ?? null; sortCards(); setStatus(`완료 — ${e.count}개 공고`); setProgress(1, 1); $('resultsBar').hidden = false; }
```

- [ ] **Step 6: app.js — run 시작 시 바 숨김 + 버튼 리스너**

`run()` 내부의 `$('results').innerHTML = '';` 다음에 추가:

```javascript
  $('resultsBar').hidden = true;
```

파일 끝 `$('runBtn').addEventListener('click', run);` 다음에 추가:

```javascript
$('resetSeenBtn').addEventListener('click', resetSeen);
```

- [ ] **Step 7: style.css — 클래스 추가**

`public/style.css` 끝에 추가:

```css
.card.seen { opacity: .45; }
.seen-toggle { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; font-size: 13px; color: #6b7280; cursor: pointer; }
.results-bar { display: flex; justify-content: flex-end; margin: 0 0 12px; }
.reset-btn { padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; color: #374151; font-size: 13px; cursor: pointer; }
.reset-btn:hover { background: #f9fafb; }
```

- [ ] **Step 8: 수동 구동 검증**

```bash
npm run web
```

브라우저에서 `http://localhost:3000`(서버 포트) 접속 후 확인:
1. 이력서 붙여넣고 분석 → 결과 카드에 "확인함" 체크박스가 보인다.
2. 임의 카드 체크 → 카드가 흐려진다(opacity 낮아짐). 네트워크 탭에 `POST /seen` 200.
3. 같은 이력서로 다시 분석 → 체크한 공고가 결과에 안 나온다.
4. "확인함 초기화" 클릭 → `POST /seen/reset` 200, 다시 분석하면 그 공고가 돌아온다.
5. 이력서 텍스트를 바꿔 분석 → 이전 체크의 영향 없음(새 네임스페이스).

검증 후 종료(`Ctrl+C`).

- [ ] **Step 9: 커밋**

```bash
git add public/index.html public/app.js public/style.css
git commit -m "$(cat <<'EOF'
feat: 웹 결과에 확인함 체크박스·초기화 버튼·흐림 처리 추가

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## 완료 기준

- `npm test` 전체 통과(seenStore 5 + pipeline 4 + server 7 + 기존 sse/scorer/validation).
- 웹에서 확인함 체크 → 다음 실행 제외 → 초기화 복원 → 이력서별 격리가 Step 8 수동 검증으로 확인됨.
- CLI(`npm start`)는 `excludeIds` 없이 동작 — 기존과 동일.
- `.data/`가 git에 추적되지 않음.
