// 統一資料模型：範本欄位（與模板 xlsx 一致）
export const SCHOOL_MODEL = {
  classes: ['class_id', 'grade', 'class_name', 'students'],
  teachers: ['teacher_id', 'name', 'subject', 'max_daily_period', 'max_continuous_period'],
  availability: ['teacher', 'weekday', 'period', 'available', 'reason'],
  rooms: ['room_id', 'type', 'capacity'],
  fixed: ['activity', 'weekday', 'period', 'class', 'teacher']
};

export function mapLegacyInput(data) {
  return {
    classes: (data.classes || []).map(x => ({
      class_id: x.class_id || x.classId,
      grade: x.grade,
      class_name: x.class_name || x.className || x.class_id,
      students: Number(x.students || 0)
    })),
    teachers: (data.teachers || []).map(x => ({
      teacher_id: x.teacher_id || x.teacherId,
      name: x.name,
      subject: x.subject,
      max_daily_period: Number(x.max_daily_period || 8),
      max_continuous_period: Number(x.max_continuous_period || 3),
      unavailable: (x.unavailable || []).length
        ? x.unavailable
        : (data.availability || []).filter(a => a.teacher === (x.teacher_id || x.teacherId))
            .filter(a => Number(a.available) === 0)
            .map(a => ({ weekday: a.weekday, period: Number(a.period) }))
    })),
    courses: (data.courses || []).map(x => ({
      class: x.class || x.classId,
      subject: x.subject,
      teacher: x.teacher || x.teacherId,
      weekly_period: Number(x.weekly_period || x.periods || x.hours || 1),
      room_required: x.room_required || x.roomType || 'normal',
      double_period: Boolean(x.double_period || x.doublePeriod)
    })),
    rooms: (data.rooms || []).map(x => ({
      room_id: x.room_id || x.roomId,
      type: x.type,
      capacity: Number(x.capacity || 0)
    })),
    fixedActivities: (data.fixed || data.fixedActivities || []).map(x => ({
      activity: x.activity || x.name,
      weekday: x.weekday || x.day,
      period: Number(x.period),
      class: x.class || x.classId,
      teacher: x.teacher || x.teacherId
    }))
  };
}
