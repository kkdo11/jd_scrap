import { ProgressEvent } from './types';

// ProgressEvent를 SSE 텍스트 프레임으로 직렬화한다.
// event 이름 = type, data = 이벤트 객체 전체(JSON).
export function formatSSE(event: ProgressEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
