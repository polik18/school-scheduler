import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] || path.join(root, 'tests/fixtures/source/staffing-source-neutral.xlsx'));
const output = path.resolve(process.argv[3] || path.join(root, 'public/school-scheduler-template.xlsx'));

const wb = XLSX.read(fs.readFileSync(source), { type: 'buffer' });
const rows = name => XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }).slice(1);
const homeroomRows = rows('級任導師').filter(r => /^[一二三四五六]年級$/.test(String(r[0]).trim()));
const subjectRows = rows('科任教師');
const adminRows = rows('行政與支援人員');

const gradeNo = new Map([['一年級', 1], ['二年級', 2], ['三年級', 3], ['四年級', 4], ['五年級', 5], ['六年級', 6]]);
const gradeAliases = { '中年級': [3, 4], '高年級': [5, 6] };
const classId = (grade, number) => `${grade}${String(number).padStart(2, '0')}`;
const allClasses = new Set(homeroomRows.map(r => {
  const g = gradeNo.get(String(r[0]).trim());
  const m = String(r[1]).match(/(\d+)年(\d+)班/);
  return m ? classId(g, Number(m[2])) : '';
}).filter(Boolean));

function expandClassText(text) {
  const result = [];
  const gradePattern = /(一年級|二年級|三年級|四年級|五年級|六年級|中年級|高年級)/g;
  const matches = [...String(text).matchAll(gradePattern)];
  matches.forEach((match, index) => {
    const grades = gradeAliases[match[1]] || [gradeNo.get(match[1])];
    const end = index + 1 < matches.length ? matches[index + 1].index : String(text).length;
    let tail = String(text).slice(match.index + match[1].length, end);
    const numbers = [];
    tail = tail.replace(/(\d+)\s*[~～－-]\s*(\d+)/g, (_, a, b) => {
      for (let n = Number(a); n <= Number(b); n++) numbers.push(n);
      return '';
    });
    for (const token of tail.matchAll(/\d+/g)) numbers.push(Number(token[0]));
    const classNumbers = numbers.length ? [...new Set(numbers)] : [1, 2, 3, 4, 5, 6, 7, 8, 9];
    grades.forEach(g => classNumbers.forEach(n => {
      const id = classId(g, n);
      if (allClasses.has(id) && !result.includes(id)) result.push(id);
    }));
  });
  return result;
}

function assignmentSections(subjectText, assignmentText) {
  const subjects = String(subjectText).split(/[\u3001,]/).map(x => x.trim()).filter(Boolean);
  const segments = String(assignmentText).split(/[；;]/).map(x => x.trim()).filter(Boolean);
  const withLabels = segments.map(segment => {
    const match = segment.match(/^([^：:]+)[：:]\s*(.*)$/);
    return match ? { subject: match[1].trim(), text: match[2].trim() } : null;
  });
  if (withLabels.some(Boolean)) return withLabels.filter(Boolean);
  return subjects.length && assignmentText ? [{ subject: subjects[0], text: String(assignmentText) }] : [];
}

const classes = homeroomRows.map((r, index) => {
  const grade = String(r[0]).trim();
  const m = String(r[1]).match(/(\d+)年(\d+)班/);
  return {
    class_id: classId(gradeNo.get(grade), Number(m[2])), grade, class_name: String(r[1]).trim(),
    students: 30, homeroom_teacher: `H${String(index + 1).padStart(3, '0')}`, note: String(r[3] || '')
  };
});

// 標準範本以每年級 10 班建立 60 班可直接試跑資料。
for (let grade = 1; grade <= 6; grade++) {
  classes.push({
    class_id: classId(grade, 10), grade: ['','一年級','二年級','三年級','四年級','五年級','六年級'][grade],
    class_name: `${grade}年10班`, students: 30,
    homeroom_teacher: `H${String(54 + grade).padStart(3, '0')}`, note: '60 班標準範本擴充班'
  });
}

const teachers = [];
homeroomRows.forEach((r, index) => teachers.push({
  teacher_id: `H${String(index + 1).padStart(3, '0')}`, name: String(r[2]).trim(), subject: '級任',
  max_daily_period: 7, max_continuous_period: 4, identity_note: String(r[3] || '')
}));
subjectRows.forEach((r, index) => teachers.push({
  teacher_id: `S${String(index + 1).padStart(3, '0')}`, name: String(r[1]).trim(), subject: String(r[2]).trim(),
  // 來源中有科任每週負責 36 個班級；範例以 8/8 避免人為造成無解。
  max_daily_period: 8, max_continuous_period: 8, identity_note: String(r[4] || '')
}));
for (let grade = 1; grade <= 6; grade++) teachers.push({
  teacher_id: `H${String(54 + grade).padStart(3, '0')}`, name: `級任教師${String(54 + grade).padStart(3, '0')}`,
  subject: '級任', max_daily_period: 7, max_continuous_period: 4, identity_note: '60 班範例擴充'
});
[
  ['X001', '範例科任001', '英語'], ['X002', '範例科任002', '自然'],
  ['X003', '範例科任003', '體育'], ['X004', '範例科任004', '音樂'],
  ['X005', '範例科任005', '資訊'], ['X006', '範例科任006', '本土語']
].forEach(([teacher_id, name, subject]) => teachers.push({
  teacher_id, name, subject, max_daily_period: 8, max_continuous_period: 4, identity_note: '60 班跨班科任範例'
}));

// 來源沒有每週節數：標準範本以保守的演示節數補齊，不宣稱為實校課程計畫。
const courses = [];
const mappingReport = [];
classes.forEach(c => {
  courses.push({ class: c.class_id, subject: '國語（範例）', teacher: c.homeroom_teacher, weekly_period: 3, room_required: 'normal', double_period: false });
  courses.push({ class: c.class_id, subject: '數學（範例）', teacher: c.homeroom_teacher, weekly_period: 3, room_required: 'normal', double_period: false });
});
subjectRows.forEach((r, index) => {
  const teacher = `S${String(index + 1).padStart(3, '0')}`;
  const sections = assignmentSections(r[2], r[3]).map(section => ({
    ...section, classes: expandClassText(section.text)
  }));
  sections.forEach(section => {
    section.classes.forEach(cls => courses.push({
      class: cls, subject: section.subject, teacher, weekly_period: 1,
      room_required: 'normal', double_period: false
    }));
  });
  mappingReport.push({
    source_row: index + 2, teacher_id: teacher, teacher_name: String(r[1]).trim(),
    source_subject: String(r[2]).trim(), source_assignment: String(r[3]).trim(), sections,
    status: sections.some(section => section.classes.length) ? 'expanded' : 'non_timetable_support'
  });
});

for (let grade = 1; grade <= 6; grade++) {
  const cls = classId(grade, 10);
  const add = (subject, teacher, weekly_period = 1, room_required = 'normal', double_period = false) =>
    courses.push({ class: cls, subject, teacher, weekly_period, room_required, double_period });
  add('英語', 'X001');
  add('自然', 'X002', 2, '實驗教室', true);
  add('體育', 'X003', 1, '體育場');
  add('音樂', 'X004', 1, '音樂教室');
  add('資訊', 'X005', 1, '電腦教室');
  add('本土語', 'X006');
}

const rooms = classes.map(c => ({ room_id: `R${c.class_id}`, type: 'normal', capacity: 35 }));
rooms.push(
  { room_id: 'LAB01', type: '實驗教室', capacity: 35 },
  { room_id: 'GYM01', type: '體育場', capacity: 60 },
  { room_id: 'MUSIC01', type: '音樂教室', capacity: 35 },
  { room_id: 'PC01', type: '電腦教室', capacity: 35 }
);
const availability = [
  { teacher: 'H001', weekday: 'Wed', period: 8, available: false, reason: '範例：行政會議' },
  { teacher: 'S001', weekday: 'Mon', period: 1, available: false, reason: '範例：領域會議' }
];
const fixed = classes.map(c => ({ activity: '範例：全校集會', weekday: 'Mon', period: 1, class: c.class_id, teacher: '' }));
const idsByName = new Map();
teachers.forEach(t => {
  if (!idsByName.has(t.name)) idsByName.set(t.name, t.teacher_id);
  else idsByName.set(t.name, null);
});
const staffAssignments = adminRows.map(r => {
  const id = idsByName.get(String(r[2]).trim());
  return { department: r[0], job_title: r[1], teacher: id || '', name: id ? '' : r[2], note: '' };
});

const out = XLSX.utils.book_new();
const add = (name, headers, values, note) => {
  const data = [[note], headers, ...values.map(x => headers.map(h => x[h] ?? ''))];
  XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(data), name);
};
add('Classes', ['class_id', 'grade', 'class_name', 'students', 'homeroom_teacher', 'note'], classes,
  '標準範本：第 3 列起皆為可刪除的 60 班範例資料；請保留第 2 列英文欄位名。');
add('Teachers', ['teacher_id', 'name', 'subject', 'max_daily_period', 'max_continuous_period', 'identity_note'], teachers,
  '標準範本：第 3 列起皆為可刪除的中性範例人員；請保留第 2 列英文欄位名。');
add('Courses', ['class', 'subject', 'teacher', 'weekly_period', 'room_required', 'double_period'], courses,
  '可刪除範例：專科每班 1 節，級任國語與數學各 3 節；正式排課請依本校課程計畫修改，並保留第 2 列欄位名。');
add('TeacherAvailability', ['teacher', 'weekday', 'period', 'available', 'reason'], availability,
  '僅供演示教師不可排時段。');
add('Rooms', ['room_id', 'type', 'capacity'], rooms, '範例以各班普通教室為主。');
add('FixedActivities', ['activity', 'weekday', 'period', 'class', 'teacher'], fixed, '僅供演示週一第 1 節固定活動。');
add('StaffAssignments', ['department', 'job_title', 'teacher', 'name', 'note'], staffAssignments,
  '由匿名化配置簿整理，可用於匯出教職員配置結果。');

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, XLSX.write(out, { type: 'buffer', bookType: 'xlsx' }));
const reportPath = path.join(root, 'tests/fixtures/generated/standard-template-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  source: 'staffing-source-neutral.xlsx',
  assumptions: {
    specialist_weekly_period: 1, homeroom_language_weekly_period: 3,
    homeroom_math_weekly_period: 3, students_per_class: 30,
    note: '以上皆為排課演示假設，不是實校課程計畫。'
  },
  counts: { classes: classes.length, teachers: teachers.length, course_rows: courses.length, staff_assignments: staffAssignments.length },
  subject_teacher_mapping: mappingReport
}, null, 2), 'utf8');
console.log(JSON.stringify({ output, classes: classes.length, teachers: teachers.length, courses: courses.length, staffAssignments: staffAssignments.length }));
