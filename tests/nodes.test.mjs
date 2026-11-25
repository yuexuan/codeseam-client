import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineNode, hasNewerVersion, nodeAvailability } from '../src/services/nodes/model.ts';
import { createNodesPreview } from '../src/services/nodes/preview.ts';

test('daily selection requires a tested exit in the confirmed country', () => {
  const node = { status: 'connected', exitIp: '192.0.2.1', countryCode: 'SG' };
  assert.equal(nodeAvailability(node, 'sg').selectable, true);
  assert.equal(nodeAvailability(node, 'us').mismatch, true);
  for (const change of [{countryCode: null}, {exitIp: null}, {status: 'failed'}, {status:'queued'}, {status:'unknown'}]) {
    assert.equal(nodeAvailability({...node, ...change}, 'sg').selectable, false);
  }
  assert.equal(nodeAvailability(node, null).selectable, false);
});

test('formal identity and persisted country survive candidate changes and temporary test states', () => {
  const confirmed = {id:'base', name:'SG', countryCode:null, region:null, exitIp:null};
  const candidate = {id:'candidate', name:'SG', countryCode:'us', region:'美国', exitIp:'192.0.2.1'};
  const record = {confirmedAt:'1', baseline:{profile:{nodeId:'base', nodeName:'SG'}}, nodeCountry:{code:'sg',region:'新加坡'}};
  assert.equal(baselineNode(record, [candidate, confirmed]).id, 'base');
  assert.equal(baselineNode(record, [candidate, confirmed]).countryCode, 'sg');
  assert.equal(baselineNode(record, [candidate]), undefined);
});

test('single-node tests preserve unrelated node observations', async () => {
  const service = createNodesPreview('default');
  const before = await service.read();
  await service.test(['sg-backup-1']);
  const after = await service.read();
  assert.deepEqual(after.nodes.filter(node => node.id !== 'sg-backup-1'), before.nodes.filter(node => node.id !== 'sg-backup-1'));
  assert.equal(after.nodes.find(node => node.id === 'sg-backup-1').status, 'connected');
});

test('release comparison handles numeric versions and never offers a downgrade', () => {
  assert.equal(hasNewerVersion('v1.19.9', 'v1.19.34'), true);
  assert.equal(hasNewerVersion('v1.19.34', 'v1.19.9'), false);
  assert.equal(hasNewerVersion('v1.19.34', 'v1.19.34'), false);
  assert.equal(hasNewerVersion(undefined, 'v1.19.34'), false);
  assert.equal(hasNewerVersion('invalid', 'v1.19.34'), false);
});
