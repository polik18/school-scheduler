// 統一資料模型：範本欄位（與模板 xlsx 一致）
export const SCHOOL_MODEL = {
  classes: ['class_id', 'grade', 'class_name', 'students', 'homeroom_teacher', 'note'],
  teachers: ['teacher_id', 'name', 'subject', 'max_daily_period', 'max_continuous_period', 'identity_note'],
  availability: ['teacher', 'weekday', 'period', 'available', 'reason'],
  rooms: ['room_id', 'type', 'capacity'],
  fixed: ['activity', 'weekday', 'period', 'class', 'teacher'],
  staffAssignments: ['department', 'job_title', 'teacher', 'name', 'note']
};

const asBoolean = value => value === true || value === 1 ||
  (typeof value === 'string' && ['true', '1', 'yes', 'y', '是'].includes(value.trim().toLowerCase()));
const isUnavailable = value => value === false || value === 0 ||
  (typeof value === 'string' && ['false', '0', 'no', 'n', '否'].includes(value.trim().toLowerCase()));

export function mapLegacyInput(data) {
  return {
    classes: (data.classes || []).map(x => ({
      class_id: x.class_id || x.classId,
      grade: x.grade,
      class_name: x.class_name || x.className || x.class_id,
      students: Number(x.students || 0),
      homeroom_teacher: x.homeroom_teacher || x.homeroomTeacher || '',
      homeroom_teacher_name: x.homeroom_teacher_name || '',
      note: x.note || x.class_note || ''
    })),
    teachers: (data.teachers || []).map(x => ({
      teacher_id: x.teacher_id || x.teacherId,
      name: x.name,
      subject: x.subject,
      max_daily_period: Number(x.max_daily_period || 8),
      max_continuous_period: Number(x.max_continuous_period || 3),
      identity_note: x.identity_note || x.note || '',
      unavailable: (x.unavailable || []).length
        ? x.unavailable
        : (data.availability || []).filter(a => a.teacher === (x.teacher_id || x.teacherId))
            .filter(a => isUnavailable(a.available))
            .map(a => ({ weekday: a.weekday, period: Number(a.period) }))
    })),
    courses: (data.courses || []).map(x => ({
      class: x.class || x.classId,
      subject: x.subject,
      teacher: x.teacher || x.teacherId,
      weekly_period: Number(x.weekly_period || x.periods || x.hours || 1),
      room_required: x.room_required || x.roomType || 'normal',
      double_period: asBoolean(x.double_period ?? x.doublePeriod)
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
    })),
    staffAssignments: (data.staffAssignments || data.administration || []).map(x => ({
      department: x.department || x.unit || '',
      job_title: x.job_title || x.title || '',
      teacher: x.teacher || x.teacher_id || '',
      name: x.name || '',
      note: x.note || ''
    }))
  };
}
