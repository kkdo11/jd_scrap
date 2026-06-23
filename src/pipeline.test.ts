import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, PipelineDeps } from './pipeline';
import { ProgressEvent, WantedJob, ScoredJob } from './types';
import { DEFAULT_SEARCH } from './jobTags';
import { SearchSpec } from './types';

function scored(id: number, score: number): ScoredJob {
  return {
    id, position: `p${id}`, companyName: `c${id}`, location: '서울',
    mainTasks: '', requirements: '', preferredPoints: '',
    score, matchPoints: [], gaps: [], summary: '',
  };
}

test('runPipeline: status→status→scored×N→done 순서로 emit', async () => {
  const fakeDeps: PipelineDeps = {
    fetchJobs: async () => [
      { id: 1 } as WantedJob, { id: 2 } as WantedJob,
    ],
    scoreJobs: async (jobs, _resume, onScored) => {
      const out = [scored(1, 70), scored(2, 90)];
      out.forEach((j, i) => onScored?.({ index: i + 1, total: out.length, job: j }));
      return out;
    },
  };
  const events: ProgressEvent[] = [];
  const result = await runPipeline('이력서', 50, (e) => events.push(e), fakeDeps);

  assert.deepEqual(events.map((e) => e.type), ['status', 'status', 'scored', 'scored', 'done']);
  assert.equal((events[4] as any).count, 2);
  assert.equal(result.length, 2);
});

test('runPipeline: 수집 실패 시 error emit 후 throw', async () => {
  const fakeDeps: PipelineDeps = {
    fetchJobs: async () => { throw new Error('API 다운'); },
    scoreJobs: async () => [],
  };
  const events: ProgressEvent[] = [];
  await assert.rejects(
    () => runPipeline('이력서', 50, (e) => events.push(e), fakeDeps),
    /API 다운/
  );
  const last = events.at(-1)!;
  assert.equal(last.type, 'error');
  assert.match((last as any).message, /API 다운/);
});

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

test('runPipeline: searchSpec을 fetchJobs로 전달', async () => {
  let received: SearchSpec | undefined;
  const fakeDeps: PipelineDeps = {
    fetchJobs: async (_l, _e, search) => { received = search; return []; },
    scoreJobs: async () => [],
  };
  const spec: SearchSpec = { tagIds: [872], keywords: ['자바'] };
  await runPipeline('이력서', 10, () => {}, fakeDeps, new Set(), spec);
  assert.deepEqual(received, spec);
});

test('runPipeline: searchSpec 미전달 시 DEFAULT_SEARCH', async () => {
  let received: SearchSpec | undefined;
  const fakeDeps: PipelineDeps = {
    fetchJobs: async (_l, _e, search) => { received = search; return []; },
    scoreJobs: async () => [],
  };
  await runPipeline('이력서', 10, () => {}, fakeDeps);
  assert.deepEqual(received, DEFAULT_SEARCH);
});
