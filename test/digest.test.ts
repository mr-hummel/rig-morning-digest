import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseNight, readNight } from '../src/digest/read.js';

const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');
  const row = (job: string) => night?.rows.find((r) => r.job === job);

  it('reads 5 jobs, sorted, and counts the truncated line as bad', () => {
    expect(night?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night?.badLines).toBe(1);
    expect(night?.night).toBe('2026-10-28');
  });

  it('counts log lines per status, bad line excluded', () => {
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('summarises each job from its lines', () => {
    expect(row('fixtures/refresh')).toMatchObject({ runs: 4, retries: 3, lastStatus: 'ok', lastError: null });
    expect(row('notes/backup')).toMatchObject({ runs: 1, lastStatus: 'fail', lastError: 'quota exceeded', owner: 'lane-07' });
    expect(row('lane/sync')).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', owner: 'rook' });
  });

  it('keeps a null owner', () => {
    expect(row('digest/render')?.owner).toBeNull();
  });

  it('keeps first and last exactly as logged, offset included', () => {
    expect(row('lane/sync')).toMatchObject({ first: '2026-10-28T23:00:06+01:00', last: '2026-10-29T05:00:04+01:00' });
    expect(row('digest/render')).toMatchObject({ first: '2026-10-29T05:41:09+01:00', last: '2026-10-29T05:41:09+01:00' });
  });
});

describe('readNight without a night to read', () => {
  it('returns null for a night with no file', () => {
    expect(readNight('runs', '2026-10-01')).toBeNull();
  });

  it('returns null for an invalid night without touching the filesystem', () => {
    writeFileSync(join(tmp, 'secret.jsonl'), '{"at":"2026-10-28T23:00:00+01:00","job":"x","status":"ok","owner":null}\n');
    expect(readNight(join(tmp, 'sub'), '../secret')).toBeNull();
    expect(readNight('runs', '../runs/2026-10-28')).toBeNull();
    expect(readNight('runs', '2026-10-28.jsonl')).toBeNull();
    expect(readNight('runs', '')).toBeNull();
  });

  it('reads an empty file as an empty night, not as no file', () => {
    writeFileSync(join(tmp, '2026-11-01.jsonl'), '');
    expect(readNight(tmp, '2026-11-01')).toEqual({
      night: '2026-11-01',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });
});

describe('parseNight', () => {
  const ok = (job: string, at: string, extra = {}) => JSON.stringify({ at, job, status: 'ok', owner: 'rook', ...extra });

  it('counts lines without a valid at, job or status as bad, never throws', () => {
    const text = [
      ok('a', '2026-10-28T23:00:00+01:00'),
      '{"job":"a","status":"ok","owner":"rook"}',
      ok('a', 'yesterday'),
      ok('', '2026-10-28T23:00:00+01:00'),
      JSON.stringify({ at: '2026-10-28T23:00:00+01:00', job: 'a', status: 'done', owner: 'rook' }),
      '[1,2]',
      'null',
      'not json',
    ].join('\n');
    const night = parseNight('2026-10-28', text);
    expect(night.badLines).toBe(7);
    expect(night.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
  });

  it('does not count a blank trailing line as bad', () => {
    expect(parseNight('2026-10-28', `${ok('a', '2026-10-28T23:00:00+01:00')}\n\n`).badLines).toBe(0);
  });

  it('takes owner and error from the job\'s last line', () => {
    const text = [
      JSON.stringify({ at: '2026-10-28T23:00:00+01:00', job: 'a', status: 'fail', owner: 'rook', error: 'boom' }),
      JSON.stringify({ at: '2026-10-28T23:05:00+01:00', job: 'a', status: 'ok', owner: null }),
    ].join('\n');
    expect(parseNight('2026-10-28', text).rows[0]).toMatchObject({ owner: null, lastStatus: 'ok', lastError: null });
  });
});
