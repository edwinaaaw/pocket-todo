const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, existsSync, linkSync, unlinkSync } = require('node:fs');
const { dirname } = require('node:path');
const { randomUUID } = require('node:crypto');
const CATEGORIES = ['work', 'life', 'content', 'study'];
const STATUSES = ['todo', 'pending', 'completed', 'cancelled'];
const {localDate,normalizeRule,nextDate,plusDay}=require('./recurrence.cjs');
const BADGES=[['first','第一小步',1],['ten','慢慢积累',10],['fifty','五十个小进展',50],['hundred','一百次做到',100],['habit7','小习惯发芽',7],['habit30','习惯生根',30],['days7','认真生活的一周',7]];

function validate(input) {
  if (!input || typeof input !== 'object') throw new Error('任务格式无效');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 500) throw new Error('标题需要 1–500 个字符');
  const category = input.category ?? 'work', status = input.status ?? 'todo';
  if (!CATEGORIES.includes(category)) throw new Error('分类无效');
  if (!STATUSES.includes(status)) throw new Error('状态无效');
  const dueDate = input.dueDate || null;
  if (dueDate !== null) {
    if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('日期格式应为 YYYY-MM-DD');
    const date = new Date(dueDate + 'T12:00:00Z');
    if (isNaN(date) || date.toISOString().slice(0,10) !== dueDate) throw new Error('日期不存在');
  }
  const requestId = input.requestId ?? null;
  if (requestId !== null && (typeof requestId !== 'string' || !requestId || requestId.length > 200)) throw new Error('请求 ID 无效');
  return {title, category, status, dueDate, requestId};
}

function createStore(file,{now=()=>new Date()}={}) {
  mkdirSync(dirname(file), {recursive:true});
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL,
      status TEXT NOT NULL, dueDate TEXT, position REAL NOT NULL,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, requestId TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  // VACUUM makes a consistent backup including WAL contents, before any migration.
  if(db.prepare('PRAGMA user_version').get().user_version<2){
    if(!existsSync(file+'.before-growth.bak')){
      const temporary=file+'.backup-'+randomUUID();
      try{db.prepare('VACUUM INTO ?').run(temporary);try{linkSync(temporary,file+'.before-growth.bak');}catch(e){if(e.code!=='EEXIST')throw e;}}
      finally{if(existsSync(temporary))unlinkSync(temporary);}
    }
    transaction(()=>{
      if(db.prepare('PRAGMA user_version').get().user_version>=2)return;
      db.exec(`ALTER TABLE tasks ADD COLUMN completedAt TEXT;
        ALTER TABLE tasks ADD COLUMN completedDate TEXT;
        ALTER TABLE tasks ADD COLUMN seriesId TEXT;
        ALTER TABLE tasks ADD COLUMN occurrenceDate TEXT;
        CREATE UNIQUE INDEX occurrence_unique ON tasks(seriesId,occurrenceDate);
        CREATE TABLE series(id TEXT PRIMARY KEY,title TEXT,category TEXT,rule TEXT,startDate TEXT,cursor TEXT,active INTEGER,createdAt TEXT);
        CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,taskId TEXT,kind TEXT,at TEXT,date TEXT);
        CREATE TABLE first_completions(taskId TEXT PRIMARY KEY,seriesId TEXT,at TEXT,date TEXT);
        CREATE TABLE badges(id TEXT PRIMARY KEY,name TEXT,earnedAt TEXT,earnedDate TEXT);
        CREATE TABLE reports(month TEXT PRIMARY KEY,body TEXT,notified INTEGER DEFAULT 0);
        INSERT INTO first_completions SELECT id, NULL, NULL, NULL FROM tasks WHERE status='completed';
        PRAGMA user_version=2;`);
    });
  }
  const insert = db.prepare('INSERT INTO tasks(id,title,category,status,dueDate,position,createdAt,updatedAt,requestId,completedAt,completedDate,seriesId,occurrenceDate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const plain = row => row ? {...row} : null;
  const get = id => plain(db.prepare('SELECT * FROM tasks WHERE id=?').get(String(id)));
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result=fn(); db.exec('COMMIT'); return result; }
    catch(e) { db.exec('ROLLBACK'); throw e; }
  }
  function nextPosition(category,status) {
    return db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM tasks WHERE category=? AND status=?').get(category,status).n;
  }
  function put(task) { insert.run(task.id,task.title,task.category,task.status,task.dueDate,task.position,task.createdAt,task.updatedAt,task.requestId,task.completedAt??null,task.completedDate??null,task.seriesId??null,task.occurrenceDate??null); return get(task.id); }
  const stamp=()=>now().toISOString(),day=()=>localDate(now());
  function completion(task,oldStatus){
    if(task.status===oldStatus)return;
    if(task.status==='completed'){
      task.completedAt=stamp();task.completedDate=day();
      db.prepare('INSERT OR IGNORE INTO first_completions VALUES(?,?,?,?)').run(task.id,task.seriesId??null,task.completedAt,task.completedDate);
      db.prepare('INSERT INTO events(taskId,kind,at,date) VALUES(?,?,?,?)').run(task.id,'completed',task.completedAt,task.completedDate);
    }else if(oldStatus==='completed'){
      task.completedAt=null;task.completedDate=null;
      db.prepare('INSERT INTO events(taskId,kind,at,date) VALUES(?,?,?,?)').run(task.id,'reopened',stamp(),day());
    }
  }
  function award(){
    const count=db.prepare('SELECT COUNT(*) n FROM first_completions').get().n;
    const days=db.prepare('SELECT COUNT(DISTINCT date) n FROM first_completions').get().n;
    const habit=db.prepare('SELECT COUNT(*) n FROM first_completions WHERE seriesId IS NOT NULL GROUP BY seriesId ORDER BY n DESC LIMIT 1').get()?.n||0;
    for(const [id,name,target] of BADGES){const n=id.startsWith('habit')?habit:id==='days7'?days:count;
      if(n>=target){const added=db.prepare('INSERT OR IGNORE INTO badges VALUES(?,?,?,?)').run(id,name,stamp(),day());if(added.changes)db.prepare('INSERT INTO events(taskId,kind,at,date) VALUES(?,?,?,?)').run(id,'achievement',stamp(),day());}
    }
  }
  function materialize(){transaction(()=>{
    for(const s of db.prepare('SELECT * FROM series WHERE active=1').all()){
      const rule=JSON.parse(s.rule);let cursor=s.cursor;
      while(cursor<=day()){
        const date=nextDate(cursor,rule);if(date>day())break;
        if(!db.prepare('SELECT 1 FROM tasks WHERE seriesId=? AND occurrenceDate=?').get(s.id,date))put({id:randomUUID(),title:s.title,category:s.category,status:'todo',dueDate:date,position:nextPosition(s.category,'todo'),createdAt:stamp(),updatedAt:stamp(),requestId:null,seriesId:s.id,occurrenceDate:date});
        cursor=plusDay(date);
      }
      db.prepare('UPDATE series SET cursor=? WHERE id=?').run(cursor,s.id);
    }
  });}
  function decorated(task){const s=task.seriesId&&db.prepare('SELECT * FROM series WHERE id=?').get(task.seriesId);return {...task,repeat:s?{...JSON.parse(s.rule),active:!!s.active}:null};}
  const store={
    list(filters={}) {
      if(filters.status && !STATUSES.includes(filters.status)) throw new Error('状态无效');
      if(filters.category && !CATEGORIES.includes(filters.category)) throw new Error('分类无效');
      materialize();
      return db.prepare('SELECT * FROM tasks ORDER BY position,createdAt,id').all().map(decorated).filter(t=>(!filters.status||t.status===filters.status)&&(!filters.category||t.category===filters.category));
    },
    add(input) {
      const valid=validate(input);
      const rule=normalizeRule(input.repeat,valid.dueDate);
      return transaction(()=>{
        if(valid.requestId) {const old=db.prepare('SELECT * FROM tasks WHERE requestId=?').get(valid.requestId); if(old) return decorated(old);}
        const time=stamp(),task={id:randomUUID(),...valid,position:nextPosition(valid.category,valid.status),createdAt:time,updatedAt:time};
        if(rule){task.seriesId=randomUUID();task.occurrenceDate=nextDate(valid.dueDate,rule);task.dueDate=task.occurrenceDate;
          db.prepare('INSERT INTO series VALUES(?,?,?,?,?,?,?,?)').run(task.seriesId,task.title,task.category,JSON.stringify(rule),valid.dueDate,plusDay(task.occurrenceDate),1,time);
        }
        completion(task,null);const result=put(task);award();return decorated(result);
      });
    },
    update(id,patch) {
      materialize();
      return transaction(()=>{
        const old=get(id); if(!old) throw new Error('任务不存在，请刷新列表');
        const allowed={}; for(const key of ['title','category','status','dueDate']) if(Object.hasOwn(patch,key)) allowed[key]=patch[key];
        const task={...old,...validate({...old,...allowed}),updatedAt:stamp()};
        if(Object.hasOwn(patch,'repeat')){
          const rule=normalizeRule(patch.repeat,task.dueDate);
          if(task.seriesId){
            if(rule){const series=db.prepare('SELECT * FROM series WHERE id=?').get(task.seriesId);const cursor=[series.startDate,series.cursor,plusDay(day())].sort().at(-1);db.prepare('UPDATE series SET rule=?,title=?,category=?,cursor=?,active=1 WHERE id=?').run(JSON.stringify(rule),task.title,task.category,cursor,task.seriesId);}
            else db.prepare('UPDATE series SET active=0 WHERE id=?').run(task.seriesId);
          }else if(rule){task.seriesId=randomUUID();task.occurrenceDate=task.dueDate;db.prepare('INSERT INTO series VALUES(?,?,?,?,?,?,?,?)').run(task.seriesId,task.title,task.category,JSON.stringify(rule),task.dueDate,plusDay(task.dueDate>day()?task.dueDate:day()),1,stamp());}
        }
        completion(task,old.status);
        if(task.category!==old.category||task.status!==old.status) task.position=nextPosition(task.category,task.status);
        db.prepare('UPDATE tasks SET title=?,category=?,status=?,dueDate=?,position=?,updatedAt=?,completedAt=?,completedDate=?,seriesId=?,occurrenceDate=? WHERE id=?').run(task.title,task.category,task.status,task.dueDate,task.position,task.updatedAt,task.completedAt??null,task.completedDate??null,task.seriesId??null,task.occurrenceDate??null,id);
        award();return decorated(task);
      });
    },
    remove(id) {return transaction(()=>{const task=get(id); if(!task) throw new Error('任务不存在'); db.prepare('DELETE FROM tasks WHERE id=?').run(id); return task;});},
    restore(task) {validate(task); return transaction(()=>put(task));},
    reorder({category,status,ids}) {
      if(!Array.isArray(ids)||new Set(ids).size!==ids.length) throw new Error('排序无效');
      return transaction(()=>{
        const current=db.prepare('SELECT * FROM tasks WHERE category=? AND status=?').all(category,status);
        if(current.length!==ids.length||!current.every(t=>ids.includes(t.id))) throw new Error('任务已改变，请刷新后重新排序');
        const stmt=db.prepare('UPDATE tasks SET position=?,updatedAt=? WHERE id=?');
        ids.forEach((id,i)=>stmt.run(i+1,new Date().toISOString(),id));
      });
    },
    stopSeries(id){materialize();return transaction(()=>{const s=db.prepare('SELECT id FROM series WHERE id=?').get(id);if(!s)throw new Error('重复系列不存在');db.prepare('UPDATE series SET active=0 WHERE id=?').run(id);return {seriesId:id,active:false};});},
    skipPrevious(id){materialize();return transaction(()=>{
      const result=db.prepare("UPDATE tasks SET status='cancelled',updatedAt=? WHERE seriesId=? AND occurrenceDate<? AND status IN ('todo','pending')").run(stamp(),id,day());return Number(result.changes);
    });},
    events(after=0){return db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq').all(Number(after)||0).map(plain);},
    snapshot(){materialize();return transaction(()=>({tasks:db.prepare('SELECT * FROM tasks ORDER BY position,createdAt,id').all().map(decorated),cursor:db.prepare('SELECT COALESCE(MAX(seq),0) n FROM events').get().n}));},
    growth(){
      const badges=db.prepare('SELECT * FROM badges ORDER BY earnedAt,id').all().map(plain);
      return {lifetime:db.prepare('SELECT COUNT(*) n FROM first_completions').get().n,legacyCount:db.prepare('SELECT COUNT(*) n FROM first_completions WHERE date IS NULL').get().n,badges,catalog:BADGES.map(([id,name,target])=>({id,name,target})),series:db.prepare('SELECT * FROM series ORDER BY createdAt').all().map(s=>({...s,rule:JSON.parse(s.rule)})),months:db.prepare('SELECT month FROM reports ORDER BY month DESC').all().map(r=>r.month)};
    },
    report(month){
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('月份格式无效');
      const tasks=db.prepare("SELECT * FROM tasks WHERE status='completed' AND substr(completedDate,1,7)=? ORDER BY completedAt").all(month).map(plain);
      const categories=Object.fromEntries(CATEGORIES.map(c=>[c,tasks.filter(t=>t.category===c).length]));
      const activeDays=new Set(tasks.map(t=>t.completedDate)).size;
      const habits=db.prepare("SELECT s.id,s.title,COUNT(t.id) count FROM series s JOIN tasks t ON t.seriesId=s.id WHERE t.status='completed' AND substr(t.completedDate,1,7)=? GROUP BY s.id").all(month).map(plain);
      const badges=db.prepare('SELECT * FROM badges WHERE substr(earnedDate,1,7)=? ORDER BY earnedAt').all(month).map(plain);
      const report={month,total:tasks.length,activeDays,categories,habits,badges,tasks,asOf:stamp(),message:tasks.length?`这个月，你在 ${activeDays} 天里完成了 ${tasks.length} 件小事。每一次做到，都值得被记住。`:'这个月还没有记录到完成的小事。这里会安静地留着，等你想记的时候再来。'};
      db.prepare('INSERT INTO reports(month,body) VALUES(?,?) ON CONFLICT(month) DO UPDATE SET body=excluded.body').run(month,JSON.stringify(report));return report;
    },
    checkReports(){
      const d=now(),today=day(),current=today.slice(0,7),last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate();
      const first=this.meta('growthStarted')||current;const ready=[];let month=first;
      while(month<=current){
        if(month<current||(d.getDate()===last&&d.getHours()>=20)){
          this.report(month);if(!db.prepare('SELECT notified FROM reports WHERE month=?').get(month).notified){db.prepare('UPDATE reports SET notified=1 WHERE month=?').run(month);ready.push(month);}
        }
        let [y,m]=month.split('-').map(Number);if(++m>12){m=1;y++;}month=`${y}-${String(m).padStart(2,'0')}`;
      }
      return ready;
    },
    meta(key,value) {
      if(value!==undefined) db.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
      const row=db.prepare('SELECT value FROM metadata WHERE key=?').get(key);
      return row ? JSON.parse(row.value) : null;
    },
    close() {db.close();}
  };
  if(!store.meta('growthStarted'))store.meta('growthStarted',day().slice(0,7));
  transaction(award);
  return store;
}
module.exports={createStore,CATEGORIES,STATUSES,validate};
