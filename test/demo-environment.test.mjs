import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {resolveDemoEnvironment} from '../scripts/demo-environment.mjs';

test('named keys only, safe default, no unused keys forwarded', () => {
  for (const [ENV, expected] of [['prod','dummy-prod'], ['test','dummy-test'], [undefined,'dummy-test']]) {
    const result = resolveDemoEnvironment({ENV, LD_SDK_KEY_PROD:'dummy-prod', LD_SDK_KEY_TEST:'dummy-test', LD_SDK_KEY:'old-dummy'});
    assert.equal(result.LD_SDK_KEY, expected);
    assert.equal(result.LD_SDK_KEY_PROD, undefined);
    assert.equal(result.LD_SDK_KEY_TEST, undefined);
  }
  for (const ENV of ['test','prod']) {
    assert.throws(() => resolveDemoEnvironment({ENV,LD_SDK_KEY:'old-dummy'}), /Missing LD_SDK_KEY_/);
    assert.throws(() => resolveDemoEnvironment({ENV,LD_SDK_KEY_TEST:' ',LD_SDK_KEY_PROD:''}), /Missing LD_SDK_KEY_/);
  }
});

test('mocked launcher checks mode precedence, early failure and no secret output', () => {
  const root=mkdtempSync(join(tmpdir(),'demo-launcher-'));
  try {
    mkdirSync(join(root,'scripts')); mkdirSync(join(root,'bin'));
    mkdirSync(join(root,'src/DemoUI/node_modules'), {recursive:true});
    copyFileSync(new URL('../run.sh',import.meta.url),join(root,'run.sh'));
    copyFileSync(new URL('../scripts/demo-environment.mjs',import.meta.url),join(root,'scripts/demo-environment.mjs'));
    writeFileSync(join(root,'scripts/start-demo.mjs'), `import {loadDemoEnvironment} from './demo-environment.mjs'; const e=loadDemoEnvironment(); if(e.ENV!==process.env.EXPECT_MODE || e.LD_SDK_KEY!==process.env.EXPECT_KEY) process.exit(9); console.log('validated');`);
    for(const command of ['dotnet','npm']) writeFileSync(join(root,'bin',command),'#!/bin/sh\necho mocked-command\n', {mode:0o755});
    const env={PATH:join(root,'bin')+':'+process.env.PATH, HOME:root};
    const run=(args,extra={})=>spawnSync('/bin/bash',[join(root,'run.sh'),...args],{env:{...env,...extra},encoding:'utf8'});
    writeFileSync(join(root,'.env'),'ENV=test\nLD_SDK_KEY_TEST=dummy-test\nLD_SDK_KEY_PROD=dummy-prod\n');
    for(const [args,extra,mode] of [[[],{},'test'],[['prod'],{},'prod'],[['test'],{ENV:'prod'},'test'],[[],{ENV:'prod'},'prod']]) {
      const r=run(args,{...extra,EXPECT_MODE:mode,EXPECT_KEY:'dummy-'+mode});
      assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/validated/);
      assert.doesNotMatch(r.stdout+r.stderr,/dummy-/);
    }
    writeFileSync(join(root,'.env'),'ENV=test\nLD_SDK_KEY=old-dummy\n');
    for(const args of [[],['prod'],['invalid'],['prod','extra']]) {
      const r=run(args); assert.notEqual(r.status,0);
      assert.equal(r.stdout,''); assert.doesNotMatch(r.stderr,/old-dummy/);
    }
  } finally {rmSync(root,{recursive:true,force:true});}
});
