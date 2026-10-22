import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../src/DemoUI/public/index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../src/DemoUI/public/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
test('single controls, accessible external toggles, no cohort dropdown',()=>{
 const ids=[...html.matchAll(/id="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length);
 assert.ok(!ids.includes('cohort'));
 assert.match(html,/<details id="test-harness" class="test-harness" hidden>/);
 assert.doesNotMatch(html,/<details[^>]*id="test-harness"[^>]*\bopen\b/);
 assert.match(html,/<summary>Test Harness<\/summary>/);
 assert.ok(html.indexOf('id="test-harness"') > html.indexOf('id="web-ui-controls"'));
 assert.ok(html.indexOf('id="test-harness"') < html.indexOf('</form>'));
 assert.doesNotMatch(html,/<aside/);
 assert.equal([...html.matchAll(/role="switch" form="demo-form"/g)].length,3);
 assert.match(html,/<div id="web-ui-controls"><form id="demo-form">/);
});
for(const environment of ['test','prod']) test(`${environment} controls follow server mode and omit removed context attributes`,async()=>{
 const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],{hidden:true,checked:false,value:'1250',selectedOptions:[{text:'AUD 1,250'}],classList:{toggle(){},add(){}},listeners:{},addEventListener(event,handler){this.listeners[event]=handler;}}]));
 let sent, serial=0;
 const context={document:{getElementById:id=>elements.get(id),querySelector:()=>({classList:{toggle(){}}})},
 combinations:[],verifyResult:()=>({passed:true}),resetRoute(){},replayRoute:async()=>{},failRoute(){},
 crypto:{randomUUID:()=>`id-${++serial}`},setTimeout:fn=>fn(),
 fetch:async(url,options)=>{
  if(url==='/api/health')return{ok:true,json:async()=>[{sdkReady:true}]};
  if(url==='/api/config')return{ok:true,json:async()=>({environment,contextKind:'user'})};
  sent=JSON.parse(options.body);return{ok:false,json:async()=>({error:'mock stops before runtime'})};
 }};
 await vm.runInNewContext(`(async()=>{${source}})()`,context);
 assert.equal(elements.get('test-harness').hidden,environment!=='test');
 assert.equal(elements.get('test-coverage').hidden,environment!=='test');
 assert.equal(elements.get('prod-controls').hidden,environment!=='prod');
 if(environment==='prod')elements.get('randomize-user').listeners.click();
 const displayed=elements.get('current-user-id').textContent;
 elements.get('demo-form').listeners.submit({preventDefault(){}});
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(sent.cohort,undefined);assert.equal(sent.team,undefined);assert.equal(sent.amount,1250);
 assert.equal(sent.userKey,environment==='prod'?displayed:undefined);
 assert.equal(elements.get('current-user-id').textContent,displayed);
});
