import * as XLSX from 'xlsx';

export function createTemplate(){
 const wb=XLSX.utils.book_new();
 const sheets={
  Classes:[{class_id:'601',grade:'六年級',class_name:'601',students:30}],
  Teachers:[{teacher_id:'T001',name:'王老師',subject:'國文',max_daily_period:6,max_continuous_period:3}],
  Courses:[{class:'601',subject:'國文',teacher:'T001',weekly_period:5,room_required:'normal',double_period:false}],
  TeacherAvailability:[{teacher:'T001',weekday:'Wed',period:8,available:false,reason:'行政會議'}],
  Rooms:[{room_id:'R001',type:'normal',capacity:35}],
  FixedActivities:[{activity:'朝會',weekday:'Mon',period:1,class:'601',teacher:'T001'}]
 };
 Object.entries(sheets).forEach(([n,d])=>XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(d),n));
 XLSX.writeFile(wb,'school-scheduler-template.xlsx');
}
