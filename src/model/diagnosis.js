// 衝突診斷：找出未排入課程的原因，並提出調整建議

// 檢查某課程在某時段的可用教室
function roomCandidates(course, rooms, day, period) {
  if (!course.room_required || course.room_required === 'normal' || course.room_required === 'none')
    return { ok: true, reason: '普通教室充足' };
  const free = rooms.filter(r => (r.type || r.roomType) === course.room_required);
  if (!free.length) return { ok: false, reason: `無 ${course.room_required} 教室` };
  const used = new Set();
  free.forEach(r => used.add(`${r.room_id || r.id}`));
  return { ok: true, reason: `專教充足` };
}

// 檢查某教師在某時段是否可用
function teacherFree(teacher, avail, day, period) {
  const t = avail.find(a => a.teacher_id === teacher);
  if (!t) return { ok: true };
  const blocked = (t.unavailable || []).some(u =>
    u.weekday === day && Number(u.period) === Number(period));
  if (blocked) return { ok: false, reason: '教師該時段不可用' };
  return { ok: true };
}

// 檢查某班級在某時段是否已被固定活動占用
function classFixedBusy(classId, fixed, day, period) {
  const busy = fixed.some(f => (f.class || f.classId) === classId &&
    (f.weekday || f.day) === day && Number(f.period) === period);
  return { ok: !busy };
}

// 對一門課程，列出所有可行時段
export function courseFeasibility(course, input) {
  const { days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], periodsPerDay = 8, rooms = [], teachers = [], fixed = [] } = input;
  const avail = teachers;
  const slots = days.flatMap(day =>
    Array.from({ length: periodsPerDay }, (_, i) => ({ day, period: i + 1 })));
  const feasible = [];
  slots.forEach(slot => {
    const t = teacherFree(course.teacher, avail, slot.day, slot.period);
    const f = classFixedBusy(course.class, fixed, slot.day, slot.period);
    const r = roomCandidates(course, rooms, slot.day, slot.period);
    if (t.ok && f.ok && r.ok) feasible.push(slot);
  });
  return { feasible, total: feasible.length };
}

// 針對一門未排入的課程，診斷原因
export function diagnosePendingCourse(course, input) {
  const { teachers = [], rooms = [], fixed = [], classes = [], days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], periodsPerDay = 8 } = input;
  const reasons = [];

  // 1. 教師是否存在
  const tExist = teachers.some(t => t.teacher_id === course.teacher);
  if (!tExist) {
    reasons.push({ level: 'error',
      message: `找不到教師 "${course.teacher}"，請檢查教師資料表。` });
  }
  // 2. 班級是否存在
  const cExist = classes.some(c => c.class_id === course.class);
  if (!cExist) {
    reasons.push({ level: 'error',
      message: `找不到班級 "${course.class}"，請檢查班級資料表。` });
  }
  // 3. 教師可用性（依實際上課天數檢查）
  const anySlot = days.find(day =>
    teachers.some(t => t.teacher_id === course.teacher &&
      !(t.unavailable || []).some(u => u.weekday === day)));
  if (tExist && !anySlot) {
    reasons.push({ level: 'error',
      message: `教師 "${course.teacher}" 全部時段皆不可用。` });
  }
  // 4. 專教可用性
  if (course.room_required && course.room_required !== 'normal' && course.room_required !== 'none') {
    const has = rooms.some(r => (r.type || r.roomType) === course.room_required);
    if (!has) reasons.push({ level: 'error',
      message: `無 ${course.room_required} 教室，請新增該類型教室。` });
  }

  // 5. 若教師班級都存在，做時段可行性分析
  if (tExist && cExist) {
    const { feasible } = courseFeasibility(course, input);
    if (!feasible.length) {
      reasons.push({ level: 'warning',
        message: `該課程在所有 ${days.length} × ${periodsPerDay} 時段皆無法排入。` });
      // 深入：哪種類型的衝突最多
      const conflictDays = {};
      days.forEach(day => {
        const busy = (input.courses || []).filter(c => c.class === course.class && c.day === day).length;
        if (busy) conflictDays[day] = busy;
      });
      reasons.push({ level: 'info',
        message: `建議：該班級已有課程集中於部分星期，可考慮將本課程移至空閒星期。` });
    }
  }

  return reasons;
}
