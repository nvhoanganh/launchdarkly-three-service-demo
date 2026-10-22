const byId = id => document.getElementById(id);
const names = ['Web UI', 'Payment', 'Risk', 'Notification', 'Response'];
const logBuffers = [[], [], [], [], []];
const logOpen = new Set([1, 2, 3]);
const keys = ['', 'payments-v2', 'risk-v2', 'notifications-v2', ''];
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const money = value => `AUD ${Number(value).toFixed(2)}`;
function breakdown(data) {
  return `<dl class="response-money">${[
    ['Payment amount', data.amount], ['Fee charged', data.fee],
    ['Customer saves', data.feeDiscount], ['Total charged', data.total]
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${money(value)}</dd></div>`).join('')}</dl><p class="response-fee">${data.feeDiscount > 0 ? 'Payment V2: 50% discount on the standard fee.' : 'Payment V1: standard 2% fee; no discount.'}</p>`;
}
function logContent(index) {
  return logBuffers[index].map(entry => `<span class="log-line ${entry.level === 'error' ? 'log-error' : ''}">${escape(entry.text)}</span>`).join('') || 'Waiting for requests…';
}
function serviceLogs(index) {
  if (index < 1 || index > 3) return '';
  return `<details class="service-logs" ${logOpen.has(index) ? 'open' : ''}><summary>Application logs</summary><pre data-log="${index}">${logContent(index)}</pre></details>`;
}
function node(index, state = 'waiting', detail = 'Waiting', outcome = null) {
  return `<article class="route-node ${state}" data-hop="${index}"><strong>${names[index]}</strong>${index === 0 || index === 4 ? '' : `<div class="route-track"><span class="route-packet"></span><span class="route-branch default-branch">${index > 0 && index < 4 ? 'Default' : index === 0 ? 'Request' : 'Outcome'}</span>${index > 0 && index < 4 ? '<span class="route-branch v2-branch">V2</span>' : ''}</div>`}<span class="route-detail">${escape(detail)}</span>${outcome ? `<div class="route-outcome"><strong>${escape(outcome.error || outcome.data.notification)}</strong><p>Risk: ${escape(outcome.data.riskDecision)} · ${escape(outcome.data.riskPolicy)}</p>${breakdown(outcome.data)}</div>` : ''}${keys[index] ? `<code>${keys[index]}</code>` : ''}${serviceLogs(index)}</article>`;
}
export function resetRoute(pending = false) {
  if (pending) logBuffers.forEach(buffer => { buffer.length = 0; });
  const controls = byId('web-ui-controls');
  byId('route-flow').innerHTML = names.map((_, index) => `${index ? '<span class="route-arrow" aria-hidden="true">→</span>' : ''}${node(index)}`).join('');
  if (controls) byId('route-flow').querySelector('[data-hop="0"]').append(controls);
  byId('route-status').textContent = pending ? 'Waiting for the service response…' : 'Submit a payment to follow its journey.';
  if (pending) byId('route-flow').querySelector('[data-hop="0"]').classList.add('active');
}
export function failRoute(message) {
  byId('route-status').textContent = 'Request failed';
  byId('route-flow').querySelector('[data-hop="4"]').outerHTML = node(4, 'route-failed', message);
}
export async function replayRoute(result) {
  resetRoute();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  for (let index = 0; index < names.length; index++) {
    const step = index > 0 && index < 4 ? result.trace[index - 1] : null;
    const state = step ? step.isV2 ? 'selected-v2' : 'selected-default' : index === 4 && result.error ? 'route-failed' : 'route-complete';
    const detail = step ? '' : index === 0 ? `Context ${result.context.combination}` : result.error ? `HTTP error · ${result.error.startsWith('Synthetic demo fault:') ? 'synthetic injected failure' : 'journey failure'}` : `Success · AUD ${Number(result.data.total).toFixed(2)}`;
    const target = byId('route-flow').querySelector(`[data-hop="${index}"]`);
    if (index === 0) {
      // Keep the live form and its handlers intact throughout replay.
      target.className = `route-node ${state} active`;
      target.querySelector('.route-detail').textContent = detail;
    } else target.outerHTML = node(index, `${state} active`, detail, index === 4 ? result : null);
    byId('route-status').textContent = `Replay: ${names[index]}${step ? ' evaluated its flag' : ''}`;
    if (index) byId('route-flow').querySelectorAll('.route-arrow')[index - 1].classList.add('travelled');
    if (!reduced) await pause(400);
    byId('route-flow').querySelector(`[data-hop="${index}"]`).classList.remove('active');
  }
  byId('route-status').textContent = '';
}

// Keep log buffers separate from the replay so animation never discards incoming events.
const flow = byId('route-flow');
flow.addEventListener('toggle', event => {
  if (!event.target.matches('.service-logs')) return;
  const index = Number(event.target.closest('[data-hop]').dataset.hop);
  if (event.target.open) logOpen.add(index); else logOpen.delete(index);
}, true);
for (const [offset, service] of ['payment', 'risk', 'notification'].entries()) {
  const index = offset + 1;
  const stream = new EventSource(`/api/logs/${service}`);
  stream.onmessage = event => {
    const entry = JSON.parse(event.data);
    logBuffers[index].push({level: entry.level, text: `${new Date(entry.time).toLocaleTimeString()} [${entry.requestId}] ${entry.message}`});
    if (logBuffers[index].length > 100) logBuffers[index].shift();
    const output = flow.querySelector(`[data-log="${index}"]`);
    if (output) { output.innerHTML = logContent(index); output.scrollTop = output.scrollHeight; }
  };
  window.addEventListener('pagehide', () => stream.close(), {once: true});
}
