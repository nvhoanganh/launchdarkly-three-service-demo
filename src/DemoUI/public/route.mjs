const byId = id => document.getElementById(id);
const names = ['Web UI', 'Payment', 'Risk', 'Notification', 'Response'];
const keys = ['', 'payments-v2', 'risk-v2', 'notifications-v2', ''];
const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function node(index, state = 'waiting', detail = 'Waiting') {
  return `<article class="route-node ${state}" data-hop="${index}"><strong>${names[index]}</strong><div class="route-track"><span class="route-packet"></span><span class="route-branch default-branch">${index > 0 && index < 4 ? 'Default' : index === 0 ? 'Request' : 'Outcome'}</span>${index > 0 && index < 4 ? '<span class="route-branch v2-branch">V2</span>' : ''}</div><span class="route-detail">${escape(detail)}</span>${keys[index] ? `<code>${keys[index]}</code>` : ''}</article>`;
}
export function resetRoute(pending = false) {
  byId('route-flow').innerHTML = names.map((_, index) => `${index ? '<span class="route-arrow" aria-hidden="true">→</span>' : ''}${node(index)}`).join('');
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
    const detail = step ? `${step.isV2 ? 'V2' : 'Default'} logic ran` : index === 0 ? `Context ${result.context.combination}` : result.error ? 'HTTP 422 · compatibility error' : `Success · AUD ${Number(result.data.total).toFixed(2)}`;
    byId('route-flow').querySelector(`[data-hop="${index}"]`).outerHTML = node(index, `${state} active`, detail);
    byId('route-status').textContent = `Replay: ${names[index]}${step ? ' evaluated its flag' : ''}`;
    if (index) byId('route-flow').querySelectorAll('.route-arrow')[index - 1].classList.add('travelled');
    if (!reduced) await pause(650);
    byId('route-flow').querySelector(`[data-hop="${index}"]`).classList.remove('active');
  }
  byId('route-status').textContent = result.error ? 'Journey ended with a compatibility error.' : 'Journey complete. Actual evaluations shown below.';
}
