import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const settings = new URL('../.environment', import.meta.url);
// Load the local SDK key without displaying it or passing it to the UI.
if (existsSync(settings)) {
  loadEnvFile(fileURLToPath(settings));
}

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
  child.on('exit', code => {if (!stopping) stop(code || 1);});
});
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
