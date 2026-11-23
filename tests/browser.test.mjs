import test from 'node:test';
import assert from 'node:assert/strict';
import { browserReady } from '../src/services/browser/model.ts';

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
