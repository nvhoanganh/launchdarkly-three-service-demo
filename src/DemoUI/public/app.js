import {resetRoute, replayRoute, failRoute} from './route.mjs';
import {scenarios as combinations, verifyResult} from './coverage.mjs';
const toggles = ['payments', 'risk', 'notifications'].map(id => document.getElementById(id));
const byId = id => document.getElementById(id);
const money = value => `AUD ${Number(value).toFixed(2)}`;
const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const selectedBits = () => toggles.map(toggle => toggle.checked ? '1' : '0').join('');
const actualBits = result => result.trace.map(step => step.isV2 ? '1' : '0').join('');
const hasSdkError = result => result.trace.some(step => step.reason.includes('ERROR'));
function selection(bits = selectedBits()) {
  return {
    paymentsV2: bits[0] === '1', riskV2: bits[1] === '1', notificationsV2: bits[2] === '1',
    amount: Number(byId('amount').value), cohort: byId('cohort').value
  };
}

function renderContextPreview() {
  const {amount, cohort} = selection();
  byId('context').textContent = JSON.stringify({
    kind: 'demo', key: `synthetic-payments-${amount}`, team: 'payments',
    cohort, amount, combination: selectedBits()
  }, null, 2);
}

const evidence = new Map();
let highlightedScenario = '';
const scopeKey = context => [context.amount, context.cohort].join('|');
const currentScope = () => scopeKey(selection());
function renderCoverage() {
  byId('coverage-scope').textContent = `${byId('amount').selectedOptions[0].text} · ${byId('cohort').selectedOptions[0].text}`;
  byId('matrix-results').innerHTML = combinations.map(([bits, description]) => {
    const saved = evidence.get(bits);
    const actual = saved?.result?.trace;
    const cells = [0, 1, 2].map(index => {
      const on = actual ? actual[index].isV2 : bits[index] === '1';
      return `<td><span class="flag-state ${on ? 'flag-on' : 'flag-off'} ${actual ? '' : 'planned'}">${on ? 'On' : 'Off'}</span>${actual ? '' : '<small>Requested</small>'}</td>`;
    }).join('');
    const outcome = saved?.result
      ? `<small class="actual-outcome">Fee ${money(saved.result.data.fee)} · saves ${money(saved.result.data.feeDiscount)}<br>Total ${money(saved.result.data.total)} · ${escape(saved.result.data.riskDecision)}<br>${escape(saved.result.data.notification)}</small>` : '';
    const status = !saved ? '<span class="evidence-pending">Not tested</span>'
      : saved.error ? `<span class="fail">Request failed</span><small>${escape(saved.error)}</small>`
      : `<span class="${saved.verification.passed ? 'pass' : 'fail'}">${saved.result.error ? 'Compatibility error' : saved.verification.passed ? 'Verified' : 'Mismatch'}</span><small>${saved.verification.passed ? 'Live SDK result' : escape(saved.verification.errors.join('; '))}</small>`;
    return `<tr class="${bits === highlightedScenario ? 'latest-result' : ''}"><td><strong>${bits}</strong></td>${cells}<td>${description}${outcome}</td><td>${status}</td></tr>`;
  }).join('');
}
function remember(result) {
  if (scopeKey(result.context) !== currentScope()) return;
  evidence.set(result.context.combination, {result, verification: verifyResult(result)});
  highlightedScenario = result.context.combination;
  renderCoverage();
}
for (const id of ['amount', 'cohort']) {
  byId(id).addEventListener('change', () => {
    renderContextPreview();
    evidence.clear();
    highlightedScenario = '';
    renderCoverage();
  });
}
renderCoverage();
resetRoute();
renderContextPreview();

async function send(options) {
  const response = await fetch('/api/demo', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(options)
  });
  const result = await response.json();
  if (!response.ok && !result.trace) throw new Error(result.error || 'The journey failed. Check all three services.');
  return result;
}

function render(result) {
  const requested = result.context.combination;
  const observed = actualBits(result);
  const expected = result.context.cohort === 'rollback' ? '000' : requested;
  renderContextPreview();
  byId('response').textContent = JSON.stringify(result, null, 2);
  remember(result);
}

async function busy(button, action) {
  button.disabled = true;
  try { await action(); }
  catch (error) { failRoute(error.message); }
  finally { button.disabled = false; }
}

toggles.forEach(toggle => toggle.addEventListener('change', () => {renderContextPreview();}));
byId('demo-form').addEventListener('submit', event => {
  event.preventDefault();
  busy(byId('submit'), async () => {
    const request = selection();
    resetRoute(true);
    byId('response').textContent = 'Waiting for response…';
    try {
      await new Promise(resolve => setTimeout(resolve, 200));
      const result = await send(request);
      await replayRoute(result);
      render(result);
    } catch (error) {
      failRoute(error.message);
      throw error;
    }
  });
});
byId('matrix').addEventListener('click', () => busy(byId('matrix'), async () => {
  const scope = selection();
  const startedScope = scopeKey(scope);
  evidence.clear();
  highlightedScenario = '';
  renderCoverage();
  await Promise.all(combinations.map(async ([requested]) => {
    try {
      const result = await send({...selection(requested), amount: scope.amount, cohort: scope.cohort});
      if (currentScope() === startedScope) {
        evidence.set(requested, {result, verification: verifyResult(result)});
        renderCoverage();
      }
    } catch (error) {
      if (currentScope() === startedScope) {
        evidence.set(requested, {error: error.message});
        renderCoverage();
      }
    }
  }));
}));

try {
  const response = await fetch('/api/health');
  const services = await response.json();
  if (!response.ok && !result.trace) throw new Error(services.error);
  const ready = services.every(service => service.sdkReady);
  byId('status').textContent = ready ? 'Live LaunchDarkly · all three SDKs initialized' : 'LaunchDarkly SDK not initialized';
  byId('status').classList.toggle('warning', !ready);
  renderCoverage();
} catch (error) {
  byId('status').textContent = error.message;
  byId('status').classList.add('warning');
}
