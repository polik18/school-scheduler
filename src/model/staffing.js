// 教職員配置資料模型。這裡保留「誰、擔任什麼、負責哪些班級」的結構化資料，
// 顯示用文字只在匯出時產生，不把「1~5 班」這類文字當成排課真實來源。

const clean = value => String(value ?? '').trim();

export function buildStaffingPlan(data = {}) {
  const teacherById = new Map((data.teachers || []).map(t => [t.teacher_id, t]));

  const homeroom = (data.classes || [])
    .filter(c => c.homeroom_teacher || c.homeroom_teacher_name)
    .map(c => {
      const teacher = teacherById.get(c.homeroom_teacher);
      return {
        grade: clean(c.grade),
        class_id: clean(c.class_id),
        class_name: clean(c.class_name || c.class_id),
        teacher_id: clean(c.homeroom_teacher),
        teacher_name: clean(c.homeroom_teacher_name || teacher?.name || c.homeroom_teacher),
        note: clean(c.note || c.class_note)
      };
    });

  const grouped = new Map();
  (data.courses || []).forEach(course => {
    const teacherId = clean(course.teacher);
    if (!teacherId) return;
    if (!grouped.has(teacherId)) grouped.set(teacherId, {
      teacher_id: teacherId,
      teacher_name: clean(teacherById.get(teacherId)?.name || teacherId),
      subjects: [],
      assignments: [],
      note: clean(teacherById.get(teacherId)?.identity_note || teacherById.get(teacherId)?.note)
    });
    const item = grouped.get(teacherId);
    if (course.subject && !item.subjects.includes(course.subject)) item.subjects.push(course.subject);
    if (course.class && !item.assignments.some(a => a.class_id === course.class && a.subject === course.subject)) {
      const cls = (data.classes || []).find(c => c.class_id === course.class);
      item.assignments.push({
        subject: clean(course.subject),
        class_id: clean(course.class),
        class_name: clean(cls?.class_name || course.class),
        grade: clean(cls?.grade),
        weekly_period: Number(course.weekly_period || 0)
      });
    }
  });

  const administration = (data.staffAssignments || []).map(a => ({
    department: clean(a.department || a.unit),
    job_title: clean(a.job_title || a.title),
    teacher_id: clean(a.teacher || a.teacher_id),
    name: clean(a.name || teacherById.get(a.teacher || a.teacher_id)?.name),
    note: clean(a.note)
  }));

  return { homeroom, subjectTeachers: [...grouped.values()], administration };
}

export function validateStaffingPlan(plan = {}) {
  const errors = [];
  const warnings = [];
  const seenClass = new Set();
  (plan.homeroom || []).forEach(row => {
    const id = clean(row.class_id || row.class_name);
    if (id && seenClass.has(id)) warnings.push(`班級「${id}」有多筆級任配置（幼兒園雙導師可忽略）`);
    if (id) seenClass.add(id);
    if (!row.teacher_name && !row.teacher_id) errors.push(`班級「${id || '未命名'}」沒有導師`);
  });
  (plan.subjectTeachers || []).forEach(row => {
    if (!row.teacher_name && !row.teacher_id) errors.push('科任教師資料有空白姓名');
    if (!(row.assignments || []).length && !row.assignment_text) warnings.push(`科任「${row.teacher_name || row.teacher_id}」沒有班級配置`);
  });
  return { errors, warnings };
}

export function staffingPlanFromRows({ homeroomRows = [], subjectRows = [], administrationRows = [] }) {
  return {
    homeroom: homeroomRows.map((r, index) => ({
      grade: clean(r[0]), class_id: clean(r[1]), class_name: clean(r[1]),
      teacher_id: '', teacher_name: clean(r[2]), note: clean(r[3]), source_row: index + 2
    })).filter(r => r.grade || r.class_name || r.teacher_name),
    subjectTeachers: subjectRows.map((r, index) => ({
      number: clean(r[0]), teacher_id: '', teacher_name: clean(r[1]),
      subjects: clean(r[2]).split(/[、,]/).map(clean).filter(Boolean),
      assignments: [], assignment_text: clean(r[3]), note: clean(r[4]), source_row: index + 2
    })).filter(r => r.teacher_name || r.subjects.length || r.assignment_text),
    administration: administrationRows.map((r, index) => ({
      department: clean(r[0]), job_title: clean(r[1]), teacher_id: '',
      name: clean(r[2]), note: '', source_row: index + 2
    })).filter(r => r.department || r.job_title || r.name)
  };
}

export function assignmentText(row) {
  if (row.assignment_text) return row.assignment_text;
  const bySubject = new Map();
  (row.assignments || []).forEach(a => {
    if (!bySubject.has(a.subject)) bySubject.set(a.subject, []);
    bySubject.get(a.subject).push(a.class_name || a.class_id);
  });
  const parts = [...bySubject.entries()].map(([subject, classes]) =>
    `${subject}：${[...new Set(classes)].join('、')}`);
  if (parts.length === 1 && (row.subjects || []).length <= 1) return parts[0]?.replace(/^[^：]+：/, '') || '';
  return parts.join('；');
}
