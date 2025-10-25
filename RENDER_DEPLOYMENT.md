B# Render.com 部署指南

## 🎯 部署架構

```
GitHub Pages (前端)  ←→  Render.com (後端)  ←→  HAPI FHIR (資料)
     免費                    免費                    免費
```

## ✨ 為什麼選擇 Render.com？

### 優勢
- ✅ **完全免費** - 慷慨的免費額度
- ✅ **零配置** - 自動檢測 Node.js
- ✅ **不需要 Docker** - 直接部署 Node.js
- ✅ **不需要 CLI** - 全部在 Web UI 完成
- ✅ **自動 HTTPS** - 免費 SSL 憑證
- ✅ **持續部署** - 連接 GitHub 自動部署
- ✅ **簡單易用** - 適合初學者

### 免費額度
- 750 小時/月運行時間
- 512 MB RAM
- 自動休眠（15分鐘無活動）
- 無限頻寬

## 🚀 部署步驟

### Part 1: 準備 GitHub Repository

#### 步驟 1：推送代碼到 GitHub

```powershell
# 初始化 Git（如果還沒有）
git init
git add .
git commit -m "Prepare for deployment"

# 創建 GitHub repository 並推送
git remote add origin https://github.com/YOUR_USERNAME/everhealthier.git
git branch -M main
git push -u origin main
```

### Part 2: 部署後端到 Render.com

#### 步驟 2：註冊 Render.com

1. 訪問 https://render.com
2. 點擊 "Get Started for Free"
3. 使用 GitHub 帳號註冊（推薦）

#### 步驟 3：連接 GitHub Repository

1. 登入後，點擊 "New +" → "Web Service"
2. 選擇 "Connect a repository"
3. 授權 Render 訪問您的 GitHub
4. 選擇 `everhealthier` repository

#### 步驟 4：配置 Web Service

填寫以下資訊：

| 欄位 | 值 |
|------|-----|
| **Name** | `everhealthier-backend` |
| **Region** | Oregon (US West) 或最近的地區 |
| **Branch** | `main` |
| **Root Directory** | (留空) |
| **Runtime** | `Node` |
| **Build Command** | `npm install` |
| **Start Command** | `node fhir-proxy.js` |
| **Instance Type** | `Free` |

**環境變數（Environment Variables）：**

點擊 "Advanced" → "Add Environment Variable"：

| Key | Value |
|-----|-------|
| `NODE_ENV` | `production` |
| `PORT` | `10000` (Render 預設) |

#### 步驟 5：部署

1. 點擊 "Create Web Service"
2. 等待部署完成（約 2-3 分鐘）
3. 部署成功後，您會看到：
   ```
   Service URL: https://everhealthier-backend.onrender.com
   ```
4. **複製這個 URL！**

#### 步驟 6：測試後端

訪問以下 URLs 確認正常運作：

```
https://everhealthier-backend.onrender.com/callback.html
https://everhealthier-backend.onrender.com/api/patient?_count=1
```

應該看到正常的內容（不是 404）。

### Part 3: 更新前端配置

#### 步驟 7：更新 config.js

開啟 `config.js`，找到：
```javascript
return 'https://YOUR_RENDER_URL.onrender.com';
```

替換為您的實際 Render URL：
```javascript
return 'https://everhealthier-backend.onrender.com';
```

#### 步驟 8：在 HTML 文件中引入 config.js

需要在以下文件的 `<head>` 區塊添加：

**login.html:**
```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ever healthier</title>
  <script src="config.js"></script>  <!-- 添加這行 -->
  <script src="https://cdn.tailwindcss.com"></script>
```

**patient-dashboard.html:**
```html
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Patient Dashboard</title>
  <script src="config.js"></script>  <!-- 添加這行 -->
  <script src="https://cdn.tailwindcss.com"></script>
```

**select-user.html:**
```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Select User - Ever Healthier</title>
  <script src="config.js"></script>  <!-- 添加這行 -->
  <script src="https://cdn.tailwindcss.com"></script>
```

**clinic-dashboard.html:**
```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clinic Dashboard</title>
  <script src="config.js"></script>  <!-- 添加這行 -->
  <script src="https://cdn.tailwindcss.com"></script>
```

#### 步驟 9：更新 login.html 使用配置

在 `login.html` 的 `<script type="module">` 開頭添加：

```javascript
<script type="module">
  import FHIR from "https://cdn.skypack.dev/fhirclient@2.6.3";

  // 使用配置文件
  const BACKEND_URL = window.APP_CONFIG?.BACKEND_URL || 'http://localhost:3001';
  const defaultStandaloneIss = window.APP_CONFIG?.FHIR_AUTH_SERVER || "https://r4.smarthealthit.org";
  const clientId = window.APP_CONFIG?.CLIENT_ID || "my-smart-web-app";

  // patient portal
  window.redirectToPatientPortal = function() {
    localStorage.setItem('selected_role', 'patient');
    
    const scope = window.APP_CONFIG?.PATIENT_SCOPE || "launch/patient openid fhirUser profile patient/Patient.read patient/Observation.read patient/MedicationRequest.read patient/MedicationStatement.read patient/Condition.read patient/QuestionnaireResponse.read";
    
    console.log('Initiating OAuth2 authorization for patient...');
    console.log('Backend URL:', BACKEND_URL);
    
    FHIR.oauth2.authorize({
      clientId: clientId,
      redirectUri: `${BACKEND_URL}/callback.html`,  // 指向 Render 後端
      scope: scope,
      iss: defaultStandaloneIss,
      aud: defaultStandaloneIss,
      authorizeUri: `${defaultStandaloneIss}/auth/authorize`,
      tokenUri: `${defaultStandaloneIss}/auth/token`
    }).catch(err => {
      console.error('Authorization failed:', err);
      alert('Authorization failed. Please try again. Error: ' + err.message);
    });
  };

  // clinic portal
  window.redirectToClinicPortal = function() {
    localStorage.setItem('selected_role', 'practitioner');
    
    const scope = window.APP_CONFIG?.PRACTITIONER_SCOPE || "openid fhirUser profile user/Patient.read user/Practitioner.read user/Observation.read user/MedicationRequest.read user/MedicationStatement.read user/Condition.read user/QuestionnaireResponse.read";
    
    console.log('Initiating OAuth2 authorization for practitioner...');
    console.log('Backend URL:', BACKEND_URL);
    
    FHIR.oauth2.authorize({
      clientId: clientId,
      redirectUri: `${BACKEND_URL}/callback.html`,  // 指向 Render 後端
      scope: scope,
      iss: defaultStandaloneIss,
      aud: defaultStandaloneIss,
      authorizeUri: `${defaultStandaloneIss}/auth/authorize`,
      tokenUri: `${defaultStandaloneIss}/auth/token`
    }).catch(err => {
      console.error('Authorization failed:', err);
      alert('Authorization failed. Please try again. Error: ' + err.message);
    });
  };
</script>
```

#### 步驟 10：更新 patient-dashboard.js 使用配置

在 `constructor()` 中：

```javascript
constructor() {
  // ... 現有代碼 ...
  
  // HAPI FHIR and Backend configuration
  this.FHIR_BASE = window.APP_CONFIG?.HAPI_FHIR_BASE || 'https://hapi.fhir.org/baseR4';
  this.BACKEND_URL = window.APP_CONFIG?.BACKEND_URL || 'http://localhost:3001';
  
  // ... 現有代碼 ...
}
```

在 `loadFhirData()` 中：

```javascript
async loadFhirData() {
  try {
    const baseUrl = `${this.BACKEND_URL}/api/patient`;  // 使用配置的 URL
    // ... 其餘代碼不變
  }
}
```

### Part 4: 部署前端到 GitHub Pages

#### 步驟 11：提交更新

```powershell
git add .
git commit -m "Configure for Render.com deployment"
git push origin main
```

#### 步驟 12：啟用 GitHub Pages

1. 前往 https://github.com/YOUR_USERNAME/everhealthier/settings/pages
2. **Source** 選擇：`GitHub Actions`
3. 等待 Actions 完成（約 2 分鐘）
4. 訪問：`https://YOUR_USERNAME.github.io/everhealthier/login.html`

## 📋 快速部署清單

### ✅ 準備階段
- [ ] 代碼已推送到 GitHub
- [ ] render.yaml 文件已創建
- [ ] config.js 文件已創建
- [ ] .gitignore 已更新

### ✅ Render.com 部署
- [ ] 在 Render.com 註冊帳號
- [ ] 連接 GitHub repository
- [ ] 創建 Web Service
- [ ] 等待部署完成
- [ ] 複製 Render URL
- [ ] 測試後端正常運作

### ✅ 前端配置
- [ ] 更新 config.js 的 Render URL
- [ ] 在所有 HTML 添加 `<script src="config.js"></script>`
- [ ] 更新 login.html 使用 BACKEND_URL
- [ ] 更新 patient-dashboard.js 使用 BACKEND_URL
- [ ] 提交並推送到 GitHub

### ✅ GitHub Pages 部署
- [ ] 啟用 GitHub Pages
- [ ] 等待 Actions 完成
- [ ] 訪問網站

### ✅ 測試
- [ ] 完整 OAuth2 流程
- [ ] 選擇病人
- [ ] 載入 dashboard
- [ ] 輸入資料
- [ ] 刷新驗證

## 🎨 Render.com Web UI 截圖說明

### 創建 Web Service 畫面

```
┌─────────────────────────────────────────────┐
│ Create a new Web Service                   │
├─────────────────────────────────────────────┤
│ Name: everhealthier-backend                 │
│                                             │
│ Region: [Oregon (US West) ▼]               │
│                                             │
│ Branch: [main ▼]                           │
│                                             │
│ Build Command:                              │
│ [npm install                          ]    │
│                                             │
│ Start Command:                              │
│ [node fhir-proxy.js                   ]    │
│                                             │
│ Instance Type:                              │
│ ⚪ Starter ($7/month)                       │
│ 🔘 Free                                     │
│                                             │
│ [Create Web Service]                        │
└─────────────────────────────────────────────┘
```

### 環境變數設定

```
┌─────────────────────────────────────────────┐
│ Environment Variables                       │
├─────────────────────────────────────────────┤
│ Key          │ Value                        │
├──────────────┼──────────────────────────────┤
│ NODE_ENV     │ production                   │
│ PORT         │ 10000                        │
└─────────────────────────────────────────────┘
```

## 🔄 自動部署設定

Render.com 支援自動部署！

### 設定步驟：

1. 在 Render dashboard，選擇您的 service
2. Settings → Build & Deploy
3. 確認 "Auto-Deploy" 是 **Yes**

現在，每次您推送到 GitHub main 分支，Render 會自動：
1. 檢測到新的 commit
2. 重新構建
3. 自動部署

## 🌐 完整 URLs

部署完成後的 URLs：

| 服務 | URL | 用途 |
|------|-----|------|
| **前端首頁** | `https://YOUR_USERNAME.github.io/everhealthier/login.html` | 用戶訪問入口 |
| **後端 API** | `https://everhealthier-backend.onrender.com/api/patient` | API 端點 |
| **OAuth Callback** | `https://everhealthier-backend.onrender.com/callback.html` | OAuth2 回調 |
| **用戶選擇** | `https://everhealthier-backend.onrender.com/select-user.html` | 可選：也可放前端 |

## ⚡ 3 步驟快速部署

### 步驟 1：部署到 Render

1. 訪問 https://render.com/new/web
2. 連接您的 GitHub repository
3. 配置：
   - Name: `everhealthier-backend`
   - Build: `npm install`
   - Start: `node fhir-proxy.js`
   - Plan: `Free`
4. 點擊 "Create Web Service"
5. 等待 2-3 分鐘
6. 複製 Service URL

### 步驟 2：更新配置

```powershell
# 編輯 config.js
# 替換：'https://YOUR_RENDER_URL.onrender.com'
# 改為：'https://everhealthier-backend.onrender.com'

# 提交更新
git add config.js
git commit -m "Update Render URL"
git push origin main
```

### 步驟 3：啟用 GitHub Pages

1. GitHub repository → Settings → Pages
2. Source: `GitHub Actions`
3. 等待部署完成
4. 訪問您的網站！

## 🧪 測試部署

### 測試 1：後端健康檢查

```powershell
# PowerShell
Invoke-WebRequest -Uri "https://everhealthier-backend.onrender.com/callback.html" | Select-Object StatusCode

# 應該返回 200
```

### 測試 2：API 端點

```powershell
Invoke-WebRequest -Uri "https://everhealthier-backend.onrender.com/api/patient?_count=1" | Select-Object StatusCode, Content
```

### 測試 3：完整流程

1. 訪問 GitHub Pages URL
2. 點擊 "Patient Portal"
3. 完成 OAuth2（會跳轉到 Render callback）
4. 選擇病人
5. 進入 dashboard
6. 驗證資料正常載入

## ⚠️ 重要注意事項

### 1. Render 免費方案限制

**冷啟動（Cold Start）：**
- 15 分鐘無活動後會休眠
- 下次訪問需要 30-60 秒喚醒
- 解決方案：
  - 升級到付費方案（$7/月，無休眠）
  - 或使用外部服務定期 ping（例如 UptimeRobot）

### 2. 自定義域名（可選）

免費方案：`yourapp.onrender.com`  
付費方案：可設定自定義域名

### 3. HTTPS 自動啟用

Render 自動提供 HTTPS，無需配置。

### 4. 環境變數

如果需要添加環境變數：
1. Render dashboard → 選擇 service
2. Environment → Add Environment Variable

## 🔍 監控和日誌

### 查看日誌

1. Render dashboard → 選擇 service
2. Logs 標籤
3. 可以看到即時日誌（類似 `console.log` 輸出）

### 查看指標

1. Metrics 標籤
2. 可以看到：
   - CPU 使用率
   - 記憶體使用率
   - 請求數量
   - 回應時間

## 🐛 常見問題

### 問題 1：部署失敗

**檢查 Build Logs：**
1. Render dashboard → 選擇 service
2. Events 標籤
3. 點擊失敗的部署
4. 查看錯誤訊息

**常見原因：**
- package.json 缺少依賴
- Build command 錯誤
- Start command 錯誤

### 問題 2：服務啟動後立即崩潰

**檢查 Logs：**
```
Service logs 會顯示錯誤訊息
```

**常見原因：**
- PORT 環境變數未設定
- 缺少必要文件

### 問題 3：CORS 錯誤

**更新 fhir-proxy.js：**

```javascript
// 在文件開頭添加允許的 origins
const ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'https://YOUR_USERNAME.github.io'
];

// 在處理請求時
const origin = req.headers.origin;
const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '*';

res.writeHead(200, {
  'Access-Control-Allow-Origin': allowOrigin,
  // ...
});
```

重新部署（Render 會自動檢測並部署）。

## 💰 成本對比

| 平台 | 免費額度 | 付費起價 | 推薦 |
|------|----------|----------|------|
| **Render.com** | 750 小時/月 + 512MB RAM | $7/月 | ⭐⭐⭐⭐⭐ |
| GCP Cloud Run | 200 萬次請求/月 | 按用量 | ⭐⭐⭐⭐ |
| Heroku | 無免費方案 | $5/月 | ⭐⭐⭐ |
| AWS Elastic Beanstalk | 有限免費 | 按用量 | ⭐⭐ |

**Render.com 最適合這個專案！** ✅

## 🎊 完成！

部署完成後，您將擁有：

```
✅ 前端：https://YOUR_USERNAME.github.io/everhealthier/
✅ 後端：https://everhealthier-backend.onrender.com/
✅ 資料：https://hapi.fhir.org/baseR4/
✅ 全部免費！
✅ 自動 HTTPS
✅ 自動部署
```

## 🔗 有用的連結

- [Render Dashboard](https://dashboard.render.com/)
- [Render Docs](https://render.com/docs)
- [GitHub Pages Settings](https://github.com/YOUR_USERNAME/everhealthier/settings/pages)
- [GitHub Actions](https://github.com/YOUR_USERNAME/everhealthier/actions)

---

**需要幫助？** 查看 Render.com 的詳細文檔或在 dashboard 查看日誌。

