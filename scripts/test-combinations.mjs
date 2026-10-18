import {verifyResult} from '../src/DemoUI/public/coverage.mjs';
// Runs against the already-started demo. Never loads or prints credentials.
const response = await fetch('http://127.0.0.1:4310/api/health');
const health = await response.json();
if (!response.ok) throw new Error('Start ./run.sh first.');
if (!health.every(service => service.sdkReady)) throw new Error('Wait for all three LaunchDarkly SDKs to initialize.');
console.log('Live LaunchDarkly combination and business-outcome checks');
let failed = false;
const rows = await Promise.all(Array.from({length: 8}, async (_, number) => {
  const requested = number.toString(2).padStart(3, '0');
  const response = await fetch('http://127.0.0.1:4310/api/demo', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({paymentsV2: requested[0] === '1', riskV2: requested[1] === '1', notificationsV2: requested[2] === '1'})
  });
  const result = await response.json();
  if (requested === '011' && response.status === 422 && result.error?.startsWith('Demo compatibility error:') && result.trace.map(step => step.isV2 ? '1' : '0').join('') === '011' && !result.trace.some(step => step.reason.includes('ERROR'))) {
    return {requested, actual: '011', status: 'EXPECTED COMPATIBILITY ERROR'};
  }
  if (!response.ok) {failed = true; return {requested, actual: 'ERROR', status: 'FAIL'};}
  const actual = result.trace.map(step => step.isV2 ? '1' : '0').join('');
  const pass = verifyResult(result).passed;
  if (!pass) failed = true;
  return {requested, actual, fee: result.data.fee, savings: result.data.feeDiscount, total: result.data.total, risk: result.data.riskDecision, status: pass ? 'PASS' : 'FAIL'};
}));
console.table(rows);
process.exitCode = failed ? 1 : 0;
