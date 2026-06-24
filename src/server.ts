import express from 'express';
import * as path from 'path';
import { runPipeline } from './pipeline';
import { parseQuery } from './queryParser';
import { clampLimit, isValidResume, isValidSearch, sanitizeTagIds } from './validation';
import { tagOptions } from './jobTags';
import { formatSSE } from './sse';
import { ProgressEvent, SearchSpec } from './types';
import { hashResume, getSeen, toggleSeen, resetSeen } from './seenStore';

export interface ServerDeps {
  runPipeline: typeof runPipeline;
  parseQuery: typeof parseQuery;
}

const defaultDeps: ServerDeps = { runPipeline, parseQuery };

export function createApp(deps: ServerDeps = defaultDeps): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(process.cwd(), 'public')));

  // GPU 1개 → 동시에 하나만 실행. createApp 클로저 스코프 잠금 (프로덕션은 단일 인스턴스).
  let running = false;

  app.get('/tags', (_req, res) => {
    res.json({ tags: tagOptions() });
  });

  app.post('/run', async (req, res) => {
    const body = req.body ?? {};
    if (!isValidResume(body.resume)) {
      res.status(400).json({ error: '이력서를 입력하세요.' });
      return;
    }
    const tagIds = sanitizeTagIds(body.tagIds);
    if (!isValidSearch(body.queryText, tagIds)) {
      res.status(400).json({ error: '검색어를 입력하거나 직군을 선택하세요.' });
      return;
    }
    if (running) {
      res.status(409).json({ error: '이미 실행 중입니다.' });
      return;
    }

    running = true;
    const ac = new AbortController();
    let finished = false;
    // 클라이언트가 스트림을 끊으면(정상 완료 아님) 진행 중 작업을 중단해 잠금을 즉시 해제.
    // ⚠️ req('close')는 express.json()이 본문을 다 읽는 즉시 발생(요청 readable 종료)하므로
    //    파이프라인 시작 전에 abort가 터진다. 클라이언트 연결 종료는 res('close')로 감지해야 한다.
    res.on('close', () => { if (!finished) ac.abort(); });
    try {
      // 자유텍스트가 있으면 LLM 파싱, 칩 태그와 병합. 칩만 있으면 LLM 생략.
      let search: SearchSpec = { tagIds, keywords: [] };
      if (typeof body.queryText === 'string' && body.queryText.trim()) {
        const parsed = await deps.parseQuery(body.queryText);
        search = {
          tagIds: [...new Set([...tagIds, ...parsed.tagIds])],
          keywords: parsed.keywords,
        };
      }
      // 상황 B: 텍스트는 있었으나 직군을 못 뽑고 칩도 없어 태그 0개 → 차단·안내(헤더 전송 전).
      if (search.tagIds.length === 0) {
        res.status(400).json({ error: '직군을 인식하지 못했어요. 직군 칩을 선택하거나 직군명을 포함해 다시 입력하세요.' });
        return;
      }
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
      await deps.runPipeline(body.resume, clampLimit(body.limit), send, undefined, excludeIds, search, ac.signal);
    } catch {
      // 스트림 시작 전(헤더 미전송) 예외면 빈 200 대신 500을 내려 프론트 멈춤을 막는다.
      // 스트림 시작 후 예외는 runPipeline이 이미 error 이벤트를 send 했으므로 스트림만 닫는다.
      if (!res.headersSent) res.status(500).json({ error: '실행 준비 실패' });
    } finally {
      finished = true;
      running = false;
      if (!res.writableEnded) res.end();
    }
  });

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

  return app;
}
