import http from 'k6/http';
import { check } from 'k6';
import exec from 'k6/execution';

const base = __ENV.BASE_URL || 'http://127.0.0.1:4310';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:4310)?$/.test(base)) throw new Error('Use localhost port 4310 only.');
const runId = Date.now();
const positiveInteger = (name, fallback) => {
  const value = Number(__ENV[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
};
const rate = positiveInteger('RATE', 2);
const preAllocatedVUs = positiveInteger('PRE_ALLOCATED_VUS', 2);
const maxVUs = positiveInteger('MAX_VUS', 4);
if (maxVUs < preAllocatedVUs) throw new Error('MAX_VUS must be at least PRE_ALLOCATED_VUS.');
export const options = {
  scenarios: { journey: { executor: 'constant-arrival-rate', rate,
    timeUnit: '1s', duration: __ENV.DURATION || '30s', preAllocatedVUs, maxVUs } },
  thresholds: { checks: ['rate>0.99'] }
};
export default function () {
  const userKey = `synthetic-k6-${runId}-${exec.vu.idInTest}-${exec.scenario.iterationInTest}`;
  const response = http.post(`${base}/api/demo`, JSON.stringify({
    paymentsV2: true, riskV2: true, notificationsV2: true,
    amount: 1250, userKey
  }), {headers: {'Content-Type': 'application/json'}, timeout: '30s'});
  check(response, {'journey returns expected demo status': r => r.status === 200 || (r.status === 500 && String(r.json('error')).startsWith('Synthetic demo fault:'))});
}
