import { SearchSpec } from './types';

export interface JobTag {
  id: number;
  label: string;
  aliases: string[];
}

// 직군 사전 — 단일 진실원천. 프론트 칩·LLM 매핑 모두 여기서 파생.
export const JOB_TAGS: JobTag[] = [
  { id: 872, label: '백엔드', aliases: ['백엔드', '백앤드', '서버', 'server', 'backend'] },
  { id: 1634, label: 'AI/머신러닝', aliases: ['ai', '에이아이', '머신러닝', 'ml', '인공지능', '딥러닝', 'machine learning'] },
  { id: 674, label: 'DevOps/인프라', aliases: ['devops', '데브옵스', '인프라', 'infra', 'sre'] },
  { id: 655, label: '데이터엔지니어', aliases: ['데이터엔지니어', '데이터 엔지니어', '데이터', 'data engineer'] },
  { id: 669, label: '프론트엔드', aliases: ['프론트엔드', '프론트', 'frontend', 'front-end', 'fe', '웹퍼블리셔'] },
];

export const DEFAULT_TAG_IDS: number[] = [872, 1634, 674, 655];

export const DEFAULT_SEARCH: SearchSpec = { tagIds: DEFAULT_TAG_IDS, keywords: [] };

export function nameToTagId(name: string): number | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  const hit = JOB_TAGS.find(
    (t) => t.label.toLowerCase() === n || t.aliases.some((a) => a.toLowerCase() === n),
  );
  return hit?.id;
}

export function isKnownTagId(id: number): boolean {
  return JOB_TAGS.some((t) => t.id === id);
}

export function tagOptions(): { id: number; label: string }[] {
  return JOB_TAGS.map(({ id, label }) => ({ id, label }));
}
