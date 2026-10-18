import express from 'express';
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

app.post('/api/demo', async (request, response) => {
  const {paymentsV2, riskV2, notificationsV2, team = 'payments', scenario = 'high-value', cohort = 'test'} = request.body;
  if (![paymentsV2, riskV2, notificationsV2].every(value => typeof value === 'boolean') ||
      !['payments', 'risk', 'notifications'].includes(team) ||
      !['standard', 'high-value'].includes(scenario) || !['test', 'release', 'rollback'].includes(cohort)) {
    return response.status(400).json({error: 'Choose valid toggles, team, cohort and payment scenario.'});
  }

  // Toggles select a synthetic test context, NOT global flag settings.
  const combination = [paymentsV2, riskV2, notificationsV2].map(value => value ? '1' : '0').join('');
  const context = {
    key: `synthetic-${team}-${scenario}`,
    team,
    cohort,
    scenario,
    combination
  };

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
