import {isTeacherAvailable,isFixedAllowed,isClassAvailable} from './constraints';
import {checkHardConstraints} from './solver/constraintEngine';
import {sortHardCourses} from './solver/heuristics';
import {scoreSchedule} from './solver/scoringEngine';


// V8 CSP 排課核心：最少剩餘值(MRV)+懲罰評分搜尋
function expandCourses(courses){
 const units=[];
 for(const c of courses){
  const count=Number(c.periods||c.hours||1);
  for(let i=0;i<count;i++) units.push({...c,unit:i+1});
 }
 return units;
}

function key(a,b,c){return `${a}-${b}-${c}`}

export function solveSchedule(input){
 const {courses=[],days=['Mon','Tue','Wed','Thu','Fri'],periodsPerDay=8,rooms=[],fixed=[],teachers=[],classes=[]}=input;
 const slots=days.flatMap(day=>Array.from({length:periodsPerDay},(_,i)=>({day,period:i+1})));
 const units=sortHardCourses(expandCourses(courses));
 const startTime=Date.now();
 const timeoutMs=input.timeoutMs||30000;
 let bestSchedule=[];
 let bestScore=-Infinity;
 const state={teacher:new Set(),cls:new Set(),room:new Set()};
 const result=[];

 const roomFor=(course,slot)=>{
  if(!course.roomType) return '';
  const r=rooms.find(x=>(x.type||x.roomType)===course.roomType && !state.room.has(key(x.roomId||x.id,slot.day,slot.period)));
  return r?.roomId||r?.id||null;
 };

 const candidates=(course)=>slots.filter(slot=>{
  if(course.fixedDay && course.fixedDay!==slot.day) return false;
  if(course.fixedPeriod && Number(course.fixedPeriod)!==slot.period) return false;
  if(!isTeacherAvailable(course,slot,teachers)) return false;
  if(!isFixedAllowed(course,slot,fixed)) return false;
  if(!isClassAvailable(course,slot,classes)) return false;
  const hard=checkHardConstraints(course,slot,state,input);
  return hard.ok;
 });

 const place=(course,slot)=>{
  const room=roomFor(course,slot);
  state.teacher.add(key(course.teacherId,slot.day,slot.period));
  state.cls.add(key(course.classId,slot.day,slot.period));
  if(room) state.room.add(key(room,slot.day,slot.period));
  result.push({...course,day:slot.day,period:slot.period,roomId:room||'',status:'done'});
 };
 const remove=()=>{
  const x=result.pop();
  state.teacher.delete(key(x.teacherId,x.day,x.period));
  state.cls.delete(key(x.classId,x.day,x.period));
  if(x.roomId) state.room.delete(key(x.roomId,x.day,x.period));
 };

 // Forward Checking：排入後確認剩餘課程仍存在可行節次
 function forwardCheck(left){
  return left.every(c=>candidates(c).length>0);
 }

 function search(left){
  if(Date.now()-startTime>timeoutMs) return false;
  if(left.length===0){
   const score=scoreSchedule(result);
   if(score>bestScore){bestScore=score;bestSchedule=[...result];}
   return true;
  }
  let best=null,bestList=null;
  for(const c of left){
   const list=candidates(c);
   if(!bestList||list.length<bestList.length){best=c;bestList=list;}
   if(list.length===0) return false;
  }
  // 偏好平均分散：先嘗試早期較少課的時段
  bestList.sort((a,b)=>a.period-b.period);
  for(const slot of bestList){
   place(best,slot);
   const remain=left.filter(x=>x!==best);
   if(forwardCheck(remain) && search(remain)) return true;
   remove();
  }
  return false;
 }

 const ok=search(units);
 const finalSchedule=ok?result:(bestSchedule.length?bestSchedule:result);
 return {success:ok,schedule:finalSchedule,score:scoreSchedule(finalSchedule),diagnostics:ok?[]:[{type:'constraint',message:bestSchedule.length?'已返回最佳可行方案':'限制條件不足，無法完成全部排課'}]};
}
