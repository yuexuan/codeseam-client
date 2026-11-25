import test from 'node:test';
import assert from 'node:assert/strict';
import { browserReady, networkChecks } from '../src/services/browser/model.ts';

const complete = () => ({proxyStatus:'satisfied', parametersStatus:'satisfied',
  shortcutStatus:'satisfied', verificationStatus:'satisfied', baselineStatus:'satisfied',
  compatibility:{status:'satisfied'}, timezoneStatus:'satisfied', targetTimezone:'Asia/Singapore',
  verification:{ok:true,observed:{timezone:'Asia/Singapore'}}, baselinePath:'browser-baseline.json'});
test('browser continuation requires every managed task and measured baseline', () => {
  assert.equal(browserReady(), false);
  assert.equal(browserReady(complete()), true);
  for (const key of ['proxyStatus','parametersStatus','shortcutStatus','verificationStatus','baselineStatus']) {
    assert.equal(browserReady({...complete(), [key]:'pending'}), false, key);
    assert.equal(browserReady({...complete(), [key]:undefined}), false, key);
  }
  assert.equal(browserReady({...complete(), verification:{ok:false}}), false);
  assert.equal(browserReady({...complete(), verification:undefined}), false);
  assert.equal(browserReady({...complete(), baselinePath:undefined}), false);
  assert.equal(browserReady({...complete(), verificationError:'failed recheck'}), false);
  assert.equal(browserReady({...complete(), compatibility:undefined}), false);
  assert.equal(browserReady({...complete(), compatibility:{status:'pending'}}), false);
  assert.equal(browserReady({...complete(), timezoneStatus:'pending'}), false);
  assert.equal(browserReady({...complete(), targetTimezone:undefined}), false);
  assert.equal(browserReady({...complete(), verification:{ok:true,observed:{timezone:'America/Los_Angeles'}}}), false);
});

test('daily network status requires measured evidence; policy never proves an unmeasured path', () => {
  const p = {...complete(), nodeName:'SG-01', verification:{ok:true,network:{dns:'configured',quic:'disabled'},observed:{timezone:'Asia/Singapore'}}};
  const checks = networkChecks(p, true);
  assert.deepEqual(checks.filter(c => c.status === 'satisfied').map(c => c.id), ['exit','webrtc']);
  for (const profile of [p, {...p,verificationError:'latest verification failed'}, {...p, verificationStatus:'pending'}, {...p, proxyStatus:'pending'}, {...p, verification:{...p.verification,ok:false}}]) {
    assert.ok(networkChecks(profile, false).every(c => c.status !== 'satisfied'));
  }
  assert.ok(networkChecks({...p,verificationError:'failed'}, true).every(c => c.status !== 'satisfied'));
  assert.ok(networkChecks({...p,verificationStatus:'pending'}, true).every(c => c.status !== 'satisfied'));
});
