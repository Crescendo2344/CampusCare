// One CSV format for every CampusCare export, following common open-data practice:
// a single header row in plain language (with units), one record per row, ISO dates (YYYY-MM-DD),
// 24-hour times in Philippine time, CRLF line endings and a UTF-8 byte-order mark so Excel reads
// accents correctly. Text that a spreadsheet would run as a formula is kept literal.

export function csvCell(value){
  if(value===null||value===undefined)return '';
  let text=String(value);
  if(typeof value==='string'&&/^[=+\-@\t\r]/.test(text))text="'"+text;
  return /[",\r\n]/.test(text)||text!==text.trim()||text.startsWith("'")?`"${text.replace(/"/g,'""')}"`:text;
}

// rows: an array of arrays; the first row is the header.
export function toCsv(rows){
  return '﻿'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
}

// Every export follows one template, like a well-kept spreadsheet: the record's number or name first,
// then related fields grouped as "Group: Field" (e.g. "Patient: Last Name"), one value per cell.
export const csvColumn=(group,label,value)=>({group,label,value});
export const csvHeader=column=>column.group?`${column.group}: ${column.label}`:column.label;
export function templateCsv(columns,rows){
  return toCsv([columns.map(csvHeader),...rows.map(row=>columns.map(column=>column.value(row)))]);
}

// Objects keyed by column label, e.g. report tables, keep their key order as the header.
export function objectsToCsv(objects){
  if(!objects.length)return '﻿';
  const headers=Object.keys(objects[0]);
  return toCsv([headers,...objects.map(o=>headers.map(h=>o[h]))]);
}

const MANILA={timeZone:'Asia/Manila',hourCycle:'h23'};
export function csvDate(value){
  if(!value)return '';
  const text=String(value);
  if(/^\d{4}-\d{2}-\d{2}$/.test(text))return text;
  const d=new Date(text);
  if(Number.isNaN(d.getTime()))return text;
  return new Intl.DateTimeFormat('en-CA',{...MANILA,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
export function csvTime(value){
  if(!value)return '';
  const text=String(value);
  if(/^\d{2}:\d{2}/.test(text))return text.slice(0,5);
  const d=new Date(text);
  if(Number.isNaN(d.getTime()))return text;
  return new Intl.DateTimeFormat('en-GB',{...MANILA,hour:'2-digit',minute:'2-digit'}).format(d);
}
// A readable date for people who asked for it (e.g. "Oct 27, 2026") instead of the sortable form.
export function csvReadableDate(value){
  const iso=csvDate(value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso))return iso;
  return new Date(iso+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}
export function csvMoney(value){
  const n=Number(value);
  return Number.isFinite(n)?n.toFixed(2):'';
}

// campuscare-<what>-<YYYY-MM-DD>.csv, lower-case words joined with hyphens. Names that already
// carry their own date range leave the date out.
export function csvFileName(what,date=''){
  const slug=String(what||'export').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'export';
  return `campuscare-${slug}${date?'-'+date:''}.csv`;
}

export function downloadCsv(fileName,csv){
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
  const link=Object.assign(document.createElement('a'),{href:url,download:fileName});
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
