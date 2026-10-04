import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildStaffingPlan, staffingPlanFromRows, validateStaffingPlan } from '../src/model/staffing.js';
import { isStaffingWorkbook, readScheduleWorkbook, readStaffingWorkbook } from '../src/importExcel.js';
import { scheduleRowsForExport } from '../src/exportExcel.js';

test('可讀取三張教職員配置工作表', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['年級', '班級', '導師姓名', '備註'], ['一年級', '1年1班', '甲教師', '']
  ]), '級任導師');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['編號', '教師姓名', '任教領域 / 科目', '任教年級與班級', '身分 / 備註'],
    [1, '乙教師', '英語、生活雙語', '英語：一年級 1~3班；生活雙語：一年級 4班', '領召']
  ]), '科任教師');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['處室 / 單位', '職稱', '姓名'], ['教務處', '教學組長', '丙教師']
  ]), '行政與支援人員');

  assert.equal(isStaffingWorkbook(wb), true);
  const plan = readStaffingWorkbook(XLSX, wb);
  assert.equal(plan.homeroom[0].class_name, '1年1班');
  assert.deepEqual(plan.subjectTeachers[0].subjects, ['英語', '生活雙語']);
  assert.equal(plan.subjectTeachers[0].assignment_text, '英語：一年級 1~3班；生活雙語：一年級 4班');
  assert.equal(plan.administration[0].job_title, '教學組長');
});

test('可從標準排課資料建立教職員配置結果', () => {
  const plan = buildStaffingPlan({
    classes: [{ class_id: '101', grade: '一年級', class_name: '1年1班', homeroom_teacher: 'T01' }],
    teachers: [{ teacher_id: 'T01', name: '甲教師' }, { teacher_id: 'T02', name: '乙教師', identity_note: '英語領召' }],
    courses: [{ class: '101', subject: '英語', teacher: 'T02', weekly_period: 2 }],
    staffAssignments: [{ department: '教務處', job_title: '教學組長', teacher: 'T01' }]
  });
  assert.equal(plan.homeroom[0].teacher_name, '甲教師');
  assert.equal(plan.subjectTeachers[0].assignments[0].class_name, '1年1班');
  assert.equal(plan.administration[0].name, '甲教師');
  assert.deepEqual(validateStaffingPlan(plan).errors, []);
});

test('重複級任會提示但不丟失資料', () => {
  const plan = staffingPlanFromRows({
    homeroomRows: [['幼兒園', '紅班', '甲師', ''], ['幼兒園', '紅班', '乙師', '']]
  });
  assert.equal(plan.homeroom.length, 2);
  assert.equal(validateStaffingPlan(plan).warnings.length, 1);
});

test('中文工作表、中文欄位與中文值可匯入排課模型', () => {
  const wb = XLSX.utils.book_new();
  const append = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['本列是說明'], ...rows
  ]), name);
  append('班級', [['班級代碼', '年級', '班級名稱', '學生數', '導師代碼'], ['101', '一年級', '1年1班', 30, 'T01']]);
  append('教師', [['教師代碼', '姓名', '主要領域', '每日最多節數', '最多連續節數'], ['T01', '甲教師', '級任', 7, 4]]);
  append('課程', [['班級代碼', '科目', '教師代碼', '每週節數', '教室類型', '是否連堂'], ['101', '國語', 'T01', 3, '普通教室', '否']]);
  append('教師可排時段', [['教師代碼', '星期', '節次', '是否可排', '原因'], ['T01', '星期三', 8, '否', '會議']]);
  append('教室', [['教室代碼', '教室類型', '容量'], ['R101', '普通教室', 35]]);
  append('固定活動', [['活動名稱', '星期', '節次', '班級代碼', '教師代碼'], ['朝會', '星期一', 1, '101', '']]);

  const input = readScheduleWorkbook(XLSX, wb);
  assert.equal(input.classes[0].class_id, '101');
  assert.equal(input.courses[0].room_required, 'normal');
  assert.equal(input.courses[0].double_period, false);
  assert.deepEqual(input.teachers[0].unavailable, [{ weekday: 'Wed', period: 8 }]);
  assert.equal(input.fixedActivities[0].weekday, 'Mon');
});

test('匯出排課資料只使用繁體中文欄位與星期', () => {
  const rows = scheduleRowsForExport([{
    class: '101', subject: '國語', teacher: 'T01', day: 'Mon', period: 2,
    room_id: 'R101', locked: true, manual: false, unit: 1, status: 'scheduled'
  }]);
  assert.deepEqual(Object.keys(rows[0]), ['班級', '科目', '教師', '星期', '節次', '教室', '是否鎖定', '是否人工調整']);
  assert.equal(rows[0].星期, '星期一');
  assert.equal(rows[0].是否鎖定, '是');
  assert.equal(rows[0].是否人工調整, '否');
  assert.equal('status' in rows[0], false);
});
