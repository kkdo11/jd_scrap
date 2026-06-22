import ollama, { Ollama } from 'ollama';
import { WantedJob, ScoredJob } from './types';

// 로컬 Ollama 사용. 다른 호스트면 OLLAMA_HOST 환경변수로 지정.
const client = process.env.OLLAMA_HOST
  ? new Ollama({ host: process.env.OLLAMA_HOST })
  : ollama;

// 한국어 이력서×공고 스코어링 기본 모델. 단일 운용 모델로 gemma4:12b 사용.
//  - 먼저 `ollama pull gemma4:12b` 필요
//  - gemma4:12b는 추론(thinking) 모델이라 chat 호출 시 think:false 로 thinking을 꺼야 함.
//    (안 끄면 thinking이 num_predict 토큰 예산을 잠식해 content가 비어 JSON 파싱이 실패함)
//  - 다른 모델을 쓰려면 OLLAMA_MODEL 환경변수로 지정.
const MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:12b';

// 단일 GPU에서 Ollama는 요청을 직렬 처리하므로 동시성을 높여도 빨라지지 않습니다.
// (진짜 배치 throughput이 필요하면 vLLM의 continuous batching으로 엔진을 바꾸세요.)
const CONCURRENCY = Math.max(1, parseInt(process.env.SCORER_CONCURRENCY ?? '1', 10) || 1);
const MAX_RETRIES = 2;

// Ollama format에 넘길 JSON 스키마 — 출력 구조를 문법으로 강제
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer', minimum: 0, maximum: 100 },
    matchPoints: { type: 'array', items: { type: 'string' }, maxItems: 4 },
    gaps: { type: 'array', items: { type: 'string' }, maxItems: 3 },
    summary: { type: 'string' },
  },
  required: ['score', 'matchPoints', 'gaps', 'summary'],
} as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPrompt(job: WantedJob, resume: string): string {
  // 스키마는 format으로 강제하지만, Ollama가 모델에 스키마를 보여주지 않으므로
  // 프롬프트에도 구조를 명시해줘야 품질이 안정적입니다.
  return `당신은 채용 전문가입니다. 지원자 이력서와 채용 공고를 분석해서 적합도를 평가하세요.

## 지원자 이력서
${resume}

## 채용 공고
회사: ${job.companyName}
포지션: ${job.position}
위치: ${job.location}

주요업무:
${job.mainTasks || '정보 없음'}

자격요건:
${job.requirements || '정보 없음'}

우대사항:
${job.preferredPoints || '정보 없음'}

---

주의: 공고가 병역특례/산업기능요원/전문연구요원 전용이면 score를 0으로 설정하고 gaps에 "병역특례 전용 공고"를 포함하세요.
주의: 신입 지원이 실질적으로 불가능한 공고(최소 경력 2년 이상 명시)면 score를 10 이하로 설정하세요.

아래 JSON 형식으로만 응답하세요.
{
  "score": 0~100 정수 (90+=핵심스택 완벽일치 / 70~89=대부분일치 / 50~69=방향성맞으나갭존재 / 50미만=미스매치),
  "matchPoints": ["매칭되는 기술/경험", ...최대 4개],
  "gaps": ["부족하거나 없는 요건", ...최대 3개],
  "summary": "50자 이내 한 줄 종합 평가"
}`;
}

// format 스키마가 깨진 경우를 대비한 관대한 파서 (코드펜스 제거 + {…} 추출)
function parseJsonLenient(raw: string): any {
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

async function callWithRetry(job: WantedJob, resume: string): Promise<string> {
  let lastErr: any;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await client.chat({
        model: MODEL,
        messages: [{ role: 'user', content: buildPrompt(job, resume) }],
        format: RESPONSE_SCHEMA as any, // JSON 스키마 강제
        think: false, // 추론 모델의 thinking 비활성화 — content에 JSON이 직접 오도록(빈 응답 방지)
        stream: false,
        options: {
          temperature: 0,    // 일관된 점수
          num_predict: 2000,  // 출력 잘림(→파싱 실패) 방지. think:false라 전량 content에 쓰임
          repeat_penalty: 1.0, // EXAONE 권장값 (>1.0이면 품질 저하)
        },
      });
      return res.message.content ?? '';
    } catch (err: any) {
      lastErr = err;
      // 연결 거부면 Ollama 서버 미실행 → 재시도해도 소용없으니 즉시 중단
      const msg = String(err?.message ?? err);
      if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
        throw new Error(
          `Ollama 서버에 연결할 수 없습니다. 'ollama serve'가 실행 중인지, 모델(${MODEL})을 pull 했는지 확인하세요.`
        );
      }
      if (attempt === MAX_RETRIES) break;
      await sleep(500 * attempt);
    }
  }
  throw lastErr;
}

export async function scoreJob(job: WantedJob, resume: string): Promise<ScoredJob> {
  let text = '';
  try {
    text = await callWithRetry(job, resume);
    const parsed = parseJsonLenient(text);
    return {
      ...job,
      score: Number(parsed.score) || 0,
      matchPoints: Array.isArray(parsed.matchPoints) ? parsed.matchPoints : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
      summary: parsed.summary ?? '',
    };
  } catch (err: any) {
    const reason = text
      ? `JSON 파싱 오류: ${text.slice(0, 80)}`
      : `호출 실패: ${err?.message ?? err}`;
    console.warn(`\n⚠️  job ${job.id} 처리 실패 — ${reason}`);
    return {
      ...job,
      score: 0,
      matchPoints: [],
      gaps: ['분석 실패 — ' + (text ? 'JSON 파싱 오류' : '호출 오류')],
      summary: '분석 실패',
    };
  }
}

export async function scoreAllJobs(
  jobs: WantedJob[],
  resume: string,
  onScored?: (e: { index: number; total: number; job: ScoredJob }) => void,
  scoreOne: (job: WantedJob, resume: string) => Promise<ScoredJob> = scoreJob,
): Promise<ScoredJob[]> {
  const results: ScoredJob[] = [];
  const total = jobs.length;
  let done = 0;

  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const batch = jobs.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((job) => scoreOne(job, resume))
    );
    for (const result of batchResults) {
      done++;
      onScored?.({ index: done, total, job: result });
    }
    results.push(...batchResults);
  }

  return results.sort((a, b) => b.score - a.score);
}
