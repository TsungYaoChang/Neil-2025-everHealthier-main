# 🔒 API Keys 安全設置指南

## ⚠️ 重要提醒

**絕對不要** 將真實的 API Keys 提交到 Git repository,特別是 public repository!

## 📋 設置步驟

### 1. 本地開發環境

1. **複製範例配置檔案**:
   ```bash
   copy config.local.example.js config.local.js
   ```

2. **編輯 `config.local.js`**:
   - 打開 `config.local.js`
   - 將 `'your-api-key-here'` 替換為你的真實 API keys
   - 保存文件

3. **確認 `.gitignore` 設置**:
   - 確保 `config.local.js` 已列在 `.gitignore` 中
   - 這個文件不會被 Git 追蹤

### 2. 生產環境 (Render.com)

在 Render.com 部署時,使用環境變數來管理 API Keys:

1. 前往 Render Dashboard
2. 選擇你的 Web Service
3. 進入 "Environment" 標籤
4. 添加以下環境變數:
   ```
   OPENROUTER_CLINIC_INSIGHT=your-api-key-here
   OPENROUTER_PATIENT_ARTICLE_RANKING=your-api-key-here
   OPENROUTER_PATIENT_INSIGHT=your-api-key-here
   ```

### 3. 更好的做法:後端代理 (推薦)

為了更安全,建議將 API 調用移到後端處理:

1. **在 Node.js 後端建立 API 端點**
2. **前端呼叫你的後端,而不是直接呼叫 OpenRouter**
3. **API Keys 只存在後端,永不暴露給前端**

## 📁 文件說明

- `config.js` - 公開配置文件,**不包含敏感資訊**,可以提交到 Git
- `config.local.js` - 本地配置文件,**包含 API Keys**,不會被 Git 追蹤
- `config.local.example.js` - 配置範例文件,提交到 Git 供其他開發者參考

## ✅ 檢查清單

在提交代碼前,請確認:

- [ ] `config.js` 中沒有真實的 API Keys
- [ ] `config.local.js` 已加入 `.gitignore`
- [ ] 執行 `git status` 確認 `config.local.js` 沒有被追蹤

## 🚨 如果不小心提交了 API Keys

如果你已經將 API Keys 提交到 repository:

1. **立即更換所有暴露的 API Keys**
2. 清理 Git 歷史記錄:
   ```bash
   git filter-branch --force --index-filter "git rm --cached --ignore-unmatch config.js" --prune-empty --tag-name-filter cat -- --all
   git push origin --force --all
   ```
3. 或考慮重新建立 repository

## 📞 需要協助?

如有任何問題,請查看:
- [GitHub - Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [OpenRouter API Documentation](https://openrouter.ai/docs)
