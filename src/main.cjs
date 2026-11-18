const {app,BrowserWindow,ipcMain,screen,Tray,Menu,nativeImage,clipboard,dialog}=require('electron');
const {join}=require('node:path');
const {mkdirSync,writeFileSync}=require('node:fs');
const {createStore}=require('./store.cjs');
const {dbPath,dataDir}=require('./paths.cjs');
const {boundsFor,dockAnchor}=require('./window.cjs');
const {reportHTML}=require('./report.cjs');
app.setName('Pocket Todo');
// Keep renderer caches beside the database; test runs use an isolated data directory.
mkdirSync(dataDir(),{recursive:true});
app.setPath('userData',dataDir());
let win,tray,store,anchor,expanded=false,dragState=null,dragTimer,undo=null;
const locked=app.requestSingleInstanceLock();
if(!locked) app.quit();
else app.whenReady().then(()=>{
  store=createStore(dbPath());
  const area=screen.getPrimaryDisplay().workArea;
  const saved=store.meta('anchor');
  anchor=saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y)?saved:{x:area.x+area.width-414,y:area.y+80};
  function areaFor(){return screen.getDisplayNearestPoint({x:Math.round(anchor.x),y:Math.round(anchor.y)}).workArea;}
  function mode(value){const area=areaFor();if(!value||!expanded)anchor=dockAnchor(area);expanded=!!value; const bounds=boundsFor(anchor,expanded,area);win.setBounds(bounds);win.webContents.send('mode',expanded);}
  win=new BrowserWindow({...boundsFor(anchor,true,areaFor()),frame:false,transparent:true,backgroundColor:'#00000000',hasShadow:false,resizable:false,alwaysOnTop:true,skipTaskbar:true,show:false,minimizable:false,maximizable:false,fullscreenable:false,webPreferences:{preload:join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true}});
  win.setAlwaysOnTop(true,'floating');
  win.setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true});
  if(process.platform==='darwin') app.dock.hide();
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',event=>event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  const handle=(channel,fn)=>ipcMain.handle(channel,(event,...args)=>{
    if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame) throw new Error('Unknown caller');
    return fn(...args);
  });
  handle('todos:list',()=>store.list());
  handle('todos:snapshot',after=>{const state=store.snapshot();return {...state,events:after===null?[]:store.events(after).filter(e=>e.seq<=state.cursor)};});
  handle('growth',()=>store.growth());
  handle('report',month=>store.report(month));
  handle('reports:check',()=>store.checkReports());
  handle('series:stop',id=>store.stopSeries(id));
  handle('series:skip',id=>store.skipPrevious(id));
  handle('report:export',async({month,includeTitles=false})=>{
    const report=store.report(month);
    const result=await dialog.showSaveDialog(win,{title:'保存月报图片',defaultPath:`Pocket Todo ${month}.png`,filters:[{name:'PNG image',extensions:['png']}]});
    if(result.canceled)return null;
    const page=new BrowserWindow({width:900,height:1100,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
    try{
      await page.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(reportHTML(report,!!includeTitles)));
      const height=await page.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
      if(height>16000)throw new Error('月报图片过长，请关闭任务标题后再导出');
      page.setContentSize(900,height);
      await page.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const image=await page.webContents.capturePage();writeFileSync(result.filePath,image.toPNG());return result.filePath;
    }finally{page.destroy();}
  });
  handle('todos:add',input=>store.add(input));
  handle('todos:update',(id,patch)=>store.update(id,patch));
  handle('todos:remove',id=>{undo={task:store.remove(id),until:Date.now()+10000};return true;});
  handle('todos:undo',()=>{if(!undo||Date.now()>undo.until)throw new Error('撤销时间已过');const task=store.restore(undo.task);undo=null;return task;});
  handle('todos:reorder',input=>store.reorder(input));
  handle('preferences',value=>{
    if(value!==undefined){
      if(!value||typeof value!=='object')throw new Error('Invalid preferences');
      const clean={tab:['todo','pending','completed','cancelled'].includes(value.tab)?value.tab:'todo',collapsed:{},celebrations:value.celebrations!==false};
      for(const key of ['work','life','content','study']) clean.collapsed[key]=!!value.collapsed?.[key];
      store.meta('preferences',clean);
    }
    return store.meta('preferences');
  });
  handle('connections',()=>{
    const command=process.execPath,args=[join(__dirname,'mcp.cjs')];
    const env={ELECTRON_RUN_AS_NODE:'1',POCKET_TODO_DATA_DIR:dataDir()};
    const qwen=JSON.stringify({mcpServers:{'pocket-todo':{command,args,env}}},null,2);
    const codex=`[mcp_servers.pocket-todo]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\n\n[mcp_servers.pocket-todo.env]\nELECTRON_RUN_AS_NODE = "1"\nPOCKET_TODO_DATA_DIR = ${JSON.stringify(dataDir())}\n`;
    return {codex,qwen,lastActivity:store.meta('lastActivity'),dataPath:dbPath()};
  });
  handle('copy',text=>{if(typeof text!=='string'||text.length>20000)throw new Error('Invalid clipboard text');clipboard.writeText(text);});
  ipcMain.on('expand',(event,value)=>{if(event.sender===win.webContents&&!dragState)mode(value);});
  ipcMain.on('drag',(event,phase)=>{
    if(event.sender!==win.webContents)return;
    if(phase==='start'){
      clearInterval(dragTimer);dragState={cursor:screen.getCursorScreenPoint(),bounds:win.getBounds()};
      dragTimer=setInterval(()=>{
        const p=screen.getCursorScreenPoint(),b=dragState.bounds;
        const desired={x:b.x+p.x-dragState.cursor.x,y:b.y+p.y-dragState.cursor.y};
        const a=screen.getDisplayNearestPoint(p).workArea;
        win.setBounds(boundsFor(desired,expanded,a));
      },16);
    }else if(phase==='end'&&dragState){
      clearInterval(dragTimer);dragState=null;
      const b=win.getBounds();anchor={x:b.x,y:b.y};store.meta('anchor',anchor);
    }
  });
  const resetPosition=()=>{const b=boundsFor(anchor,false,areaFor());anchor={x:b.x,y:b.y};mode(expanded);};
  screen.on('display-removed',resetPosition);screen.on('display-metrics-changed',resetPosition);
  const pixels=Buffer.alloc(18*18*4);
  for(let y=0;y<18;y++)for(let x=0;x<18;x++){
    const on=(x>=3&&x<=7&&Math.abs(y-(x+4))<=1)||(x>=7&&x<=15&&Math.abs(y-(18-x))<=1);
    if(on)pixels[(y*18+x)*4+3]=255;
  }
  const icon=nativeImage.createFromBitmap(pixels,{width:18,height:18});icon.setTemplateImage(true);
  tray=new Tray(icon);tray.setToolTip('Pocket Todo');
  const show=()=>{mode(true);win.show();win.focus();};
  tray.setContextMenu(Menu.buildFromTemplate([{label:'打开 Pocket Todo',click:show},{label:'收起',click:()=>mode(false)},{type:'separator'},{label:'退出',click:()=>app.quit()}]));
  tray.on('click',show);app.on('second-instance',show);app.on('activate',show);
  win.loadFile(join(__dirname,'../ui/index.html'));
  win.once('ready-to-show',()=>{win.showInactive();mode(true);});
}).catch(error=>{console.error(error);app.quit();});
app.on('before-quit',()=>{clearInterval(dragTimer);store?.close();});
app.on('window-all-closed',()=>app.quit());
