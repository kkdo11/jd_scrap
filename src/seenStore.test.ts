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
