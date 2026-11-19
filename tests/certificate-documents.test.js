import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {statementFromSummary} from '../src/domain/certificate-purpose.js';

// Certificates saved without their document are rebuilt from the saved summary.
test('the certifying sentence is rebuilt from a saved summary',()=>{
  assert.match(statementFromSummary('Excused Absence','Absent 2026-09-01 to 2026-09-02'),/from September 1, 2026 to September 2, 2026 \(2 days\)/);
  assert.match(statementFromSummary('Excused Absence','Absent 2026-11-16'),/on November 16, 2026 \(1 day\)/);
  assert.match(statementFromSummary('OJT / Internship Requirement','Fit'),/physically fit to undergo on-the-job training/);
  assert.match(statementFromSummary('Sports / Athletics Participation','Varsity volleyball · Fit'),/participate in Varsity volleyball/);
  assert.equal(statementFromSummary('Excused Absence','something else'),'');
});

test('issued certificates print and download without a stored document',()=>{
  const source=fs.readFileSync('src/features/certificateService.js','utf8');
  assert.match(source,/export function certificateDocumentFor\(r\)/);
  assert.ok(!source.includes("||!r.documentHtml){toast('Only issued certificates can be printed."),'printing no longer needs a stored document');
  assert.ok(!source.includes('needs to be prepared again'),'the PDF no longer refuses certificates without a stored document');
});

test('the medical certificate uses the CTU form layout of the dental certificate',()=>{
  const source=fs.readFileSync('src/features/certificateService.js','utf8');
  const medical=source.slice(source.indexOf('export function buildMedicalCertificateDocument'),source.indexOf('export function certificateDocumentFor'));
  for(const part of ['dc-info','MEDICAL CERTIFICATE','FINDINGS / DIAGNOSIS','REMARKS / RECOMMENDATION','dc-ruled','letterheadBottom()'])assert.ok(medical.includes(part),part);
  assert.match(source,/const letterheadTop=clinic=>ctuHeaderHtml\(\{clinic,unit:false\}\)/,'no clinic line between the letterhead and the title, as on the paper form');
  assert.match(source,/certSignatureArea\(doctorName,'Dentist II',signature,false\)/,'the dentist signs without a licence line');
});

test('printable documents keep black text and are never wrapped as scrolling data tables',()=>{
  const scroll=fs.readFileSync('src/ui/table-scroll.js','utf8');
  assert.match(scroll,/table\.closest\('\.cert-paper,\.drd,\[data-print-document\]'\)/);
  const css=fs.readFileSync('src/styles/campuscare.css','utf8');
  assert.match(css,/\.cert-paper,\.cert-paper \*\{color:#111!important/);
  const sheet=fs.readFileSync('src/shared/dental-record-sheet.js','utf8');
  assert.match(sheet,/\.drd table,\.drd thead,\.drd th,\.drd td\{background:transparent!important;position:static!important\}/);
});
