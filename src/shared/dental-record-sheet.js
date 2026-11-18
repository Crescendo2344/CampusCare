// The printed DENTAL RECORD, laid out like the CTU Dental Clinic's paper form: letterhead, patient lines,
// the permanent and temporary tooth charts, oral health record, accomplishment, recommendation and the
// dentist's name. One self-contained page used for the preview, printing and the PDF download.
import {ctuFooterHtml,ctuHeaderHtml} from './ctu-letterhead.js';
import {PERMANENT_TEETH,PRIMARY_TEETH,dentalChartTableHtml} from './dental-chart.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const WORK_STATUS_LINES=[['Completed','All necessary dental work has been completed'],['In Progress','Treatment is in progress'],['No Dental Work Necessary','No dental work is necessary']];
export const ORAL_CONDITIONS=[['satisfactory','Satisfactory'],['fair','Fair'],['poor','Poor']];
export const ORAL_FINDINGS=[['harelip','Harelip'],['defective_gums','Defective Gums'],['cleft_palate','Cleft Palate']];

export const DENTAL_RECORD_CSS=`
.drd{width:794px;box-sizing:border-box;padding:34px 46px 26px;background:#fff;color:#111;font:12px/1.35 Arial,Helvetica,sans-serif}
.drd *{box-sizing:border-box}
.drd-title{text-align:center;font-weight:700;font-size:13px;letter-spacing:.04em;margin:6px 0 16px}
.drd-info{width:100%;border-collapse:collapse;margin:0 0 16px}
.drd-info td{padding:4px 6px 4px 0;white-space:nowrap;vertical-align:bottom;font-size:12px}
.drd-fill{display:inline-block;min-width:60px;border-bottom:1px solid #111;padding:0 4px;white-space:normal;vertical-align:bottom}
.drd-chart{margin:0 auto 18px}
.drd-cols{display:flex;gap:28px;margin-top:6px}
.drd-cols>div{flex:1}
.drd h4{margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.02em}
.drd-line{display:flex;gap:16px;align-items:center;margin:3px 0}
.drd-mark{font-size:14px;line-height:1}
.drd-ops{width:100%;border-collapse:collapse;margin:2px 0 8px}
.drd-ops th{text-align:left;font-weight:400;font-size:12px;padding:2px 4px 2px 0}
.drd-ops td{border-bottom:1px solid #111;height:20px;padding:2px 4px 0 0;font-size:12px}
.drd-rec{margin-top:14px}
.drd-rec div{border-bottom:1px solid #111;min-height:20px;padding:2px 0;font-size:12px}
.drd-sign{display:flex;justify-content:flex-end;margin:26px 0 8px}
.drd-sign>div{text-align:center;min-width:230px}
.drd-sign strong{display:block;font-size:12.5px}
.drd .ctu-lh-foot{margin-top:14px}
`;

/**
 * @param {{name?:string,age?:string|number,date?:string,courseMajor?:string,yearSection?:string,cellNo?:string,idNo?:string,
 *   messenger?:string,odontogram?:object,oral?:object,operations?:{tooth_no?:string,nature?:string}[],workStatus?:string,
 *   recommendation?:string,dentistName?:string,dentistTitle?:string}} r
 */
export function dentalRecordSheetHtml(r){
  const fill=(value,width)=>`<span class="drd-fill" style="min-width:${width}px">${esc(value)}</span>`;
  const oral=r.oral||{};
  const circle=on=>`<span class="drd-mark">${on?'●':'○'}</span>`;
  const box=on=>`<span class="drd-mark">${on?'☑':'☐'}</span>`;
  const ops=(r.operations||[]).filter(op=>op?.tooth_no||op?.nature);
  const opRows=[...ops,...Array.from({length:Math.max(0,3-ops.length)},()=>({}))];
  const recommendation=String(r.recommendation||'').split(/\n+/).filter(Boolean);
  const recLines=[...recommendation,...Array.from({length:Math.max(0,3-recommendation.length)},()=>'')];
  return `<div class="drd">
    ${ctuHeaderHtml({clinic:'Dental Clinic'})}
    <div class="drd-title">DENTAL RECORD</div>
    <table class="drd-info" role="presentation">
      <tr><td colspan="2">Name: ${fill(r.name,300)}</td><td>Age: ${fill(r.age,50)}</td><td>Date: ${fill(r.date,110)}</td></tr>
      <tr><td colspan="2">Course &amp; Major: ${fill(r.courseMajor,210)}</td><td>Yr. &amp; Section: ${fill(r.yearSection,60)}</td><td>Cel No. ${fill(r.cellNo,110)}</td></tr>
      <tr><td colspan="2">ID No. ${fill(r.idNo,150)}</td><td colspan="2">Messenger Account: ${fill(r.messenger,170)}</td></tr>
    </table>
    <div class="drd-chart">${dentalChartTableHtml(PERMANENT_TEETH,r.odontogram||{},{width:672,cell:24})}</div>
    <div class="drd-chart">${dentalChartTableHtml(PRIMARY_TEETH,r.odontogram||{},{width:420,cell:24})}</div>
    <div class="drd-cols">
      <div>
        <h4>ORAL HEALTH RECORD</h4>
        <div>Check:</div>
        <div class="drd-line">${ORAL_CONDITIONS.map(([key,label])=>`<span>${label} ${circle(oral[key])}</span>`).join('')}</div>
        ${ORAL_FINDINGS.map(([key,label])=>`<div class="drd-line"><span style="min-width:110px">${label}</span>${circle(oral[key])}</div>`).join('')}
        <div style="margin-top:6px">Others: ${fill(oral.others,200)}</div>
      </div>
      <div>
        <h4>ACCOMPLISHMENT</h4>
        <table class="drd-ops"><thead><tr><th style="width:70px">Tooth No.</th><th>Nature of Operation</th></tr></thead>
          <tbody>${opRows.map(op=>`<tr><td>${esc(op.tooth_no)}</td><td>${esc(op.nature)}</td></tr>`).join('')}</tbody></table>
        ${WORK_STATUS_LINES.map(([value,label])=>`<div class="drd-line">${box(r.workStatus===value)}<span>${label}</span></div>`).join('')}
      </div>
    </div>
    <div class="drd-rec"><h4>RECOMMENDATION</h4>${recLines.map(text=>`<div>${esc(text)||'&nbsp;'}</div>`).join('')}</div>
    <div class="drd-sign"><div><strong>${esc(r.dentistName||'')}</strong><span>${esc(r.dentistTitle||'Dentist')}</span></div></div>
    ${ctuFooterHtml()}
  </div>`;
}
