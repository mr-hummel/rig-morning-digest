import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestNight } from '../src/digest/types.js';

const NORMAL = '2026-10-28';
const EMPTY = '2026-10-29';
const BAD = '2026-10-30';
const MISSING = '2026-10-01';

const bundled = (name: string) => readFileSync(fileURLToPath(new URL(`../runs/${name}.jsonl`, import.meta.url)), 'utf8');

const BAD_NIGHT = [
  '{"at":"2026-10-30T04:00:01+01:00","job":"notes/backup","status":"ok","owner":"lane-07"}',
  'not json at all',
  '{"at":"2026-10-30T05:00:00+01:00","job":"lane/sync","status":"retry","owner":"rook","error":"lock held"}',
  '{"at":"2026-10-30T05:00:30+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-10-30T05:41:09+01:00","job":"digest/render","status":"ok","owner":null}',
].join('\n');

const config = (runsDir: string) => ({
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
});

let tmp: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'rig-routes-'));
  writeFileSync(join(tmp, `${NORMAL}.jsonl`), bundled(NORMAL));
  writeFileSync(join(tmp, `${EMPTY}.jsonl`), '');
  writeFileSync(join(tmp, `${BAD}.jsonl`), `${BAD_NIGHT}\n`);
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The job cell of every body row, in page order. */
function pageJobs(html: string): string[] {
  return html
    .split('<tr')
    .slice(1)
    .map((row) => row.match(/<td[^>]*>(.*?)<\/td>/)?.[1]?.replace(/<[^>]+>/g, ''))
    .filter((job): job is string => job !== undefined);
}

const JOBS_NORMAL = ['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs'];
const JOBS_BAD = ['digest/render', 'lane/sync', 'notes/backup'];

describe('GET /digest/:night', () => {
  const app = createApp(config(tmp));

  it('answers 200 with the night heading and one row per job', async () => {
    const res = await app.request(`/digest/${NORMAL}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('digest · 2026-10-28');
    expect(html).toMatch(/<h1[^>]*>digest 2026-10-28<\/h1>/);
    expect(pageJobs(html)).toEqual(JOBS_NORMAL);
  });

  it('answers 404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no such night');
  });

  it('answers 404 for an invalid night', async () => {
    const res = await app.request('/digest/not-a-date');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no such night');
  });

  it('renders an empty night as "nothing ran" instead of a table', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).not.toContain('<table');
  });

  it('keeps the good jobs on a night with a bad line and says how many lines were skipped', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 bad line');
    expect(pageJobs(html)).toEqual(JOBS_BAD);
  });
});

describe('GET /api/digest/:night', () => {
  const app = createApp(config(tmp));

  it('answers 200 with the night as JSON', async () => {
    const res = await app.request(`/api/digest/${NORMAL}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body.night).toBe(NORMAL);
    expect(body.rows.map((r) => r.job)).toEqual(JOBS_NORMAL);
    expect(body.badLines).toBe(1);
    expect(body.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(body.rows.find((r) => r.job === 'notes/backup')).toMatchObject({
      owner: 'lane-07',
      runs: 1,
      lastStatus: 'fail',
      lastError: 'quota exceeded',
      first: '2026-10-29T04:00:01+01:00',
      last: '2026-10-29T04:00:01+01:00',
    });
  });

  it('answers 404 JSON for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });

  it('answers 404 JSON for an invalid night', async () => {
    const res = await app.request('/api/digest/not-a-date');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });

  it('answers an empty night with no rows', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: EMPTY,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts the bad line and keeps the good jobs', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DigestNight;
    expect(body.badLines).toBe(1);
    expect(body.counts).toEqual({ ok: 3, retry: 1, fail: 0 });
    expect(body.rows.map((r) => r.job)).toEqual(JOBS_BAD);
  });
});

describe('page and JSON agree', () => {
  const app = createApp(config(tmp));

  it.each([NORMAL, EMPTY, BAD])('list the same jobs in the same order for %s', async (night) => {
    const html = await (await app.request(`/digest/${night}`)).text();
    const json = (await (await app.request(`/api/digest/${night}`)).json()) as DigestNight;
    expect(pageJobs(html)).toEqual(json.rows.map((r) => r.job));
  });
});
