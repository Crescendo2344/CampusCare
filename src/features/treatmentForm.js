// treatmentForm: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {appointmentDisplayId,appointmentRecords,syncRealAppointments} from './appointmentService.js';
import {hideAlert,showAlert,showConfirmDialog,toast} from './theme.js';
import {fmtDate,fmtTime} from './inputValidation.js';
import {syncRealDentalRecords,syncRealMedicationReminders,syncRealTreatments,treatmentAction,treatmentDisplayId,treatmentRecords} from './treatmentService.js';
import {getDoctors,getPatientById,getUserById} from './documentScanner.js';
import {escapeHtml} from './issueReports.js';
import {docName} from './messaging.js';
import {closeAllModals,openModal} from './modals.js';
import {collectDentalRecordForm,dentalRecordFormHtml,toggleDentalRecordSection} from './patientForm.js';
import {campusDateFieldHtml} from './datePicker.js';
import {auditLog} from './auditAndBackups.js';
import {persistDB} from './persistence.js';
import {renderMyRecords} from './patientRecords.js';
import {renderTreatTable,renderTreatments} from './treatmentList.js';
import {renderAppointments} from './appointments.js';
import {renderDoctorSchedule} from './doctorSchedule.js';
import {loadJsPDF} from './settingsAndCertificates.js';
import {loadHtml2Canvas} from './certificateService.js';
import {bindAction} from '../dependencies.js';
// ── Treatment Modal ──
export function openAddTreatmentModal(apptId){
  const a=appointmentRecords().find(x=>x.id===Number(apptId));
  if(!a)return;

  if(a.date>appState.clinicInformation.TODAY){
    toast(`This appointment is scheduled for ${fmtDate(a.date)}. Treatment notes can only be recorded on or after the visit date.`,'warning',6500);
    return;
  }
  if(a.status==='Cancelled'||a.status==='No-show'){
    toast('Treatment notes cannot be recorded for a cancelled or no-show appointment.','warning');
    return;
  }

  const existing=treatmentRecords().find(t=>t.appointmentId===a.id);
  if(existing){
    viewTreatment(existing.id);
    return;
  }

  openAddTreatmentModalPt(a.patientId,a.id);
}

export function openAddTreatmentModalPt(ptId,apptId=null){
  if(appState.auth.currentUser.role!=='Doctor'&&appState.auth.currentUser.role!=='Administrator'){
    toast('Only a Doctor or Administrator can record treatment.','warning');
    return;
  }

  const appt=apptId?appointmentRecords().find(a=>a.id===Number(apptId)):null;
  const pt=ptId?getPatientById(ptId):null;
  const realMode=Boolean(appState.auth.currentUser?._realSupabase);
  const patientSource=realMode?appState.data.DB.patients.filter(p=>p._realSupabase&&!p.archived):appState.data.DB.patients.filter(p=>!p.archived);
  const doctorSource=getDoctors();

  if(ptId&&!pt){
    toast('Patient record could not be loaded. Refresh the page and try again.','error');
    return;
  }
  if(!ptId&&!patientSource.length){
    toast('No active patient records are available.','warning');
    return;
  }

  const patientOpts=!ptId
    ? patientSource.map(p=>`<option value="${p.id}">${escapeHtml(p.fname+' '+p.lname)} (${escapeHtml(p.college||'')})</option>`).join('')
    : `<option value="${pt.id}">${escapeHtml(pt.fname+' '+pt.lname)}</option>`;

  const doctorSelect=appState.auth.currentUser.role==='Administrator'
    ? `<div class="form-group"><label>Attending Doctor <span class="required">*</span></label>
        <select id="tm-doc">${doctorSource.map(d=>`<option value="${d.id}" ${appt&&appt.doctorId===d.id?'selected':''}>${escapeHtml(docName(d))} · ${escapeHtml(d.specialty||'General Medicine')}</option>`).join('')}</select>
      </div>`
    : '';

  const defaultDate=appt?.date&&appt.date<=appState.clinicInformation.TODAY?appt.date:appState.clinicInformation.TODAY;
  const defaultRecordType=appt?.clinic==='Dental Clinic'?'Dental Clinic':'Medical Clinic';

  openModal(`<div class="modal modal-lg">
    <div class="modal-header">
      <h3>${appt?`Complete Appointment #${appointmentDisplayId(appt)}`:'Record Treatment / Clinical Notes'}</h3>
      <button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button>
    </div>
    <div class="modal-body">
      <div id="trm-msg"></div>
      ${pt?`<div class="alert alert-info show" style="margin-bottom:.7rem;font-size:.8rem">
        Patient: <strong>${escapeHtml(pt.fname+' '+pt.lname)}</strong> · ${escapeHtml(pt.college||'')} ·
        Allergies: <strong class="text-danger">${escapeHtml(pt.allergies||'None')}</strong>
        ${appt?`<br>Appointment: ${fmtDate(appt.date)} at ${fmtTime(appt.time)} · ${escapeHtml(appt.service)}`:''}
      </div>`:''}

      <div class="form-row">
        <div class="form-group"><label>Patient <span class="required">*</span></label>
          <select id="tm-pt" ${ptId?'disabled':''}>${patientOpts}</select>
        </div>
        ${doctorSelect}
      </div>

      <div class="form-row">
        <div class="form-group"><label>Clinical Record Type</label>
          ${appt
            ?`<input type="hidden" id="tm-record-type" value="${defaultRecordType}"><div class="booking-readonly-patient"><span class="booking-patient-icon"><i class="bi ${defaultRecordType==='Dental Clinic'?'bi-emoji-smile':'bi-activity'}"></i></span><div><strong>${defaultRecordType}</strong><small>${escapeHtml(appt.service||'Linked appointment')}</small></div></div>`
            :`<select id="tm-record-type" ${bindAction('change',(event,element)=>{toggleDentalRecordSection()})}><option>Medical Clinic</option><option>Dental Clinic</option></select>`}
        </div>
      </div>

      <div class="section-label">Vital Signs</div>
      <div class="form-row">
        <div class="form-group"><label>Blood Pressure</label><input id="tm-bp" placeholder="e.g. 120/80"></div>
        <div class="form-group"><label>Temperature (°C)</label><input id="tm-temp" inputmode="decimal" placeholder="e.g. 36.8"></div>
        <div class="form-group"><label>Pulse Rate</label><input id="tm-pulse" inputmode="numeric" placeholder="bpm"></div>
        <div class="form-group"><label>SpO₂</label><input id="tm-spo2" placeholder="e.g. 98%"></div>
        <div class="form-group"><label>Weight (kg)</label><input id="tm-weight" inputmode="decimal"></div>
        <div class="form-group"><label>Height (cm)</label><input id="tm-height" inputmode="decimal"></div>
      </div>

      <div class="section-label">Findings & Diagnosis</div>
      <div class="form-group"><label>Clinical Findings / Chief Complaint <span class="required">*</span></label>
        <textarea id="tm-findings" rows="2" placeholder="Describe findings and observations..."></textarea>
      </div>
      <div class="form-group"><label>Diagnosis <span class="required">*</span></label>
        <textarea id="tm-diag" rows="2" placeholder="Enter the clinician's diagnosis or clinical impression"></textarea>
      </div>
      <div class="form-group"><label>Prescription / Treatment Given</label>
        <textarea id="tm-presc" rows="2" maxlength="600" placeholder="Medications, treatment given, dosage, instructions..."></textarea>
      </div>
      <div class="form-group"><label>Clinical Notes / Instructions</label>
        <textarea id="tm-notes" rows="2" placeholder="Advice, special instructions, restrictions..."></textarea>
      </div>

      <div class="form-row">
        <div class="form-group"><label>Treatment Date <span class="required">*</span></label>${campusDateFieldHtml('tm-date',defaultDate,'Treatment Date','',appState.clinicInformation.TODAY)}</div>
        <div class="form-group"><label>Follow-up Date</label>${campusDateFieldHtml('tm-followup','','Follow-up Date',defaultDate)}</div>
        <div class="form-group full"><label>Imaging / X-ray</label>
          <select id="tm-xray">
            <option value="">None</option>
            <option value="X-ray taken">X-ray taken</option>
            <option value="Dental X-ray taken">Dental X-ray taken</option>
            <option value="Referred for imaging">Referred for imaging</option>
          </select>
        </div>
      </div>

      ${dentalRecordFormHtml({},pt,defaultDate).replace('id="tm-dental-section"','id="tm-dental-section" '+(defaultRecordType==='Dental Clinic'?'':'hidden'))}

      <div class="section-label">Optional Medication Reminder</div>
      <p class="form-note" style="margin-bottom:.65rem">If completed, CampusCare creates a medication reminder for the patient.</p>
      <div class="form-row">
        <div class="form-group"><label>Medication Name</label><input id="tm-medname" placeholder="e.g. Amoxicillin"></div>
        <div class="form-group"><label>Dosage</label><input id="tm-dosage" placeholder="e.g. 500 mg"></div>
        <div class="form-group"><label>Frequency</label><input id="tm-frequency" placeholder="e.g. 3 times a day"></div>
        <div class="form-group"><label>End Date</label>${campusDateFieldHtml('tm-enddate',new Date(Date.now()+7*86400000).toISOString().slice(0,10),'Medication End Date',defaultDate)}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button>
      <button class="btn btn-primary" id="tm-save-btn" ${bindAction('click',(event,element)=>{saveTreatment((ptId||'null'),(apptId||'null'))})}>
        ${appt?'Save Notes & Complete Appointment':'Save Treatment Record'}
      </button>
    </div>
  </div>`);
  const recordType=document.getElementById('tm-record-type');
  if(recordType&&!appt)recordType.value=defaultRecordType;
  toggleDentalRecordSection();
}

export async function saveTreatment(ptId,apptId){
  const ptIdVal=ptId||parseInt(document.getElementById('tm-pt').value);
  const findings=document.getElementById('tm-findings').value.trim();
  const diag=document.getElementById('tm-diag').value.trim();
  const presc=document.getElementById('tm-presc').value.trim();
  const notes=document.getElementById('tm-notes').value.trim();
  const date=document.getElementById('tm-date').value;
  const followup=document.getElementById('tm-followup').value;
  const xray=document.getElementById('tm-xray').value;
  const msg=document.getElementById('trm-msg');
  const medName=document.getElementById('tm-medname')?.value.trim()||'';
  const dosage=document.getElementById('tm-dosage')?.value.trim()||'';
  const frequency=document.getElementById('tm-frequency')?.value.trim()||'';
  const endDate=document.getElementById('tm-enddate')?.value||'';
  const btn=document.getElementById('tm-save-btn');
  const clinicType=document.getElementById('tm-record-type')?.value||appt?.clinic||'Medical Clinic';
  const dentalRecord=clinicType==='Dental Clinic'?collectDentalRecordForm():null;

  hideAlert(msg);

  if(!ptIdVal||!findings||!diag||!date){
    showAlert(msg,'Patient, clinical findings, diagnosis, and treatment date are required.');
    return;
  }
  if(date>appState.clinicInformation.TODAY){
    showAlert(msg,'Treatment date cannot be in the future.');
    return;
  }
  if(followup&&followup<date){
    showAlert(msg,'Follow-up date cannot be earlier than the treatment date.');
    return;
  }
  if(presc.length>600){
    showAlert(msg,'Prescription exceeds 600 characters.');
    return;
  }

  const pt=getPatientById(ptIdVal);
  if(!pt){
    showAlert(msg,'Patient record could not be loaded.');
    return;
  }

  const vitals={
    bp:document.getElementById('tm-bp').value.trim(),
    temp:document.getElementById('tm-temp').value.trim(),
    pulse:document.getElementById('tm-pulse').value.trim(),
    spo2:document.getElementById('tm-spo2').value.trim(),
    weight:document.getElementById('tm-weight').value.trim(),
    height:document.getElementById('tm-height').value.trim()
  };

  const appt=apptId?appointmentRecords().find(a=>a.id===Number(apptId)):null;
  let doc=appState.auth.currentUser.role==='Doctor'
    ? appState.auth.currentUser
    : getUserById(parseInt(document.getElementById('tm-doc')?.value||'0'));

  if(!doc||doc.role!=='Doctor'){
    showAlert(msg,'Select an attending doctor.');
    return;
  }

  const oldText=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Saving securely…';}

  try{
    if(appState.auth.currentUser?._realSupabase){
      if(!pt._realSupabase||!doc._realSupabase){
        throw new Error('Select real CampusCare patient and doctor records.');
      }

      await treatmentAction({
        action:'create',
        patient_id:pt.dbPatientId,
        doctor_id:doc.dbUserId,
        appointment_id:appt?.dbAppointmentId||null,
        examination_findings:findings,
        diagnosis:diag,
        prescription:presc,
        clinical_notes:notes,
        imaging_notes:xray,
        vitals,
        treatment_date:date,
        follow_up_date:followup||null,
        medication_name:medName||null,
        dosage:dosage||null,
        frequency:frequency||null,
        medication_end_date:medName&&endDate?endDate:null,
        times_of_day:['08:00','14:00','20:00'],
        clinic_type:clinicType,
        dental_record:dentalRecord
      });

      await Promise.all([
        syncRealTreatments(),
        syncRealAppointments(),
        syncRealMedicationReminders()
      ]);
      await syncRealDentalRecords();

      toast(appt
        ? 'Treatment record saved and appointment completed.'
        : 'Treatment record saved.','success');
    }else{
      const treatmentId=appState.data.DB.nextTreatId++;
      appState.data.DB.treatments.push({
        id:treatmentId,patientId:ptIdVal,doctorId:doc.id,appointmentId:apptId,
        diagnosis:diag,prescription:presc,findings,notes,xray,vitals,date,
        followupDate:followup,clinicType,dentalRecord:dentalRecord?{
          ...dentalRecord,
          courseMajor:dentalRecord.course_major,
          yearSection:dentalRecord.year_section,
          messengerAccount:dentalRecord.messenger_account,
          cellNo:dentalRecord.cell_no,
          oralHealth:dentalRecord.oral_health,
          workStatus:dentalRecord.work_status,
          recordDate:dentalRecord.record_date
        }:null,
        createdAt:new Date().toLocaleString()
      });
      auditLog('TREATMENT_CREATED',`Treatment #${treatmentId} recorded with diagnosis: ${diag}.`,'Treatment',treatmentId);
      if(appt)appt.status='Completed';

      if(medName&&endDate){
        appState.data.DB.medReminders.push({
          id:appState.data.DB.nextReminderId++,
          patientId:ptIdVal,
          medicationName:medName,
          dosage:[dosage,frequency].filter(Boolean).join(' · '),
          startDate:date,
          endDate,
          timeOfDay:['08:00','14:00','20:00'],
          lastSent:null,
          status:'active'
        });
      }
      persistDB();
      toast(appt?'Treatment record saved and appointment completed.':'Treatment record saved.','success');
    }

    closeAllModals();

    if(appState.auth.currentUser.role==='Patient'){
      await renderMyRecords();
    }else if(document.getElementById('treat-table')){
      await renderTreatments();
    }else if(document.getElementById('appt-table')){
      await renderAppointments();
    }else if(appState.auth.currentUser.role==='Doctor'){
      await renderDoctorSchedule();
    }
  }catch(e){
    console.error('Treatment save:',e);
    showAlert(msg,e?.message||'Unable to save treatment record.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=oldText||'Save Treatment Record';
    }
  }
}

export function treatmentDocumentHtml(t){
  const pt=getPatientById(t.patientId)||{},doc=getUserById(t.doctorId)||{},s=appState.data.DB.settings,vit=t.vitals||{},safe=v=>escapeHtml(v||'—');
  return `<div class="treatment-record-doc" id="treatment-document-${t.id}">
    <div class="treatment-doc-head"><img src="${appState.utilities.CTU_MAIN_LOGO_DATA}" alt="CTU Main Campus Logo" width="78" height="78" style="width:78px;height:78px;object-fit:contain;display:block;margin:0 auto 8px"><h2>${escapeHtml(s.clinicName||'CTU Main Medical & Dental Clinic')}</h2><p>${escapeHtml(s.address||'CTU Main Campus')}</p><p>${escapeHtml(s.contactEmail||'')}</p></div>
    <div class="treatment-doc-title">CLINICAL TREATMENT RECORD</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;font-size:.7rem;color:#64717a"><span>Record No. <strong>#${treatmentDisplayId(t)}</strong></span>${t.archived?'<span class="treatment-archived-mark">ARCHIVED</span>':''}</div>
    <div class="treatment-doc-grid">
      <div class="treatment-doc-field"><span>Patient</span><strong>${safe((pt.fname||'')+' '+(pt.lname||''))}</strong></div>
      <div class="treatment-doc-field"><span>Patient ID</span><strong>${safe(pt.idNo||('P-'+pt.id))}</strong></div>
      <div class="treatment-doc-field"><span>Attending Doctor</span><strong>${safe(doc.fname?docName(doc):'')}</strong></div>
      <div class="treatment-doc-field"><span>Treatment Date</span><strong>${fmtDate(t.date)}</strong></div>
      <div class="treatment-doc-field"><span>College / Unit</span><strong>${safe(pt.college)}</strong></div>
      <div class="treatment-doc-field"><span>Follow-up Date</span><strong>${t.followupDate?fmtDate(t.followupDate):'—'}</strong></div>
    </div>
    ${pt.allergies&&pt.allergies!=='None'?`<div style="border:1px solid #e3a6a6;background:#fff1f1;color:#8d2323;border-radius:7px;padding:8px 10px;font-size:.74rem;margin-bottom:14px"><strong>Known Allergy:</strong> ${safe(pt.allergies)}</div>`:''}
    <div class="treatment-doc-section"><h4>Vital Signs</h4><div class="treatment-doc-vitals">
      <div class="treatment-vital-box"><span>Blood Pressure</span><strong>${safe(vit.bp)}</strong></div><div class="treatment-vital-box"><span>Temperature</span><strong>${safe(vit.temp)}${vit.temp?' °C':''}</strong></div><div class="treatment-vital-box"><span>Pulse</span><strong>${safe(vit.pulse)}${vit.pulse?' bpm':''}</strong></div><div class="treatment-vital-box"><span>SpO₂</span><strong>${safe(vit.spo2)}</strong></div><div class="treatment-vital-box"><span>Weight</span><strong>${safe(vit.weight)}</strong></div><div class="treatment-vital-box"><span>Height</span><strong>${safe(vit.height)}</strong></div>
    </div></div>
    <div class="treatment-doc-section"><h4>Examination Findings</h4><p>${safe(t.findings)}</p></div>
    <div class="treatment-doc-section"><h4>Diagnosis / Clinical Impression</h4><p><strong>${safe(t.diagnosis)}</strong></p></div>
    <div class="treatment-doc-section"><h4>Prescription / Treatment Given</h4><p>${safe(t.prescription)}</p></div>
    ${t.xray?`<div class="treatment-doc-section"><h4>Imaging / X-ray</h4><p>${safe(t.xray)}</p></div>`:''}
    <div class="treatment-doc-section"><h4>Clinical Notes / Instructions</h4><p>${safe(t.notes)}</p></div>
    <div class="treatment-doc-sign"><div><div class="line">${safe(doc.fname?docName(doc):'Attending Doctor')}</div><span>Attending Clinician</span></div></div>
    <div style="margin-top:25px;padding-top:10px;border-top:1px solid #edf0f2;font-size:.6rem;color:#7a858d;text-align:center">Generated by CampusCare · CTU Main Campus · ${new Date().toLocaleString('en-PH')}</div>
  </div>`;
}

export function isDentalTreatment(t){
  if(!t)return false;
  if(t.dentalRecord)return true;
  const appt=t.appointmentId?appointmentRecords().find(a=>a.id===t.appointmentId):null;
  return appt?.clinic==='Dental Clinic'||String(appt?.service||'').toLowerCase().includes('dental');
}

export function openDentalRecordEditor(id){
  const t=treatmentRecords().find(x=>x.id===Number(id));if(!t)return;
  if(!['Doctor','Administrator'].includes(appState.auth.currentUser.role)){
    toast('Only a Doctor or Administrator can edit a dental record.','warning');
    return;
  }
  const pt=getPatientById(t.patientId)||{};
  const existing=t.dentalRecord||{};
  openModal(`<div class="modal modal-xl">
    <div class="modal-header"><div><h3>${t.dentalRecord?'Edit':'Add'} Dental Record</h3><div class="text-muted">${escapeHtml(pt.fname||'')} ${escapeHtml(pt.lname||'')} · Treatment #${treatmentDisplayId(t)}</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body"><div id="dental-record-msg"></div>${dentalRecordFormHtml(existing,pt,t.date||appState.clinicInformation.TODAY)}</div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Cancel</button><button class="btn btn-primary" ${bindAction('click',(event,element)=>{saveDentalRecordForTreatment((id))})}><i class="bi bi-save"></i> Save Dental Record</button></div>
  </div>`);
}

export async function saveDentalRecordForTreatment(id){
  const t=treatmentRecords().find(x=>x.id===Number(id));if(!t)return;
  const msg=document.getElementById('dental-record-msg');
  const dental=collectDentalRecordForm();
  if(!dental){showAlert(msg,'Dental record form is unavailable.');return;}

  try{
    if(t._realSupabase){
      await treatmentAction({
        action:'save_dental_record',
        treatment_id:t.dbTreatmentId,
        dental_record:dental
      });
      await syncRealDentalRecords();
    }else{
      t.dentalRecord={
        ...dental,
        courseMajor:dental.course_major,
        yearSection:dental.year_section,
        messengerAccount:dental.messenger_account,
        cellNo:dental.cell_no,
        oralHealth:dental.oral_health,
        workStatus:dental.work_status,
        recordDate:dental.record_date,
        dentistName:docName(getUserById(t.doctorId)||appState.auth.currentUser)
      };
      persistDB();
    }
    closeAllModals();
    toast('Dental record saved.','success');
    viewTreatment(id);
  }catch(e){
    showAlert(msg,e?.message||'Unable to save the dental record.');
  }
}

export function dentalRecordDocumentHtml(t){
  const pt=getPatientById(t.patientId)||{};
  const doc=getUserById(t.doctorId)||{};
  const d=t.dentalRecord||{};
  const age=pt.age||'';
  const safe=v=>escapeHtml(v||'');
  const allRows=(nums,primary=false)=>`<div class="dental-chart-row ${primary?'primary':''}">${nums.map(n=>`<div class="dental-chart-cell"><strong>${n}</strong><span>${safe(d.odontogram?.[n]||'')}</span></div>`).join('')}</div>`;
  const oral=d.oralHealth||{};
  const oralLines=[
    ['Satisfactory',oral.satisfactory],['Fair',oral.fair],['Poor',oral.poor],
    ['Harelip',oral.harelip],['Defective Gums',oral.defective_gums],['Cleft Palate',oral.cleft_palate]
  ];
  const operations=Array.isArray(d.accomplishment)?d.accomplishment:[];

  return `<div class="dental-record-doc" id="dental-record-document-${t.id}">
    <div class="dental-doc-head">
      <img src="${appState.utilities.CTU_MAIN_LOGO_DATA}" alt="CTU Main Campus Logo">
      <p>Republic of the Philippines</p><h2>CEBU TECHNOLOGICAL UNIVERSITY</h2><p>MAIN CAMPUS</p>
      <p>M.J. Cuenco Avenue Cor. R. Palma Street, Cebu City, Philippines</p>
      <p>${escapeHtml(appState.data.DB.settings?.contactEmail||'ctumainmedclinic@gmail.com')} · Phone: ${escapeHtml(appState.data.DB.settings?.phone||'(032) 402 4060 loc. 1142')}</p>
      <p><strong>DENTAL CLINIC</strong></p>
    </div>
    <div class="dental-doc-title">DENTAL RECORD</div>

    <div class="dental-doc-info">
      <div class="wide">Name: <strong>${safe((pt.fname||'')+' '+(pt.lname||''))}</strong></div>
      <div>Age: <strong>${safe(String(age))}</strong></div>
      <div>Date: <strong>${d.recordDate?fmtDate(d.recordDate):fmtDate(t.date)}</strong></div>
      <div>Course &amp; Major: <strong>${safe(d.courseMajor||pt.college||'')}</strong></div>
      <div>Yr. &amp; Section: <strong>${safe(d.yearSection)}</strong></div>
      <div>Cel No.: <strong>${safe(d.cellNo||pt.contact||'')}</strong></div>
      <div>ID No.: <strong>${safe(pt.idNo||'')}</strong></div>
      <div class="wide">Messenger Account: <strong>${safe(d.messengerAccount)}</strong></div>
    </div>

    <div class="dental-chart">
      ${allRows(appState.patientForm.DENTAL_PERMANENT_UPPER)}
      ${allRows(appState.patientForm.DENTAL_PERMANENT_LOWER)}
      <div style="height:14px"></div>
      ${allRows(appState.patientForm.DENTAL_PRIMARY_UPPER,true)}
      ${allRows(appState.patientForm.DENTAL_PRIMARY_LOWER,true)}
    </div>

    <div class="dental-doc-bottom">
      <div>
        <h4>Oral Health Record</h4>
        <div class="dental-doc-list">
          ${oralLines.map(([label,on])=>`${on?'☑':'☐'} ${label}`).join('<br>')}
          ${oral.others?`<br><strong>Others:</strong> ${safe(oral.others)}`:''}
        </div>
      </div>
      <div>
        <h4>Accomplishment</h4>
        <table class="dental-doc-operation"><thead><tr><th>Tooth No.</th><th>Nature of Operation</th></tr></thead>
          <tbody>${operations.length?operations.map(r=>`<tr><td>${safe(r.tooth_no)}</td><td>${safe(r.nature)}</td></tr>`).join(''):'<tr><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr>'}</tbody></table>
        <div class="dental-doc-list">
          ${d.workStatus==='Completed'?'☑':'☐'} All necessary dental work has been completed<br>
          ${d.workStatus==='In Progress'?'☑':'☐'} Treatment is in progress<br>
          ${d.workStatus==='No Dental Work Necessary'?'☑':'☐'} No dental work is necessary
        </div>
      </div>
    </div>

    <div class="dental-doc-recommendation"><strong>RECOMMENDATION</strong><div>${safe(d.recommendation)}</div></div>
    <div class="dental-doc-sign"><div class="line">${safe(d.dentistName||docName(doc)||'Dentist')}</div><span>Dentist</span></div>
  </div>`;
}

export function viewDentalRecord(id){
  const t=treatmentRecords().find(x=>x.id===Number(id));if(!t?.dentalRecord)return;
  openModal(`<div class="modal modal-xl"><div class="modal-header"><div><h3>Dental Record</h3><div class="text-muted">CTU Dental Clinic record preview</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div>
    <div class="modal-body"><div class="treatment-record-shell">${dentalRecordDocumentHtml(t)}</div></div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>
      <button class="btn btn-info" ${bindAction('click',(event,element)=>{printDentalRecord((id))})}><i class="bi bi-printer"></i> Print</button>
      <button class="btn btn-primary" ${bindAction('click',(event,element)=>{downloadDentalRecordPDF((id))})}><i class="bi bi-file-earmark-arrow-down"></i> Download PDF</button></div></div>`);
}

export function printDentalRecord(id){
  const t=treatmentRecords().find(x=>x.id===Number(id));if(!t?.dentalRecord)return;
  const w=window.open('','_blank','width=980,height=920');
  if(!w){toast('Please allow pop-ups to print the dental record.','warning');return;}
  const css=[...document.styleSheets].map(()=> '').join('');
  w.document.write(`<!doctype html><html><head><title>Dental Record</title><style>
    body{margin:0;padding:22px;background:#fff}
    ${document.querySelector('style')?.textContent||''}
    .dental-record-doc{box-shadow:none!important}
    @media print{body{padding:0}.dental-record-doc{max-width:none;padding:14mm}}
  </style></head><body>${dentalRecordDocumentHtml(t)}</body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),350);
}

export async function downloadDentalRecordPDF(id){
  const t=treatmentRecords().find(x=>x.id===Number(id));if(!t?.dentalRecord)return;
  let stage=null;
  try{
    const [jsPDF,html2canvas]=await Promise.all([loadJsPDF(),loadHtml2Canvas()]);
    stage=document.createElement('div');
    stage.style.cssText='position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1';
    stage.innerHTML=dentalRecordDocumentHtml(t);
    document.body.appendChild(stage);
    const doc=stage.querySelector('.dental-record-doc');
    doc.style.width='794px';doc.style.maxWidth='794px';
    await waitForDocumentImages(doc);
    const canvas=await html2canvas(doc,{scale:2,backgroundColor:'#fff',useCORS:true,logging:false});
    const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait'});
    const img=canvas.toDataURL('image/jpeg',.96),pageW=210,pageH=297,imgH=canvas.height*pageW/canvas.width;
    let remain=imgH,pos=0;
    pdf.addImage(img,'JPEG',0,pos,pageW,imgH,'FAST');remain-=pageH;
    while(remain>0){pos=remain-imgH;pdf.addPage();pdf.addImage(img,'JPEG',0,pos,pageW,imgH,'FAST');remain-=pageH;}
    const pt=getPatientById(t.patientId)||{};
    pdf.save(`CampusCare_Dental_Record_${(pt.lname||'Patient').replace(/\s+/g,'_')}_${treatmentDisplayId(t)}.pdf`);
    toast('Dental record downloaded as PDF.','success');
  }catch(e){
    console.error(e);
    toast('Could not generate the dental record PDF. Please use Print instead.','error');
  }finally{if(stage)stage.remove();}
}

export function viewTreatment(id){
  const t=treatmentRecords().find(x=>x.id===Number(id));if(!t)return;
  const dental=isDentalTreatment(t);
  const canEditDental=['Doctor','Administrator'].includes(appState.auth.currentUser.role);
  openModal(`<div class="modal modal-xl"><div class="modal-header"><div><h3>Treatment Record #${treatmentDisplayId(t)}</h3><div class="text-muted">Clinical document preview</div></div><button class="close-btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>✕</button></div><div class="modal-body"><div class="treatment-record-shell">${treatmentDocumentHtml(t)}</div></div><div class="modal-footer" style="justify-content:space-between;flex-wrap:wrap"><span class="tech-note">${t.dentalRecord?'This treatment includes a CTU Dental Clinic record.':dental?'A Dental Clinic record can be completed for this treatment.':'PDF uses the same clinical-document layout shown in the preview.'}</span><div style="display:flex;gap:.45rem;flex-wrap:wrap"><button class="btn" ${bindAction('click',(event,element)=>{closeAllModals()})}>Close</button>${t.dentalRecord?`<button class="btn btn-success" ${bindAction('click',(event,element)=>{viewDentalRecord((id))})}><i class="bi bi-emoji-smile"></i> Dental Record</button>`:(dental&&canEditDental?`<button class="btn btn-success" ${bindAction('click',(event,element)=>{openDentalRecordEditor((id))})}><i class="bi bi-plus-circle"></i> Add Dental Record</button>`:'')}${t.dentalRecord&&canEditDental?`<button class="btn btn-warning" ${bindAction('click',(event,element)=>{openDentalRecordEditor((id))})}><i class="bi bi-pencil"></i> Edit Dental Record</button>`:''}<button class="btn btn-info" ${bindAction('click',(event,element)=>{printTreatmentRecord((id))})}><i class="bi bi-printer"></i> Print</button><button class="btn btn-primary" ${bindAction('click',(event,element)=>{downloadTreatmentPDF((id))})}><i class="bi bi-file-earmark-arrow-down"></i> Download PDF</button></div></div></div>`);
}
export function printTreatmentRecord(id){
  const t=treatmentRecords().find(x=>x.id===Number(id));if(!t)return;
  const w=window.open('','_blank','width=900,height=900');if(!w){toast('Please allow pop-ups to print the treatment record.','warning');return;}
  w.document.write(`<!doctype html><html><head><title>Treatment Record #${id}</title><style>body{font-family:Arial,sans-serif;background:#fff;margin:0;padding:24px}.treatment-record-doc{max-width:760px;margin:auto;color:#1f2933}.treatment-doc-head{text-align:center;border-bottom:2px solid #0a7ea8;padding-bottom:14px;margin-bottom:18px}.treatment-doc-head h2{font-size:20px;margin:0;color:#12314a}.treatment-doc-head p{font-size:11px;color:#5f6d76}.treatment-doc-title{text-align:center;font-size:15px;font-weight:800;letter-spacing:1px;margin:16px 0;color:#0a5f80}.treatment-doc-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 18px}.treatment-doc-field{font-size:12px;border-bottom:1px solid #e7ecef;padding:5px 0}.treatment-doc-field span,.treatment-vital-box span{display:block;font-size:10px;text-transform:uppercase;color:#76848d;font-weight:700}.treatment-doc-vitals{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 17px}.treatment-vital-box{border:1px solid #dfe7ec;border-radius:8px;padding:8px;text-align:center}.treatment-doc-section{margin:14px 0}.treatment-doc-section h4{font-size:11px;text-transform:uppercase;color:#0a6f96;border-bottom:1px solid #cfe0e8;padding-bottom:4px}.treatment-doc-section p{font-size:12px;line-height:1.55}.treatment-doc-sign{display:flex;justify-content:flex-end;margin-top:34px}.treatment-doc-sign>div{width:240px;text-align:center;font-size:11px}.treatment-doc-sign .line{border-top:1px solid #333;margin-top:38px;padding-top:5px}</style></head><body>${treatmentDocumentHtml(t)}</body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),250);
}

export async function waitForDocumentImages(root){
  const images=[...(root?.querySelectorAll?.('img')||[])];
  await Promise.all(images.map(img=>{
    if(img.complete&&img.naturalWidth>0)return Promise.resolve();
    return new Promise(resolve=>{img.addEventListener('load',resolve,{once:true});img.addEventListener('error',resolve,{once:true});setTimeout(resolve,1500);});
  }));
}

export async function downloadTreatmentPDF(id){
  const t=treatmentRecords().find(x=>x.id===Number(id));if(!t)return;
  let stage=null;
  try{
    const [jsPDF,html2canvas]=await Promise.all([loadJsPDF(),loadHtml2Canvas()]);
    stage=document.createElement('div');stage.style.cssText='position:fixed;left:-10000px;top:0;width:794px;background:#fff;z-index:-1';stage.innerHTML=treatmentDocumentHtml(t);document.body.appendChild(stage);
    const doc=stage.querySelector('.treatment-record-doc');doc.style.width='794px';doc.style.maxWidth='794px';doc.style.boxShadow='none';doc.style.border='none';doc.style.borderRadius='0';
    await waitForDocumentImages(doc);
    const canvas=await html2canvas(doc,{scale:2,backgroundColor:'#ffffff',useCORS:true,logging:false});
    const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait'}),imgData=canvas.toDataURL('image/jpeg',.96),pageW=210,pageH=297,imgH=canvas.height*pageW/canvas.width;
    let remaining=imgH,pos=0;pdf.addImage(imgData,'JPEG',0,pos,pageW,imgH,'FAST');remaining-=pageH;while(remaining>0){pos=remaining-imgH;pdf.addPage();pdf.addImage(imgData,'JPEG',0,pos,pageW,imgH,'FAST');remaining-=pageH;}
    const pt=getPatientById(t.patientId)||{};pdf.save(`CampusCare_Treatment_${(pt.lname||'Patient').replace(/\s+/g,'_')}_${treatmentDisplayId(t)}.pdf`);
    auditLog('TREATMENT_PDF_EXPORTED',`Treatment #${treatmentDisplayId(t)} downloaded as PDF.`,'Treatment',t.id);toast('Treatment record downloaded as PDF.','success');
  }catch(e){console.error(e);toast('Could not generate the PDF. Please try Print instead.','error');}
  finally{if(stage)stage.remove();}
}
export async function viewTreatmentForAppt(apptId){
  try{
    if(appState.auth.currentUser?._realSupabase)await syncRealTreatments();
    const t=treatmentRecords().find(x=>x.appointmentId===Number(apptId));
    if(t)viewTreatment(t.id);
    else toast('No treatment record for this appointment.','warning');
  }catch(e){
    toast(e?.message||'Unable to load the treatment record.','error');
  }
}

export function archiveTreat(id){
  const t=treatmentRecords().find(x=>x.id===Number(id));if(!t)return;
  showConfirmDialog({
    title:'Archive Treatment Record',
    message:`Archive treatment record <strong>#${treatmentDisplayId(t)}</strong>? It will be hidden from the active list but preserved and can be restored later.`,
    confirmLabel:'Archive',
    danger:true,
    onConfirm:async()=>{
      try{
        if(t._realSupabase){
          await treatmentAction({action:'archive',treatment_id:t.dbTreatmentId});
          await syncRealTreatments();
        }else{
          t.archived=true;t.archivedAt=new Date().toISOString();t.archivedBy=appState.auth.currentUser.id;
          auditLog('TREATMENT_ARCHIVED',`Treatment #${id} archived.`,'Treatment',id);
          persistDB();
        }
        toast('Treatment record archived.','success');
        renderTreatTable();
      }catch(e){toast(e?.message||'Unable to archive treatment record.','error');}
    }
  });
}

export function restoreTreat(id){
  const t=treatmentRecords().find(x=>x.id===Number(id));if(!t)return;
  showConfirmDialog({
    title:'Restore Treatment Record',
    message:`Restore treatment record <strong>#${treatmentDisplayId(t)}</strong> to the active treatment list?`,
    confirmLabel:'Restore',
    onConfirm:async()=>{
      try{
        if(t._realSupabase){
          await treatmentAction({action:'restore',treatment_id:t.dbTreatmentId});
          await syncRealTreatments();
        }else{
          t.archived=false;t.restoredAt=new Date().toISOString();t.restoredBy=appState.auth.currentUser.id;
          auditLog('TREATMENT_RESTORED',`Treatment #${id} restored.`,'Treatment',id);
          persistDB();
        }
        toast('Treatment record restored.','success');
        renderTreatTable();
      }catch(e){toast(e?.message||'Unable to restore treatment record.','error');}
    }
  });
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
