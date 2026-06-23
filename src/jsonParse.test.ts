import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonLenient } from './jsonParse';

test('parseJsonLenient: 순수 JSON 파싱', () => {
  assert.deepEqual(parseJsonLenient('{"a":1}'), { a: 1 });
});

test('parseJsonLenient: 코드펜스 제거', () => {
  assert.deepEqual(parseJsonLenient('```json\n{"a":2}\n```'), { a: 2 });
});

test('parseJsonLenient: 앞뒤 잡텍스트 사이 {…} 추출', () => {
  assert.deepEqual(parseJsonLenient('결과: {"a":3} 끝'), { a: 3 });
});

test('parseJsonLenient: JSON 없으면 throw', () => {
  assert.throws(() => parseJsonLenient('no json here'));
});
