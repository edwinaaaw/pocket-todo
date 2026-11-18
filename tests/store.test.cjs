const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtempSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');

function fixture(t) {
  const {createStore} = require('../src/store.cjs');
  const dir = mkdtempSync(join(tmpdir(), 'pocket-test-'));
  const path = join(dir, 'todos.sqlite');
  const store = createStore(path);
  t.after(()=>{store.close(); rmSync(dir,{recursive:true,force:true});});
  return {store,path,createStore};
}
test('two clients preserve writes and retry keys, including across reopening', t=>{
  const {store,path,createStore} = fixture(t);
  assert.deepEqual(store.list(),[]);
  const other = createStore(path);
  const a = store.add({title:'交中文初稿',category:'content',dueDate:'2028-02-29',requestId:'abc'});
  other.add({title:'Read',category:'study'});
  assert.equal(other.add({title:'交中文初稿',category:'content',requestId:'abc'}).id,a.id);
  assert.equal(other.list().length,2);
  other.close();
  const reopened=createStore(path);
  assert.equal(reopened.list().find(x=>x.id===a.id).dueDate,'2028-02-29');
  reopened.close();
});
test('rejects invalid dates, categories, states and titles without changing persisted tasks',t=>{
  const {store}=fixture(t);
  for(const input of [{title:''},{title:'  '},{title:'x'.repeat(501)},{title:'x',category:'bad'},{title:'x',dueDate:'2027-02-29'},{title:'x',dueDate:'2026-13-01'},{title:'x',status:'bad'}]) assert.throws(()=>store.add(input));
  assert.equal(store.list().length,0);
  const a=store.add({title:'<script>alert(1)</script>'});
  assert.throws(()=>store.update(a.id,{status:'bad'}));
  assert.equal(store.list()[0].status,'todo');
});
test('supports all statuses, edit, scoped ordering and undo deletion',t=>{
  const {store}=fixture(t);
  const a=store.add({title:'A'}), b=store.add({title:'B'});
  store.reorder({category:'work',status:'todo',ids:[b.id,a.id]});
  assert.deepEqual(store.list().map(x=>x.id),[b.id,a.id]);
  for(const status of ['pending','completed','cancelled','todo']) assert.equal(store.update(a.id,{status}).status,status);
  assert.equal(store.update(a.id,{title:'改稿',dueDate:'2026-11-20',category:'content'}).title,'改稿');
  assert.throws(()=>store.reorder({category:'work',status:'todo',ids:[a.id,b.id]}));
  const removed=store.remove(a.id);
  assert.equal(store.list().length,1);
  store.restore(removed);
  assert.equal(store.list().length,2);
  assert.throws(()=>store.update('missing',{title:'x'}));
});
