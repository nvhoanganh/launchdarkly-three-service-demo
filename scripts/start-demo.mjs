import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const settings = new URL('../.env', import.meta.url);
// Load the local SDK key without displaying it or passing it to the UI.
if (existsSync(settings)) {
  loadEnvFile(fileURLToPath(settings));
}

// Fail clearly before starting anything if a previous demo still owns a port.
for (const port of [4310, 4311, 4312, 4313]) {
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the previous demo before running ./run.sh.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  }).catch(error => { console.error(error.message); process.exit(1); });
}
console.log('Starting demo in this terminal. Request logs appear below. Press Ctrl+C to stop.');

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach(child => child.kill('SIGTERM'));
  setTimeout(() => process.exit(code), 1500);
}

for (const service of ['PaymentService', 'RiskService', 'NotificationService']) {
  children.push(spawn('dotnet', [`src/${service}/bin/Debug/net8.0/${service}.dll`], {
    cwd: root, stdio: 'inherit', env: {...process.env}
  }));
}
const uiEnvironment = {...process.env};
delete uiEnvironment.LD_SDK_KEY;
delete uiEnvironment.LD_API_KEY;
children.push(spawn(process.execPath, ['src/DemoUI/server.mjs'], {
  cwd: root, stdio: 'inherit', env: uiEnvironment
}));

children.forEach(child => {
  child.on('error', () => {console.error('Unable to start a demo process.'); stop(1);});
  child.on('exit', code => {if (!stopping) { console.error(`Demo process ${child.pid} exited (${code}). Stopping all services.`); stop(code || 1); }});
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
