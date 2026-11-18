const {test}=require('node:test');const assert=require('node:assert/strict');
const {readFileSync,mkdtempSync,rmSync}=require('node:fs');const {join}=require('node:path');const {tmpdir}=require('node:os');
const {JSDOM}=require('jsdom');const {createStore}=require('../src/store.cjs');
async function setup(t){
  const dir=mkdtempSync(join(tmpdir(),'pocket-dom-')),store=createStore(join(dir,'tasks.sqlite'));
  const dom=new JSDOM(readFileSync('ui/index.html','utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost'});
  const w=dom.window,d=w.document,modes=[];let modeCallback,undoTask;
  w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
  w.Element.prototype.setPointerCapture=function(){};
  w.pocket={list:async()=>store.list(),add:async x=>store.add(x),update:async(id,p)=>store.update(id,p),remove:async id=>{undoTask=store.remove(id);},undo:async()=>store.restore(undoTask),preferences:async()=>null,connections:async()=>({codex:'[mcp_servers.pocket-todo]',qwen:'{}',dataPath:'test',lastActivity:null}),expand:x=>{modes.push(x);modeCallback(x);},onMode:cb=>modeCallback=cb,drag:()=>{}};
  Object.assign(w.pocket,{snapshot:async after=>({...store.snapshot(),events:after===null?[]:store.events(after)}),growth:async()=>store.growth(),report:async m=>store.report(m),checkReports:async()=>store.checkReports(),stopSeries:async id=>store.stopSeries(id),skipPrevious:async id=>store.skipPrevious(id)});
  w.eval(readFileSync('ui/app.js','utf8'));await new Promise(r=>setTimeout(r,20));
  t.after(()=>{w.close();store.close();rmSync(dir,{recursive:true,force:true});});
  return {w,d,store,modes,tick:()=>new Promise(r=>setTimeout(r,30))};
}
test('editing title preserves a concurrent AI completion',async t=>{
  const {w,d,store,tick}=await setup(t);const item=store.add({title:'Original'});await w.eval('refresh(true)');
  d.querySelector('.task-title').click();store.update(item.id,{status:'completed',dueDate:'2026-12-01'});
  d.querySelector('#edit-title').value='Updated';d.querySelector('#edit-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  const saved=store.list()[0];assert.equal(saved.title,'Updated');assert.equal(saved.status,'completed');assert.equal(saved.dueDate,'2026-12-01');
});
test('empty focused composer and checkbox do not prevent leave collapse; unfinished text does',async t=>{
  const {w,d,modes}=await setup(t);const input=d.querySelector('#new-title');input.focus();
  d.documentElement.dispatchEvent(new w.Event('mouseleave'));await new Promise(r=>setTimeout(r,510));
  assert.equal(modes.at(-1),false);
  w.pocket.expand(true);d.documentElement.dispatchEvent(new w.Event('mouseenter'));input.value='还没写完';input.focus();
  d.documentElement.dispatchEvent(new w.Event('mouseleave'));await new Promise(r=>setTimeout(r,510));assert.equal(modes.at(-1),true);
});
test('dragging capsule suppresses subsequent click expansion',async t=>{
  const {w,d,modes}=await setup(t);w.pocket.expand(false);const capsule=d.querySelector('#capsule');
  capsule.dispatchEvent(new w.MouseEvent('pointerdown',{button:0,clientX:10,clientY:10,bubbles:true}));
  capsule.dispatchEvent(new w.MouseEvent('pointermove',{clientX:60,clientY:40,bubbles:true}));
  capsule.dispatchEvent(new w.MouseEvent('pointerup',{button:0,bubbles:true}));capsule.click();assert.equal(modes.at(-1),false);
});
test('IME Enter does not submit; Chinese text renders safely and persists',async t=>{
  const {w,d,store,tick}=await setup(t);const input=d.querySelector('#new-title');input.value='<script>中文待办</script>';
  const key=new w.KeyboardEvent('keydown',{key:'Enter',isComposing:true,cancelable:true,bubbles:true});input.dispatchEvent(key);assert.equal(key.defaultPrevented,true);assert.equal(store.list().length,0);
  d.querySelector('#add-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  assert.equal(store.list()[0].title,'<script>中文待办</script>');assert.equal(d.querySelectorAll('#groups script').length,0);assert.equal(d.querySelector('.task-title').textContent,'<script>中文待办</script>');
});
test('date selection stays expanded even when pointer leaves and window loses focus',async t=>{
  const {w,d,modes,store,tick}=await setup(t);
  const input=d.querySelector('#new-date');input.focus();input.click();
  d.documentElement.dispatchEvent(new w.Event('mouseleave'));w.dispatchEvent(new w.Event('blur'));
  await new Promise(r=>setTimeout(r,510));
  assert.equal(modes.includes(false),false,'date picker interaction must prevent collapse');
  assert.equal(d.querySelector('#date-dialog').open,true);
  const day=d.querySelector('#calendar-days button[data-date]');const chosen=day.dataset.date;day.click();
  assert.equal(input.value,chosen);assert.equal(d.querySelector('#date-dialog').open,false);
  d.querySelector('#new-title').value='选日期测试';d.querySelector('#add-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
  assert.equal(store.list()[0].dueDate,chosen);
});
test('date calendar handles leap days, month navigation, escape and clear without losing edit form',async t=>{
  const {w,d,store,tick}=await setup(t);
  const task=store.add({title:'Leap day',dueDate:'2028-02-29'});await w.eval('refresh(true)');d.querySelector('.task-title').click();
  d.querySelector('#edit-date').click();assert.equal(d.querySelectorAll('#calendar-days button[data-date]').length,29);
  d.querySelector('#calendar-next').click();assert.match(d.querySelector('#calendar-month').textContent,/2028.*3/);
  d.querySelector('#calendar-prev').click();d.querySelector('#date-dialog .close-dialog').click();
  assert.equal(d.querySelector('#edit-date').value,'2028-02-29');assert.equal(d.querySelector('#edit-dialog').open,true);
  d.querySelector('#edit-date').click();d.querySelector('#calendar-clear').click();assert.equal(d.querySelector('#edit-date').value,'');
  d.querySelector('#edit-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.equal(store.list()[0].dueDate,null);
});
test('row x cancels rather than deletes; cancelled tasks can be restored or deleted with undo',async t=>{
  const {w,d,store,tick}=await setup(t);const task=store.add({title:'Keep my history',category:'life',dueDate:'2026-12-01'});await w.eval('refresh(true)');
  const cancel=d.querySelector('.task-row button:last-child');assert.equal(cancel.textContent,'×');cancel.click();await tick();
  assert.equal(store.list().length,1);assert.equal(store.list()[0].status,'cancelled');assert.equal(store.list()[0].id,task.id);assert.equal(d.querySelectorAll('.task-row').length,0);
  d.querySelector('[data-tab=cancelled]').click();assert.equal(d.querySelector('.task-title').textContent,'Keep my history');
  d.querySelector('.task-restore').click();await tick();assert.equal(store.list()[0].status,'todo');assert.equal(store.list()[0].dueDate,'2026-12-01');
  d.querySelector('[data-tab=todo]').click();d.querySelector('.task-cancel').click();await tick();d.querySelector('[data-tab=cancelled]').click();
  d.querySelector('.task-delete').click();await tick();assert.equal(store.list().length,0);
  d.querySelector('#undo').click();await tick();assert.equal(store.list()[0].status,'cancelled');assert.equal(store.list()[0].id,task.id);
});
test('AI completion cheers once and holds the panel, reopening a completed task does not award again',async t=>{
  const {w,d,store}=await setup(t);const task=store.add({title:'AI done'});store.update(task.id,{status:'completed'});await w.eval('refresh(true)');await new Promise(r=>setTimeout(r,150));
  assert(d.querySelector('#companion').classList.contains('proud'));assert.equal(w.eval('Boolean(locked())'),true);
  d.querySelector('#celebrations').checked=false;d.querySelector('#celebrations').dispatchEvent(new w.Event('change'));assert.equal(w.eval('Boolean(locked())'),false);
  store.update(task.id,{status:'todo'});store.update(task.id,{status:'completed'});await w.eval('refresh(true)');await new Promise(r=>setTimeout(r,150));assert.equal(d.querySelector('#companion').classList.contains('cheering'),false);assert.equal(store.growth().lifetime,1);
});
test('weekly composer saves a repeat and growth report exports titles only when opted in',async t=>{
  const {w,d,store,tick}=await setup(t);d.querySelector('#new-repeat').click();d.querySelector('#repeat-kind').value='weekly';d.querySelector('#repeat-kind').dispatchEvent(new w.Event('change'));d.querySelector('#repeat-days input[value="1"]').checked=true;
  d.querySelector('#repeat-form').dispatchEvent(new w.Event('submit',{cancelable:true}));d.querySelector('#new-title').value='Read';d.querySelector('#add-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();assert.deepEqual(store.list()[0].repeat.days,[1]);
  d.querySelector('#growth').click();await tick();assert.equal(d.querySelector('#growth-dialog').open,true);assert.equal(d.querySelectorAll('.badge-card').length,7);let exported;w.pocket.exportReport=async p=>{exported=p;return '/example.png';};
  d.querySelector('#export-report').click();await tick();assert.equal(exported.includeTitles,false);d.querySelector('#export-titles').checked=true;d.querySelector('#export-report').click();await tick();assert.equal(exported.includeTitles,true);
});
test('growth report updates while open after an external completion',async t=>{
 const {w,d,store,tick}=await setup(t);d.querySelector('#growth').click();await tick();assert.equal(d.querySelector('.report-stat strong').textContent,'0');store.add({title:'External completion',status:'completed'});await w.eval('refresh(true)');assert.equal(d.querySelector('.report-stat strong').textContent,'1');assert.equal(d.querySelectorAll('.badge-card.earned').length,1);
});
