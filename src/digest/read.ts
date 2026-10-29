import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, ReadNight, RunStatus } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
// ISO 8601 date-time with an explicit offset; the string itself is kept, never normalised.
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

type RunLine = { at: string; job: string; status: RunStatus; owner: string | null; error: string | null };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStatus(v: unknown): v is RunStatus {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

export function parseLine(line: string): RunLine | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(v)) return null;
  const { at, job, status, owner, error } = v;
  if (typeof at !== 'string' || !AT.test(at) || Number.isNaN(Date.parse(at))) return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  return {
    at,
    job,
    status,
    owner: typeof owner === 'string' ? owner : null,
    error: typeof error === 'string' ? error : null,
  };
}

export function parseNight(night: string, text: string): DigestNight {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();

  const counts = { ok: 0, retry: 0, fail: 0 };
  const byJob = new Map<string, DigestRow>();
  let badLines = 0;

  for (const raw of lines) {
    const line = parseLine(raw);
    if (!line) {
      badLines++;
      continue;
    }
    counts[line.status]++;
    const row = byJob.get(line.job);
    if (!row) {
      byJob.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        lastStatus: line.status,
        lastError: line.error,
        first: line.at,
        last: line.at,
      });
      continue;
    }
    row.runs++;
    if (line.status === 'retry') row.retries++;
    row.owner = line.owner;
    row.lastStatus = line.status;
    row.lastError = line.error;
    row.last = line.at;
  }

  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows, badLines, counts };
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch (e) {
    if (isRecord(e) && e.code === 'ENOENT') return null;
    throw e;
  }
  return parseNight(night, text);
};
