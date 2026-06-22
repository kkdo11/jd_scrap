export interface WantedJob {
  id: number;
  position: string;
  companyName: string;
  location: string;
  mainTasks: string;
  requirements: string;
  preferredPoints: string;
}

export interface ScoredJob extends WantedJob {
  score: number;
  matchPoints: string[];
  gaps: string[];
  summary: string;
}

export type ProgressEvent =
  | { type: 'status'; message: string }
  | { type: 'scored'; index: number; total: number; job: ScoredJob }
  | { type: 'done'; count: number }
  | { type: 'error'; message: string };
