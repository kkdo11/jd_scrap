import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampLimit, isValidResume, sanitizeTagIds, isValidSearch } from './validation';

test('clampLimit: 정상 범위는 그대로', () => {
  assert.equal(clampLimit(30), 30);
  assert.equal(clampLimit(1), 1);
  assert.equal(clampLimit(100), 100);
});

test('clampLimit: 잘못된 값은 50', () => {
  assert.equal(clampLimit(0), 50);
  assert.equal(clampLimit(-5), 50);
  assert.equal(clampLimit('abc'), 50);
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit(null), 50);
});

test('clampLimit: 100 초과는 100으로, 소수는 내림', () => {
  assert.equal(clampLimit(101), 100);
  assert.equal(clampLimit(999), 100);
  assert.equal(clampLimit(50.7), 50);
});

test('clampLimit: 숫자 문자열도 허용', () => {
  assert.equal(clampLimit('30'), 30);
});

test('isValidResume: 비어있지 않은 문자열만 true', () => {
  assert.equal(isValidResume('내 이력서'), true);
  assert.equal(isValidResume(''), false);
  assert.equal(isValidResume('   '), false);
  assert.equal(isValidResume(undefined), false);
  assert.equal(isValidResume(123), false);
});

test('sanitizeTagIds: 알려진 정수 ID만, 고유하게', () => {
  assert.deepEqual(sanitizeTagIds([872, 872, 655]), [872, 655]);
});

test('sanitizeTagIds: 미지의 ID·비정수·비배열 제거', () => {
  assert.deepEqual(sanitizeTagIds([99999, '872', 1.5]), []);
  assert.deepEqual(sanitizeTagIds('nope'), []);
  assert.deepEqual(sanitizeTagIds(undefined), []);
});

test('isValidSearch: queryText 있으면 true', () => {
  assert.equal(isValidSearch('백엔드', []), true);
});

test('isValidSearch: tagIds 있으면 true', () => {
  assert.equal(isValidSearch('', [872]), true);
  assert.equal(isValidSearch(undefined, [872]), true);
});

test('isValidSearch: 둘 다 비면 false', () => {
  assert.equal(isValidSearch('   ', []), false);
  assert.equal(isValidSearch(undefined, []), false);
});
