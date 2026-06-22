import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreAllJobs } from './scorer';
import { WantedJob, ScoredJob } from './types';

function makeJob(id: number): WantedJob {
  return {
    id, position: `pos${id}`, companyName: `co${id}`, location: '서울',
    mainTasks: '', requirements: '', preferredPoints: '',
  };
}

test('scoreAllJobs: 공고마다 onScored를 index 1..N, total N으로 호출', async () => {
  const jobs = [makeJob(1), makeJob(2), makeJob(3)];
  // 가짜 채점기: id를 점수로 사용
  const fakeScore = async (job: WantedJob): Promise<ScoredJob> => ({
    ...job, score: job.id * 10, matchPoints: [], gaps: [], summary: '',
  });
  const calls: Array<{ index: number; total: number; score: number }> = [];
  const result = await scoreAllJobs(jobs, '이력서', (e) => {
    calls.push({ index: e.index, total: e.total, score: e.job.score });
  }, fakeScore);

  assert.deepEqual(calls.map((c) => c.index), [1, 2, 3]);
  assert.ok(calls.every((c) => c.total === 3));
  // 결과는 점수 내림차순 정렬
  assert.deepEqual(result.map((j) => j.score), [30, 20, 10]);
});

test('scoreAllJobs: onScored 없이도 동작(하위호환)', async () => {
  const jobs = [makeJob(1)];
  const fakeScore = async (job: WantedJob): Promise<ScoredJob> => ({
    ...job, score: 50, matchPoints: [], gaps: [], summary: '',
  });
  const result = await scoreAllJobs(jobs, '이력서', undefined, fakeScore);
  assert.equal(result.length, 1);
  assert.equal(result[0].score, 50);
});
