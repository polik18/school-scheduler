// 匯出課表：班級／教師／教室／完整排課／驗收報告
export async function downloadExcel(schedule, rep = {}) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  const add = (n, d) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d), n);
  add('完整排課', schedule);
  add('班級課表', schedule.map(x => ({
    班級: x.class, 星期: x.day, 節次: x.period, 科目: x.subject, 教師: x.teacher, 教室: x.room_id
  })));
  add('教師課表', schedule.map(x => ({
    教師: x.teacher, 星期: x.day, 節次: x.period, 班級: x.class, 科目: x.subject
  })));
  add('教室使用', schedule.map(x => ({
    教室: x.room_id, 星期: x.day, 節次: x.period, 課程: x.subject
  })));
  add('驗收報告', [{
    總堂數: rep.total, 未排入: (rep.pending || 0),
    成功: rep.success ?? true, 評分: rep.score ?? 0
  }]);
  XLSX.writeFile(wb, 'school-result.xlsx');
}
