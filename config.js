// Environment configuration
// This file will be updated with production URLs after deployment

const CONFIG = {
  // Backend URL - automatically detects environment
  BACKEND_URL: (() => {
    const hostname = window.location.hostname;
    
    // Development
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:3001';
    }
    
    // Production - Render.com backend
    // Replace with your actual Render.com URL after deployment
    return 'https://YOUR_RENDER_URL.onrender.com';
  })(),
  
  // FHIR Servers
  FHIR_AUTH_SERVER: 'https://r4.smarthealthit.org',
  HAPI_FHIR_BASE: 'https://hapi.fhir.org/baseR4',
  
  // OAuth2 Settings
  CLIENT_ID: 'my-smart-web-app',
  
  // Scopes
  PATIENT_SCOPE: 'launch/patient openid fhirUser profile patient/Patient.read patient/Observation.read patient/MedicationRequest.read patient/MedicationStatement.read patient/Condition.read patient/QuestionnaireResponse.read',
  PRACTITIONER_SCOPE: 'openid fhirUser profile user/Patient.read user/Practitioner.read user/Observation.read user/MedicationRequest.read user/MedicationStatement.read user/Condition.read user/QuestionnaireResponse.read'
};

// Make config globally available
window.APP_CONFIG = CONFIG;

console.log('App Config loaded:', {
  backend: CONFIG.BACKEND_URL,
  environment: window.location.hostname === 'localhost' ? 'development' : 'production'
});

