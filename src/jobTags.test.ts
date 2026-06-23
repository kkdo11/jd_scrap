import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameToTagId, isKnownTagId, tagOptions, DEFAULT_TAG_IDS } from './jobTags';

test('nameToTagId: 라벨/별칭/대소문자/공백 매핑', () => {
  assert.equal(nameToTagId('백엔드'), 872);
  assert.equal(nameToTagId('Backend'), 872);
  assert.equal(nameToTagId('  서버  '), 872);
  assert.equal(nameToTagId('데이터엔지니어'), 655);
});

test('nameToTagId: 미지의 직군은 undefined', () => {
  assert.equal(nameToTagId('마케팅'), undefined);
});

test('isKnownTagId: 사전에 있는 ID만 true', () => {
  assert.equal(isKnownTagId(872), true);
  assert.equal(isKnownTagId(99999), false);
});

test('tagOptions: 라벨+id 목록 반환, 기본 4직군 포함', () => {
  const opts = tagOptions();
  assert.ok(opts.every((o) => typeof o.id === 'number' && typeof o.label === 'string'));
  for (const id of DEFAULT_TAG_IDS) assert.ok(opts.some((o) => o.id === id));
});
