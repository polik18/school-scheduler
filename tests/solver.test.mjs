import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLegacyInput } from '../src/model/schema.js';
import { solveSchedule } from '../src/model/solver.js';
import { diagnosePendingCourse } from '../src/model/diagnosis.js';

// 簡易但真實的範例資料（3 班 3 師）
function buildSampleInput() {
  const teachers = [
    { teacher_id: 'T01', name: '王老師', subject: '國文', max_daily_period: 8, max_continuous_period: 4 },
    { teacher_id: 'T02', name: '李老師', subject: '數學', max_daily_period: 8, max_continuous_period: 4 },
    { teacher_id: 'T03', name: '陳老師', subject: '英語', max_daily_period: 8, max_continuous_period: 4 },
  ];
  const classes = [
    { class_id: '101', grade: '一年級', class_name: '一年級 1 班', students: 20 },
    { class_id: '102', grade: '一年級', class_name: '一年級 2 班', students: 20 },
    { class_id: '103', grade: '一年級', class_name: '一年級 3 班', students: 20 },
  ];
  const courses = [];
  for (const id of ['101', '102', '103']) {
    courses.push({ class: id, subject: '國文', teacher: 'T01', weekly_period: 2, room_required: 'normal', double_period: false });
    courses.push({ class: id, subject: '數學', teacher: 'T02', weekly_period: 2, room_required: 'normal', double_period: false });
    courses.push({ class: id, subject: '英語', teacher: 'T03', weekly_period: 2, room_required: 'normal', double_period: false });
  }
  return mapLegacyInput({ teachers, classes, courses, availability: [], rooms: [], fixed: [] });
}

test('mapLegacyInput 正確轉換資料', () => {
  const input = buildSampleInput();
  assert.equal(input.classes.length, 3);
  assert.equal(input.teachers.length, 3);
  assert.equal(input.courses.length, 9);
  // weekly_period 轉成 Number
  assert.equal(input.courses[0].weekly_period, 2);
  // room_required 預設 normal
  assert.equal(input.courses[0].room_required, 'normal');
});

test('solveSchedule 能成功排入全部課程', () => {
  const input = buildSampleInput();
  const res = solveSchedule({
    courses: input.courses,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periodsPerDay: 8,
    rooms: input.rooms,
    fixed: input.fixedActivities,
    teachers: input.teachers,
    classes: input.classes,
  });
  assert.equal(res.success, true);
  assert.equal(res.pending.length, 0);
  // expandCourses 把每門課拆成 weekly_period 個 unit，故 schedule 長度 = 9 門 × 2 = 18
  assert.equal(res.schedule.length, 18);
});

test('solveSchedule 尊重教師每日節數上限', () => {
  // 讓 T01 每天最多 2 節（6 節國文 / 5 天 = 可行），驗證不超過上限
  const input = buildSampleInput();
  input.teachers[0].max_daily_period = 2;
  const res = solveSchedule({
    courses: input.courses,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periodsPerDay: 8,
    rooms: input.rooms,
    fixed: [],
    teachers: input.teachers,
    classes: input.classes,
  });
  assert.equal(res.success, true);
  // 檢查 T01 任何一天不超過 2 節國文
  const t1 = res.schedule.filter(c => c.teacher === 'T01');
  const perDay = {};
  t1.forEach(c => { perDay[c.day] = (perDay[c.day] || 0) + 1; });
  for (const d of Object.keys(perDay)) {
    assert.ok(perDay[d] <= 2, `T01 在 ${d} 排了 ${perDay[d]} 節，超過上限 2`);
  }
});

test('solveSchedule 不排入教師不可教的時段', () => {
  const input = buildSampleInput();
  // T01 週一第 1 節不可教
  input.teachers[0].unavailable = [{ weekday: 'Mon', period: 1 }];
  const res = solveSchedule({
    courses: input.courses,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periodsPerDay: 8,
    rooms: input.rooms,
    fixed: [],
    teachers: input.teachers,
    classes: input.classes,
  });
  assert.equal(res.success, true);
  const busy = new Set();
  res.schedule.forEach(c => { if (c.teacher === 'T01') busy.add(`${c.day}-${c.period}`); });
  assert.ok(!busy.has('Mon-1'), 'T01 被排在週一第 1 節，違反不可教限制');
});

test('solveSchedule 尊重專教教室限制', () => {
  const input = buildSampleInput();
  // 數學需要實驗教室，但只有一間普通教室 → 無法排入
  input.courses.forEach(c => { if (c.subject === '數學') c.room_required = '實驗教室'; });
  const res = solveSchedule({
    courses: input.courses,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periodsPerDay: 8,
    rooms: [{ room_id: 'R1', type: 'normal', capacity: 30 }],
    fixed: [],
    teachers: input.teachers,
    classes: input.classes,
  });
  // 數學（需實驗教室）排不進 → pending > 0
  assert.ok(res.pending.length > 0, '數學需實驗教室但無此類型教室，應有 pending');
});

test('solveSchedule 固定活動會占用時段', () => {
  const input = buildSampleInput();
  input.fixedActivities = [{ activity: '班會', weekday: 'Mon', period: 1, class: '101', teacher: 'T01' }];
  const res = solveSchedule({
    courses: input.courses,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periodsPerDay: 8,
    rooms: input.rooms,
    fixed: input.fixedActivities,
    teachers: input.teachers,
    classes: input.classes,
  });
  assert.equal(res.success, true);
  // 101 班週一第 1 節應被班會占用（不在 solver 排課結果中，但 occupies slot）
  const occ = res.schedule.filter(c => c.class === '101' && c.day === 'Mon' && c.period === 1);
  assert.equal(occ.length, 0, '班會已佔用 101 班週一第 1 節，solver 不應再排課至此');
});

test('courseFeasibility 正確列出可行時段', () => {
  const input = buildSampleInput();
  const course = input.courses[0]; // 101 國文 T01
  const res = diagnosePendingCourse(course, {
    courses: input.courses,
    teachers: input.teachers,
    rooms: input.rooms,
    fixed: input.fixedActivities,
    classes: input.classes,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  });
  // 正常情況診斷不應回報「找不到教師」
  assert.ok(!res.some(r => r.message.includes('找不到教師')));
});

test('solveSchedule 空資料不崩潰', () => {
  const res = solveSchedule({ courses: [], days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], periodsPerDay: 8, rooms: [], fixed: [], teachers: [], classes: [] });
  assert.equal(res.success, true);
  assert.equal(res.schedule.length, 0);
  assert.equal(res.pending.length, 0);
});

test('solveSchedule 單班單課基本排入', () => {
  const teachers = [{ teacher_id: 'T01', name: '王', subject: '國文', max_daily_period: 8, max_continuous_period: 4 }];
  const classes = [{ class_id: '101', grade: '一年級', class_name: '一年級 1 班', students: 20 }];
  const courses = [{ class: '101', subject: '國文', teacher: 'T01', weekly_period: 1, room_required: 'normal', double_period: false }];
  const input = mapLegacyInput({ teachers, classes, courses, availability: [], rooms: [], fixed: [] });
  const res = solveSchedule({ courses: input.courses, days: ['Mon'], periodsPerDay: 8, rooms: input.rooms, fixed: [], teachers: input.teachers, classes: input.classes });
  assert.equal(res.success, true);
  assert.equal(res.schedule.length, 1);
  assert.equal(res.schedule[0].day, 'Mon');
});

test('solveSchedule 尊重教師最大連續節數', () => {
  const res = solveSchedule({
    courses: [
      { class: '101', subject: '甲', teacher: 'T01', weekly_period: 2 },
      { class: '102', subject: '乙', teacher: 'T01', weekly_period: 2 }
    ],
    days: ['Mon', 'Tue'], periodsPerDay: 4, rooms: [], fixed: [], classes: [],
    teachers: [{ teacher_id: 'T01', max_daily_period: 4, max_continuous_period: 1 }]
  });
  assert.equal(res.success, true);
  for (const day of ['Mon', 'Tue']) {
    const periods = res.schedule.filter(x => x.teacher === 'T01' && x.day === day).map(x => x.period);
    for (const p of periods) assert.ok(!periods.includes(p + 1), `${day} 出現連續節次 ${p}, ${p + 1}`);
  }
});

test('solveSchedule 連堂課必須排在同日相鄰節次', () => {
  const res = solveSchedule({
    courses: [{ class: '101', subject: '實驗', teacher: 'T01', weekly_period: 2, double_period: true }],
    days: ['Mon', 'Tue'], periodsPerDay: 4, rooms: [], fixed: [],
    teachers: [{ teacher_id: 'T01', max_daily_period: 4, max_continuous_period: 4 }]
  });
  assert.equal(res.success, true);
  assert.equal(res.schedule.length, 2);
  const sorted = [...res.schedule].sort((a, b) => a.period - b.period);
  assert.equal(sorted[0].day, sorted[1].day);
  assert.equal(sorted[1].period, sorted[0].period + 1);
});

test('solveSchedule 固定活動會同時佔用教師', () => {
  const res = solveSchedule({
    courses: [{ class: '102', subject: '國語', teacher: 'T01', weekly_period: 1 }],
    days: ['Mon'], periodsPerDay: 2, rooms: [], classes: [],
    fixed: [{ activity: '班會', weekday: 'Mon', period: 1, class: '101', teacher: 'T01' }],
    teachers: [{ teacher_id: 'T01', max_daily_period: 2, max_continuous_period: 2 }]
  });
  assert.equal(res.success, true);
  assert.equal(res.schedule[0].period, 2);
});

test('solveSchedule 鎖定一節不會丟失同課程其餘每週節數', () => {
  const course = { class: '101', subject: '國語', teacher: 'T01', weekly_period: 3 };
  const res = solveSchedule({
    courses: [course], days: ['Mon', 'Tue'], periodsPerDay: 3, rooms: [], fixed: [], classes: [],
    teachers: [{ teacher_id: 'T01', max_daily_period: 3, max_continuous_period: 3 }],
    locked: [{ class: '101', subject: '國語', teacher: 'T01', unit: 1, day: 'Tue', period: 3 }]
  });
  assert.equal(res.success, true);
  assert.equal(res.schedule.length, 3);
  assert.ok(res.schedule.some(x => x.day === 'Tue' && x.period === 3 && x.locked));
});

test('mapLegacyInput 不會把字串 false 當成連堂', () => {
  const mapped = mapLegacyInput({
    teachers: [{ teacher_id: 'T01' }],
    courses: [{ class: '101', subject: '國語', teacher: 'T01', double_period: 'false' }],
    availability: [{ teacher: 'T01', weekday: 'Mon', period: 1, available: 'false' }]
  });
  assert.equal(mapped.courses[0].double_period, false);
  assert.deepEqual(mapped.teachers[0].unavailable, [{ weekday: 'Mon', period: 1 }]);
});
