import { fetchJobsWithDetails } from './wanted';
import { scoreAllJobs } from './scorer';
import { WantedJob, ScoredJob, ProgressEvent } from './types';

export interface PipelineDeps {
  fetchJobs: (limit: number, excludeIds: Set<number>) => Promise<WantedJob[]>;
  scoreJobs: (
    jobs: WantedJob[],
    resume: string,
    onScored?: (e: { index: number; total: number; job: ScoredJob }) => void,
  ) => Promise<ScoredJob[]>;
}

const defaultDeps: PipelineDeps = {
  fetchJobs: fetchJobsWithDetails,
  scoreJobs: scoreAllJobs,
};

// 수집→채점을 묶고 단계마다 onProgress를 호출한다. CLI/웹 공용.
export async function runPipeline(
  resume: string,
  limit: number,
  onProgress: (e: ProgressEvent) => void,
  deps: PipelineDeps = defaultDeps,
  excludeIds: Set<number> = new Set(),
): Promise<ScoredJob[]> {
  try {
    onProgress({ type: 'status', message: '공고 수집 중...' });
    const jobs = await deps.fetchJobs(limit, excludeIds);

    onProgress({ type: 'status', message: `${jobs.length}개 공고 채점 시작` });
    const result = await deps.scoreJobs(jobs, resume, (e) =>
      onProgress({ type: 'scored', index: e.index, total: e.total, job: e.job }),
    );

    onProgress({ type: 'done', count: result.length });
    return result;
  } catch (err: any) {
    onProgress({ type: 'error', message: String(err?.message ?? err) });
    throw err;
  }
}
