import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from './queryParser';

const fakeChat = (content: string) => async () => ({ message: { content } });

test('parseQuery: roles를 태그ID로 매핑, keywords 보존', async () => {
  const spec = await parseQuery('자바 잘하는 신입 백엔드', fakeChat('{"roles":["백엔드"],"keywords":["자바"]}'));
  assert.deepEqual(spec.tagIds, [872]);
  assert.deepEqual(spec.keywords, ['자바']);
});

test('parseQuery: 미지의 role은 버리고 키워드만 남김', async () => {
  const spec = await parseQuery('마케팅 자바', fakeChat('{"roles":["마케팅"],"keywords":["자바"]}'));
  assert.deepEqual(spec.tagIds, []);
  assert.deepEqual(spec.keywords, ['자바']);
});

test('parseQuery: 중복 태그 제거', async () => {
  const spec = await parseQuery('서버 백엔드', fakeChat('{"roles":["서버","백엔드"],"keywords":[]}'));
  assert.deepEqual(spec.tagIds, [872]);
});

test('parseQuery: JSON 깨지면 원문을 키워드로 폴백', async () => {
  const spec = await parseQuery('데이터 엔지니어 원해', fakeChat('쓰레기응답'));
  assert.deepEqual(spec.tagIds, []);
  assert.deepEqual(spec.keywords, ['데이터 엔지니어 원해']);
});

test('parseQuery: chat 예외도 폴백', async () => {
  const throwing = async () => { throw new Error('ollama down'); };
  const spec = await parseQuery('백엔드', throwing as any);
  assert.deepEqual(spec.keywords, ['백엔드']);
});
