// Extracted PatientDashboard logic from patient-dashboard.html
// Handles fetching FHIR data (via proxy), rendering patient vitals, meds, logs, and quick entry modal.
// Dependencies: common.js (Utils, Auth, Modal, Chart)

class PatientDashboard {
  // Constructor: Initializes dashboard state, user info, FHIR config, and calls init
  constructor() {
    const storedUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser) ? Auth.getCurrentUser() : null;
    this.currentUser = storedUser || { name: 'Demo User', role: 'patient' };
    this.fhirData = null;
    this.tasks = { bloodPressure: false, weight: false, temperature: false, fluidIntake: false, urineOutput: false };
    this.medicationsDue = 0;
    this.medicationsTaken = 0;
    this.nextAppointment = null;
    this.logs = [];
    // Store today's medications and their status
    this.todayMedications = [];

    // CALENDAR: state (create BEFORE init, and do NOT call init twice)
    this.patientLogs = {};              // YYYY-MM-DD → [entries]
    this.viewDate = new Date();         // month in view
    this.viewDate.setDate(1);
    window.patientLogs = this.patientLogs; // optional

    // HAPI FHIR and Backend configuration
    this.FHIR_BASE = window.APP_CONFIG?.HAPI_FHIR_BASE || 'https://hapi.fhir.org/baseR4';
    this.BACKEND_URL = window.APP_CONFIG?.BACKEND_URL || 'http://localhost:3001';

    // Track loading state for reminders and completion
    this.remindersLoaded = false;
    this.completionLoaded = false;

    this.init(); // call once
  }

  // Initializes dashboard: sets up event listeners, loads FHIR data, user info, calendar, reminders, and medication data
  async init() {
    this.setupEventListeners();
    await this.loadFhirData();
    this.loadUserData();
    this.updateDateTime();
    
    this.populateVitalsFromFhir();
    this.populatePatientInfoFromFhir();

    // CALENDAR: initialize calendar first
    await this.initCalendar();
    
    // Load medication data and check completion status BEFORE updating log reminder
    await this.loadMedicationData();
    await this.checkTodayCompletionStatus();
    
    // NOW update log reminder with loaded data
    this.updateLogReminder();
    
    // Sort suggestion articles based on patient health data (optional feature)
    // Set ENABLE_AI_SORTING to false if you don't have a valid OpenRouter API key
    const ENABLE_AI_SORTING = true; // Change to false to disable AI sorting
    if (ENABLE_AI_SORTING) {
      await this.sortSuggestionArticles();
    }
    
    // Generate AI Insight for patient
    this.generateAIInsight();
  }
  
  // Load medication data and count medications due and taken
  // Loads medication data for today: fetches MedicationRequest and MedicationAdministration from FHIR, counts doses due and taken
  async loadMedicationData() {
    const patientId = this.getPatientId();
    
    // Default to 0 medications
    this.medicationsDue = 0;
    this.medicationsTaken = 0;
    
    if (!patientId) {
      console.warn('No patient ID available for loading medication data');
      this.renderReminders();
      return;
    }
    
    try {
      const today = this.ymd(new Date());
      
      // 1. Fetch MedicationRequest to get medications due
      // Note: Some HAPI FHIR servers don't support _sort on MedicationRequest, so we'll sort client-side
      const medReqUrl = `${this.FHIR_BASE}/MedicationRequest?subject=Patient/${patientId}&_count=100`;
      console.log('📋 Fetching MedicationRequests from:', medReqUrl);
      const medReqRes = await fetch(medReqUrl);
      
      if (!medReqRes.ok) {
        console.error('Failed to fetch MedicationRequests:', medReqRes.status);
        this.renderReminders();
        return;
      }
      
      const medReqBundle = await medReqRes.json();
      console.log('MedicationRequest bundle:', medReqBundle);
      
      if (!medReqBundle.entry || medReqBundle.entry.length === 0) {
        console.log('No medication requests found in bundle');
        this.renderReminders();
        return;
      }
      
      const medRequests = medReqBundle.entry.map(e => e.resource);
      
      // Find the most recent authoredOn date
      const sortedRequests = [...medRequests].sort((a, b) => {
        const dateA = new Date(a.authoredOn || 0);
        const dateB = new Date(b.authoredOn || 0);
        return dateB - dateA;
      });

      const latestDate = sortedRequests[0]?.authoredOn;
      
      if (!latestDate) {
        console.log('No medications with valid authoredOn date');
        this.renderReminders();
        return;
      }
      
      // Filter to only the most recent date and count total medication instances
      const latestRequests = medRequests.filter(mr => mr.authoredOn === latestDate);
      let totalMedications = 0;
      
      latestRequests.forEach(mr => {
        const dosageInstructions = mr.dosageInstruction || [];
        dosageInstructions.forEach(dosage => {
          const whenCodes = dosage.timing?.repeat?.when || [];
          const timings = whenCodes.length > 0 ? whenCodes : ['UNSPECIFIED'];
          totalMedications += timings.length;
        });
      });
      
      this.medicationsDue = totalMedications;
      console.log(`✅ Found ${totalMedications} medication doses due from ${latestRequests.length} MedicationRequests`);
      
      // 2. Fetch MedicationAdministration to count medications taken today
      const adminUrl = `${this.FHIR_BASE}/MedicationAdministration?subject=Patient/${patientId}&_count=100`;
      console.log('💊 Fetching MedicationAdministrations from:', adminUrl);
      const adminResp = await fetch(adminUrl);
      
      if (adminResp.ok) {
        const adminBundle = await adminResp.json();
        console.log('MedicationAdministration bundle:', adminBundle);
        
        if (adminBundle.entry && adminBundle.entry.length > 0) {
          const allAdministrations = adminBundle.entry.map(e => e.resource);
          console.log(`Fetched ${allAdministrations.length} total MedicationAdministrations`);
          
          // Filter to only today's administrations
          const todayAdministrations = allAdministrations.filter(ma => {
            if (!ma.effectiveDateTime) {
              console.log('  ⚠️ Skipping administration without effectiveDateTime:', ma.id);
              return false;
            }
            const adminDate = this.ymd(new Date(ma.effectiveDateTime));
            const isToday = adminDate === today;
            console.log(`  ${isToday ? '✅' : '❌'} ${ma.id}: effectiveDateTime=${ma.effectiveDateTime}, date=${adminDate}, today=${today}`);
            return isToday;
          });
          
          this.medicationsTaken = todayAdministrations.length;
          console.log(`✅ Found ${todayAdministrations.length} MedicationAdministrations for today (${today})`);
        } else {
          console.log('No medication administrations found');
        }
      } else {
        console.error('Failed to fetch MedicationAdministrations:', adminResp.status);
      }
      
    } catch (error) {
      console.error('Failed to load medication data:', error);
    }
    
    // Always render reminders with medication count (even if 0)
    console.log(`📊 Summary: ${this.medicationsTaken}/${this.medicationsDue} medications taken today`);
    this.renderReminders();
  }

  // Loads patient FHIR data via proxy, transforms bundle, updates user info, and fetches appointments
  async loadFhirData() {
    try {
      // Show loading state for Patient Profile
      this.showPatientProfileLoading(true);
      
      const baseUrl = `${this.BACKEND_URL}/api/patient`;
      const patientResId = this.currentUser?.fhir?.patientId;
      
      // Debug: Log current user data
      console.log('Current User Data:', this.currentUser);
      console.log('Patient ID from storage:', patientResId);
      
      if (!patientResId) {
        console.warn('No patientId found in stored user context.');
        console.log('Available storage keys:', Object.keys(localStorage));
        
        // Try to get from user_data
        const userData = localStorage.getItem('user_data');
        if (userData) {
          console.log('user_data from localStorage:', JSON.parse(userData));
        }
        
        Utils?.showNotification && Utils.showNotification('No patient context. Please re-login as patient.', 'warning');
      }
      
      const params = new URLSearchParams();
      if (patientResId) {
        params.set('patientId', patientResId);
        console.log('Fetching patient data with ID:', patientResId);
      } else {
        params.set('_count', '1');
        console.log('No patient ID, fetching default patient');
      }
      
      const fetchUrl = `${baseUrl}?${params.toString()}`;
      console.log('Fetching from:', fetchUrl);
      
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error('FHIR proxy error ' + resp.status);
      
      const bundle = await resp.json();
      console.log('Received bundle:', bundle);
      
      this.fhirData = this.transformBundle(bundle);
      console.log('Transformed FHIR data:', this.fhirData);
      
      if (this.fhirData && this.fhirData.patient?.name) {
        this.currentUser.name = this.fhirData.patient.name;
        console.log('Updated current user name to:', this.currentUser.name);
      }
      
      // Fetch appointments from HAPI FHIR
      if (patientResId) {
        await this.fetchAppointments(patientResId);
      }
      
      try {
        const pid = this.currentUser?.fhir?.patientId || this.fhirData?.patient?.id;
        const flagKey = 'shown_patient_id_alert';
        if (pid && !localStorage.getItem(flagKey)) {
          console.log(`Patient loaded: ${this.fhirData?.patient?.name} (ID: ${pid})`);
          localStorage.setItem(flagKey, '1');
        }
      } catch (_) {}
    } catch (e) {
      console.error('FHIR load failed:', e);
      Utils?.showNotification && Utils.showNotification('Failed to load patient data: ' + e.message, 'danger');
    } finally {
      // Hide loading state
      this.showPatientProfileLoading(false);
      this.updatePatientVerification();
    }
  }

  // Fetches appointments for patient from HAPI FHIR, finds next or most recent appointment
  async fetchAppointments(patientId) {
    try {
      const HAPI_FHIR_BASE = 'https://hapi.fhir.org/baseR4';
      const maxRetries = 5;
      let lastError = null;
      
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const url = `${HAPI_FHIR_BASE}/Appointment?patient=Patient/${patientId}&_count=1000&_sort=-date`;
          
          const response = await fetch(url);
          
          if (!response.ok) {
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
              continue;
            }
            console.warn('Failed to fetch appointments');
            return;
          }
          
          const bundle = await response.json();
          const appointments = bundle.entry ? bundle.entry.map(e => e.resource) : [];
          
          console.log(`✅ Fetched ${appointments.length} appointment(s) for patient`);
          
          // Find the next appointment (closest to today)
          if (appointments.length > 0) {
            const now = new Date();
            
            // First try to get future appointments
            const futureAppointments = appointments
              .filter(apt => {
                if (!apt.start) return false;
                const aptDate = new Date(apt.start);
                return aptDate >= now;
              })
              .sort((a, b) => new Date(a.start) - new Date(b.start));
            
            if (futureAppointments.length > 0) {
              const nextAppt = futureAppointments[0];
              this.nextAppointment = {
                datetime: new Date(nextAppt.start),
                place: nextAppt.description || 'Hospital',
                doctor: nextAppt.participant?.find(p => p.actor?.display)?.actor?.display || 'Dr. Smith'
              };
              console.log('✅ Set next appointment:', this.nextAppointment);
            } else {
              // If no future appointments, get the most recent past one
              const pastAppointments = appointments
                .filter(apt => apt.start)
                .sort((a, b) => new Date(b.start) - new Date(a.start));
              
              if (pastAppointments.length > 0) {
                const lastAppt = pastAppointments[0];
                this.nextAppointment = {
                  datetime: new Date(lastAppt.start),
                  place: lastAppt.description || 'Hospital',
                  doctor: lastAppt.participant?.find(p => p.actor?.display)?.actor?.display || 'Dr. Smith'
                };
                console.log('⚠️ No future appointments, using most recent past appointment:', this.nextAppointment);
              }
            }
          }
          
          return;
        } catch (error) {
          lastError = error;
          
          if (attempt < maxRetries) {
            console.warn(`⚠️ Appointment fetch attempt ${attempt}/${maxRetries} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
          }
        }
      }
      
      console.error(`❌ Failed to fetch appointments after ${maxRetries} attempts:`, lastError?.message);
    } catch (error) {
      console.error('Error fetching appointments:', error);
    }
  }

  // Shows or hides loading spinner for patient profile section
  showPatientProfileLoading(isLoading) {
    const container = document.getElementById('patientProfile');
    if (!container) return;
    
    if (isLoading) {
      container.innerHTML = `
        <div class="col-span-full flex flex-col items-center justify-center py-12">
          <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-3"></div>
          <p class="text-sm text-gray-500">Loading...</p>
        </div>
      `;
    }
  }

  // Transforms FHIR bundle into dashboard data structure: patient, conditions, vitals, medications
  transformBundle(bundle) {
    if (!bundle || bundle.resourceType !== 'Bundle' || !Array.isArray(bundle.entry)) return null;
    const entries = bundle.entry.map(e => e.resource).filter(Boolean);
    const patient = entries.find(r => r.resourceType === 'Patient');
    const conditions = entries.filter(r => r.resourceType === 'Condition');
    const observations = entries.filter(r => r.resourceType === 'Observation');
    const medStatements = entries.filter(r => r.resourceType === 'MedicationStatement');
    const medRequests = entries.filter(r => r.resourceType === 'MedicationRequest');
    const medAdministrations = entries.filter(r => r.resourceType === 'MedicationAdministration');

    const patientName = patient?.name?.[0];
    let displayName = 'Patient';
    if (patientName) {
      if (patientName.text) {
        displayName = patientName.text;
      } else {
        const givens = Array.isArray(patientName.given) ? patientName.given.filter(Boolean).join(' ') : (patientName.given || '');
        displayName = [givens, patientName.family].filter(Boolean).join(' ') || 'Patient';
      }
    }
    const resourceId = patient?.id || 'N/A';
    const identifier = patient?.identifier?.[0]?.value || null;
    if ((!patientName || displayName === 'Patient') && resourceId && resourceId !== 'N/A') {
      displayName = `Patient ${resourceId.substring(0, 8)}`;
    }
    const gender = patient?.gender || '-';
    const birthDate = patient?.birthDate || '-';
    const age = birthDate && birthDate !== '-' ? this.calcAge(birthDate) : '-';
    
    // Extract generalPractitioner for Communication recipient
    const generalPractitioner = patient?.generalPractitioner || null;

    function findLatestObs(codeSystem, code) {
      const candidates = observations.filter(o => o.code?.coding?.some(c => c.system === codeSystem && c.code === code));
      candidates.sort((a, b) => new Date(b.effectiveDateTime || b.issued || 0) - new Date(a.effectiveDateTime || a.issued || 0));
      return candidates[0];
    }
    const bp = findLatestObs('http://loinc.org', '85354-9');
    let systolic, diastolic;
    if (bp?.component) {
      systolic = bp.component.find(c => c.code?.coding?.some(cd => cd.code === '8480-6'))?.valueQuantity;
      diastolic = bp.component.find(c => c.code?.coding?.some(cd => cd.code === '8462-4'))?.valueQuantity;
    }
    const weightObs = findLatestObs('http://loinc.org', '29463-7');
    const tempObs = findLatestObs('http://loinc.org', '8310-5');

    function medText(m) {
      if (m.medicationCodeableConcept?.text) return m.medicationCodeableConcept.text;
      const c = m.medicationCodeableConcept?.coding?.[0];
      return c ? (c.display || c.code) : 'Medication';
    }
    const meds = [...medStatements, ...medRequests].map(m => medText(m)).filter(Boolean);

    return {
      patient: { 
        name: displayName, 
        id: resourceId, 
        resourceId, 
        identifier, 
        gender, 
        birthDate, 
        age,
        generalPractitioner: generalPractitioner  // Add generalPractitioner reference
      },
      conditions: conditions.map(c => ({
        text: c.code?.text || c.code?.coding?.[0]?.display,
        recordedDate: c.recordedDate || c.onsetDateTime || null
      })).filter(c => c.text),
      vitals: {
        bloodPressure: (systolic && diastolic) ? `${systolic.value}/${diastolic.value} ${systolic.unit || 'mmHg'}` : null,
        weight: weightObs?.valueQuantity ? `${weightObs.valueQuantity.value} ${weightObs.valueQuantity.unit}` : null,
        temperature: tempObs?.valueQuantity ? `${tempObs.valueQuantity.value} ${tempObs.valueQuantity.unit}` : null
      },
      medications: meds,
      medRequests: medRequests,
      medAdministrations: medAdministrations,
    };
  }

  // Calculates age from birth date string
  calcAge(birthDateStr) {
    const d = new Date(birthDateStr);
    if (isNaN(d)) return '-';
    const diff = Date.now() - d.getTime();
    const ageDate = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
  }

  // Populates vitals section from FHIR data (blood pressure, weight, temperature)
  populateVitalsFromFhir() {
    if (!this.fhirData?.vitals) return;
    const v = this.fhirData.vitals;
    const set = (id, val) => { const el = document.getElementById(id); if (el && val) el.textContent = val; };
    set('fhirBP', v.bloodPressure || '-');
    set('fhirWeight', v.weight || '-');
    set('fhirTemp', v.temperature || '-');
  }

  // Populates medication list from FHIR data
  populateMedsFromFhir() {
    if (!this.fhirData) return;
    const listEl = document.getElementById('fhirMeds');
    if (!listEl) return;
    listEl.innerHTML = '';
    const meds = this.fhirData.medications || [];
    if (meds.length === 0) {
      const li = document.createElement('li');
      li.className = 'text-xs text-gray-500';
      li.textContent = 'No medications in FHIR bundle';
      listEl.appendChild(li);
    } else {
      meds.slice(0, 10).forEach(m => {
        const li = document.createElement('li');
        li.textContent = m;
        listEl.appendChild(li);
      });
    }
    // Note: medicationsDue is now set by loadMedicationData()
  }

  // Populates patient info section from FHIR data (name, gender, birth date, age, conditions)
  populatePatientInfoFromFhir() {
    if (!this.fhirData?.patient) {
      // If no data, restore default structure
      const container = document.getElementById('patientProfile');
      if (container) {
        container.innerHTML = this.getPatientProfileHTML();
      }
      return;
    }
    
    const p = this.fhirData.patient;
    
    // Restore full HTML structure first
    const container = document.getElementById('patientProfile');
    if (container) {
      container.innerHTML = this.getPatientProfileHTML();
    }
    
    // Then populate with data
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '-'; };
    
    // Display patient name instead of ID
    set('ppName', p.name || 'Unknown Patient');
    set('ppGender', p.gender);
    
    // Format birth date as "MMM DD\nYYYY"
    const birthDateEl = document.getElementById('ppBirthDate');
    if (birthDateEl && p.birthDate) {
      const date = new Date(p.birthDate);
      const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const year = date.getFullYear();
      birthDateEl.innerHTML = `${monthDay}<br>${year}`;
    } else if (birthDateEl) {
      birthDateEl.textContent = '-';
    }
    
    set('ppAge', p.age);
    
    // Display conditions with dates
    const condEl = document.getElementById('ppConditions');
    if (condEl) {
      if (this.fhirData.conditions && this.fhirData.conditions.length) {
        // Format each condition with its date
        const conditionsHTML = this.fhirData.conditions.map(cond => {
          let dateStr = '';
          if (cond.recordedDate) {
            const date = new Date(cond.recordedDate);
            dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          }
          return `<div class="mb-2">
            <div class="font-medium">${cond.text}</div>
            ${dateStr ? `<div class="text-xs text-gray-500">${dateStr}</div>` : ''}
          </div>`;
        }).join('');
        condEl.innerHTML = conditionsHTML;
      } else {
        condEl.textContent = '-';
      }
    }
  }

  // Returns HTML template for patient profile cards
  getPatientProfileHTML() {
    return `
      <!-- Patient Name Card -->
      <div class="rounded-lg border bg-gray-50 p-4 hover:bg-gray-100 transition-colors">
        <div class="flex items-center mb-2">
          <svg class="h-5 w-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Patient Name</span>
        </div>
        <div id="ppName" class="text-lg font-bold text-gray-900">-</div>
      </div>

      <!-- Gender Card -->
      <div class="rounded-lg border bg-gray-50 p-4 hover:bg-gray-100 transition-colors">
        <div class="flex items-center mb-2">
          <svg class="h-5 w-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Gender</span>
        </div>
        <div id="ppGender" class="text-lg font-bold text-gray-900">-</div>
      </div>

      <!-- Birth Date Card -->
      <div class="rounded-lg border bg-gray-50 p-4 hover:bg-gray-100 transition-colors">
        <div class="flex items-center mb-2">
          <svg class="h-5 w-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Birth Date</span>
        </div>
        <div id="ppBirthDate" class="text-lg font-bold text-gray-900">-</div>
      </div>

      <!-- Age Card -->
      <div class="rounded-lg border bg-gray-50 p-4 hover:bg-gray-100 transition-colors">
        <div class="flex items-center mb-2">
          <svg class="h-5 w-5 text-blue-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Age</span>
        </div>
        <div id="ppAge" class="text-lg font-bold text-gray-900">-</div>
      </div>

      <!-- Conditions Card (Full Width) -->
      <div class="rounded-lg border bg-gray-50 p-4 hover:bg-gray-100 transition-colors md:col-span-2 lg:col-span-4">
        <div class="flex items-start mb-2">
          <svg class="h-5 w-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor"
            viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span class="text-xs font-semibold text-gray-500 uppercase tracking-wide">Conditions</span>
        </div>
        <div id="ppConditions" class="text-sm text-gray-900 leading-relaxed">-</div>
      </div>
    `;
  }

  // Sets up all event listeners for dashboard UI controls and forms
  setupEventListeners() {
    document.getElementById('userMenuButton').addEventListener('click', () => {
      document.getElementById('userMenu').classList.toggle('hidden');
    });
    
    document.getElementById('saveMedications').addEventListener('click', () => {
      this.saveMedicationChanges();
    });
    document.addEventListener('click', (e) => {
      const m = document.getElementById('userMenu');
      const b = document.getElementById('userMenuButton');
      if (!b.contains(e.target) && !m.contains(e.target)) m.classList.add('hidden');
    });

    document.getElementById('logoutBtn').addEventListener('click', (e) => {
      e.preventDefault();
      if (confirm('Are you sure you want to log out?')) {
        Auth.logout();
        Utils.showNotification('Logged out', 'success');
        setTimeout(() => (window.location.href = 'login.html'), 700);
      }
    });

    document.querySelectorAll('.quick-action-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        this.openActionModal(action, btn);
      });
    });

    document.getElementById('btnOpenMedication').addEventListener('click', () => {
      this.openMedicationList();
    });

    document.getElementById('quickRecordForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleQuickRecord();
    });

    // Unified monitoring modal handlers
    document.getElementById('btnOpenUnifiedLog').addEventListener('click', () => {
      this.openUnifiedMonitoringModal();
    });

    document.getElementById('unifiedMonitoringForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleUnifiedFormSubmit();
    });

    // Calendar: month navigation controls
    const prev = document.getElementById('calPrev');
    const next = document.getElementById('calNext');
    const todayBtn = document.getElementById('calToday');
    if (prev) prev.addEventListener('click', async () => { this.viewDate.setMonth(this.viewDate.getMonth() - 1); await this.renderCalendar(); });
    if (next) next.addEventListener('click', async () => { this.viewDate.setMonth(this.viewDate.getMonth() + 1); await this.renderCalendar(); });
    if (todayBtn) todayBtn.addEventListener('click', async () => { this.viewDate = new Date(); this.viewDate.setDate(1); await this.renderCalendar(); });

    setInterval(() => this.updateDateTime(), 60000);
  }

  // Loads user data from Auth and updates UI elements
  loadUserData() {
    const authUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser) ? Auth.getCurrentUser() : null;
    if (authUser) this.currentUser = { ...this.currentUser, ...authUser };
    const u = this.currentUser;
    document.getElementById('userName').textContent = u.name;
    document.getElementById('welcomeName').textContent = u.name;
    document.getElementById('userInitial').textContent = u.name.charAt(0).toUpperCase();
  }

  // Updates current date display in dashboard
  updateDateTime() {
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });
    document.getElementById('currentDate').textContent = dateStr;
  }

  // Renders reminders section: medications due/taken, next appointment info
  renderReminders() {
    console.log('🔔 renderReminders() called:');
    console.log('  - medicationsDue (total doses):', this.medicationsDue);
    console.log('  - medicationsTaken (doses taken):', this.medicationsTaken);
    
    // Display remaining medications (not taken yet)
    const remainingMedications = this.medicationsDue - this.medicationsTaken;
    const dueMedsEl = document.getElementById('dueMeds');
    dueMedsEl.textContent = remainingMedications;
    
    // Update badge color based on remaining medications
    // Remove all color classes first
    dueMedsEl.classList.remove('bg-red-500', 'bg-amber-500', 'bg-green-500');
    
    if (remainingMedications === 0) {
      // All medications taken - green
      dueMedsEl.classList.add('bg-green-500');
    } else if (remainingMedications > 0 && remainingMedications < this.medicationsDue) {
      // Some taken but not all - orange/amber
      dueMedsEl.classList.add('bg-amber-500');
    } else {
      // None taken - red
      dueMedsEl.classList.add('bg-red-500');
    }
    
    console.log('  - Remaining medications (displayed):', remainingMedications);
    
    if (!this.nextAppointment) {
      document.getElementById('daysToAppt').textContent = '-';
      document.getElementById('apptDate').textContent = 'No upcoming appointment';
      document.getElementById('apptPlace').textContent = 'N/A';
    } else {
      const today = new Date();
      const apptDate = this.nextAppointment.datetime;
      
      // Calculate days difference
      const diffTime = apptDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      // Display days (show 0 for same day, negative for past dates)
      document.getElementById('daysToAppt').textContent = diffDays >= 0 ? diffDays : `Past (${Math.abs(diffDays)} days ago)`;
      
      // Format date: e.g., "Oct 22, 2025"
      const formattedDate = apptDate.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric'
      });
      
      // Format time: e.g., "08:48 pm"
      const formattedTime = apptDate.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
      }).toLowerCase();
      
      // Combine date and time
      document.getElementById('apptDate').textContent = `${formattedDate} · ${formattedTime}`;
      
      // Set place and doctor
      const appt = this.nextAppointment;
      document.getElementById('apptPlace').textContent = `${appt.place} (${appt.doctor})`;
      document.getElementById('apptPlace').classList.add('hidden');
    }
    
    // Mark reminders as loaded and show UI
    this.remindersLoaded = true;
    this.showRemindersUI();
  }
  
  // Shows reminders UI after data is loaded
  showRemindersUI() {
    // Don't show UI if we're in updating state - hideUpdatingState() will handle it
    if (this.isUpdating) {
      console.log('⏸️ Skipping showRemindersUI() - currently updating');
      return;
    }
    
    if (this.remindersLoaded) {
      const loadingEl = document.getElementById('todayRemindersLoading');
      const contentEl = document.getElementById('todayRemindersContent');
      if (loadingEl) loadingEl.classList.add('hidden');
      if (contentEl) contentEl.classList.remove('hidden');
    }
  }

  // Opens quick entry modal for a specific monitoring action (blood pressure, weight, etc.)
  openActionModal(action, triggerEl) {
    const titleMap = {
      bloodPressure: 'Blood Pressure Log',
      weight: 'Weight Log',
      temperature: 'Temperature Log',
      fluidIntake: 'Fluid Intake Log',
      urineOutput: 'Urine Output Log',
      medication: 'Medication Log (incl. Immunosuppressants)',
      sideEffects: 'Adverse Reactions / Side Effects'
    };
    document.getElementById('modalTitle').textContent = titleMap[action] || 'Quick Entry';
    document.getElementById('recordContent').innerHTML = this.getFormContent(action);
    document.getElementById('quickRecordForm').setAttribute('data-action', action);
    Modal.show('quickRecordModal', triggerEl || null);
  }

  // Returns HTML form content for quick entry modal based on action type
  getFormContent(action) {
    switch (action) {
      case 'bloodPressure':
        return `
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="mb-1 block text-sm">Systolic (mmHg)</label>
              <input type="number" name="systolic" min="60" max="250" required class="form-input w-full" placeholder="e.g., 120"/>
            </div>
            <div>
              <label class="mb-1 block text-sm">Diastolic (mmHg)</label>
              <input type="number" name="diastolic" min="40" max="150" required class="form-input w-full" placeholder="e.g., 80"/>
            </div>
          </div>
          <div class="mt-3">
            <label class="mb-1 block text-sm">Notes (optional)</label>
            <textarea name="note" rows="2" class="form-input w-full" placeholder="Time, posture, etc."></textarea>
          </div>
        `;
      case 'weight':
        return `
          <div>
            <label class="mb-1 block text-sm">Weight (kg)</label>
            <input type="number" step="0.1" min="30" max="200" name="weight" required class="form-input w-full" placeholder="e.g., 68.5"/>
          </div>
          <div class="mt-3">
            <label class="mb-1 block text-sm">Notes (optional)</label>
            <textarea name="note" rows="2" class="form-input w-full" placeholder="Time, clothing, fasting, etc."></textarea>
          </div>
        `;
      case 'temperature':
        return `
          <div>
            <label class="mb-1 block text-sm">Temperature (°C)</label>
            <input type="number" min="32" max="43" step="0.1" name="temperature" required class="form-input w-full" placeholder="e.g., 36.8"/>
          </div>
          <div class="mt-3">
            <label class="mb-1 block text-sm">Notes (optional)</label>
            <textarea name="note" rows="2" class="form-input w-full" placeholder="Site, time, etc."></textarea>
          </div>
        `;
      case 'fluidIntake':
        return `
          <div>
            <label class="mb-1 block text-sm">Today’s fluid intake (ml)</label>
            <input type="number" min="0" max="5000" name="fluid" required class="form-input w-full" placeholder="e.g., 2000"/>
          </div>
          <div class="mt-3">
            <label class="mb-1 block text-sm">Notes (optional)</label>
            <textarea name="note" rows="2" class="form-input w-full" placeholder="Include soups, beverages, etc."></textarea>
          </div>
        `;
      case 'urineOutput':
        return `
          <div>
            <label class="mb-1 block text-sm">Today’s urine output (ml)</label>
            <input type="number" min="0" name="urine" required class="form-input w-full" placeholder="e.g., 1800"/>
          </div>
          <div class="mt-3">
            <label class="mb-1 block text-sm">Notes (optional)</label>
            <textarea name="note" rows="2" class="form-input w-full" placeholder="Color, frequency, etc."></textarea>
          </div>
        `;
      case 'medication':
        return `
          <div class="space-y-3">
            <div>
              <label class="mb-1 block text sm">Medication name</label>
              <input type="text" name="medName" required class="form-input w-full" placeholder="e.g., Tacrolimus (immunosuppressant)"/>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="mb-1 block text-sm">Dose</label>
                <input type="text" name="medDose" required class="form-input w-full" placeholder="e.g., 2 mg"/>
              </div>
              <div>
                <label class="mb-1 block text-sm">Time</label>
                <input type="time" name="medTime" required class="form-input w-full"/>
              </div>
            </div>
            <div>
              <label class="mb-1 block text-sm">Notes (optional)</label>
              <textarea name="note" rows="2" class="form-input w-full" placeholder="Fasting? Interval since last dose, etc."></textarea>
            </div>
          </div>
        `;
      case 'sideEffects':
        return `
          <div>
            <label class="mb-1 block text-sm">Adverse reaction / side effects</label>
            <textarea name="sideEffects" rows="4" required class="form-input w-full"
              placeholder="Free text, e.g., nausea, dizziness, rash, onset time, duration…"></textarea>
          </div>
        `;
      default:
        return `<p class="text-sm text-gray-600">Please choose an item to log.</p>`;
    }
  }

  // Handles quick record form submission: saves log, marks task done, shows notification
  async handleQuickRecord() {
    const form = document.getElementById('quickRecordForm');
    const action = form.getAttribute('data-action') || '';
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    this.markTaskDone(action);
    this.pushLog(action, data);
    Utils.showNotification('Saved', 'success');
    Modal.hide('quickRecordModal');
    form.reset();
  }

  // Opens unified monitoring modal, resets form, sets default date/time, loads medication table
  async openUnifiedMonitoringModal() {
    const form = document.getElementById('unifiedMonitoringForm');
    if (form) form.reset();
    
    // Set default date to today
    const dateInput = document.getElementById('recordDate');
    if (dateInput) {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      dateInput.value = `${year}-${month}-${day}`;
      
      // Add event listener for date changes to reload medication table
      // Remove existing listener to avoid duplicates
      const newDateInput = dateInput.cloneNode(true);
      dateInput.parentNode.replaceChild(newDateInput, dateInput);
      
      newDateInput.addEventListener('change', async (e) => {
        const selectedDate = e.target.value;
        console.log('📅 Record date changed to:', selectedDate);
        await this.populateMedicationTable(selectedDate);
      });
    }
    
    // Set default time to now
    const timeInput = document.getElementById('unifiedMedicationTime');
    if (timeInput) {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      timeInput.value = `${hours}:${minutes}`;
    }
    
    // Load and display medication requests for today
    const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
    await this.populateMedicationTable(todayStr);
    
    Modal.show('unifiedMonitoringModal');
  }

  async populateMedicationTable(selectedDate = null) {
    const container = document.getElementById('medicationTableContainer');
    if (!container) return;

    // Get MedicationRequest data from FHIR
    const medRequests = this.fhirData?.medRequests || [];
    
    if (medRequests.length === 0) {
      container.innerHTML = '<p class="text-sm text-gray-500">No medication requests found.</p>';
      return;
    }

    // Use selectedDate if provided, otherwise use today
    const targetDate = selectedDate || this.ymd(new Date());
    
    // Fetch MedicationAdministration data directly from HAPI FHIR for the target date
    const patientId = this.getPatientId();
    let targetDateAdministrations = [];
    
    if (patientId) {
      try {
        // Fetch MedicationAdministrations without sort parameter (some FHIR servers have issues with sorting)
        // Removed _sort parameter to improve compatibility
        const adminUrl = `${this.FHIR_BASE}/MedicationAdministration?subject=Patient/${patientId}&_count=100`;
        console.log('=== Fetching MedicationAdministrations ===');
        console.log('URL:', adminUrl);
        console.log('Patient ID:', patientId);
        console.log('Target Date:', targetDate);
        
        const adminResp = await fetch(adminUrl);
        console.log('Response status:', adminResp.status);
        
        if (adminResp.ok) {
          const adminBundle = await adminResp.json();
          console.log('Response bundle total:', adminBundle.total);
          console.log('Response bundle:', adminBundle);
          
          if (adminBundle.entry && adminBundle.entry.length > 0) {
            // Filter to only target date's administrations after fetching
            const allAdministrations = adminBundle.entry.map(e => e.resource);
            console.log(`Fetched ${allAdministrations.length} total MedicationAdministrations`);
            
            targetDateAdministrations = allAdministrations.filter(ma => {
              if (!ma.effectiveDateTime) return false;
              const adminDate = this.ymd(new Date(ma.effectiveDateTime));
              console.log(`  Checking: ${ma.id}, effectiveDateTime: ${ma.effectiveDateTime}, date: ${adminDate}, matches target: ${adminDate === targetDate}`);
              return adminDate === targetDate;
            });
            
            console.log(`Found ${targetDateAdministrations.length} MedicationAdministrations for ${targetDate}:`, targetDateAdministrations);
          } else {
            console.log('No entries in bundle');
          }
        } else {
          const errorText = await adminResp.text();
          console.log('Response not OK:', errorText);
        }
      } catch (error) {
        console.error('Failed to fetch MedicationAdministrations:', error);
      }
    } else {
      console.warn('No patient ID available for fetching MedicationAdministrations');
    }
    
    // Create a map of "MedicationRequest ID-timing" -> MedicationAdministration time
    console.log('=== Creating Administration Map ===');
    const administrationMap = new Map();
    targetDateAdministrations.forEach((ma, index) => {
      // Extract timing code from note field (format: "timing:ACM")
      let timingCode = 'UNSPECIFIED';
      if (ma.note && ma.note.length > 0) {
        const noteText = ma.note[0].text || '';
        const match = noteText.match(/timing:(\w+)/);
        if (match) {
          timingCode = match[1];
        }
      }
      
      console.log(`MedicationAdministration ${index}:`, {
        id: ma.id,
        effectiveDateTime: ma.effectiveDateTime,
        requestReference: ma.request?.reference,
        timingCode: timingCode,
        note: ma.note,
        status: ma.status
      });
      
      const requestRef = ma.request?.reference; // e.g., "MedicationRequest/123"
      if (requestRef) {
        const medRequestId = requestRef.split('/')[1];
        const time = new Date(ma.effectiveDateTime);
        const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`;
        
        // Create composite key: "medRequestId-timing"
        const compositeKey = `${medRequestId}-${timingCode}`;
        administrationMap.set(compositeKey, timeStr);
        console.log(`  ✓ Mapped: ${compositeKey} -> taken at ${timeStr}`);
      } else {
        console.log(`  ✗ No request reference found`);
      }
    });
    
    console.log('Final administration map size:', administrationMap.size);
    console.log('Map contents:', Array.from(administrationMap.entries()));

    // Find the most recent authoredOn date
    const sortedRequests = [...medRequests].sort((a, b) => {
      const dateA = new Date(a.authoredOn || 0);
      const dateB = new Date(b.authoredOn || 0);
      return dateB - dateA;
    });

    const latestDate = sortedRequests[0]?.authoredOn;
    if (!latestDate) {
      container.innerHTML = '<p class="text-sm text-gray-500">No medication requests with valid dates.</p>';
      return;
    }

    // Filter to only the most recent date
    const latestRequests = medRequests.filter(mr => mr.authoredOn === latestDate);

    // Process each medication request and group by timing
    const medicationsByTiming = {};
    const timingOrder = ['ACM', 'MORN', 'PCM', 'ACL', 'NOON', 'PCL', 'ACD', 'EVE', 'PCD', 'NIGHT', 'HS'];
    const timingLabels = {
      'MORN': 'Morning',
      'NOON': 'Noon',
      'EVE': 'Evening',
      'NIGHT': 'Night',
      'ACM': 'Before Breakfast',
      'ACL': 'Before Lunch',
      'ACD': 'Before Dinner',
      'PCM': 'After Breakfast',
      'PCL': 'After Lunch',
      'PCD': 'After Dinner',
      'HS': 'At Bedtime'
    };

    latestRequests.forEach(mr => {
      // Get medication name
      const medName = mr.medicationCodeableConcept?.coding?.[0]?.display || 
                      mr.medicationCodeableConcept?.text || 
                      'Unknown Medication';
      
      // Get MedicationRequest ID
      const medRequestId = mr.id;
      console.log(`Processing MedicationRequest: ${medRequestId} - ${medName}`);

      // Process each dosage instruction
      const dosageInstructions = mr.dosageInstruction || [];
      dosageInstructions.forEach(dosage => {
        // Get timing (when)
        const whenCodes = dosage.timing?.repeat?.when || [];
        const timings = whenCodes.length > 0 ? whenCodes : ['UNSPECIFIED'];

        timings.forEach(timing => {
          // Get route
          const route = dosage.route?.text || dosage.route?.coding?.[0]?.display || '-';
          const routeCoding = dosage.route?.coding?.[0];

          // Get dose with unit from doseAndRate
          const doseAndRate = dosage.doseAndRate?.[0];
          const doseValue = doseAndRate?.doseQuantity?.value || '-';
          const doseUnit = doseAndRate?.doseQuantity?.unit || doseAndRate?.unit || '';
          const dose = doseValue !== '-' ? `${doseValue}<br>${doseUnit}`.trim() : '-';

          // Get patient instruction (fallback to additionalInstruction)
          let instruction = dosage.patientInstruction || '';
          if (!instruction && dosage.additionalInstruction && dosage.additionalInstruction.length > 0) {
            instruction = dosage.additionalInstruction[0]?.text || 
                         dosage.additionalInstruction[0]?.coding?.[0]?.display || '';
          }
          instruction = instruction || '-';

          // Group by timing
          if (!medicationsByTiming[timing]) {
            medicationsByTiming[timing] = [];
          }

          // Check if this medication has been taken today using composite key
          const compositeKey = `${medRequestId}-${timing}`;
          const takenTime = administrationMap.get(compositeKey);
          const isTaken = !!takenTime;
          
          console.log(`  - Composite Key: ${compositeKey}, Taken: ${isTaken}, Time: ${takenTime || 'N/A'}`);

          medicationsByTiming[timing].push({
            name: medName,
            dose: dose,
            doseValue: doseValue,
            doseUnit: doseUnit,
            timing: timing,
            timingLabel: timingLabels[timing] || timing,
            route: route,
            routeCoding: routeCoding,
            instruction: instruction,
            medRequestId: medRequestId,
            isTaken: isTaken,
            takenTime: takenTime
          });
        });
      });
    });

    // Collect all medications and separate into taken/not taken
    const allMedications = [];
    
    // Collect from ordered timings
    timingOrder.forEach(timing => {
      if (medicationsByTiming[timing]) {
        allMedications.push(...medicationsByTiming[timing]);
      }
    });
    
    // Collect from unspecified timings
    Object.keys(medicationsByTiming).forEach(timing => {
      if (!timingOrder.includes(timing)) {
        allMedications.push(...medicationsByTiming[timing]);
      }
    });

    // Separate medications into not taken and taken
    const notTakenMeds = allMedications.filter(med => !med.isTaken);
    const takenMeds = allMedications.filter(med => med.isTaken);

    // Sort each group by timing order
    const sortByTiming = (a, b) => {
      const indexA = timingOrder.indexOf(a.timing);
      const indexB = timingOrder.indexOf(b.timing);
      const orderA = indexA === -1 ? 999 : indexA;
      const orderB = indexB === -1 ? 999 : indexB;
      return orderA - orderB;
    };
    
    notTakenMeds.sort(sortByTiming);
    takenMeds.sort(sortByTiming);

    // Generate table HTML
    let tableHTML = `
      <div class="overflow-x-auto">
        <table class="w-full text-sm border-collapse">
          <thead>
            <tr class="bg-gray-100 border-b">
              <th class="px-3 py-2 text-left font-semibold">Taken</th>
              <th class="px-3 py-2 text-left font-semibold">Medication Name</th>
              <th class="px-3 py-2 text-left font-semibold">Dose</th>
              <th class="px-3 py-2 text-left font-semibold">Timing</th>
              <th class="px-3 py-2 text-left font-semibold">Route</th>
              <th class="px-3 py-2 text-left font-semibold">Instruction</th>
            </tr>
          </thead>
          <tbody>
    `;

    let hasRows = false;
    let medIndex = 0;

    // Add not taken medications first
    notTakenMeds.forEach(med => {
      hasRows = true;
      const medData = JSON.stringify({
        medRequestId: med.medRequestId,
        doseValue: med.doseValue,
        doseUnit: med.doseUnit,
        route: med.route,
        routeCoding: med.routeCoding,
        timing: med.timing  // Add timing code
      }).replace(/"/g, '&quot;');
      
      tableHTML += `
        <tr class="border-b hover:bg-gray-50">
          <td class="px-3 py-2">
            <input type="checkbox" 
                   class="medication-checkbox w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" 
                   data-med-info="${medData}"
                   id="medCheck${medIndex}" />
          </td>
          <td class="px-3 py-2">${med.name}</td>
          <td class="px-3 py-2">${med.dose}</td>
          <td class="px-3 py-2">${med.timingLabel}</td>
          <td class="px-3 py-2">${med.route}</td>
          <td class="px-3 py-2">${med.instruction}</td>
        </tr>
      `;
      medIndex++;
    });

    // Add taken medications
    takenMeds.forEach(med => {
      hasRows = true;
      
      tableHTML += `
        <tr class="border-b bg-green-50">
          <td class="px-3 py-2">
            <span class="inline-flex items-center justify-center w-6 h-6 text-green-700 bg-green-100 rounded-full">
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
              </svg>
            </span>
          </td>
          <td class="px-3 py-2 text-gray-600">${med.name}</td>
          <td class="px-3 py-2 text-gray-600">${med.dose}</td>
          <td class="px-3 py-2 text-gray-600">${med.timingLabel}</td>
          <td class="px-3 py-2 text-gray-600">${med.route}</td>
          <td class="px-3 py-2 text-gray-600">${med.instruction}</td>
        </tr>
      `;
    });

    tableHTML += `
          </tbody>
        </table>
      </div>
    `;

    if (!hasRows) {
      container.innerHTML = '<p class="text-sm text-gray-500">No medication details available.</p>';
    } else {
      container.innerHTML = tableHTML;
    }
    
    // Only update Today's Completion if viewing today's medications
    const isViewingToday = (selectedDate || this.ymd(new Date())) === this.ymd(new Date());
    
    if (isViewingToday) {
      // Update medication counts for Today's Completion calculation
      // medicationsDue = total number of medication doses (rows in table)
      // medicationsTaken = number of checked/taken doses
      this.medicationsDue = allMedications.length;
      this.medicationsTaken = takenMeds.length;
      
      console.log(`📊 Medication counts updated:`);
      console.log(`  - Total doses (rows): ${allMedications.length}`);
      console.log(`  - Doses taken (checked): ${takenMeds.length}`);
      console.log(`  - Doses remaining: ${allMedications.length - takenMeds.length}`);
      
      // Update the completion display and due medications badge
      this.updateCompletion();
      this.renderReminders();
      
      console.log(`✅ Updated Today's Completion: ${this.medicationsTaken}/${this.medicationsDue} medications`);
    } else {
      console.log(`ℹ️ Viewing medications for ${selectedDate || 'selected date'} - not updating Today's Completion`);
    }
  }

  // Handles unified monitoring form submission: saves logs, marks tasks, saves to FHIR, updates UI and completion
  async handleUnifiedFormSubmit() {
    const form = document.getElementById('unifiedMonitoringForm');
    const fd = new FormData(form);
    const data = Object.fromEntries(fd);

    let hasAnyData = false;
    const recordDate = data.recordDate || this.ymd(new Date()); // Get selected date or use today

    // Collect checked medications
    const checkedMedications = [];
    const checkboxes = document.querySelectorAll('.medication-checkbox:checked');
    checkboxes.forEach(checkbox => {
      try {
        const medInfo = JSON.parse(checkbox.getAttribute('data-med-info').replace(/&quot;/g, '"'));
        checkedMedications.push(medInfo);
      } catch (e) {
        console.error('Failed to parse medication data:', e);
      }
    });

    // Store locally (for immediate UI update) - use the selected date
    // Check for non-empty values (empty strings should be treated as no input)
    if (data.systolic && data.systolic.trim() && data.diastolic && data.diastolic.trim()) {
      this.pushLog('bloodPressure', { systolic: data.systolic, diastolic: data.diastolic }, recordDate);
      if (recordDate === this.ymd(new Date())) this.markTaskDone('bloodPressure');
      hasAnyData = true;
    }
    if (data.weight && data.weight.trim()) {
      this.pushLog('weight', { weight: data.weight }, recordDate);
      if (recordDate === this.ymd(new Date())) this.markTaskDone('weight');
      hasAnyData = true;
    }
    if (data.temperature && data.temperature.trim()) {
      this.pushLog('temperature', { temperature: data.temperature }, recordDate);
      if (recordDate === this.ymd(new Date())) this.markTaskDone('temperature');
      hasAnyData = true;
    }
    if (data.fluidIntake && data.fluidIntake.trim()) {
      this.pushLog('fluidIntake', { fluid: data.fluidIntake }, recordDate);
      if (recordDate === this.ymd(new Date())) this.markTaskDone('fluidIntake');
      hasAnyData = true;
    }
    if (data.urineOutput && data.urineOutput.trim()) {
      this.pushLog('urineOutput', { urine: data.urineOutput }, recordDate);
      if (recordDate === this.ymd(new Date())) this.markTaskDone('urineOutput');
      hasAnyData = true;
    }
    if (data.medicationName && data.medicationDose && data.medicationTime) {
      this.pushLog('medication', {
        medName: data.medicationName,
        medDose: data.medicationDose,
        medTime: data.medicationTime
      }, recordDate);
      if (recordDate === this.ymd(new Date())) this.markTaskDone('medication');
      hasAnyData = true;
    }
    if (checkedMedications.length > 0) {
      hasAnyData = true;
      if (recordDate === this.ymd(new Date())) this.markTaskDone('medication');
    }
    if (data.sideEffects && data.sideEffects.trim()) {
      this.pushLog('sideEffects', { sideEffects: data.sideEffects.trim() }, recordDate);
      hasAnyData = true;
    }

    if (!hasAnyData) {
      Utils.showNotification('No data entered. Please fill in at least one field.', 'warning');
      return;
    }

    // Save to HAPI FHIR
    try {
      console.log('Saving to HAPI FHIR for date:', recordDate);
      
      // Check if there's any vital signs data (non-medication data)
      const hasVitalSignsData = (data.systolic && data.systolic.trim() && data.diastolic && data.diastolic.trim()) ||
                                (data.weight && data.weight.trim()) ||
                                (data.temperature && data.temperature.trim()) ||
                                (data.fluidIntake && data.fluidIntake.trim()) ||
                                (data.urineOutput && data.urineOutput.trim()) ||
                                (data.medicationName && data.medicationDose && data.medicationTime) ||
                                (data.sideEffects && data.sideEffects.trim());
      
      // Only call saveToHapiFhir if there's vital signs data
      if (hasVitalSignsData) {
        await this.saveToHapiFhir(data, recordDate);
      }
      
      // Save checked medications as MedicationAdministration
      if (checkedMedications.length > 0) {
        console.log('Saving medication administrations:', checkedMedications);
        await this.saveMedicationAdministrations(checkedMedications, recordDate);
      }
      
      console.log('Successfully saved to HAPI FHIR');
      
      Modal.hide('unifiedMonitoringModal');
      
      // Show success message with date info
      const isToday = recordDate === this.ymd(new Date());
      const message = isToday 
        ? 'All monitoring data saved successfully to HAPI FHIR' 
        : `Data saved to HAPI FHIR for ${recordDate}`;
      Utils.showNotification(message, 'success');
      
      form.reset();
      
      // Wait a moment for HAPI FHIR to process the data before refreshing calendar
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // If the saved date is not in the current viewing month, switch to that month
      const savedDate = new Date(recordDate);
      const currentViewYear = this.viewDate.getFullYear();
      const currentViewMonth = this.viewDate.getMonth();
      const savedYear = savedDate.getFullYear();
      const savedMonth = savedDate.getMonth();
      
      if (savedYear !== currentViewYear || savedMonth !== currentViewMonth) {
        // Switch to the month of the saved date
        this.viewDate = new Date(savedYear, savedMonth, 1);
      }
      
      // Refresh calendar to show updated data with new icons
      await this.renderCalendar();
      
      // Refresh sections based on what was saved
      if (isToday) {
        // Determine what needs to be updated based on data saved
        const hasMedicationUpdates = checkedMedications.length > 0;
        const hasVitalSignsUpdates = hasVitalSignsData;
        
        if (hasMedicationUpdates || hasVitalSignsUpdates) {
          // Show "Updating..." state if medications were updated
          if (hasMedicationUpdates) {
            this.showUpdatingState();
          }
          
          try {
            // Wait a bit for HAPI FHIR to process the new data
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Refresh medication table and reload medication data if needed
            if (hasMedicationUpdates) {
              await this.populateMedicationTable();
              await this.loadMedicationData();
            }
            
            // ALWAYS refresh completion status and log reminder when data is saved for today
            await this.checkTodayCompletionStatus();
            this.updateLogReminder();
          } catch (error) {
            console.error('Failed to refresh data:', error);
          } finally {
            if (hasMedicationUpdates) {
              this.hideUpdatingState();
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to save to HAPI FHIR:', err);
      Modal.hide('unifiedMonitoringModal');
      Utils.showNotification('Data saved locally, but failed to sync with HAPI FHIR: ' + err.message, 'warning');
    }
  }

  // Show "Updating..." state for sections being refreshed
  showUpdatingState() {
    console.log('🔄 Showing updating state...');
    
    // Set flag to prevent other updates
    this.isUpdating = true;
    
    // Daily Medication section
    const dueMedsEl = document.getElementById('dueMeds');
    if (dueMedsEl) {
      dueMedsEl.setAttribute('data-original-text', dueMedsEl.textContent);
      dueMedsEl.textContent = '...';
      dueMedsEl.classList.remove('bg-red-500', 'bg-amber-500', 'bg-green-500');
      dueMedsEl.classList.add('bg-gray-400');
    }
    
    // Today's Completion section
    const completionTextEl = document.getElementById('completionText');
    if (completionTextEl) {
      completionTextEl.setAttribute('data-original-text', completionTextEl.textContent);
      completionTextEl.textContent = 'Updating...';
    }
    
    // Log Reminder section
    const logReminderEl = document.getElementById('logReminder');
    if (logReminderEl) {
      logReminderEl.setAttribute('data-original-html', logReminderEl.innerHTML);
      logReminderEl.innerHTML = '<span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full bg-gray-400"></span> Updating...</span>';
      logReminderEl.className = 'text-xs text-gray-500';
    }
    
    // Hide content, show loading for both sections
    const remindersContent = document.getElementById('todayRemindersContent');
    const remindersLoading = document.getElementById('todayRemindersLoading');
    if (remindersContent) remindersContent.classList.add('hidden');
    if (remindersLoading) remindersLoading.classList.remove('hidden');
    
    const completionContent = document.getElementById('todayCompletionContent');
    const completionLoading = document.getElementById('todayCompletionLoading');
    if (completionContent) completionContent.classList.add('hidden');
    if (completionLoading) completionLoading.classList.remove('hidden');
  }

  // Hide "Updating..." state after data is refreshed
  hideUpdatingState() {
    console.log('✅ Hiding updating state...');
    
    // Clear flag FIRST so showRemindersUI/showCompletionUI can execute
    this.isUpdating = false;
    
    // Note: The actual values will be updated by renderReminders() and updateCompletion()
    // This just ensures the loading state is cleared
    const dueMedsEl = document.getElementById('dueMeds');
    if (dueMedsEl) {
      dueMedsEl.removeAttribute('data-original-text');
      // Color will be set by renderReminders()
    }
    
    const completionTextEl = document.getElementById('completionText');
    if (completionTextEl) {
      completionTextEl.removeAttribute('data-original-text');
      // Text will be set by updateCompletion()
    }
    
    // Log Reminder section
    const logReminderEl = document.getElementById('logReminder');
    if (logReminderEl) {
      logReminderEl.removeAttribute('data-original-html');
      // Content will be set by updateLogReminder()
    }
    
    // Manually show content sections (renderReminders/updateCompletion might have been skipped due to isUpdating)
    this.showRemindersUI();
    this.showCompletionUI();
  }

  // Marks a monitoring task as done and updates completion status
  markTaskDone(action) {
    if (action in this.tasks) {
      this.tasks[action] = true;
      this.updateCompletion();
    }
  }

  // Updates completion progress circle and text based on tasks and medications
  updateCompletion() {
    // New calculation: (5 monitoring items completed + medications taken) / (5 monitoring items + total medications due)
    // 5 monitoring items: Blood Pressure, Weight, Temperature, Fluid Intake, Urine Output
    const monitoringItemsCompleted = Object.values(this.tasks).filter(Boolean).length;
    const totalMonitoringItems = Object.keys(this.tasks).length; // Should be 5 items (bloodPressure, weight, temperature, fluidIntake, urineOutput)
    
    const completed = monitoringItemsCompleted + this.medicationsTaken;
    const total = totalMonitoringItems + this.medicationsDue;
    
    // Debug log
    console.log('📊 updateCompletion() called:');
    console.log('  - Tasks:', this.tasks);
    console.log('  - Monitoring items completed:', monitoringItemsCompleted, '/', totalMonitoringItems);
    console.log('  - Medications taken:', this.medicationsTaken, '/', this.medicationsDue);
    console.log('  - Total completion:', completed, '/', total, '=', Math.round((completed/total)*100) + '%');
    
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    Chart.createProgressCircle('completionCircle', pct, { color: '#10B981', size: 80, fontSize: 16 });
    document.getElementById('completionCircle').style.justifyItems = 'center';
    document.getElementById('completionText').textContent = `${completed}/${total} completed`;
    
    // Mark completion as loaded and show UI
    this.completionLoaded = true;
    this.showCompletionUI();
  }
  
  // Shows completion UI after data is loaded
  showCompletionUI() {
    // Don't show UI if we're in updating state - hideUpdatingState() will handle it
    if (this.isUpdating) {
      console.log('⏸️ Skipping showCompletionUI() - currently updating');
      return;
    }
    
    if (this.completionLoaded) {
      const loadingEl = document.getElementById('todayCompletionLoading');
      const contentEl = document.getElementById('todayCompletionContent');
      if (loadingEl) loadingEl.classList.add('hidden');
      if (contentEl) contentEl.classList.remove('hidden');
    }
  }
  
  // Check today's completion status from FHIR data
  // Checks today's completion status from FHIR observations and updates tasks/completion
  async checkTodayCompletionStatus() {
    const today = this.ymd(new Date());
    const patientId = this.getPatientId();
    
    if (!patientId) {
      // No patient ID, just update with current state
      this.updateCompletion();
      return;
    }
    
    try {
      // Fetch today's observations to check which tasks are completed
      const obsUrl = `${this.FHIR_BASE}/Observation?subject=Patient/${patientId}&date=${today}&_count=100`;
      console.log('🔍 Checking today\'s observations from:', obsUrl);
      const obsRes = await fetch(obsUrl);
      
      if (obsRes.ok) {
        const obsBundle = await obsRes.json();
        console.log('Observations for today:', obsBundle);
        
        if (obsBundle.entry) {
          // Check which monitoring items have been recorded today
          obsBundle.entry.forEach(entry => {
            const obs = entry.resource;
            const code = obs.code?.coding?.[0]?.code;
            const display = obs.code?.coding?.[0]?.display || obs.code?.text || 'Unknown';
            
            console.log(`  📝 Observation: code=${code}, display="${display}"`);
            
            // Map LOINC codes to task names
            if (code === '85354-9' || code === '8480-6' || code === '8462-4') {
              this.tasks.bloodPressure = true;
            } else if (code === '29463-7') {
              this.tasks.weight = true;
            } else if (code === '8310-5') {  // Body temperature
              this.tasks.temperature = true;
            } else if (code === '3153-1' || code === '81951-6') {  // 3153-1 or 81951-6 = Intravascular intake 24h
              this.tasks.fluidIntake = true;
            } else if (code === '3167-4') {  // 3167-4 = Urine output 24h
              this.tasks.urineOutput = true;
            }
          });
          
          console.log('Tasks status after checking observations:', this.tasks);
        }
      }
      
      // Note: medicationsTaken is already set by loadMedicationData()
      // Don't recalculate it here to avoid duplication
      console.log(`✅ Medications already loaded: ${this.medicationsTaken}/${this.medicationsDue}`);
      
    } catch (error) {
      console.error('Failed to check today completion status:', error);
    }
    
    // Update completion UI with loaded data
    console.log(`📊 Final completion: ${Object.values(this.tasks).filter(Boolean).length} tasks + ${this.medicationsTaken} meds = ${Object.values(this.tasks).filter(Boolean).length + this.medicationsTaken}/${Object.keys(this.tasks).length + this.medicationsDue}`);
    this.updateCompletion();
  }

  // ========== HAPI FHIR Integration Methods ==========

  // Get current patient ID
  // Returns current patient ID from user or FHIR data
  getPatientId() {
    return this.currentUser?.fhir?.patientId || this.fhirData?.patient?.id || null;
  }

  // Get current ISO timestamp with local timezone
  // If date is provided (YYYY-MM-DD), use that date with current time
  // Otherwise use current date and time
  // Returns current ISO timestamp with local timezone, optionally for a specific date
  isoNow(dateOverride = null) {
    const now = new Date();
    
    let year, month, day;
    
    if (dateOverride) {
      // Use specified date
      const [y, m, d] = dateOverride.split('-').map(Number);
      year = y;
      month = String(m).padStart(2, '0');
      day = String(d).padStart(2, '0');
    } else {
      // Use current date
      year = now.getFullYear();
      month = String(now.getMonth() + 1).padStart(2, '0');
      day = String(now.getDate()).padStart(2, '0');
    }
    
    // Always use current time
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    
    // Get timezone offset in format +08:00 or -05:00
    const offset = -now.getTimezoneOffset();
    const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, '0');
    const offsetSign = offset >= 0 ? '+' : '-';
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
  }

  // Convert ISO datetime string to local date (YYYY-MM-DD)
  // This handles timezone conversion correctly
  // Converts ISO datetime string to local date (YYYY-MM-DD)
  isoToLocalDate(isoString) {
    if (!isoString) return null;
    const date = new Date(isoString);
    if (isNaN(date)) return null;
    
    // Get local date components (not UTC)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }

  // Convert to number or null
  // Returns null for empty strings, null, undefined, or non-numeric values
  // Converts value to number or null, returns null for empty/non-numeric
  numOrNull(v) {
    // Treat empty strings, null, undefined as null
    if (v == null || (typeof v === 'string' && v.trim() === '')) {
      return null;
    }
    
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Create Observation with Quantity value
  // Creates FHIR Observation resource for a quantity value (e.g., weight, temperature)
  createObsQuantity({ loinc, text, unit, code, value, recordDate }) {
    if (value == null) return null;
    const patientId = this.getPatientId();
    if (!patientId) return null;
    
    return {
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: loinc }], text },
      subject: { reference: `Patient/${patientId}` },
      effectiveDateTime: this.isoNow(recordDate),
      valueQuantity: { value, unit, system: 'http://unitsofmeasure.org', code }
    };
  }

  // Create Blood Pressure Observation (panel with components)
  // Creates FHIR Observation resource for blood pressure panel (systolic/diastolic)
  createObsBloodPressure({ systolic, diastolic, recordDate }) {
    if (systolic == null && diastolic == null) return null;
    const patientId = this.getPatientId();
    if (!patientId) return null;

    const components = [];
    if (systolic != null) {
      components.push({
        code: { coding: [{ system: 'http://loinc.org', code: '8480-6' }], text: 'Systolic blood pressure' },
        valueQuantity: { value: systolic, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' }
      });
    }
    if (diastolic != null) {
      components.push({
        code: { coding: [{ system: 'http://loinc.org', code: '8462-4' }], text: 'Diastolic blood pressure' },
        valueQuantity: { value: diastolic, unit: 'mmHg', system: 'http://unitsofmeasure.org', code: 'mm[Hg]' }
      });
    }

    return {
      resourceType: 'Observation',
      status: 'final',
      category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs' }] }],
      code: { coding: [{ system: 'http://loinc.org', code: '85354-9' }], text: 'Blood pressure panel' },
      subject: { reference: `Patient/${patientId}` },
      effectiveDateTime: this.isoNow(recordDate),
      component: components
    };
  }

  // Create MedicationStatement (patient-reported medication taken)
  // Creates FHIR MedicationStatement resource for patient-reported medication taken
  createMedicationStatement({ name, doseText, timeHHmm, recordDate }) {
    if (!name && !doseText && !timeHHmm) return null;
    const patientId = this.getPatientId();
    if (!patientId) return null;

    let when = this.isoNow(recordDate);
    
    // If specific time is provided, use that time on the record date
    if (timeHHmm && recordDate) {
      const now = new Date();
      const offset = -now.getTimezoneOffset();
      const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
      const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, '0');
      const offsetSign = offset >= 0 ? '+' : '-';
      
      when = `${recordDate}T${timeHHmm}:00${offsetSign}${offsetHours}:${offsetMinutes}`;
    }

    return {
      resourceType: 'MedicationStatement',
      status: 'completed',
      medicationCodeableConcept: { text: name || 'Patient-reported medication' },
      subject: { reference: `Patient/${patientId}` },
      effectiveDateTime: when,
      dateAsserted: this.isoNow(), // When it was recorded (always now)
      dosage: doseText ? [{ text: doseText }] : undefined
    };
  }

  // Create Communication resource for patient's side effects/symptoms report
  // Creates FHIR Communication resource for patient-reported side effects or symptoms
  createCommunication({ message, recordDate }) {
    if (!message || !message.trim()) return null;
    const patientId = this.getPatientId();
    if (!patientId) return null;

    // Get practitioner from Patient's generalPractitioner field
    // generalPractitioner is an array of references, e.g., [{ reference: "Practitioner/123" }]
    console.log('📋 Patient data for Communication:', this.fhirData?.patient);
    console.log('📋 generalPractitioner:', this.fhirData?.patient?.generalPractitioner);
    
    const practitionerRef = this.fhirData?.patient?.generalPractitioner?.[0]?.reference;
    console.log('📋 Practitioner reference string:', practitionerRef);
    
    let practitionerId = null;
    if (practitionerRef) {
      // Handle both "Practitioner/123" and full URLs
      if (practitionerRef.includes('/')) {
        const parts = practitionerRef.split('/');
        practitionerId = parts[parts.length - 1]; // Get last part (ID)
      }
    }
    console.log('📋 Extracted practitioner ID:', practitionerId);

    // Build Communication resource
    const communication = {
      resourceType: 'Communication',
      status: 'in-progress',
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/communication-category',
          code: 'notification'
        }]
      }],
      subject: { reference: `Patient/${patientId}` },
      sender: { reference: `Patient/${patientId}` },
      sent: this.isoNow(recordDate),
      payload: [{
        contentString: message.trim()
      }]
    };

    // Add recipient - this should ALWAYS be included if patient has generalPractitioner
    if (practitionerId) {
      communication.recipient = [{ reference: `Practitioner/${practitionerId}` }];
      console.log(`✅ Communication recipient added: Practitioner/${practitionerId}`);
    } else {
      console.error('❌ ERROR: No practitioner ID found! Patient should have generalPractitioner.');
      console.error('Patient data:', this.fhirData?.patient);
    }

    return communication;
  }

  // Post FHIR Bundle transaction to HAPI FHIR
  // Posts a FHIR Bundle transaction to HAPI FHIR server
  async postBundle(resources) {
    const entries = resources
      .filter(Boolean)
      .map(r => ({
        resource: r,
        request: { method: 'POST', url: r.resourceType }
      }));

    if (!entries.length) {
      throw new Error('No data to submit');
    }

    const bundle = { 
      resourceType: 'Bundle', 
      type: 'transaction', 
      entry: entries 
    };

    console.log('Posting bundle to HAPI FHIR:', bundle);

    const res = await fetch(this.FHIR_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/fhir+json' },
      body: JSON.stringify(bundle)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`FHIR error ${res.status}: ${text}`);
    }

    return res.json();
  }

  // Save monitoring data to HAPI FHIR
  // Saves monitoring data to HAPI FHIR: creates resources and posts bundle
  async saveToHapiFhir(data, recordDate = null) {
    recordDate = recordDate || data.recordDate || null; // Get selected date
    const systolic = this.numOrNull(data.systolic);
    const diastolic = this.numOrNull(data.diastolic);
    const weight = this.numOrNull(data.weight);
    const temp = this.numOrNull(data.temperature);
    const intake = this.numOrNull(data.fluidIntake);
    const urine = this.numOrNull(data.urineOutput);
    const medName = data.medicationName || '';
    const medDose = data.medicationDose || '';
    const medTime = data.medicationTime || '';
    const sideNotes = data.sideEffects || '';

    console.log('Recording data for date:', recordDate || 'today');

    const resources = [
      this.createObsBloodPressure({ systolic, diastolic, recordDate }),
      this.createObsQuantity({ loinc: '29463-7', text: 'Body weight', unit: 'kg', code: 'kg', value: weight, recordDate }),
      this.createObsQuantity({ loinc: '8310-5', text: 'Body temperature', unit: 'Cel', code: 'Cel', value: temp, recordDate }),
      this.createObsQuantity({ loinc: '3153-1', text: 'Intravascular intake 24h', unit: 'mL', code: 'mL', value: intake, recordDate }),
      this.createObsQuantity({ loinc: '3167-4', text: 'Urine output 24h', unit: 'mL', code: 'mL', value: urine, recordDate }),
      this.createMedicationStatement({ name: medName, doseText: medDose, timeHHmm: medTime, recordDate }),
      // Changed from Observation to Communication for side effects/symptoms
      this.createCommunication({ message: sideNotes, recordDate })
    ];

    return this.postBundle(resources);
  }

  // Save medication administrations to HAPI FHIR
  async saveMedicationAdministrations(checkedMedications, recordDate) {
    const patientId = this.getPatientId();
    if (!patientId) {
      throw new Error('No patient ID available');
    }

    console.log('=== Saving MedicationAdministrations ===');
    console.log('Checked medications:', checkedMedications);

    const resources = [];

    for (const med of checkedMedications) {
      console.log('Processing medication:', med);
      // Determine SNOMED code based on unit
      let snomedCode = '428673006'; // default: tablet
      const unitLower = (med.doseUnit || '').toLowerCase();
      
      if (unitLower.includes('capsule')) {
        snomedCode = '428641000'; // capsule
      } else if (unitLower.includes('tablet')) {
        snomedCode = '428673006'; // tablet
      }

      // Build route coding - use existing route coding if available
      let routeCoding = {
        system: 'http://snomed.info/sct',
        code: '26643006',
        display: 'Oral route (qualifier value)'
      };
      
      if (med.routeCoding) {
        routeCoding = med.routeCoding;
      }

      // Generate effectiveDateTime based on recordDate and timing
      // Map timing codes to typical hours
      const timingHours = {
        'ACM': 7,   // Before Breakfast - 7:00
        'MORN': 8,  // Morning - 8:00
        'PCM': 9,   // After Breakfast - 9:00
        'ACL': 11,  // Before Lunch - 11:00
        'NOON': 12, // Noon - 12:00
        'PCL': 13,  // After Lunch - 13:00
        'ACD': 17,  // Before Dinner - 17:00
        'EVE': 18,  // Evening - 18:00
        'PCD': 19,  // After Dinner - 19:00
        'NIGHT': 21, // Night - 21:00
        'HS': 22    // At Bedtime - 22:00
      };
      
      const hour = timingHours[med.timing] || 12; // Default to noon if timing not found
      
      // Parse recordDate (YYYY-MM-DD) and create Date object with specific hour
      const [year, month, day] = recordDate.split('-').map(Number);
      const dateTime = new Date(year, month - 1, day, hour, 0, 0);
      const effectiveDateTime = this.dateToISOWithTimezone(dateTime);
      
      console.log(`Creating MedicationAdministration: timing=${med.timing}, recordDate=${recordDate}, effectiveDateTime=${effectiveDateTime}`);

      const medAdmin = {
        resourceType: 'MedicationAdministration',
        status: 'completed',
        subject: { reference: `Patient/${patientId}` },
        effectiveDateTime: effectiveDateTime,
        request: { reference: `MedicationRequest/${med.medRequestId}` },
        dosage: {
          route: {
            coding: [routeCoding],
            text: med.route
          },
          dose: {
            value: parseFloat(med.doseValue) || 0,
            unit: med.doseUnit,
            system: 'http://snomed.info/sct',
            code: snomedCode
          },
          // Store timing code in text field for matching
          text: `Timing: ${med.timing || 'UNSPECIFIED'}`
        },
        // Store timing code in note for easier retrieval
        note: [{
          text: `timing:${med.timing || 'UNSPECIFIED'}`
        }]
      };

      resources.push(medAdmin);
    }

    if (resources.length > 0) {
      return this.postBundle(resources);
    }
  }

  // Load observations for a specific date from HAPI FHIR
  async loadDayDataFromFhir(dateKey) {
    const patientId = this.getPatientId();
    if (!patientId) {
      console.warn('No patient ID available for loading day data');
      return [];
    }

    try {
      // dateKey format: YYYY-MM-DD (local timezone date)
      // We need to query all resources that, when converted to local timezone, fall on this date
      // Strategy: query a wider range and then filter by local date
      
      const [year, month, day] = dateKey.split('-').map(Number);
      const localStart = new Date(year, month - 1, day, 0, 0, 0);
      const localEnd = new Date(year, month - 1, day, 23, 59, 59);
      
      // Convert to ISO with timezone (for logging)
      const startISO = this.dateToISOWithTimezone(localStart);
      const endISO = this.dateToISOWithTimezone(localEnd);
      
      console.log(`Querying HAPI FHIR for date ${dateKey} (${startISO} to ${endISO})`);

      // For FHIR query, we use the date part only and filter results by local date after
      const queryDate = dateKey; // YYYY-MM-DD
      
      // Fetch Observations - use date parameter (FHIR will match any time on this UTC date)
      // We'll filter by local date after fetching
      const obsUrl = `${this.FHIR_BASE}/Observation?subject=Patient/${patientId}&date=${queryDate}&_sort=-date&_count=300`;
      const obsRes = await fetch(obsUrl);
      
      const entries = [];
      
      if (obsRes.ok) {
        const obsBundle = await obsRes.json();
        if (obsBundle.entry) {
          obsBundle.entry.forEach(entry => {
            const obs = entry.resource;
            const obsDateTime = obs.effectiveDateTime || obs.issued;
            // Filter: only include if local date matches
            if (obsDateTime && this.isoToLocalDate(obsDateTime) === dateKey) {
              entries.push(this.formatObservationForDisplay(obs));
            }
          });
        }
      }

      // Fetch MedicationStatements for this date
      const medUrl = `${this.FHIR_BASE}/MedicationStatement?subject=Patient/${patientId}&effective=${queryDate}&_sort=-effective&_count=100`;
      const medRes = await fetch(medUrl);
      
      if (medRes.ok) {
        const medBundle = await medRes.json();
        if (medBundle.entry) {
          medBundle.entry.forEach(entry => {
            const med = entry.resource;
            const medDateTime = med.effectiveDateTime;
            // Filter: only include if local date matches
            if (medDateTime && this.isoToLocalDate(medDateTime) === dateKey) {
              entries.push(this.formatMedicationForDisplay(med));
            }
          });
        }
      }

      // Fetch MedicationAdministrations for this date
      const medAdminUrl = `${this.FHIR_BASE}/MedicationAdministration?subject=Patient/${patientId}&effective-time=${queryDate}&_count=100&_include=MedicationAdministration:request`;
      const medAdminRes = await fetch(medAdminUrl);
      
      if (medAdminRes.ok) {
        const medAdminBundle = await medAdminRes.json();
        if (medAdminBundle.entry) {
          // Create a map of MedicationRequest ID to medication name
          const medRequestMap = new Map();
          medAdminBundle.entry.forEach(entry => {
            if (entry.resource.resourceType === 'MedicationRequest') {
              const medReq = entry.resource;
              const medName = medReq.medicationCodeableConcept?.text || 
                             medReq.medicationCodeableConcept?.coding?.[0]?.display || null;
              if (medName) {
                medRequestMap.set(medReq.id, medName);
              }
            }
          });
          
          medAdminBundle.entry.forEach(entry => {
            if (entry.resource.resourceType === 'MedicationAdministration') {
              const medAdmin = entry.resource;
              const effectiveDateTime = medAdmin.effectiveDateTime || medAdmin.effectivePeriod?.start;
              if (effectiveDateTime && this.isoToLocalDate(effectiveDateTime) === dateKey) {
                entries.push(this.formatMedicationAdministrationForDisplay(medAdmin, medRequestMap));
              }
            }
          });
        }
      }

      // Fetch Communications for this date (patient's side effects/notes)
      const commUrl = `${this.FHIR_BASE}/Communication?subject=Patient/${patientId}&sent=${queryDate}&_count=100`;
      const commRes = await fetch(commUrl);
      
      if (commRes.ok) {
        const commBundle = await commRes.json();
        if (commBundle.entry) {
          commBundle.entry.forEach(entry => {
            const comm = entry.resource;
            const sentDateTime = comm.sent;
            if (sentDateTime && this.isoToLocalDate(sentDateTime) === dateKey) {
              entries.push(this.formatCommunicationForDisplay(comm));
            }
          });
        }
      }

      console.log(`Loaded ${entries.length} entries for ${dateKey} from HAPI FHIR`);
      return entries.filter(Boolean);
      
    } catch (err) {
      console.error('Failed to load day data from HAPI FHIR:', err);
      return [];
    }
  }

  // Helper: Convert Date object to ISO string with timezone
  dateToISOWithTimezone(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    const offset = -date.getTimezoneOffset();
    const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const offsetMinutes = String(Math.abs(offset) % 60).padStart(2, '0');
    const offsetSign = offset >= 0 ? '+' : '-';
    
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMinutes}`;
  }

  // Debug: Test timezone handling
  debugTimezone() {
    console.group('🕐 Timezone Debug Info');
    const now = new Date();
    
    console.log('Current Time:');
    console.log('  Local:', now.toString());
    console.log('  UTC:', now.toUTCString());
    console.log('  ISO (UTC):', now.toISOString());
    
    console.log('\nTimezone:');
    console.log('  Offset minutes:', -now.getTimezoneOffset());
    console.log('  Offset hours:', -now.getTimezoneOffset() / 60);
    
    console.log('\nGenerated Values:');
    console.log('  isoNow():', this.isoNow());
    console.log('  ymd(now):', this.ymd(now));
    console.log('  isoToLocalDate(isoNow()):', this.isoToLocalDate(this.isoNow()));
    
    console.log('\nConsistency Check:');
    const expected = this.ymd(now);
    const actual = this.isoToLocalDate(this.isoNow());
    console.log('  Expected date:', expected);
    console.log('  Actual date:', actual);
    console.log('  Match?', expected === actual ? '✅ YES' : '❌ NO');
    
    console.groupEnd();
  }

  // Format Observation for display
  formatObservationForDisplay(obs) {
    if (!obs) return null;
    
    const time = obs.effectiveDateTime ? new Date(obs.effectiveDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    
    // Format lastUpdated as "MMM DD YYYY\nHH:MM AM/PM"
    let lastUpdated = '';
    if (obs.meta?.lastUpdated) {
      const date = new Date(obs.meta.lastUpdated);
      const datePart = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
      });
      const timePart = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
      });
      lastUpdated = `${datePart}\n${timePart}`;
    }
    
    const codeText = obs.code?.text || obs.code?.coding?.[0]?.display || 'Observation';
    const loincCode = obs.code?.coding?.[0]?.code;
    let text = '';
    let category = 'vital';

    // Handle different types of observations
    if (obs.component && obs.component.length > 0) {
      // Blood pressure panel
      const systolic = obs.component.find(c => c.code?.coding?.some(cd => cd.code === '8480-6'));
      const diastolic = obs.component.find(c => c.code?.coding?.some(cd => cd.code === '8462-4'));
      if (systolic && diastolic) {
        text = `Blood Pressure: ${systolic.valueQuantity?.value}/${diastolic.valueQuantity?.value} mmHg`;
      }
    } else if (obs.valueQuantity) {
      // Map LOINC codes to standard names
      let itemName = codeText;
      if (loincCode === '29463-7') {
        itemName = 'Weight';
      } else if (loincCode === '8310-5') {
        itemName = 'Body Temperature';
      } else if (loincCode === '3153-1' || loincCode === '81951-6') {
        itemName = 'Fluid Intake';
      } else if (loincCode === '3167-4') {
        itemName = 'Urine Output';
      }
      
      text = `${itemName}: ${obs.valueQuantity.value} ${obs.valueQuantity.unit || obs.valueQuantity.code || ''}`;
    } else if (obs.valueString) {
      text = `${codeText}: ${obs.valueString}`;
      category = 'sideEffects';
    } else {
      text = codeText;
    }

    return { category, time, text, lastUpdated };
  }

  // Format MedicationStatement for display
  formatMedicationForDisplay(med) {
    if (!med) return null;
    
    const time = med.effectiveDateTime ? new Date(med.effectiveDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    
    // Format lastUpdated as "MMM DD YYYY\nHH:MM AM/PM"
    let lastUpdated = '';
    if (med.meta?.lastUpdated) {
      const date = new Date(med.meta.lastUpdated);
      const datePart = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
      });
      const timePart = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
      });
      lastUpdated = `${datePart}\n${timePart}`;
    }
    
    const medName = med.medicationCodeableConcept?.text || 'Medication';
    const dose = med.dosage?.[0]?.text || '';
    
    return { 
      category: 'medication', 
      time: time,
      text: `Medication: ${medName}${dose ? '\n' + dose : ''}`,
      lastUpdated
    };
  }

  // Format MedicationAdministration for display
  formatMedicationAdministrationForDisplay(medAdmin, medRequestMap = null) {
    if (!medAdmin) return null;
    
    console.log('📋 Formatting MedicationAdministration:', medAdmin);
    
    const time = medAdmin.effectiveDateTime ? new Date(medAdmin.effectiveDateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    
    // Try to get medication name from medicationCodeableConcept first
    let medName = medAdmin.medicationCodeableConcept?.text || 
                  medAdmin.medicationCodeableConcept?.coding?.[0]?.display || null;
    
    // If not found, try to get from the medRequestMap (passed from loadDayDataFromFhir)
    if (!medName && medRequestMap && medAdmin.request?.reference) {
      const requestRef = medAdmin.request.reference; // e.g., "MedicationRequest/123"
      const medRequestId = requestRef.split('/')[1];
      medName = medRequestMap.get(medRequestId) || null;
      console.log('  - Looking up from medRequestMap:', medRequestId, '→', medName);
    }
    
    // If still not found, try to get from fhirData.medRequests
    if (!medName && medAdmin.request?.reference) {
      const requestRef = medAdmin.request.reference; // e.g., "MedicationRequest/123"
      const medRequestId = requestRef.split('/')[1];
      
      // Look up the medication name from fhirData.medRequests
      const medRequest = this.fhirData?.medRequests?.find(mr => mr.id === medRequestId);
      if (medRequest) {
        medName = medRequest.medicationCodeableConcept?.text || 
                  medRequest.medicationCodeableConcept?.coding?.[0]?.display || null;
        console.log('  - Looking up from fhirData.medRequests:', medRequestId, '→', medName);
      }
    }
    
    // Fallback to "Medication" if still not found
    medName = medName || 'Medication';
    
    console.log('  - Final Medication Name:', medName);
    
    // Get dose value and unit
    const doseValue = medAdmin.dosage?.dose?.value || '';
    const doseUnit = medAdmin.dosage?.dose?.unit || '';
    const dose = doseValue && doseUnit ? `${doseValue} ${doseUnit}` : '';
    
    console.log('  - Dose:', dose);
    
    // Extract timing code from dosage.text (format: "Timing: ACM") or note
    let timingCode = '';
    const dosageText = medAdmin.dosage?.text || '';
    const timingMatch = dosageText.match(/Timing:\s*(\w+)/);
    if (timingMatch) {
      timingCode = timingMatch[1];
    } else if (medAdmin.note && medAdmin.note.length > 0) {
      // Try to get from note field (format: "timing:ACM")
      const noteText = medAdmin.note[0].text || '';
      const noteMatch = noteText.match(/timing:(\w+)/);
      if (noteMatch) {
        timingCode = noteMatch[1];
      }
    }
    
    console.log('  - Timing Code:', timingCode);
    
    // Map timing codes to full text labels
    const timingLabels = {
      'MORN': 'Morning',
      'NOON': 'Noon',
      'EVE': 'Evening',
      'NIGHT': 'Night',
      'ACM': 'Before Breakfast',
      'ACL': 'Before Lunch',
      'ACD': 'Before Dinner',
      'PCM': 'After Breakfast',
      'PCL': 'After Lunch',
      'PCD': 'After Dinner',
      'HS': 'At Bedtime'
    };
    
    const timingLabel = timingLabels[timingCode] || timingCode;
    
    console.log('  - Timing Label:', timingLabel);
    
    // Format: Medication name with line break before dose and timing
    // Example: Mycophenolate mofetil 500 mg tablet :
    //          2 tablet (Before Breakfast)
    let text = medName + ' :';
    if (dose) {
      text += `\n${dose}`;
    }
    if (timingLabel) {
      text += ` (${timingLabel})`;
    }
    
    console.log('  - Final Text:', text);
    
    // Format lastUpdated as "MMM DD YYYY\nHH:MM AM/PM"
    let lastUpdated = '';
    if (medAdmin.meta?.lastUpdated) {
      const date = new Date(medAdmin.meta.lastUpdated);
      const datePart = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
      });
      const timePart = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
      });
      lastUpdated = `${datePart}\n${timePart}`;
    }
    
    return { 
      category: 'medication', 
      time: time,
      text: text,
      lastUpdated
    };
  }

  // Format Communication for display
  formatCommunicationForDisplay(comm) {
    if (!comm) return null;
    
    const time = comm.sent ? new Date(comm.sent).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '';
    
    // Format lastUpdated as "MMM DD YYYY\nHH:MM AM/PM"
    let lastUpdated = '';
    if (comm.meta?.lastUpdated) {
      const date = new Date(comm.meta.lastUpdated);
      const datePart = date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: 'numeric'
      });
      const timePart = date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
      });
      lastUpdated = `${datePart}\n${timePart}`;
    }
    
    const message = comm.payload?.[0]?.contentString || 'No message';
    const status = comm.status || 'unknown';
    
    // Format: first line is message, second line is status
    const textWithStatus = `${message}\nStatus: ${status}`;
    
    return { 
      category: 'sideEffects', 
      time: time,
      text: textWithStatus,
      lastUpdated
    };
  }

  // Load month overview from HAPI FHIR to update calendar
  async loadMonthDataFromFhir(year, month) {
    const patientId = this.getPatientId();
    if (!patientId) return;

    try {
      const firstDay = new Date(year, month, 1);
      const lastDay = new Date(year, month + 1, 0);
      const startDate = firstDay.toISOString().split('T')[0];
      const endDate = lastDay.toISOString().split('T')[0];

      console.log(`Loading month data from HAPI FHIR: ${startDate} to ${endDate}`);

      // Fetch all observations for this month
      const obsUrl = `${this.FHIR_BASE}/Observation?subject=Patient/${patientId}&date=ge${startDate}&date=le${endDate}&_count=500`;
      const obsRes = await fetch(obsUrl);

      if (obsRes.ok) {
        const obsBundle = await obsRes.json();
        if (obsBundle.entry) {
          obsBundle.entry.forEach(entry => {
            const obs = entry.resource;
            const dateTime = obs.effectiveDateTime || obs.issued;
            if (dateTime) {
              // Convert UTC time to local date
              const dateKey = this.isoToLocalDate(dateTime);
              if (!dateKey) return;
              
              if (!this.patientLogs[dateKey]) {
                this.patientLogs[dateKey] = [];
              }
              // Mark that this day has data (don't duplicate if already exists)
              const formatted = this.formatObservationForDisplay(obs);
              if (formatted && !this.patientLogs[dateKey].includes(formatted)) {
                this.patientLogs[dateKey].push(formatted);
              }
            }
          });
        }
      }

      // Fetch medication statements for this month
      const medUrl = `${this.FHIR_BASE}/MedicationStatement?subject=Patient/${patientId}&effective=ge${startDate}&effective=le${endDate}&_count=500`;
      const medRes = await fetch(medUrl);

      if (medRes.ok) {
        const medBundle = await medRes.json();
        if (medBundle.entry) {
          medBundle.entry.forEach(entry => {
            const med = entry.resource;
            const dateTime = med.effectiveDateTime;
            if (dateTime) {
              // Convert UTC time to local date
              const dateKey = this.isoToLocalDate(dateTime);
              if (!dateKey) return;
              
              if (!this.patientLogs[dateKey]) {
                this.patientLogs[dateKey] = [];
              }
              const formatted = this.formatMedicationForDisplay(med);
              if (formatted && !this.patientLogs[dateKey].includes(formatted)) {
                this.patientLogs[dateKey].push(formatted);
              }
            }
          });
        }
      }

      console.log(`Loaded month data. Days with entries:`, Object.keys(this.patientLogs).filter(k => k.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)));
    } catch (err) {
      console.error('Failed to load month data from HAPI FHIR:', err);
    }
  }

  pushLog(action, data, dateKey = null) {
    const time = Utils.formatDate(new Date(), 'HH:mm');
    let text = '';
    switch (action) {
      case 'bloodPressure': text = `${time} BP ${data.systolic}/${data.diastolic} mmHg`; break;
      case 'weight':        text = `${time} Weight ${data.weight} kg`; break;
      case 'temperature':   text = `${time} Temp ${data.temperature} °C`; break;
      case 'fluidIntake':   text = `${time} Fluid ${data.fluid} ml`; break;
      case 'urineOutput':   text = `${time} Urine ${data.urine} ml`; break;
      case 'medication': {
        const t = data.medTime;
        let formattedTime = t;
        if (t) {
          const timeObj = new Date(`2000-01-01T${t}`);
          if (!isNaN(timeObj)) {
            formattedTime = timeObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
          }
        }
        text = `${time} Medication ${data.medName} ${data.medDose} @ ${formattedTime}`;
        break;
      }
      case 'sideEffects':   text = `${time} Side effects: ${data.sideEffects}`; break;
    }
    if (text) {
      // Use provided dateKey or default to today
      const targetDate = dateKey || this.ymd(new Date());
      
      // Add to patient logs for the specified date
      if (!Array.isArray(this.patientLogs[targetDate])) this.patientLogs[targetDate] = [];
      this.patientLogs[targetDate].push(text);
      
      // Only add to general logs and update UI if it's for today
      if (targetDate === this.ymd(new Date())) {
        this.logs.unshift(text);
        this.renderLogs?.();
      }

      this.renderCalendar?.();
      this.updateLogReminder?.();
    }
  }

  renderLogs() {
    const list = document.getElementById('todayLogs');
    const empty = document.getElementById('emptyLogs');
    if (!list || !empty) return; // prevent errors when elements don't exist

    list.innerHTML = '';
    if (this.logs.length === 0) {
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    this.logs.slice(0, 10).forEach(line => {
      const li = document.createElement('li');
      li.textContent = '• ' + line;
      list.appendChild(li);
    });
  }

  async openMedicationList() {
    // Open the unified monitoring modal
    await this.openUnifiedMonitoringModal();
    
    // Wait for modal to be fully shown, then scroll to medication section
    setTimeout(() => {
      const medicationSection = document.querySelector('#medicationTableContainer')?.closest('fieldset');
      if (medicationSection) {
        medicationSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Add a brief highlight effect
        medicationSection.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2');
        setTimeout(() => {
          medicationSection.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2');
        }, 2000);
      }
    }, 300);
  }

  toggleMedication(id) {
    const medication = this.tempMedStates.find(med => med.id === id);
    if (medication) {
      medication.taken = !medication.taken;
      
      // Update the status text in the modal
      const container = document.getElementById('med-' + id).closest('div');
      const statusDiv = container.querySelector('div:last-child');
      statusDiv.textContent = medication.taken ? 'Taken' : 'Not taken';
      statusDiv.className = 'text-sm ' + (medication.taken ? 'text-green-600' : 'text-amber-500');
    }
  }

  saveMedicationChanges() {
    // Save the temporary states to the actual medication list
    this.todayMedications = JSON.parse(JSON.stringify(this.tempMedStates));
    
    // Update the counter
    this.updateMedicationDueCount();
    
    // Create log entries for taken medications
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    
    this.todayMedications.forEach(med => {
      if (med.taken) {
        this.pushLog('medication', {
          medName: med.name,
          medDose: med.dose,
          medTime: timeStr
        });
      }
    });

    // Show success message
    Utils.showNotification('Medication status saved successfully', 'success');
    
    // Close the modal
    Modal.hide('medicationListModal');
  }

  updateMedicationDueCount() {
    // Calculate remaining medications (not taken yet)
    const remainingMedications = this.medicationsDue - this.medicationsTaken;
    const dueElement = document.getElementById('dueMeds');
    
    if (dueElement) {
      // Display remaining medications count
      dueElement.textContent = remainingMedications;
      
      // Update badge color based on remaining medications
      // Remove all color classes first
      dueElement.classList.remove('bg-red-500', 'bg-amber-500', 'bg-green-500');
      
      if (remainingMedications === 0) {
        // All medications taken - green
        dueElement.classList.add('bg-green-500');
      } else if (remainingMedications > 0 && remainingMedications < this.medicationsDue) {
        // Some taken but not all - orange/amber
        dueElement.classList.add('bg-amber-500');
      } else {
        // None taken - red
        dueElement.classList.add('bg-red-500');
      }
    }
  }

  updatePatientVerification() {
    const box = document.getElementById('patientVerify');
    const msg = document.getElementById('patientVerifyMsg');
    if (!box || !msg) return;
    box.classList.remove('hidden');
    const storedPid = this.currentUser?.fhir?.patientId;
    const bundlePid = this.fhirData?.patient?.id;
    if (!storedPid && !bundlePid) {
      box.className = 'mt-4 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800';
      msg.textContent = 'No patient context found (using fallback sample).';
    } else if (storedPid && bundlePid && storedPid === bundlePid) {
      box.className = 'mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 hidden';
      msg.textContent = `Patient verified: ${bundlePid}`;
    } else if (bundlePid) {
      box.className = 'mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800';
      const identifier = this.fhirData?.patient?.identifier;
      msg.textContent = `Patient mismatch: stored=${storedPid || 'N/A'} bundle=${bundlePid}${identifier && identifier !== bundlePid ? ' (identifier ' + identifier + ')' : ''}`;
    } else {
      box.className = 'mt-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800';
      msg.textContent = 'Failed to load patient bundle.';
    }
  }

  // ===== CALENDAR METHODS =====

  ymd(d) {
    const tz = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    return tz.toISOString().slice(0, 10);
  }

  humanDate(key) {
    const [y, m, dd] = key.split('-').map(Number);
    return new Date(y, m - 1, dd).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'short'
    });
  }

  hasRequiredEntries(items) {
    // check if all required record types are present
    const patterns = {
      vitals: /\bBP\b|blood\s*pressure|weight|kg\b|temp|temperature|°C|°F/i,
      fluid: /fluid|intake|urine|output/i,
      medication: /med(ication)?|dose|tacrol/i
    };

    return Object.values(patterns).every(pattern => 
      items.some(item => pattern.test(typeof item === 'string' ? item : (item.text || item.short || '')))
    );
  }

  summarizeCategories(items) {
    const set = new Set();
    (items || []).forEach(txt => {
      const s = typeof txt === 'string' ? txt : (txt.text || txt.short || '');
      for (const d of this.detectors) { if (d.test(s)) { set.add(d.cls); break; } }
    });
    return Array.from(set).slice(0, 4);
  }

  async initCalendar() {
    const cal = document.getElementById('logCalendar');
    const header = cal?.previousElementSibling;
    if (header && header.classList.contains('grid')) {
      header.innerHTML = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        .map(d => `<div class="text-center">${d}</div>`).join('');
    }
    await this.renderCalendar();
  }

  async renderCalendar() {
    const cal = document.getElementById('logCalendar');
    const titleEl = document.getElementById('calTitle');
    if (!cal || !titleEl) return;

    const year = this.viewDate.getFullYear();
    const month = this.viewDate.getMonth();
    titleEl.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(this.viewDate);
    
    // Show loading state
    cal.innerHTML = '<div class="col-span-7 text-center py-8 text-gray-500">Loading calendar data from HAPI FHIR...</div>';

    // Load month data from HAPI FHIR
    await this.loadMonthDataFromFhir(year, month);
    
    // Now render the calendar
    cal.innerHTML = '';

    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startIdx = (first.getDay() + 6) % 7; // Monday as start
    const totalCells = 42;
    const todayKey = this.ymd(new Date());

    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - startIdx + 1;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'rounded-lg border p-2 text-left hover:border-blue-400 hover:bg-blue-50 min-h-[64px] flex flex-col justify-between';

      if (dayNum < 1 || dayNum > daysInMonth) {
        cell.classList.add('opacity-30', 'pointer-events-none');
        cal.appendChild(cell);
        continue;
      }

      const d = new Date(year, month, dayNum);
      const key = this.ymd(d);
      const isToday = key === todayKey;
      const items = Array.isArray(this.patientLogs[key]) ? this.patientLogs[key] : [];

      const top = document.createElement('div');
      top.className = 'flex items-center justify-between';
      const dateSpan = document.createElement('span');
      dateSpan.className = `text-sm font-medium ${isToday ? 'bg-blue-100 text-blue-800 px-2 py-1 rounded-full' : ''}`;
      dateSpan.textContent = dayNum;
      top.appendChild(dateSpan);

      const status = document.createElement('div');
      status.className = 'flex items-center justify-center pt-2';
      
      if (items.length > 0) {
        const hasRequired = this.hasRequiredEntries(items);
        console.log(`📅 Date ${key}: ${items.length} items, hasRequired: ${hasRequired}`, items);
        
        if (hasRequired) {
          // all required entries are present - show checkmark
          status.innerHTML = `
            <svg class="h-6 w-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          `;
        } else {
          // some records but not complete - show yellow circle with exclamation mark
          status.innerHTML = `
            <svg class="h-6 w-6 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          `;
        }
      }

      cell.appendChild(top);
      cell.appendChild(status);
      cell.addEventListener('click', () => this.openDayDetail(key));
      cal.appendChild(cell);
    }

    this.updateLogReminder();
  }

  // Open the modal to show entries for a specific day
  async openDayDetail(key) {
    const modal = document.getElementById('dayDetailModal');
    const list = document.getElementById('dayDetailList');
    const empty = document.getElementById('dayDetailEmpty');
    const dateEl = document.getElementById('dayDetailDate');
    if (!modal) return;

    dateEl.textContent = this.humanDate(key) + ' - Report Log';
    list.innerHTML = '<p class="text-gray-500 italic">Loading data from HAPI FHIR...</p>';
    
    // Show modal first
    Modal.show ? Modal.show('dayDetailModal') : (modal.classList.remove('hidden'), modal.classList.add('flex'));

    try {
      // Load data from HAPI FHIR only (not from localStorage)
      const fhirEntries = await this.loadDayDataFromFhir(key);

      // Categorize entries
      const categorized = {
        vital: [],
        medication: [],
        sideEffects: []
      };

      fhirEntries.forEach(entry => {
        if (entry && entry.category && categorized[entry.category]) {
          categorized[entry.category].push(entry);
        }
      });

      // Display results in table format
      list.innerHTML = '';
      
      const totalEntries = fhirEntries.length;
      
      if (totalEntries > 0) {
        empty.classList.add('hidden');
        
        // Create table
        const table = document.createElement('table');
        table.className = 'w-full text-sm border-collapse';
        
        // Table header
        const thead = document.createElement('thead');
        thead.innerHTML = `
          <tr class="border-b bg-gray-50">
            <th class="text-left px-3 py-2 font-semibold">Category</th>
            <th class="text-left px-3 py-2 font-semibold" style="min-width: 90px;">Time</th>
            <th class="text-left px-3 py-2 font-semibold">Details</th>
            <th class="text-left px-3 py-2 font-semibold" style="min-width: 120px;">Last Updated</th>
          </tr>
        `;
        table.appendChild(thead);
        
        // Table body
        const tbody = document.createElement('tbody');
        
        // Add Vital Signs
        if (categorized.vital.length > 0) {
          categorized.vital.forEach(entry => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            tr.innerHTML = `
              <td class="px-3 py-2"><span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">Vital Sign</span></td>
              <td class="px-3 py-2" style="min-width: 90px;">${entry.time}</td>
              <td class="px-3 py-2" style="white-space: pre-line;">${entry.text}</td>
              <td class="px-3 py-2 text-xs text-gray-500" style="min-width: 120px; white-space: pre-line;">${entry.lastUpdated || 'N/A'}</td>
            `;
            tbody.appendChild(tr);
          });
        }
        
        // Add Medications
        if (categorized.medication.length > 0) {
          categorized.medication.forEach(entry => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            tr.innerHTML = `
              <td class="px-3 py-2"><span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Medication</span></td>
              <td class="px-3 py-2" style="min-width: 90px;">${entry.time}</td>
              <td class="px-3 py-2" style="white-space: pre-line;">${entry.text}</td>
              <td class="px-3 py-2 text-xs text-gray-500" style="min-width: 120px; white-space: pre-line;">${entry.lastUpdated || 'N/A'}</td>
            `;
            tbody.appendChild(tr);
          });
        }
        
        // Add Side Effects / Notes
        if (categorized.sideEffects.length > 0) {
          categorized.sideEffects.forEach(entry => {
            const tr = document.createElement('tr');
            tr.className = 'border-b hover:bg-gray-50';
            tr.innerHTML = `
              <td class="px-3 py-2"><span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-amber-100 text-amber-800">Note</span></td>
              <td class="px-3 py-2" style="min-width: 90px;">${entry.time}</td>
              <td class="px-3 py-2" style="white-space: pre-line;">${entry.text}</td>
              <td class="px-3 py-2 text-xs text-gray-500" style="min-width: 120px; white-space: pre-line;">${entry.lastUpdated || 'N/A'}</td>
            `;
            tbody.appendChild(tr);
          });
        }
        
        table.appendChild(tbody);
        list.appendChild(table);
        
        // Add summary
        const summary = document.createElement('p');
        summary.className = 'mt-3 pt-3 border-t text-xs text-gray-500 italic';
        summary.textContent = `Total: ${totalEntries} entries (${categorized.vital.length} vital signs, ${categorized.medication.length} medications, ${categorized.sideEffects.length} notes)`;
        list.appendChild(summary);
      } else {
        empty.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Failed to load day detail:', err);
      list.innerHTML = `<li class="text-red-600">Failed to load data: ${err.message}</li>`;
    }
  }

  updateLogReminder() {
    const el = document.getElementById('logReminder');
    if (!el) return;
    
    // Calculate total tasks that should be completed today
    // Monitoring tasks: 5 items (BP counts as 1, Weight, Temperature, Fluid Intake, Urine Output)
    // Medication tasks: medicationsDue (number of medication doses)
    const monitoringTasks = Object.keys(this.tasks).length; // Should be 5
    const completedMonitoring = Object.values(this.tasks).filter(Boolean).length;
    const totalTasksExpected = monitoringTasks + this.medicationsDue;
    const completedCount = completedMonitoring + this.medicationsTaken;
    const remaining = totalTasksExpected - completedCount;
    
    console.log('📋 updateLogReminder() debug:');
    console.log('  - Monitoring tasks (total):', monitoringTasks);
    console.log('  - Monitoring completed:', completedMonitoring);
    console.log('  - Medication doses (total):', this.medicationsDue);
    console.log('  - Medication taken:', this.medicationsTaken);
    console.log('  - Total tasks expected:', totalTasksExpected);
    console.log('  - Completed count:', completedCount);
    console.log('  - Remaining:', remaining);
    
    if (completedCount === 0 && totalTasksExpected > 0) {
      // No tasks completed at all - red warning
      el.innerHTML = '<span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full bg-rose-500"></span> Don\'t forget to log today\'s data</span>';
      el.className = 'text-xs text-rose-600';
    } else if (remaining > 0) {
      // Some tasks completed but not all - amber warning
      el.innerHTML = `<span class="inline-flex items-center gap-1"><span class="h-2 w-2 rounded-full bg-amber-500"></span> ${remaining} task${remaining > 1 ? 's' : ''} remaining</span>`;
      el.className = 'text-xs text-amber-600';
    } else {
      // All tasks completed - green success
      el.textContent = 'All set for today';
      el.className = 'text-xs text-emerald-600';
    }
  }

  // Sort suggestion articles based on patient health data using AI
  async sortSuggestionArticles() {
    try {
      console.log('🤖 Sorting suggestion articles with AI...');
      
      // Get patient health data (now async to fetch Communications)
      const patientData = await this.getPatientHealthSummary();
      
      // Define articles
      const articles = [
        {
          id: 1,
          title: "Post-Transplant Daily Care Essentials",
          subtitle: "Lifestyle, exercise, sleep, and self-monitoring tips",
          description: "Congratulations on your kidney transplant! Begin your new chapter with healthy daily routines. Maintain 7–8 hours of sleep, avoid smoking, limit alcohol, stay hydrated, and practice good hygiene to prevent infections. Exercise regularly—start with walking 10–15 min daily, progress to 30 min, and consider swimming, cycling, or yoga after recovery. Always consult your healthcare team before new activities. Monitor your health: track daily weight, check blood pressure, temperature, and medication adherence, and report unusual symptoms. For better sleep, keep a consistent bedtime, limit screens before bed, reduce caffeine after 2 PM, and create a calm sleep environment. Follow your healthcare team's personalized advice for the best transplant outcomes.",
          url: "article-detail.html?id=1",
          icon: "M12 6v12m6-6H6",
          iconColor: "text-blue-600"
        },
        {
          id: 4,
          title: "Infection Prevention",
          subtitle: "Temperature checks, hand hygiene, going out & crowds",
          description: "After a kidney transplant, immunosuppression raises infection risk. Monitor temperature and call your team if ≥100.4°F (38°C). Hand hygiene: wash ≥20s; use ≥60% alcohol sanitizer; avoid touching face. Social: prefer small/outdoor/virtual; avoid crowds, sick contacts, and recent live-vaccine recipients; don’t share food/utensils. Food safety: avoid raw/undercooked meats/fish/eggs and unpasteurized products; wash produce; cook to safe temps; refrigerate promptly and eat leftovers within 2–3 days. Home: clean high-touch surfaces daily; don’t share personal items; change linens weekly; avoid soil/gardening; keep pets clean/vaccinated and wash hands after handling. Warning signs—seek care: fever ≥100.4°F/38°C, chills/night sweats, cough/shortness of breath/chest pain, painful urination, wound drainage, persistent vomiting/diarrhea, unusual fatigue, incision infection signs. Vaccines: get annual inactivated flu shot; keep routine vaccines up to date; avoid live vaccines; ensure household is vaccinated; discuss COVID-19 vaccination with your team.",
          url: "article-detail.html?id=4",
          icon: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
          iconColor: "text-rose-600"
        },
        {
          id: 2,
          title: "Diet Principles & FAQs",
          subtitle: "Protein, sodium, potassium-rich foods, and hydration",
          description: "Proper nutrition is key to recovery after a kidney transplant. Aim for 1.0–1.2g protein per kg of body weight daily from lean sources like chicken, fish, eggs, and legumes—avoid excess red meat. Limit sodium to 2,000–3,000mg per day by avoiding processed foods, reading labels, and seasoning with herbs instead of salt. Stay hydrated with 8–10 glasses of water daily, adjust for weather or activity, and limit sugary or caffeinated drinks. Avoid grapefruit and pomegranate—they interfere with transplant medications. Do not eat raw or undercooked meats, eggs, or unpasteurized dairy. Only take supplements approved by your transplant team. Work with a registered dietitian for personalized guidance to protect your new kidney and overall health.",
          url: "article-detail.html?id=2",
          icon: "M12 8c-3 0-5 2-5 5v5h10v-5c0-3-2-5-5-5z",
          iconColor: "text-orange-600"
        },
        {
          id: 3,
          title: "Common Side Effects & When to Seek Care",
          subtitle: "When to contact your care team vs. watch-and-wait",
          description: "Immunosuppressive medications protect your transplanted kidney but may cause side effects. Mild effects like nausea, headaches, hand tremors, acne, or mild swelling can be monitored. Contact your care team if you have persistent vomiting, diarrhea over 24 hours, fever above 100.4°F (38°C), rapid weight gain, or increased swelling. Seek emergency help for chest pain, severe abdominal pain, blood in urine or stool, confusion, or severe headache with vision changes. For minor issues: take meds with food to reduce nausea, rest and hydrate for headaches, and use gentle skincare with sunscreen for skin changes. Always inform your transplant team about any new or worsening symptoms—they're there to help and guide you safely.",
          url: "article-detail.html?id=3",
          icon: "M12 6v6m0 6H6m6 0h6",
          iconColor: "text-gray-700"
        }
      ];
      
      // Call OpenRouter API to get ranking
      const sortedArticles = await this.rankArticlesWithAI(patientData, articles);
      
      // Update UI with sorted articles
      this.renderSortedArticles(sortedArticles);
      
      console.log('✅ Articles sorted successfully with AI');
    } catch (error) {
      console.error('❌ Error sorting articles:', error);
      // If AI sorting fails, title remains as "Suggestion"
      console.log('ℹ️ Displaying articles in default order');
    }
  }

  // Get patient health summary for AI analysis
  async getPatientHealthSummary() {
    const patient = this.fhirData?.patient;
    const conditions = this.fhirData?.conditions || [];
    const observations = this.fhirData?.observations || [];
    
    // Calculate date 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Helper function to find latest observation within last 7 days
    const findLatestObs = (code) => {
      const candidates = observations.filter(obs => {
        if (obs.code?.coding?.[0]?.code !== code) return false;
        const obsDate = new Date(obs.effectiveDateTime || obs.issued || 0);
        return obsDate >= sevenDaysAgo;
      });
      candidates.sort((a, b) => {
        const dateA = new Date(a.effectiveDateTime || a.issued || 0);
        const dateB = new Date(b.effectiveDateTime || b.issued || 0);
        return dateB - dateA;
      });
      return candidates[0];
    };
    
    // Extract recent vital signs (last 7 days)
    const recentBP = findLatestObs('85354-9');
    const recentWeight = findLatestObs('29463-7');
    const recentTemp = findLatestObs('8310-5');
    const recentCreatinine = findLatestObs('2160-0');
    const recentEGFR = findLatestObs('98979-8');
    
    // Extract recent lab values (last 7 days)
    const recentTacrolimus = findLatestObs('11253-2');  // Tacrolimus
    const recentBUN = findLatestObs('3094-0');          // BUN
    const recentProtein24h = findLatestObs('2889-4');   // Protein [Mass/time] in 24 hour Urine
    const recentRBC = findLatestObs('789-8');           // Red Blood Cell (RBC)
    const recentWBC = findLatestObs('6690-2');          // White Blood Cells (WBC)
    const recentCRP = findLatestObs('1988-5');          // C-Reactive Protein (CRP)
    
    // Fetch Communications (patient-reported side effects and symptoms)
    const patientId = this.getPatientId();
    let communications = [];
    
    if (patientId) {
      try {
        // Fetch recent Communications from HAPI FHIR (last 7 days)
        const startDate = sevenDaysAgo.toISOString().split('T')[0];
        
        const commUrl = `${this.FHIR_BASE}/Communication?subject=Patient/${patientId}&sent=ge${startDate}&_sort=-sent&_count=20`;
        const commRes = await fetch(commUrl);
        
        if (commRes.ok) {
          const commBundle = await commRes.json();
          if (commBundle.entry) {
            communications = commBundle.entry.map(entry => {
              const comm = entry.resource;
              return {
                date: comm.sent ? new Date(comm.sent).toLocaleDateString('en-US', { 
                  month: 'short', 
                  day: 'numeric' 
                }) : 'Unknown',
                message: comm.payload?.[0]?.contentString || 'No message'
              };
            });
          }
        }
      } catch (error) {
        console.error('Error fetching Communications:', error);
      }
    }
    
    // Calculate adherence rate for last 7 days
    let adherenceRate = 100;
    if (patientId) {
      try {
        const startDate = sevenDaysAgo.toISOString().split('T')[0];
        
        // Query MedicationAdministration for last 7 days
        const medAdminUrl = `${this.FHIR_BASE}/MedicationAdministration?subject=Patient/${patientId}&effective=ge${startDate}&_count=100`;
        const medAdminRes = await fetch(medAdminUrl);
        
        if (medAdminRes.ok) {
          const medAdminBundle = await medAdminRes.json();
          const takenCount = medAdminBundle.total || medAdminBundle.entry?.length || 0;
          
          // Estimate expected doses: assume 3 medications × 2-3 times/day × 7 days ≈ 42-63 doses
          // Use current daily expected doses × 7 as approximation
          const expectedCount = this.medicationsDue > 0 ? this.medicationsDue * 7 : 42;
          
          adherenceRate = expectedCount > 0 
            ? Math.round((takenCount / expectedCount) * 100) 
            : 100;
        }
      } catch (error) {
        console.error('Error calculating 7-day adherence:', error);
        // Fallback to daily data
        adherenceRate = this.medicationsDue > 0 
          ? Math.round((this.medicationsTaken / this.medicationsDue) * 100) 
          : 100;
      }
    } else {
      // Fallback to daily data
      adherenceRate = this.medicationsDue > 0 
        ? Math.round((this.medicationsTaken / this.medicationsDue) * 100) 
        : 100;
    }
    
    // Calculate completion rate (still daily data - self-monitoring tasks are daily)
    // Note: Self-monitoring tasks are inherently daily, so we keep this as daily completion rate
    const completionRate = this.tasks ? Object.values(this.tasks).filter(Boolean).length / Object.keys(this.tasks).length * 100 : 0;
    
    return {
      age: patient?.birthDate ? this.calculateAge(patient.birthDate) : null,
      gender: patient?.gender || 'unknown',
      conditions: conditions.map(c => c.code?.text || c.code?.coding?.[0]?.display || 'Unknown condition'),
      vitalSigns: {
        bloodPressure: recentBP ? this.extractBPValue(recentBP) : null,
        weight: recentWeight?.valueQuantity?.value || null,
        temperature: recentTemp?.valueQuantity?.value || null,
        creatinine: recentCreatinine?.valueQuantity?.value || null,
        eGFR: recentEGFR?.valueQuantity?.value || null
      },
      labValues: {
        tacrolimus: recentTacrolimus?.valueQuantity?.value || null,
        tacrilimusUnit: recentTacrolimus?.valueQuantity?.unit || recentTacrolimus?.valueQuantity?.code || null,
        bun: recentBUN?.valueQuantity?.value || null,
        bunUnit: recentBUN?.valueQuantity?.unit || recentBUN?.valueQuantity?.code || null,
        protein24h: recentProtein24h?.valueQuantity?.value || null,
        protein24hUnit: recentProtein24h?.valueQuantity?.unit || recentProtein24h?.valueQuantity?.code || null,
        rbc: recentRBC?.valueQuantity?.value || null,
        rbcUnit: recentRBC?.valueQuantity?.unit || recentRBC?.valueQuantity?.code || null,
        wbc: recentWBC?.valueQuantity?.value || null,
        wbcUnit: recentWBC?.valueQuantity?.unit || recentWBC?.valueQuantity?.code || null,
        crp: recentCRP?.valueQuantity?.value || null,
        crpUnit: recentCRP?.valueQuantity?.unit || recentCRP?.valueQuantity?.code || null
      },
      medicationAdherence: adherenceRate,
      completionRate: completionRate,
      patientReportedSymptoms: communications
    };
  }

  // Calculate age from birth date
  calculateAge(birthDate) {
    const birth = new Date(birthDate);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const monthDiff = today.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--;
    }
    return age;
  }

  // Extract blood pressure value from observation
  extractBPValue(bpObservation) {
    const systolic = bpObservation.component?.find(c => c.code?.coding?.[0]?.code === '8480-6')?.valueQuantity?.value;
    const diastolic = bpObservation.component?.find(c => c.code?.coding?.[0]?.code === '8462-4')?.valueQuantity?.value;
    return systolic && diastolic ? `${systolic}/${diastolic}` : null;
  }

  // Rank articles using OpenRouter AI
  async rankArticlesWithAI(patientData, articles) {
    // Note: If you get 401 errors, the API key may have expired
    // Get a new key from: https://openrouter.ai/keys
    const OPENROUTER_API_KEY = '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';

    const prompt = `You are a healthcare AI assistant for post kidney transplant patients. 
                    Based on the following patient health data, 
                    rank these 4 health education articles in order of priority (most important first).

Patient Health Summary (Last 7 Days):
- Age: ${patientData.age || 'Unknown'}
- Gender: ${patientData.gender}
- Medical Conditions: ${patientData.conditions.join(', ') || 'None recorded'}
- Recent Vital Signs (Last 7 Days):
  * Blood Pressure: ${patientData.vitalSigns.bloodPressure || 'Not recorded'}
  * Weight: ${patientData.vitalSigns.weight ? patientData.vitalSigns.weight + ' kg' : 'Not recorded'}
  * Temperature: ${patientData.vitalSigns.temperature ? patientData.vitalSigns.temperature + ' °C' : 'Not recorded'}
  * Creatinine: ${patientData.vitalSigns.creatinine ? patientData.vitalSigns.creatinine + ' mg/dL' : 'Not recorded'}
  * eGFR: ${patientData.vitalSigns.eGFR ? patientData.vitalSigns.eGFR + ' mL/min/1.73m²' : 'Not recorded'}
- Recent Lab Values (Last 7 Days):
  * Tacrolimus: ${patientData.labValues.tacrolimus ? patientData.labValues.tacrolimus + ' ' + (patientData.labValues.tacrilimusUnit || '') : 'Not recorded'}
  * BUN (Blood Urea Nitrogen): ${patientData.labValues.bun ? patientData.labValues.bun + ' ' + (patientData.labValues.bunUnit || '') : 'Not recorded'}
  * Protein (24h Urine): ${patientData.labValues.protein24h ? patientData.labValues.protein24h + ' ' + (patientData.labValues.protein24hUnit || '') : 'Not recorded'}
  * RBC (Red Blood Cell): ${patientData.labValues.rbc ? patientData.labValues.rbc + ' ' + (patientData.labValues.rbcUnit || '') : 'Not recorded'}
  * WBC (White Blood Cell): ${patientData.labValues.wbc ? patientData.labValues.wbc + ' ' + (patientData.labValues.wbcUnit || '') : 'Not recorded'}
  * CRP (C-Reactive Protein): ${patientData.labValues.crp ? patientData.labValues.crp + ' ' + (patientData.labValues.crpUnit || '') : 'Not recorded'}
- Medication Adherence (Last 7 Days): ${patientData.medicationAdherence}%
- Self-Monitoring Completion (Today): ${Math.round(patientData.completionRate)}%
- Patient Reported Symptoms/Side Effects (Last 7 Days):
${patientData.patientReportedSymptoms.length > 0 
  ? patientData.patientReportedSymptoms.map(s => `  * ${s.date}: ${s.message}`).join('\n')
  : '  * None reported'}

Articles to rank:
${articles.map((a, i) => `${i + 1}. "${a.title}" - ${a.description}`).join('\n')}

Please respond with ONLY a JSON array of article IDs in priority order, like this: [4, 1, 2, 3]
Do not include any explanation, just the JSON array.`;

    try {
      console.log('🔑 Using API key (first 20 chars):', OPENROUTER_API_KEY.substring(0, 20) + '...');
      console.log('🌐 Calling OpenRouter API...');
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.origin || 'http://localhost:3001',
          'X-Title': 'everHealthier Patient Dashboard'
        },
        body: JSON.stringify({
          // Using a free model - check https://openrouter.ai/models for available free models
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.3,
          max_tokens: 100
        })
      });

      console.log('📡 API Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorBody = await response.text();
        console.error('❌ API Error Body:', errorBody);
        
        // Check for 401 Unauthorized error (API key issue)
        if (response.status === 401) {
          throw new Error('The API key token may have expired and needs to be updated. (401 Unauthorized)');
        }
        
        throw new Error(`OpenRouter API error: ${response.status} - ${errorBody}`);
      }

      const data = await response.json();
      const aiResponse = data.choices?.[0]?.message?.content?.trim();
      
      console.log('🤖 AI Response:', aiResponse);
      
      // Parse the AI response to get article IDs
      const rankedIds = JSON.parse(aiResponse);
      
      // Sort articles based on AI ranking
      const sortedArticles = rankedIds.map(id => articles.find(a => a.id === id)).filter(Boolean);
      
      // Add any missing articles to the end
      articles.forEach(article => {
        if (!sortedArticles.find(a => a.id === article.id)) {
          sortedArticles.push(article);
        }
      });
      
      console.log('📊 Ranked article IDs:', rankedIds);
      return sortedArticles;
      
    } catch (error) {
      console.error('Error calling OpenRouter API:', error);
      // Return original order if AI fails
      return articles;
    }
  }

  // Render sorted articles in the UI
  renderSortedArticles(articles) {
    const container = document.querySelector('section.rounded-xl.border.bg-white.shadow-sm .grid.grid-cols-1.gap-3.p-5');
    if (!container) {
      console.warn('Articles container not found');
      return;
    }

    container.innerHTML = articles.map(article => `
      <a href="${article.url}"
        class="flex items-start gap-3 rounded-lg border p-4 hover:border-blue-400 hover:bg-blue-50">
        <div class="mt-0.5">
          <svg class="h-5 w-5 ${article.iconColor}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${article.icon}" />
          </svg>
        </div>
        <div>
          <div class="text-sm font-semibold text-gray-900">${article.title}</div>
          <div class="text-xs text-gray-600">${article.subtitle}</div>
        </div>
      </a>
    `).join('');
  }

  // ============= AI Insight Functions =============

  async generateAIInsight() {
    const contentEl = document.getElementById('aiInsightContent');
    
    if (!contentEl) {
      console.warn('AI Insight content element not found');
      return;
    }

    // Show loading state
    contentEl.innerHTML = `
      <div class="flex items-center justify-center py-8 space-y-3 flex-col">
        <div class="animate-spin rounded-full h-10 w-10 border-b-2 border-purple-600"></div>
        <p class="text-sm text-gray-600">Analyzing patient data with AI...</p>
      </div>
    `;

    try {
      // Gather all patient data
      const patientData = await this.collectPatientData();
      
      // Build comprehensive AI prompt
      const prompt = this.buildPatientAIPrompt(patientData);
      
      // Call OpenRouter API
      const OPENROUTER_API_KEY = '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';
      
      console.log('🔑 API Key (first 20 chars):', OPENROUTER_API_KEY.substring(0, 20) + '...');
      console.log('🌐 Calling OpenRouter API for patient insight');
      
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.origin || 'http://localhost:3001',
          'X-Title': 'everHealthier Patient Dashboard'
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 800
        })
      });

      console.log('📡 API Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error Response:', errorText);
        
        if (response.status === 401) {
          throw new Error('The API key token may have expired and needs to be updated. (401 Unauthorized)');
        }
        
        let errorMessage = `HTTP ${response.status}`;
        try {
          const errorJson = JSON.parse(errorText);
          errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
        } catch (e) {
          errorMessage = errorText.substring(0, 200);
        }
        
        throw new Error(`API request failed: ${errorMessage}`);
      }

      const data = await response.json();
      console.log('✅ API Response received:', data);
      
      const aiInsight = data.choices?.[0]?.message?.content?.trim();

      if (!aiInsight) {
        console.error('❌ No insight in response:', data);
        throw new Error('No insight generated from AI');
      }

      console.log('🤖 AI Insight generated successfully');

      // Display the AI insight with formatted output
      contentEl.innerHTML = `
        <div class="prose prose-sm max-w-none">
          <div class="text-gray-800 leading-relaxed">${this.formatAIInsight(aiInsight)}</div>
        </div>
        <div class="mt-4 pt-4 border-t border-purple-200 flex items-center justify-between">
          <div class="flex items-center space-x-2 text-xs text-gray-500">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <span>Generated by Meta LLaMA 3.3 70B</span>
          </div>
          <span class="text-xs text-gray-500">${new Date().toLocaleString('en-AU')}</span>
        </div>
      `;

    } catch (error) {
      console.error('❌ AI generation error:', error);
      
      contentEl.innerHTML = `
        <div class="space-y-2">
          <div class="flex items-center space-x-2 p-3 bg-red-50 border border-red-200 rounded-lg">
            <svg class="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
            <div class="flex-1">
              <p class="text-sm font-medium text-red-800">Unable to generate AI insight</p>
              <p class="text-xs text-red-600 mt-1">${error.message}</p>
            </div>
          </div>
        </div>
      `;
    }
  }

  async collectPatientData() {
    const patientId = this.getPatientId();
    
    // Collect patient information
    const patientInfo = this.fhirData?.patient || {};
    const name = patientInfo.name?.[0] 
      ? `${patientInfo.name[0].given?.join(' ') || ''} ${patientInfo.name[0].family || ''}`.trim() 
      : 'Unknown Patient';
    
    // Collect vital signs from dashboard
    const vitals = {
      bloodPressure: document.getElementById('vitals-bp')?.textContent || 'N/A',
      weight: document.getElementById('vitals-weight')?.textContent || 'N/A',
      temperature: document.getElementById('vitals-temp')?.textContent || 'N/A'
    };
    
    // Collect medication adherence
    const adherence = {
      today: this.medicationsTaken || 0,
      total: this.medicationsDue || 0,
      percentage: this.medicationsDue > 0 ? ((this.medicationsTaken / this.medicationsDue) * 100).toFixed(0) : 0
    };
    
    // Collect recent observations
    const observations = this.fhirData?.observations || [];
    
    // Collect recent appointments
    const appointments = this.fhirData?.appointments || [];
    const upcomingAppointments = appointments.filter(apt => {
      const aptDate = new Date(apt.start);
      return aptDate > new Date();
    }).slice(0, 3);
    
    return {
      name,
      id: patientId,
      vitals,
      adherence,
      observations: observations.slice(0, 10),
      upcomingAppointments
    };
  }

  buildPatientAIPrompt(data) {
    const prompt = `You are a helpful health assistant providing personalized advice to a kidney transplant patient.
Based on the patient's data below, provide supportive recommendations and insights.

**PATIENT INFORMATION:**
- Name: ${data.name}
- Patient ID: ${data.id}

**CURRENT VITAL SIGNS:**
- Blood Pressure: ${data.vitals.bloodPressure}
- Weight: ${data.vitals.weight}
- Temperature: ${data.vitals.temperature}

**MEDICATION ADHERENCE TODAY:**
- Taken: ${data.adherence.today} / ${data.adherence.total} doses
- Adherence Rate: ${data.adherence.percentage}%

**RECENT OBSERVATIONS:**
${data.observations.length > 0 ? data.observations.map(obs => {
  const value = obs.valueQuantity?.value || obs.valueString || 'N/A';
  const unit = obs.valueQuantity?.unit || '';
  const date = obs.effectiveDateTime ? new Date(obs.effectiveDateTime).toLocaleDateString('en-AU') : 'Unknown date';
  const code = obs.code?.coding?.[0]?.display || obs.code?.text || 'Unknown';
  return `- ${date}: ${code} = ${value} ${unit}`;
}).join('\n') : '- No recent observations'}

**UPCOMING APPOINTMENTS:**
${data.upcomingAppointments.length > 0 ? data.upcomingAppointments.map(apt => {
  const date = new Date(apt.start).toLocaleDateString('en-AU');
  const type = apt.serviceType?.[0]?.coding?.[0]?.display || 'Appointment';
  return `- ${date}: ${type}`;
}).join('\n') : '- No upcoming appointments'}

CRITICAL INSTRUCTIONS:
You MUST structure your response EXACTLY as follows, using these exact section titles:

Health Summary
[Brief assessment of the patient's current health status in 2-3 sentences, written in a friendly, supportive tone]

Important Notes
[List any concerning trends or values that need attention as numbered points. Each point must have a BOLD subtitle followed by description:
1. Medication Adherence: [Comment on adherence rate and importance]
2. Vital Signs: [Comment on any abnormal vitals]
etc.]

Positive Progress
[List improvements or stable parameters as numbered points. Each point must have a BOLD subtitle followed by description:
1. Regular Monitoring: [Acknowledge patient's efforts in tracking health data]
2. Stable Parameters: [Mention any stable or improving values]
etc.]

Your Action Items
[List specific actions the patient should take as numbered points. Each point must have a BOLD subtitle followed by description:
1. Daily Medications: [Reminder about medication importance]
2. Monitor Symptoms: [What to watch for]
3. Next Steps: [Any preparations for upcoming appointments]
etc.]

FORMATTING RULES:
- Use ONLY the exact section titles shown above (no ### or ** or numbering)
- Start each section title on a new line
- Leave a blank line after each section title
- Use numbered lists (1., 2., etc.) for items within sections
- Be supportive, encouraging, and patient-friendly in tone
- Focus on actionable advice the patient can follow`;

    return prompt;
  }

  formatAIInsight(text) {
    // Split text into lines for processing
    let lines = text.split('\n');
    let formatted = [];
    
    // Section titles to recognize (without any special characters)
    const sectionTitles = [
      'Health Summary',
      'Important Notes',
      'Positive Progress',
      'Your Action Items'
    ];
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      
      // Skip empty lines
      if (!line) {
        formatted.push('');
        continue;
      }
      
      // Check if this line is a section title
      const isSectionTitle = sectionTitles.some(title => 
        line === title || 
        line.replace(/^#+\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '') === title
      );
      
      if (isSectionTitle) {
        // Format as section header
        const cleanTitle = line.replace(/^#+\s*/, '').replace(/^\*\*/, '').replace(/\*\*$/, '').trim();
        formatted.push(`<div class="font-bold text-base text-gray-900 mb-2">${cleanTitle}</div>`);
      }
      // Check if it's a numbered list item (1., 2., etc.)
      else if (/^\d+\./.test(line)) {
        // Process line to bold text before first colon (the subtitle)
        let processedLine = line;
        
        // Check if line contains a subtitle pattern (text before colon)
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          // Extract number, subtitle, and description
          const numberMatch = line.match(/^(\d+\.\s*)/);
          const number = numberMatch ? numberMatch[1] : '';
          const restOfLine = line.substring(number.length);
          
          // Split at first colon
          let subtitle = restOfLine.substring(0, restOfLine.indexOf(':'));
          let description = restOfLine.substring(restOfLine.indexOf(':') + 1);
          
          // Remove ** markdown from subtitle and description
          subtitle = subtitle.replace(/\*\*/g, '');
          description = description.replace(/\*\*/g, '');
          
          processedLine = `${number}<strong>${subtitle}</strong>:${description}`;
        }
        
        formatted.push(`<div class="text-sm ml-4 mb-2">${processedLine}</div>`);
      }
      // Check if it's a bullet point
      else if (/^[-•]/.test(line)) {
        formatted.push(`<div class="text-sm ml-4 mb-1">${line.replace(/^[-•]\s*/, '• ')}</div>`);
      }
      // Regular paragraph
      else {
        // Bold any remaining **text**
        line = line.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        formatted.push(`<div class="text-sm ml-4 mb-2">${line}</div>`);
      }
    }
    
    return formatted.join('');
  }
}

// Initialize when DOM ready
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => new PatientDashboard());
}
