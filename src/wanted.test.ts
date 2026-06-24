import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobListUrl, matchesKeywords, fetchJobsWithDetails } from './wanted';
import { WantedJob } from './types';
import { DEFAULT_SEARCH } from './jobTags';

function job(partial: Partial<WantedJob>): WantedJob {
  return { id: 1, position: '', companyName: '', location: '', mainTasks: '', requirements: '', preferredPoints: '', ...partial };
}

test('buildJobListUrl: tagIds를 대괄호 없는 tag_type_ids로 반복 전달', () => {
  const url = buildJobListUrl(40, { tagIds: [872, 655], keywords: [] });
  const qs = new URL(url).searchParams.getAll('tag_type_ids');
  assert.deepEqual(qs, ['872', '655']);
  assert.equal(new URL(url).searchParams.has('tag_type_ids[]'), false);
});

test('buildJobListUrl: keywords가 있어도 query 파라미터를 쓰지 않는다(신입 years=0에서 0건 무너짐 방지)', () => {
  const url = buildJobListUrl(40, { tagIds: [872], keywords: ['Java', 'Spring'] });
  assert.equal(new URL(url).searchParams.has('query'), false);
});

test('matchesKeywords: 키워드 없으면 항상 통과', () => {
  assert.equal(matchesKeywords(job({ position: '백엔드' }), []), true);
});

test('matchesKeywords: 상세 본문 어디든 한 키워드라도 포함하면 통과(대소문자 무시)', () => {
  assert.equal(matchesKeywords(job({ requirements: 'Spring Boot 경험' }), ['spring']), true);
  assert.equal(matchesKeywords(job({ preferredPoints: 'Java/Kotlin 경험' }), ['java']), true);
  assert.equal(matchesKeywords(job({ position: 'Go 백엔드' }), ['rust', 'go']), true);
});

test('matchesKeywords: 어느 키워드도 없으면 탈락', () => {
  assert.equal(matchesKeywords(job({ position: '프론트엔드', requirements: 'React' }), ['Java', 'Spring']), false);
});

test('matchesKeywords: 영어 키워드가 한글 본문과도 매칭(별칭)', () => {
  // parseQuery는 영어 정식 표기로 뱉지만 본문은 한글일 수 있다 → 별칭으로 매칭돼야 한다.
  assert.equal(matchesKeywords(job({ position: 'AI 백엔드 개발자' }), ['Backend']), true);
  assert.equal(matchesKeywords(job({ requirements: '파이썬 경험 우대' }), ['Python']), true);
  assert.equal(matchesKeywords(job({ preferredPoints: '쿠버네티스 운영' }), ['Kubernetes']), true);
  assert.equal(matchesKeywords(job({ requirements: '도커 사용' }), ['Docker']), true);
});

test('matchesKeywords: 약어/변형도 매칭(k8s, node.js)', () => {
  assert.equal(matchesKeywords(job({ requirements: 'k8s 클러스터 운영' }), ['Kubernetes']), true);
  assert.equal(matchesKeywords(job({ requirements: 'Node.js 백엔드' }), ['Node']), true);
});

test('matchesKeywords: 별칭 표에 없는 키워드는 자기 자신으로 매칭(무회귀)', () => {
  assert.equal(matchesKeywords(job({ requirements: 'GraphQL API 설계' }), ['GraphQL']), true);
  assert.equal(matchesKeywords(job({ requirements: 'GraphQL API 설계' }), ['Kafka']), false);
});

test('fetchJobsWithDetails: 이미 abort면 fetch 없이 빈 배열', async () => {
  const orig = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (async () => { fetched++; throw new Error('should not fetch'); }) as any;
  try {
    const ac = new AbortController();
    ac.abort();
    const out = await fetchJobsWithDetails(5, new Set(), DEFAULT_SEARCH, ac.signal);
    assert.deepEqual(out, []);
    assert.equal(fetched, 0);
  } finally {
    globalThis.fetch = orig;
  }
});
