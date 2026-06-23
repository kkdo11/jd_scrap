import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobListUrl } from './wanted';

test('buildJobListUrl: tagIds를 대괄호 없는 tag_type_ids로 반복 전달', () => {
  const url = buildJobListUrl(40, { tagIds: [872, 655], keywords: [] });
  const qs = new URL(url).searchParams.getAll('tag_type_ids');
  assert.deepEqual(qs, ['872', '655']);
  assert.equal(new URL(url).searchParams.has('tag_type_ids[]'), false);
});

test('buildJobListUrl: keywords 있으면 query 파라미터로 위임(서버사이드 narrowing)', () => {
  const url = buildJobListUrl(40, { tagIds: [872], keywords: ['자바', 'spring'] });
  assert.equal(new URL(url).searchParams.get('query'), '자바 spring');
});

test('buildJobListUrl: keywords 없으면 query 없음', () => {
  const url = buildJobListUrl(40, { tagIds: [872], keywords: [] });
  assert.equal(new URL(url).searchParams.has('query'), false);
});
