# Polik Scheduler｜校務智慧排課

給學校教學組使用的瀏覽器智慧排課工具。Excel 檔案在目前瀏覽器中解析與運算，不需要上傳排課資料到應用程式伺服器。

正式網址：<https://polik18.github.io/school-scheduler/>

## 主要能力

- Excel 範本匯入與資料驗證
- 教師、班級、教室與固定活動限制
- 自動排課及未排入課程診斷
- 班級、教師、教室三種課表檢視
- 人工調課與即時衝突檢查
- 本機版本保存及 Excel／PDF 匯出

## 本機開發

```bash
npm ci
npm run dev
```

Production build：

```bash
npm run build
```

`main` 分支由 GitHub Actions 部署至 GitHub Pages。

## 版本沿革

目前排課核心沿用 School Scheduler V10。公開產品名稱統一為 Polik Scheduler。

V10 新增：
- 班級週課表視覺化
- 人工調課前衝突檢查
- 班級/教師/教室衝突提示
- 保留 Excel 匯入與本機運算架構

使用：npm install && npm run dev
部署：GitHub Pages


## v10 Improvement Implementation
- Added modular constraint engine
- Added scoring engine
- Added validation and diagnosis modules

## V5 Phase 9 - Deployment & MVP Polish

- GitHub Pages compatible build
- Local browser processing notice
- MVP acceptance checklist
- Demo data validation flow

### MVP Test Goals

- Elementary school data import
- No teacher/class conflicts
- Support rooms and teacher availability
- Export timetable results


## V6 Productization
- 教學組 Dashboard 介面
- 本機端資料處理提示
- MVP 展示流程整理
- GitHub Pages 部署友善
