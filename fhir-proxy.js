// ============================================================================
// FHIR Proxy & SMART Static Page Dispatcher
// FHIR 代理 + SMART 靜態頁面分派
// ----------------------------------------------------------------------------
// Purpose 目的:
//   1. 提供一個簡單的 Node.js HTTP 伺服器 (port 3001)
//   2. 當路徑以 /api/patient 開頭時, 代理請求到公開 HAPI FHIR 伺服器並回傳 Patient 相關 Bundle
//   3. 其他路徑交給 smart-pages.js 處理 (提供 login-smart.html, callback.html 等靜態資源)
//   4. 實作最小限度的 CORS + OPTIONS Preflight 支援
//
// High-level Flow 高層流程:
//   createServer -> 檢查是否 OPTIONS -> 判斷是否 /api/patient -> 是則組合 FHIR 查詢 URL 並透過 https 取回 -> 回傳 JSON
//                                                    否則 -> 交給 smartPages.handle 做靜態檔案/SMART 頁面處理
//
// Security Note 安全注意:
//   目前允許任何 Origin ('*')，僅適合本地開發。部署正式環境應限制來源或加入驗證。No auth layer now.
// ============================================================================
// Simple Node.js proxy to fetch specific HAPI FHIR bundle with related resources
const http = require('http');
const https = require('https');
const url = require('url');

const smartPages = require('./smart-pages'); // 靜態 SMART 登入 / callback 等頁面處理模組 (Static SMART page handler)

// Use PORT from environment variable (for Render.com) or default to 3001
const PORT = process.env.PORT || 3001;

// OpenRouter API Keys from environment variables (set in Render.com)
const OPENROUTER_API_KEYS = {
  CLINIC_INSIGHT: process.env.OPENROUTER_CLINIC_INSIGHT || '',
  PATIENT_ARTICLE_RANKING: process.env.OPENROUTER_PATIENT_ARTICLE_RANKING || '',
  PATIENT_INSIGHT: process.env.OPENROUTER_PATIENT_INSIGHT || ''
};

// Log API key status (without exposing the actual keys)
console.log('OpenRouter API Keys loaded:', {
  CLINIC_INSIGHT: OPENROUTER_API_KEYS.CLINIC_INSIGHT ? '✓ Set' : '✗ Missing',
  PATIENT_ARTICLE_RANKING: OPENROUTER_API_KEYS.PATIENT_ARTICLE_RANKING ? '✓ Set' : '✗ Missing',
  PATIENT_INSIGHT: OPENROUTER_API_KEYS.PATIENT_INSIGHT ? '✓ Set' : '✗ Missing'
});

/**
 * proxyOpenRouterRequest
 * 代理 OpenRouter API 請求,使用環境變數中的 API Key
 */
function proxyOpenRouterRequest(req, res, apiKeyType) {
  const apiKey = OPENROUTER_API_KEYS[apiKeyType];
  
  if (!apiKey) {
    res.writeHead(500, { 
      'Content-Type': 'application/json', 
      'Access-Control-Allow-Origin': '*' 
    });
    res.end(JSON.stringify({ 
      error: 'API key not configured',
      message: `Environment variable OPENROUTER_${apiKeyType} is not set` 
    }));
    return;
  }

  // Read request body
  let body = '';
  req.on('data', (chunk) => {
    body += chunk.toString();
  });

  req.on('end', () => {
    const options = {
      hostname: 'openrouter.ai',
      port: 443,
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.RENDER_EXTERNAL_URL || 'http://localhost:3001',
        'X-Title': 'Ever Healthier'
      }
    };

    const proxyReq = https.request(options, (apiRes) => {
      let data = '';
      apiRes.on('data', (chunk) => (data += chunk));
      apiRes.on('end', () => {
        res.writeHead(apiRes.statusCode || 200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(data);
      });
    });

    proxyReq.on('error', (err) => {
      res.writeHead(500, { 
        'Content-Type': 'application/json', 
        'Access-Control-Allow-Origin': '*' 
      });
      res.end(JSON.stringify({ 
        error: 'OpenRouter API error', 
        detail: err.message 
      }));
    });

    proxyReq.write(body);
    proxyReq.end();
  });
}

/**
 * buildQuery
 * 組合查詢 HAPI FHIR Patient 與關聯資源的 URL
 *
 * Input 參數:
 *   params: 由 url.parse(req.url, true).query 得到的物件
 *     - patientId / patient: 若存在, 直接用 _id 精準查詢那一位病人
 *     - code: (選擇性) Condition SNOMED code, 若沒提供使用 '70536003'
 *     - _count: (選擇性) 要求最多回傳多少 Patient (僅在無 patientId 情況下使用)
 *
 * Query Strategy 查詢策略:
 *   1. 如果有 patientId -> 用 _id=xxx 查單一病人
 *   2. 否則用 _has:Condition:subject:code=... 找符合某疾病代碼的病人集合 (示範用途)
 *   3. 加上 _revinclude 參數以便同時把相關的 Condition / Observation / Medication* / QuestionnaireResponse 拉回來
 *
 * Returns: 組合完成的完整 URL 字串
 */
function buildQuery(params) {
  const count = params._count || 1; // 預設只取 1 筆 (Default just 1 if not specified)
  const conditionCode = params.code || '70536003'; // Default SNOMED code (可依需求修改)
  const patientId = params.patientId || params.patient || null; // 支援兩種欄位名稱
  // 使用 HAPI FHIR 作為資料來源 (Use HAPI FHIR for actual patient data - kidney transplant patients)
  const baseUrl = 'https://hapi.fhir.org/baseR4/Patient';

  const searchParams = [];
  if (patientId) {
    // 精準查詢 (Direct patient id search)
    searchParams.push(`_id=${encodeURIComponent(patientId)}`);
  } else {
    // 以特定 Condition code 關聯的病人 (Patients having a Condition with given SNOMED code)
    searchParams.push(`_has:Condition:subject:code=http://snomed.info/sct|${conditionCode}`);
  }

  // _count 邏輯: 若沒給 patientId 且沒有外部指定 _count, 使用預設 count
  if (!params._count && !patientId) {
    searchParams.push(`_count=${count}`);
  } else if (params._count) {
    searchParams.push(`_count=${params._count}`);
  }

  // 想一次拿到的關聯資源 (Reverse includes)
  const revIncludes = [
    '_revinclude=Condition:subject',
    '_revinclude=Observation:patient',
    '_revinclude=MedicationStatement:subject',
    '_revinclude=MedicationRequest:subject',
    '_revinclude=QuestionnaireResponse:subject'
  ];

  return `${baseUrl}?${searchParams.join('&')}&${revIncludes.join('&')}`;
}

const server = http.createServer((req, res) => {
  // --------------------------------------------------------------------------
  // Basic CORS & Preflight Handling
  // 處理瀏覽器的預檢請求 (OPTIONS) 與允許跨網域 (僅用於開發階段)
  // --------------------------------------------------------------------------
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    });
    return res.end();
  }

  const urlObj = url.parse(req.url, true);
  const pathname = decodeURIComponent(urlObj.pathname || '/');

  // ---- Proxy SMART Health IT configuration requests to avoid CORS issues ----
  if (pathname === '/.well-known/smart-configuration') {
    const smartConfigUrl = 'https://r4.smarthealthit.org/.well-known/smart-configuration';
    https
      .get(smartConfigUrl, (apiRes) => {
        let data = '';
        apiRes.on('data', (chunk) => (data += chunk));
        apiRes.on('end', () => {
          res.writeHead(apiRes.statusCode || 200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(data);
        });
      })
      .on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'SMART config fetch error', detail: err.message }));
      });
    return;
  }

  // ---- Proxy SMART Health IT metadata requests to avoid CORS issues ----
  if (pathname === '/metadata') {
    const metadataUrl = 'https://r4.smarthealthit.org/metadata';
    https
      .get(metadataUrl, (apiRes) => {
        let data = '';
        apiRes.on('data', (chunk) => (data += chunk));
        apiRes.on('end', () => {
          res.writeHead(apiRes.statusCode || 200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(data);
        });
      })
      .on('error', (err) => {
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Metadata fetch error', detail: err.message }));
      });
    return;
  }

  // ---- OpenRouter API Proxy Endpoints ----
  // These endpoints proxy requests to OpenRouter API using server-side API keys
  if (pathname === '/api/openrouter/clinic-insight') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return;
    }
    proxyOpenRouterRequest(req, res, 'CLINIC_INSIGHT');
    return;
  }

  if (pathname === '/api/openrouter/article-ranking') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return;
    }
    proxyOpenRouterRequest(req, res, 'PATIENT_ARTICLE_RANKING');
    return;
  }

  if (pathname === '/api/openrouter/patient-insight') {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Method not allowed. Use POST.' }));
      return;
    }
    proxyOpenRouterRequest(req, res, 'PATIENT_INSIGHT');
    return;
  }

  // ---- /api/patient 路由: 代理至 HAPI FHIR 並回傳 JSON Bundle ----
  if (pathname.startsWith('/api/patient')) {
    const fhirUrl = buildQuery(urlObj.query);
    // 透過 https 模組發出外部請求 (Outbound request to public HAPI FHIR server)
    https
      .get(fhirUrl, (apiRes) => {
        let data = '';
        apiRes.on('data', (chunk) => (data += chunk));
        apiRes.on('end', () => {
          res.writeHead(apiRes.statusCode || 200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(data);
        });
      })
      .on('error', (err) => {
        // 捕捉網路或連線錯誤 (Handle network / connection errors)
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'FHIR API error', detail: err.message }));
      });
    return;
  }

  // ---- 其餘所有路徑交給 SMART 靜態頁面模組 (static handler) ----
  smartPages.handle(req, res);
});

server.listen(PORT, () => {
  console.log(`FHIR proxy server running: http://localhost:${PORT}/api/patient`);
  console.log(`SMART login page:        http://localhost:${PORT}/login.html`);
  console.log(`SMART redirect URI:      http://localhost:${PORT}/callback.html`);
});
