import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatSSE } from './sse';

test('formatSSE: event 이름과 data JSON을 SSE 규격으로 직렬화', () => {
  const out = formatSSE({ type: 'status', message: '수집 중' });
  assert.equal(out, 'event: status\ndata: {"type":"status","message":"수집 중"}\n\n');
});

test('formatSSE: scored 이벤트도 전체 객체를 data로 직렬화', () => {
  const job = {
    id: 1, position: 'BE', companyName: 'A', location: '서울',
    mainTasks: '', requirements: '', preferredPoints: '',
    score: 80, matchPoints: [], gaps: [], summary: 's',
  };
  const out = formatSSE({ type: 'scored', index: 1, total: 3, job });
  assert.ok(out.startsWith('event: scored\ndata: {'));
  assert.ok(out.endsWith('}\n\n'));
});
