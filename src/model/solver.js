// 統一排課核心：消耗 src/model/schema.js 的標準欄位
// 課程單位欄位：class, subject, teacher, day, period, room_required, double_period, room_id, locked

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

function teacherAvailability(teachers) {
  const map = {};
  teachers.forEach(t => {
    const unavail = new Set();
    (t.unavailable || []).forEach(u => {
      if (u.weekday && u.period != null) unavail.add(`${u.weekday}-${u.period}`);
    });
    map[t.teacher_id] = { subject: t.subject, unavail, maxDaily: t.max_daily_period || 99 };
  });
  return map;
}

function expandCourses(courses) {
  const units = [];
  courses.forEach((c, ci) => {
    const count = Math.max(1, Number(c.weekly_period || c.periods || c.hours || 1));
    for (let i = 0; i < count; i++) units.push({ ...c, unit: i + 1, status: 'pending' });
  });
  return units;
}

// 固定活動：占用某班級某時段
function fixedOccupancy(fixed = []) {
  const occ = {}; // classId -> Set("day-period")
  fixed.forEach(f => {
    const cls = f.class || f.classId;
    if (!cls) return;
    (occ[cls] ||= new Set()).add(`${f.weekday || f.day}-${f.period}`);
  });
  return occ;
}

export function solveSchedule(input) {
  const {
    courses = [], days = DAYS, periodsPerDay = 8, rooms = [],
    fixed = [], teachers = [], classes = [], locked = []
  } = input;

  const key = (a, b, c) => `${a}-${b}-${c}`;
  const slots = days.flatMap(day =>
    Array.from({ length: periodsPerDay }, (_, i) => ({ day, period: i + 1 })));
  const tAvail = teacherAvailability(teachers);
  const occ = fixedOccupancy(fixed);

  // 教師每日已排節數（硬限制 max_daily_period）
  const teacherDayCount = {};
  // 班級/教師/教室 占用集合
  const clsSlot = {}, teacherSlot = {}, roomSlot = {};

  const occupiedByClass = (classId, slot) =>
    occ[classId]?.has(`${slot.day}-${slot.period}`) || !!clsSlot[key(classId, slot.day, slot.period)];

  const candidates = (course) => slots.filter(slot => {
    if (course.fixedDay && course.fixedDay !== slot.day) return false;
    if (course.fixedPeriod && Number(course.fixedPeriod) !== slot.period) return false;
    if (occupiedByClass(course.class, slot)) return false;
    const t = tAvail[course.teacher];
    if (t && t.unavail.has(`${slot.day}-${slot.period}`)) return false;
    if (teacherSlot[key(course.teacher, slot.day, slot.period)]) return false;
    const daily = (teacherDayCount[course.teacher] || {});
    if (daily[slot.day] >= (t?.maxDaily || 99)) return false;
    // 專教教室：需一間同類型空房
    if (course.room_required && course.room_required !== 'normal' && course.room_required !== 'none') {
      const r = rooms.find(x => (x.type || x.roomType) === course.room_required &&
        !roomSlot[key(x.room_id || x.id, slot.day, slot.period)]);
      if (!r) return false;
    }
    return true;
  });

  const place = (course, slot, room) => {
    const rid = (course.room_required && course.room_required !== 'normal' && course.room_required !== 'none')
      ? (room ? (room.room_id || room.id) : '') : '';
    course.day = slot.day; course.period = slot.period; course.room_id = rid;
    course.status = 'done'; course.locked = true;
    teacherDayCount[course.teacher] = teacherDayCount[course.teacher] || {};
    teacherDayCount[course.teacher][slot.day] = (teacherDayCount[course.teacher][slot.day] || 0) + 1;
    clsSlot[key(course.class, slot.day, slot.period)] = course;
    teacherSlot[key(course.teacher, slot.day, slot.period)] = course;
    if (rid) roomSlot[key(rid, slot.day, slot.period)] = course;
  };

  const remove = (course, slot) => {
    if (teacherDayCount[course.teacher]) {
      teacherDayCount[course.teacher][slot.day] = (teacherDayCount[course.teacher][slot.day] || 0) - 1;
    }
    delete clsSlot[key(course.class, slot.day, slot.period)];
    delete teacherSlot[key(course.teacher, slot.day, slot.period)];
    if (course.room_id) delete roomSlot[key(course.room_id, slot.day, slot.period)];
  };

  const collect = () => Object.values(clsSlot);

  const forwardCheck = (left) => left.every(c => candidates(c).length > 0);

  const courseRoom = (course, slot) => {
    if (!course.room_required || course.room_required === 'normal' || course.room_required === 'none') return null;
    return rooms.find(r => (r.type || r.roomType) === course.room_required &&
      !roomSlot[key(r.room_id || r.id, slot.day, slot.period)]);
  };

  const search = (left) => {
    if (Date.now() - startTime > timeoutMs) return false;
    if (left.length === 0) {
      const score = scoreSchedule(collect());
      if (score > bestScore) { bestScore = score; bestSchedule = collect(); }
      return true;
    }
    let best = null, bestList = null;
    for (const c of left) {
      const list = candidates(c);
      if (!bestList || list.length < bestList.length) { best = c; bestList = list; }
      if (list.length === 0) return false;
    }
    bestList.sort((a, b) => a.period - b.period);
    for (const slot of bestList) {
      const room = courseRoom(best, slot);
      place(best, slot, room);
      const remain = left.filter(x => x !== best);
      const ok = forwardCheck(remain) && search(remain);
      if (ok) return true;
      remove(best, slot);
    }
    return false;
  };

  // 先排學生鎖定的課程
  (locked || []).forEach(lk => {
    const course = courses.find(c => c.class === lk.class && c.subject === lk.subject && c.teacher === lk.teacher);
    if (!course) return;
    const slot = { day: lk.day, period: Number(lk.period) };
    if (candidates(course).some(s => s.day === slot.day && s.period === slot.period)) {
      const room = courseRoom(course, slot);
      place(course, slot, room);
    }
  });

  const units = sortHardCourses(expandCourses(courses).filter(c => c.status !== 'done'));
  const startTime = Date.now();
  const timeoutMs = input.timeoutMs || 30000;
  let bestSchedule = null, bestScore = -Infinity;

  const ok = search(units);
  const finalSchedule = collect();
  const success = ok && finalSchedule.length === units.length + (locked || []).length ? true : ok;
  const pending = units.filter(c => c.status !== 'done').map(c => ({
    class: c.class, subject: c.subject, teacher: c.teacher, unit: c.unit
  }));
  return {
    success,
    schedule: finalSchedule,
    score: scoreSchedule(finalSchedule),
    pending,
    diagnostics: pending.length ? [
      { type: 'constraint',
        message: `尚有 ${pending.length} 堂課程未能排入，請檢視衝突診斷並調整限制。` }
    ] : []
  };
}

// 評分：偏好分散、固定課集中、專教不擠最後
function scoreSchedule(schedule) {
  let score = 0;
  const classSlot = {};
  schedule.forEach(c => {
    const k = `${c.class}-${c.day}-${c.period}`;
    classSlot[k] = (classSlot[k] || 0) + 1;
  });
  Object.values(classSlot).forEach(n => { if (n > 1) score -= 500 * (n - 1); });
  // 分散：同科目同一天多節扣分
  const byClassSubject = {};
  schedule.forEach(c => {
    const k = `${c.class}-${c.subject}`;
    (byClassSubject[k] ||= []).push(c.day);
  });
  Object.entries(byClassSubject).forEach(([, days]) => {
    const dayCount = {};
    days.forEach(d => dayCount[d] = (dayCount[d] || 0) + 1);
    Object.values(dayCount).forEach(n => { if (n > 1) score -= 30 * (n - 1); });
  });
  return score;
}

// 排課順序：固定 > 專教 > 最密集 > 一般
function sortHardCourses(units) {
  const byClassSubject = {};
  units.forEach(c => {
    const k = `${c.class}-${c.subject}`;
    (byClassSubject[k] ||= []).push(c);
  });
  const difficulty = c => {
    let d = 0;
    if (c.fixedDay) d += 100;
    if (c.room_required && c.room_required !== 'normal' && c.room_required !== 'none') d += 50;
    const cnt = byClassSubject[`${c.class}-${c.subject}`]?.length || 1;
    d += cnt;
    return d;
  };
  return [...units].sort((a, b) => difficulty(b) - difficulty(a));
}
