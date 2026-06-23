import ollama, { Ollama } from 'ollama';
import { SearchSpec } from './types';
import { nameToTagId, JOB_TAGS } from './jobTags';
import { parseJsonLenient } from './jsonParse';

const client = process.env.OLLAMA_HOST ? new Ollama({ host: process.env.OLLAMA_HOST }) : ollama;
const MODEL = process.env.OLLAMA_MODEL ?? 'gemma4:12b';

export type ChatFn = (req: any) => Promise<{ message: { content: string } }>;
const defaultChat: ChatFn = (req) => client.chat({ ...req, stream: false }) as any;

const SCHEMA = {
  type: 'object',
  properties: {
    roles: { type: 'array', items: { type: 'string' } },
    keywords: { type: 'array', items: { type: 'string' } },
  },
  required: ['roles', 'keywords'],
} as const;

function buildPrompt(text: string): string {
  const labels = JOB_TAGS.map((t) => t.label).join(', ');
  return `사용자의 구직 요청에서 직군(role)과 기술 키워드를 추출하세요.

요청: "${text}"

직군은 반드시 다음 목록 중에서만 고르세요(해당 없으면 roles는 빈 배열):
${labels}

키워드는 프로그래밍 언어/프레임워크/도구 등 구체 기술명만. 직군명은 키워드에 넣지 마세요.
키워드는 공고 본문에서 매칭하므로 반드시 영어 정식 표기로 쓰세요(예: 자바→"Java", 스프링→"Spring", 쿠버네티스→"Kubernetes", 파이썬→"Python").

아래 JSON으로만 응답:
{"roles": ["..."], "keywords": ["..."]}`;
}

export async function parseQuery(text: string, chat: ChatFn = defaultChat): Promise<SearchSpec> {
  try {
    const res = await chat({
      model: MODEL,
      messages: [{ role: 'user', content: buildPrompt(text) }],
      format: SCHEMA as any,
      think: false,
      options: { temperature: 0 },
    });
    const parsed = parseJsonLenient(res.message.content ?? '');
    const roles: unknown[] = Array.isArray(parsed.roles) ? parsed.roles : [];
    const tagIds = [
      ...new Set(
        roles
          .filter((r): r is string => typeof r === 'string')
          .map(nameToTagId)
          .filter((id): id is number => typeof id === 'number'),
      ),
    ];
    const keywords = Array.isArray(parsed.keywords)
      ? parsed.keywords.filter((k: unknown): k is string => typeof k === 'string' && k.trim().length > 0)
      : [];
    return { tagIds, keywords };
  } catch {
    return { tagIds: [], keywords: [text.trim()] };
  }
}
