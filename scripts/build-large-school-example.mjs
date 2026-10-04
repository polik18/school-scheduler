import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.argv[2] || path.join(root, 'public/examples/staffing-result-demo.xlsx'));
const output = path.resolve(process.argv[3] || path.join(root, 'public/examples/large-school-schedule-demo.xlsx'));

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

// 這份人員簿沒有每週節數：大型排課範例以保守的演示節數補齊，不宣稱為實校課程計畫。
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

const rooms = classes.map(c => ({ room_id: `R${c.class_id}`, type: 'normal', capacity: 35 }));
const availability = [
  { teacher: 'H001', weekday: 'Wed', period: 8, available: false, reason: '範例：行政會議' },
  { teacher: 'S001', weekday: 'Mon', period: 1, available: false, reason: '範例：領域會議' }
];
const fixed = classes.map(c => ({ activity: '範例：全校集會', weekday: 'Mon', period: 1, class: c.class_id, teacher: '' }));
const staffAssignments = adminRows.map(r => ({ department: r[0], job_title: r[1], teacher: '', name: r[2], note: '' }));

const out = XLSX.utils.book_new();
const add = (name, headers, values, note) => {
  const data = [[note], headers, ...values.map(x => headers.map(h => x[h] ?? ''))];
  XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(data), name);
};
add('Classes', ['class_id', 'grade', 'class_name', 'students', 'homeroom_teacher', 'note'], classes,
  '大型學校範例：由匿名化教職員配置簿整理；學生數為演示值。');
add('Teachers', ['teacher_id', 'name', 'subject', 'max_daily_period', 'max_continuous_period', 'identity_note'], teachers,
  '大型學校範例：人名已遮蔽，ID 為範例編號。');
add('Courses', ['class', 'subject', 'teacher', 'weekly_period', 'room_required', 'double_period'], courses,
  '範例假設：人員簿未提供節數；專科每班 1 節，級任國語與數學各 3 節，請使用者依實際課程計畫修改。');
add('TeacherAvailability', ['teacher', 'weekday', 'period', 'available', 'reason'], availability,
  '僅供演示教師不可排時段。');
add('Rooms', ['room_id', 'type', 'capacity'], rooms, '範例以各班普通教室為主。');
add('FixedActivities', ['activity', 'weekday', 'period', 'class', 'teacher'], fixed, '僅供演示週一第 1 節固定活動。');
add('StaffAssignments', ['department', 'job_title', 'teacher', 'name', 'note'], staffAssignments,
  '由匿名化配置簿整理，可用於匯出教職員配置結果。');

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, XLSX.write(out, { type: 'buffer', bookType: 'xlsx' }));
fs.writeFileSync(path.join(path.dirname(output), 'large-school-example-report.json'), JSON.stringify({
  source: 'staffing-result-demo.xlsx',
  assumptions: {
    specialist_weekly_period: 1, homeroom_language_weekly_period: 3,
    homeroom_math_weekly_period: 3, students_per_class: 30,
    note: '以上皆為排課演示假設，不是實校課程計畫。'
  },
  counts: { classes: classes.length, teachers: teachers.length, course_rows: courses.length, staff_assignments: staffAssignments.length },
  subject_teacher_mapping: mappingReport
}, null, 2), 'utf8');
console.log(JSON.stringify({ output, classes: classes.length, teachers: teachers.length, courses: courses.length, staffAssignments: staffAssignments.length }));
