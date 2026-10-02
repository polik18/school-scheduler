# Polik Scheduler｜校務智慧排課

給學校教學組使用的瀏覽器智慧排課工具。Excel 檔案在**目前瀏覽器本機**解析與運算，不需要上傳排課資料到應用程式伺服器。

正式網址：<https://polik18.github.io/school-scheduler/>

## 主要能力

- Excel 範本匯入與資料驗證（`src/importExcel.js`）
- 限制一起算：班級、教師、教室、固定活動、教師每日節數上限（`src/model/solver.js`）
- 未排入課程診斷與建議（`src/model/diagnosis.js`）
- 班級／教師／教室三種課表檢視與人工調課（`src/manual.js`）
- 本機版本保存（`src/storage.js`，localStorage）與 Excel／PDF 匯出（`src/exportExcel.js`）
- 下載標準範本，含中文說明與範例資料

## 四個步驟建立第一版課表

1. **下載範本** — 填寫教師、班級、課程、教室與限制
2. **匯入並驗證** — 先找出缺漏與格式問題
3. **執行排課** — 檢視未排入課程與衝突原因
4. **微調與匯出** — 輸出 Excel 或列印為 PDF

## 資料表與欄位

範本包含六個工作表，每張表第一行是中文說明、第二行是英文欄位名、第三行起是範例資料。

| 工作表 | 英文欄位 |
|--------|----------|
| Classes | `class_id`, `grade`, `class_name`, `students` |
| Teachers | `teacher_id`, `name`, `subject`, `max_daily_period`, `max_continuous_period` |
| Courses | `class`, `subject`, `teacher`, `weekly_period`, `room_required`, `double_period` |
| TeacherAvailability | `teacher`, `weekday`, `period`, `available`, `reason` |
| Rooms | `room_id`, `type`, `capacity` |
| FixedActivities | `activity`, `weekday`, `period`, `class`, `teacher` |

匯入時系統會偵測英文欄位行（跳過中文說明行），再進入排課計算。

## 限制說明

- **教師**：每日最多排幾節（`max_daily_period`）、每日最多連續幾節（`max_continuous_period`）、指定不可教時段。
- **教室**：`normal` 一般教室，或指定類型（如實驗教室）才教的課程（`room_required`）。
- **固定活動**：如班會、集會，鎖定某班某時段。
- **上課天數**：可選周一至周五或周一至周六（`main.jsx` 設定）。

## 本機開發

```bash
npm ci
npm run dev
```

Production build：

```bash
npm run build
npm run preview
```

`main` 分支由 GitHub Actions 部署至 GitHub Pages（`vite.config.js` 已設 `base: './'`）。

## 專案結構

```
src/
  main.jsx          React 主程式、UI 與排課流程
  model/
    solver.js       排課核心（MRV 搜尋 + forward checking + scoring）
    schema.js       統一資料模型與欄位對應
    diagnosis.js    未排入課程的衝突診斷
  importExcel.js    Excel 匯入與欄位偵測
  exportExcel.js    Excel 匯出
  manual.js         人工調課與衝突檢查
  storage.js        本機版本保存
  template.js       下載的標準範本（中文三層結構＋範例）
  style.css         樣式
docs/IMPORT_GUIDE.md  Excel 匯入簡易說明
```

## 技術規格

- **依賴**：React 18、xlsx 0.20.3（`package.json`）
- **建構**：Vite 8（`@vitejs/plugin-react`）
- **版本**：3.1.0
- **排課演算法**：最少剩餘值（MRV）優先、前瞻檢查（forward checking）、懲罰評分（偏好分散、固定課集中、專教不擠最後）
