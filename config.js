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
  
  // OpenRouter API - DO NOT PUT REAL KEYS HERE IN FRONTEND
  // Frontend will call backend proxy endpoints instead
  // Backend reads API keys from environment variables (Render.com)
  OPENROUTER_ENDPOINTS: {
    CLINIC_INSIGHT: '/api/openrouter/clinic-insight',
    PATIENT_ARTICLE_RANKING: '/api/openrouter/article-ranking',
    PATIENT_INSIGHT: '/api/openrouter/patient-insight'
  },
  
  // Additional settings
  ENABLE_NOTIFICATIONS: false
};

// Make config globally available
window.APP_CONFIG = CONFIG;

console.log('App Config loaded:', {
  backend: CONFIG.BACKEND_URL,
  environment: window.location.hostname === 'localhost' ? 'development' : 'production'
});

