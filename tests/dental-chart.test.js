// The tooth chart and the printed DENTAL RECORD sheet.
import test from 'node:test';
import assert from 'node:assert/strict';
import {TOOTH_CHECK,TOOTH_MARK_CODES,TOOTH_SURFACES,dentalChartTableHtml,normalizeOdontogram,toothIconSvg,toothMark,toothSides,toothSurfaceName,PERMANENT_TEETH} from '../src/shared/dental-chart.js';
import {dentalRecordSheetHtml} from '../src/shared/dental-record-sheet.js';

test('the mark box takes a check or one of the clinic codes',()=>{
  assert.deepEqual(TOOTH_MARK_CODES,[TOOTH_CHECK,'CL1','CL2','CL3','CL4','CL5','RF','M','IM']);
  assert.equal(toothMark({36:'cl2'},36),'CL2');
  assert.equal(toothMark({},36),'');
});

test('only the four sides of the tooth picture are surfaces; the top is frontal',()=>{
  assert.deepEqual(TOOTH_SURFACES.map(([code])=>code),['T','L','R','B']);
  assert.equal(toothSurfaceName(16,'T'),'Frontal');assert.equal(toothSurfaceName(16,'B'),'Lingual');
  // Patient's right teeth are drawn on the left: their right side faces the midline (mesial).
  assert.equal(toothSurfaceName(16,'R'),'Mesial');assert.equal(toothSurfaceName(16,'L'),'Distal');
  assert.equal(toothSurfaceName(26,'L'),'Mesial');assert.equal(toothSurfaceName(26,'R'),'Distal');
});

test('older records: a check on the centre moves to the mark box and the centre is dropped',()=>{
  const old={'36-surfaces':'T,O','37':'CII','37-surfaces':'O','38-surfaces':'L'};
  assert.equal(toothMark(old,36),TOOTH_CHECK);
  assert.equal(toothMark(old,37),'CII','an existing code is kept');
  assert.deepEqual(toothSides(old,36),['T']);
  assert.deepEqual(normalizeOdontogram(old),{'36-surfaces':'T','36':TOOTH_CHECK,'37':'CII','38-surfaces':'L'});
});

test('printed tooth pictures shade the marked sides and never draw a check',()=>{
  const svg=toothIconSvg(['T','B']);
  assert.equal((svg.match(/fill="#000"/g)||[]).length,2);
  assert.doesNotMatch(svg,/<path[^>]*stroke/,'no check mark is drawn on the picture');
  assert.doesNotMatch(svg,/clipPath|clip-path/,'no clip path: phone PDF renderers draw it wrongly');
  const chart=dentalChartTableHtml(PERMANENT_TEETH,{36:TOOTH_CHECK,37:'CL2','36-surfaces':'T'});
  assert.match(chart,/data-tooth="36"[^>]*>✓</);assert.match(chart,/data-tooth="37"[^>]*>CL2</);
  assert.match(chart,/>LEFT</);assert.match(chart,/>RIGHT</);
});

test('the dental record sheet follows the paper form',()=>{
  globalThis.location??={href:'https://campuscare.test/'};
  const html=dentalRecordSheetHtml({name:'Ana <Reyes>',age:21,date:'Nov 14, 2026',courseMajor:'BSIT',yearSection:'3-A',cellNo:'09171234567',idNo:'1350098',messenger:'ana.r',
    odontogram:{36:TOOTH_CHECK},oral:{fair:true,harelip:true,others:'Calculus'},operations:[{tooth_no:'36',nature:'Tooth extraction'}],workStatus:'In Progress',
    recommendation:'Return in 2 weeks',dentistName:'Dr. Jane Cruz'});
  for(const text of ['REPUBLIC OF THE PHILIPPINES','CEBU TECHNOLOGICAL UNIVERSITY','MAIN CAMPUS','ctudentalclinic20@gmail.com','DENTAL CLINIC','DENTAL RECORD','Course &amp; Major','Yr. &amp; Section','Messenger Account','ORAL HEALTH RECORD','ACCOMPLISHMENT','RECOMMENDATION','Dr. Jane Cruz'])
    assert(html.includes(text),text);
  assert(html.includes('Ana &lt;Reyes&gt;'),'values are escaped');
  assert.match(html,/Fair <span class="drd-mark">●/);assert.match(html,/Poor <span class="drd-mark">○/);
  assert.match(html,/☑<\/span><span>Treatment is in progress/);assert.match(html,/☐<\/span><span>All necessary dental work/);
  assert.match(html,/Tooth extraction/);
});
