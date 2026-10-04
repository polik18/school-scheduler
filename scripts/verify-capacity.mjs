import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { mapLegacyInput } from '../src/model/schema.js';
import { solveSchedule } from '../src/model/solver.js';
import { readScheduleWorkbook } from '../src/importExcel.js';

const wb = XLSX.read(fs.readFileSync(new URL('../public/school-scheduler-template.xlsx', import.meta.url)), { type: 'buffer' });
const input60 = readScheduleWorkbook(XLSX, wb);
const raw = {
  classes: [...input60.classes], teachers: [...input60.teachers], courses: [...input60.courses],
  rooms: [...input60.rooms], fixed: [...input60.fixedActivities]
};

// 將 60 班標準範本擴成 72 班；新班同時包含跨班科任、連堂、專科教室與固定活動。
for (let grade = 1; grade <= 6; grade++) {
  for (const number of [11, 12]) {
    const id = `${grade}${String(number).padStart(2, '0')}`;
    const teacher = `Z-H-${id}`;
    raw.classes.push({ class_id: id, grade: `${grade}年級`, class_name: `${grade}年${number}班`, students: 30, homeroom_teacher: teacher });
    raw.teachers.push({ teacher_id: teacher, name: `72班壓測級任${id}`, subject: '級任', max_daily_period: 7, max_continuous_period: 4 });
    raw.courses.push({ class: id, subject: '國語', teacher, weekly_period: 3, room_required: 'normal', double_period: false });
    raw.courses.push({ class: id, subject: '數學', teacher, weekly_period: 3, room_required: 'normal', double_period: false });
    raw.courses.push({ class: id, subject: '英語', teacher: 'Z-ENG', weekly_period: 1, room_required: 'normal', double_period: false });
    raw.courses.push({ class: id, subject: '自然', teacher: 'Z-SCI', weekly_period: 2, room_required: '實驗教室', double_period: true });
    raw.courses.push({ class: id, subject: '資訊', teacher: 'Z-IT', weekly_period: 1, room_required: '電腦教室', double_period: false });
    raw.rooms.push({ room_id: `R${id}`, type: 'normal', capacity: 35 });
    raw.fixed.push({ activity: '壓測集會', weekday: 'Mon', period: 1, class: id, teacher: '' });
  }
}
for (const [teacher_id, name, subject] of [
  ['Z-ENG', '72班壓測英語', '英語'], ['Z-SCI', '72班壓測自然', '自然'], ['Z-IT', '72班壓測資訊', '資訊']
]) raw.teachers.push({ teacher_id, name, subject, max_daily_period: 8, max_continuous_period: 4 });

const input = mapLegacyInput(raw);
const result = solveSchedule({ ...input, fixed: input.fixedActivities, days: ['Mon','Tue','Wed','Thu','Fri'], periodsPerDay: 8, timeoutMs: 5000 });
if (input.classes.length !== 72) throw new Error(`72 班壓測資料錯誤：${input.classes.length}`);
if (!result.success && !result.timedOut && !result.pending.length) throw new Error('72 班不可行時沒有診斷。');
if (!result.schedule.length) throw new Error('72 班壓測沒有保留任何可行部分結果。');

const classSlots = new Set(), teacherSlots = new Set(), roomSlots = new Set();
for (const lesson of result.schedule) {
  const suffix = `${lesson.day}-${lesson.period}`;
  for (const [set, key] of [[classSlots, `${lesson.class}-${suffix}`], [teacherSlots, `${lesson.teacher}-${suffix}`], [roomSlots, lesson.room_id ? `${lesson.room_id}-${suffix}` : '']]) {
    if (!key) continue;
    if (set.has(key)) throw new Error(`72 班部分結果有硬衝突：${key}`);
    set.add(key);
  }
}
console.log(`72 班壓力門禁 PASS：scheduled=${result.schedule.length}, pending=${result.pending.length}, timedOut=${result.timedOut}, ${result.elapsedMs}ms`);
