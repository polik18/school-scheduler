import { useState, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { readSchoolExcel, validateInput } from './importExcel.js';
import { createTemplate } from './template.js';
import { solveSchedule } from './model/solver.js';
import { diagnosePendingCourse } from './model/diagnosis.js';
import { moveLesson } from './manual.js';
import { buildGrid } from './timetable.js';
import { downloadExcel } from './exportExcel.js';
import { saveVersion, loadVersions, deleteVersion } from './storage.js';
import './style.css';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const DAY_LABELS = { Mon: '一', Tue: '二', Wed: '三', Thu: '四', Fri: '五' };

export default function App() {
  const [data, setData] = useState(null);      // 匯入的標準資料
  const [validation, setValidation] = useState(null);
  const [schedule, setSchedule] = useState(null);
  const [settings, setSettings] = useState({ days: DAYS, periodsPerDay: 8 });
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [lockMode, setLockMode] = useState(false);

  // 匯入檔案
  const handleImport = useCallback(async (file) => {
    setError(''); setValidation(null); setSchedule(null);
    try {
      const parsed = await readSchoolExcel(file);
      setData(parsed);
      const v = validateInput(parsed);
      setValidation(v);
      setStatus(parsed.courses.length ? `匯入完成：${data?.teachers?.length ?? 0} 師 / ${parsed.classes.length} 班 / ${parsed.courses.length} 課` : '匯入完成，但課程資料為空');
    } catch (e) {
      setError(`匯入失敗：${e.message}`);
    }
  }, [data]);

  // 執行排課
  const handleSolve = useCallback(() => {
    if (!data) { setError('請先匯入資料'); return; }
    setError(''); setSchedule(null); setStatus('正在排課…');
    try {
      const result = solveSchedule({
        courses: data.courses,
        days: settings.days,
        periodsPerDay: settings.periodsPerDay,
        rooms: data.rooms,
        fixed: data.fixedActivities,
        teachers: data.teachers,
        classes: data.classes,
      });
      setSchedule(result);
      if (!result.success) setStatus('排課完成，但有課程未能排入，請檢視衝突診斷。');
      else setStatus('排課成功！');
    } catch (e) {
      setError(`排課失敗：${e.message}`);
    }
  }, [data, settings]);

  // 調課
  const handleMove = useCallback((index, target) => {
    if (!schedule) return;
    const next = moveLesson(schedule.schedule, index, target);
    const moved = next[index];
    if (moved && moved.status === 'done') {
      setSchedule({ ...schedule, schedule: next });
      setStatus(`已將「${moved.subject}」調整至 ${DAY_LABELS[moved.day] || moved.day} 第 ${moved.period} 節`);
    } else {
      setError('無法移動：目標時段已有衝突');
    }
  }, [schedule]);

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
    setSchedule({ ...schedule, schedule: record.schedule });
    setStatus(`已載入版本「${name}」`);
  }, [schedule, settings]);

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
      html += `<h2>班級：${cls}</h2>`;
      html += buildGridHtml(schedule.schedule, cls);
    });
    w.document.write(`<html><head><title>課表</title></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); w.close(); }, 300);
  }, [schedule]);

  if (!data) {
    return <WelcomeScreen onImport={handleImport} onDownload={createTemplate} error={error} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>📚 學校智慧排課系統 V10</h1>
        <button className="btn secondary" onClick={() => { setData(null); setSchedule(null); setValidation(null); }}>
          ← 重新匯入
        </button>
      </header>

      {status && <div className="banner info">{status}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="panel">
        <h2>① 資料匯入</h2>
        <div className="row">
          <label className="btn file-input">
            上傳 Excel
            <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files[0] && handleImport(e.target.files[0])} />
          </label>
          <button className="btn" onClick={createTemplate}>下載範本</button>
        </div>
        <p className="hint">教師 {data.teachers.length} 師／班級 {data.classes.length} 班／課程 {data.courses.length} 堂</p>
      </div>

      {validation && (
        <div className="panel">
          <h2>② 資料驗證</h2>
          {validation.errors.length === 0 && <div className="banner ok">✅ 通過驗證</div>}
          {validation.errors.length > 0 && (
            <div className="banner error">
              <strong>發現 {validation.errors.length} 個錯誤：</strong>
              <ul>{validation.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className="banner warn">
              <strong>提示：</strong>
              <ul>{validation.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <h2>③ 排課設定</h2>
        <div className="row">
          <label>每週上課天數
            <select value={settings.days.length} onChange={(e) => setSettings(s => ({ ...s, days: s.days.slice(0, Number(e.target.value)) }))}>
              <option value="5">5 天</option>
              <option value="6">6 天</option>
            </select>
          </label>
          <label>每日節數
            <select value={settings.periodsPerDay} onChange={(e) => setSettings(s => ({ ...s, periodsPerDay: Number(e.target.value) }))}>
              <option value="6">6 節</option>
              <option value="7">7 節</option>
              <option value="8">8 節</option>
            </select>
          </label>
        </div>
        <button className="btn primary" onClick={handleSolve} disabled={validation?.errors.length > 0}>
          ▶ 執行排課
        </button>
      </div>

      {schedule && (
        <>
          <div className="panel">
            <h2>④ 排課結果</h2>
            <div className="row">
              <button className="btn" onClick={() => { if (schedule.success) setStatus('✅ 排課成功，無硬性衝突'); else setStatus('尚有課程未排入，請檢視右側診斷'); }}>
                衝突檢查
              </button>
              <button className="btn secondary" onClick={handleSave}>💾 儲存版本</button>
              <button className="btn" onClick={() => downloadExcel(schedule.schedule, { total: schedule.schedule.length })}>📊 匯出 Excel</button>
              <button className="btn" onClick={handleExportPdf}>📄 匯出 PDF</button>
            </div>
          </div>

          {schedule.pending && schedule.pending.length > 0 && (
            <div className="panel">
              <h2>⑤ 衝突診斷</h2>
              {schedule.pending.map((c, i) => (
                <div key={i} className="diagnostic">
                  <div className="diag-title">未排入：{c.class} {c.subject}（{c.teacher}）</div>
                  {diagnosePendingCourse(c, {
                    courses: data.courses, teachers: data.teachers, rooms: data.rooms,
                    fixed: data.fixedActivities, classes: data.classes
                  }).map((r, j) => (
                    <div key={j} className={`diag-${r.level}`}>{r.message}</div>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="panel">
            <h2>⑥ 課表檢視</h2>
            <div className="view-tabs">
              {['class', 'teacher', 'room'].map(v => (
                <ViewTab key={v} view={v} schedule={schedule} settings={settings}
                  lockMode={lockMode} setLockMode={setLockMode} onMove={handleMove} />
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>⑦ 本機版本管理</h2>
            <VersionManager versions={loadVersions()} onLoad={handleLoad} onDelete={handleDelete} />
          </div>
        </>
      )}
    </div>
  );
}

function buildGridHtml(schedule, classId) {
  const days = DAYS;
  let html = '<table border="1" cellpadding="6"><tr><th>節次</th>';
  days.forEach(d => html += `<th>${DAY_LABELS[d]}</th>`);
  html += '</tr>';
  for (let p = 1; p <= 8; p++) {
    html += `<tr><th>${p}</th>`;
    days.forEach(d => {
      const cell = schedule.find(c => c.class === classId && c.day === d && c.period === p);
      html += `<td>${cell ? `${cell.subject}<br/><small>${cell.teacher}</small>` : ''}</td>`;
    });
    html += '</tr>';
  }
  html += '</table>';
  return html;
}

function ViewTab({ view, schedule, settings, lockMode, setLockMode, onMove }) {
  const classIds = [...new Set(schedule.schedule.map(c => c.class))];
  const teacherIds = [...new Set(schedule.schedule.map(c => c.teacher))];
  const roomIds = [...new Set(schedule.schedule.map(c => c.room_id).filter(Boolean))];

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={lockMode} onChange={(e) => setLockMode(e.target.checked)} />
          調課模式（點擊課程可移動）
        </label>
      </div>

      {view === 'class' && classIds.map(cls => (
        <TimetableGrid key={cls} title={`班級 ${cls}`} schedule={schedule} settings={settings}
          lockMode={lockMode} filterField="class" filterValue={cls} onMove={onMove} />
      ))}
      {view === 'teacher' && teacherIds.map(tid => (
        <TimetableGrid key={tid} title={`教師 ${tid}`} schedule={schedule} settings={settings}
          lockMode={lockMode} filterField="teacher" filterValue={tid} onMove={onMove} />
      ))}
      {view === 'room' && roomIds.map(rid => (
        <TimetableGrid key={rid} title={`教室 ${rid}`} schedule={schedule} settings={settings}
          lockMode={lockMode} filterField="room_id" filterValue={rid} onMove={onMove} />
      ))}
    </div>
  );
}

function TimetableGrid({ title, schedule, settings, lockMode, filterField, filterValue, onMove }) {
  return (
    <div className="timetable-card">
      <h3>{title}</h3>
      <table className="timetable">
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
                  return (
                    <td key={d} className={lockMode && cell ? 'editable' : ''}
                      onClick={() => cell && lockMode && onMove(schedule.schedule.indexOf(cell), { day: d, period })}>
                      {cell ? `${cell.subject}<br/><small>${cell.teacher}</small>` : ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
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

function WelcomeScreen({ onImport, onDownload, error }) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>📚 學校智慧排課系統 V10</h1>
        <p>純前端・離線排課工具（國小教學組優先）</p>
        {error && <div className="banner error">{error}</div>}
        <div className="row">
          <label className="btn file-input">
            上傳 Excel 範本
            <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files[0] && onImport(e.target.files[0])} />
          </label>
          <button className="btn secondary" onClick={onDownload}>下載範本</button>
        </div>
        <ol className="welcome-steps">
          <li>下載範本，填寫教師／班級／課程／教室／限制</li>
          <li>上傳 Excel，系統自動驗證</li>
          <li>執行排課，檢視並微調結果</li>
          <li>匯出課表（Excel／PDF）</li>
        </ol>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
