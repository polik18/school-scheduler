// 人工調課：移動一堂課到目標時段，檢查班級/教師/教室衝突
export function moveLesson(schedule, index, target) {
  const next = [...schedule];
  const lesson = next[index];
  if (!lesson || lesson.status !== 'done') return next;

  // 檢查目標時段是否已被同一班級/教師/教室占用
  const conflict = next.some((c, i) => {
    if (i === index) return false;
    if (c.day !== target.day || c.period !== target.period) return false;
    if (c.class === lesson.class) return true;
    if (c.teacher === lesson.teacher) return true;
    if (c.room_id && c.room_id === lesson.room_id) return true;
    return false;
  });
  if (conflict) return next;

  lesson.day = target.day;
  lesson.period = target.period;
  lesson.manual = true;
  return next;
}
