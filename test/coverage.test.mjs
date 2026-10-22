import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scenarios, verifyResult} from '../src/DemoUI/public/coverage.mjs';

function resultFor(bits, scenario = 'high-value') {
  const actual = bits;
  const amount = scenario === 'high-value' ? 1250 : 50;
  const standardFee = amount * 0.02;
  const discount = actual[0] === '1' ? standardFee * 0.5 : 0;
  const fee = standardFee - discount;
  const total = amount + fee;
  const decision = actual[1] === '1' && amount >= 1000 ? 'review' : 'approve';
  return {
    context: {combination: bits, amount},
    trace: [...actual].map(bit => ({isV2: bit === '1', reason: 'RULE_MATCH'})),
    data: {
      amount, standardFee, feeDiscount: discount, fee, total, currency: 'AUD',
      riskDecision: decision,
      notification: actual[2] === '1' ? `Payment ${decision === 'review' ? 'awaiting review' : 'approved'}: AUD ${amount.toFixed(2)}. Fee: AUD ${fee.toFixed(2)}; savings: AUD ${discount.toFixed(2)}; total: AUD ${total.toFixed(2)}.` : 'Payment received'
    }
  };
}

test('all eight scenario labels and business outcomes verify across scenarios', () => {
  assert.equal(scenarios.length, 8);
  assert.equal(scenarios[0][1], 'Baseline');
  assert.equal(scenarios[7][1], 'Combined candidate');
  for (const [bits] of scenarios) {
    for (const scenario of ['standard', 'high-value']) {
      assert.equal(verifyResult(resultFor(bits, scenario)).passed, true);
    }
  }
});

test('matching evaluated flags do not hide an incorrect receipt or risk outcome', () => {
  const result = resultFor('111');
  result.data.notification = 'Payment received';
  result.data.riskDecision = 'approve';
  const check = verifyResult(result);
  assert.equal(check.observed, '111');
  assert.equal(check.passed, false);
  assert(check.errors.includes('Receipt mismatch'));
  assert(check.errors.includes('Risk outcome mismatch'));
});

test('an evaluated combination mismatch and SDK fallback are failures', () => {
  const result = resultFor('000');
  result.trace[0].isV2 = true;
  result.trace[1].reason = 'ERROR: CLIENT_NOT_READY';
  const check = verifyResult(result);
  assert.equal(check.passed, false);
  assert(check.errors.some(error => error.includes('evaluated 100')));
  assert(check.errors.includes('SDK fallback/error'));
});

test('fee discount and total are verified independently of feature labels', () => {
  const baseline = resultFor('000');
  const discounted = resultFor('100');
  assert.equal(baseline.data.fee, 25);
  assert.equal(baseline.data.total, 1275);
  assert.equal(discounted.data.fee, 12.5);
  assert.equal(discounted.data.feeDiscount, 12.5);
  assert.equal(discounted.data.total, 1262.5);
  discounted.data.fee = 25;
  assert(verifyResult(discounted).errors.includes('Fee, savings or total mismatch'));
});
