import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { mapLegacyInput } from '../src/model/schema.js';
import { solveSchedule } from '../src/model/solver.js';
import { validateInput } from '../src/importExcel.js';

const file = new URL('../public/examples/large-school-schedule-demo.xlsx', import.meta.url);
const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer' });
const get = name => XLSX.utils.sheet_to_json(wb.Sheets[name], { range: 1, defval: '' });
const input = mapLegacyInput({
  classes: get('Classes'), teachers: get('Teachers'), courses: get('Courses'),
  availability: get('TeacherAvailability'), rooms: get('Rooms'),
  fixed: get('FixedActivities'), staffAssignments: get('StaffAssignments')
});

if (input.classes.length !== 54) throw new Error(`範例班級應為 54，實際 ${input.classes.length}`);
if (input.teachers.length !== 124) throw new Error(`範例教師應為 124，實際 ${input.teachers.length}`);
if (input.courses.length !== 630) throw new Error(`範例課程列應為 630，實際 ${input.courses.length}`);
const validation = validateInput(input);
if (validation.errors.length) throw new Error(`範例驗證失敗：${validation.errors.join('；')}`);

const result = solveSchedule({
  ...input, fixed: input.fixedActivities,
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], periodsPerDay: 8, timeoutMs: 30000
});
if (!result.success || result.pending.length) {
  throw new Error(`大型範例排課失敗：success=${result.success}, pending=${result.pending.length}, timeout=${result.timedOut}`);
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
console.log(`大型範例 PASS：54 班、630 課程列、${result.schedule.length} 節、${result.elapsedMs}ms、0 pending`);
