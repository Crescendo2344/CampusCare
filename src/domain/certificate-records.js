// Certificate records can be normalized without a session, DOM or application globals.
export function certificateRecords(snapshot,account){
  const rows=snapshot.certRequests||[];
  return account?._realSupabase?rows.filter(r=>r._realSupabase):rows;
}

export function certificateDisplayId(r){
  const id=Number(r?.dbCertificateId??r?.id??0);
  return String(id).padStart(6,'0');
}

export function certificateNumberFor(r,now=new Date()){
  if(r?.certNo)return r.certNo;
  const id=Number(r?.dbCertificateId??r?.id??0);
  return `CTU-MC-${now.getFullYear()}-${String(id).padStart(6,'0')}`;
}

export function realCertificateToUi(r){
  return {
    id:700000+Number(r.certificate_id),
    dbCertificateId:Number(r.certificate_id),
    patientId:200000+Number(r.patient_id),
    dbPatientId:Number(r.patient_id),
    doctorId:r.doctor_id?100000+Number(r.doctor_id):null,
    dbDoctorId:r.doctor_id?Number(r.doctor_id):null,
    treatmentId:r.treatment_id?500000+Number(r.treatment_id):null,
    dbTreatmentId:r.treatment_id?Number(r.treatment_id):null,
    purpose:r.purpose||'',
    details:r.request_details||'',
    status:r.status||'Pending',
    requestedAt:r.requested_at||r.created_at||'',
    certNo:r.certificate_no||'',
    issuedAt:r.issued_at||'',
    findings:r.examination_findings||'',
    recommendations:r.remarks||'',
    documentHtml:r.document_content||'',
    signatureData:r.signature_url||'',
    declineReason:r.decline_reason||'',
    preparedById:r.prepared_by?100000+Number(r.prepared_by):null,
    preparedAt:r.prepared_at||'',
    signedById:r.signed_by?100000+Number(r.signed_by):null,
    signedAt:r.signed_at||'',
    updatedAt:r.updated_at||'',
    _realSupabase:true
  };
}

// Replace only live rows so demo data remains available in its own mode.
export function mergeCertificateRecords(existing,rows){
  return [...existing.filter(r=>!r._realSupabase),...rows.map(realCertificateToUi)];
}
