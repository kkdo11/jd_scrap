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

function wjob(id: number): WantedJob {
  return { id, position: `p${id}`, companyName: `c${id}`, location: '', mainTasks: '', requirements: '', preferredPoints: '' };
}
const fakeScore = async (job: WantedJob): Promise<ScoredJob> => ({ ...job, score: 50, matchPoints: [], gaps: [], summary: '' });

test('scoreAllJobs: 이미 abort된 signal이면 채점 0회', async () => {
  const ac = new AbortController();
  ac.abort();
  let calls = 0;
  const counting = async (j: WantedJob) => { calls++; return fakeScore(j); };
  const out = await scoreAllJobs([wjob(1), wjob(2)], '이력서', undefined, counting, ac.signal);
  assert.equal(calls, 0);
  assert.equal(out.length, 0);
});

test('scoreAllJobs: 중간 abort 시 처리된 것만 반환', async () => {
  const ac = new AbortController();
  let calls = 0;
  const abortingAfterFirst = async (j: WantedJob): Promise<ScoredJob> => {
    calls++;
    if (calls === 1) ac.abort(); // 첫 공고 처리 중 중단 신호
    return fakeScore(j);
  };
  const out = await scoreAllJobs([wjob(1), wjob(2), wjob(3)], '이력서', undefined, abortingAfterFirst, ac.signal);
  assert.equal(calls, 1);       // 2번째 배치 진입 전 break
  assert.equal(out.length, 1);
});
