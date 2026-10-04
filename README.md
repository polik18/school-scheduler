# Polik Scheduler｜校務智慧排課

給學校教學組使用的瀏覽器智慧排課工具。Excel 檔案在**目前瀏覽器本機**解析與運算，不需要上傳排課資料到應用程式伺服器。

正式網址：<https://polik18.github.io/school-scheduler/>

## 主要能力

- Excel 範本匯入與資料驗證（`src/importExcel.js`）
- 教職員配置結果：級任導師、科任教師、行政與支援人員（可匯入、檢視、再匯出）
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

標準範本包含「使用說明」及七張資料工作表。每張資料表第一列是說明、第二列是中文欄位名稱、第三列起是可刪改的範例資料。

| 工作表 | 中文欄位 |
|--------|----------|
| 班級 | 班級代碼、年級、班級名稱、學生數、導師代碼、備註 |
| 教師 | 教師代碼、姓名、主要領域、每日最多節數、最多連續節數、身分備註 |
| 課程 | 班級代碼、科目、教師代碼、每週節數、教室類型、是否連堂 |
| 教師可排時段 | 教師代碼、星期、節次、是否可排、原因 |
| 教室 | 教室代碼、教室類型、容量 |
| 固定活動 | 活動名稱、星期、節次、班級代碼、教師代碼 |
| 行政職務 | 處室／單位、職稱、教師代碼、姓名、備註 |

星期使用「星期一」至「星期六」，是非欄位使用「是／否」，教室類型可使用「普通教室／不限教室」。匯入器仍相容舊版英文工作表與欄位。

另外，系統可自動辨識已有的教職員配置簿，工作表名為「級任導師」、「科任教師」、「行政與支援人員」即可。系統保留其資料關係，不要求原檔的色彩、合併儲存格或排版。

首頁只提供一份 [`60 班標準範本`](docs/STANDARD_TEMPLATE.md)。範本可不修改直接試跑，也可刪除第 3 列起的範例後填入本校資料；請保留工作表名稱與第 2 列中文欄位。

## 限制說明

- **教師**：每日最多節數、最多連續節數與指定不可排時段。
- **教室**：普通教室不占用專科教室；指定實驗教室等類型時，必須有相同類型且未被占用的教室。
- **固定活動**：如班會、集會，鎖定某班某時段。
- **上課天數**：可選星期一至星期五或星期一至星期六。

網站頁首提供可隨時重開的「使用說明」，包含快速上手、Excel 欄位字典、演算法與品質指標、常見錯誤和隱私說明。

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

品質檢查：

```bash
npm test              # 核心單元與 30 班效能測試
npm run test:template # 60 班、924 節標準範本
npm run test:capacity # 72 班超時／部分結果壓力門禁
npm run test:e2e      # Chrome 匯入、排課、取消與匯出流程
npm run test:e2e:live # 對正式 GitHub Pages 執行同一流程
```

`test:e2e` 預設使用系統 Chrome；如果不在標準安裝路徑，請設定 `PLAYWRIGHT_CHROME_PATH`。

`main` 分支由 GitHub Actions 部署至 GitHub Pages（`vite.config.js` 已設 `base: './'`）。

## 專案結構

```
src/
  main.jsx          React 主程式、UI 與排課流程
  model/
    solver.js       排課核心（MRV 搜尋 + forward checking + scoring）
    schema.js       統一資料模型與欄位對應
    diagnosis.js    未排入課程的衝突診斷
    staffing.js     教職員配置資料的轉換與驗證
  importExcel.js    Excel 匯入與欄位偵測
  exportExcel.js    Excel 匯出
  manual.js         人工調課與衝突檢查
  storage.js        本機版本保存
public/
  school-scheduler-template.xlsx  唯一對外的 60 班標準範本
  style.css         樣式
docs/IMPORT_GUIDE.md  Excel 匯入簡易說明
```

## 技術規格

- **依賴**：React 18、xlsx 0.20.3（`package.json`）
- **建構**：Vite 8（`@vitejs/plugin-react`）
- **瀏覽器 E2E**：Playwright Core（使用系統 Chrome）
- **版本**：3.1.0
- **排課演算法**：限制滿足搜尋、最少剩餘值（MRV）與回溯；找到第一個完整可行解即停止，逾時保留目前最完整的無基本時段衝突部分結果，不宣稱全域最佳化
