<div align="center">
  <h1>2025-everHealthier</h1>
  <p><strong>SMART on FHIR sandbox demo · Patient self‑monitoring · Practitioner multi‑patient view</strong></p>
</div>

## ✨ Overview
This project is a front‑end focused demo application showing how to:

* Perform **SMART on FHIR** authentication (Standalone & Launcher modes)
* Load a Patient Bundle plus related clinical resources through a lightweight **Node.js proxy**
* Present a **patient dashboard** with vitals, medication list, quick logging actions
* Support a **clinic / practitioner mode** (multi‑patient context) vs **patient mode**
* Provide a **manual patient selection fallback** when SMART token does not include a patient context

The code is intentionally framework‑light (vanilla HTML / JS) for instructional clarity.

## 🗂 Directory Highlights
| File | Purpose |
|------|---------|
| `login-smart.html` | Entry point for SMART login (select mode + optional patient preselection) |
| `public/callback.html` | Handles SMART redirect, stores token + context, routes by role |
| `patient-dashboard.html` | Patient UI (vitals, meds, logs, progress) |
| `patient-dashboard.js` | Dashboard logic: fetch via proxy, transform Bundle, render UI |
| `clinic-dashboard.html` | (Intended) multi-patient / practitioner workspace |
| `fhir-proxy.js` | Node.js proxy to public HAPI FHIR (reverse includes) + static dispatcher |
| `smart-pages.js` | Static file serving helper (for SMART pages) |
| `common.js` | Shared utilities: Auth, Utils, Modal, Chart helpers |

## 🚀 Quick Start
### 1. Start the proxy + static server
```powershell
node fhir-proxy.js
```
Console will show:
```
FHIR proxy server running: http://localhost:3001/api/patient
SMART login page:        http://localhost:3001/login.html
SMART redirect URI:      http://localhost:3001/callback.html
```

### 2. Open SMART login
Visit: `http://localhost:3001/login.html`

Choose a mode:
1. **Default sandbox (Standalone)** – Directly targets a public sandbox issuer; may or may not return a patient context.
2. **SMART Launcher** – Used when starting from an official SMART Launcher that provides `iss` & optional `launch`.

### 3. Authenticate & Redirect
After authorization you land on `callback.html` (shows patient context + redirects):
* Patient role → `patient-dashboard.html`
* Practitioner / Pharmacist (Practitioner resource) → `clinic-dashboard.html`

## 🔐 SMART Auth Modes
| Mode | How `iss` is set | Patient context reliability | When to use |
|------|------------------|-----------------------------|-------------|
| Standalone | Hard-coded (sandbox) | Not guaranteed | Rapid UI dev, token flow demo |
| Launcher | Provided by SMART Launcher (`iss`, maybe `launch`) | High (if scopes permitted) | Realistic clinical launch simulation |

### Scopes Strategy
Default requested (may be trimmed by Launcher policy):
```
launch/patient openid fhirUser profile offline_access 
patient/Patient.read patient/Observation.read patient/MedicationRequest.read 
patient/MedicationStatement.read patient/Condition.read patient/QuestionnaireResponse.read
```
If the Launcher rejects resource scopes (invalid_scope), retry with only:
```
launch/patient openid fhirUser profile offline_access
```
Then incrementally add needed `patient/*` scopes.

## 🧪 Manual Patient Selection Fallback
Some sandbox launches don’t return `patient` in the token. To still demo the dashboard:
1. In Standalone mode use the **patient list loader** in `login-smart.html`.
2. Search patterns:
   * `Smith` → `family:contains=Smith`
   * `Barney Abbott` → `given=Barney&family=Abbott`
3. Select a row → stores:
   * `preselected_patient_id`
   * `preselected_patient_name`
4. If SMART callback lacks patient context, `callback.html` marks it as `(manual selection)` and uses the stored name & id.
5. Fallback keys are cleared after redirect to avoid stale reuse.

## 🏥 Roles & Routing
| Detected user resource | Assigned role | Redirect |
|------------------------|--------------|----------|
| Practitioner / PractitionerRole | `clinic` | `clinic-dashboard.html` |
| Patient or unknown | `patient` | `patient-dashboard.html` |

If a practitioner launch also selects a patient, we still route to clinic dashboard but annotate “with selected patient context”.

## 🔄 Data Flow (Patient Dashboard)
1. Dashboard loads stored user context (localStorage: `user_data`).
2. Uses `patientId` → calls proxy: `GET /api/patient?patientId=<id>`
3. Proxy builds HAPI FHIR query with reverse includes:
   ```
   https://hapi.fhir.org/baseR4/Patient?_id=<id>
     &_revinclude=Condition:subject
     &_revinclude=Observation:patient
     &_revinclude=MedicationStatement:subject
     &_revinclude=MedicationRequest:subject
     &_revinclude=QuestionnaireResponse:subject
   ```
4. `patient-dashboard.js` transforms Bundle → unified object (patient, vitals, meds, conditions...)
5. Verification banner compares stored vs bundle resource id.

### ID vs Identifier Clarification
* `patient.id` (resource id) – used for verification and proxy `_id=` lookup.
* `patient.identifier[x].value` – may represent MRN/external code; displayed in parentheses if different.

## 🩺 Extracted Clinical Data
| Domain | Codes / Logic |
|--------|---------------|
| Blood Pressure | Panel 85354-9; components 8480-6 / 8462-4 |
| Weight | 29463-7 |
| Temperature | 8310-5 |
| Medications | MedicationStatement + MedicationRequest (text/coding) |
| Conditions | code.text or first coding.display |

## 🧰 Utility Storage Keys
| Key | Purpose |
|-----|---------|
| `auth_token` | Stored token (access/id) placeholder |
| `user_role` | `patient` or `clinic` |
| `user_data` | Serialized user + FHIR context object |
| `preselected_patient_id` | Manual fallback patient id |
| `preselected_patient_name` | Manual fallback patient name |
| `shown_patient_id_alert` | Prevents repeated debug alert |

## 🛠 Running Without SMART
For very quick static inspection (no auth):
```powershell
python -m http.server 8000
# then open http://localhost:8000/patient-dashboard.html
```
The dashboard will operate in a degraded “demo” state if no FHIR bundle was fetched.

## 🧪 Testing Ideas
| Scenario | Expectation |
|----------|-------------|
| Standalone + manual patient | Callback shows “(manual selection)” and dashboard verifies if bundle id matches |
| Launcher denies scopes | Error `invalid_scope` on callback; retry with reduced scopes |
| Practitioner launch + patient | Routes to clinic dashboard, meta shows “with selected patient context” |
| Missing name patient | Fallback name becomes `Patient <idPrefix>` |

## 🚧 Known / Future Enhancements
| Area | Idea |
|------|------|
| Scopes UI | Toggle to dynamically add clinical scopes only if available |
| Pagination | “Load more” for patient search (follow Bundle.link[next]) |
| Clinic Dashboard | Patient list with quick switch & summary metrics |
| Write-back | Convert quick logs into FHIR Observations / MedicationStatements |
| Theming | Light/Dark toggle |
| Security | Replace localStorage token handling with proper backend session |

## 🐞 Troubleshooting
| Issue | Cause | Fix |
|-------|-------|-----|
| `invalid_scope` | Launcher client not allowed resource scopes | Retry minimal scopes; incrementally add |
| Patient mismatch | Using identifier instead of resource id previously | Fixed: now compares resource id |
| Name shows (unknown) | Token had no Patient resource & no fallback name stored | Use list selection before login |
| 0 vitals / meds | Sandbox patient lacks those resources | Try another patient id |
| CORS error | Proxy not running | Start `node fhir-proxy.js` |

## 🧾 License / Usage
Educational / demo usage. Replace or extend freely for coursework or prototypes.

## 🙋 Support / Questions
Open an issue or extend the README with additional FAQs as you integrate more SMART flows (e.g., encounter context, refresh tokens, write operations).

---
Feel free to request: *“Add clinic dashboard patient switching”*, *“Implement FHIR Observation write”*, or *“Add pagination to patient search”* — and we can build it next.
