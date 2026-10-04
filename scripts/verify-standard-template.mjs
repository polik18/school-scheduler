import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { solveSchedule } from '../src/model/solver.js';
import { readScheduleWorkbook, validateInput } from '../src/importExcel.js';

const file = new URL('../public/school-scheduler-template.xlsx', import.meta.url);
const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
const input = readScheduleWorkbook(XLSX, wb);

if (input.classes.length !== 60) throw new Error(`標準範本班級應為 60，實際 ${input.classes.length}`);
if (input.teachers.length !== 136) throw new Error(`標準範本教師應為 136，實際 ${input.teachers.length}`);
if (input.courses.length !== 678) throw new Error(`標準範本課程列應為 678，實際 ${input.courses.length}`);
const validation = validateInput(input);
if (validation.errors.length) throw new Error(`範例驗證失敗：${validation.errors.join('；')}`);

const result = solveSchedule({
  ...input, fixed: input.fixedActivities,
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], periodsPerDay: 8, timeoutMs: 30000
});
if (!result.success || result.pending.length) {
  throw new Error(`標準範本排課失敗：success=${result.success}, pending=${result.pending.length}, timeout=${result.timedOut}`);
}
const seenClass = new Set(), seenTeacher = new Set(), seenRoom = new Set();
for (const lesson of result.schedule) {
  const suffix = `${lesson.day}-${lesson.period}`;
  for (const [set, key, label] of [
    [seenClass, `${lesson.class}-${suffix}`, '班級'],
    [seenTeacher, `${lesson.teacher}-${suffix}`, '教師'],
    [seenRoom, lesson.room_id ? `${lesson.room_id}-${suffix}` : '', '教室']
  ]) {
    if (!key) continue;
    if (set.has(key)) throw new Error(`${label}時段衝突：${key}`);
    set.add(key);
  }
}
if (result.schedule.length !== 924) throw new Error(`標準範本應排入 924 節，實際 ${result.schedule.length}`);
console.log(`標準範本 PASS：60 班、678 課程列、${result.schedule.length} 節、${result.elapsedMs}ms、0 pending`);
