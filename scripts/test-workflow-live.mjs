const BASE = `http://127.0.0.1:${process.env.AERYX_PORT || 23799}`;
const MARKER = 'WORKFLOW PROOF COMPLETE';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let step = 0;
const pass = (msg) => console.log(`  ✔ ${++step}. ${msg}`);
function fail(msg) {
  console.error(`  ✘ FAIL at step ${step + 1}: ${msg}`);
  process.exit(1);
}

console.log(`live proof against ${BASE}\n`);

const status = await call('GET', '/status').catch(() => null);
if (!status || status.status !== 200) fail('daemon is not running — start it with: npm run daemon');
pass(`daemon alive (brain: ${status.data.brain}, chain: ${status.data.chainIntact === null ? 'no data' : status.data.chainIntact ? 'intact' : 'BROKEN'})`);

const proposed = await call('POST', '/workflows', {
  name: 'workflow proof',
  purpose: 'live proof for the stop-and-show gate',
  prompt: `Reply with exactly the words: ${MARKER}`,
  schedule: 'manual',
  status: 'proposed',
  source: 'ui',
});
if (proposed.status !== 201) fail(`propose: ${proposed.status} ${JSON.stringify(proposed.data)}`);
const wf = proposed.data.workflow;
if (wf.status !== 'proposed' || wf.nextRunTs !== null) fail(`proposal is armed: ${JSON.stringify(wf)}`);
pass(`proposed #${wf.id} "${wf.name}" — status ${wf.status}, armed: no`);

const runProposed = await call('POST', `/workflows/${wf.id}/run`);
if (runProposed.status === 202) fail('run-now executed a PROPOSED workflow — governance hole');
pass(`run-now on the proposal refused (${runProposed.status}: ${runProposed.data.error})`);
const listed = await call('GET', '/workflows');
if (!listed.data.workflows.some((w) => w.id === wf.id)) fail('proposal missing from the list');
pass('proposal visible on the workflows surface');

const approved = await call('POST', `/workflows/${wf.id}/approve`);
if (approved.status !== 200 || approved.data.workflow.status !== 'active') {
  fail(`approve: ${approved.status} ${JSON.stringify(approved.data)}`);
}
pass('approved — status active');

const fired = await call('POST', `/workflows/${wf.id}/run`);
if (fired.status !== 202) fail(`run: ${fired.status} ${JSON.stringify(fired.data)} — is the brain built and running?`);
pass(`run fired (runId ${fired.data.runId}) — waiting for the brain to complete it…`);

let run = null;
for (let i = 0; i < 100; i++) {
  await sleep(3000);
  const { data } = await call('GET', `/workflows/${wf.id}/runs?limit=5`);
  run = (data.runs ?? []).find((r) => r.id === fired.data.runId);
  if (run?.finishedTs) break;
  if (i % 10 === 9) console.log(`    …still running (${(i + 1) * 3}s)`);
}
if (!run?.finishedTs) fail('run did not complete within 5 minutes');
if (run.outcome !== 'ok') fail(`run finished ${run.outcome}: ${run.detail}`);
if (!String(run.detail ?? '').toUpperCase().includes('PROOF')) {
  console.log(`    note: reply was "${run.detail}" (marker phrasing may vary — outcome ok counts)`);
}
pass(`run completed ok — reply: "${String(run.detail).slice(0, 80)}"`);

const audit = await call('GET', '/audit?limit=100');
if (audit.data.chainIntact !== true) fail(`audit chain not intact after the run`);
const rows = audit.data.rows.filter((r) => r.tool === 'workflow' && String(r.detail).includes(`#${wf.id}`));
for (const verdict of ['proposed', 'approved', 'run-start', 'run-ok']) {
  if (!rows.some((r) => r.verdict === verdict)) fail(`no '${verdict}' row in the chain (got: ${rows.map((r) => r.verdict).join(', ')})`);
}
pass(`chain intact, with proposed → approved → run-start → run-ok rows for #${wf.id}`);

const deleted = await call('POST', `/workflows/${wf.id}/delete`);
if (deleted.status !== 200) fail(`delete: ${deleted.status}`);
const after = await call('GET', '/workflows');
if (after.data.workflows.some((w) => w.id === wf.id)) fail('workflow still listed after delete');
pass('deleted and gone from the surface (the chain keeps the history)');

console.log(`\nALL PASS — workflow proposed → approved → run → logged, chain intact.`);
