# 🚀 GitHub Pages 部署指南

## 📋 部署步驟

### 1. 啟用 GitHub Pages
1. 前往您的 GitHub repository
2. 點擊 **Settings** 標籤
3. 滾動到 **Pages** 部分
4. 在 **Source** 下選擇 **GitHub Actions**
5. 保存設置

### 2. 推送代碼
```bash
git add .
git commit -m "Configure for GitHub Pages deployment"
git push origin main
```

### 3. 檢查部署狀態
1. 前往 **Actions** 標籤
2. 查看最新的 workflow 運行狀態
3. 等待部署完成（約 2-3 分鐘）

### 4. 訪問您的網站
部署完成後，您的網站將在以下 URL 可用：
```
https://YOUR_USERNAME.github.io/2025-everHealthier/login.html
```

## 🔧 配置說明

### 文件結構
- `.github/workflows/deploy.yml` - GitHub Actions 工作流程
- `.nojekyll` - 防止 Jekyll 處理靜態文件
- `config.js` - 環境配置（已設置為 Render.com 後端）

### 自動部署
- 每次推送到 `main` 分支時自動觸發部署
- 部署過程完全自動化
- 無需手動操作

## 🐛 故障排除

### 常見問題
1. **404 錯誤**：確保文件路徑正確，檢查 `.nojekyll` 文件是否存在
2. **CORS 錯誤**：確認 `config.js` 中的後端 URL 正確
3. **部署失敗**：檢查 Actions 日誌中的錯誤訊息

### 檢查清單
- [ ] GitHub Pages 已啟用
- [ ] Actions 工作流程運行成功
- [ ] 網站可以正常訪問
- [ ] 後端 API 連接正常

## 📞 獲取幫助
- GitHub Pages 文檔：https://docs.github.com/pages
- GitHub Actions 文檔：https://docs.github.com/actions
