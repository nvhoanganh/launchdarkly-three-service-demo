import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildDemoContext} from '../src/DemoUI/demo-context.mjs';
const body = {paymentsV2: true, riskV2: false, notificationsV2: true, amount: 1250};
test('Test preserves stable coverage identity and requested attributes', () => {
  const context = buildDemoContext({...body, userKey: 'synthetic-new'}, 'test');
  assert.deepEqual(context, {key: 'synthetic-payments-1250', amount: 1250, combination: '101'});
  assert.equal(buildDemoContext(body).key, context.key);
});
test('Prod accepts a stable synthetic identity without overriding combination', () => {
  const context = buildDemoContext({...body, userKey: 'synthetic-ui-abc'}, 'prod');
  assert.equal(context.key, 'synthetic-ui-abc');
  assert.equal(buildDemoContext({...body, amount: 50, userKey: context.key}, 'prod').key, context.key);
  assert.equal(context.combination, '101');
});
test('reject non-synthetic and invalid identities', () => {
  for (const userKey of ['real-person', 'synthetic-<script>', 'synthetic-' + 'x'.repeat(100), 123]) {
    assert.throws(() => buildDemoContext({...body, userKey}, 'prod'));
  }
});
