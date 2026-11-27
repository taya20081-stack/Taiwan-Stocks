# 台股策略研究台

聚焦上市、上櫃普通股，提供多因子選股、個股分析、策略回測、推薦追蹤及 90 天觀察。網站支援安裝為 PWA。

- `index.html` 是可離線開啟的單檔匯出，包含匯出時的選股、策略設定和追蹤結果。
- `src/` 是完整網站及 Worker API 原始碼。`scripts/` 提供建置、測試與資料更新工具。
- `.openai/hosting.json` 為舊版 OpenAI Sites 的部署設定，保留供 `npm run build` 的 Worker 產物使用。
- 線上版改放 GitHub Pages：`.github/workflows/pages.yml` 在合併到 `main` 與交易日收盤後執行，把網站與資料發布到 `gh-pages` 分支。網站在瀏覽器內執行原本的 Worker API（`src/pages.mjs`），資料讀取 `data/`，策略設定存在瀏覽器。

## 建置與測試

使用 Node.js 24。

```sh
npm run build
npm test
```

Worker 產物是 `dist/server/index.js`。`npm run test:mobile` 另需 Python Playwright 與 Chromium。

## 部署

一次性設定：Settings → Pages → Source 選 `Deploy from a branch`，分支 `gh-pages` / `/ (root)`。之後合併到 `main` 即自動部署，也可在 Actions 手動執行「部署到 GitHub Pages」。首次執行會回補約 200 天歷史行情。

網址：https://taya20081-stack.github.io/Taiwan-Stocks/
