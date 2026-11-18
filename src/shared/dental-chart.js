// The CTU dental chart (FDI numbering), shared by the dental record form, the printed dental record and
// the dental certificate. Each tooth has a mark box (TM) and a tooth picture with four side surfaces.
// The mark box takes a check mark or a condition code; the picture's sides are filled black when marked.

// Mark box values. A click gives the check mark; a double-click picks one of the codes.
export const TOOTH_CHECK='✓';
export const TOOTH_MARKS=[
  ['CL1','Class 1','Caries on the pits and fissures (biting surface of molars and premolars)'],
  ['CL2','Class 2','Caries between the back teeth (mesial or distal of molars and premolars)'],
  ['CL3','Class 3','Caries between the front teeth, not reaching the biting edge'],
  ['CL4','Class 4','Caries between the front teeth, including the biting edge'],
  ['CL5','Class 5','Caries near the gum line, on the frontal or lingual side'],
  ['RF','Root fragment'],
  ['M','Missing'],
  ['IM','Impacted']
];
export const TOOTH_MARK_CODES=[TOOTH_CHECK,...TOOTH_MARKS.map(([code])=>code)];

// The tooth picture: a rounded square split into four sides around a centre. Points are on a 24×24 grid.
// The centre is drawn but is not a surface that can be marked.
export const TOOTH_SURFACES=[
  ['T','Top','2,2 22,2 16,8 15,7 9,7 8,8'],
  ['L','Left','2,2 8,8 7,9 7,15 8,16 2,22'],
  ['R','Right','22,2 22,22 16,16 17,15 17,9 16,8'],
  ['B','Bottom','2,22 22,22 16,16 15,17 9,17 8,16']
];
export const TOOTH_CENTER='9,7 15,7 17,9 17,15 15,17 9,17 7,15 7,9';
const SIDE_CODES=TOOTH_SURFACES.map(([code])=>code);

// Side names: the top is the frontal side and the bottom the lingual side. Mesial faces the midline, so
// left and right swap between the patient's right teeth (quadrants 1, 4, 5, 8, drawn on the left) and left teeth.
export function toothSurfaceName(n,q){
  const rightSide='1458'.includes(String(n)[0]);
  if(q==='T')return 'Frontal';
  if(q==='B')return 'Lingual';
  return (q==='R')===rightSide?'Mesial':'Distal';
}

// The marked sides of a tooth, in drawing order. Older records may also hold "O" (a check on the centre).
export function toothSides(odontogram={},n){
  const on=new Set(String(odontogram?.[`${n}-surfaces`]||'').split(',').filter(Boolean));
  return SIDE_CODES.filter(code=>on.has(code));
}
// What the mark box shows. Older records drew the check on the centre of the picture; it moves to the box.
export function toothMark(odontogram={},n){
  const value=String(odontogram?.[n]||'').trim().toUpperCase();
  if(value)return value===TOOTH_CHECK.toUpperCase()?TOOTH_CHECK:value;
  return String(odontogram?.[`${n}-surfaces`]||'').split(',').includes('O')?TOOTH_CHECK:'';
}
// Brings an older record to the current form: the centre check becomes a box check and "O" is dropped.
export function normalizeOdontogram(odontogram={}){
  const result={};
  for(const [key,value] of Object.entries(odontogram||{})){
    if(!key.endsWith('-surfaces')){if(String(value||'').trim())result[key]=String(value).trim();continue;}
    const n=key.slice(0,-'-surfaces'.length),sides=toothSides(odontogram,n);
    if(sides.length)result[key]=sides.join(',');
    if(!result[n]&&toothMark(odontogram,n))result[n]=toothMark(odontogram,n);
  }
  return result;
}

// A printable tooth picture (black-filled sides), sized in pixels.
export function toothIconSvg(sides=[],size=24){
  const on=new Set(sides);
  const parts=TOOTH_SURFACES.map(([q,,points])=>`<polygon points="${points}" fill="${on.has(q)?'#000':'#fff'}" stroke="#111" stroke-width="1" stroke-linejoin="round"/>`).join('');
  const id='tc'+Math.random().toString(36).slice(2,8);
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><defs><clipPath id="${id}"><rect x="2" y="2" width="20" height="20" rx="6"/></clipPath></defs><g clip-path="url(#${id})">${parts}<polygon points="${TOOTH_CENTER}" fill="#fff" stroke="#111" stroke-width="1" stroke-linejoin="round"/></g><rect x="2" y="2" width="20" height="20" rx="6" fill="none" stroke="#111" stroke-width="1.4"/></svg>`;
}

export const PERMANENT_TEETH=[[18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28],[48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38]];
export const PRIMARY_TEETH=[[55,54,53,52,51,61,62,63,64,65],[85,84,83,82,81,71,72,73,74,75]];

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// One block of the paper chart: mark boxes and numbers above, two rows of tooth pictures, then numbers and
// mark boxes below, with LEFT and RIGHT under it. Inline styles so it prints the same everywhere.
export function dentalChartTableHtml([upper,lower],odontogram={},{width=672,cell=24,className='dc-chart'}={}){
  const box='border:1px solid #111;height:22px;padding:0;text-align:center;vertical-align:middle';
  const mark=n=>{const value=toothMark(odontogram,n);return `<td class="dc-code" data-tooth="${n}" style="${box};font:700 11px Arial,sans-serif;color:${value===TOOTH_CHECK?'#15803d':'#b00020'}">${esc(value)}</td>`;};
  const num=n=>`<td class="dc-num" style="${box};font:10px Arial,sans-serif">${n}</td>`;
  const pic=(n,i,list)=>`<td class="dc-icon" style="padding:1px 0;text-align:center;${i===0?'border-left:1px solid #111;':''}${i===list.length-1?'border-right:1px solid #111;':''}">${toothIconSvg(toothSides(odontogram,n),cell)}</td>`;
  const half=upper.length/2;
  return `<table class="${className}${upper.length<16?' dc-primary':''}" contenteditable="false" style="width:${width}px;border-collapse:collapse;table-layout:fixed;margin:0 auto"><tbody>
    <tr>${upper.map(mark).join('')}</tr><tr>${upper.map(num).join('')}</tr>
    <tr class="dc-pics">${upper.map(pic).join('')}</tr><tr class="dc-pics">${lower.map(pic).join('')}</tr>
    <tr>${lower.map(num).join('')}</tr><tr>${lower.map(mark).join('')}</tr>
    <tr class="dc-sides"><td colspan="${half}" style="text-align:left;font:10px Arial,sans-serif;padding-top:3px">LEFT</td><td colspan="${half}" style="text-align:right;font:10px Arial,sans-serif;padding-top:3px">RIGHT</td></tr>
  </tbody></table>`;
}
