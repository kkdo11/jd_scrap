import { fetchJobsWithDetails } from './wanted';
import { scoreAllJobs } from './scorer';
import { WantedJob, ScoredJob, ProgressEvent, SearchSpec } from './types';
import { DEFAULT_SEARCH } from './jobTags';

export interface PipelineDeps {
  fetchJobs: (limit: number, excludeIds: Set<number>, search: SearchSpec, signal?: AbortSignal) => Promise<WantedJob[]>;
  scoreJobs: (
    jobs: WantedJob[],
    resume: string,
    onScored?: (e: { index: number; total: number; job: ScoredJob }) => void,
    signal?: AbortSignal,
  ) => Promise<ScoredJob[]>;
}

const defaultDeps: PipelineDeps = {
  fetchJobs: fetchJobsWithDetails,
  scoreJobs: (jobs, resume, onScored, signal) => scoreAllJobs(jobs, resume, onScored, undefined, signal),
};

// 수집→채점을 묶고 단계마다 onProgress를 호출한다. CLI/웹 공용.
export async function runPipeline(
  resume: string,
  limit: number,
  onProgress: (e: ProgressEvent) => void,
  deps: PipelineDeps = defaultDeps,
  excludeIds: Set<number> = new Set(),
  search: SearchSpec = DEFAULT_SEARCH,
  signal?: AbortSignal,
): Promise<ScoredJob[]> {
  try {
    onProgress({ type: 'status', message: '공고 수집 중...' });
    const jobs = await deps.fetchJobs(limit, excludeIds, search, signal);

    onProgress({ type: 'status', message: `${jobs.length}개 공고 채점 시작` });
    const result = await deps.scoreJobs(jobs, resume, (e) =>
      onProgress({ type: 'scored', index: e.index, total: e.total, job: e.job }),
      signal,
    );

    onProgress({ type: 'done', count: result.length });
    return result;
  } catch (err: any) {
    onProgress({ type: 'error', message: String(err?.message ?? err) });
    throw err;
  }
}
