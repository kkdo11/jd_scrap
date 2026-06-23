// CLI 인자/웹 입력 공통: limit을 1~100 정수로 클램프. 잘못된 값은 기본 50.
export function clampLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(100, Math.floor(n));
}

// 이력서는 공백 아닌 문자열이어야 한다.
export function isValidResume(resume: unknown): resume is string {
  return typeof resume === 'string' && resume.trim().length > 0;
}

import { isKnownTagId } from './jobTags';

// 클라이언트가 보낸 칩 tagIds를 신뢰하지 않고 정제: 알려진 정수 ID만 고유하게.
export function sanitizeTagIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v === 'number' && Number.isInteger(v) && isKnownTagId(v) && !out.includes(v)) {
      out.push(v);
    }
  }
  return out;
}

// 검색은 비어있지 않은 자유텍스트 또는 1개 이상의 직군 칩이 있어야 유효.
export function isValidSearch(queryText: unknown, tagIds: number[]): boolean {
  const hasText = typeof queryText === 'string' && queryText.trim().length > 0;
  return hasText || tagIds.length > 0;
}
