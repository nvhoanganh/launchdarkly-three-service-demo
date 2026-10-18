import {test, before} from 'node:test';
import assert from 'node:assert/strict';

const expectedServices = ['PaymentService', 'RiskService', 'NotificationService'];

// These checks use the already-running demo. They never load credentials or edit flags.
before(async () => {
  const response = await fetch('http://127.0.0.1:4310/api/health');
  assert.equal(response.status, 200, 'Start ./run.sh before npm test.');
  const health = await response.json();
  assert.deepEqual(health.map(service => service.service), expectedServices);
  assert(health.every(service => service.mode === 'live' && service.sdkReady));
  assert.equal(new Set(health.map(service => service.processId)).size, 3);
});

function options(bits, scenario = 'high-value', team = 'payments', cohort = 'test') {
  return {paymentsV2: bits[0] === '1', riskV2: bits[1] === '1', notificationsV2: bits[2] === '1', scenario, team, cohort};
}
async function run(bits, scenario, team, cohort) {
  const response = await fetch('http://127.0.0.1:4310/api/demo', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(options(bits, scenario, team, cohort))
  });
  assert.equal(response.status, bits === '011' && cohort !== 'rollback' ? 422 : 200);
  const result = await response.json();
  assert(!result.trace.some(step => step.reason.includes('ERROR')), 'SDK evaluation returned a fallback error.');
  return result;
}
const actual = result => result.trace.map(step => step.isV2 ? '1' : '0').join('');

test('all eight combinations across both payment scenarios cross three real .NET HTTP services', async () => {
  for (const scenario of ['standard', 'high-value']) {
    await Promise.all(Array.from({length: 8}, async (_, number) => {
      const bits = number.toString(2).padStart(3, '0');
      const result = await run(bits, scenario);
      assert.equal(actual(result), bits);
      assert.deepEqual(result.trace.map(step => step.service), expectedServices);
      assert.deepEqual(result.trace.map(step => step.flagKey), ['payments-v2', 'risk-v2', 'notifications-v2']);
      assert.equal(new Set(result.trace.map(step => step.processId)).size, 3);
      result.trace.forEach(step => assert.deepEqual(step.context, result.context));
      assert.equal(result.data.riskDecision, bits[1] === '1' && scenario === 'high-value' ? 'review' : 'approve');
      const standardFee = result.data.amount * 0.02;
      const discount = bits[0] === '1' ? standardFee * 0.5 : 0;
      const fee = standardFee - discount;
      const total = result.data.amount + fee;
      assert.equal(result.data.standardFee, standardFee);
      assert.equal(result.data.feeDiscount, discount);
      assert.equal(result.data.fee, fee);
      assert.equal(result.data.total, total);
      if (bits === '011') {
        assert.match(result.error, /Demo compatibility error/);
        assert.equal(result.data.notification, 'Receipt not sent: incompatible service combination.');
        return;
      }
      assert.equal(result.data.notification, bits[2] === '0' ? 'Payment received' : `Payment ${result.data.riskDecision === 'review' ? 'awaiting review' : 'approved'}: AUD ${result.data.amount.toFixed(2)}. Fee: AUD ${fee.toFixed(2)}; savings: AUD ${discount.toFixed(2)}; total: AUD ${total.toFixed(2)}.`);
    }));
  }
});

test('60 concurrent team requests keep their context and combination isolated', async () => {
  await Promise.all(Array.from({length: 60}, async (_, index) => {
    const [team, bits] = [['payments', '100'], ['risk', '110'], ['notifications', '111']][index % 3];
    const result = await run(bits, 'high-value', team);
    assert.equal(actual(result), bits);
    assert.equal(result.context.team, team);
    result.trace.forEach(step => assert.deepEqual(step.context, result.context));
  }));
});

test('rollback cohort returns baseline without restarting service binaries', async () => {
  const released = await run('111', 'high-value', 'payments', 'release');
  const rollback = await run('111', 'high-value', 'payments', 'rollback');
  assert.equal(actual(released), '111');
  assert.equal(actual(rollback), '000');
  assert.equal(released.context.key, rollback.context.key);
  assert.deepEqual(released.trace.map(step => step.processId), rollback.trace.map(step => step.processId));
});

test('UI rejects invalid toggles and each .NET boundary rejects invalid synthetic context', async () => {
  const response = await fetch('http://127.0.0.1:4310/api/demo', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({paymentsV2: 'true', riskV2: false, notificationsV2: false})
  });
  assert.equal(response.status, 400);
  for (const port of [4311, 4312, 4313]) {
    const rejected = await fetch(`http://127.0.0.1:${port}/process`, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({context: {key: 'real-user', team: 'payments', scenario: 'high-value', cohort: 'test', combination: '111'}})
    });
    assert.equal(rejected.status, 400);
  }
});

test('DemoUI serves its toggles frontend', async () => {
  const response = await fetch('http://127.0.0.1:4310/');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Notification V2/);
});

test('curl header profiles remain explicit and independently evaluable', async () => {
  const response = await fetch('http://127.0.0.1:4311/demo', {headers: {'X-Demo-User': 'team-risk'}});
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(actual(result), '110');
  assert.deepEqual(result.trace.map(step => step.flagKey), ['payments-v2', 'risk-v2', 'notifications-v2']);
});
