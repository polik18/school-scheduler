import { useState, useCallback, useEffect, useRef } from 'react';
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
  const [helpOpen, setHelpOpen] = useState(() => {
    try { return localStorage.getItem('polik-scheduler-guide-seen') !== '1'; } catch { return true; }
  });
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
  const [solveProgress, setSolveProgress] = useState(null);
  const [solveElapsed, setSolveElapsed] = useState(0);
  const workerRef = useRef(null);
  const solveStartedAt = useRef(0);
  const helpOpenerRef = useRef(null);

  useEffect(() => {
    if (!solving) return undefined;
    const timer = setInterval(() => setSolveElapsed(Date.now() - solveStartedAt.current), 250);
    return () => clearInterval(timer);
  }, [solving]);

  const closeHelp = useCallback(() => {
    try { localStorage.setItem('polik-scheduler-guide-seen', '1'); } catch { /* 無痕模式仍可關閉本次導覽 */ }
    setHelpOpen(false);
    setTimeout(() => helpOpenerRef.current?.focus(), 0);
  }, []);
  const openHelp = useCallback(event => {
    helpOpenerRef.current = event?.currentTarget || document.activeElement;
    setHelpOpen(true);
  }, []);

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
    solveStartedAt.current = Date.now();
    setSolveElapsed(0);
    setSolveProgress({ placed: 0, total: data.courses.reduce((sum, course) => sum + Number(course.weekly_period || 1), 0), nodes: 0, backtracks: 0, elapsedMs: 0 });
    const payload = { courses: data.courses, days: settings.days, periodsPerDay: settings.periodsPerDay,
      rooms: data.rooms, fixed: data.fixedActivities, teachers: data.teachers, classes: data.classes };
    const accept = result => {
      setSchedule(result);
      setSelectedLesson(null);
      setSolving(false);
      setSolveProgress(null);
      const seconds = ((result.elapsedMs || 0) / 1000).toFixed(1);
      if (!result.success) setStatus(`排課完成（${seconds} 秒），但有課程未能排入，請檢視衝突診斷。`);
      else setStatus(`排課成功！耗時 ${seconds} 秒。`);
    };
    try {
      if (typeof Worker === 'undefined') { accept(solveSchedule(payload)); return; }
      const worker = new Worker(new URL('./solverWorker.js', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = event => {
        if (event.data.type === 'progress') {
          setSolveProgress(event.data.progress);
          return;
        }
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
    setSolving(false); setSolveProgress(null); setStatus('已取消排課。');
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
    setSchedule({ success: true, schedule: record.schedule, pending: [], score: 0, diagnostics: [],
      searchStats: { method: record.schedule.length >= 600 ? 'constructive-restarts' : 'mrv-backtracking' } });
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
        <BrandHeader onOpenHelp={openHelp} />
        <main id="main" className="landing-main">
          <WelcomeScreen onImport={handleImport} error={error} />
        </main>
        <SiteFooter />
        {helpOpen && <HelpCenter onClose={closeHelp} />}
      </div>
    );
  }

  if (data.kind === 'staffing') {
    return <StaffingWorkspace data={data} status={status} error={error} onImport={handleImport} onOpenHelp={openHelp} helpOpen={helpOpen} onCloseHelp={closeHelp}
      onReset={() => { setData(null); setStatus(''); setError(''); }} />;
  }

  return (
    <div className="site-shell">
      <BrandHeader onOpenHelp={openHelp} />
      <main id="main" className="app">
        <section className="workspace-heading">
          <div><p className="eyebrow">校務排課工作區</p><h1>校務智慧排課工作區</h1><p>依序完成資料驗證、限制設定、排課、診斷與輸出。</p></div>
          <button className="btn secondary" onClick={() => { setData(null); setSchedule(null); setValidation(null); setStatus(''); setError(''); setSelectedLesson(null); setLockMode(false); }}>
            ← 重新匯入
          </button>
        </section>

        <WorkflowSteps validation={validation} solving={solving} schedule={schedule} />

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
            <label>每週上課天數<select value={settings.days.length} onChange={(e) => setSettings(s => ({ ...s, days: DAYS.slice(0, Number(e.target.value)) }))}><option value="5">5 天（週一至週五）</option><option value="6">6 天（週一至週六）</option></select><small className="field-help">決定排課核心可以使用星期一至星期五或星期六。</small></label>
            <label>每日節數<select value={settings.periodsPerDay} onChange={(e) => setSettings(s => ({ ...s, periodsPerDay: Number(e.target.value) }))}><option value="6">6 節</option><option value="7">7 節</option><option value="8">8 節</option></select><small className="field-help">會影響每天可使用的時段總數與課表高度。</small></label>
          </div>
          <button className="btn primary" onClick={handleSolve} disabled={validation?.errors.length > 0 || solving}>{solving ? '背景排課中…' : '執行智慧排課 →'}</button>
          {solving && <button className="btn secondary" onClick={handleCancelSolve}>取消排課</button>}
          {solving && <SolveProgress progress={solveProgress} elapsedMs={solveElapsed} />}
        </section>

        {schedule && <>
          <section className="panel">
            <div className="panel-heading"><span>04</span><div><h2>排課結果</h2><p>{schedule.success ? '排課核心已完成計算，可進一步檢查與匯出。' : '仍有課程未能排入，請查看衝突診斷。'}</p></div></div>
            <div className="result-stats"><div><strong>{schedule.quality?.completionPercent ?? (schedule.success ? 100 : 0)}%</strong><span>排入完成率</span></div><div><strong>{schedule.quality?.hardConflicts ?? 0}</strong><span>硬性衝突</span></div><div><strong>{schedule.quality?.distributionScore ?? 100}</strong><span>課程分散度（滿分 100）</span></div><div><strong>{((schedule.elapsedMs || 0) / 1000).toFixed(1)}s</strong><span>運算耗時</span></div></div>
            <details className="explain-card"><summary>品質指標如何計算？</summary><p><strong>排入完成率</strong>是已排入節數占全部需求節數；<strong>硬性衝突</strong>檢查班級、教師與專科教室是否同時重複；<strong>課程分散度</strong>會扣除同班同科集中在同一天的重複節數。100 分表示沒有這類重複，不代表已找到全球最佳課表。</p></details>
            <details className="explain-card"><summary>系統使用什麼排課演算法？</summary><p>本系統將排課視為<strong>限制滿足問題（CSP）</strong>。小型資料使用<strong>最少剩餘值（MRV）＋回溯搜尋</strong>；600 節以上改用多次建構搜尋，先安排跨班教師、連堂與專科教室，再平衡班級及教師每日負載。本次使用：<strong>{schedule.searchStats?.method === 'constructive-restarts' ? '大型資料建構搜尋' : 'MRV 回溯搜尋'}</strong>。時間到會保留目前最佳的無基本時段衝突部分結果；這不是機器學習，也不保證全域最佳解。</p></details>
            {schedule.diagnostics?.map((item, i) => <div key={i} className="banner warn">{item.message}</div>)}
            <div className="row">
              <button className="btn" onClick={() => setStatus(schedule.success ? '排課成功，無硬性衝突。' : '尚有課程未排入，請檢視衝突診斷。')}>重新檢查結果</button>
              <button className="btn secondary" onClick={handleSave}>儲存本機版本</button>
              <button className="btn" onClick={() => downloadExcel(schedule.schedule, { total: schedule.schedule.length, pending: schedule.pending?.length || 0, success: schedule.success, quality: schedule.quality })}>匯出 Excel</button>
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
      {helpOpen && <HelpCenter onClose={closeHelp} />}
    </div>
  );
}

function SolveProgress({ progress, elapsedMs }) {
  const placed = progress?.placed || 0;
  const total = progress?.total || 0;
  const percent = total ? Math.min(100, Math.round(placed / total * 100)) : 0;
  const announceBucket = Math.floor(elapsedMs / 5000);
  const [announcement, setAnnouncement] = useState('背景排課已開始，目前最佳方案正在建立。');
  useEffect(() => {
    setAnnouncement(`背景排課進行中，目前最佳方案已排入 ${placed} 節，共 ${total || 0} 節。`);
  }, [announceBucket]);
  return <div className="solve-progress">
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    <div className="solve-visual" aria-hidden="true">
      {Array.from({ length: 15 }, (_, index) => <span key={index} style={{ '--delay': `${index * 55}ms` }} />)}
    </div>
    <div className="solve-copy">
      <div className="solve-title"><strong>正在背景排課</strong><span>{(elapsedMs / 1000).toFixed(1)} 秒</span></div>
      <p>系統持續嘗試符合教師、班級、教室與連堂限制的組合；頁面仍可正常顯示。</p>
      <div className="progress-track" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
      <div className="solve-meta"><span>目前最佳方案：{placed} / {total || '—'} 節</span><span>搜尋 {progress?.nodes || 0} 個節點 · 回溯 {progress?.backtracks || 0} 次</span></div>
    </div>
  </div>;
}

function WorkflowSteps({ validation, solving, schedule }) {
  const current = schedule ? 4 : solving ? 3 : validation?.errors?.length ? 2 : validation ? 3 : 1;
  const steps = ['資料匯入', '格式驗證', '背景排課', '檢查與匯出'];
  return <ol className="workflow-steps" aria-label="排課工作進度">
    {steps.map((label, index) => {
      const number = index + 1;
      const state = number < current ? 'done' : number === current ? 'current' : '';
      return <li key={label} className={state} aria-current={state === 'current' ? 'step' : undefined}>
        <span>{number < current ? '✓' : number}</span><strong>{label}</strong>
      </li>;
    })}
  </ol>;
}

function StaffingWorkspace({ data, status, error, onImport, onReset, onOpenHelp, helpOpen, onCloseHelp }) {
  const plan = data.staffingPlan;
  const validation = data.staffingValidation || { errors: [], warnings: [] };
  return (
    <div className="site-shell">
      <BrandHeader onOpenHelp={onOpenHelp} />
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
      </main><SiteFooter />{helpOpen && <HelpCenter onClose={onCloseHelp} />}
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
  const [selection, setSelection] = useState({ class: '', teacher: '', room: '' });
  const [query, setQuery] = useState('');
  useEffect(() => setQuery(''), [view]);
  const config = {
    class: { field: 'class', label: '班級', values: [...new Set(schedule.schedule.map(c => c.class))] },
    teacher: { field: 'teacher', label: '教師', values: [...new Set(schedule.schedule.map(c => c.teacher))] },
    room: { field: 'room_id', label: '教室', values: [...new Set(schedule.schedule.map(c => c.room_id).filter(Boolean))] }
  }[view];
  const values = config.values.sort((a, b) => String(a).localeCompare(String(b), 'zh-Hant'));
  const selected = values.includes(selection[view]) ? selection[view] : values[0];
  const filtered = values.filter(value => String(value).toLowerCase().includes(query.trim().toLowerCase()));
  const selectValue = filtered.includes(selected) ? selected : (filtered[0] || '');
  const lessons = schedule.schedule.filter(course => course[config.field] === selectValue);
  const subjects = [...new Set(lessons.map(course => course.subject))];

  if (!values.length) return <div className="empty-state">目前沒有{config.label}排課資料。</div>;
  return <div className="timetable-browser">
    <div className="entity-toolbar">
      <div className="entity-picker">
        <label>搜尋{config.label}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`輸入${config.label}代碼`} /></label>
        <label>目前檢視<select value={selectValue} onChange={event => setSelection(current => ({ ...current, [view]: event.target.value }))}>
          {filtered.map(value => <option key={value} value={value}>{config.label} {value}</option>)}
        </select></label>
      </div>
      <div className="entity-summary" aria-label="目前課表摘要"><div><strong>{lessons.length}</strong><span>節課</span></div><div><strong>{subjects.length}</strong><span>個科目</span></div><div><strong>0</strong><span>時段衝突</span></div></div>
    </div>
    {filtered.length === 0 ? <div className="empty-state">找不到符合「{query}」的{config.label}。</div> : <>
      <div className="subject-legend" aria-label="科目圖例">{subjects.map(subject => <span key={subject} style={subjectColor(subject)}><i />{subject}</span>)}</div>
      <TimetableGrid title={`${config.label} ${selectValue}`} schedule={schedule} settings={settings}
        lockMode={lockMode} selectedLesson={selectedLesson} filterField={config.field} filterValue={selectValue} onCellClick={onCellClick} />
    </>}
  </div>;
}

function subjectColor(subject) {
  const hue = [...String(subject)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 0);
  return { '--subject-hue': hue };
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
                  const cellClass = [lockMode ? (cell ? 'editable' : 'drop-target') : '', index !== null && index === selectedLesson ? 'selected' : ''].filter(Boolean).join(' ');
                  return (
                    <td key={d} className={cellClass} role={lockMode ? 'button' : undefined} tabIndex={lockMode ? 0 : undefined}
                      aria-label={lockMode ? (cell ? `${cell.subject}，星期${DAY_LABELS[d]}第 ${period} 節；按 Enter 選取` : `星期${DAY_LABELS[d]}第 ${period} 節空白時段`) : undefined}
                      onClick={() => lockMode && onCellClick(index, { day: d, period })}
                      onKeyDown={event => {
                        if (lockMode && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault(); onCellClick(index, { day: d, period });
                        }
                      }}>
                      {cell ? <div className="lesson-card" style={subjectColor(cell.subject)}><strong>{cell.subject}</strong><small>{filterField !== 'class' ? `班級 ${cell.class}` : `教師 ${cell.teacher}`}{cell.room_id ? ` · ${cell.room_id}` : ''}</small></div> : lockMode && selectedLesson !== null ? <span className="empty-hint">移至這裡</span> : null}
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
          <p className="eyebrow">台灣學校排課工具</p>
          <div className="badge-row"><span className="badge">瀏覽器本機運算</span><span className="badge warm">Excel 工作流程</span></div>
          <h1>把複雜的排課限制，<em>整理成一張能執行的課表。</em></h1>
          <p>從教師、班級、課程與教室資料開始，自動檢查必要欄位、安排時段、診斷衝突，最後再由教學組人工微調與輸出。</p>
          <div className="privacy-note"><strong>資料留在目前瀏覽器</strong><span>Excel 內容不需要上傳到應用程式伺服器；本機版本也只存於這台裝置的瀏覽器。</span></div>
        </div>
        <div className="welcome-card">
          <div className="welcome-card-label">快速開始</div>
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
          <p className="hint">標準範本內含 60 班可直接試跑資料；也可刪除範例列後填入本校資料，請保留中文欄位列。</p>
        </div>
      </section>
      <section className="feature-grid" aria-label="排課工具特色">
        <article><span>資料驗證</span><h2>匯入先驗證</h2><p>將教師、班級、課程、教室及不可排時段整理成一致資料，再開始計算。</p></article>
        <article><span>限制求解</span><h2>限制一起算</h2><p>同時考慮班級、教師、教室、固定活動與每日節數，降低人工反覆對照。</p></article>
        <article><span>人工調整</span><h2>結果能微調</h2><p>依班級、教師或教室檢視課表，人工移動時即時阻擋基本時段衝突。</p></article>
      </section>
    </>
  );
}

function HelpCenter({ onClose }) {
  const [tab, setTab] = useState('quick');
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = event => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...dialogRef.current.querySelectorAll('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
        .filter(element => !element.disabled && element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); };
  }, [onClose]);
  const tabs = [['quick','快速上手'], ['excel','Excel 欄位'], ['rules','限制與指標'], ['errors','常見問題']];
  return <div className="help-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <section ref={dialogRef} className="help-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
      <header className="help-header"><div><p className="eyebrow">使用教學</p><h2 id="help-title">排課工具使用說明</h2><p>從標準範本到結果檢查，所有資料都在目前瀏覽器處理。</p></div><button ref={closeRef} className="help-close" onClick={onClose} aria-label="關閉使用說明">×</button></header>
      <nav className="help-tabs" aria-label="使用說明章節">{tabs.map(([value,label]) => <button key={value} className={tab === value ? 'active' : ''} aria-pressed={tab === value} onClick={() => setTab(value)}>{label}</button>)}</nav>
      <div className="help-content">
        {tab === 'quick' && <div className="guide-steps">
          <article><span>1</span><div><h3>下載標準範本</h3><p>先用內建 60 班資料試跑；確認流程後，再從第 3 列起刪除或替換成貴校資料。工作表名稱與第 2 列中文欄位請保留。</p></div></article>
          <article><span>2</span><div><h3>修改並匯入 Excel</h3><p>班級、教師、課程與教室代碼必須互相一致。匯入後先修正紅色錯誤；黃色訊息通常是提醒，不一定會阻止排課。</p></div></article>
          <article><span>3</span><div><h3>設定並執行排課</h3><p>選擇每週天數與每日節數後開始排課。進度卡顯示真實最佳節數、搜尋節點與回溯次數；大型資料可隨時取消。</p></div></article>
          <article><span>4</span><div><h3>檢查、微調與匯出</h3><p>完成率應為 100%、硬性衝突應為 0。可依班級、教師或教室檢視，開啟人工調課後先選課程，再選空白時段。</p></div></article>
          <div className="help-callout"><strong>建議做法</strong><p>第一次請不要立刻清空範本。先確認範例能成功排課，再分批替換班級、教師、課程與限制，較容易找出是哪一批資料造成無解。</p></div>
        </div>}
        {tab === 'excel' && <div>
          <h3>標準範本工作表</h3><p className="help-lead">第一列是填寫說明、第二列是欄位名稱、第三列起才是資料。欄位支援繁體中文，舊版英文欄位仍可匯入。</p>
          <div className="help-table-wrap"><table className="help-table"><thead><tr><th>工作表</th><th>必要／常用欄位</th><th>用途</th></tr></thead><tbody>
            <tr><td>班級</td><td>班級代碼、年級、班級名稱、學生數、導師代碼</td><td>建立班級與導師關係</td></tr>
            <tr><td>教師</td><td>教師代碼、姓名、主要領域、每日最多節數、最多連續節數</td><td>建立教師與授課上限</td></tr>
            <tr><td>課程</td><td>班級代碼、科目、教師代碼、每週節數、教室類型、是否連堂</td><td>每一列代表一組授課需求</td></tr>
            <tr><td>教師可排時段</td><td>教師代碼、星期、節次、是否可排、原因</td><td>填「否」表示該時段不可排</td></tr>
            <tr><td>教室</td><td>教室代碼、教室類型、容量</td><td>專科教室類型需與課程一致</td></tr>
            <tr><td>固定活動</td><td>活動名稱、星期、節次、班級代碼、教師代碼</td><td>預先占用班級或教師時段</td></tr>
            <tr><td>行政職務</td><td>處室／單位、職稱、教師代碼、姓名、備註</td><td>保留人員配置資訊</td></tr>
          </tbody></table></div>
          <div className="help-callout"><strong>值的寫法</strong><p>星期請填「星期一」至「星期六」；是非欄位填「是／否」；一般教室填「普通教室」，不限制教室可填「不限教室」。</p></div>
        </div>}
        {tab === 'rules' && <div className="help-sections">
          <section><h3>系統會阻止哪些衝突？</h3><ul><li>同一班級、教師或專科教室在同一時段重複。</li><li>排入教師不可排時段、超過每日節數或最多連續節數。</li><li>連堂課被拆開，或固定活動已占用該時段。</li><li>課程要求的專科教室不存在或已被占用。</li></ul></section>
          <section><h3>演算法</h3><p>系統把排課建模為限制滿足問題（CSP）。未滿 600 節使用最少剩餘值（MRV）與回溯；600 節以上使用多次建構搜尋，優先安排跨班教師、連堂與專科教室，再平衡每日負載。兩種方式都會檢查相同硬限制；它不是生成式 AI，也不保證全域最佳解。</p></section>
          <section><h3>三個品質數字</h3><ul><li><strong>排入完成率：</strong>已排入節數占全部需求節數。</li><li><strong>硬性衝突：</strong>班級、教師、教室或鎖定資料的衝突總數，成功結果應為 0。</li><li><strong>課程分散度：</strong>同班同科集中於同一天會扣分；100 分只代表沒有這類重複。</li></ul></section>
        </div>}
        {tab === 'errors' && <div className="help-sections">
          <section><h3>教師不存在</h3><p>課程表的「教師代碼」找不到對應教師。請將代碼改成教師工作表已有的代碼，或先新增該教師。</p></section>
          <section><h3>班級不存在</h3><p>課程表的「班級代碼」不在班級工作表。請檢查全形空白、前導零與代碼拼法是否完全一致。</p></section>
          <section><h3>找不到專科教室</h3><p>課程要求的「教室類型」沒有對應教室。請在教室工作表新增同類型教室，或修正課程的教室類型。</p></section>
          <section><h3>限制過緊或排課逾時</h3><p>先查看未排入課程，再逐步放寬教師不可排時段、每日上限、固定活動或專科教室數量。逾時結果仍會保留目前最佳且無基本時段衝突的部分課表。</p></section>
          <section><h3>資料與隱私</h3><p>Excel 在瀏覽器本機解析；網站不需要把內容上傳到應用程式伺服器。本機版本使用瀏覽器儲存空間，更換裝置或清除網站資料後不會保留。</p></section>
        </div>}
      </div>
      <footer className="help-footer"><span>按 Esc 也可以關閉；之後可從頁首「使用說明」再次開啟。</span><button className="btn primary" onClick={onClose}>{tab === 'quick' ? '開始使用' : '關閉說明'}</button></footer>
    </section>
  </div>;
}

function BrandHeader({ onOpenHelp }) {
  return (
    <>
      <a className="skip-link" href="#main">跳到主要內容</a>
      <header className="site-header">
        <div className="header-inner">
          <div className="brand-lockup"><img src="./polik-scheduler-mark.svg" alt="" width="44" height="44" /><span><strong>Polik Scheduler</strong><small>校務智慧排課</small></span></div>
          <nav aria-label="網站導覽"><button className="nav-help" onClick={onOpenHelp}>使用說明</button><a href="https://polik18.github.io/">← Polik 專案總覽</a><a href="./">排課首頁</a></nav>
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
