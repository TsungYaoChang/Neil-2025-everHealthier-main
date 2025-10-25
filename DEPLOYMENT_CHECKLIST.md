# 部署檢查清單 ✅

## 📝 使用說明

- ⬜ 未完成
- ✅ 已完成
- ⏭️ 跳過（不適用）

---

## Part 1: 準備工作

### GitHub 準備
- [ ] 已有 GitHub 帳號
- [ ] 代碼已在 Git 版本控制中
- [ ] 創建了 GitHub repository (`everhealthier`)
- [ ] 代碼已推送到 main 分支

**驗證：**
```powershell
git remote -v
# 應該看到 GitHub repository URL
```

### Render.com 準備  
- [ ] 已註冊 Render.com 帳號（使用 GitHub 登入）
- [ ] 已授權 Render 訪問 GitHub repositories

---

## Part 2: 後端部署（Render.com）

### 創建 Web Service
- [ ] 訪問 https://render.com/new/web
- [ ] 選擇 `everhealthier` repository
- [ ] 點擊 "Connect"

### 基本配置
- [ ] Name: `everhealthier-backend`
- [ ] Region: 選擇最近的（例如 Oregon）
- [ ] Branch: `main`
- [ ] Root Directory: (留空)

### Build 配置
- [ ] Runtime: `Node`（應該自動檢測）
- [ ] Build Command: `npm install`
- [ ] Start Command: `node fhir-proxy.js`

### 方案選擇
- [ ] Instance Type: **Free** ✅

### 環境變數（可選）
- [ ] `NODE_ENV` = `production`

### 部署
- [ ] 點擊 "Create Web Service"
- [ ] 等待部署完成（看到 "Live" 綠色標記）
- [ ] 複製 Service URL：`______________________________`

### 測試後端
- [ ] 訪問 `https://YOUR_RENDER_URL.onrender.com/callback.html`
  - 應該看到 HTML 頁面
- [ ] 訪問 `https://YOUR_RENDER_URL.onrender.com/api/patient?_count=1`
  - 應該看到 JSON 資料

---

## Part 3: 前端配置

### 更新 config.js
- [ ] 開啟 `config.js`
- [ ] 找到第 12 行：`return 'https://YOUR_RENDER_URL.onrender.com';`
- [ ] 替換為實際的 Render URL
- [ ] 儲存文件

### 添加 config.js 引用

在以下文件的 `<head>` 中添加 `<script src="config.js"></script>`：

- [ ] `login.html`（約第 8 行）
- [ ] `patient-dashboard.html`（約第 8 行）
- [ ] `select-user.html`（約第 8 行）
- [ ] `clinic-dashboard.html`（約第 8 行）

### 更新 login.html

- [ ] 在 `<script type="module">` 開頭添加：
  ```javascript
  const BACKEND_URL = window.APP_CONFIG?.BACKEND_URL || 'http://localhost:3001';
  const defaultStandaloneIss = window.APP_CONFIG?.FHIR_AUTH_SERVER || "https://r4.smarthealthit.org";
  const clientId = window.APP_CONFIG?.CLIENT_ID || "my-smart-web-app";
  ```

- [ ] 修改 `redirectUri`:
  ```javascript
  redirectUri: `${BACKEND_URL}/callback.html`,
  ```

- [ ] 兩個函數都要修改（`redirectToPatientPortal` 和 `redirectToClinicPortal`）

### 更新 patient-dashboard.js

- [ ] 在 `constructor()` 中添加：
  ```javascript
  this.BACKEND_URL = window.APP_CONFIG?.BACKEND_URL || 'http://localhost:3001';
  ```

- [ ] 在 `loadFhirData()` 中使用：
  ```javascript
  const baseUrl = `${this.BACKEND_URL}/api/patient`;
  ```

### 提交更新
- [ ] `git add .`
- [ ] `git commit -m "Configure for production"`
- [ ] `git push origin main`

---

## Part 4: GitHub Pages 部署

### 啟用 Pages
- [ ] 訪問 https://github.com/YOUR_USERNAME/everhealthier/settings/pages
- [ ] Source: 選擇 **GitHub Actions**
- [ ] 等待 Actions 完成（約 1-2 分鐘）

### 檢查部署狀態
- [ ] 前往 Actions 標籤
- [ ] 最新的 workflow 應該是綠色 ✓
- [ ] 點擊 workflow 查看詳細資訊

### 訪問網站
- [ ] 訪問：`https://YOUR_USERNAME.github.io/everhealthier/login.html`
- [ ] 頁面正常顯示
- [ ] 沒有 Console 錯誤

---

## Part 5: 完整功能測試

### 基本功能
- [ ] 點擊 "Patient Portal"
- [ ] 重定向到 OAuth2 授權頁面
- [ ] 選擇病人並授權
- [ ] 跳轉到 Render callback
- [ ] 看到 "Authorization Successful"
- [ ] 自動跳轉到 select-user.html

### 用戶選擇
- [ ] 可以搜尋病人
- [ ] 顯示搜尋結果
- [ ] 點擊病人卡片
- [ ] 跳轉到 patient-dashboard.html

### Dashboard 功能
- [ ] Patient Profile 顯示正確
- [ ] 日曆正常顯示
- [ ] 點擊 "Add Monitoring Data"
- [ ] 表單開啟
- [ ] 日期預設為今天

### 資料輸入
- [ ] 輸入血壓 120/80
- [ ] 輸入體重 70
- [ ] 點擊 Save
- [ ] 看到成功通知
- [ ] 日曆更新，今天有標記

### 資料持久化
- [ ] 按 F5 刷新頁面
- [ ] 點擊今天的日期
- [ ] 看到剛才輸入的資料
- [ ] 資料在正確的日期（不是前一天）

### Console 檢查
- [ ] 開啟 DevTools (F12)
- [ ] Console 沒有紅色錯誤
- [ ] Network 標籤顯示成功的請求
- [ ] Backend URL 指向 Render（不是 localhost）

---

## 🎊 完成！

如果所有項目都 ✅，恭喜您成功部署！

### 您現在擁有：

✅ **全球可訪問的網站**  
✅ **完全免費的托管**  
✅ **自動 HTTPS 加密**  
✅ **自動部署（推送即部署）**  
✅ **專業的雲端架構**

### 您的 URLs：

**前端（分享給用戶）：**
```
https://YOUR_USERNAME.github.io/everhealthier/login.html
```

**後端（API）：**
```
https://everhealthier-backend.onrender.com
```

## 🔍 如果有任何步驟失敗

### 後端問題
1. 查看 Render dashboard → Logs
2. 查看錯誤訊息
3. 參考 RENDER_DEPLOYMENT.md 的問題排查

### 前端問題
1. 查看 GitHub Actions → 最新 workflow
2. 查看 Console 錯誤
3. 確認 config.js 正確

### OAuth2 問題
1. 確認 redirectUri 指向 Render
2. 確認 Render callback.html 正常訪問
3. 查看 Console 日誌

## 📞 獲取幫助

- **Render Support**: https://render.com/docs
- **GitHub Pages Docs**: https://docs.github.com/pages
- **專案文檔**: RENDER_DEPLOYMENT.md

---

**再次恭喜！🎉**

您已經成功將應用部署到雲端了！

