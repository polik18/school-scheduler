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
const classId = (grade, number) => `${grade}${String(number).padStart(2, '0')}`;

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

// 依十二年國教總綱的國小領域節數與彈性學習區間建立完整週課表。
// 這是合成示範配置，不代表任何特定學校核定的課程計畫。
const courses = [];
const specialistPools = {
  local: ['S001','S002','S003','S004'],
  english: ['S005','S006','S007','S008'],
  science: ['S009','S010','S011','S012','S013','S014','S015','S016'],
  arts: ['S017','S018','S019','S020','S021','S022','S023','S024'],
  pe: ['S025','S026','S027','S028','S029','S030','S031','S032']
};
for (const [kind, ids] of Object.entries(specialistPools)) {
  const subject = { local:'本土語文', english:'英語文', science:'自然科學', arts:'藝術', pe:'體育' }[kind];
  ids.forEach((id, index) => {
    const teacher = teachers.find(item => item.teacher_id === id);
    if (teacher) Object.assign(teacher, {
      name: `${subject}科任${String(index + 1).padStart(2, '0')}`, subject,
      max_daily_period: 6, max_continuous_period: 3, identity_note: '60 班課綱擬真合成配置'
    });
  });
}
const pick = (pool, grade, number) => pool[((grade - 1) * 10 + number - 1) % pool.length];
classes.forEach(c => {
  const grade = Number(String(c.class_id)[0]);
  const number = Number(String(c.class_id).slice(1));
  const addCourse = (subject, teacher, weekly_period, room_required = 'normal', double_period = false) =>
    courses.push({ class: c.class_id, subject, teacher, weekly_period, room_required, double_period });
  addCourse('國語文', c.homeroom_teacher, grade <= 2 ? 6 : 5);
  addCourse('數學', c.homeroom_teacher, 4);
  if (grade <= 2) {
    addCourse('生活課程', c.homeroom_teacher, 6);
  } else {
    addCourse('社會', c.homeroom_teacher, 3);
    addCourse('綜合活動', c.homeroom_teacher, 2);
    addCourse('自然科學', pick(specialistPools.science, grade, number), 3, '自然教室', true);
    addCourse('藝術', pick(specialistPools.arts, grade, number), 3, '藝術教室');
    addCourse('英語文', pick(specialistPools.english, grade, number), grade <= 4 ? 1 : 2);
  }
  addCourse('健康教育', c.homeroom_teacher, 1);
  addCourse('體育', pick(specialistPools.pe, grade, number), 2, '體育場');
  addCourse('本土語文', pick(specialistPools.local, grade, number), 1);
  addCourse(grade <= 2 ? '彈性學習－閱讀與探索' : '彈性學習－跨域專題', c.homeroom_teacher, grade <= 4 ? 3 : 4);
});

const rooms = classes.map(c => ({ room_id: `R${c.class_id}`, type: 'normal', capacity: 35 }));
rooms.push(
  ...Array.from({length:4}, (_,index) => ({ room_id: `SCI${String(index + 1).padStart(2,'0')}`, type: '自然教室', capacity: 35 })),
  ...Array.from({length:4}, (_,index) => ({ room_id: `ART${String(index + 1).padStart(2,'0')}`, type: '藝術教室', capacity: 35 })),
  ...Array.from({length:4}, (_,index) => ({ room_id: `GYM${String(index + 1).padStart(2,'0')}`, type: '體育場', capacity: 60 }))
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
const weekdayText = { Mon: '星期一', Tue: '星期二', Wed: '星期三', Thu: '星期四', Fri: '星期五', Sat: '星期六' };
const roomTypeText = value => ({ normal: '普通教室', none: '不限教室' }[value] || value);
const yesNo = value => value ? '是' : '否';
const add = (name, columns, values, note) => {
  const data = [[note], columns.map(x => x.label), ...values.map(row => columns.map(column => {
    const value = row[column.key] ?? '';
    return column.format ? column.format(value) : value;
  }))];
  XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet(data), name);
};
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet([
  ['60 班標準排課範本｜使用說明'],
  ['1. 可直接上傳本檔試跑；第 3 列起都是可刪除、可改寫的示範資料。'],
  ['2. 請勿刪除各工作表第 2 列欄位名稱；工作表名稱也請保留。'],
  ['3. 教師代碼、班級代碼與教室代碼必須在各工作表中一致。'],
  ['4. 星期請填「星期一」至「星期五」；是非欄位請填「是」或「否」。'],
  ['5. 「是否可排」填「否」代表該教師在指定時段不可排課。'],
  ['6. 本檔為排課功能示範，不代表任何特定學校的正式課程計畫。'],
  ['7. 建議先保留範例試跑成功，再逐步換成貴校資料並分批檢查。']
]), '使用說明');
XLSX.utils.book_append_sheet(out, XLSX.utils.aoa_to_sheet([
  ['範例資料說明｜60 班課綱擬真合成資料'],
  ['資料性質', '依教育部課綱節數建立的合成排課示範；不是任何特定學校核定課程計畫。'],
  ['課綱基線', '十二年國民基本教育課程綱要總綱，國小領域學習節數與彈性學習課程區間。'],
  ['官方來源', 'https://edu.law.moe.gov.tw/LawContent.aspx?id=GL002057'],
  ['節數選擇', '一、二年級每週 23 節；三、四年級 28 節；五、六年級 30 節，皆位於總綱允許區間。'],
  ['部定領域', '國語文、數學、生活課程／社會、自然科學、藝術、綜合活動、健康與體育、本土語文及英語文。'],
  ['校訂課程', '以「閱讀與探索／跨域專題」作為彈性學習合成範例，正式使用時須換成本校課程計畫。'],
  ['師資假設', '每班配置級任教師；英語文、本土語文、自然科學、藝術與體育採跨班科任合成配置。'],
  ['場地假設', '4 間自然教室、4 間藝術教室、4 個體育場地；普通教室以班級教室處理。'],
  ['隱私', '所有公開姓名均為中性虛構名稱，不含原始或遮蔽後姓名。']
]), '範例資料說明');
add('班級', [
  ['班級代碼','class_id'], ['年級','grade'], ['班級名稱','class_name'], ['學生數','students'], ['導師代碼','homeroom_teacher'], ['備註','note']
].map(([label,key])=>({label,key})), classes,
  '標準範本：第 3 列起為可刪除的 60 班範例資料；請保留第 2 列中文欄位名稱。');
add('教師', [
  ['教師代碼','teacher_id'], ['姓名','name'], ['主要領域','subject'], ['每日最多節數','max_daily_period'], ['最多連續節數','max_continuous_period'], ['身分備註','identity_note']
].map(([label,key])=>({label,key})), teachers,
  '標準範本：第 3 列起為可刪除的中性範例人員；請保留第 2 列中文欄位名稱。');
add('課程', [
  {label:'班級代碼',key:'class'}, {label:'科目',key:'subject'}, {label:'教師代碼',key:'teacher'},
  {label:'每週節數',key:'weekly_period'}, {label:'教室類型',key:'room_required',format:roomTypeText},
  {label:'是否連堂',key:'double_period',format:yesNo}
], courses, '課綱擬真合成範例：每班 23／28／30 節；正式排課仍須依本校核定課程計畫修改。');
add('教師可排時段', [
  {label:'教師代碼',key:'teacher'}, {label:'星期',key:'weekday',format:value=>weekdayText[value]||value},
  {label:'節次',key:'period'}, {label:'是否可排',key:'available',format:yesNo}, {label:'原因',key:'reason'}
], availability, '僅供演示教師不可排時段；「是否可排」填「否」代表不可排。');
add('教室', [
  {label:'教室代碼',key:'room_id'}, {label:'教室類型',key:'type',format:roomTypeText}, {label:'容量',key:'capacity'}
], rooms, '範例以各班普通教室為主；專科教室類型須與課程表一致。');
add('固定活動', [
  {label:'活動名稱',key:'activity'}, {label:'星期',key:'weekday',format:value=>weekdayText[value]||value},
  {label:'節次',key:'period'}, {label:'班級代碼',key:'class'}, {label:'教師代碼',key:'teacher'}
], fixed, '僅供演示星期一第 1 節固定活動。');
add('行政職務', [
  {label:'處室／單位',key:'department'}, {label:'職稱',key:'job_title'}, {label:'教師代碼',key:'teacher'},
  {label:'姓名',key:'name'}, {label:'備註',key:'note'}
], staffAssignments, '由匿名化配置資料整理，可用於建立教職員配置資訊。');

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, XLSX.write(out, { type: 'buffer', bookType: 'xlsx' }));
const reportPath = path.join(root, 'tests/fixtures/generated/standard-template-report.json');
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify({
  source: 'staffing-source-neutral.xlsx',
  assumptions: {
    weekly_totals_by_grade: { '1':23, '2':23, '3':28, '4':28, '5':30, '6':30 },
    curriculum_basis: '十二年國民基本教育課程綱要總綱表4；彈性節數取允許區間內的保守值。',
    source_url: 'https://edu.law.moe.gov.tw/LawContent.aspx?id=GL002057',
    students_per_class: 30,
    note: '師資、場地與彈性課程名稱為合成假設，不是實校核定課程計畫。'
  },
  counts: { classes: classes.length, teachers: teachers.length, course_rows: courses.length, staff_assignments: staffAssignments.length },
  specialist_pools: specialistPools
}, null, 2), 'utf8');
console.log(JSON.stringify({ output, classes: classes.length, teachers: teachers.length, courses: courses.length, staffAssignments: staffAssignments.length }));
