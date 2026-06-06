// TC-L4 — no-0/0 flash live browser frame log.
// Submits a real audit, opens /audit/<id> in chromium, wraps EventSource to timestamp every
// SSE frame, and uses a MutationObserver + 200ms sampler to record which component is rendered
// at each frame. Asserts: every pre-`done` frame is AuditProgress|GradeCardSkeleton (never
// GradeCard); the first GradeCard appearance ts >= the `done` event ts; GradeCard numbers match
// the `done` payload's orphanCount/avgDepth.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire('/home/udsik/nahl-clients-projects/crawlmouse-v1.0.0/apps/web/');
const { chromium } = require('@playwright/test');

const BASE = 'http://localhost:3000';
const TARGET = process.argv[2] || 'https://www.iana.org';
const OUT_JSON = process.argv[3] || 'evidence/plan-5/TC-L4-frames.json';
const OUT_PNG = process.argv[4] || 'evidence/plan-5/TC-L4.png';
const OUT_MID = 'evidence/plan-5/TC-L4-mid.png';

const DONE_TIMEOUT = Number(process.env.DONE_TIMEOUT || 120000);
// Attach to an existing audit (browser opens mid-crawl) when P5_AUDIT_ID is set; else submit fresh.
let auditId = process.env.P5_AUDIT_ID;
if (!auditId) {
  const res = await fetch(`${BASE}/api/audits/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: TARGET }),
  });
  const body = await res.json();
  if (!res.ok || !body.auditId) {
    console.error('SUBMIT FAILED', res.status, JSON.stringify(body));
    process.exit(1);
  }
  auditId = body.auditId;
}
console.log('AUDIT_ID=' + auditId);

const browser = await chromium.launch();
const page = await browser.newPage();

await page.addInitScript(() => {
  window.__p5 = { sse: [], frames: [], domFirst: {} };
  const seen = {};
  const detect = () => {
    const t = Date.now();
    const txt = document.body ? document.body.innerText : '';
    const c = {
      gradeCard: txt.includes('orphan pages') && txt.includes('avg click depth'),
      skeleton: !!document.querySelector('[aria-label="Computing your grade"]'),
      gradeFailed: txt.includes('grade this site'),     // "Couldn't grade this site"
      failed: txt.includes('Audit failed'),
      progress: txt.includes('Crawling your site') || /\b\d+ \/ \d+ pages\b/.test(txt),
    };
    for (const k of Object.keys(c)) if (c[k] && !seen[k]) { seen[k] = t; window.__p5.domFirst[k] = t; }
    return c;
  };
  // wrap EventSource to timestamp every SSE frame
  const Orig = window.EventSource;
  window.EventSource = function (url, opts) {
    const es = new Orig(url, opts);
    const mk = (name) => (ev) => {
      let parsed = null;
      try { parsed = JSON.parse(ev.data); } catch {}
      window.__p5.sse.push({ event: name, t: Date.now(), status: parsed && parsed.status,
        orphanCount: parsed && parsed.orphanCount, avgDepth: parsed && parsed.avgDepth,
        hasFindingGroups: !!(parsed && parsed.findingGroups) });
    };
    for (const n of ['snapshot', 'progress', 'done', 'error']) es.addEventListener(n, mk(n));
    return es;
  };
  Object.getPrototypeOf(window.EventSource); // noop keep ref
  window.EventSource.prototype = Orig.prototype;
  // sample the DOM every 200ms, tagged with the latest SSE event seen
  const sample = () => {
    const c = detect();
    const last = window.__p5.sse[window.__p5.sse.length - 1];
    let comp = 'none';
    if (c.gradeCard) comp = 'GradeCard';
    else if (c.skeleton) comp = 'GradeCardSkeleton';
    else if (c.gradeFailed) comp = 'gradeFailed';
    else if (c.failed) comp = 'failed';
    else if (c.progress) comp = 'AuditProgress';
    window.__p5.frames.push({ t: Date.now(), lastEvent: last ? last.event : null, rendered: comp, ...c });
  };
  if (document.body) new MutationObserver(detect).observe(document.body, { subtree: true, childList: true, characterData: true });
  else document.addEventListener('DOMContentLoaded', () => new MutationObserver(detect).observe(document.body, { subtree: true, childList: true, characterData: true }));
  setInterval(sample, 200);
});

await page.goto(`${BASE}/audit/${auditId}`, { waitUntil: 'domcontentloaded' });

// mid-stream screenshot ~2s in (should be running/skeleton)
await page.waitForTimeout(2000).catch(() => {});
await page.screenshot({ path: OUT_MID }).catch(() => {});

// wait for the `done` SSE event (or 180s timeout)
await page.waitForFunction(() => window.__p5.sse.some((e) => e.event === 'done' || e.event === 'error'), null, { timeout: DONE_TIMEOUT });
// let React settle the final render
await page.waitForTimeout(1500);

const data = await page.evaluate(() => window.__p5);
// read the rendered GradeCard numbers (if present)
const gcNums = await page.evaluate(() => {
  const nums = [...document.querySelectorAll('.font-mono.text-2xl')].map((e) => e.textContent.trim());
  return nums;
});
await page.screenshot({ path: OUT_PNG });
await browser.close();

// ---- analysis ----
const doneEv = data.sse.find((e) => e.event === 'done');
const errEv = data.sse.find((e) => e.event === 'error');
const doneTs = doneEv ? doneEv.t : (errEv ? errEv.t : null);
const preDoneFrames = data.frames.filter((f) => doneTs && f.t < doneTs);
const badPreDone = preDoneFrames.filter((f) => f.rendered === 'GradeCard');
const firstGradeCard = data.domFirst.gradeCard || null;

const result = {
  auditId, target: TARGET,
  sseEvents: data.sse,
  domFirst: data.domFirst,
  doneTs, doneStatus: doneEv ? doneEv.status : null,
  donePayload: doneEv ? { orphanCount: doneEv.orphanCount, avgDepth: doneEv.avgDepth, hasFindingGroups: doneEv.hasFindingGroups } : null,
  renderedGradeCardNums: gcNums,
  frameCount: data.frames.length,
  preDoneFrameCount: preDoneFrames.length,
  preDoneRenderedSet: [...new Set(preDoneFrames.map((f) => f.rendered))],
  assertions: {
    no_gradecard_before_done: badPreDone.length === 0,
    first_gradecard_ts_geq_done: firstGradeCard == null || (doneTs != null && firstGradeCard >= doneTs),
    firstGradeCardTs: firstGradeCard,
  },
  frames: data.frames,
};
writeFileSync(OUT_JSON, JSON.stringify(result, null, 2));
console.log('DONE_TS=' + doneTs, 'DONE_STATUS=' + (doneEv ? doneEv.status : 'n/a'));
console.log('PRE_DONE_RENDERED=' + JSON.stringify(result.preDoneRenderedSet));
console.log('NO_GRADECARD_BEFORE_DONE=' + result.assertions.no_gradecard_before_done);
console.log('FIRST_GRADECARD_TS_GEQ_DONE=' + result.assertions.first_gradecard_ts_geq_done, 'firstGC=' + firstGradeCard);
console.log('DONE_PAYLOAD=' + JSON.stringify(result.donePayload));
console.log('RENDERED_GC_NUMS=' + JSON.stringify(gcNums));
