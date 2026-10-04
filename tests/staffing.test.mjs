import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildStaffingPlan, staffingPlanFromRows, validateStaffingPlan } from '../src/model/staffing.js';
import { isStaffingWorkbook, readStaffingWorkbook } from '../src/importExcel.js';

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
