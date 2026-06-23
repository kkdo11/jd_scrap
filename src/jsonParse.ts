// format 스키마가 깨진 경우를 대비한 관대한 파서 (코드펜스 제거 + {…} 추출)
export function parseJsonLenient(raw: string): any {
  let text = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    /* fallthrough */
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return JSON.parse(text.slice(start, end + 1));
  }
  throw new Error('No JSON object found');
}
