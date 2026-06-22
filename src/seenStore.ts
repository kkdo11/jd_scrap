import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

type Store = Record<string, number[]>;

export function hashResume(resume: string): string {
  return createHash('sha256').update(resume.trim()).digest('hex');
}

function defaultPath(): string {
  return process.env.SEEN_STORE_PATH ?? path.join(process.cwd(), '.data', 'seen-jobs.json');
}

function load(p: string): Store {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function save(p: string, store: Store): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store), 'utf-8');
}

export function getSeen(hash: string, storePath: string = defaultPath()): Set<number> {
  return new Set(load(storePath)[hash] ?? []);
}

export function toggleSeen(
  hash: string,
  jobId: number,
  seen: boolean,
  storePath: string = defaultPath(),
): void {
  const store = load(storePath);
  const set = new Set(store[hash] ?? []);
  if (seen) set.add(jobId);
  else set.delete(jobId);
  if (set.size > 0) store[hash] = [...set];
  else delete store[hash];
  save(storePath, store);
}

export function resetSeen(hash: string, storePath: string = defaultPath()): void {
  const store = load(storePath);
  delete store[hash];
  save(storePath, store);
}
