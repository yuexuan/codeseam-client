import test from 'node:test';
import assert from 'node:assert/strict';
import { startWorkspace } from '../src/services/runtime/startup.ts';

function fixture() {
  const calls = [];
  const details = { online: true, error: null, checks: ['exit', 'dns', 'browser'].map(id => ({id, status:'satisfied'})) };
  const record = { observation: {error:null, environment:details}, baseline: {id:'keep'} };
  const environment = {
    async start() { calls.push('start'); },
    async read() { calls.push('read'); return details; },
  };
  const workbench = { async refresh() { calls.push('refresh'); return record; } };
  return {calls, details, record, environment, workbench};
}

test('startup waits for the runtime, fresh checks and a workspace snapshot in order', async () => {
  const f = fixture();
  let release;
  f.environment.start = () => new Promise(resolve => { release = resolve; });
  const pending = startWorkspace(f.environment, f.workbench, stage => f.calls.push(stage));
  assert.deepEqual(f.calls, ['runtime']);
  release();
  assert.equal(await pending, f.record);
  assert.deepEqual(f.calls, ['runtime', 'connection', 'refresh', 'workspace']);
  assert.deepEqual(f.record.baseline, {id:'keep'});
});

test('a failed VM start blocks later operations and can be retried', async () => {
  const f = fixture();
  let attempt = 0;
  f.environment.start = async () => { if (++attempt === 1) throw new Error('VM start failed'); };
  await assert.rejects(startWorkspace(f.environment, f.workbench, () => {}), /VM start failed/);
  assert.deepEqual(f.calls, []);
  assert.equal(await startWorkspace(f.environment, f.workbench, () => {}), f.record);
});

test('pending node repair is a connection failure after runtime startup, and never unlocks the workspace', async () => {
  const f = fixture();
  f.details.error = '节点修复尚未完成，请打开节点编辑并重新应用';
  const stages = [];
  await assert.rejects(startWorkspace(f.environment, f.workbench, stage => stages.push(stage)), /节点修复尚未完成/);
  assert.deepEqual(stages, ['runtime', 'connection']);
  assert.deepEqual(f.calls, ['start', 'refresh']);
});

test('offline, failed, missing and drifted current evidence never unlocks the workspace', async () => {
  for (const id of ['exit', 'dns', 'browser']) {
    for (const status of ['pending', 'unknown', 'failed', undefined]) {
      const f = fixture();
      f.details.checks.find(c => c.id === id).status = status;
      await assert.rejects(startWorkspace(f.environment, f.workbench, () => {}), /尚未就绪/);
      assert.deepEqual(f.calls, ['start', 'refresh']);
    }
    const f = fixture();
    f.details.checks = f.details.checks.filter(c => c.id !== id);
    await assert.rejects(startWorkspace(f.environment, f.workbench, () => {}), /未取得有效检测结果/);
  }
  for (const details of [{online:false}, {error:'Guest channel failed'}]) {
    const f = fixture(); Object.assign(f.details, details);
    await assert.rejects(startWorkspace(f.environment, f.workbench, () => {}));
    assert.deepEqual(f.calls, ['start', 'refresh']);
  }
});

test('fresh workspace observation is required even after connection succeeds', async () => {
  for (const observation of [null, {error:'snapshot failed'}]) {
    const f = fixture(); f.record.observation = observation;
    await assert.rejects(startWorkspace(f.environment, f.workbench, () => {}));
  }
  const f = fixture();
  f.workbench.refresh = async () => { throw new Error('Read failed'); };
  await assert.rejects(startWorkspace(f.environment, f.workbench, () => {}), /Read failed/);
});

test('an offline snapshot or unconfirmed Native Runtime blocks entry', async () => {
  const f = fixture();
  f.record.observation.environment = {...f.details, online:false};
  const stages = [];
  await assert.rejects(startWorkspace(f.environment, f.workbench, stage => stages.push(stage)), /尚未连接/);
  assert.equal(stages.at(-1), 'connection');
  f.record.observation.environment = f.details;
  f.record.observation.runtime = {ready:true, confirmed:false};
  await assert.rejects(startWorkspace(f.environment, f.workbench, () => {}), /正式基线不一致/);
});
