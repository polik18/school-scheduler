// 產生中文雙語標準範本（含真實範例資料）
export async function createTemplate(){
 const XLSX=await import('xlsx');
 const wb=XLSX.utils.book_new();

 // 每個工作表：第1行中文說明、第2行英文欄位、第3行起範例
 const sheets={
  Classes:[
   ['填寫說明：請刪掉範例，填入您的班級資料。'],
   ['class_id','grade','class_name','students','homeroom_teacher','note'],
   ['601','六年級','六甲班',30,'T001',''],
   ['602','六年級','六乙班',30,'T002',''],
   ['603','六年級','六丙班',30,'T003','']
  ],
  Teachers:[
   ['填寫說明：請刪掉範例，填入您的教師資料。'],
   ['teacher_id','name','subject','max_daily_period','max_continuous_period','identity_note'],
   ['T001','王老師','國文',6,3,''],
   ['T002','李老師','國文',6,3,''],
   ['T003','陳老師','數學',6,3,'數學領召']
  ],
  Courses:[
   ['填寫說明：請刪掉範例，填入您的課程（班級／科目／教師／每週堂數）。'],
   ['class','subject','teacher','weekly_period','room_required','double_period'],
   ['601','國文','T001',5,'normal',false],
   ['601','數學','T003',5,'normal',false],
   ['602','國文','T002',5,'normal',false]
  ],
  TeacherAvailability:[
   ['填寫說明：請刪掉範例，填入教師不可教的時段（可留空表示全部可用）。'],
   ['teacher','weekday','period','available','reason'],
   ['T001','Wed',8,false,'行政會議'],
   ['T003','Thu',1,false,'教研']
  ],
  Rooms:[
   ['填寫說明：請刪掉範例，填入您的教室資料。'],
   ['room_id','type','capacity'],
   ['R001','normal',35],
   ['R002','normal',35]
  ],
  FixedActivities:[
   ['填寫說明：請刪掉範例，填入固定活動（如朝會、週會）。'],
   ['activity','weekday','period','class','teacher'],
   ['朝會','Mon',1,'601','T001']
  ],
  StaffAssignments:[
   ['填寫說明：可選填行政與支援職務，teacher 或 name 擇一填寫。'],
   ['department','job_title','teacher','name','note'],
   ['教務處','教學組長','T001','','']
  ]
 };
 Object.entries(sheets).forEach(([n,d])=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(d),n));
 XLSX.writeFile(wb,'school-scheduler-template.xlsx');
}
