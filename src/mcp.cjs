const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
const {StdioServerTransport}=require('@modelcontextprotocol/sdk/server/stdio.js');
const {z}=require('zod');
const {createStore,CATEGORIES,STATUSES}=require('./store.cjs');
const {dbPath}=require('./paths.cjs');
const store=createStore(dbPath());
const server=new McpServer({name:'pocket-todo',version:'0.1.0'},{instructions:'Manage the user’s local Pocket Todo list. Query tasks to obtain IDs before modifying existing tasks. Never infer an ambiguous target. Dates are local calendar dates YYYY-MM-DD; interpret relative dates using the user’s current date/timezone. Use a stable requestId when retrying an add. Categories: work, life, content, study. Cancel preserves history; there is no permanent deletion tool.'});
const repeat=z.object({kind:z.enum(['none','daily','weekdays','weekly','monthly']),days:z.array(z.number().int().min(0).max(6)).optional(),day:z.number().int().min(1).max(31).optional()}).nullable().optional();
const fields={title:z.string().trim().min(1).max(500),category:z.enum(CATEGORIES).optional(),dueDate:z.string().nullable().optional(),status:z.enum(STATUSES).optional(),repeat};
function register(name,description,inputSchema,fn,readOnly=false) {
  server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:false}},async args=>{
    try {
      const result=fn(args);
      const client=server.server.getClientVersion()?.name || 'MCP client';
      store.meta('lastActivity',{client,tool:name,at:new Date().toISOString()});
      return {content:[{type:'text',text:JSON.stringify(result)}]};
    } catch(e) {return {isError:true,content:[{type:'text',text:e.message}]};}
  });
}
register('list_todos','List Pocket Todo tasks; optional status and category filters.',{category:fields.category,status:fields.status},args=>store.list(args),true);
register('add_todo','Add a task. Optional repeat: daily, weekdays, weekly (days 0=Sunday through 6=Saturday), monthly (day 1–31, short months clamp). Repeats require dueDate as start date. Each occurrence is separate; future occurrences appear on their dates. Supply stable requestId for retries.',{...fields,requestId:z.string().min(1).max(200).optional()},args=>store.add(args));
register('update_todo','Update one task occurrence by ID. Use null to clear dueDate. repeat changes affect only future ungenerated occurrences; repeat null stops future repeats. Existing occurrence history remains. Title/category edits alone change this occurrence; include repeat to also update the future template.',{id:z.string(),...fields,title:fields.title.optional()},({id,...patch})=>store.update(id,patch));
register('complete_todo','Mark a task completed by its ID.',{id:z.string()},({id})=>store.update(id,{status:'completed'}));
register('cancel_todo','Cancel a task while preserving its history.',{id:z.string()},({id})=>store.update(id,{status:'cancelled'}));
register('list_repeat_series','Inspect repeating templates including stopped series and their rules.',{},()=>store.growth().series,true);
register('stop_repeat_series','Stop future occurrences by seriesId. Existing instances remain unchanged. cancel_todo only cancels one occurrence.',{seriesId:z.string()},({seriesId})=>store.stopSeries(seriesId));
register('skip_previous_occurrences','Cancel all unfinished occurrences of this series scheduled before today. Preserves their history and future repeats.',{seriesId:z.string()},({seriesId})=>({cancelled:store.skipPrevious(seriesId)}));
server.connect(new StdioServerTransport()).catch(error=>{console.error(error.message);store.close();process.exitCode=1;});
process.on('SIGTERM',()=>{store.close();process.exit(0);});
