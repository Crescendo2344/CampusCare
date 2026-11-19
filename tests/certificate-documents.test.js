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
  const medical=source.slice(source.indexOf('export function buildMedicalCertificateDocument'),source.indexOf('export function certificateDocumentFor(r)'));
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

test('the e-signature is kept out of the saved document, and cut-off documents are rebuilt',()=>{
  const source=fs.readFileSync('src/features/certificateService.js','utf8');
  assert.match(source,/export function certificateDocumentForStorage\(html\)/);
  assert.match(source,/const documentHtml=certificateDocumentForStorage\(editor\.innerHTML\);/);
  assert.match(source,/const finalHtml=certificateDocumentForStorage\(/);
  assert.match(source,/if\(r\?\.documentHtml&&documentIsComplete\(r\.documentHtml\)\)return r\.documentHtml;/);
  assert.match(source,/sigEl\.setAttribute\('src',r\.signatureData\)/,'the stored signature is put back when shown');
});

test('certificates and dental records print from the page, not a hidden frame (phones print the page)',()=>{
  const cert=fs.readFileSync('src/features/certificateService.js','utf8');
  const start=cert.indexOf('export function printCertificate(id){');
  assert.ok(cert.slice(start,start+700).includes('printInPage('));
  assert.ok(!cert.slice(start,start+700).includes("createElement('iframe')"));
  const dental=fs.readFileSync('src/features/treatmentForm.js','utf8');
  const d=dental.indexOf('export async function printDentalRecord(id){');
  assert.ok(dental.slice(d,d+500).includes('printInPage('));
  const lh=fs.readFileSync('src/shared/ctu-letterhead.js','utf8');
  assert.match(lh,/body>\*:not\(#cc-print-root\)\{display:none!important\}/);
});
