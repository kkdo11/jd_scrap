import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobListUrl, matchesKeywords } from './wanted';
import { WantedJob } from './types';

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
