const pad=n=>String(n).padStart(2,'0');
function localDate(d=new Date()){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&s>='1900-01-01'&&s<='9999-12-31'&&!isNaN(new Date(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
function plusDay(s){const d=new Date(s+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function normalizeRule(rule,start){
  if(!rule||rule.kind==='none')return null;
  if(!validDate(start))throw new Error('重复任务需要有效的开始日期');
  if(!['daily','weekdays','weekly','monthly'].includes(rule.kind))throw new Error('重复类型无效');
  const result={kind:rule.kind};
  if(rule.kind==='weekly'){
    if(!Array.isArray(rule.days)||!rule.days.length||rule.days.some(d=>!Number.isInteger(d)||d<0||d>6))throw new Error('请至少选择一个星期');
    result.days=[...new Set(rule.days)].sort();
  }
  if(rule.kind==='monthly'){
    const day=rule.day??Number(start.slice(8));if(!Number.isInteger(day)||day<1||day>31)throw new Error('每月日期需要 1–31');result.day=day;
  }
  return result;
}
function matches(date,rule){
  const d=new Date(date+'T12:00:00Z'),weekday=d.getUTCDay();
  if(rule.kind==='daily')return true;
  if(rule.kind==='weekdays')return weekday>0&&weekday<6;
  if(rule.kind==='weekly')return rule.days.includes(weekday);
  const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  return d.getUTCDate()===Math.min(rule.day,last);
}
function nextDate(start,rule){let date=start;for(let i=0;i<370;i++,date=plusDay(date))if(matches(date,rule))return date;throw new Error('无法生成下一期');}
module.exports={localDate,validDate,plusDay,normalizeRule,matches,nextDate};
