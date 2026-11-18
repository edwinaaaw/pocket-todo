/* The renderer never reads files or executes arbitrary commands. */
const api=window.pocket;
const $=id=>document.getElementById(id);
const categories=['work','life','content','study'];
const labels={todo:'To-do',pending:'Pending',completed:'Completed',cancelled:'Cancelled'};
let tasks=[],tab='todo',collapsed={},snapshot='',editingId=null,editingOriginal=null,connectionData=null;
let collapseTimer,expandTimer,toastTimer,dragging=false,taskDrag=null,inside=true,refreshing=false,composing=false;
let windowActive=true,suppressCapsuleClick=false,dragOrigin=null;
let eventCursor=null,celebrations=true,celebrating=false,cheerTimer,cheerBatchTimer,queuedBadge=null;
let newRepeat=null,editRepeat=null,repeatTarget='new',expandedSeries=new Set(),growthData=null,reportData=null;

function notify(message,canUndo=false){
  clearTimeout(toastTimer);$('toast-text').textContent=message;$('undo').hidden=!canUndo;$('toast').hidden=false;
  toastTimer=setTimeout(()=>$('toast').hidden=true,canUndo?9500:4500);
}
function errorMessage(e){return e.message.replace(/^Error invoking remote method '[^']+': Error: /,'');}
async function safely(fn){try{return await fn();}catch(e){notify(errorMessage(e));return null;}}
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function locked(){
  const focused=document.activeElement;
  const editing=windowActive&&focused&&((focused.tagName==='INPUT'&&!focused.readOnly&&focused.type!=='checkbox'&&focused.value!=='')||focused.tagName==='TEXTAREA'||focused.tagName==='SELECT');
  return dragging||taskDrag||celebrating||document.querySelector('dialog[open]')||editing;
}
function scheduleCollapse(){clearTimeout(collapseTimer);if(!inside&&!locked())collapseTimer=setTimeout(()=>{if(!inside&&!locked())api.expand(false);},450);}
function savePrefs(){safely(()=>api.preferences({tab,collapsed,celebrations}));}
function setTab(next){tab=next;render();savePrefs();}
function formatDue(date){if(date===today())return 'Today';const d=new Date(date+'T12:00:00');return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function dueButton(task){
  const button=element('button','due-pill'+(task.dueDate===today()?' today':task.dueDate<today()?' overdue':''),formatDue(task.dueDate));
  button.title='修改截止日期 · '+task.dueDate;button.onclick=()=>openEdit(task);return button;
}
async function refresh(force=false){
  if(refreshing)return;refreshing=true;
  try{
    const state=api.snapshot?await api.snapshot(eventCursor):{tasks:await api.list(),events:[],cursor:0};
    eventCursor=state.cursor;
    if(state.events.some(e=>e.kind==='completed'))queueCheer(state.events.find(e=>e.kind==='achievement')?.taskId);
    const next=state.tasks;const json=JSON.stringify(next);
    if(force||json!==snapshot){tasks=next;snapshot=json;if(!taskDrag)render();if($('growth-dialog').open)await openGrowth();}
  }catch(e){notify(errorMessage(e));}finally{refreshing=false;}
}
async function mutate(fn){return safely(async()=>{const result=await fn();await refresh(true);return result;});}

function render(){
  document.querySelectorAll('[data-tab]').forEach(b=>{const selected=b.dataset.tab===tab;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',String(selected));});
  const active=tasks.filter(t=>t.status==='todo'||t.status==='pending').length;
  $('capsule-count').textContent=active;$('capsule').ariaLabel=`展开待办，${active} 个未完成任务`;
  const visible=tasks.filter(t=>t.status===tab);
  $('task-summary').textContent=`${visible.length} little thing${visible.length===1?'':'s'}`;
  $('today-label').textContent=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',weekday:'short'});
  const groups=$('groups');const scroll=groups.scrollTop;groups.replaceChildren();
  for(const category of categories){
    const items=visible.filter(t=>t.category===category);
    const group=element('section','group'+(collapsed[category]?' closed':''));group.dataset.category=category;
    const heading=element('button','group-head');heading.setAttribute('aria-expanded',String(!collapsed[category]));heading.setAttribute('aria-label',`折叠或展开 ${category}`);
    heading.append(element('span','chevron',collapsed[category]?'▸':'⌄'),element('span','category-name',category),element('span','group-count',`(${items.length})`),element('span','group-tag',({work:'MAKE IT HAPPEN',life:'LITTLE MOMENTS',content:'CREATE SOMETHING',study:'STAY CURIOUS'})[category]));
    heading.onclick=()=>{collapsed[category]=!collapsed[category];render();savePrefs();};group.append(heading);
    if(!collapsed[category]){
      if(!items.length)group.append(element('div','group-empty',tab==='todo'?'a little room for something new':'nothing here, for now'));
      const seen=new Set();
      for(const task of items){
        if(task.seriesId&&(tab==='todo'||tab==='pending')){
          if(seen.has(task.seriesId))continue;seen.add(task.seriesId);
          const siblings=items.filter(t=>t.seriesId===task.seriesId).sort((a,b)=>b.occurrenceDate.localeCompare(a.occurrenceDate));
          group.append(taskRow(siblings[0],items));
          if(siblings.length>1){const button=element('button','older-occurrences',`${expandedSeries.has(task.seriesId)?'收起':'还有'} ${siblings.length-1} 期未处理`);button.onclick=()=>{expandedSeries.has(task.seriesId)?expandedSeries.delete(task.seriesId):expandedSeries.add(task.seriesId);render();};group.append(button);if(expandedSeries.has(task.seriesId))for(const old of siblings.slice(1))group.append(taskRow(old,items));}
        }else group.append(taskRow(task,items));
      }
    }
    groups.append(group);
  }
  groups.scrollTop=scroll;
}
function taskRow(task,items){
  const row=element('div','task-row '+task.status);row.dataset.id=task.id;
  const handle=element('span','task-handle','⠿');handle.draggable=true;handle.title='拖动排序';handle.setAttribute('aria-label','拖动排序');
  handle.addEventListener('dragstart',event=>{taskDrag={id:task.id,category:task.category};row.classList.add('dragging');event.dataTransfer.setData('text/plain',task.id);event.dataTransfer.effectAllowed='move';clearTimeout(collapseTimer);});
  handle.addEventListener('dragend',()=>{taskDrag=null;render();scheduleCollapse();});
  row.addEventListener('dragover',event=>{if(taskDrag?.category===task.category){event.preventDefault();row.classList.add('drag-over');event.dataTransfer.dropEffect='move';}});
  row.addEventListener('dragleave',()=>row.classList.remove('drag-over'));
  row.addEventListener('drop',event=>{
    event.preventDefault();if(!taskDrag||taskDrag.category!==task.category)return;
    const ids=items.map(t=>t.id),old=ids.indexOf(taskDrag.id),target=ids.indexOf(task.id);if(old<0||target<0)return;
    ids.splice(old,1);ids.splice(target,0,taskDrag.id);taskDrag=null;
    mutate(()=>api.reorder({category:task.category,status:tab,ids}));
  });
  const check=element('input','task-check');check.type='checkbox';check.checked=task.status==='completed';check.ariaLabel=`完成 ${task.title}`;
  check.onchange=()=>mutate(()=>api.update(task.id,{status:check.checked?'completed':'todo'}));
  const title=element('button','task-title',task.title);title.title='编辑任务 · '+task.title;title.onclick=()=>openEdit(task);
  row.append(handle,check,title);if(task.seriesId){const repeat=element('button','repeat-mark','↻');repeat.title=repeatLabel(task.repeat)+(task.repeat?.active?' · 取消仅影响当期':' · 已停止后续重复');repeat.ariaLabel='编辑重复任务';repeat.onclick=()=>openEdit(task);row.append(repeat);}if(task.dueDate)row.append(dueButton(task));
  if(task.status==='cancelled'){
    const restore=element('button','task-restore','↶');restore.ariaLabel=`恢复 ${task.title}`;restore.title='恢复到 To-do';
    restore.onclick=()=>safely(async()=>{await api.update(task.id,{status:'todo'});await refresh(true);notify('已恢复到 To-do');});
    const remove=element('button','task-delete');remove.ariaLabel=`删除 ${task.title}`;remove.title='删除记录并更新可重算统计；已获徽章保留（10 秒内可撤销）';
    const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('aria-hidden','true');
    const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d','M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 10v7M14 10v7');icon.append(path);remove.append(icon);
    remove.onclick=()=>safely(async()=>{await api.remove(task.id);await refresh(true);notify('已删除这条记录',true);});
    row.append(restore,remove);
  }else{
    const cancel=element('button','task-cancel','×');cancel.ariaLabel=`取消 ${task.title}`;cancel.title='取消任务，保留在 Cancelled';
    cancel.onclick=()=>safely(async()=>{await api.update(task.id,{status:'cancelled'});await refresh(true);notify('已移至 Cancelled，可在该页恢复');});
    row.append(cancel);
  }
  return row;
}
function openEdit(task){
  editingId=task.id;editingOriginal={...task};$('edit-title').value=task.title;$('edit-category').value=task.category;$('edit-status').value=task.status;$('edit-date').value=task.dueDate||'';
  editRepeat=cleanRule(task.repeat);$('edit-repeat').textContent=repeatLabel(editRepeat);$('series-actions').hidden=!task.seriesId;
  $('stop-repeat').hidden=!task.repeat?.active;$('repeat-note').textContent=task.seriesId?'当前编辑只影响这一期；修改重复设置会更新未来规则。取消当期不会停止后续重复。':'';
  clearTimeout(collapseTimer);$('edit-dialog').showModal();
}
$('edit-form').addEventListener('submit',event=>{
  event.preventDefault();if(composing)return;
  safely(async()=>{
    const current={title:$('edit-title').value,category:$('edit-category').value,status:$('edit-status').value,dueDate:$('edit-date').value||null};
    const patch={};for(const key of Object.keys(current))if(current[key]!==editingOriginal[key])patch[key]=current[key];
    if(JSON.stringify(editRepeat)!==JSON.stringify(cleanRule(editingOriginal.repeat)))patch.repeat=editRepeat;
    await api.update(editingId,patch);
    $('edit-dialog').close();editingId=null;await refresh(true);scheduleCollapse();
  });
});
document.querySelectorAll('.close-dialog').forEach(button=>button.onclick=()=>button.closest('dialog').close());
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('close',()=>{document.activeElement?.blur();scheduleCollapse();}));
// An in-window calendar keeps the interaction inside our modal lock. Native date
// popovers can move focus outside the renderer before a date has been selected.
let dateTarget=null,calendarYear,calendarMonth;
function renderCalendar(){
  $('calendar-month').textContent=`${calendarYear} 年 ${calendarMonth+1} 月`;
  const grid=$('calendar-days');grid.replaceChildren();
  const first=new Date(calendarYear,calendarMonth,1).getDay();
  const days=new Date(calendarYear,calendarMonth+1,0).getDate();
  for(let i=0;i<first;i++)grid.append(element('span','calendar-spacer'));
  for(let day=1;day<=days;day++){
    const value=`${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const button=element('button','calendar-day',String(day));button.type='button';button.dataset.date=value;
    button.setAttribute('aria-label',value);button.setAttribute('aria-pressed',String(dateTarget.value===value));
    if(dateTarget.value===value)button.classList.add('chosen');if(value===today())button.classList.add('is-today');
    button.onclick=()=>selectDate(value);grid.append(button);
  }
}
function openCalendar(input){
  dateTarget=input;const date=input.value?new Date(input.value+'T12:00:00'):new Date();calendarYear=date.getFullYear();calendarMonth=date.getMonth();
  clearTimeout(collapseTimer);renderCalendar();$('date-dialog').showModal();
  ($('calendar-days').querySelector('.chosen')||$('calendar-days').querySelector('.is-today')||$('calendar-days').querySelector('button')).focus();
}
function selectDate(value){dateTarget.value=value;dateTarget.dispatchEvent(new Event('change',{bubbles:true}));$('date-dialog').close();}
for(const id of ['new-date','edit-date']){
  $(id).onclick=()=>openCalendar($(id));
  $(id).onkeydown=event=>{if(event.key==='Enter'||event.key===' '||event.key==='ArrowDown'){event.preventDefault();openCalendar($(id));}};
}
function moveMonth(delta){const date=new Date(calendarYear,calendarMonth+delta,1);calendarYear=date.getFullYear();calendarMonth=date.getMonth();renderCalendar();}
$('calendar-prev').onclick=()=>moveMonth(-1);$('calendar-next').onclick=()=>moveMonth(1);
$('calendar-clear').onclick=()=>selectDate('');$('calendar-today').onclick=()=>selectDate(today());
document.querySelectorAll('[data-tab]').forEach(button=>button.onclick=()=>setTab(button.dataset.tab));

$('add-form').addEventListener('submit',event=>{
  event.preventDefault();if(composing)return;
  const title=$('new-title').value.trim();if(!title)return;
  const button=$('add-form').querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;
  safely(async()=>{
    await api.add({title,category:$('new-category').value,dueDate:$('new-date').value||null,repeat:newRepeat});
    $('new-title').value='';$('new-date').value='';newRepeat=null;$('new-repeat').textContent='不重复';collapsed[$('new-category').value]=false;tab='todo';await refresh(true);savePrefs();$('new-title').focus();
  }).finally(()=>button.disabled=false);
});
document.addEventListener('compositionstart',()=>composing=true);
document.addEventListener('compositionend',()=>composing=false);
document.addEventListener('keydown',event=>{if(event.key==='Enter'&&(event.isComposing||composing||event.keyCode===229))event.preventDefault();});
$('undo').onclick=()=>safely(async()=>{await api.undo();$('toast').hidden=true;await refresh(true);});

async function loadConnections(){
  connectionData=await api.connections();
  $('config-content').value=connectionData[$('config-type').value];$('data-path').textContent=connectionData.dataPath;
  const last=connectionData.lastActivity;
  $('last-activity').textContent=last?`最近调用：${last.client} · ${new Date(last.at).toLocaleString()} · ${last.tool}`:'待验证 · 完成配置后，在 AI 中查询一次待办即可验证。';
  $('connection-dot').classList.toggle('active',!!last);
}
$('connections').onclick=()=>safely(async()=>{clearTimeout(collapseTimer);await loadConnections();$('connection-dialog').showModal();});
$('config-type').onchange=()=>{$('config-content').value=connectionData[$('config-type').value];};
for(const target of ['codex','qwen'])$('copy-'+target).onclick=()=>safely(async()=>{await api.copy(connectionData[target]);notify('配置已复制');});

document.documentElement.addEventListener('mouseenter',()=>{
  inside=true;clearTimeout(collapseTimer);
  if(document.body.classList.contains('is-collapsed')){clearTimeout(expandTimer);expandTimer=setTimeout(()=>{if(!dragging)api.expand(true);},160);}
});
document.documentElement.addEventListener('mouseleave',()=>{inside=false;clearTimeout(expandTimer);scheduleCollapse();});
document.addEventListener('focusout',()=>setTimeout(scheduleCollapse,0));
$('collapse').onclick=()=>{document.activeElement?.blur();clearTimeout(expandTimer);clearTimeout(collapseTimer);api.expand(false);};
$('capsule').addEventListener('click',()=>{if(suppressCapsuleClick){suppressCapsuleClick=false;return;}if(!dragging)api.expand(true);});
api.onMode(expanded=>{document.body.classList.toggle('is-collapsed',!expanded);});
for(const handle of [...document.querySelectorAll('[data-drag]'),$('capsule')]){
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;dragging=true;dragOrigin={x:event.clientX,y:event.clientY};suppressCapsuleClick=false;clearTimeout(expandTimer);clearTimeout(collapseTimer);handle.setPointerCapture(event.pointerId);api.drag('start');
  });
  handle.addEventListener('pointermove',event=>{if(dragging&&dragOrigin&&Math.hypot(event.clientX-dragOrigin.x,event.clientY-dragOrigin.y)>4)suppressCapsuleClick=true;});
  const stop=()=>{if(dragging){api.drag('end');dragging=false;scheduleCollapse();}};
  handle.addEventListener('pointerup',stop);handle.addEventListener('pointercancel',stop);handle.addEventListener('lostpointercapture',stop);
}
window.addEventListener('blur',()=>{windowActive=false;if(dragging){api.drag('end');dragging=false;}scheduleCollapse();});
window.addEventListener('focus',()=>windowActive=true);
async function init(){
  const prefs=await api.preferences();if(prefs){tab=prefs.tab||'todo';collapsed=prefs.collapsed||{};celebrations=prefs.celebrations!==false;}$('celebrations').checked=celebrations;
  await refresh(true);await loadConnections();
  await checkReports();setInterval(()=>safely(checkReports),60000);
  setInterval(()=>{refresh();if($('connection-dialog').open)loadConnections().catch(()=>{});},1000);
}
safely(init);

function cleanRule(rule){if(!rule||rule.active===false||rule.kind==='none')return null;const {active,...clean}=rule;return clean;}
function repeatLabel(rule){return !rule?'不重复':({daily:'每天',weekdays:'工作日',weekly:'每周 '+(rule.days||[]).map(d=>'日一二三四五六'[d]).join(' / '),monthly:`每月 ${rule.day} 日`})[rule.kind]||'不重复';}
function openRepeat(target){
  repeatTarget=target;const rule=target==='new'?newRepeat:editRepeat;$('repeat-kind').value=rule?.kind||'none';$('repeat-day').value=rule?.day||Number((target==='new'?$('new-date').value:$('edit-date').value||today()).slice(8))||1;
  const days=$('repeat-days');days.replaceChildren();for(let n=0;n<7;n++){const label=element('label'),input=element('input');input.type='checkbox';input.value=n;input.checked=rule?.days?.includes(n)||false;label.append(input,document.createTextNode('日一二三四五六'[n]));days.append(label);}
  repeatFields();$('repeat-dialog').showModal();
}
function repeatFields(){$('repeat-days').hidden=$('repeat-kind').value!=='weekly';$('repeat-monthly').hidden=$('repeat-kind').value!=='monthly';}
$('new-repeat').onclick=()=>openRepeat('new');$('edit-repeat').onclick=()=>openRepeat('edit');$('repeat-kind').onchange=repeatFields;
$('repeat-form').onsubmit=event=>{
  event.preventDefault();const kind=$('repeat-kind').value,rule=kind==='none'?null:{kind};
  if(kind==='weekly'){rule.days=[...$('repeat-days').querySelectorAll('input:checked')].map(i=>Number(i.value));if(!rule.days.length){notify('请至少选择一个星期');return;}}
  if(kind==='monthly'){rule.day=Number($('repeat-day').value);if(!Number.isInteger(rule.day)||rule.day<1||rule.day>31){notify('请填写 1–31');return;}}
  if(repeatTarget==='new'){newRepeat=rule;if(rule&&!$('new-date').value)$('new-date').value=today();$('new-repeat').textContent=repeatLabel(rule);}
  else{editRepeat=rule;if(rule&&!$('edit-date').value)$('edit-date').value=today();$('edit-repeat').textContent=repeatLabel(rule);}
  $('repeat-dialog').close();
};
$('stop-repeat').onclick=()=>safely(async()=>{await api.stopSeries(editingOriginal.seriesId);editingOriginal.repeat={...editingOriginal.repeat,active:false};editRepeat=null;$('edit-repeat').textContent='已停止';$('stop-repeat').hidden=true;await refresh(true);notify('已停止后续重复，现有期次保留');});
$('skip-repeat').onclick=()=>$('confirm-skip').showModal();
$('confirm-skip-button').onclick=()=>safely(async()=>{const n=await api.skipPrevious(editingOriginal.seriesId);$('confirm-skip').close();$('edit-dialog').close();await refresh(true);notify(`已将 ${n} 个旧期移至 Cancelled`);});

const badgeNames={first:'第一小步',ten:'慢慢积累',fifty:'五十个小进展',hundred:'一百次做到',habit7:'小习惯发芽',habit30:'习惯生根',days7:'认真生活的一周'};
function queueCheer(badge){
  if(!celebrations)return;if(badge)queuedBadge=badge;
  // Merge events arriving in one polling burst; do not animate old events at launch.
  clearTimeout(cheerBatchTimer);cheerBatchTimer=setTimeout(()=>{
    clearTimeout(cheerTimer);celebrating=true;clearTimeout(collapseTimer);
    const proud=queuedBadge;queuedBadge=null;$('companion').classList.remove('cheering','proud');void $('companion').offsetWidth;
    $('companion').classList.add(proud?'proud':'cheering');$('cheer-label').textContent=proud?badgeNames[proud]:'又做好了一件小事';
    cheerTimer=setTimeout(()=>{celebrating=false;$('companion').classList.remove('cheering','proud');$('cheer-label').textContent='';scheduleCollapse();},proud?2200:1200);
  },100);
}
$('celebrations').onchange=()=>{celebrations=$('celebrations').checked;savePrefs();if(!celebrations){clearTimeout(cheerTimer);clearTimeout(cheerBatchTimer);queuedBadge=null;celebrating=false;$('companion').classList.remove('cheering','proud');$('cheer-label').textContent='';}};
async function checkReports(){if(!api.checkReports)return;const ready=await api.checkReports();if(ready.length)notify(`${ready.at(-1)} 月报准备好了，可以在成长册查看`);}
async function openGrowth(){
  growthData=await api.growth();$('growth-summary').textContent=`已经完成 ${growthData.lifetime} 个不同任务期次${growthData.legacyCount?`，含 ${growthData.legacyCount} 个日期未知的历史完成`:''}。按自己的节奏积累。`;
  const badges=$('badges');badges.replaceChildren();for(const b of growthData.catalog){const earned=growthData.badges.find(e=>e.id===b.id);const card=element('div','badge-card'+(earned?' earned':''));card.append(element('span','badge-seal',earned?'✓':'·'),element('strong','',b.name),element('small','',earned?earned.earnedDate:b.id.startsWith('habit')?`同一习惯累计 ${b.target} 期`:b.id==='days7'?'7 个不同日期有完成记录':`累计完成 ${b.target} 项`));badges.append(card);}
  const series=$('series-list');series.replaceChildren();for(const s of growthData.series){const row=element('div','series-setting');row.append(element('span','',s.title+' · '+repeatLabel(s.rule)+(s.active?'':' · 已停止')));if(s.active){const button=element('button','bevel','停止');button.onclick=()=>safely(async()=>{await api.stopSeries(s.id);await openGrowth();await refresh(true);});row.append(button);}series.append(row);}if(!growthData.series.length)series.append(element('p','activity','还没有重复任务。'));
  const current=today().slice(0,7),selected=$('report-month').value||current,months=[...new Set([current,...growthData.months])].sort().reverse();$('report-month').replaceChildren();for(const m of months){const o=element('option','',m);o.value=m;$('report-month').append(o);}$('report-month').value=months.includes(selected)?selected:current;
  await loadReport();if(!$('growth-dialog').open)$('growth-dialog').showModal();
}
async function loadReport(){
  reportData=await api.report($('report-month').value);const r=reportData,stats=$('report-stats');stats.replaceChildren();for(const [n,label]of [[r.total,'件小事已完成'],[r.activeDays,'天留下记录']]){const box=element('div','report-stat');box.append(element('strong','',String(n)),element('span','',label));stats.append(box);}
  const bars=$('report-categories');bars.replaceChildren();for(const [name,n]of Object.entries(r.categories)){const row=element('div','category-stat'),track=element('div','bar-track'),fill=element('div','bar-fill');fill.style.width=(r.total?n/r.total*100:0)+'%';track.append(fill);row.append(element('span','',name),track,element('span','',String(n)));bars.append(row);}
  $('report-habits').textContent=r.habits.length?'本月习惯：'+r.habits.map(h=>`${h.title} ${h.count} 次`).join(' · '):'习惯可以慢慢养成，不要求连续。';
  $('report-badges').textContent=r.badges.length?'本月徽章：'+r.badges.map(b=>b.name).join(' · '):'本月还没有新徽章，已有徽章一直保留。';
  $('report-message').textContent=r.message;$('report-asof').textContent='统计截至 '+new Date(r.asOf).toLocaleString()+'。撤销完成会更新统计，日期未知的历史完成不计入本月。';
}
$('growth').onclick=()=>safely(openGrowth);$('report-month').onchange=()=>safely(loadReport);
$('export-report').onclick=()=>safely(async()=>{const button=$('export-report');button.disabled=true;try{const path=await api.exportReport({month:$('report-month').value,includeTitles:$('export-titles').checked});if(path)notify('月报图片已保存');}finally{button.disabled=false;}});
