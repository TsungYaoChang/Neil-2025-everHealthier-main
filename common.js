// 共用 JavaScript 文件 - common.js

// 全域變數和設定
const CONFIG = {
  API_BASE_URL: 'http://localhost:3000/api',
  FHIR_BASE_URL: 'http://localhost:8080/fhir',
  TOKEN_KEY: 'auth_token',
  USER_KEY: 'user_data',
  ROLE_KEY: 'user_role',
  ENABLE_NOTIFICATIONS: false // set true when backend /notifications/unread is available
};

// 工具函式
const Utils = {
  // 格式化日期
  formatDate(date, format = 'YYYY-MM-DD') {
    const d = new Date(date);
    
    switch (format) {
      case 'YYYY-MM-DD':
        return new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(d).split('/').reverse().join('-');
      case 'YYYY-MM-DD HH:mm':
        return new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(d).replace(',', '');
      case 'MM/DD':
        return new Intl.DateTimeFormat('en-US', {
          month: '2-digit',
          day: '2-digit'
        }).format(d);
      case 'HH:mm':
        return new Intl.DateTimeFormat('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(d);
      default:
        return new Intl.DateTimeFormat('en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }).format(d).split('/').reverse().join('-');
    }
  },

  // 計算天數差
  daysDiff(date1, date2) {
    const oneDay = 24 * 60 * 60 * 1000;
    const firstDate = new Date(date1);
    const secondDate = new Date(date2);
    return Math.round((secondDate - firstDate) / oneDay);
  },

  // 驗證輸入
  validateInput(value, type) {
    switch (type) {
      case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      case 'phone': return /^[\d\-\+\(\)\s]+$/.test(value);
      case 'number': return !isNaN(value) && value !== '';
      case 'bloodPressure': return /^\d{2,3}\/\d{2,3}$/.test(value);
      default: return String(value).trim() !== '';
    }
  },

  // 顯示通知
  showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `alert alert-${type} notification-toast`;
    notification.textContent = message;
    notification.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 1001;
      min-width: 300px; opacity: 0; transform: translateX(100%);
      transition: all .3s ease;
    `;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '1';
      notification.style.transform = 'translateX(0)';
    }, 10);

    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transform = 'translateX(100%)';
      setTimeout(() => notification.parentNode && notification.parentNode.removeChild(notification), 300);
    }, duration);
  },

  // 防抖函式
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  },

  // 深度複製
  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  // 本地存儲操作
  storage: {
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); }
      catch (error) { console.error('Storage set error:', error); }
    },
    get(key) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : null;
      } catch (error) {
        console.error('Storage get error:', error);
        return null;
      }
    },
    remove(key) {
      try { localStorage.removeItem(key); }
      catch (error) { console.error('Storage remove error:', error); }
    }
  }
};

// API 請求處理
const API = {
  async request(url, options = {}) {
    const token = Utils.storage.get(CONFIG.TOKEN_KEY);
    const defaultOptions = {
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      }
    };

    try {
      const response = await fetch(`${CONFIG.API_BASE_URL}${url}`, {
        ...defaultOptions,
        ...options,
        headers: { ...defaultOptions.headers, ...(options.headers || {}) }
      });

      if (response.status === 401) {
        Auth.logout();
        window.location.href = '/login-smart.html';
        return;
      }
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      return await response.json();
    } catch (error) {
      console.error('API request error:', error);
      Utils.showNotification('網路連接錯誤', 'danger');
      throw error;
    }
  },
  get(url) { return this.request(url); },
  post(url, data) { return this.request(url, { method: 'POST', body: JSON.stringify(data) }); },
  put(url, data) { return this.request(url, { method: 'PUT', body: JSON.stringify(data) }); },
  delete(url) { return this.request(url, { method: 'DELETE' }); }
};

// 認證管理
const Auth = {
  async login(credentials) {
    try {
      const response = await API.post('/auth/login', credentials);
      if (response.token) {
        Utils.storage.set(CONFIG.TOKEN_KEY, response.token);
        Utils.storage.set(CONFIG.USER_KEY, response.user);
        Utils.storage.set(CONFIG.ROLE_KEY, response.user.role);
        return response;
      }
    } catch {
      throw new Error('登入失敗');
    }
  },
  logout() {
    Utils.storage.remove(CONFIG.TOKEN_KEY);
    Utils.storage.remove(CONFIG.USER_KEY);
    Utils.storage.remove(CONFIG.ROLE_KEY);
  },
  isAuthenticated() { return !!Utils.storage.get(CONFIG.TOKEN_KEY); },
  getCurrentUser() { return Utils.storage.get(CONFIG.USER_KEY); },
  getUserRole() { return Utils.storage.get(CONFIG.ROLE_KEY); }
};

// 模態框管理（統一 IIFE，支援舊/新兩種結構）
const Modal = (() => {
  let lastTrigger = null;

  function show(id, triggerEl = null) {
    const wrap = document.getElementById(id);
    if (!wrap) return;

    lastTrigger = triggerEl || document.activeElement;

    // 相容舊 .modal 寫法與新 overlay 寫法
    if (wrap.classList.contains('modal')) {
      wrap.classList.add('active');
      wrap.style.display = 'block';
    } else {
      wrap.classList.remove('hidden');
      wrap.classList.add('flex');
    }

    wrap.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);

    const first = wrap.querySelector('input, select, textarea, button');
    if (first) first.focus();
  }

  function hide(id) {
    const wrap = document.getElementById(id);
    if (!wrap) return;

    if (wrap.classList.contains('modal')) {
      wrap.classList.remove('active');
      wrap.style.display = 'none';
    } else {
      wrap.classList.add('hidden');
      wrap.classList.remove('flex');
    }

    wrap.removeEventListener('click', onBackdrop);
    document.removeEventListener('keydown', onEsc);

    if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
  }

  function onBackdrop(e) {
    // 內層容器：舊 .modal-content 或新 .bg-white.rounded-xl
    const panel = e.currentTarget.querySelector('.modal-content, .bg-white.rounded-xl');
    if (panel && !panel.contains(e.target)) hide(e.currentTarget.id);
  }

  function onEsc(e) {
    if (e.key !== 'Escape') return;
    const open = document.querySelector(
      '[role="dialog"]:not(.hidden), .modal.active, .modal[style*="display: block"]'
    );
    if (open) hide(open.id);
  }

  // 動態建立（選用）
  function create(config) {
    const modal = document.createElement('div');
    modal.id = config.id || 'dynamicModal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.className = 'fixed inset-0 z-50 hidden items-center justify-center bg-black/40';
    modal.innerHTML = `
      <div class="w-full max-w-md rounded-xl bg-white shadow-lg modal-content">
        <div class="flex items-center justify-between px-4 py-3 border-b">
          <h3 class="text-base font-semibold">${config.title || '標題'}</h3>
          <button type="button" class="text-gray-500 hover:text-gray-700"
                  aria-label="Close" data-modal-close="${modal.id}">×</button>
        </div>
        <div class="px-4 py-4">${config.body || ''}</div>
        ${config.footer ? `<div class="flex justify-end gap-2 px-4 py-3 border-t">${config.footer}</div>` : ''}
      </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  // 全站委派：任何 data-modal-close 都能關
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-modal-close]');
    if (btn) hide(btn.getAttribute('data-modal-close'));
  });

  return { show, hide, create };
})();

// 圖表工具（簡易 Canvas 繪製）
const Chart = {
  createLineChart(containerId, data, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width: 100%; height: 100%;';
    container.innerHTML = '';
    container.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;

    this.drawLineChart(ctx, data, canvas.width, canvas.height, options);
  },

  drawLineChart(ctx, data, width, height, options) {
    const padding = 40;
    const chartWidth = width - 2 * padding;
    const chartHeight = height - 2 * padding;

    ctx.clearRect(0, 0, width, height);

    // 網格
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (chartHeight / 5) * i;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
    }

    // 軸 & 線
    const values = data.map(d => d.value);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = Math.max(maxValue - minValue, 1e-6); // 避免除以 0

    ctx.strokeStyle = options.color || '#3B82F6';
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((point, index) => {
      const x = padding + (chartWidth / Math.max(data.length - 1, 1)) * index;
      const y = padding + chartHeight - ((point.value - minValue) / valueRange) * chartHeight;
      index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 點
    ctx.fillStyle = options.color || '#3B82F6';
    data.forEach((point, index) => {
      const x = padding + (chartWidth / Math.max(data.length - 1, 1)) * index;
      const y = padding + chartHeight - ((point.value - minValue) / valueRange) * chartHeight;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 2 * Math.PI);
      ctx.fill();
    });
  },

  createProgressCircle(containerId, percentage, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const circle1 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    const circle2 = document.createElementNS('http://www.w3.org/2000/svg', 'circle');

    svg.setAttribute('width', '120');
    svg.setAttribute('height', '120');

    circle1.setAttribute('cx', '60');
    circle1.setAttribute('cy', '60');
    circle1.setAttribute('r', '50');
    circle1.setAttribute('fill', 'none');
    circle1.setAttribute('stroke', '#E5E7EB');
    circle1.setAttribute('stroke-width', '8');

    circle2.setAttribute('cx', '60');
    circle2.setAttribute('cy', '60');
    circle2.setAttribute('r', '50');
    circle2.setAttribute('fill', 'none');
    circle2.setAttribute('stroke', options.color || '#10B981');
    circle2.setAttribute('stroke-width', '8');
    circle2.setAttribute('stroke-linecap', 'round');

    const circumference = 2 * Math.PI * 50;
    const strokeDasharray = `${(Math.max(0, Math.min(100, percentage)) / 100) * circumference} ${circumference}`;
    circle2.setAttribute('stroke-dasharray', strokeDasharray);
    circle2.style.transform = 'rotate(-90deg)';
    circle2.style.transformOrigin = '60px 60px';

    svg.appendChild(circle1);
    svg.appendChild(circle2);

    container.innerHTML = '';
    container.appendChild(svg);

    const text = document.createElement('div');
    text.className = 'progress-text';
    text.textContent = `${Math.round(Math.max(0, Math.min(100, percentage)))}%`;
    text.style.cssText = `
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%); font-size: 1.5rem;
      font-weight: 600; color: #374151;
    `;
    container.style.position = 'relative';
    container.appendChild(text);
  }
};

// 表單驗證
const FormValidator = {
  rules: {
    required: (value) => String(value).trim() !== '',
    email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    minLength: (min) => (value) => String(value).length >= min,
    maxLength: (max) => (value) => String(value).length <= max,
    numeric: (value) => !isNaN(value) && value !== '',
    bloodPressure: (value) => /^\d{2,3}\/\d{2,3}$/.test(value),
    phone: (value) => /^[\d\-\+\(\)\s]+$/.test(value)
  },

  validate(formId, validationRules) {
    const form = document.getElementById(formId);
    if (!form) return { isValid: false, errors: { form: '表單不存在' } };

    let isValid = true;
    const errors = {};

    Object.keys(validationRules).forEach(fieldName => {
      const field = form.querySelector(`[name="${fieldName}"]`);
      if (!field) return;

      const rules = validationRules[fieldName];
      const value = field.value;

      // 清除之前的錯誤樣式
      field.classList.remove('error');
      const existingError = field.parentNode.querySelector('.form-error');
      if (existingError) existingError.remove();

      // 驗證規則
      for (let rule of rules) {
        let ruleFunc, errorMessage;

        if (typeof rule === 'string') {
          ruleFunc = this.rules[rule];
          errorMessage = this.getDefaultErrorMessage(rule, fieldName);
        } else if (typeof rule === 'object') {
          ruleFunc = this.rules[rule.type];
          if (rule.params) ruleFunc = ruleFunc(rule.params);
          errorMessage = rule.message || this.getDefaultErrorMessage(rule.type, fieldName);
        }

        if (ruleFunc && !ruleFunc(value)) {
          isValid = false;
          errors[fieldName] = errorMessage;

          field.classList.add('error');
          const errorDiv = document.createElement('div');
          errorDiv.className = 'form-error';
          errorDiv.textContent = errorMessage;
          field.parentNode.appendChild(errorDiv);
          break;
        }
      }
    });

    return { isValid, errors };
  },

  getDefaultErrorMessage(ruleType, fieldName) {
    const messages = {
      required: `${fieldName}是必填項目`,
      email: '請輸入有效的電子郵件地址',
      minLength: `${fieldName}長度不足`,
      maxLength: `${fieldName}長度超過限制`,
      numeric: '請輸入有效的數字',
      bloodPressure: '請輸入正確的血壓格式 (例：120/80)',
      phone: '請輸入有效的電話號碼'
    };
    return messages[ruleType] || '輸入格式不正確';
  }
};

// 數據管理
const DataManager = {
  // 患者數據緩存
  patientCache: new Map(),

  // 獲取患者列表
  async getPatients(filters = {}) {
    try {
      const queryParams = new URLSearchParams(filters).toString();
      const url = `/patients${queryParams ? '?' + queryParams : ''}`;
      return await API.get(url);
    } catch (error) {
      console.error('獲取患者列表失敗:', error);
      return [];
    }
  },

  // 獲取單個患者詳情
  async getPatient(patientId) {
    if (this.patientCache.has(patientId)) {
      return this.patientCache.get(patientId);
    }
    try {
      const patient = await API.get(`/patients/${patientId}`);
      this.patientCache.set(patientId, patient);
      return patient;
    } catch (error) {
      console.error('獲取患者詳情失敗:', error);
      return null;
    }
  },

  // 提交監測數據
  async submitMonitoringData(patientId, data) {
    try {
      const fhirObservation = this.convertToFHIR(data);
      return await API.post(`/patients/${patientId}/observations`, fhirObservation);
    } catch (error) {
      console.error('提交監測數據失敗:', error);
      throw error;
    }
  },

  // 轉換為 FHIR 格式（簡化示例）
  convertToFHIR(data) {
    const observation = {
      resourceType: 'Observation',
      status: 'final',
      category: [{
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }]
      }],
      effectiveDateTime: new Date().toISOString(),
      component: []
    };

    if (data.weight) {
      observation.component.push({
        code: { coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body weight' }] },
        valueQuantity: { value: parseFloat(data.weight), unit: 'kg', system: 'http://unitsofmeasure.org' }
      });
    }

    if (data.bloodPressure) {
      const [systolic, diastolic] = data.bloodPressure.split('/');
      observation.component.push({
        code: { coding: [{ system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure' }] },
        component: [
          {
            code: { coding: [{ system: 'http://loinc.org', code: '8480-6', display: 'Systolic blood pressure' }] },
            valueQuantity: { value: parseInt(systolic), unit: 'mmHg', system: 'http://unitsofmeasure.org' }
          },
          {
            code: { coding: [{ system: 'http://loinc.org', code: '8462-4', display: 'Diastolic blood pressure' }] },
            valueQuantity: { value: parseInt(diastolic), unit: 'mmHg', system: 'http://unitsofmeasure.org' }
          }
        ]
      });
    }

    if (data.temperature) {
      observation.component.push({
        code: { coding: [{ system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' }] },
        valueQuantity: { value: parseFloat(data.temperature), unit: 'Cel', system: 'http://unitsofmeasure.org' }
      });
    }

    return observation;
  },

  // 計算依從性
  calculateAdherence(medicationRecords) {
    if (!medicationRecords || medicationRecords.length === 0) return 0;
    const totalDoses = medicationRecords.length;
    const takenDoses = medicationRecords.filter(record => record.taken).length;
    return Math.round((takenDoses / totalDoses) * 100);
    },

  // 檢查異常值
  checkAbnormalValues(data, normalRanges) {
    const alerts = [];
    Object.keys(data).forEach(key => {
      if (normalRanges[key]) {
        const value = parseFloat(data[key]);
        const range = normalRanges[key];
        if (value < range.min || value > range.max) {
          alerts.push({
            type: 'abnormal_value',
            parameter: key,
            value,
            normalRange: range,
            severity: this.calculateSeverity(value, range)
          });
        }
      }
    });
    return alerts;
  },

  // 計算嚴重程度
  calculateSeverity(value, range) {
    const deviation = Math.max(
      (range.min - value) / range.min,
      (value - range.max) / range.max
    );
    if (deviation > 0.5) return 'high';
    if (deviation > 0.2) return 'medium';
    return 'low';
  }
};

// 頁面初始化
const PageInit = {
  // 通用初始化
  init() {
    this.setupNavigation();
    this.setupModals();
    this.setupNotifications();
    // 已移除 checkAuthentication，允許直接進入 dashboard
    // this.checkAuthentication();
  },

  // 設置導航
  setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');
    const currentPage = window.location.pathname;

    navLinks.forEach(link => {
      if (link.getAttribute('href') === currentPage) link.classList.add('active');
      link.addEventListener('click', (e) => {
        navLinks.forEach(nl => nl.classList.remove('active'));
        e.currentTarget.classList.add('active');
      });
    });
  },

  // 設置模態框（相容舊/新）
  setupModals() {
    // 點擊關閉按鈕
    document.addEventListener('click', (e) => {
      const closeBtn = e.target.closest('[data-modal-close]');
      if (closeBtn) {
        const modalId = closeBtn.getAttribute('data-modal-close');
        if (modalId) Modal.hide(modalId);
      }
    });

    // ESC 鍵關閉（同時尋找舊 .modal 與新 role="dialog"）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const open = document.querySelector(
          '[role="dialog"]:not(.hidden), .modal.active, .modal[style*="display: block"]'
        );
        if (open) Modal.hide(open.id);
      }
    });
  },

  // 設置通知
  setupNotifications() {
    if (!CONFIG.ENABLE_NOTIFICATIONS) {
      console.info('Notifications polling disabled (CONFIG.ENABLE_NOTIFICATIONS=false).');
      return;
    }
    if (Auth.isAuthenticated()) {
      this._notifTimer = setInterval(() => { this.checkNewNotifications(); }, 30000);
      this.checkNewNotifications();
    }
  },

  // 檢查新通知
  async checkNewNotifications() {
    try {
      const notifications = await API.get('/notifications/unread');
      this.updateNotificationBadge(notifications.length);
    } catch (error) {
      if (!this._notifErrorShown) {
        console.warn('Notifications endpoint unavailable. Suppressing further errors.');
        this._notifErrorShown = true;
      }
    }
  },

  // 更新通知徽章
  updateNotificationBadge(count) {
    const badge = document.querySelector('.notification-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  },

  // 檢查認證狀態（如需）
  checkAuthentication() {
    const publicPages = ['/login-smart.html', '/register.html'];
    const currentPage = window.location.pathname;

    if (!Auth.isAuthenticated() && !publicPages.includes(currentPage)) {
      window.location.href = '/login-smart.html';
      return;
    }
    if (Auth.isAuthenticated() && publicPages.includes(currentPage)) {
      const role = Auth.getUserRole();
      window.location.href = role === 'patient' ? '/patient-dashboard.html' : '/clinic-dashboard.html';
    }
  }
};

// 頁面載入完成後初始化
document.addEventListener('DOMContentLoaded', () => {
  PageInit.init();
});

// 導出供其他文件使用
window.Utils = Utils;
window.API = API;
window.Auth = Auth;
window.Modal = Modal;
window.Chart = Chart;
window.FormValidator = FormValidator;
window.DataManager = DataManager;
window.PageInit = PageInit;
