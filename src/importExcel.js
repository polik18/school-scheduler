import {mapLegacyInput} from './model/schema.js';

function sheet(XLSX,wb,names){
 const name=names.find(n=>wb.Sheets[n]);
 return name?XLSX.utils.sheet_to_json(wb.Sheets[name]):[];
}
function normalize(rows){return rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[String(k).trim(),typeof v==='string'?v.trim():v])))}

export function readSchoolExcel(file){
 return new Promise((resolve,reject)=>{
  const r=new FileReader();
  r.onload=async e=>{
   try{
    const XLSX=await import('xlsx');
    const wb=XLSX.read(e.target.result,{type:'array'});
    resolve(mapLegacyInput({
     classes:normalize(sheet(XLSX,wb,['Classes','班級'])),
     teachers:normalize(sheet(XLSX,wb,['Teachers','教師'])),
     courses:normalize(sheet(XLSX,wb,['Courses','課程'])),
     availability:normalize(sheet(XLSX,wb,['TeacherAvailability','教師可用時間'])),
     rooms:normalize(sheet(XLSX,wb,['Rooms','教室'])),
     fixed:normalize(sheet(XLSX,wb,['FixedActivities','固定活動']))
    }));
   }catch(err){reject(err)}
  };
  r.onerror=reject;
  r.readAsArrayBuffer(file);
 });
}

export function validateInput(data){
 const errors=[]; const warnings=[];
 if(!data.courses?.length) errors.push('課程資料為空');
 if(!data.teachers?.length) errors.push('教師資料為空');
 const teachers=new Set((data.teachers||[]).map(x=>x.teacher_id));
 (data.courses||[]).forEach((c,i)=>{
  if(!c.class) errors.push(`第${i+1}筆課程缺少班級`);
  if(!c.subject) errors.push(`第${i+1}筆課程缺少科目`);
  if(!teachers.has(c.teacher)) errors.push(`第${i+1}筆課程教師不存在`);
 });
 if(!(data.rooms||[]).length) warnings.push('未建立教室資料，將使用預設普通教室');
 return {errors,warnings};
}
