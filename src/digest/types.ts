// Contract for plan.md § 1. The implementation is `readNight` in `src/digest/read.ts`.

export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  /** Owner on the job's last line; null stays null (the view shows `—`). */
  owner: string | null;
  /** Number of log lines for this job. */
  runs: number;
  /** Number of `retry` lines for this job. */
  retries: number;
  lastStatus: RunStatus;
  /** `error` of the job's last line, null if that line has none. */
  lastError: string | null;
  /** `at` of the job's first and last line, exactly as in the log (offset kept, never UTC). */
  first: string;
  last: string;
};

export type StatusCounts = Record<RunStatus, number>;

export type DigestNight = {
  night: string;
  /** One row per job, sorted by job. */
  rows: DigestRow[];
  /** Lines that are not valid JSON or lack a valid `at` / `job` / `status`. */
  badLines: number;
  /** Log lines per status, bad lines excluded. */
  counts: StatusCounts;
};

/**
 * Reads `<runsDir>/<night>.jsonl`. Returns null when there is no file for that night, or when
 * `night` is not `YYYY-MM-DD` (then the filesystem is not touched). Bad lines never throw.
 */
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
