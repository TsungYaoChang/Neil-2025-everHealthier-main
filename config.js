// Environment configuration
// This file will be updated with production URLs after deployment

const CONFIG = {
  // Backend URL - automatically detects environment
  BACKEND_URL: (() => {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    
    console.log('Environment detection:', { hostname, protocol, fullUrl: window.location.href });
    
    // Development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      console.log('Using development backend URL');
      return 'http://localhost:3001';
    }
    
    // Production - Render.com (serves both frontend and backend)
    const renderUrl = 'https://everhealthier-backend.onrender.com';
    console.log('Using production backend URL:', renderUrl);
    return renderUrl;
  })(),
  
  // FHIR Servers
  FHIR_AUTH_SERVER: 'https://r4.smarthealthit.org',
  HAPI_FHIR_BASE: 'https://hapi.fhir.org/baseR4',
  
  // OAuth2 Settings
  CLIENT_ID: 'my-smart-web-app',
  
  // Scopes
  PATIENT_SCOPE: 'launch/patient openid fhirUser profile patient/Patient.read patient/Observation.read patient/MedicationRequest.read patient/MedicationStatement.read patient/Condition.read patient/QuestionnaireResponse.read',
  PRACTITIONER_SCOPE: 'openid fhirUser profile user/Patient.read user/Practitioner.read user/Observation.read user/MedicationRequest.read user/MedicationStatement.read user/Condition.read user/QuestionnaireResponse.read',
  
  // OpenRouter API keys - DO NOT PUT REAL KEYS HERE
  // Load from config.local.js (not tracked by git) or use backend proxy
  OPENROUTER_API_KEYS: {
    CLINIC_INSIGHT: '',
    PATIENT_ARTICLE_RANKING: '',
    PATIENT_INSIGHT: ''
  },
  
  // Additional settings
  ENABLE_NOTIFICATIONS: false
};

// Make config globally available
window.APP_CONFIG = CONFIG;

// Merge with local config if available (contains API keys)
if (typeof window.LOCAL_CONFIG !== 'undefined') {
  Object.assign(CONFIG.OPENROUTER_API_KEYS, window.LOCAL_CONFIG.OPENROUTER_API_KEYS);
  console.log('Local API keys loaded successfully');
}

console.log('App Config loaded:', {
  backend: CONFIG.BACKEND_URL,
  environment: window.location.hostname === 'localhost' ? 'development' : 'production'
});

