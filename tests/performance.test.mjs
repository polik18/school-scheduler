import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLegacyInput } from '../src/model/schema.js';
import { solveSchedule } from '../src/model/solver.js';

// 台灣國小 6 年級 × 5 班 = 30 班（回應「老師安心測試 30 班 30 秒排課」）
const GRADES = [
  { g: '一年級', ids: ['101', '102', '103', '104', '105'] },
  { g: '二年級', ids: ['201', '202', '203', '204', '205'] },
  { g: '三年級', ids: ['301', '302', '303', '304', '305'] },
  { g: '四年級', ids: ['401', '402', '403', '404', '405'] },
  { g: '五年級', ids: ['501', '502', '503', '504', '505'] },
  { g: '六年級', ids: ['601', '602', '603', '604', '605'] },
];

const byGroup = {
  國文: [['T01', GRADES[0].ids], ['T02', GRADES[1].ids], ['T03', GRADES[2].ids], ['T04', GRADES[3].ids], ['T05', GRADES[4].ids], ['T06', GRADES[5].ids]],
  數學: [['T11', GRADES[0].ids], ['T12', GRADES[1].ids], ['T13', GRADES[2].ids], ['T14', GRADES[3].ids], ['T15', GRADES[4].ids], ['T16', GRADES[5].ids]],
  英語: [['T21', GRADES[0].ids], ['T22', GRADES[1].ids], ['T23', GRADES[2].ids], ['T24', GRADES[3].ids], ['T25', GRADES[4].ids], ['T26', GRADES[5].ids]],
  自然: [['T31', [...GRADES[0].ids, ...GRADES[1].ids]], ['T32', [...GRADES[2].ids, ...GRADES[3].ids]], ['T33', [...GRADES[4].ids, ...GRADES[5].ids]]],
  社會: [['T41', [...GRADES[0].ids, ...GRADES[1].ids]], ['T42', [...GRADES[2].ids, ...GRADES[3].ids]], ['T43', [...GRADES[4].ids, ...GRADES[5].ids]]],
  體育: [['T51', [...GRADES[0].ids, ...GRADES[1].ids]], ['T52', [...GRADES[2].ids, ...GRADES[3].ids]], ['T53', [...GRADES[4].ids, ...GRADES[5].ids]]],
  藝術: [['T61', [...GRADES[0].ids, ...GRADES[1].ids, ...GRADES[2].ids]], ['T62', [...GRADES[3].ids, ...GRADES[4].ids, ...GRADES[5].ids]]],
};
const teacherOf = {};
for (const subj of Object.keys(byGroup)) for (const [t, ids] of byGroup[subj]) for (const id of ids) teacherOf[`${subj}-${id}`] = t;

function build30ClassInput() {
  const classes = [];
  GRADES.forEach(({ g, ids }) => ids.forEach(id => classes.push({ class_id: id, grade: g, class_name: `${g} ${id.slice(-1)} 班`, students: 30 })));

  const courses = [];
  for (const { g, ids } of GRADES) for (const id of ids) {
    const mk = (subj, w, room = 'normal') => courses.push({ class: id, subject: subj, teacher: teacherOf[`${subj}-${id}`], weekly_period: w, room_required: room, double_period: false });
    mk('國文', 5); mk('數學', 5); mk('英語', 4); mk('自然', 2, '實驗教室');
    mk('社會', 2); mk('體育', 2, '體育場'); mk('藝術', 2, '音樂教室'); mk('彈性', 1);
  }

  const rooms = [];
  for (let i = 1; i <= 30; i++) rooms.push({ room_id: `R${String(i).padStart(3, '0')}`, type: 'normal', capacity: 35 });
  rooms.push({ room_id: 'S001', type: '實驗教室', capacity: 30 }, { room_id: 'S002', type: '實驗教室', capacity: 30 });
  rooms.push({ room_id: 'G001', type: '體育場', capacity: 60 }, { room_id: 'G002', type: '體育場', capacity: 60 }, { room_id: 'G003', type: '體育場', capacity: 60 });
  rooms.push({ room_id: 'M001', type: '音樂教室', capacity: 30 }, { room_id: 'M002', type: '音樂教室', capacity: 30 });

  const fixed = [{ activity: '朝會', weekday: 'Mon', period: 1, class: '101', teacher: 'T01' }];
  const availability = [{ teacher: 'T01', weekday: 'Mon', period: 2, available: false, reason: '導師會議' }];

  return mapLegacyInput({ classes, teachers: [], courses, availability, rooms, fixed });
}

test('30 班 240 門課 30 秒內排完（5.7s 基準）', () => {
  const input = build30ClassInput();
  assert.equal(input.classes.length, 30);
  assert.equal(input.courses.length, 240);

  const t0 = Date.now();
  const res = solveSchedule({
    courses: input.courses,
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
    periodsPerDay: 8,
    rooms: input.rooms,
    fixed: input.fixedActivities,
    teachers: input.teachers,
    classes: input.classes,
  });
  const ms = Date.now() - t0;

  assert.equal(res.success, true, '30 班排課應成功');
  assert.equal(res.pending.length, 0, '30 班應 0 pending');
  assert.ok(ms < 30000, `排課耗時 ${ms}ms，超過 30 秒上限`);
  console.log(`30 班 / 240 課 → 成功 ${res.schedule.length} 堂，0 pending，${ms}ms`);
});
