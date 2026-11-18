const {test}=require('node:test'),assert=require('node:assert/strict');
const {mkdtempSync,rmSync,existsSync}=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {createStore}=require('../src/store.cjs');
const {nextDate,plusDay}=require('../src/recurrence.cjs');
function setup(t,date='2026-01-31T12:00:00'){let time=new Date(date);const dir=mkdtempSync(join(tmpdir(),'pocket-growth-')),file=join(dir,'test.sqlite');const store=createStore(file,{now:()=>time});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return {store,file,set:s=>time=new Date(s)};}
test('recurrence clamps short months, leap years and skips weekends',()=>{
 assert.equal(nextDate('2028-02-01',{kind:'monthly',day:31}),'2028-02-29');assert.equal(nextDate('2027-02-01',{kind:'monthly',day:30}),'2027-02-28');
 assert.equal(nextDate('2026-11-21',{kind:'weekdays'}),'2026-11-23');assert.equal(nextDate('2026-11-18',{kind:'weekly',days:[1,5]}),'2026-11-20');assert.equal(plusDay('2026-12-31'),'2027-01-01');
});
test('completion month follows actual completion; reopen and re-complete cannot farm badges',t=>{
 const {store:s,set}=setup(t);const a=s.add({title:'A',dueDate:'2025-01-01'});s.update(a.id,{status:'completed'});assert.equal(s.report('2026-01').total,1);assert.equal(s.growth().lifetime,1);assert.equal(s.growth().badges.length,1);
 s.update(a.id,{status:'todo'});assert.equal(s.report('2026-01').total,0);set('2026-02-01T12:00:00');s.update(a.id,{status:'completed'});assert.equal(s.report('2026-01').total,0);assert.equal(s.report('2026-02').total,1);assert.equal(s.growth().lifetime,1);assert.equal(s.growth().badges.length,1);
 s.update(a.id,{title:'renamed'});assert.equal(s.report('2026-02').total,1);const removed=s.remove(a.id);assert.equal(s.report('2026-02').total,0);assert.equal(s.growth().badges.length,1);s.restore(removed);assert.equal(s.report('2026-02').total,1);
});
test('repeat instances persist, cancel is per-instance, rule changes only future dates, stop works',t=>{
 const {store:s,set,file}=setup(t,'2026-11-18T12:00:00');const a=s.add({title:'Move',dueDate:'2026-11-18',repeat:{kind:'daily'},requestId:'unique'});
 assert.equal(s.add({title:'Move',dueDate:'2026-11-18',repeat:{kind:'daily'},requestId:'unique'}).id,a.id);s.update(a.id,{status:'completed'});assert.equal(s.list().length,1);
 set('2026-11-21T12:00:00');s.list();const second=createStore(file,{now:()=>new Date('2026-11-21T12:00:00')});assert.equal(second.list().length,4);second.close();assert.equal(s.list().filter(x=>x.status==='completed').length,1);
 const current=s.list().at(-1);s.update(current.id,{status:'cancelled',repeat:{kind:'weekly',days:[1]}});assert.equal(s.list()[0].dueDate,'2026-11-18');set('2026-11-23T12:00:00');assert.equal(s.list().length,5);
 assert.equal(s.skipPrevious(a.seriesId),2);s.stopSeries(a.seriesId);set('2026-12-23T12:00:00');assert.equal(s.list().length,5);
});
test('month notification catches up once and achievement days are nonconsecutive',t=>{
 const {store:s,set}=setup(t,'2026-11-01T12:00:00');for(let i=1;i<=13;i+=2){set(`2026-11-${String(i).padStart(2,'0')}T12:00:00`);s.add({title:'done',status:'completed'});}
 assert(s.growth().badges.some(b=>b.id==='days7'));set('2026-11-30T19:59:00');assert.equal(s.checkReports().length,0);set('2026-12-02T12:00:00');assert.deepEqual(s.checkReports(),['2026-11']);assert.deepEqual(s.checkReports(),[]);assert.equal(s.report('2026-11').activeDays,7);
});
test('editing a future repeat never creates occurrences before its start date',t=>{
 const {store:s,set}=setup(t,'2026-11-18T12:00:00');const task=s.add({title:'Future',dueDate:'2026-12-01',repeat:{kind:'daily'}});s.update(task.id,{repeat:{kind:'weekdays'}});set('2026-11-20T12:00:00');assert.equal(s.list().length,1);assert.equal(s.list()[0].dueDate,'2026-12-01');
});
test('stopping an offline series preserves all already-due periods',t=>{
 const {store:s,set}=setup(t,'2026-11-01T12:00:00');const a=s.add({title:'Daily',dueDate:'2026-11-01',repeat:{kind:'daily'}});set('2026-11-05T12:00:00');s.stopSeries(a.seriesId);assert.equal(s.list().length,5);set('2026-11-10T12:00:00');assert.equal(s.list().length,5);
});
test('report HTML escapes titles and default export does not expose task or habit names',t=>{
 const {store:s}=setup(t);s.add({title:'SECRET <script>alert(1)</script>',dueDate:'2026-01-31',repeat:{kind:'daily'},status:'completed'});const {reportHTML}=require('../src/report.cjs'),r=s.report('2026-01');assert(!reportHTML(r).includes('SECRET'));assert(reportHTML(r,true).includes('&lt;script&gt;'));assert(!reportHTML(r,true).includes('<script>'));
});
test('migration backs up and keeps unknown legacy completion dates out of monthly reports',t=>{
 const dir=mkdtempSync(join(tmpdir(),'pocket-legacy-')),file=join(dir,'test.sqlite');let db=new DatabaseSync(file);db.exec("CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT,category TEXT,status TEXT,dueDate TEXT,position REAL,createdAt TEXT,updatedAt TEXT,requestId TEXT UNIQUE);INSERT INTO tasks VALUES('old','legacy','life','completed',NULL,1,'2026-11-01','2026-11-18',NULL)");db.close();
 const s=createStore(file,{now:()=>new Date('2026-11-18T12:00:00')});assert(existsSync(file+'.before-growth.bak'));assert.equal(s.report('2026-11').total,0);assert.equal(s.growth().legacyCount,1);assert.equal(s.growth().lifetime,1);s.close();const again=createStore(file);assert.equal(again.list().length,1);again.close();rmSync(dir,{recursive:true,force:true});
});
