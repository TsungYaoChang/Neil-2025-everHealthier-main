// clinic.js - Complete Chart.js implementation with all tabs

// ========== HAPI FHIR SERVER ==========
const HAPI_FHIR_BASE = 'https://hapi.fhir.org/baseR4';

// ========== PROTECT CHART.JS FROM common.js CONFLICT ==========
let ChartJS = null;

/**
 * Get the Chart.js constructor from multiple possible sources
 * @returns {Function|null} Chart.js constructor function
 */
function getChartConstructor() {
  // Try multiple sources in order of preference
  return ChartJS || window.ChartJSLib || window.ChartJSConstructor || window.Chart;
}

/**
 * Wait for Chart.js library to be available and execute callback
 * @param {Function} callback - Function to execute when Chart.js is ready
 * @param {number} maxAttempts - Maximum number of attempts to check (default: 50)
 */
function waitForChart(callback, maxAttempts = 50) {
  let attempts = 0;
  const interval = setInterval(() => {
    attempts++;
    const chartConstructor = getChartConstructor();
    if (chartConstructor && typeof chartConstructor === 'function') {
      ChartJS = chartConstructor; // Save it globally
      clearInterval(interval);
      console.log('✅ Chart.js is ready!');
      callback();
    } else if (attempts >= maxAttempts) {
      clearInterval(interval);
      console.error('❌ Chart.js failed to load after', maxAttempts, 'attempts');
    }
  }, 100);
}

const chartInstances = {};

/**
 * Generate fallback renal function data for the last 90 days
 * Creates weekly data points with Creatinine, eGFR, BUN, Tacrolimus, CRP, and WBC values
 * Used as placeholder when no real data is available from FHIR
 * @returns {Array<Object>} Array of renal data objects
 */
function generateFallbackRenalData() {
  const data = [];
  const today = new Date();

  // Generate data for last 90 days (3 months), every 7 days
  for (let i = 12; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - (i * 7));

    data.push({
      date: date.toISOString().split('T')[0],
      Cr: (1.2 + Math.random() * 0.8).toFixed(1),     // Creatinine (2160-0)
      eGFR: Math.floor(40 + Math.random() * 30).toString(), // eGFR (98979-8)
      BUN: Math.floor(20 + Math.random() * 25).toString(),  // BUN (3094-0)
      Tac: (4 + Math.random() * 6).toFixed(1),         // Tacrolimus (11253-2)
      CRP: (0.5 + Math.random() * 2).toFixed(1),      // CRP
      WBC: Math.floor(4000 + Math.random() * 4000).toString() // WBC
    });
  }

  return data;
}

/**
 * Generate fallback immunosuppressant (Tacrolimus) data for the last 90 days
 * Creates data points every 15 days with target ranges
 * Used as placeholder when no real data is available from FHIR
 * @returns {Array<Object>} Array of Tacrolimus level data objects
 */
function generateFallbackImmunoData() {
  const data = [];
  const today = new Date();

  // Generate data for last 90 days (3 months), every 18 days (5 data points)
  for (let i = 5; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - (i * 15));

    data.push({
      date: date.toISOString().split('T')[0],
      Tac: (4 + Math.random() * 6).toFixed(1),
      targetMin: 5,
      targetMax: 8
    });
  }

  return data;
}

/**
 * Generate fallback blood pressure data for the last 14 days
 * Creates daily systolic and diastolic readings
 * Used as placeholder when no real data is available from FHIR
 * @returns {Array<Object>} Array of blood pressure data objects
 */
function generateFallbackBPData() {
  const data = [];
  const today = new Date();

  for (let i = 13; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);

    data.push({
      date: date.toISOString().split('T')[0],
      systolic: Math.floor(120 + Math.random() * 40).toString(),
      diastolic: Math.floor(75 + Math.random() * 25).toString()
    });
  }

  return data;
}

/**
 * Generate fallback weight data for the last 14 days
 * Creates daily weight measurements with slight variations
 * Used as placeholder when no real data is available from FHIR
 * @returns {Array<Object>} Array of weight data objects
 */
function generateFallbackWeightData() {
  const data = [];
  const today = new Date();
  let baseWeight = 72;

  // Generate data for last 14 days
  for (let i = 13; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    baseWeight += (Math.random() - 0.5) * 0.5;

    data.push({
      date: date.toISOString().split('T')[0],
      weight: baseWeight.toFixed(1)
    });
  }

  return data;
}

/**
 * Fill missing dates in data to ensure complete X-axis display
 * Creates placeholder entries for dates without data to show continuous timeline
 * @param {Array<Object>} data - Original data array with date property
 * @param {number} daysBack - Number of days to go back from today
 * @returns {Array<Object>} Data array with all dates filled in the range
 */
function fillMissingDates(data, daysBack) {
  if (!data || data.length === 0) return [];
  
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - daysBack);
  
  // Create a map of existing data
  const dataMap = new Map();
  data.forEach(item => {
    dataMap.set(item.date, item);
  });
  
  // Fill all dates in the range
  const filledData = [];
  for (let i = 0; i <= daysBack; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dateStr = date.toISOString().split('T')[0];
    
    if (dataMap.has(dateStr)) {
      filledData.push(dataMap.get(dateStr));
    } else {
      // Add placeholder with null values
      filledData.push({ date: dateStr });
    }
  }
  
  return filledData;
}

/**
 * Destroy an existing chart instance to prevent memory leaks
 * @param {string} chartId - The ID of the chart to destroy
 */
function destroyChart(chartId) {
  if (chartInstances[chartId]) {
    chartInstances[chartId].destroy();
    delete chartInstances[chartId];
  }
}

/**
 * Create a line chart with Chart.js
 * @param {string} canvasId - The ID of the canvas element
 * @param {Object} config - Chart configuration object
 * @param {Object} config.data - Chart data (labels and datasets)
 * @param {Object} [config.options] - Additional chart options
 * @param {boolean} [config.showLegend=true] - Whether to show the legend
 * @returns {Object|null} Chart instance or null if creation failed
 */
function createLineChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn(`Canvas element '${canvasId}' not found`);
    return null;
  }

  // Get the Chart constructor
  const ChartConstructor = getChartConstructor();

  if (!ChartConstructor || typeof ChartConstructor !== 'function') {
    console.error('Chart.js constructor is not available');
    canvas.parentElement.innerHTML = '<div class="flex items-center justify-center h-full text-red-600"><p>Chart library not loaded</p></div>';
    return null;
  }

  destroyChart(canvasId);

  try {
    const ctx = canvas.getContext('2d');
    chartInstances[canvasId] = new ChartConstructor(ctx, {
      type: 'line',
      data: config.data,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: config.showLegend !== false ? {
            position: 'top',
            labels: { boxWidth: 12, padding: 10, font: { size: 11 } }
          } : { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { font: { size: 10 } }
          },
          y: {
            beginAtZero: false,
            grid: { color: '#f3f4f6' },
            ticks: { font: { size: 10 } }
          }
        },
        ...config.options
      }
    });

    console.log(`✅ Chart '${canvasId}' created successfully`);
    return chartInstances[canvasId];
  } catch (error) {
    console.error(`❌ Error creating chart '${canvasId}':`, error);
    canvas.parentElement.innerHTML = `<div class="flex items-center justify-center h-full text-red-600"><p>Error: ${error.message}</p></div>`;
    return null;
  }
}

/**
 * Main dashboard class for clinician view
 * Manages patient list, clinical data display, and chart rendering
 */
class ClinicianDashboard {
  /**
   * Initialize the dashboard with default values and load data
   */
  constructor() {
    this.currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser)
      ? Auth.getCurrentUser()
      : { name: 'Dr. Smith', role: 'clinic' };
    this.patients = [];
    this.filteredPatients = [];
    this.selectedPatient = null;
    this.currentAttentionCategory = 'total';
    this.showAllAppointments = false;
    this.renalViewMode = 'blood';

    this.init();
  }

  /**
   * Initialize dashboard - setup listeners, load data
   */
  async init() {
    this.setupEventListeners();
    this.loadUserData();
    this.updateDateTime();
    
    // Load patients first, then render UI
    await this.loadPatients();
  }

  /**
   * Setup all event listeners for UI interactions
   */
  setupEventListeners() {
    document.getElementById('userMenuButton')?.addEventListener('click', () => {
      document.getElementById('userMenu')?.classList.toggle('hidden');
    });

    document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.handleLogout();
    });

    const searchInput = document.getElementById('patientSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => this.handleSearch(e.target.value), 300);
      });
    }

    document.querySelectorAll('.attention-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchAttentionCategory(tab.dataset.category));
    });

    document.getElementById('viewAllAppointments')?.addEventListener('click', () => {
      this.showAllAppointments = !this.showAllAppointments;
      this.renderAppointments();
    });

    document.getElementById('closePatientCard')?.addEventListener('click', () => {
      this.hideSelectedPatient();
    });

    document.querySelectorAll('.clinical-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchClinicalTab(tab.dataset.tab));
    });

    document.querySelectorAll('.renal-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.renalViewMode = btn.dataset.view;
        document.querySelectorAll('.renal-view-btn').forEach(b => {
          if (b.dataset.view === this.renalViewMode) {
            b.className = 'renal-view-btn px-3 py-1 text-xs rounded bg-blue-600 text-white';
          } else {
            b.className = 'renal-view-btn px-3 py-1 text-xs rounded bg-gray-200 text-gray-700';
          }
        });
        this.renderRenalTrendsTab();
      });
    });
  }

  /**
   * Load current user data and update UI
   */
  loadUserData() {
    if (this.currentUser?.name) {
      const nameEl = document.getElementById('userName');
      const initialEl = document.getElementById('userInitial');
      if (nameEl) nameEl.textContent = this.currentUser.name;
      if (initialEl) initialEl.textContent = this.currentUser.name.charAt(0);
    }
  }

  /**
   * Update the current date/time display
   */
  updateDateTime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    const dateEl = document.getElementById('currentDate');
    if (dateEl) dateEl.textContent = dateStr;
  }

  /**
   * Load all patients from HAPI FHIR and process their data
   */
  async loadPatients() {
    try {
      // Show loading state
      console.log('Loading patients from HAPI FHIR...');
      this.showLoadingState(true);
      this.showAppointmentsLoading(true);
      
      // Get practitioner ID from localStorage
      const userData = JSON.parse(localStorage.getItem('user_data') || '{}');
      const practitionerId = userData.id;
      
      if (!practitionerId) {
        console.error('No practitioner ID found in user_data');
        this.patients = [];
        this.filteredPatients = [];
        this.showLoadingState(false);
        this.showAppointmentsLoading(false);
        return;
      }
      
      // Fetch patients with kidney transplant condition and matching practitioner
      const patients = await this.fetchPatientsFromHapiFhir(practitionerId);
      
      this.patients = patients;
      this.filteredPatients = [...this.patients];
      
      console.log(`✅ Loaded ${patients.length} patients from HAPI FHIR`);
      
      // Hide loading state
      this.showLoadingState(false);
      
      // Update UI
      this.updateStatistics();
      this.renderPatientList();
      this.renderAppointments();
      
      // Hide appointments loading after rendering
      this.showAppointmentsLoading(false);
    } catch (error) {
      console.error('Error loading patients:', error);
      this.patients = [];
      this.filteredPatients = [];
      this.showLoadingState(false);
      this.showAppointmentsLoading(false);
    }
  }

  /**
   * Display or hide appointments loading spinner
   * @param {boolean} isLoading - Whether to show loading state
   */
  showAppointmentsLoading(isLoading) {
    const container = document.getElementById('nextApptList');
    if (!container) return;
    
    if (isLoading) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-8 space-y-3">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p class="text-gray-600">Loading...</p>
        </div>
      `;
    }
  }

  /**
   * Display or hide patient list loading spinner
   * @param {boolean} isLoading - Whether to show loading state
   */
  showLoadingState(isLoading) {
    const container = document.getElementById('patientListItems');
    if (!container) return;
    
    if (isLoading) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-8">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-3"></div>
          <p class="text-sm text-gray-500">Loading ...</p>
        </div>
      `;
    }
  }

  /**
   * Get gender icon SVG based on gender value
   * @param {string} gender - Gender value (male/female/other/unknown)
   * @returns {string} SVG markup for gender icon
   */
  getGenderIcon(gender) {
    const genderLower = (gender || 'unknown').toLowerCase();
    
    switch(genderLower) {
      case 'male':
        // ♂
        return `
          <svg class="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <circle cx="10" cy="14" r="5"/>
            <path d="M15 9l4-4m0 0h-3m3 0v3" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;
      case 'female':
        // ♀
        return `
          <svg class="w-5 h-5 text-pink-500" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
            <circle cx="12" cy="8" r="5"/>
            <path d="M12 13v7m-3-3h6" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        `;
      case 'other':
        // ? (purple)
        return `
          <svg class="w-5 h-5 text-purple-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
          </svg>
        `;
      default: // unknown
        // ? (gray)
        return `
          <svg class="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
          </svg>
        `;
    }
  }

  /**
   * Get background color class based on gender
   * @param {string} gender - Gender value (male/female/other/unknown)
   * @returns {string} Tailwind CSS background color class
   */
  getGenderBgColor(gender) {
    const genderLower = (gender || 'unknown').toLowerCase();
    
    switch(genderLower) {
      case 'male':
        return 'bg-blue-100';
      case 'female':
        return 'bg-pink-100';
      case 'other':
        return 'bg-purple-100';
      default: // unknown
        return 'bg-gray-100';
    }
  }

  /**
   * Fetch patients from HAPI FHIR with kidney transplant condition
   * @param {string} practitionerId - The practitioner's FHIR ID
   * @returns {Promise<Array>} Array of patient objects with full data
   */
  async fetchPatientsFromHapiFhir(practitionerId) {
    try {
      // Search for patients with kidney transplant condition and matching practitioner
      const searchUrl = `${HAPI_FHIR_BASE}/Patient?` +
        `_has:Condition:subject:code=http://snomed.info/sct|70536003&` +
        `general-practitioner=Practitioner/${practitionerId}&` +
        `_count=100`;
      
      console.log('Searching patients:', searchUrl);
      
      const response = await fetch(searchUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch patients: ${response.status}`);
      }
      
      const bundle = await response.json();
      
      if (!bundle.entry || bundle.entry.length === 0) {
        console.log('No patients found matching criteria');
        return [];
      }
      
      console.log(`Found ${bundle.entry.length} patients, fetching additional data...`);
      
      // Process each patient and fetch their additional data
      const patientPromises = bundle.entry.map(entry => 
        this.processPatientWithData(entry.resource)
      );
      
      const patients = await Promise.all(patientPromises);
      
      return patients.filter(p => p !== null);
    } catch (error) {
      console.error('Error fetching patients from HAPI FHIR:', error);
      return [];
    }
  }

  /**
   * Process individual patient and fetch all related clinical data
   * @param {Object} fhirPatient - FHIR Patient resource
   * @returns {Promise<Object|null>} Processed patient object or null if error
   */
  async processPatientWithData(fhirPatient) {
    try {
      const patientId = fhirPatient.id;
      
      // Fetch all related data in parallel
      const [observations, medicationRequests, appointments, conditions] = await Promise.all([
        this.fetchObservations(patientId),
        this.fetchMedicationRequests(patientId),
        this.fetchAppointments(patientId),
        this.fetchConditions(patientId)
      ]);
      
      // Calculate age from birthDate
      const age = this.calculateAge(fhirPatient.birthDate);
      
      // Extract patient name
      const name = this.extractPatientName(fhirPatient);
      
      // Get gender
      const gender = fhirPatient.gender || 'unknown';
      
      // Process observations to extract key metrics
      const processedObservations = this.processObservations(observations);
      
      // Calculate risk level based on observations
      const riskLevel = this.calculateRiskLevel(processedObservations);
      
      // Calculate adherence from medication requests and administrations
      const adherenceData = await this.calculateAdherence(patientId, medicationRequests);
      const adherence = adherenceData.adherence7Days; // Use 7-day adherence as main adherence
      const adherenceYesterday = adherenceData.adherenceYesterday;
      const adherence7Days = adherenceData.adherence7Days;
      
      // Get next appointment (pass patient name for debugging)
      const nextVisit = this.getNextAppointment(appointments, name);
      
      // Debug log for appointments
      if (appointments.length > 0 && !nextVisit) {
        console.warn(`⚠️ Patient ${name} has ${appointments.length} appointment(s) but no nextVisit was selected`);
      } else if (appointments.length === 0) {
        console.warn(`⚠️ Patient ${name} has no appointments fetched`);
      } else {
        console.log(`✅ Patient ${name} has nextVisit: ${nextVisit}`);
      }
      
      // Get last activity from observations
      const lastActivity = this.getLastActivity(observations);
      
      // Get kidney transplant date from conditions
      const transplantDate = this.getTransplantDate(conditions);
      
      return {
        id: patientId,
        fhirId: patientId,
        name: name,
        age: age,
        gender: gender,
        riskLevel: riskLevel,
        adherence: adherence,
        adherenceYesterday: adherenceYesterday,
        adherence7Days: adherence7Days,
        nextVisit: nextVisit,
        lastActivity: lastActivity,
        transplantDate: transplantDate,
        
        // Store raw FHIR data
        fhirPatient: fhirPatient,
        observations: observations,
        medicationRequests: medicationRequests,
        appointments: appointments,
        conditions: conditions,
        
        // Processed observation data
        bp: processedObservations.bloodPressure || '-',
        weight: processedObservations.weight || '-',
        temperature: processedObservations.temperature || '-',
        
        // Processed chart data from FHIR observations
        renalData: this.processRenalObservations(observations),
        immunoData: this.processImmunoObservations(observations),
        bpData: this.processBPObservations(observations),
        weightData: this.processWeightObservations(observations),
        
        clinicalEvents: this.extractClinicalEvents(observations, appointments),
        symptoms: this.extractSymptoms(observations),
        medications: this.extractMedications(medicationRequests)
      };
    } catch (error) {
      console.error(`Error processing patient ${fhirPatient.id}:`, error);
      return null;
    }
  }

  /**
   * Fetch all observations for a patient from HAPI FHIR
   * @param {string} patientId - The patient's FHIR ID
   * @returns {Promise<Array>} Array of Observation resources
   */
  async fetchObservations(patientId) {
    try {
      // LOINC codes:
      // Laboratory Tests: 2160-0, 98979-8, 11253-2, 3094-0, 2889-4, 789-8, 6690-2, 1988-5
      // Home Monitoring: 85354-9, 29463-7, 8302-2, 8310-5, 81951-6, 3167-4, 68516-4, 97891-6
      const loincCodes = [
        '2160-0',   // Creatinine
        '98979-8',  // eGFR
        '11253-2',  // Tacrolimus
        '3094-0',   // BUN
        '2889-4',   // Protein [Mass/time] in 24 hour Urine
        '789-8',    // Red Blood Cell (RBC)
        '6690-2',   // White Blood Cells (WBC)
        '1988-5',   // C-Reactive Protein (CRP)
        '85354-9',  // Blood Pressure
        '29463-7',  // Weight
        '8302-2',   // Height
        '8310-5',   // Temperature
        '81951-6',  // 24h Fluid Intake
        '3167-4',   // 24h Urine Output
        '68516-4',  // Physical Activity
        '97891-6'   // Sleep Score
      ];
      
      const maxRetries = 5; // Increased from 3 to 5
      let lastError = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const codeParam = loincCodes.map(code => `http://loinc.org|${code}`).join(',');
          const url = `${HAPI_FHIR_BASE}/Observation?subject=Patient/${patientId}&code=${codeParam}&_count=1000&_sort=-date`;
          
          const response = await fetch(url);
          
          if (!response.ok) {
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
              continue;
            }
            return [];
          }
          
          const bundle = await response.json();
          return bundle.entry ? bundle.entry.map(e => e.resource) : [];
        } catch (error) {
          lastError = error;
          
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          }
        }
      }
      
      console.error(`❌ Failed to fetch observations for patient ${patientId} after ${maxRetries} attempts`);
      return [];
    } catch (error) {
      console.error(`Error fetching observations for patient ${patientId}:`, error);
      return [];
    }
  }

  /**
   * Fetch all medication requests for a patient from HAPI FHIR
   * @param {string} patientId - The patient's FHIR ID
   * @returns {Promise<Array>} Array of MedicationRequest resources
   */
  async fetchMedicationRequests(patientId) {
    const maxRetries = 5;
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const url = `${HAPI_FHIR_BASE}/MedicationRequest?subject=Patient/${patientId}&_count=1000&_sort=-authoredon`;
        const response = await fetch(url);
        
        if (!response.ok) {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            continue;
          }
          console.warn(`Failed to fetch medication requests for patient ${patientId}`);
          return [];
        }
        
        const bundle = await response.json();
        return bundle.entry ? bundle.entry.map(e => e.resource) : [];
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }
    
    console.error(`❌ Failed to fetch medication requests for patient ${patientId} after ${maxRetries} attempts:`, lastError?.message);
    return [];
  }

  /**
   * Fetch all appointments for a patient from HAPI FHIR
   * @param {string} patientId - The patient's FHIR ID
   * @returns {Promise<Array>} Array of Appointment resources
   */
  async fetchAppointments(patientId) {
    const maxRetries = 5; // Increased from 3 to 5
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const url = `${HAPI_FHIR_BASE}/Appointment?patient=Patient/${patientId}&_count=1000&_sort=-date`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          if (attempt < maxRetries) {
            // Exponential backoff: 2s, 4s, 6s, 8s
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            continue;
          }
          return [];
        }
        
        const bundle = await response.json();
        const appointments = bundle.entry ? bundle.entry.map(e => e.resource) : [];
        
        // Log success for debugging
        if (appointments.length > 0) {
          console.log(`✅ Fetched ${appointments.length} appointment(s) for patient ${patientId}`);
        }
        
        return appointments;
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          console.warn(`⚠️ Appointment fetch attempt ${attempt}/${maxRetries} failed for patient ${patientId}, retrying...`);
          // Exponential backoff: 2s, 4s, 6s, 8s
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }
    
    console.error(`❌ Failed to fetch appointments for patient ${patientId} after ${maxRetries} attempts:`, lastError?.message);
    return [];
  }

  /**
   * Fetch all conditions for a patient from HAPI FHIR (specifically kidney transplant)
   * @param {string} patientId - The patient's FHIR ID
   * @returns {Promise<Array>} Array of Condition resources
   */
  async fetchConditions(patientId) {
    const maxRetries = 5; // Increased from 3 to 5
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const url = `${HAPI_FHIR_BASE}/Condition?subject=Patient/${patientId}&code=http://snomed.info/sct|70536003&_count=100`;
        
        const response = await fetch(url);
        
        if (!response.ok) {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
            continue;
          }
          return [];
        }
        
        const bundle = await response.json();
        return bundle.entry ? bundle.entry.map(e => e.resource) : [];
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        }
      }
    }
    
    console.error(`❌ Failed to fetch conditions for patient ${patientId} after ${maxRetries} attempts`);
    return [];
  }

  /**
   * Extract patient name from FHIR Patient resource
   * @param {Object} fhirPatient - FHIR Patient resource
   * @returns {string} Full patient name
   */
  extractPatientName(fhirPatient) {
    if (!fhirPatient.name || fhirPatient.name.length === 0) {
      return 'Unknown Patient';
    }
    
    const name = fhirPatient.name[0];
    const given = name.given ? name.given.join(' ') : '';
    const family = name.family || '';
    
    return `${given} ${family}`.trim() || 'Unknown Patient';
  }

  /**
   * Calculate patient age from birthdate
   * @param {string} birthDate - Birth date in YYYY-MM-DD format
   * @returns {number|null} Age in years
   */
  calculateAge(birthDate) {
    if (!birthDate) return null;
    
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    
    return age;
  }

  /**
   * Process observations into structured data object
   * Extracts medical lab results and home monitoring values
   * @param {Array} observations - Array of FHIR Observation resources
   * @returns {Object} Structured observation data with latest values
   */
  processObservations(observations) {
    const processed = {
      // Laboratory Tests Records
      creatinine: null,        // 2160-0 Creatinine
      eGFR: null,              // 98979-8 eGFR
      tacrolimus: null,        // 11253-2 Tacrolimus
      bun: null,               // 3094-0 BUN
      protein24h: null,        // 2889-4 Protein [Mass/time] in 24 hour Urine
      rbc: null,               // 789-8 Red Blood Cell (RBC)
      wbc: null,               // 6690-2 White Blood Cells (WBC)
      crp: null,               // 1988-5 C-Reactive Protein (CRP)

      // Home Monitoring Records
      bloodPressure: null,     // 85354-9 Blood Pressure
      weight: null,            // 29463-7 Weight
      height: null,            // 8302-2 Height
      temperature: null,       // 8310-5 Temperature
      fluidIntake24h: null,    // 81951-6 24h Fluid Intake
      urineOutput24h: null,    // 3167-4 24h Urine Output
      physicalActivity: null,  // 68516-4 Physical Activity
      sleepScore: null         // 97891-6 Sleep Score
    };
    
    // Get most recent values for each observation type
    for (const obs of observations) {
      if (!obs.code || !obs.code.coding) continue;
      
      const coding = obs.code.coding[0];
      const loincCode = coding.code;
      
      // 醫療檢驗紀錄
      // Creatinine (2160-0)
      if (loincCode === '2160-0' && obs.valueQuantity && !processed.creatinine) {
        processed.creatinine = obs.valueQuantity.value;
      }
      // eGFR (98979-8)
      else if (loincCode === '98979-8' && obs.valueQuantity && !processed.eGFR) {
        processed.eGFR = obs.valueQuantity.value;
      }
      // Tacrolimus (11253-2)
      else if (loincCode === '11253-2' && obs.valueQuantity && !processed.tacrolimus) {
        processed.tacrolimus = obs.valueQuantity.value;
      }
      // BUN (3094-0)
      else if (loincCode === '3094-0' && obs.valueQuantity && !processed.bun) {
        processed.bun = obs.valueQuantity.value;
      }
      // Protein [Mass/time] in 24 hour Urine (2889-4)
      else if (loincCode === '2889-4' && obs.valueQuantity && !processed.protein24h) {
        processed.protein24h = obs.valueQuantity.value;
      }
      // Red Blood Cell (RBC) (789-8)
      else if (loincCode === '789-8' && obs.valueQuantity && !processed.rbc) {
        processed.rbc = obs.valueQuantity.value;
      }
      // White Blood Cells (WBC) (6690-2)
      else if (loincCode === '6690-2' && obs.valueQuantity && !processed.wbc) {
        processed.wbc = obs.valueQuantity.value;
      }
      // C-Reactive Protein (CRP) (1988-5)
      else if (loincCode === '1988-5' && obs.valueQuantity && !processed.crp) {
        processed.crp = obs.valueQuantity.value;
      }
      
      // Home Monitoring Records
      // Blood Pressure (85354-9)
      else if (loincCode === '85354-9' && obs.component && !processed.bloodPressure) {
        const systolic = obs.component.find(c => c.code?.coding?.[0]?.code === '8480-6');
        const diastolic = obs.component.find(c => c.code?.coding?.[0]?.code === '8462-4');
        
        if (systolic?.valueQuantity && diastolic?.valueQuantity) {
          processed.bloodPressure = `${systolic.valueQuantity.value}/${diastolic.valueQuantity.value}`;
        }
      }
      // Weight (29463-7)
      else if (loincCode === '29463-7' && obs.valueQuantity && !processed.weight) {
        processed.weight = `${obs.valueQuantity.value} kg`;
      }
      // Height (8302-2)
      else if (loincCode === '8302-2' && obs.valueQuantity && !processed.height) {
        processed.height = `${obs.valueQuantity.value} cm`;
      }
      // Temperature (8310-5)
      else if (loincCode === '8310-5' && obs.valueQuantity && !processed.temperature) {
        processed.temperature = `${obs.valueQuantity.value} °C`;
      }
      // 24h Fluid Intake (81951-6)
      else if (loincCode === '81951-6' && obs.valueQuantity && !processed.fluidIntake24h) {
        processed.fluidIntake24h = `${obs.valueQuantity.value} mL`;
      }
      // 24h Urine Output (3167-4)
      else if (loincCode === '3167-4' && obs.valueQuantity && !processed.urineOutput24h) {
        processed.urineOutput24h = `${obs.valueQuantity.value} mL`;
      }
      // Physical Activity (68516-4)
      else if (loincCode === '68516-4' && obs.valueQuantity && !processed.physicalActivity) {
        processed.physicalActivity = `${obs.valueQuantity.value} min/week`;
      }
      // Sleep Score (97891-6)
      else if (loincCode === '97891-6' && obs.valueQuantity && !processed.sleepScore) {
        processed.sleepScore = obs.valueQuantity.value;
      }
    }
    
    return processed;
  }

  /**
   * Calculate patient risk level based on clinical observations
   * @param {Object} processedObservations - Processed observation data
   * @returns {string} Risk level: 'high', 'medium', or 'normal'
   */
  calculateRiskLevel(processedObservations) {
    // Simple risk calculation based on eGFR and creatinine
    const eGFR = processedObservations.eGFR;
    const creatinine = processedObservations.creatinine;
    
    if (eGFR && eGFR < 30) return 'high';
    if (creatinine && creatinine > 2.0) return 'high';
    if (eGFR && eGFR < 60) return 'medium';
    if (creatinine && creatinine > 1.5) return 'medium';
    
    return 'normal';
  }

  /**
   * Calculate medication adherence from MedicationAdministration records
   * @param {string} patientId - The patient's FHIR ID
   * @param {Array} medicationRequests - Array of MedicationRequest resources
   * @returns {Promise<Object>} Adherence percentages for yesterday and 7 days
   */
  async calculateAdherence(patientId, medicationRequests) {
    // Calculate adherence based on MedicationAdministration vs MedicationRequest
    if (!medicationRequests || medicationRequests.length === 0) {
      return {
        adherenceYesterday: 0,
        adherence7Days: 0
      };
    }
    
    try {
      // Get the most recent authoredOn date from MedicationRequests
      const sortedRequests = [...medicationRequests].sort((a, b) => {
        const dateA = new Date(a.authoredOn || 0);
        const dateB = new Date(b.authoredOn || 0);
        return dateB - dateA;
      });
      
      const latestDate = sortedRequests[0]?.authoredOn;
      if (!latestDate) {
        return {
          adherenceYesterday: 0,
          adherence7Days: 0
        };
      }
      
      // Filter to only the most recent date's requests
      const latestRequests = medicationRequests.filter(mr => mr.authoredOn === latestDate);
      
      // Count total medication timings that should be taken (from MedicationRequest)
      let totalTimings = 0;
      latestRequests.forEach(mr => {
        const dosageInstructions = mr.dosageInstruction || [];
        dosageInstructions.forEach(dosage => {
          const whenCodes = dosage.timing?.repeat?.when || [];
          const timings = whenCodes.length > 0 ? whenCodes : ['UNSPECIFIED'];
          totalTimings += timings.length;
        });
      });
      
      if (totalTimings === 0) {
        return {
          adherenceYesterday: 0,
          adherence7Days: 0
        };
      }
      
      // Fetch MedicationAdministrations for the last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const adminUrl = `${HAPI_FHIR_BASE}/MedicationAdministration?subject=Patient/${patientId}&_count=1000`;
      const adminResp = await fetch(adminUrl);
      
      if (!adminResp.ok) {
        console.warn(`Failed to fetch MedicationAdministrations for patient ${patientId}`);
        return {
          adherenceYesterday: 0,
          adherence7Days: 0
        };
      }
      
      const adminBundle = await adminResp.json();
      const administrations = adminBundle.entry ? adminBundle.entry.map(e => e.resource) : [];
      
      // Filter to last 7 days
      const recentAdministrations = administrations.filter(ma => {
        if (!ma.effectiveDateTime) return false;
        const adminDate = new Date(ma.effectiveDateTime);
        return adminDate >= sevenDaysAgo;
      });
      
      // Group administrations by date and create composite keys
      const administrationsByDate = new Map();
      const administrationsYesterday = new Map();
      
      // Get yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      recentAdministrations.forEach(ma => {
        const adminDate = ma.effectiveDateTime.split('T')[0]; // YYYY-MM-DD
        
        // Extract timing code from note
        let timingCode = 'UNSPECIFIED';
        if (ma.note && ma.note.length > 0) {
          const noteText = ma.note[0].text || '';
          const match = noteText.match(/timing:(\w+)/);
          if (match) {
            timingCode = match[1];
          }
        }
        
        const requestRef = ma.request?.reference;
        if (requestRef) {
          const medRequestId = requestRef.split('/')[1];
          const compositeKey = `${adminDate}-${medRequestId}-${timingCode}`;
          administrationsByDate.set(compositeKey, true);
          
          // Track yesterday's administrations separately
          if (adminDate === yesterdayStr) {
            const yesterdayKey = `${medRequestId}-${timingCode}`;
            administrationsYesterday.set(yesterdayKey, true);
          }
        }
      });
      
      // Count how many unique medication-timing combinations were taken
      const takenCount7Days = administrationsByDate.size;
      const takenCountYesterday = administrationsYesterday.size;
      
      // Calculate expected counts
      const expectedCount7Days = totalTimings * 7;
      const expectedCountYesterday = totalTimings;
      
      // Calculate adherence percentages
      const adherence7Days = Math.min(100, Math.round((takenCount7Days / expectedCount7Days) * 100));
      const adherenceYesterday = Math.min(100, Math.round((takenCountYesterday / expectedCountYesterday) * 100));
      
      return {
        adherenceYesterday: adherenceYesterday,
        adherence7Days: adherence7Days
      };
    } catch (error) {
      console.error(`Error calculating adherence for patient ${patientId}:`, error);
      return {
        adherenceYesterday: 0,
        adherence7Days: 0
      };
    }
  }

  /**
   * Get the next upcoming appointment from appointments list
   * @param {Array} appointments - Array of Appointment resources
   * @param {string} patientName - Patient name for logging (optional)
   * @returns {string|null} ISO date string of next appointment or null
   */
  getNextAppointment(appointments, patientName = 'Unknown') {
    if (!appointments || appointments.length === 0) {
      return null;
    }
    
    const now = new Date();
    
    // First try to get future appointments
    const futureAppointments = appointments
      .filter(apt => {
        if (!apt.start) {
          return false;
        }
        const aptDate = new Date(apt.start);
        return aptDate >= now;
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start));
    
    if (futureAppointments.length > 0) {
      return futureAppointments[0].start;
    }
    
    // If no future appointments, get the most recent past appointment
    const pastAppointments = appointments
      .filter(apt => {
        if (!apt.start) return false;
        const aptDate = new Date(apt.start);
        return aptDate < now;
      })
      .sort((a, b) => new Date(b.start) - new Date(a.start));
    
    if (pastAppointments.length > 0) {
      return pastAppointments[0].start;
    }
    
    return null;
  }

  /**
   * Get the most recent observation date from observations list
   * @param {Array} observations - Array of Observation resources
   * @returns {string|null} ISO date string of last activity or null
   */
  getLastActivity(observations) {
    if (!observations || observations.length === 0) return null;
    
    // Get the most recent observation date
    const dates = observations
      .map(obs => obs.effectiveDateTime || obs.issued)
      .filter(d => d)
      .sort()
      .reverse();
    
    return dates.length > 0 ? dates[0] : null;
  }

  /**
   * Extract kidney transplant date from conditions
   * @param {Array} conditions - Array of Condition resources
   * @returns {string|null} ISO date string of transplant or null
   */
  getTransplantDate(conditions) {
    if (!conditions || conditions.length === 0) return null;
    
    // Find kidney transplant condition (SNOMED CT 70536003)
    const transplantCondition = conditions.find(condition => {
      if (!condition.code?.coding) return false;
      return condition.code.coding.some(coding => 
        coding.system === 'http://snomed.info/sct' && coding.code === '70536003'
      );
    });
    
    // Return recordedDate if found
    return transplantCondition?.recordedDate || null;
  }

  /**
   * Get Tacrolimus target range based on time since transplant
   * @param {string|null} transplantDate - ISO date string of transplant
   * @returns {Object} Object with targetMin and targetMax values
   */
  getTacrolimusTargetRange(transplantDate) {
    if (!transplantDate) {
      // Default range if no transplant date
      return { targetMin: 5, targetMax: 8 };
    }
    
    const transplant = new Date(transplantDate);
    const today = new Date();
    const monthsDiff = (today.getFullYear() - transplant.getFullYear()) * 12 + 
                       (today.getMonth() - transplant.getMonth());
    
    // Defined the target range by months since transplant
    if (monthsDiff <= 1) {
      // post-transplant 0-1 month
      return { targetMin: 8, targetMax: 12 };
    } else if (monthsDiff <= 3) {
      // post-transplant 2-3 months
      return { targetMin: 7, targetMax: 10 };
    } else if (monthsDiff <= 12) {
      // post-transplant 4-12 months
      return { targetMin: 5, targetMax: 8 };
    } else {
      // post-transplant over 1 year
      return { targetMin: 4, targetMax: 6 };
    }
  }

  /**
   * Get the most recent Tacrolimus observation with target range
   * @param {Array} observations - Array of Observation resources
   * @param {string|null} transplantDate - ISO date string of transplant (optional)
   * @returns {Object|null} Object with value, date, targetMin, targetMax or null
   */
  getLatestTacrolimus(observations, transplantDate = null) {
    if (!observations || observations.length === 0) return null;
    
    const now = new Date();
    
    // Filter and sort Tacrolimus observations (LOINC 11253-2) from today backwards
    const tacObservations = observations
      .filter(obs => {
        if (!obs.code?.coding || !obs.valueQuantity) return false;
        const loincCode = obs.code.coding[0]?.code;
        return loincCode === '11253-2';
      })
      .sort((a, b) => {
        const dateA = new Date(a.effectiveDateTime || a.issued);
        const dateB = new Date(b.effectiveDateTime || b.issued);
        return dateB - dateA; // Sort descending (most recent first)
      });
    
    // Return the most recent Tacrolimus value with dynamic target range
    if (tacObservations.length > 0) {
      const targetRange = this.getTacrolimusTargetRange(transplantDate);
      return {
        value: tacObservations[0].valueQuantity.value,
        date: tacObservations[0].effectiveDateTime || tacObservations[0].issued,
        targetMin: targetRange.targetMin,
        targetMax: targetRange.targetMax
      };
    }
    
    return null;
  }

  /**
   * Process renal observations for chart display (last 90 days)
   * Extracts Cr, eGFR, BUN, Tacrolimus, Protein, RBC, WBC, CRP
   * @param {Array} observations - Array of Observation resources
   * @returns {Array} Array of data points for renal charts
   */
  processRenalObservations(observations) {
    // Extract renal-related observations and format for charts
    // Creatinine (2160-0), eGFR (98979-8), BUN (3094-0), Tacrolimus (11253-2), Protein (2889-4), RBC (789-8), WBC (6690-2), CRP (1988-5)
    const renalData = [];
    const dataMap = new Map();
    
    for (const obs of observations) {
      if (!obs.code?.coding || !obs.effectiveDateTime) continue;
      
      const loincCode = obs.code.coding[0]?.code;
      const date = obs.effectiveDateTime.split('T')[0];
      
      if (!dataMap.has(date)) {
        dataMap.set(date, { date });
      }
      
      const entry = dataMap.get(date);
      
      // Map LOINC codes to data fields
      if (loincCode === '2160-0' && obs.valueQuantity) {
        // Creatinine
        entry.Cr = obs.valueQuantity.value.toFixed(1);
      } else if (loincCode === '98979-8' && obs.valueQuantity) {
        // eGFR
        entry.eGFR = Math.floor(obs.valueQuantity.value).toString();
      } else if (loincCode === '3094-0' && obs.valueQuantity) {
        // BUN
        entry.BUN = Math.floor(obs.valueQuantity.value).toString();
      } else if (loincCode === '11253-2' && obs.valueQuantity) {
        // Tacrolimus
        entry.Tac = obs.valueQuantity.value.toFixed(1);
      } else if (loincCode === '2889-4' && obs.valueQuantity) {
        // Protein [Mass/time] in 24 hour Urine
        entry.Protein = obs.valueQuantity.value.toFixed(1);
      } else if (loincCode === '789-8' && obs.valueQuantity) {
        // Red Blood Cell (RBC)
        entry.RBC = obs.valueQuantity.value.toFixed(1);
      } else if (loincCode === '6690-2' && obs.valueQuantity) {
        // White Blood Cells (WBC)
        entry.WBC = obs.valueQuantity.value.toFixed(1);
      } else if (loincCode === '1988-5' && obs.valueQuantity) {
        // C-Reactive Protein (CRP)
        entry.CRP = obs.valueQuantity.value.toFixed(1);
      }
    }
    
    // Convert map to sorted array
    // Keep data from last 90 days (3 months)
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setDate(today.getDate() - 90);
    
    const sortedData = Array.from(dataMap.values())
      .filter(d => new Date(d.date) >= threeMonthsAgo)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    return sortedData.length > 0 ? sortedData : generateFallbackRenalData();
  }

  /**
   * Process immunosuppressant observations for chart display (last 90 days)
   * Extracts Tacrolimus levels with target range
   * @param {Array} observations - Array of Observation resources
   * @returns {Array} Array of data points for immunosuppressant charts
   */
  processImmunoObservations(observations) {
    // Extract tacrolimus levels
    const immunoData = [];
    
    for (const obs of observations) {
      if (!obs.code?.coding || !obs.effectiveDateTime) continue;
      
      const loincCode = obs.code.coding[0]?.code;
      
      // Tacrolimus (11253-2)
      if (loincCode === '11253-2' && obs.valueQuantity) {
        immunoData.push({
          date: obs.effectiveDateTime.split('T')[0],
          Tac: obs.valueQuantity.value.toFixed(1),
          targetMin: 5,
          targetMax: 8
        });
      }
    }
    
    // Sort and return data from last 90 days (3 months)
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setDate(today.getDate() - 90);
    
    const sortedData = immunoData
      .filter(d => new Date(d.date) >= threeMonthsAgo)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    return sortedData.length > 0 ? sortedData : generateFallbackImmunoData();
  }

  /**
   * Process blood pressure observations for chart display (last 14 days)
   * Extracts systolic and diastolic values
   * @param {Array} observations - Array of Observation resources
   * @returns {Array} Array of data points for blood pressure charts
   */
  processBPObservations(observations) {
    // Extract blood pressure readings
    const bpData = [];
    
    for (const obs of observations) {
      if (!obs.code?.coding || !obs.effectiveDateTime) continue;
      
      const loincCode = obs.code.coding[0]?.code;
      
      // Blood Pressure (85354-9)
      if (loincCode === '85354-9' && obs.component) {
        const systolic = obs.component.find(c => c.code?.coding?.[0]?.code === '8480-6');
        const diastolic = obs.component.find(c => c.code?.coding?.[0]?.code === '8462-4');
        
        if (systolic?.valueQuantity && diastolic?.valueQuantity) {
          bpData.push({
            date: obs.effectiveDateTime.split('T')[0],
            systolic: Math.floor(systolic.valueQuantity.value).toString(),
            diastolic: Math.floor(diastolic.valueQuantity.value).toString()
          });
        }
      }
    }
    
    // Sort and return most recent 14 data points
    const sortedData = bpData
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(-14);
    
    return sortedData.length > 0 ? sortedData : generateFallbackBPData();
  }

  /**
   * Process weight observations for chart display (last 14 days)
   * @param {Array} observations - Array of Observation resources
   * @returns {Array} Array of data points for weight charts
   */
  processWeightObservations(observations) {
    // Extract weight measurements
    const weightData = [];
    
    for (const obs of observations) {
      if (!obs.code?.coding || !obs.effectiveDateTime) continue;
      
      const loincCode = obs.code.coding[0]?.code;
      
      // Weight (29463-7)
      if (loincCode === '29463-7' && obs.valueQuantity) {
        weightData.push({
          date: obs.effectiveDateTime.split('T')[0],
          weight: obs.valueQuantity.value.toFixed(1)
        });
      }
    }
    
    // Sort and return data from last 14 days
    const today = new Date();
    const fourteenDaysAgo = new Date(today);
    fourteenDaysAgo.setDate(today.getDate() - 14);
    
    const sortedData = weightData
      .filter(d => new Date(d.date) >= fourteenDaysAgo)
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    return sortedData.length > 0 ? sortedData : generateFallbackWeightData();
  }

  /**
   * Extract clinical events from observations and appointments
   * @param {Array} observations - Array of Observation resources
   * @param {Array} appointments - Array of Appointment resources
   * @returns {Array} Array of clinical event objects (top 3 most recent)
   */
  extractClinicalEvents(observations, appointments) {
    const events = [];
    
    // Add appointments as clinical events
    if (appointments) {
      for (const apt of appointments) {
        if (apt.start && apt.status) {
          events.push({
            date: apt.start.split('T')[0],
            type: apt.appointmentType?.text || 'Appointment',
            note: apt.description || apt.status
          });
        }
      }
    }
    
    // Sort by date (most recent first) and return top 3
    return events
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 3);
  }

  /**
   * Extract symptoms from observations
   * @param {Array} observations - Array of Observation resources
   * @returns {Array} Array of symptom objects (currently not implemented)
   */
  extractSymptoms(observations) {
    // Look for observations that might indicate symptoms
    const symptoms = [];
    
    // This would require specific LOINC codes for symptoms
    // For now, return empty array
    return symptoms;
  }

  /**
   * Extract medication information from medication requests
   * Focuses on MMF and Prednisolone with current and previous dosages
   * @param {Array} medicationRequests - Array of MedicationRequest resources
   * @returns {Object} Object containing mmf and pred medication details
   */
  extractMedications(medicationRequests) {
    const medications = {
      mmf: { current: null, previous: null, changed: null },
      pred: { current: null, previous: null, changed: null }
    };
    
    if (!medicationRequests || medicationRequests.length === 0) {
      return medications;
    }
    
    // Sort by authoredOn (newest first)
    const sortedRequests = [...medicationRequests].sort((a, b) => {
      const dateA = a.authoredOn ? new Date(a.authoredOn) : new Date(0);
      const dateB = b.authoredOn ? new Date(b.authoredOn) : new Date(0);
      return dateB - dateA;
    });
    
    // Find latest MMF and Prednisolone medications
    for (const mr of sortedRequests) {
      const medName = mr.medicationCodeableConcept?.text || 
                      mr.medicationCodeableConcept?.coding?.[0]?.display || '';
      
      // Get dosage from doseAndRate
      let dosageText = '';
      if (mr.dosageInstruction && mr.dosageInstruction.length > 0) {
        const dosageInst = mr.dosageInstruction[0];
        
        if (dosageInst.doseAndRate && dosageInst.doseAndRate.length > 0) {
          const doseQuantity = dosageInst.doseAndRate[0].doseQuantity;
          if (doseQuantity) {
            const value = doseQuantity.value || '';
            const unit = doseQuantity.unit || '';
            dosageText = `${medName} * ${value} ${unit}`;
          }
        }
        
        // Fallback to text if doseAndRate is not available
        if (!dosageText && dosageInst.text) {
          dosageText = `${medName} ${dosageInst.text}`;
        }
      }
      
      // If still no dosage text, just show medication name
      if (!dosageText) {
        dosageText = medName || 'Unknown medication';
      }
      
      // Categorize medication
      if ((medName.toLowerCase().includes('mycophenolate') || medName.toLowerCase().includes('mmf')) 
          && !medications.mmf.current) {
        medications.mmf.current = dosageText;
      } else if ((medName.toLowerCase().includes('prednisone') || medName.toLowerCase().includes('prednisolone') || medName.toLowerCase().includes('pred')) 
                 && !medications.pred.current) {
        medications.pred.current = dosageText;
      }
      
      // Stop if we found both medications
      if (medications.mmf.current && medications.pred.current) {
        break;
      }
    }
    
    return medications;
  }

  /**
   * Update dashboard statistics display
   * Shows total patients and risk level counts
   */
  updateStatistics() {
    const total = this.patients.length;
    const high = this.patients.filter(p => p.riskLevel === 'high').length;
    const medium = this.patients.filter(p => p.riskLevel === 'medium').length;
    const normal = this.patients.filter(p => p.riskLevel === 'normal').length;

    document.getElementById('totalCount').textContent = total;
    document.getElementById('highRiskCount').textContent = high;
    document.getElementById('mediumRiskCount').textContent = medium;
    document.getElementById('normalCount').textContent = normal;
  }

  /**
   * Render upcoming appointments list
   * Sorts by date and displays next 3 or all based on toggle
   */
  renderAppointments() {
    const container = document.getElementById('nextApptList');
    if (!container) return;
    
    // Debug: Check all patients and their appointment data
    const patientsWithAppointments = this.patients.filter(p => p.nextVisit);
    const patientsWithoutAppointments = this.patients.filter(p => !p.nextVisit);
    
    console.log(`📊 Appointment Summary: ${patientsWithAppointments.length}/${this.patients.length} patients have appointments`);
    
    if (patientsWithoutAppointments.length > 0) {
      console.warn(`⚠️ Patients missing appointments:`, patientsWithoutAppointments.map(p => ({
        name: p.name,
        id: p.id,
        appointmentsCount: p.appointments?.length || 0
      })));
    }
    
    const appointments = this.patients
      .filter(p => {
        if (!p.nextVisit) {
          return false;
        }
        return true;
      })
      .sort((a, b) => new Date(a.nextVisit) - new Date(b.nextVisit))
      .slice(0, this.showAllAppointments ? undefined : 3);

    if (appointments.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-500">No upcoming appointments</p>';
      return;
    }

    console.log(`✅ Rendering ${appointments.length} appointment(s)`);

    container.innerHTML = appointments.map(p => {
      const date = new Date(p.nextVisit);
      return `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 cursor-pointer" onclick="window.dashboard.selectPatient('${p.id}')">
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 rounded-full ${this.getGenderBgColor(p.gender)} flex items-center justify-center">
              ${this.getGenderIcon(p.gender)}
            </div>
            <div>
              <p class="font-medium text-sm">${p.name}</p>
            </div>
            <div>
              <p class="text-xs text-gray-500">${date.toLocaleDateString('en-AU', {year: 'numeric', month: 'short', day: 'numeric' })} at ${date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
          </div>
          <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
          </svg>
        </div>
      `;
    }).join('');
  }

  /**
   * Switch between attention categories (All/High Risk/Medium Risk/Normal)
   * @param {string} category - Category to filter by
   */
  switchAttentionCategory(category) {
    this.currentAttentionCategory = category;

    document.querySelectorAll('.attention-tab').forEach(tab => {
      if (tab.dataset.category === category) {
        tab.className = 'attention-tab px-4 py-2 text-sm font-medium border-b-2 border-blue-600 text-blue-600';
      } else {
        tab.className = 'attention-tab px-4 py-2 text-sm font-medium border-b-2 border-transparent text-gray-600 hover:text-blue-600';
      }
    });

    this.renderPatientList();
  }

  /**
   * Handle patient search query
   * Filters patients by name or ID
   * @param {string} query - Search query string
   */
  handleSearch(query) {
    if (!query.trim()) {
      this.filteredPatients = [...this.patients];
    } else {
      const q = query.toLowerCase();
      this.filteredPatients = this.patients.filter(p =>
        p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
      );
    }
    this.renderPatientList();
  }

  /**
   * Render the filtered patient list with risk levels and adherence
   */
  renderPatientList() {
    const container = document.getElementById('patientListItems');
    if (!container) return;

    let patientsToShow = this.filteredPatients;
    if (this.currentAttentionCategory !== 'total') {
      patientsToShow = patientsToShow.filter(p => p.riskLevel === this.currentAttentionCategory);
    }

    if (patientsToShow.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">No patients found</p>';
      return;
    }

    container.innerHTML = patientsToShow.map(p => `
      <div class="flex items-center py-3 border-b hover:bg-gray-50 cursor-pointer" onclick="window.dashboard.selectPatient('${p.id}')">
        <div class="w-56 flex items-center">
          <div class="w-10 h-10 flex-shrink-0 rounded-full ${this.getGenderBgColor(p.gender)} flex items-center justify-center mr-3">
            ${this.getGenderIcon(p.gender)}
          </div>
          <div class="min-w-0">
            <p class="font-medium text-sm">${p.name}</p>
            <!-- <p class="text-xs text-gray-500 truncate">ID: ${p.id}</p> -->
          </div>
        </div>
        <div class="w-28 flex justify-center">
          <span class="inline-flex px-2 py-1 text-xs rounded ${this.getRiskBadgeClass(p.riskLevel)}">${this.capitalize(p.riskLevel)}</span>
        </div>
        <div class="flex-1 flex items-center justify-start space-x-3 pl-4">
          <div class="flex flex-col items-center">
            <div class="relative w-12 h-12">
              <svg class="transform -rotate-90 w-12 h-12">
                <circle cx="24" cy="24" r="20" stroke="#e5e7eb" stroke-width="4" fill="none" />
                <circle cx="24" cy="24" r="20" stroke="${this.getAdherenceStrokeColor(p.adherenceYesterday || 0)}" stroke-width="4" fill="none" 
                  stroke-dasharray="${2 * Math.PI * 20}" 
                  stroke-dashoffset="${2 * Math.PI * 20 * (1 - (p.adherenceYesterday || 0) / 100)}" 
                  stroke-linecap="round" />
              </svg>
              <div class="absolute inset-0 flex items-center justify-center">
                <span class="text-xs font-medium">${p.adherenceYesterday || 0}%</span>
              </div>
            </div>
            <span class="text-xs text-gray-500 mt-1">Yesterday</span>
          </div>
          <div class="flex flex-col items-center">
            <div class="relative w-12 h-12">
              <svg class="transform -rotate-90 w-12 h-12">
                <circle cx="24" cy="24" r="20" stroke="#e5e7eb" stroke-width="4" fill="none" />
                <circle cx="24" cy="24" r="20" stroke="${this.getAdherenceStrokeColor(p.adherence7Days || 0)}" stroke-width="4" fill="none" 
                  stroke-dasharray="${2 * Math.PI * 20}" 
                  stroke-dashoffset="${2 * Math.PI * 20 * (1 - (p.adherence7Days || 0) / 100)}" 
                  stroke-linecap="round" />
              </svg>
              <div class="absolute inset-0 flex items-center justify-center">
                <span class="text-xs font-medium">${p.adherence7Days || 0}%</span>
              </div>
            </div>
            <span class="text-xs text-gray-500 mt-1">7 Days</span>
          </div>
        </div>
        <div class="w-24 text-right">
          <svg class="w-5 h-5 text-gray-400 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
          </svg>
        </div>
      </div>
    `).join('');
  }

  /**
   * Select a patient and show their overview
   * @param {string} patientId - Patient's FHIR ID
   */
  selectPatient(patientId) {
    const patient = this.patients.find(p => p.id === patientId);
    if (!patient) return;

    this.selectedPatient = patient;
    this.showPatientOverview(patient);
  }

  /**
   * Display patient overview card with all clinical data
   * @param {Object} p - Patient object
   */
  showPatientOverview(p) {
    const card = document.getElementById('selectedPatientCard');
    if (!card) return;

    card.classList.remove('hidden');

    document.getElementById('pdName').textContent = p.name;
    // document.getElementById('pdId').textContent = p.id;
    
    // Update adherence pie charts
    this.updateAdherencePieChart('pdAdherenceYesterday', p.adherenceYesterday || 0);
    this.updateAdherencePieChart('pdAdherence7Days', p.adherence7Days || 0);
    
    document.getElementById('pdBloodPressure').textContent = p.bp || '_';
    document.getElementById('pdWeight').textContent = p.weight || '_';
    document.getElementById('pdTemperature').textContent = p.temperature || '_';

    const riskEl = document.getElementById('pdRisk');
    riskEl.textContent = this.capitalize(p.riskLevel);
    riskEl.className = `inline-flex items-center px-2 py-0.5 rounded text-xs ${this.getRiskBadgeClass(p.riskLevel)}`;

    if (p.nextVisit) {
      const date = new Date(p.nextVisit);
      const nextVisit = document.getElementById('pdNextVisit');
      nextVisit.innerHTML = `${date.toLocaleDateString('en-AU', {
        month: 'short', day: 'numeric', year: 'numeric'
      })}<br>${date.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}`;
    } else {
      document.getElementById('pdNextVisit').textContent = '_';
    }

    this.renderSummaryTab(p);
    this.renderRenalTrendsTab(p);
    this.renderMedicationsTab(p);
    this.renderClinicalEventsTab(p);
    this.renderSelfReportsTab(p);

    this.switchClinicalTab('summary');
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Hide the selected patient overview card
   */
  hideSelectedPatient() {
    document.getElementById('selectedPatientCard')?.classList.add('hidden');
    this.selectedPatient = null;
  }

  /**
   * Switch between clinical data tabs (summary/renal/medications/etc)
   * @param {string} tabName - Tab name to switch to
   */
  switchClinicalTab(tabName) {
    document.querySelectorAll('.clinical-tab').forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.className = 'clinical-tab px-4 py-2 border-b-2 -mb-px border-blue-600 text-blue-600 whitespace-nowrap';
      } else {
        btn.className = 'clinical-tab px-4 py-2 text-gray-600 hover:text-blue-600 whitespace-nowrap';
      }
    });

    document.querySelectorAll('.clinical-tab-content').forEach(content => {
      content.classList.add('hidden');
    });
    document.getElementById(`tab-${tabName}`)?.classList.remove('hidden');
  }

  /**
   * Render Summary tab with eGFR chart, Tacrolimus levels, and alerts
   * @param {Object} p - Patient object
   */
  renderSummaryTab(p) {
    const rawRenalData = p.renalData || generateFallbackRenalData();
    // Fill missing dates to show complete 90-day range on X-axis
    const renalData = fillMissingDates(rawRenalData, 90);
    const labels = renalData.map(d => new Date(d.date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }));
    const eGFRValues = renalData.map(d => d.eGFR ? parseFloat(d.eGFR) : null);

    createLineChart('summaryRenalChart', {
      showLegend: false,
      data: {
        labels: labels,
        datasets: [{
          label: 'eGFR',
          data: eGFRValues,
          borderColor: '#2563eb',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          tension: 0.4,
          fill: true,
          spanGaps: true
        }]
      },
      options: {
        scales: {
          y: {
            title: { 
              display: true, 
              text: 'eGFR (mL/min)',
              padding: { top: 0, bottom: 0 }
            }
          }
        }
      }
    });

    // Get latest Tacrolimus value from observations with dynamic target range
    const latestTac = this.getLatestTacrolimus(p.observations, p.transplantDate);
    
    let tacValue, tacDate, targetMin, targetMax, inRange;
    
    if (latestTac) {
      // Use real data from FHIR
      tacValue = latestTac.value;
      tacDate = new Date(latestTac.date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' });
      targetMin = latestTac.targetMin;
      targetMax = latestTac.targetMax;
      inRange = tacValue >= targetMin && tacValue <= targetMax;
    } else {
      // Fallback to placeholder data
      const immunoData = p.immunoData || generateFallbackImmunoData();
      const latestImmuno = immunoData[immunoData.length - 1];
      tacValue = parseFloat(latestImmuno.Tac);
      tacDate = new Date(latestImmuno.date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric', year: 'numeric' });
      targetMin = latestImmuno.targetMin;
      targetMax = latestImmuno.targetMax;
      inRange = tacValue >= targetMin && tacValue <= targetMax;
    }

    document.getElementById('summaryImmunoRange').innerHTML = `
      <div class="flex items-center justify-between mb-2">
        <span class="text-sm text-gray-600">Tacrolimus (Latest: ${tacDate})</span>
        <span class="text-sm font-semibold ${inRange ? 'text-green-600' : 'text-red-600'}">${tacValue.toFixed(1)} ng/mL</span>
      </div>
      <div class="relative h-8 bg-gray-200 rounded">
        <div class="absolute h-full bg-green-100" style="left: ${(targetMin / 12) * 100}%; width: ${((targetMax - targetMin) / 12) * 100}%"></div>
        <div class="absolute h-full w-1 bg-blue-600 rounded" style="left: ${(tacValue / 12) * 100}%"></div>
        <div class="absolute top-10 text-xs text-gray-500 flex justify-between w-full px-1">
          <span>0</span>
          <span class="text-green-600">${targetMin}-${targetMax}</span>
          <span>12</span>
        </div>
      </div>
    `;

    const alerts = [];
    if (p.riskLevel === 'high') {
      alerts.push({ type: 'danger', text: 'High risk patient - requires close monitoring' });
    }
    if (!inRange) {
      alerts.push({ type: 'warning', text: `Tacrolimus level ${tacValue < targetMin ? 'below' : 'above'} therapeutic range` });
    }
    if (p.adherence < 60) {
      alerts.push({ type: 'warning', text: 'Low medication adherence detected' });
    }

    const alertsHTML = alerts.length > 0 ? alerts.map(a => `
      <div class="flex items-start space-x-2 p-3 rounded-lg ${a.type === 'danger' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}">
        <svg class="w-5 h-5 ${a.type === 'danger' ? 'text-red-600' : 'text-yellow-600'} flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
        <span class="text-sm ${a.type === 'danger' ? 'text-red-800' : 'text-yellow-800'}">${a.text}</span>
      </div>
    `).join('') : '<p class="text-sm text-gray-500 text-center py-2">No alerts</p>';

    document.getElementById('summaryAlerts').innerHTML = alertsHTML;

    // const adherence = p.adherence || 0;
    // document.getElementById('summaryAdherenceBar').style.width = adherence + '%';
    // document.getElementById('summaryAdherenceBar').className = `h-3 rounded-full transition-all ${this.getAdherenceColor(adherence)}`;
    // document.getElementById('summaryAdherenceText').textContent = adherence + '%';
  }

  /**
   * Render Renal Trends tab with charts for blood tests and urine tests
   * @param {Object} p - Patient object
   */
  renderRenalTrendsTab(p) {
    if (!p) p = this.selectedPatient;
    if (!p) return;

    const rawData = p.renalData || generateFallbackRenalData();
    // Fill missing dates to show complete 90-day range on X-axis
    const data = fillMissingDates(rawData, 90);
    const labels = data.map(d => new Date(d.date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }));

    if (this.renalViewMode === 'blood') {
      createLineChart('renalTrendsChart', {
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Creatinine',
              data: data.map(d => d.Cr ? parseFloat(d.Cr) : null),
              borderColor: '#2563eb',
              backgroundColor: 'rgba(37, 99, 235, 0.1)',
              yAxisID: 'y',
              spanGaps: true
            },
            {
              label: 'eGFR',
              data: data.map(d => d.eGFR ? parseFloat(d.eGFR) : null),
              borderColor: '#16a34a',
              backgroundColor: 'rgba(22, 163, 74, 0.1)',
              yAxisID: 'y1',
              spanGaps: true
            },
            {
              label: 'BUN',
              data: data.map(d => d.BUN ? parseFloat(d.BUN) : null),
              borderColor: '#dc2626',
              backgroundColor: 'rgba(220, 38, 38, 0.1)',
              yAxisID: 'y',
              spanGaps: true
            }
          ]
        },
        options: {
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              title: { display: true, text: 'Cr / BUN (mg/dL)' }
            },
            y1: {
              type: 'linear',
              position: 'right',
              title: { 
                display: true, 
                text: 'eGFR (mL/min)',
                padding: { top: 0, bottom: 0 }
              },
              grid: { drawOnChartArea: false }
            }
          }
        }
      });
    } else {
      createLineChart('renalTrendsChart', {
        data: {
          labels: labels,
          datasets: [
            {
              label: 'Protein',
              data: data.map(d => d.Protein ? parseFloat(d.Protein) : null),
              borderColor: '#2563eb',
              backgroundColor: 'rgba(37, 99, 235, 0.1)',
              spanGaps: true,
              yAxisID: 'y'
            },
            {
              label: 'RBC',
              data: data.map(d => d.RBC ? parseFloat(d.RBC) : null),
              borderColor: '#dc2626',
              backgroundColor: 'rgba(220, 38, 38, 0.1)',
              spanGaps: true,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          scales: {
            y: {
              type: 'linear',
              position: 'left',
              title: { 
                display: true, 
                text: 'Protein (mg/24h)',
                padding: { top: 0, bottom: 0 }
              }
            },
            y1: {
              type: 'linear',
              position: 'right',
              title: { 
                display: true, 
                text: 'RBC (10⁶/μL)',
                padding: { top: 0, bottom: 0 }
              },
              grid: { drawOnChartArea: false }
            }
          }
        }
      });
    }

    createLineChart('activityChart', {
      data: {
        labels: labels,
        datasets: [
          {
            label: 'CRP',
            data: data.map(d => d.CRP ? parseFloat(d.CRP) : null),
            borderColor: '#eab308',
            backgroundColor: 'rgba(234, 179, 8, 0.1)',
            yAxisID: 'y',
            spanGaps: true
          },
          {
            label: 'WBC',
            data: data.map(d => d.WBC ? parseFloat(d.WBC) : null),
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            yAxisID: 'y1',
            spanGaps: true
          }
        ]
      },
      options: {
        scales: {
          y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: 'CRP (mg/L)' }
          },
          y1: {
            type: 'linear',
            position: 'right',
            title: { display: true, text: 'WBC (cells/μL)' },
            grid: { drawOnChartArea: false }
          }
        }
      }
    });
  }

  /**
   * Render Medications tab with Tacrolimus trough levels chart
   * @param {Object} p - Patient object
   */
  renderMedicationsTab(p) {
    const rawImmunoData = p.immunoData || generateFallbackImmunoData();
    // Fill missing dates to show complete 90-day range on X-axis
    const immunoData = fillMissingDates(rawImmunoData, 90);
    const labels = immunoData.map(d => new Date(d.date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }));

    createLineChart('immunoLevelsChart', {
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Tacrolimus Level',
            data: immunoData.map(d => d.Tac ? parseFloat(d.Tac) : null),
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            tension: 0.4,
            spanGaps: true
          },
          {
            label: 'Target Min',
            data: immunoData.map(d => d.targetMin || 5),
            borderColor: '#16a34a',
            borderDash: [5, 5],
            pointRadius: 0
          },
          {
            label: 'Target Max',
            data: immunoData.map(d => d.targetMax || 8),
            borderColor: '#16a34a',
            borderDash: [5, 5],
            pointRadius: 0
          }
        ]
      },
      options: {
        scales: {
          y: {
            title: { display: true, text: 'Tacrolimus (ng/mL)' }
          }
        }
      }
    });

    const mmf = p.medications?.mmf || { current: 'Not prescribed' };
    document.getElementById('mmfDosage').innerHTML = `
      <p class="font-semibold text-blue-600">${mmf.current}</p>
      ${mmf.previous && mmf.changed ? `
        <p class="text-xs text-gray-500 mt-1">Previous: ${mmf.previous}</p>
        <p class="text-xs text-gray-500">Changed: ${new Date(mmf.changed).toLocaleDateString('en-AU')}</p>
      ` : ''}
    `;

    const pred = p.medications?.pred || { current: 'Not prescribed' };
    document.getElementById('predDosage').innerHTML = `
      <p class="font-semibold text-blue-600">${pred.current}</p>
      ${pred.previous && pred.changed ? `
        <p class="text-xs text-gray-500 mt-1">Previous: ${pred.previous}</p>
        <p class="text-xs text-gray-500">Changed: ${new Date(pred.changed).toLocaleDateString('en-AU')}</p>
      ` : ''}
    `;
  }

  /**
   * Render Clinical Events tab with timeline of events
   * @param {Object} p - Patient object
   */
  renderClinicalEventsTab(p) {
    const events = p.clinicalEvents || [];
    const container = document.getElementById('clinicalTimeline');

    if (events.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-500">No clinical events recorded</p>';
      return;
    }

    container.innerHTML = events.map((e, index) => `
      <div class="flex items-start space-x-4">
        <div class="flex flex-col items-center">
          <div class="w-3 h-3 rounded-full ${index === 0 ? 'bg-blue-600' : 'bg-gray-400'}"></div>
          ${index < events.length - 1 ? '<div class="w-px h-full bg-gray-300 my-1"></div>' : ''}
        </div>
        <div class="flex-1 pb-4">
          <div class="flex items-center justify-between mb-1">
            <span class="font-semibold text-sm">${e.type}</span>
            <span class="text-xs text-gray-500">${new Date(e.date).toLocaleDateString('en-AU')}</span>
          </div>
          <p class="text-sm text-gray-600">${e.note}</p>
        </div>
      </div>
    `).join('');
  }

  /**
   * Render Self Reports tab with BP trend, weight curve, and symptoms
   * @param {Object} p - Patient object
   */
  renderSelfReportsTab(p) {
    const rawBpData = p.bpData || generateFallbackBPData();
    // Blood pressure shows last 14 days
    const bpData = fillMissingDates(rawBpData, 14);
    const bpLabels = bpData.map(d => new Date(d.date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }));

    createLineChart('bpTrendChart', {
      data: {
        labels: bpLabels,
        datasets: [
          {
            label: 'Systolic',
            data: bpData.map(d => d.systolic ? parseFloat(d.systolic) : null),
            borderColor: '#dc2626',
            backgroundColor: 'rgba(220, 38, 38, 0.1)',
            spanGaps: true
          },
          {
            label: 'Diastolic',
            data: bpData.map(d => d.diastolic ? parseFloat(d.diastolic) : null),
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.1)',
            spanGaps: true
          }
        ]
      },
      options: {
        scales: {
          y: {
            title: { display: true, text: 'Blood Pressure (mmHg)' }
          }
        }
      }
    });

    const rawWeightData = p.weightData || generateFallbackWeightData();
    // Weight curve shows last 14 days
    const weightData = fillMissingDates(rawWeightData, 14);
    const weightLabels = weightData.map(d => new Date(d.date).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }));

    createLineChart('weightCurveChart', {
      showLegend: false,
      data: {
        labels: weightLabels,
        datasets: [{
          label: 'Weight (kg)',
          data: weightData.map(d => d.weight ? parseFloat(d.weight) : null),
          borderColor: '#059669',
          backgroundColor: 'rgba(5, 150, 105, 0.1)',
          tension: 0.4,
          spanGaps: true
        }]
      },
      options: {
        scales: {
          y: {
            title: { display: true, text: 'Weight (kg)' }
          }
        }
      }
    });

    const symptoms = p.symptoms || [];
    if (symptoms.length === 0) {
      document.getElementById('symptomsList').innerHTML = '<p class="text-sm text-gray-500">No symptoms reported</p>';
    } else {
      document.getElementById('symptomsList').innerHTML = symptoms.map(s => `
        <div class="flex items-start space-x-2 p-2 bg-gray-50 rounded">
          <span class="text-xs text-gray-500 w-20">${new Date(s.date).toLocaleDateString('en-AU')}</span>
          <span class="text-sm">${s.text}</span>
        </div>
      `).join('');
    }
  }

  /**
   * Get CSS class for risk level badge
   * @param {string} level - Risk level (high/medium/normal)
   * @returns {string} Tailwind CSS classes for badge styling
   */
  getRiskBadgeClass(level) {
    const classes = {
      high: 'bg-red-100 text-red-700',
      medium: 'bg-yellow-100 text-yellow-700',
      normal: 'bg-green-100 text-green-700'
    };
    return classes[level] || 'bg-gray-100 text-gray-700';
  }

  /**
   * Get background color class based on adherence percentage
   * @param {number} adherence - Adherence percentage (0-100)
   * @returns {string} Tailwind CSS background color class
   */
  getAdherenceColor(adherence) {
    if (adherence >= 80) return 'bg-green-600';
    if (adherence >= 60) return 'bg-yellow-500';
    return 'bg-red-600';
  }

  /**
   * Get stroke color for adherence progress circles
   * @param {number} adherence - Adherence percentage (0-100)
   * @returns {string} Hex color code for circle stroke
   */
  getAdherenceStrokeColor(adherence) {
    if (adherence >= 80) return '#16a34a'; // green-600
    if (adherence >= 60) return '#eab308'; // yellow-500
    return '#dc2626'; // red-600
  }

  /**
   * Update adherence pie chart SVG with new percentage
   * @param {string} svgId - ID of the SVG element
   * @param {number} adherence - Adherence percentage (0-100)
   */
  updateAdherencePieChart(svgId, adherence) {
    const svg = document.getElementById(svgId);
    if (!svg) return;

    const percentage = Math.round(adherence);
    const radius = 20;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percentage / 100) * circumference;
    const color = this.getAdherenceStrokeColor(adherence);

    // Update the progress circle
    const progressCircle = svg.querySelectorAll('circle')[1];
    progressCircle.setAttribute('stroke', color);
    progressCircle.setAttribute('stroke-dashoffset', offset);

    // Update the percentage text
    const text = svg.querySelector('text');
    text.textContent = percentage + '%';
  }

  /**
   * Capitalize first letter of string
   * @param {string} str - String to capitalize
   * @returns {string} Capitalized string
   */
  capitalize(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Handle user logout
   * Clears authentication data and redirects to login page
   */
  handleLogout() {
    // Show confirmation dialog
    if (!confirm('Are you sure you want to log out?')) {
      return;
    }

    // Clear all authentication data
    if (typeof Auth !== 'undefined' && Auth.logout) {
      Auth.logout();
    }

    // Clear all localStorage data related to the session
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user_data');
    localStorage.removeItem('user_role');
    localStorage.removeItem('selected_role');
    localStorage.removeItem('preselected_patient_id');
    localStorage.removeItem('preselected_patient_name');

    // Show notification
    if (typeof Utils !== 'undefined' && Utils.showNotification) {
      Utils.showNotification('Logged out successfully', 'success');
    }

    // Redirect to login page after a short delay
    setTimeout(() => {
      window.location.href = '/login.html';
    }, 500);
  }
}

// Initialize dashboard
window.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, waiting for Chart.js...');
  waitForChart(() => {
    window.dashboard = new ClinicianDashboard();
  });
});