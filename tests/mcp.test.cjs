const {test}=require('node:test'); const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs'); const {tmpdir}=require('node:os'); const {join,resolve}=require('node:path');
test('real stdio MCP clients share durable data and validate tools',async t=>{
  const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
  const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
  const dir=mkdtempSync(join(tmpdir(),'pocket-mcp-'));
  const clients=[];
  t.after(async()=>{for(const c of clients) await c.close(); rmSync(dir,{recursive:true,force:true});});
  async function client(name){
    const c=new Client({name,version:'1.0'}); clients.push(c);
    await c.connect(new StdioClientTransport({command:process.env.POCKET_MCP_RUNTIME||process.execPath,args:[process.env.POCKET_MCP_SCRIPT||resolve('src/mcp.cjs')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',POCKET_TODO_DATA_DIR:dir},stderr:'pipe'})); return c;
  }
  const a=await client('codex-test'),b=await client('qwen-test');
  assert.deepEqual((await a.listTools()).tools.map(t=>t.name).sort(),['add_todo','cancel_todo','complete_todo','list_repeat_series','list_todos','skip_previous_occurrences','stop_repeat_series','update_todo']);
  const results=await Promise.all([a.callTool({name:'add_todo',arguments:{title:'设计初稿',category:'content',dueDate:'2026-11-20',requestId:'r1'}}),b.callTool({name:'add_todo',arguments:{title:'读书',category:'study'}})]);
  const item=JSON.parse(results[0].content[0].text);
  const repeated=await a.callTool({name:'add_todo',arguments:{title:'设计初稿',requestId:'r1'}});
  assert.equal(JSON.parse(repeated.content[0].text).id,item.id);
  assert.equal(JSON.parse((await b.callTool({name:'list_todos',arguments:{}})).content[0].text).length,2);
  await b.callTool({name:'complete_todo',arguments:{id:item.id}});
  assert.equal(JSON.parse((await a.callTool({name:'list_todos',arguments:{status:'completed'}})).content[0].text)[0].id,item.id);
  const invalid=await a.callTool({name:'add_todo',arguments:{title:'bad date',dueDate:'2026-02-30'}});
  assert.equal(invalid.isError,true);
  const repeatedTask=JSON.parse((await a.callTool({name:'add_todo',arguments:{title:'每日阅读',dueDate:new Date().toISOString().slice(0,10),repeat:{kind:'daily'}}})).content[0].text);
  assert(repeatedTask.seriesId);await b.callTool({name:'cancel_todo',arguments:{id:repeatedTask.id}});
  assert.equal(JSON.parse((await a.callTool({name:'list_repeat_series',arguments:{}})).content[0].text)[0].active,1);
  await b.callTool({name:'stop_repeat_series',arguments:{seriesId:repeatedTask.seriesId}});
  assert.equal(JSON.parse((await a.callTool({name:'list_repeat_series',arguments:{}})).content[0].text)[0].active,0);
});
