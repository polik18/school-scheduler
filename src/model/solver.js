// 排課核心：MRV + forward checking。
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const slotKey = (id, day, period) => `${id}-${day}-${period}`;

function teacherAvailability(teachers) {
  const map = {};
  teachers.forEach(t => {
    const unavail = new Set();
    (t.unavailable || []).forEach(u => {
      if (u.weekday && u.period != null) unavail.add(`${u.weekday}-${Number(u.period)}`);
    });
    map[t.teacher_id] = {
      unavail,
      maxDaily: Number(t.max_daily_period) || 99,
      maxContinuous: Number(t.max_continuous_period) || 99
    };
  });
  return map;
}

// 連堂課以一個 duration=2 的任務搜尋，輸出時仍是兩筆逐節課程。
function expandCourses(courses) {
  const tasks = [];
  courses.forEach((course, courseIndex) => {
    let remaining = Math.max(1, Number(course.weekly_period || course.periods || course.hours || 1));
    let unit = 1;
    while (remaining > 0) {
      const duration = course.double_period && remaining >= 2 ? 2 : 1;
      tasks.push({ ...course, duration, unit, taskId: `${courseIndex}:${unit}`, status: 'pending' });
      unit += duration;
      remaining -= duration;
    }
  });
  return tasks;
}

function fixedOccupancy(fixed = []) {
  const classes = {};
  const teachers = new Set();
  fixed.forEach(f => {
    const day = f.weekday || f.day;
    const period = Number(f.period);
    const cls = f.class || f.classId;
    const teacher = f.teacher || f.teacherId;
    if (cls) (classes[cls] ||= new Set()).add(`${day}-${period}`);
    if (teacher) teachers.add(slotKey(teacher, day, period));
  });
  return { classes, teachers };
}

export function solveSchedule(input, options = {}) {
  const { courses = [], days = DAYS, periodsPerDay = 8, rooms = [], fixed = [], teachers = [], locked = [] } = input;
  const timeoutMs = input.timeoutMs ?? 30000;
  const startTime = Date.now();
  const slots = days.flatMap(day => Array.from({ length: periodsPerDay }, (_, i) => ({ day, period: i + 1 })));
  const tAvail = teacherAvailability(teachers);
  const fixedOcc = fixedOccupancy(fixed);
  const teacherDayCount = {};
  const clsSlot = {}, teacherSlot = {}, roomSlot = {};
  const tasks = sortHardCourses(expandCourses(courses));
  const invalidLocks = [];
  let timedOut = false;
  let bestSchedule = [];
  let bestScore = -Infinity;
  let nodes = 0;
  let backtracks = 0;
  let lastProgressAt = 0;
  const totalLessons = tasks.reduce((sum, task) => sum + (task.duration || 1), 0);
  const reportProgress = (force = false) => {
    if (typeof options.onProgress !== 'function') return;
    const now = Date.now();
    if (!force && now - lastProgressAt < 250) return;
    lastProgressAt = now;
    options.onProgress({ placed: bestSchedule.length, total: totalLessons, nodes, backtracks, elapsedMs: now - startTime });
  };

  const span = (task, start) => Array.from({ length: task.duration || 1 }, (_, offset) => ({ day: start.day, period: start.period + offset }));
  const classBusy = (classId, slot) => fixedOcc.classes[classId]?.has(`${slot.day}-${slot.period}`) || !!clsSlot[slotKey(classId, slot.day, slot.period)];
  const exceedsContinuous = (teacher, day, newPeriods, maxContinuous) => {
    if (!teacher || maxContinuous >= periodsPerDay) return false;
    const periods = new Set(newPeriods);
    for (let p = 1; p <= periodsPerDay; p++) if (teacherSlot[slotKey(teacher, day, p)]) periods.add(p);
    let run = 0;
    for (let p = 1; p <= periodsPerDay; p++) {
      run = periods.has(p) ? run + 1 : 0;
      if (run > maxContinuous) return true;
    }
    return false;
  };
  const availableRooms = (task, occupiedSlots) => {
    if (!task.room_required || task.room_required === 'normal' || task.room_required === 'none') return [null];
    return rooms.filter(room => {
      if ((room.type || room.roomType) !== task.room_required) return false;
      const id = room.room_id || room.id;
      return occupiedSlots.every(slot => !roomSlot[slotKey(id, slot.day, slot.period)]);
    });
  };
  const isCandidate = (task, start) => {
    if (task.fixedDay && task.fixedDay !== start.day) return false;
    if (task.fixedPeriod && Number(task.fixedPeriod) !== start.period) return false;
    const occupiedSlots = span(task, start);
    if (occupiedSlots.at(-1).period > periodsPerDay) return false;
    const teacher = tAvail[task.teacher];
    if (occupiedSlots.some(slot => classBusy(task.class, slot))) return false;
    if (occupiedSlots.some(slot => teacher?.unavail.has(`${slot.day}-${slot.period}`))) return false;
    if (occupiedSlots.some(slot => fixedOcc.teachers.has(slotKey(task.teacher, slot.day, slot.period)))) return false;
    if (occupiedSlots.some(slot => teacherSlot[slotKey(task.teacher, slot.day, slot.period)])) return false;
    const daily = teacherDayCount[task.teacher]?.[start.day] || 0;
    if (daily + occupiedSlots.length > (teacher?.maxDaily || 99)) return false;
    if (exceedsContinuous(task.teacher, start.day, occupiedSlots.map(x => x.period), teacher?.maxContinuous || 99)) return false;
    return availableRooms(task, occupiedSlots).length > 0;
  };
  const candidates = task => slots.filter(slot => isCandidate(task, slot));
  const place = (task, start, isLocked = false) => {
    const occupiedSlots = span(task, start);
    const room = availableRooms(task, occupiedSlots)[0];
    const roomId = room ? (room.room_id || room.id) : '';
    const lessons = occupiedSlots.map((slot, offset) => ({
      ...task, day: slot.day, period: slot.period, unit: task.unit + offset,
      room_id: roomId, status: 'done', locked: isLocked
    }));
    task.status = 'done';
    task.placements = lessons;
    teacherDayCount[task.teacher] ||= {};
    teacherDayCount[task.teacher][start.day] = (teacherDayCount[task.teacher][start.day] || 0) + lessons.length;
    lessons.forEach(lesson => {
      clsSlot[slotKey(task.class, lesson.day, lesson.period)] = lesson;
      teacherSlot[slotKey(task.teacher, lesson.day, lesson.period)] = lesson;
      if (roomId) roomSlot[slotKey(roomId, lesson.day, lesson.period)] = lesson;
    });
  };
  const remove = task => {
    (task.placements || []).forEach(lesson => {
      teacherDayCount[task.teacher][lesson.day]--;
      delete clsSlot[slotKey(task.class, lesson.day, lesson.period)];
      delete teacherSlot[slotKey(task.teacher, lesson.day, lesson.period)];
      if (lesson.room_id) delete roomSlot[slotKey(lesson.room_id, lesson.day, lesson.period)];
    });
    task.status = 'pending';
    delete task.placements;
  };
  const collect = () => Object.values(clsSlot);
  const rememberBest = () => {
    const current = collect();
    const score = scoreSchedule(current);
    if (current.length > bestSchedule.length || (current.length === bestSchedule.length && score > bestScore)) {
      bestSchedule = current.map(x => ({ ...x }));
      bestScore = score;
      reportProgress();
    }
  };

  // 鎖定資料對應特定課程單位，不會因鎖一節就略過整門課。
  locked.forEach(lock => {
    const task = tasks.find(t => t.status !== 'done' && t.class === lock.class && t.subject === lock.subject &&
      t.teacher === lock.teacher && (lock.unit == null || t.unit === Number(lock.unit)));
    const start = { day: lock.day, period: Number(lock.period) };
    if (task && isCandidate(task, start)) place(task, start, true);
    else invalidLocks.push(lock);
  });
  rememberBest();

  const search = remaining => {
    nodes++;
    reportProgress();
    if (Date.now() - startTime > timeoutMs) { timedOut = true; return false; }
    if (!remaining.length) { rememberBest(); return true; }
    let selected = null, selectedCandidates = null;
    for (const task of remaining) {
      const list = candidates(task);
      if (!selectedCandidates || list.length < selectedCandidates.length) { selected = task; selectedCandidates = list; }
      if (!list.length) return false;
    }
    selectedCandidates.sort((a, b) => a.period - b.period || days.indexOf(a.day) - days.indexOf(b.day));
    for (const slot of selectedCandidates) {
      place(selected, slot, false);
      rememberBest();
      const rest = remaining.filter(x => x !== selected);
      // 下一層 MRV 本身就會對所有剩餘任務做候選檢查；
      // 這裡不重複做一次 forward-check，避免大型資料每層雙倍掃描。
      if (search(rest)) return true;
      remove(selected);
      backtracks++;
      if (timedOut) return false;
    }
    return false;
  };

  search(tasks.filter(t => t.status !== 'done'));
  const scheduledTaskIds = new Set(bestSchedule.map(x => x.taskId));
  const pending = tasks.filter(t => !scheduledTaskIds.has(t.taskId)).flatMap(task =>
    Array.from({ length: task.duration || 1 }, (_, offset) => ({ class: task.class, subject: task.subject, teacher: task.teacher, unit: task.unit + offset })));
  const publicSchedule = bestSchedule.map(({ taskId, duration, placements, ...lesson }) => lesson);
  const diagnostics = [];
  if (invalidLocks.length) diagnostics.push({ type: 'lock', message: `${invalidLocks.length} 筆鎖定課程無法放入指定時段。` });
  if (timedOut) diagnostics.push({ type: 'timeout', message: `排課已達 ${timeoutMs}ms 時間上限，保留目前最完整的可行結果。` });
  if (pending.length) diagnostics.push({ type: 'constraint', message: `尚有 ${pending.length} 堂課程未能排入，請檢視衝突診斷並調整限制。` });
  const result = {
    success: pending.length === 0 && invalidLocks.length === 0,
    schedule: publicSchedule,
    score: scoreSchedule(publicSchedule), pending, diagnostics, timedOut,
    elapsedMs: Date.now() - startTime,
    quality: buildQualityReport(publicSchedule, pending, invalidLocks)
  };
  reportProgress(true);
  return result;
}

// 結果品質指標，不宣稱為全域最佳解。
function scoreSchedule(schedule) {
  let score = 0;
  const byClassSubject = {};
  schedule.forEach(course => (byClassSubject[`${course.class}-${course.subject}`] ||= []).push(course.day));
  Object.values(byClassSubject).forEach(days => {
    const counts = {};
    days.forEach(day => { counts[day] = (counts[day] || 0) + 1; });
    Object.values(counts).forEach(count => { if (count > 1) score -= 30 * (count - 1); });
  });
  return score;
}

export function buildQualityReport(schedule = [], pending = [], invalidLocks = []) {
  const total = schedule.length + pending.length;
  const slotConflicts = new Set();
  const seen = { class: new Set(), teacher: new Set(), room: new Set() };
  schedule.forEach(lesson => {
    const suffix = `${lesson.day}-${lesson.period}`;
    for (const [kind, id] of [['class', lesson.class], ['teacher', lesson.teacher], ['room', lesson.room_id]]) {
      if (!id) continue;
      const key = `${id}-${suffix}`;
      if (seen[kind].has(key)) slotConflicts.add(`${kind}-${key}`);
      seen[kind].add(key);
    }
  });
  const groups = {};
  schedule.forEach(lesson => {
    const key = `${lesson.class}-${lesson.subject}-${lesson.day}`;
    groups[key] = (groups[key] || 0) + 1;
  });
  const repeatedSameSubject = Object.values(groups).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  return {
    completionPercent: total ? Math.round(schedule.length / total * 1000) / 10 : 100,
    hardConflicts: slotConflicts.size + invalidLocks.length,
    distributionScore: schedule.length ? Math.max(0, Math.round((1 - repeatedSameSubject / schedule.length) * 100)) : 100,
    repeatedSameSubject,
    explanation: '課程分散度以「同班同科在同一天的重複節數」估算；100 分代表沒有這類重複，並非全域最佳解保證。'
  };
}

function sortHardCourses(tasks) {
  const density = {};
  tasks.forEach(task => { const key = `${task.class}-${task.subject}`; density[key] = (density[key] || 0) + (task.duration || 1); });
  const difficulty = task => {
    let value = task.duration > 1 ? 200 : 0;
    if (task.fixedDay) value += 100;
    if (task.room_required && task.room_required !== 'normal' && task.room_required !== 'none') value += 50;
    return value + density[`${task.class}-${task.subject}`];
  };
  return [...tasks].sort((a, b) => difficulty(b) - difficulty(a));
}
