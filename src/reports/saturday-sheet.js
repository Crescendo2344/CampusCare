// The printed Saturday visit log sheet, laid out like the clinic's paper form. No browser APIs, so it can be tested.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The paper log's columns, in order.
export const SATURDAY_LOG_COLUMNS=[['time','Time'],['name','Name'],['course','Course and year/Position'],['age','Age'],['gender','Gender'],['contact','Contact number'],['treatment','Treatment'],['signature','Signature']];

export const saturdayCell=(row,key)=>key==='signature'?'':key==='age'?(row.age??''):row[key]||'';
// One Saturday's sheet (printed on its own page): DATE on the left and the clinic name in the middle, then the log table.
export function saturdaySheetHtml(day,unit,blankRows){
  const blank=Array.from({length:blankRows},()=>`<tr class="sat-blank">${SATURDAY_LOG_COLUMNS.map(()=>'<td>&nbsp;</td>').join('')}</tr>`).join('');
  return `<section class="sat-sheet">
    <table class="sat-head" role="presentation"><tr><td class="sat-date">DATE: <span>${esc(day.label)}</span></td><td class="sat-unit">${esc(unit)}</td><td></td></tr></table>
    <table class="sat-log"><thead><tr>${SATURDAY_LOG_COLUMNS.map(([key,label])=>`<th class="c-${key}">${esc(label)}</th>`).join('')}</tr></thead>
    <tbody>${day.rows.map(row=>`<tr>${SATURDAY_LOG_COLUMNS.map(([key])=>`<td class="c-${key}">${esc(saturdayCell(row,key))}</td>`).join('')}</tr>`).join('')}${blank}</tbody></table>
  </section>`;
}
export const SATURDAY_SHEET_CSS=`body{font-family:Arial,Helvetica,sans-serif}
  table.sat-head{width:100%;border-collapse:collapse;margin:2px 0 8px}
  table.sat-head td{border:0;padding:0;width:33.3%;vertical-align:bottom}
  .sat-date{font-family:'Times New Roman',Times,serif;font-size:14px;font-weight:700}
  .sat-date span{font-family:Arial,Helvetica,sans-serif;font-weight:400;display:inline-block;min-width:170px;border-bottom:1px solid #111;padding:0 4px}
  .sat-unit{text-align:center;font-size:13px;font-weight:700;letter-spacing:.03em}
  table.sat-log{width:100%;border-collapse:collapse;table-layout:fixed}
  table.sat-log th,table.sat-log td{border:1px solid #111;padding:5px 5px;font-size:11px;vertical-align:middle;word-wrap:break-word}
  table.sat-log th{font-family:'Times New Roman',Times,serif;font-size:12.5px;font-weight:700;text-align:center;padding:7px 4px}
  table.sat-log td{height:26px}
  table.sat-log tr{break-inside:avoid;page-break-inside:avoid}
  .c-time{width:8%;text-align:center}.c-name{width:21%}.c-course{width:14%}.c-age{width:6%;text-align:center}.c-gender{width:8%;text-align:center}
  .c-contact{width:14%}.c-treatment{width:13%}.c-signature{width:16%}`;

