import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { solveSchedule } from '../src/model/solver.js';
import { readScheduleWorkbook, validateInput } from '../src/importExcel.js';

const file = new URL('../public/school-scheduler-template.xlsx', import.meta.url);
const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
for (const name of ['使用說明','範例資料說明','班級','教師','課程','教師可排時段','教室','固定活動','行政職務']) {
  if (!wb.Sheets[name]) throw new Error(`標準範本缺少工作表：${name}`);
}
const input = readScheduleWorkbook(XLSX, wb);

if (input.classes.length !== 60) throw new Error(`標準範本班級應為 60，實際 ${input.classes.length}`);
if (input.teachers.length !== 136) throw new Error(`標準範本教師應為 136，實際 ${input.teachers.length}`);
if (input.courses.length !== 580) throw new Error(`標準範本課程列應為 580，實際 ${input.courses.length}`);
const periodsByGrade = Object.fromEntries([1,2,3,4,5,6].map(grade => [grade,
  input.courses.filter(course => String(course.class).startsWith(String(grade))).reduce((sum, course) => sum + course.weekly_period, 0) / 10
]));
if (JSON.stringify(periodsByGrade) !== JSON.stringify({1:23,2:23,3:28,4:28,5:30,6:30})) {
  throw new Error(`各年級每班節數不符課綱擬真假設：${JSON.stringify(periodsByGrade)}`);
}
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
if (result.schedule.length !== 1620) throw new Error(`標準範本應排入 1620 節，實際 ${result.schedule.length}`);
if (result.elapsedMs > 15000) throw new Error(`標準範本應於 15 秒內完成，實際 ${result.elapsedMs}ms`);
console.log(`標準範本 PASS：60 班、580 課程列、${result.schedule.length} 節、${result.elapsedMs}ms、${result.searchStats.nodes} nodes、0 pending`);
