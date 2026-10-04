# 教職員配置與大型範例：實施狀態

更新：2026-10-04

## 已完成

- [x] 修正 Excel 匯入 workbook 未建立的錯誤。
- [x] 建立教職員配置模型，支援級任、科任、行政支援匯入／檢視／匯出。
- [x] 以實際匿名檔驗證 66 筆級任、70 筆科任／支援、40 筆行政職務。
- [x] 建立可重複執行的大型範例轉換程式與逐筆對照 JSON 報告。
- [x] 產生 54 班、124 位教師資料、630 課程列／846 節的可排課範例。
- [x] 首頁提供大型排課範例與配置結果範例下載。
- [x] Solver 實作最大連續節數、連堂、固定活動教師佔用與逐節鎖定。
- [x] 排課移入 Web Worker，介面可取消並顯示耗時。
- [x] CI 新增大型範例驗證。
- [x] PDF 列印的匯入文字已做 HTML escaping。
- [x] Chrome E2E 實測大型範例匯入、846 節 Web Worker 排課、取消、配置簿 66/70/40 與兩種匯出。
- [x] 本機環境不再載入正式站點統計，避免 CORS 錯誤干擾開發與 E2E。

## 驗收證據

- `npm test`：18/18 PASS；30 班、690 節基準約 9.2 秒。
- `npm run build`：Vite production build PASS，並產生獨立 solver worker asset。
- `npm run test:demo`：54 班、630 課程列、846 節、0 pending，本機約 18.1 秒。
- Preview HTTP smoke：首頁、兩份 XLSX 與對照 JSON 均 HTTP 200。
- Browser E2E：PASS；無 page error 或 console error。
- `npm ci`：0 vulnerabilities。

## 尚未執行

- [ ] GitHub Pages 正式部署與線上 smoke test。
- [ ] 「自動決定哪位教師教哪一班」的人力分配求解器；這需要資格、專長、志願、節數與減授等新輸入契約。

## 當前狀態

修改仍在 working tree，尚未 commit，也尚未部署。
