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
