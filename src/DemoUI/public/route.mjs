const byId = id => document.getElementById(id);
const names = ['Web UI', 'Payment', 'Risk', 'Notification', 'Response'];
const logBuffers = [[], [], [], [], []];
const logOpen = new Set([1, 2, 3]);
let requestStarted = false;
const keys = ['', 'payments-v2', 'risk-v2', 'notifications-v2', ''];
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const money = value => `AUD ${Number(value).toFixed(2)}`;
function checkout(outcome, state, detail) {
  const data = outcome?.data;
  const failed = state.includes('route-failed') || Boolean(outcome?.error);
  const review = data?.riskDecision === 'review';
  const versions = [0, 1, 2].map(index => Boolean(outcome?.trace?.[index]?.isV2));
  const [paymentV2, riskV2, notificationV2] = versions;
  const bits = versions.map(value => value ? '1' : '0').join('');
  return `<div class="store-brand">NORTH<span> / Everyday essentials</span></div>
    <h3 class="checkout-title">${failed ? 'Checkout interrupted' : data ? review ? 'One more step' : 'Payment approved' : 'Your checkout'}</h3>
    <div class="basket-item"><span class="product-art" aria-hidden="true">◒</span><div><strong>Everyday carry bag</strong><small>Sand · Quantity 1</small></div></div>
    ${data ? `<div class="receipt-versions" aria-label="Actual service versions">${['Payment','Risk','Notification'].map((name,index)=>`<span class="${versions[index] ? 'version-new' : ''}">${name} V${versions[index] ? '2' : '1'}</span>`).join('')}<small>Evaluated ${bits}</small></div>
    <section class="receipt-payment ${paymentV2 ? 'payment-upgraded' : 'payment-standard'}"><div class="receipt-label">PAYMENT</div>
      ${paymentV2 ? `<div class="discount-ticket"><span>✦</span><div><strong>50% OFF</strong><small>processing fee</small></div><b>−${money(data.feeDiscount)}</b></div>` : '<div class="standard-fee-heading">Standard checkout</div>'}
      <dl class="response-money"><div><dt>Subtotal</dt><dd>${money(data.amount)}</dd></div><div><dt>Processing fee</dt><dd>${paymentV2 ? `<del>${money(data.standardFee)}</del> ` : ''}${money(data.fee)}</dd></div><div><dt>${failed ? 'Calculated total' : 'Total'}</dt><dd>${money(data.total)}</dd></div></dl>
    </section>
    <section class="receipt-risk ${failed ? 'risk-error' : riskV2 ? review ? 'risk-review' : 'risk-checked' : 'risk-baseline'}"><span class="decision-icon">${failed ? '!' : riskV2 ? review ? '◷' : '◇' : '✓'}</span><div><div class="receipt-label">RISK</div><strong>${failed ? 'Checkout could not complete' : riskV2 ? review ? 'Payment under review' : 'Adaptive check passed' : 'Payment approved'}</strong><small>${escape(failed ? outcome.error : data.riskPolicy)}</small></div></section>
    <section class="notification-card ${notificationV2 ? 'notification-rich' : 'notification-basic'}"><div class="receipt-label">${failed ? '⚠ NOTIFICATION STATUS' : notificationV2 ? '✉ DETAILED RECEIPT' : 'NOTIFICATION'}</div>
      ${notificationV2 && !failed ? `<div class="receipt-envelope">✉</div><strong>Your payment summary</strong><div class="receipt-mini-grid"><div><span>Amount</span><b>${money(data.amount)}</b></div><div><span>Savings</span><b>${money(data.feeDiscount)}</b></div><div><span>Total</span><b>${money(data.total)}</b></div></div>` : ''}
      <p>${escape(data.notification)}</p>
    </section>` : `<div class="checkout-status ${failed ? 'is-error' : ''}"><strong>${failed ? '⚠ Checkout unavailable' : 'Ready when you are'}</strong><span>${escape(failed ? detail : 'Place an order to see the API result here.')}</span></div>`}`;
}
function logContent(index) {
  return logBuffers[index].map(entry => `<span class="log-line ${entry.level === 'error' ? 'log-error' : ''}">${escape(entry.text)}</span>`).join('') || 'Waiting for requests…';
}
function serviceLogs(index) {
  if (index < 1 || index > 3) return '';
  return `<details class="service-logs" ${logOpen.has(index) ? 'open' : ''}><summary>Application logs</summary><pre data-log="${index}">${logContent(index)}</pre></details>`;
}
function node(index, state = 'waiting', detail = 'Waiting', outcome = null) {
  if (index === 4 && !outcome && !state.includes('route-failed')) {
    return '<article class="route-node checkout-result response-placeholder" data-hop="4" aria-label="Response placeholder"></article>';
  }
  if (index === 4) return `<article class="route-node checkout-result ${state}" data-hop="4"><strong>${names[index]}</strong>${checkout(outcome, state, detail)}</article>`;
  return `<article class="route-node ${state}" data-hop="${index}"><strong>${names[index]}</strong>${index === 0 || index === 4 ? '' : `<div class="route-track"><span class="route-packet"></span><span class="route-branch default-branch">${index > 0 && index < 4 ? 'Default' : index === 0 ? 'Request' : 'Outcome'}</span>${index > 0 && index < 4 ? '<span class="route-branch v2-branch">V2</span>' : ''}</div>`}<span class="route-detail">${escape(detail)}</span>${keys[index] ? `<code>${keys[index]}</code>` : ''}${serviceLogs(index)}</article>`;
}
export function resetRoute(pending = false) {
  if (pending) requestStarted = true;
  if (pending) logBuffers.forEach(buffer => { buffer.length = 0; });
  const controls = byId('web-ui-controls');
  byId('route-flow').innerHTML = names.map((_, index) => `${index ? '<span class="route-arrow" aria-hidden="true">→</span>' : ''}${node(index)}`).join('');
  if (controls) byId('route-flow').querySelector('[data-hop="0"]').append(controls);
  const responseNode = byId('route-flow').querySelector('[data-hop="4"]');
  if (!requestStarted || pending) {
    responseNode.classList.add('response-placeholder');
    responseNode.innerHTML = '';
    responseNode.setAttribute('aria-label', 'Response placeholder');
  }
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
