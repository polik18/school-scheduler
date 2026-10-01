export function validateSchoolData(data){
 const errors=[], warnings=[];
 const classes = data.classes||[], teachers = data.teachers||[],
       courses = data.courses||[], rooms = data.rooms||[];
 const classIds   = new Set(classes.map(c=>c.class_id).filter(Boolean));
 const teacherIds = new Set(teachers.map(t=>t.teacher_id).filter(Boolean));
 const roomIds    = new Set(rooms.map(r=>r.room_id).filter(Boolean));
 const dup = {};
 teachers.forEach(t=>{ if(t.teacher_id) dup[t.teacher_id]=(dup[t.teacher_id]||0)+1; });
 courses.forEach((c,i)=>{
  const n=i+1;
  if(!c.class) errors.push(`課程${n}：缺少班級`);
  else if(!classIds.has(c.class)) errors.push(`第${n}列：找不到班級 "${c.class}"`);
  if(!c.teacher) errors.push(`課程${n}：教師欄位空白`);
  else if(!teacherIds.has(c.teacher)) errors.push(`第${n}列：找不到教師 "${c.teacher}"`);
  if(!c.subject) errors.push(`課程${n}：缺少科目`);
  if(c.room_required && c.room_required!=='normal' && !roomIds.has(c.room_required))
   errors.push(`第${n}列：教室 "${c.room_required}" 不存在`);
 });
 for(const id in dup) if(dup[id]>1) errors.push(`重複教師：${id} 出現 ${dup[id]} 次`);
 if(!classes.length) warnings.push('未建立班級資料');
 if(!teachers.length) warnings.push('未建立教師資料');
 if(!rooms.length) warnings.push('未建立教室資料');
 return {errors,warnings};
}
