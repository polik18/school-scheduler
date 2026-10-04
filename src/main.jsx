import { useState, useCallback, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { readSchoolExcel, validateInput } from './importExcel.js';
import { solveSchedule } from './model/solver.js';
import { diagnosePendingCourse } from './model/diagnosis.js';
import { moveLesson } from './manual.js';
import { downloadExcel, downloadStaffingExcel } from './exportExcel.js';
import { buildStaffingPlan } from './model/staffing.js';
import { saveVersion, loadVersions, deleteVersion } from './storage.js';
import './style.css';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LABELS = { Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五', Sat: '六' };
const VIEW_LABELS = { class: '班級課表', teacher: '教師課表', room: '教室使用' };

export default function App() {
  const [data, setData] = useState(null);      // 匯入的標準資料
  const [validation, setValidation] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [settings, setSettings] = useState({ days: DAYS.slice(0, 5), periodsPerDay: 8 });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [lockMode, setLockMode] = useState(false);
  const [activeView, setActiveView] = useState('class');
  const [selectedLesson, setSelectedLesson] = useState(null);
  const [solving, setSolving] = useState(false);
  const workerRef = useRef(null);

  // 匯入檔案
  const handleImport = useCallback(async (file) => {
    setError(''); setValidation(null); setSchedule(null);
    try {
      const parsed = await readSchoolExcel(file);
      setData(parsed);
      if (parsed.kind === 'staffing') {
        const p = parsed.staffingPlan;
        setStatus(`已載入教職員配置：${p.homeroom.length} 筆級任 / ${p.subjectTeachers.length} 筆科任 / ${p.administration.length} 筆行政支援`);
        return;
      }
      const v = validateInput(parsed);
      setValidation(v);
      setStatus(parsed.courses.length ? `匯入完成：${parsed.teachers.length} 師 / ${parsed.classes.length} 班 / ${parsed.courses.length} 課` : '匯入完成，但課程資料為空');
    } catch (e) {
      setError(`匯入失敗：${e.message}`);
    }
  }, []);

  // 執行排課
  const handleSolve = useCallback(() => {
    if (!data) { setError('請先匯入資料'); return; }
    setError(''); setSchedule(null); setStatus('正在排課…');
    setSolving(true);
    const payload = { courses: data.courses, days: settings.days, periodsPerDay: settings.periodsPerDay,
      rooms: data.rooms, fixed: data.fixedActivities, teachers: data.teachers, classes: data.classes };
    const accept = result => {
      setSchedule(result);
      setSelectedLesson(null);
      setSolving(false);
      const seconds = ((result.elapsedMs || 0) / 1000).toFixed(1);
      if (!result.success) setStatus(`排課完成（${seconds} 秒），但有課程未能排入，請檢視衝突診斷。`);
      else setStatus(`排課成功！耗時 ${seconds} 秒。`);
    };
    try {
      if (typeof Worker === 'undefined') { accept(solveSchedule(payload)); return; }
      const worker = new Worker(new URL('./solverWorker.js', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = event => {
        worker.terminate(); workerRef.current = null;
        if (event.data.ok) accept(event.data.result);
        else { setSolving(false); setError(`排課失敗：${event.data.error}`); }
      };
      worker.onerror = event => {
        worker.terminate(); workerRef.current = null; setSolving(false);
        setError(`排課失敗：${event.message || '背景運算錯誤'}`);
      };
      worker.postMessage(payload);
    } catch (e) {
      setSolving(false); setError(`排課失敗：${e.message}`);
    }
  }, [data, settings]);

  const handleCancelSolve = useCallback(() => {
    workerRef.current?.terminate(); workerRef.current = null;
    setSolving(false); setStatus('已取消排課。');
  }, []);

  // 調課
  const handleTimetableCell = useCallback((index, target) => {
    if (!schedule || !lockMode) return;
    setError('');
    if (selectedLesson === null) {
      if (index === null) {
        setError('請先點選要移動的課程，再選擇空白目的時段。');
        return;
      }
      const lesson = schedule.schedule[index];
      setSelectedLesson(index);
      setStatus(`已選取「${lesson.subject}」；請點選要移入的空白時段。`);
      return;
    }
    if (index === selectedLesson) {
      setSelectedLesson(null);
      setStatus('已取消調課選取。');
      return;
    }
    if (index !== null) {
      setError('目標時段已有課程，請選擇空白時段。');
      return;
    }
    const next = moveLesson(schedule.schedule, selectedLesson, target);
    const moved = next[selectedLesson];
    if (moved && moved.day === target.day && moved.period === target.period) {
      setSchedule({ ...schedule, schedule: next });
      setStatus(`已將「${moved.subject}」調整至星期${DAY_LABELS[moved.day] || moved.day}第 ${moved.period} 節。`);
      setSelectedLesson(null);
    } else {
      setError('無法移動：班級、教師或教室在目標時段有衝突。');
    }
  }, [lockMode, schedule, selectedLesson]);

  // 儲存版本
  const handleSave = useCallback(() => {
    if (!data || !schedule) { setError('需先匯入並排課才能儲存'); return; }
    const name = prompt('請輸入版本名稱（例如：初版課表）：');
    if (!name) return;
    const record = { name, createdAt: new Date().toISOString(), data, schedule: schedule.schedule, settings };
    saveVersion(name, record);
    setStatus(`已儲存版本「${name}」`);
  }, [data, schedule, settings]);

  // 載入版本
  const handleLoad = useCallback((name) => {
    const versions = loadVersions();
    const record = versions.find(v => v.name === name);
    if (!record) return;
    setData(record.data);
    setSettings(record.settings || settings);
    setValidation(validateInput(record.data));
    setSchedule({ success: true, schedule: record.schedule, pending: [], score: 0, diagnostics: [] });
    setSelectedLesson(null);
    setStatus(`已載入版本「${name}」`);
  }, [settings]);

  const handleDelete = useCallback((name) => {
    deleteVersion(name);
    setStatus(`已刪除版本「${name}」`);
  }, []);

  // 匯出 PDF（瀏覽器列印）
  const handleExportPdf = useCallback(() => {
    if (!schedule) { setError('請先排課'); return; }
    const w = window.open('', '_blank');
    if (!w) { setError('彈出視窗被阻擋，請允許本頁彈出視窗'); return; }
    const classIds = [...new Set(schedule.schedule.map(c => c.class))];
    let html = `<h1>學校排課表</h1>`;
    classIds.forEach(cls => {
      html += `<h2>班級：${escapeHtml(cls)}</h2>`;
      html += buildGridHtml(schedule.schedule, cls, settings.days, settings.periodsPerDay);
    });
    w.document.write(`<html><head><title>課表</title></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  }, [schedule, settings]);

  if (!data) {
    return (
      <div className="site-shell">
        <BrandHeader />
        <main id="main" className="landing-main">
          <WelcomeScreen onImport={handleImport} error={error} />
        </main>
        <SiteFooter />
      </div>
    );
  }

  if (data.kind === 'staffing') {
    return <StaffingWorkspace data={data} status={status} error={error} onImport={handleImport}
      onReset={() => { setData(null); setStatus(''); setError(''); }} />;
  }

  return (
    <div className="site-shell">
      <BrandHeader />
      <main id="main" className="app">
        <section className="workspace-heading">
          <div><p className="eyebrow">Schedule workspace · Version 10</p><h1>校務智慧排課工作區</h1><p>依序完成資料驗證、限制設定、排課、診斷與輸出。</p></div>
          <button className="btn secondary" onClick={() => { setData(null); setSchedule(null); setValidation(null); setStatus(''); setError(''); setSelectedLesson(null); setLockMode(false); }}>
            ← 重新匯入
          </button>
        </section>

        {status && <div className="banner info" role="status">{status}</div>}
        {error && <div className="banner error" role="alert">{error}</div>}

        <section className="panel">
          <div className="panel-heading"><span>01</span><div><h2>資料匯入</h2><p>更換 Excel 或重新下載標準範本。</p></div></div>
          <div className="row">
            <label className="btn file-input">上傳 Excel<input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files[0] && handleImport(e.target.files[0])} /></label>
            <a className="btn" href="./school-scheduler-template.xlsx" download>下載標準範本</a>
          </div>
          <div className="data-summary" aria-label="匯入資料摘要"><div><strong>{data.teachers.length}</strong><span>位教師</span></div><div><strong>{data.classes.length}</strong><span>個班級</span></div><div><strong>{data.courses.length}</strong><span>筆課程</span></div></div>
        </section>

        {validation && (
          <section className="panel">
            <div className="panel-heading"><span>02</span><div><h2>資料驗證</h2><p>先修正必要欄位，再交給排課核心。</p></div></div>
            {validation.errors.length === 0 && <div className="banner ok">資料格式與必要欄位均已通過驗證。</div>}
            {validation.errors.length > 0 && <div className="banner error"><strong>發現 {validation.errors.length} 個錯誤：</strong><ul>{validation.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {validation.warnings.length > 0 && <div className="banner warn"><strong>提示：</strong><ul>{validation.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
          </section>
        )}

        <section className="panel">
          <div className="panel-heading"><span>03</span><div><h2>排課設定</h2><p>決定每週上課天數與每日節數。</p></div></div>
          <div className="settings-grid">
            <label>每週上課天數<select value={settings.days.length} onChange={(e) => setSettings(s => ({ ...s, days: DAYS.slice(0, Number(e.target.value)) }))}><option value="5">5 天（週一至週五）</option><option value="6">6 天（週一至週六）</option></select></label>
            <label>每日節數<select value={settings.periodsPerDay} onChange={(e) => setSettings(s => ({ ...s, periodsPerDay: Number(e.target.value) }))}><option value="6">6 節</option><option value="7">7 節</option><option value="8">8 節</option></select></label>
          </div>
          <button className="btn primary" onClick={handleSolve} disabled={validation?.errors.length > 0 || solving}>{solving ? '背景排課中…' : '執行智慧排課 →'}</button>
          {solving && <button className="btn secondary" onClick={handleCancelSolve}>取消排課</button>}
        </section>

        {schedule && <>
          <section className="panel">
            <div className="panel-heading"><span>04</span><div><h2>排課結果</h2><p>{schedule.success ? '排課核心已完成計算，可進一步檢查與匯出。' : '仍有課程未能排入，請查看衝突診斷。'}</p></div></div>
            <div className="result-stats"><div><strong>{schedule.schedule.length}</strong><span>已排入</span></div><div><strong>{schedule.pending?.length || 0}</strong><span>待處理</span></div><div><strong>{schedule.score ?? 0}</strong><span>品質指標</span></div><div><strong>{((schedule.elapsedMs || 0) / 1000).toFixed(1)}s</strong><span>運算耗時</span></div></div>
            {schedule.diagnostics?.map((item, i) => <div key={i} className="banner warn">{item.message}</div>)}
            <div className="row">
              <button className="btn" onClick={() => setStatus(schedule.success ? '排課成功，無硬性衝突。' : '尚有課程未排入，請檢視衝突診斷。')}>重新檢查結果</button>
              <button className="btn secondary" onClick={handleSave}>儲存本機版本</button>
              <button className="btn" onClick={() => downloadExcel(schedule.schedule, { total: schedule.schedule.length, pending: schedule.pending?.length || 0, success: schedule.success, score: schedule.score })}>匯出 Excel</button>
              <button className="btn" onClick={() => downloadStaffingExcel(buildStaffingPlan(data))}>匯出教職員配置</button>
              <button className="btn" onClick={handleExportPdf}>匯出 PDF</button>
            </div>
          </section>

          {schedule.pending?.length > 0 && <section className="panel">
            <div className="panel-heading"><span>05</span><div><h2>衝突診斷</h2><p>逐筆查看未排入課程可能碰到的限制。</p></div></div>
            {schedule.pending.map((c, i) => <div key={i} className="diagnostic"><div className="diag-title">未排入：{c.class} {c.subject}（{c.teacher}）</div>{diagnosePendingCourse(c, { courses: data.courses, teachers: data.teachers, rooms: data.rooms, fixed: data.fixedActivities, classes: data.classes, days: settings.days, periodsPerDay: settings.periodsPerDay }).map((r, j) => <div key={j} className={`diag-${r.level}`}>{r.message}</div>)}</div>)}
          </section>}

          <section className="panel timetable-panel">
            <div className="panel-heading"><span>{schedule.pending?.length > 0 ? '06' : '05'}</span><div><h2>課表檢視與人工調課</h2><p>切換檢視角度；開啟調課後先選課程，再選空白目的時段。</p></div></div>
            <div className="view-controls">
              <div className="view-tabs" role="tablist" aria-label="課表檢視方式">{Object.entries(VIEW_LABELS).map(([value, label]) => <button key={value} role="tab" aria-selected={activeView === value} className={activeView === value ? 'active' : ''} onClick={() => { setActiveView(value); setSelectedLesson(null); }}>{label}</button>)}</div>
              <label className="toggle"><input type="checkbox" checked={lockMode} onChange={(e) => { setLockMode(e.target.checked); setSelectedLesson(null); }} /><span>人工調課</span></label>
            </div>
            {lockMode && <div className="banner warn">調課模式已開啟：先點選一堂課，再點選空白時段；再次點選原課程可取消。</div>}
            <ViewTab view={activeView} schedule={schedule} settings={settings} lockMode={lockMode} selectedLesson={selectedLesson} onCellClick={handleTimetableCell} />
          </section>

          <section className="panel">
            <div className="panel-heading"><span>{schedule.pending?.length > 0 ? '07' : '06'}</span><div><h2>本機版本管理</h2><p>版本只儲存在目前瀏覽器，不會上傳到網站伺服器。</p></div></div>
            <VersionManager versions={loadVersions()} onLoad={handleLoad} onDelete={handleDelete} />
          </section>
        </>}
      </main>
      <SiteFooter />
    </div>
  );
}

function StaffingWorkspace({ data, status, error, onImport, onReset }) {
  const plan = data.staffingPlan;
  const validation = data.staffingValidation || { errors: [], warnings: [] };
  return (
    <div className="site-shell">
      <BrandHeader />
      <main id="main" className="app">
        <section className="workspace-heading"><div><p className="eyebrow">Staffing workspace</p><h1>教職員配置結果</h1><p>保留級任、科任與行政支援的資料關係，不依賴原 Excel 排版。</p></div><button className="btn secondary" onClick={onReset}>← 回首頁</button></section>
        {status && <div className="banner info" role="status">{status}</div>}
        {error && <div className="banner error" role="alert">{error}</div>}
        {validation.errors.map((x, i) => <div key={i} className="banner error">{x}</div>)}
        {validation.warnings.map((x, i) => <div key={i} className="banner warn">{x}</div>)}
        <section className="panel"><div className="panel-heading"><span>01</span><div><h2>資料總覽</h2><p>可直接載入「級任導師／科任教師／行政與支援人員」工作表。</p></div></div>
          <div className="data-summary"><div><strong>{plan.homeroom.length}</strong><span>級任配置</span></div><div><strong>{plan.subjectTeachers.length}</strong><span>科任教師</span></div><div><strong>{plan.administration.length}</strong><span>行政支援</span></div></div>
          <div className="row"><label className="btn file-input">更換 Excel<input type="file" accept=".xlsx,.xls" onChange={e => e.target.files[0] && onImport(e.target.files[0])} /></label><button className="btn primary" onClick={() => downloadStaffingExcel(plan)}>匯出教職員配置</button></div>
        </section>
        <StaffingTable title="級任導師" headers={['年級','班級','導師','備註']} rows={plan.homeroom.map(x => [x.grade,x.class_name || x.class_id,x.teacher_name || x.teacher_id,x.note])} />
        <StaffingTable title="科任教師" headers={['教師','領域／科目','任教年級與班級','備註']} rows={plan.subjectTeachers.map(x => [x.teacher_name || x.teacher_id,(x.subjects || []).join('、'),x.assignment_text || '',x.note])} />
        <StaffingTable title="行政與支援人員" headers={['處室／單位','職稱','姓名','備註']} rows={plan.administration.map(x => [x.department,x.job_title,x.name || x.teacher_id,x.note])} />
      </main><SiteFooter />
    </div>
  );
}

function StaffingTable({ title, headers, rows }) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2><p>{rows.length} 筆</p></div></div><div className="table-scroll"><table className="timetable"><thead><tr>{headers.map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div></section>;
}

function buildGridHtml(schedule, classId, days, periodsPerDay) {
  let html = '<table border="1" cellpadding="6"><tr><th>節次</th>';
  days.forEach(d => html += `<th>${escapeHtml(DAY_LABELS[d] || d)}</th>`);
  html += '</tr>';
  for (let p = 1; p <= periodsPerDay; p++) {
    html += `<tr><th>${p}</th>`;
    days.forEach(d => {
      const cell = schedule.find(c => c.class === classId && c.day === d && c.period === p);
      html += `<td>${cell ? `${escapeHtml(cell.subject)}<br/><small>${escapeHtml(cell.teacher)}</small>` : ''}</td>`;
    });
    html += '</tr>';
  }
  html += '</table>';
  return html;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function ViewTab({ view, schedule, settings, lockMode, selectedLesson, onCellClick }) {
  const classIds = [...new Set(schedule.schedule.map(c => c.class))];
  const teacherIds = [...new Set(schedule.schedule.map(c => c.teacher))];
  const roomIds = [...new Set(schedule.schedule.map(c => c.room_id).filter(Boolean))];

  return (
    <div className="timetable-list">
      {view === 'class' && classIds.map(cls => (
        <TimetableGrid key={cls} title={`班級 ${cls}`} schedule={schedule} settings={settings}
          lockMode={lockMode} selectedLesson={selectedLesson} filterField="class" filterValue={cls} onCellClick={onCellClick} />
      ))}
      {view === 'teacher' && teacherIds.map(tid => (
        <TimetableGrid key={tid} title={`教師 ${tid}`} schedule={schedule} settings={settings}
          lockMode={lockMode} selectedLesson={selectedLesson} filterField="teacher" filterValue={tid} onCellClick={onCellClick} />
      ))}
      {view === 'room' && roomIds.map(rid => (
        <TimetableGrid key={rid} title={`教室 ${rid}`} schedule={schedule} settings={settings}
          lockMode={lockMode} selectedLesson={selectedLesson} filterField="room_id" filterValue={rid} onCellClick={onCellClick} />
      ))}
      {view === 'room' && roomIds.length === 0 && <div className="empty-state">目前沒有專用教室排課資料。</div>}
    </div>
  );
}

function TimetableGrid({ title, schedule, settings, lockMode, selectedLesson, filterField, filterValue, onCellClick }) {
  return (
    <div className="timetable-card">
      <h3>{title}</h3>
      <div className="table-scroll"><table className="timetable">
        <thead>
          <tr><th>節次</th>{DAYS.slice(0, settings.days.length).map(d => <th key={d}>{DAY_LABELS[d]}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({ length: Math.min(settings.periodsPerDay, 8) }, (_, p) => {
            const period = p + 1;
            return (
              <tr key={period}>
                <th>{period}</th>
                {DAYS.slice(0, settings.days.length).map(d => {
                  const cell = schedule.schedule.find(c => c[filterField] === filterValue && c.day === d && c.period === period);
                  const index = cell ? schedule.schedule.indexOf(cell) : null;
                  const cellClass = [lockMode ? (cell ? 'editable' : 'drop-target') : '', index === selectedLesson ? 'selected' : ''].filter(Boolean).join(' ');
                  return (
                    <td key={d} className={cellClass} onClick={() => lockMode && onCellClick(index, { day: d, period })}>
                      {cell ? <><strong>{cell.subject}</strong><small>{cell.teacher}{cell.room_id ? ` · ${cell.room_id}` : ''}</small></> : lockMode && selectedLesson !== null ? <span className="empty-hint">移至這裡</span> : null}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table></div>
    </div>
  );
}

function VersionManager({ versions, onLoad, onDelete }) {
  if (!versions.length) return <p className="hint">尚無儲存版本</p>;
  return (
    <div className="version-list">
      {versions.map(v => (
        <div key={v.name} className="version-item">
          <span>{v.name}</span>
          <span className="row">
            <button className="btn small" onClick={() => onLoad(v.name)}>載入</button>
            <button className="btn small secondary" onClick={() => onDelete(v.name)}>刪除</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function WelcomeScreen({ onImport, error }) {
  return (
    <>
      <section className="welcome-hero">
        <div className="welcome-copy">
          <p className="eyebrow">Polik Projects · School Operations</p>
          <div className="badge-row"><span className="badge">瀏覽器本機運算</span><span className="badge warm">Excel 工作流程</span></div>
          <h1>把複雜的排課限制，<em>整理成一張能執行的課表。</em></h1>
          <p>從教師、班級、課程與教室資料開始，自動檢查必要欄位、安排時段、診斷衝突，最後再由教學組人工微調與輸出。</p>
          <div className="privacy-note"><strong>資料留在目前瀏覽器</strong><span>Excel 內容不需要上傳到應用程式伺服器；本機版本也只存於這台裝置的瀏覽器。</span></div>
        </div>
        <div className="welcome-card">
          <div className="welcome-card-label">Start scheduling</div>
          <h2>四個步驟，建立第一版課表</h2>
          {error && <div className="banner error" role="alert">{error}</div>}
          <ol className="welcome-steps">
            <li><span>01</span><div><strong>下載範本</strong><small>填寫教師、班級、課程、教室與限制</small></div></li>
            <li><span>02</span><div><strong>匯入並驗證</strong><small>先找出缺漏與格式問題</small></div></li>
            <li><span>03</span><div><strong>執行排課</strong><small>檢視未排入課程與衝突原因</small></div></li>
            <li><span>04</span><div><strong>微調與匯出</strong><small>輸出 Excel 或列印為 PDF</small></div></li>
          </ol>
          <div className="welcome-actions">
            <label className="btn primary file-input">匯入 Excel 開始排課<input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files[0] && onImport(e.target.files[0])} /></label>
            <a className="btn inverse" href="./school-scheduler-template.xlsx" download>先下載標準範本</a>
          </div>
          <p className="hint">標準範本內含 60 班可直接試跑資料；也可刪除範例列後填入本校資料，請保留英文欄位列。</p>
        </div>
      </section>
      <section className="feature-grid" aria-label="排課工具特色">
        <article><span>VALIDATE</span><h2>匯入先驗證</h2><p>將教師、班級、課程、教室及不可排時段整理成一致資料，再開始計算。</p></article>
        <article><span>SOLVE</span><h2>限制一起算</h2><p>同時考慮班級、教師、教室、固定活動與每日節數，降低人工反覆對照。</p></article>
        <article><span>ADJUST</span><h2>結果能微調</h2><p>依班級、教師或教室檢視課表，人工移動時即時阻擋基本時段衝突。</p></article>
      </section>
    </>
  );
}

function BrandHeader() {
  return (
    <>
      <a className="skip-link" href="#main">跳到主要內容</a>
      <header className="site-header">
        <div className="header-inner">
          <div className="brand-lockup"><img src="./polik-scheduler-mark.svg" alt="" width="44" height="44" /><span><strong>Polik Scheduler</strong><small>校務智慧排課</small></span></div>
          <nav aria-label="網站導覽"><a href="https://polik18.github.io/">← Polik 專案總覽</a><a href="./">排課首頁</a></nav>
        </div>
      </header>
    </>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer"><div><strong>Polik Scheduler</strong><span>把限制整理成可執行的課表。</span></div><div><a href="https://polik18.github.io/">Polik Projects</a><span>資料於瀏覽器本機處理</span></div></footer>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
