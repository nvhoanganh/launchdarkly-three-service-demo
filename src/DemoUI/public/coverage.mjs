export const scenarios = [
  ['000', 'Baseline'],
  ['001', 'Receipt change'],
  ['010', 'Risk change'],
  ['011', 'Deliberate incompatibility: Payment V1 + Risk V2 + Notification V2'],
  ['100', 'Payments change'],
  ['101', 'Payments + receipt'],
  ['110', 'Payments + risk'],
  ['111', 'Combined candidate']
];

// Verify evaluated flags AND business outputs. Requested bits alone are not evidence.
export function verifyResult(result) {
  const observed = result.trace.map(step => step.isV2 ? '1' : '0').join('');
  const expected = result.context.combination;
  const errors = [];
  if (result.error) errors.push(result.error);
  if (observed !== expected) errors.push(`Expected ${expected}; evaluated ${observed}`);
  if (result.trace.some(step => step.reason.includes('ERROR'))) errors.push('SDK fallback/error');

  const amount = result.context.amount;
  const riskDecision = expected[1] === '1' && amount >= 1000 ? 'review' : 'approve';
  const standardFee = Math.round(amount * 0.02 * 100) / 100;
  const discount = expected[0] === '1' ? Math.round(standardFee * 0.5 * 100) / 100 : 0;
  const fee = standardFee - discount;
  const total = amount + fee;
  const notification = expected[2] === '1'
    ? `Payment ${riskDecision === 'review' ? 'awaiting review' : 'approved'}: AUD ${amount.toFixed(2)}. Fee: AUD ${fee.toFixed(2)}; savings: AUD ${discount.toFixed(2)}; total: AUD ${total.toFixed(2)}.`
    : 'Payment received';
  if (result.data.amount !== amount || result.data.currency !== 'AUD') errors.push('Payment amount/currency mismatch');
  if (result.data.standardFee !== standardFee || result.data.feeDiscount !== discount || result.data.fee !== fee || result.data.total !== total) errors.push('Fee, savings or total mismatch');
  if (result.data.riskDecision !== riskDecision) errors.push('Risk outcome mismatch');
  if (result.data.notification !== notification) errors.push('Receipt mismatch');
  return {passed: errors.length === 0, observed, errors};
}
