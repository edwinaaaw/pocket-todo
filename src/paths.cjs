const {join} = require('node:path');
const {homedir} = require('node:os');
function dataDir() {
  if(process.env.POCKET_TODO_DATA_DIR) return process.env.POCKET_TODO_DATA_DIR;
  const base=process.platform==='darwin' ? join(homedir(),'Library','Application Support') : process.platform==='win32' ? (process.env.APPDATA || join(homedir(),'AppData','Roaming')) : (process.env.XDG_DATA_HOME || join(homedir(),'.local','share'));
  return join(base,'Pocket Todo');
}
module.exports={dataDir,dbPath:()=>join(dataDir(),'todos.sqlite')};
