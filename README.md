# 台股策略研究台

聚焦上市、上櫃普通股，提供多因子選股、個股分析、策略回測、推薦追蹤及 90 天觀察。網站支援安裝為 PWA。

- `index.html` 是可離線開啟的單檔匯出，包含匯出時的選股、策略設定和追蹤結果。
- `src/` 是完整網站及 Worker API 原始碼。`scripts/` 提供建置、測試與資料更新工具。
- `.openai/hosting.json` 記錄既有 Sites 專案的部署設定。即時行情、策略儲存和回測由線上 Worker 與 `BUCKET` 資料儲存服務提供。

## 建置與測試

使用 Node.js 24。

```sh
npm run build
npm test
```

Worker 產物是 `dist/server/index.js`。`npm run test:mobile` 另需 Python Playwright 與 Chromium。

[開啟線上研究台](https://taiwan-equity-lab.valiantbun4.chatgpt.site) · [下載最新 HTML](https://taiwan-equity-lab.valiantbun4.chatgpt.site/export.html)
