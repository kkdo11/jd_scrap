import { WantedJob, SearchSpec } from './types';
import { DEFAULT_SEARCH } from './jobTags';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'https://www.wanted.co.kr/api/v4';

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://www.wanted.co.kr/jobs',
};

// 경력 필터: -1 = 경력 무관(전체), 0 = 신입, 1~ = N년차
// 신입 구직이면 0 권장. 단 0으로 두면 '경력무관'으로 올라온 신입 환영 공고를 놓칠 수 있어
// 폭넓게 보려면 -1 유지. (검증 결과 0 → 인턴/신입 위주, -1 → 전체)
const EXPERIENCE_YEARS = '0';

// 상세 조회 결과 캐시 (재실행 시 토큰/요청 절약). 비활성화하려면 USE_CACHE=false
const USE_CACHE = process.env.USE_CACHE !== 'false';
const CACHE_PATH = path.join(process.cwd(), '.cache', 'job-details.json');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadCache(): Record<string, Partial<WantedJob>> {
  if (!USE_CACHE) return {};
  try {
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, Partial<WantedJob>>): void {
  if (!USE_CACHE) return;
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf-8');
  } catch {
    /* 캐시 저장 실패는 치명적이지 않으므로 무시 */
  }
}

export function buildJobListUrl(limit: number, search: SearchSpec): string {
  const params = new URLSearchParams({
    job_sort: 'job.latest_order',
    years: EXPERIENCE_YEARS,
    limit: String(limit),
    country: 'kr',
  });
  // ⚠️ 원티드 API는 'tag_type_ids[]'(대괄호)를 무시한다. 대괄호 없이 반복 전달해야 필터 적용.
  // 호출자(서버/CLI)가 tagIds 최소 1개를 보장한다(빈 태그 = 전체 수집 경로는 없음).
  search.tagIds.forEach((id) => params.append('tag_type_ids', String(id)));
  // 키워드는 query 파라미터로 넘기지 않는다: years=0(신입)과 함께 쓰면 거의 0건으로 무너진다.
  // (실측: 872 신입 단독 40건, query=Java/spring 추가 시 0~1건) → 키워드는 수집 후 상세 본문에서 필터한다.
  return `${BASE_URL}/jobs?${params.toString()}`;
}

export async function fetchJobList(
  limit: number = 40,
  search: SearchSpec = DEFAULT_SEARCH,
): Promise<WantedJob[]> {
  const url = buildJobListUrl(limit, search);
  console.log(`📡 GET ${url}\n`);

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Wanted API error: ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as { data?: any[] };
  const list = Array.isArray(body.data) ? body.data : [];
  if (list.length === 0) {
    console.warn('⚠️  공고가 0건입니다. API 응답 구조나 파라미터를 확인하세요.');
  }
  return list.map((job: any) => ({
    id: job.id,
    position: job.position ?? '',
    companyName: job.company?.name ?? '',
    location: job.address?.location ?? '',
    mainTasks: '',
    requirements: '',
    preferredPoints: '',
  }));
}

export async function fetchJobDetail(jobId: number): Promise<Partial<WantedJob>> {
  const res = await fetch(`${BASE_URL}/jobs/${jobId}`, { headers: HEADERS });

  if (!res.ok) {
    throw new Error(`Detail fetch error for job ${jobId}: ${res.status}`);
  }

  const data = (await res.json()) as { job?: { detail?: any } };
  const detail = data.job?.detail ?? {};

  return {
    mainTasks: detail.main_tasks ?? '',
    requirements: detail.requirements ?? '',
    preferredPoints: detail.preferred_points ?? '',
  };
}

const EXCLUDE_KEYWORDS = ['병역특례', '산업기능요원', '전문연구요원'];

function isMilitaryAlternative(job: WantedJob): boolean {
  const text = [job.position, job.mainTasks, job.requirements, job.preferredPoints].join(' ');
  return EXCLUDE_KEYWORDS.some((kw) => text.includes(kw));
}

// 키워드 필터(수집 후): 상세까지 받은 공고의 제목+본문에서 키워드를 찾는다.
// 기술명은 주로 자격요건/우대사항 본문에 영어로 등장하므로(제목엔 거의 없음) 상세 기준으로 매칭한다.
// 키워드가 없으면 모두 통과. 여러 키워드는 OR(하나라도 포함)로 본다(0건 방지).
export function matchesKeywords(job: WantedJob, keywords: string[]): boolean {
  if (!keywords.length) return true;
  const text = [job.position, job.mainTasks, job.requirements, job.preferredPoints]
    .join(' ')
    .toLowerCase();
  return keywords.some((kw) => text.includes(kw.toLowerCase()));
}

export async function fetchJobsWithDetails(
  limit: number = 40,
  excludeIds: Set<number> = new Set(),
  search: SearchSpec = DEFAULT_SEARCH,
): Promise<WantedJob[]> {
  console.log('📡 Fetching job list from Wanted...');
  // 병역특례·키워드 필터 후에도 limit개 확보하도록 여유분 요청.
  // 키워드가 있으면 상세 본문 매칭으로 많이 탈락하므로 후보 풀을 넉넉히(4배, 신입 풀 자체가 작아 상한은 API가 정함).
  const fetchLimit = Math.ceil(limit * (search.keywords.length ? 4 : 1.3));
  const jobs = await fetchJobList(fetchLimit, search);

  const titleFiltered = jobs
    .filter((j) => !EXCLUDE_KEYWORDS.some((kw) => j.position.includes(kw)))
    .filter((j) => !excludeIds.has(j.id));
  console.log(`✅ Found ${jobs.length} jobs (제목·확인함 필터 후 ${titleFiltered.length}개)\n`);

  const cache = loadCache();
  const results: WantedJob[] = [];
  let cacheHits = 0;
  let excluded = 0;

  for (let i = 0; i < titleFiltered.length; i++) {
    if (results.length >= limit) break;
    const job = titleFiltered[i];
    process.stdout.write(
      `  Fetching detail [${i + 1}/${titleFiltered.length}]: ${job.position} @ ${job.companyName}...         \r`,
    );
    const cached = cache[String(job.id)];
    const merged = cached ? { ...job, ...cached } : job;
    if (!cached) {
      try {
        const detail = await fetchJobDetail(job.id);
        cache[String(job.id)] = detail;
        Object.assign(merged, detail);
      } catch {
        /* 실패해도 기본 정보로 진행 */
      }
      await sleep(250);
    } else {
      cacheHits++;
    }
    if (isMilitaryAlternative(merged as WantedJob)) {
      excluded++;
      continue;
    }
    // 키워드 필터(상세 본문 기준) — 상세까지 받은 뒤 매칭. 키워드 없으면 전부 통과.
    if (!matchesKeywords(merged as WantedJob, search.keywords)) {
      continue;
    }
    results.push(merged as WantedJob);
  }

  saveCache(cache);
  console.log(`\n✅ Detail fetching complete (cache hits: ${cacheHits}, 병역특례 제외: ${excluded}, 최종: ${results.length}개)\n`);
  return results;
}
