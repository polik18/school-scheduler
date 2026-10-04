import {mapLegacyInput} from './model/schema.js';
import {staffingPlanFromRows, validateStaffingPlan} from './model/staffing.js';

// 從 raw rows（header:1 陣列）中偵測「含英文欄位名」的那一行當標題，回傳資料列
function sheetRows(rows, keys){
 if(!rows||!rows.length) return [];
 const lower=keys.map(k=>k.toLowerCase());
 let bestRow=null, bestScore=0;
 rows.forEach(r=>{
  const cells=(r||[]).map(c=>String(c||'').toLowerCase());
  let score=0;
  lower.forEach(k=>{ if(cells.includes(k)) score++; });
  if(score>bestScore){ bestScore=score; bestRow=r; }
 });
 if(!bestRow || bestScore<2) return [];
 const header=bestRow.map(c=>String(c||'').toLowerCase());
 const idx={};
 header.forEach((h,i)=>{ if(!(h in idx)) idx[h]=i; });
 const data=[];
 for(let i=rows.indexOf(bestRow)+1;i<rows.length;i++){
  const r=rows[i]; if(!r) continue;
  if((r||[]).every(c=>c===undefined||c===null||String(c).trim()===''||String(c).toLowerCase()=='未填'||String(c).toLowerCase()==='none')) continue;
  const obj={};
  Object.keys(idx).forEach(k=>{ const v=r[idx[k]]; if(v!==undefined&&v!==null&&String(v)!=='') obj[k]=v; });
  if(Object.keys(obj).length) data.push(obj);
 }
 return data;
}

function sheet(XLSX,wb,names,keys){
 const name=names.find(n=>wb.Sheets[n]);
 if(!name) return [];
 const raw=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1});
 return normalize(sheetRows(raw,keys));
}
function normalize(rows){return rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[String(k).trim(),typeof v==='string'?v.trim():v])))}

export function readSchoolExcel(file){
 return new Promise((resolve,reject)=>{
  const r=new FileReader();
  r.onload=async e=>{
   try{
    const XLSX=await import('xlsx');
    const wb=XLSX.read(e.target.result,{type:'array'});
    if (isStaffingWorkbook(wb)) {
     const staffingPlan=readStaffingWorkbook(XLSX,wb);
     resolve({kind:'staffing',staffingPlan,staffingValidation:validateStaffingPlan(staffingPlan),classes:[],teachers:[],courses:[],rooms:[],fixedActivities:[],staffAssignments:[]});
     return;
    }
    resolve({...mapLegacyInput({
     classes:normalize(sheet(XLSX,wb,['Classes','班級'],['class_id','grade','class_name','students'])),
     teachers:normalize(sheet(XLSX,wb,['Teachers','教師'],['teacher_id','name','subject','max_daily_period','max_continuous_period'])),
     courses:normalize(sheet(XLSX,wb,['Courses','課程'],['class','subject','teacher','weekly_period','room_required','double_period'])),
     availability:normalize(sheet(XLSX,wb,['TeacherAvailability','教師可用時間'],['teacher','weekday','period','available','reason'])),
     rooms:normalize(sheet(XLSX,wb,['Rooms','教室'],['room_id','type','capacity'])),
     fixed:normalize(sheet(XLSX,wb,['FixedActivities','固定活動'],['activity','weekday','period','class','teacher'])),
     staffAssignments:normalize(sheet(XLSX,wb,['StaffAssignments','行政職務'],['department','job_title','teacher','name','note']))
    }),kind:'schedule'});
   }catch(err){reject(err)}
  };
  r.onerror=reject;
  r.readAsArrayBuffer(file);
 });
}

export function isStaffingWorkbook(wb){
 return ['級任導師','科任教師','行政與支援人員'].some(name=>wb.Sheets?.[name]);
}

export function readStaffingWorkbook(XLSX,wb){
 const rows=name=>wb.Sheets[name]
  ? XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:''}).slice(1)
  : [];
 return staffingPlanFromRows({
  homeroomRows:rows('級任導師'),
  subjectRows:rows('科任教師'),
  administrationRows:rows('行政與支援人員')
 });
}

export function validateInput(data){
 const errors=[]; const warnings=[];
 if(!data.courses?.length) errors.push('課程資料為空');
 if(!data.teachers?.length) errors.push('教師資料為空');
 const teachers=new Set((data.teachers||[]).map(x=>x.teacher_id));
 const classes=new Set((data.classes||[]).map(x=>x.class_id));
 const duplicateIds=(items,key)=>items.map(x=>x[key]).filter((x,i,a)=>x&&a.indexOf(x)!==i);
 duplicateIds(data.teachers||[],'teacher_id').forEach(id=>errors.push(`教師編號重複：${id}`));
 duplicateIds(data.classes||[],'class_id').forEach(id=>errors.push(`班級編號重複：${id}`));
 (data.courses||[]).forEach((c,i)=>{
  if(!c.class) errors.push(`第${i+1}筆課程缺少班級`);
  if(!c.subject) errors.push(`第${i+1}筆課程缺少科目`);
  if(!teachers.has(c.teacher)) errors.push(`第${i+1}筆課程教師不存在`);
  if(c.class&&!classes.has(c.class)) errors.push(`第${i+1}筆課程班級不存在`);
  if(!Number.isFinite(c.weekly_period)||c.weekly_period<1) errors.push(`第${i+1}筆課程每週節數必須大於 0`);
 });
 if(!(data.rooms||[]).length) warnings.push('未建立教室資料，將使用預設普通教室');
 return {errors,warnings};
}
