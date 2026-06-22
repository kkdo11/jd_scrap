import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp, ServerDeps } from './server';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hashResume, getSeen, toggleSeen } from './seenStore';

// 테스트용: 서버를 임시 포트로 띄우고 base URL 반환
async function listen(deps: ServerDeps): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createApp(deps).listen(0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://localhost:${port}`,
    close: () => new Promise((r) => server.close(() => r(undefined))),
  };
}

test('POST /run: 이력서 없으면 400', async () => {
  const { url, close } = await listen({ runPipeline: (async () => []) as any });
  try {
    const res = await fetch(`${url}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 10 }),
    });
    assert.equal(res.status, 400);
  } finally {
    await close();
  }
});

test('POST /run: 실행 중이면 두 번째 요청 409, 끝나면 다시 200', async () => {
  let releaseGate!: () => void;
  const gate = new Promise<void>((r) => { releaseGate = r; });
  const fakeRun = (async (_resume: string, _limit: number, onProgress: any) => {
    onProgress({ type: 'status', message: 'start' });
    await gate;             // 잠금을 잡은 채 대기
    onProgress({ type: 'done', count: 0 });
    return [];
  }) as any;

  const { url, close } = await listen({ runPipeline: fakeRun });
  try {
    // 요청1: 시작(헤더 수신되면 fetch resolve, 본문 스트림은 열린 채 유지)
    const req1 = await fetch(`${url}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: '이력서', limit: 5 }),
    });
    assert.equal(req1.status, 200);

    // 요청2: 잠금 중이라 409
    const req2 = await fetch(`${url}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: '이력서', limit: 5 }),
    });
    assert.equal(req2.status, 409);

    // 잠금 해제 후 요청1 스트림 드레인
    releaseGate();
    await req1.text();

    // 이제 다시 200
    const req3 = await fetch(`${url}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: '이력서', limit: 5 }),
    });
    assert.equal(req3.status, 200);
    await req3.text();
  } finally {
    await close();
  }
});

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
