// Every list download offers the same three formats (Excel, Word and PDF) on the CTU letterhead.
// Callers hand over the table they used to save as CSV; it is parsed back into rows here.
import {bindAction} from '../dependencies.js';
import {closeTopModal,openModal} from './modals.js';
import {escapeHtml} from './issueReports.js';

// A small CSV reader for our own exports (quoted cells, doubled quotes, CRLF, byte-order mark).
export function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false;
  const src=String(text||'').replace(/^﻿/,'');
  for(let i=0;i<src.length;i++){
    const c=src[i];
    if(quoted){
      if(c==='"'){if(src[i+1]==='"'){cell+='"';i++;}else quoted=false;}
      else cell+=c;
    }else if(c==='"')quoted=true;
    else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&src[i+1]==='\n')i++;
      row.push(cell);cell='';rows.push(row);row=[];
    }else cell+=c;
  }
  if(cell!==''||row.length){row.push(cell);rows.push(row);}
  return rows.filter(r=>r.some(v=>v!==''));
}

// The first row is the heading row ("Group: Field" headings become grouped columns).
export function csvToObjects(text){
  const [head=[],...body]=parseCsv(text);
  // A cell kept literal with a leading apostrophe (formula guard) reads without it in documents.
  const clean=v=>{const s=String(v??'');const n=s.startsWith("'")?s.slice(1):s;return /^-?\d+(\.\d+)?$/.test(n)&&n.length<12&&!/^0\d/.test(n)?Number(n):n;};
  return body.map(r=>Object.fromEntries(head.map((h,i)=>[h||`Column ${i+1}`,clean(r[i])])));
}

const titleFrom=fileName=>String(fileName||'CampusCare export').replace(/\.csv$/i,'').replace(/^campuscare-/,'')
  .replace(/-(\d{4})-(\d{2})-(\d{2})/g,' $1-$2-$3').replace(/-/g,' ').replace(/^./,c=>c.toUpperCase());

// Opens the format chooser. `fileName` is the old CSV name; it gives the document its title.
export function downloadTable(fileName,csv,{title=''}={}){
  const rows=csvToObjects(csv),heading=title||titleFrom(fileName);
  const run=format=>async()=>{
    closeTopModal();
    const {exportTable}=await import('./reportCharts.js');
    await exportTable({title:heading,rows,format});
  };
  openModal(`<div class="modal modal-sm" role="dialog" aria-labelledby="dl-title">
    <div class="modal-header"><div><h3 id="dl-title">Download</h3><div class="text-muted">${escapeHtml(heading)} · ${rows.length} row${rows.length===1?'':'s'}</div></div><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeTopModal())}>✕</button></div>
    <div class="modal-body"><div class="dl-formats">
      <button type="button" class="dl-format" ${bindAction('click',run('xlsx'))}><i class="bi bi-file-earmark-excel" aria-hidden="true"></i><strong>Excel</strong><span>Spreadsheet (.xlsx)</span></button>
      <button type="button" class="dl-format" ${bindAction('click',run('doc'))}><i class="bi bi-file-earmark-word" aria-hidden="true"></i><strong>Word</strong><span>Document (.docx)</span></button>
      <button type="button" class="dl-format" ${bindAction('click',run('pdf'))}><i class="bi bi-file-earmark-pdf" aria-hidden="true"></i><strong>PDF</strong><span>Print or save as PDF</span></button>
    </div></div>
  </div>`);
}
