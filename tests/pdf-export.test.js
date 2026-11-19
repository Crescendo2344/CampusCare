import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// jsPDF's addImage(data, format, x, y, w, h, alias, compression): a constant in the alias position makes
// every page reuse the first page's image, so multi-page PDFs repeated one sheet.
test('PDF pages are added with the compression in its own argument, never as the image alias',()=>{
  for(const file of fs.readdirSync('src/features').map(f=>'src/features/'+f)){
    const source=fs.readFileSync(file,'utf8');
    for(const call of source.match(/pdf\.addImage\([^;]*?\)/g)||[]){
      const args=call.slice('pdf.addImage('.length,-1).split(',');
      if(args.length>=7)assert.notEqual(args[6].trim(),"'FAST'",`${file}: ${call}`);
    }
  }
});

test('the dental record starts with the Dental Record and ends with the Dental Health History Form',()=>{
  const source=fs.readFileSync('src/features/treatmentForm.js','utf8');
  const pages=source.slice(source.indexOf('export async function dentalRecordPages'),source.indexOf('export function viewDentalRecord'));
  const record=pages.indexOf('dentalRecordSheetHtml('),log=pages.indexOf('treatmentRemarksSheetHtml('),history=pages.indexOf('history.pages.map');
  assert(record>0&&record<log&&log<history,'Dental Record, then Treatment/Remarks, then the Dental Health History Form');
});

test('the printed record keeps black text whatever the app theme',()=>{
  const css=fs.readFileSync('src/shared/dental-record-sheet.js','utf8');
  assert.match(css,/\.drd,\.drd \*\{color:#111!important;opacity:1!important/);
});
