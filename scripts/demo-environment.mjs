import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {fileURLToPath} from 'node:url';

export function resolveDemoEnvironment(source) {
  const mode = source.ENV === 'prod' ? 'prod' : 'test';
  const name = mode === 'prod' ? 'LD_SDK_KEY_PROD' : 'LD_SDK_KEY_TEST';
  const key = source[name];
  if (typeof key !== 'string' || !key.trim()) throw new Error(`Missing ${name} for ${mode} mode. Set it privately in .env or the process environment.`);
  const environment = {...source, ENV: mode, LD_SDK_KEY: key};
  delete environment.LD_SDK_KEY_PROD;
  delete environment.LD_SDK_KEY_TEST;
  return environment;
}

export function loadDemoEnvironment() {
  const settings = new URL('../.env', import.meta.url);
  if (existsSync(settings)) loadEnvFile(fileURLToPath(settings));
  return resolveDemoEnvironment(process.env);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { loadDemoEnvironment(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
