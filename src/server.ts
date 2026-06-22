import express from 'express';
import * as path from 'path';
import { runPipeline } from './pipeline';
import { clampLimit, isValidResume } from './validation';
import { formatSSE } from './sse';
import { ProgressEvent } from './types';

export interface ServerDeps {
  runPipeline: typeof runPipeline;
}

const defaultDeps: ServerDeps = { runPipeline };

export function createApp(deps: ServerDeps = defaultDeps): express.Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(path.join(process.cwd(), 'public')));

  // GPU 1개 → 동시에 하나만 실행. createApp 클로저 스코프 잠금 (프로덕션은 단일 인스턴스).
  let running = false;

  app.post('/run', async (req, res) => {
    const body = req.body ?? {};
    if (!isValidResume(body.resume)) {
      res.status(400).json({ error: '이력서를 입력하세요.' });
      return;
    }
    if (running) {
      res.status(409).json({ error: '이미 실행 중입니다.' });
      return;
    }

    running = true;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (e: ProgressEvent) => res.write(formatSSE(e));

    try {
      await deps.runPipeline(body.resume, clampLimit(body.limit), send);
    } catch {
      // error 이벤트는 runPipeline이 이미 send 했으므로 여기선 스트림만 닫는다.
    } finally {
      running = false;
      res.end();
    }
  });

  return app;
}
