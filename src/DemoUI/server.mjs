import express from 'express';
import {buildDemoContext} from './demo-context.mjs';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const app = express();
app.use(express.json({limit: '8kb'}));
app.use(express.static(fileURLToPath(new URL('./public', import.meta.url))));

// The UI server never evaluates flags or needs the LaunchDarkly SDK key.
app.get('/api/health', async (_request, response) => {
  try {
    const services = await Promise.all([4311, 4312, 4313].map(async port => {
      const result = await fetch(`http://127.0.0.1:${port}/health`, {signal: AbortSignal.timeout(2000)});
      return result.json();
    }));
    response.json(services);
  } catch {
    response.status(503).json({error: 'Start all three .NET services with ./run.sh.'});
  }
});

// Read-only SSE proxy to each independent service; closed tabs cancel upstream streams.
app.get('/api/logs/:service', async (request, response) => {
  const port = {payment: 4311, risk: 4312, notification: 4313}[request.params.service];
  if (!port) return response.sendStatus(404);
  const controller = new AbortController();
  response.on('close', () => controller.abort());
  try {
    const upstream = await fetch(`http://127.0.0.1:${port}/logs`, {signal: controller.signal});
    if (!upstream.ok) return response.sendStatus(502);
    response.set({'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'});
    response.flushHeaders();
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
    try {
      for await (const chunk of upstream.body) {
        if (!response.write(chunk)) { controller.abort(); break; }
      }
    } finally { clearInterval(heartbeat); }
  } catch {
    if (!response.headersSent) response.sendStatus(502);
  } finally { response.end(); }
});

// Report the actual running PaymentService configuration, never SDK credentials.
app.get('/api/config', async (_request, response) => {
  try {
    const upstream = await fetch('http://127.0.0.1:4311/health', {signal: AbortSignal.timeout(2000)});
    const health = await upstream.json();
    response.set('Cache-Control', 'no-store').json({
      environment: ['prod', 'test'].includes(health.environment) ? health.environment : 'unknown',
      failureRate: health.failureRate,
      contextKind: health.contextKind || 'unknown'
    });
  } catch { response.status(503).json({environment: 'unknown', contextKind: 'unknown', error: 'Payment service configuration unavailable'}); }
});

app.post('/api/demo', async (request, response) => {
  const {paymentsV2, riskV2, notificationsV2, amount = 1250} = request.body;
  if (![paymentsV2, riskV2, notificationsV2].every(value => typeof value === 'boolean') ||
      !Number.isFinite(amount) || amount <= 0 || amount > 1000000 || Math.abs(amount * 100 - Math.round(amount * 100)) > 0.000001) {
    return response.status(400).json({error: 'Choose valid toggles and payment amount.'});
  }

  // Toggles select a synthetic test context, NOT global flag settings.
  let context;
  try { context = buildDemoContext(request.body, process.env.ENV); }
  catch (error) { return response.status(400).json({error: error.message}); }


  try {
    const result = await fetch('http://127.0.0.1:4311/process', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({requestId: randomUUID(), context, data: {}, trace: []}),
      signal: AbortSignal.timeout(25000)
    });
    response.status(result.status).json(await result.json());
  } catch {
    response.status(502).json({error: 'PaymentService is unavailable or the journey timed out.'});
  }
});

app.use((error, _request, response, _next) => {
  response.status(400).json({error: 'Request must contain valid JSON within the size limit.'});
});

app.listen(4310, '127.0.0.1', () => console.log('DemoUI: http://127.0.0.1:4310'));
