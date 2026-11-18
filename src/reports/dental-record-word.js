// The DENTAL RECORD as a Word (.docx) file, laid out like the clinic's paper form and the PDF:
// letterhead, patient lines, the tooth charts (tooth pictures as images), oral health record,
// accomplishment, recommendation and the dentist's name.
import {docxLetterhead} from '../shared/word-letterhead.js';
import {PERMANENT_TEETH,PRIMARY_TEETH,TOOTH_CHECK,toothIconSvg,toothMark,toothSides} from '../shared/dental-chart.js';
import {ORAL_CONDITIONS,ORAL_FINDINGS,WORK_STATUS_LINES} from '../shared/dental-record-sheet.js';

// Each different set of shaded sides is drawn once as a PNG.
async function toothPng(sides,cache){
  const key=sides.join(',');
  if(cache.has(key))return cache.get(key);
  const svg=toothIconSvg(sides,96);
  const image=new Image();
  image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  await image.decode();
  const canvas=document.createElement('canvas');canvas.width=96;canvas.height=96;
  const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,96,96);context.drawImage(image,0,0,96,96);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  const bytes=new Uint8Array(await blob.arrayBuffer());
  cache.set(key,bytes);
  return bytes;
}

/** @param D the docx library @param r the same record object as dentalRecordSheetHtml */
export async function dentalRecordDocx(D,r){
  const font='Arial',size=20; // half-points: 10 pt
  const pageW=11906,pageH=16838,margin=720,contentW=pageW-2*margin;
  const {header,footer}=await docxLetterhead(D,{contentW,clinic:'Dental Clinic',font});
  const run=(text,o={})=>new D.TextRun({text:String(text??''),font,size,...o});
  const para=(children,o={})=>new D.Paragraph({children:Array.isArray(children)?children:[children],spacing:{before:0,after:0},...o});
  const center=D.AlignmentType.CENTER;
  const NONE={style:D.BorderStyle.NONE,size:0,color:'FFFFFF'},LINE={style:D.BorderStyle.SINGLE,size:6,color:'111111'};
  const none={top:NONE,bottom:NONE,left:NONE,right:NONE};
  const boxed={top:LINE,bottom:LINE,left:LINE,right:LINE};
  const tableBorders=b=>({...b,insideHorizontal:NONE,insideVertical:NONE});
  const filled=(label,value)=>[run(label+' '),run(` ${value??''} `,{underline:{type:D.UnderlineType.SINGLE}})];
  const cell=(width,children,o={})=>new D.TableCell({borders:none,width:{size:Math.floor(width),type:D.WidthType.DXA},verticalAlign:D.VerticalAlign.CENTER,
    margins:{top:30,bottom:30,left:0,right:60},children:Array.isArray(children)?children:[children],...o});

  // Patient lines.
  const third=Math.floor(contentW/3);
  const info=new D.Table({width:{size:contentW,type:D.WidthType.DXA},columnWidths:[third*1.5,third*0.6,contentW-third*2.1].map(Math.floor),borders:tableBorders(none),rows:[
    new D.TableRow({children:[cell(third*1.5,para(filled('Name:',r.name))),cell(third*0.6,para(filled('Age:',r.age))),cell(contentW-third*2.1,para(filled('Date:',r.date)))]}),
    new D.TableRow({children:[cell(third*1.5,para(filled('Course & Major:',r.courseMajor))),cell(third*0.6,para(filled('Yr. & Section:',r.yearSection))),cell(contentW-third*2.1,para(filled('Cel No.',r.cellNo)))]}),
    new D.TableRow({children:[cell(third*1.5,para(filled('ID No.',r.idNo))),cell(contentW-third*1.5,para(filled('Messenger Account:',r.messenger)),{columnSpan:2})]})
  ]});

  // Tooth charts: mark boxes and numbers in bordered cells around two rows of tooth pictures.
  const cache=new Map(),odontogram=r.odontogram||{};
  const columnW=Math.floor(contentW/16);
  async function chart([upper,lower]){
    const widths=upper.map(()=>columnW),width=columnW*upper.length;
    const markCell=n=>{const value=toothMark(odontogram,n);
      return new D.TableCell({borders:boxed,width:{size:columnW,type:D.WidthType.DXA},verticalAlign:D.VerticalAlign.CENTER,
        children:[para(run(value,{bold:true,size:18,color:value===TOOTH_CHECK?'15803D':'B00020'}),{alignment:center})]});};
    const numCell=n=>new D.TableCell({borders:boxed,width:{size:columnW,type:D.WidthType.DXA},verticalAlign:D.VerticalAlign.CENTER,children:[para(run(n,{size:16}),{alignment:center})]});
    const picRow=async list=>new D.TableRow({children:await Promise.all(list.map(async(n,i)=>new D.TableCell({
      borders:{top:NONE,bottom:NONE,left:i===0?LINE:NONE,right:i===list.length-1?LINE:NONE},width:{size:columnW,type:D.WidthType.DXA},
      children:[para(new D.ImageRun({data:await toothPng(toothSides(odontogram,n),cache),transformation:{width:24,height:24}}),{alignment:center,spacing:{before:20,after:20}})]})))});
    const half=upper.length/2;
    const side=(text,align)=>new D.TableCell({borders:none,columnSpan:half,width:{size:columnW*half,type:D.WidthType.DXA},children:[para(run(text,{size:16}),{alignment:align,spacing:{before:40}})]});
    return new D.Table({alignment:center,width:{size:width,type:D.WidthType.DXA},columnWidths:widths,borders:tableBorders(none),rows:[
      new D.TableRow({height:{value:330,rule:D.HeightRule.ATLEAST},children:upper.map(markCell)}),
      new D.TableRow({children:upper.map(numCell)}),
      await picRow(upper),await picRow(lower),
      new D.TableRow({children:lower.map(numCell)}),
      new D.TableRow({height:{value:330,rule:D.HeightRule.ATLEAST},children:lower.map(markCell)}),
      new D.TableRow({children:[side('LEFT',D.AlignmentType.LEFT),side('RIGHT',D.AlignmentType.RIGHT)]})
    ]});
  }

  // Oral health record and accomplishment, side by side.
  const oral=r.oral||{};
  const circle=on=>run(on?' ●':' ○',{size:22});
  const box=on=>run(on?'☑ ':'☐ ',{size:22});
  const heading=text=>para(run(text,{bold:true}),{spacing:{after:80}});
  const ops=(r.operations||[]).filter(op=>op?.tooth_no||op?.nature);
  const opRows=[...ops,...Array.from({length:Math.max(0,3-ops.length)},()=>({}))];
  const halfW=Math.floor(contentW/2);
  const underlined=text=>run(` ${text||''}`.padEnd(40,' '),{underline:{type:D.UnderlineType.SINGLE}});
  const left=[
    heading('ORAL HEALTH RECORD'),para(run('Check:'),{spacing:{after:60}}),
    para(ORAL_CONDITIONS.flatMap(([key,label],i)=>[run((i?'     ':'')+label),circle(oral[key])]),{spacing:{after:60}}),
    ...ORAL_FINDINGS.map(([key,label])=>para([run(label),circle(oral[key])],{spacing:{after:60}})),
    para([run('Others: '),underlined(oral.others)],{spacing:{before:60}})
  ];
  const right=[
    heading('ACCOMPLISHMENT'),
    para([run('Tooth No.'),new D.TextRun({text:'\tNature of Operation',font,size})],{tabStops:[{type:D.TabStopType.LEFT,position:1200}],spacing:{after:40}}),
    ...opRows.map(op=>para([run(op.tooth_no||'',{underline:{type:D.UnderlineType.SINGLE}}),new D.TextRun({text:`\t${op.nature||''}`,font,size,underline:{type:D.UnderlineType.SINGLE}})],
      {tabStops:[{type:D.TabStopType.LEFT,position:1200}],border:{bottom:{style:D.BorderStyle.SINGLE,size:6,color:'111111',space:1}},spacing:{after:60}})),
    ...WORK_STATUS_LINES.map(([value,label])=>para([box(r.workStatus===value),run(label)],{spacing:{before:60}}))
  ];
  const bottom=new D.Table({width:{size:contentW,type:D.WidthType.DXA},columnWidths:[halfW,contentW-halfW],borders:tableBorders(none),
    rows:[new D.TableRow({children:[cell(halfW,left,{verticalAlign:D.VerticalAlign.TOP}),cell(contentW-halfW,right,{verticalAlign:D.VerticalAlign.TOP})]})]});

  const recommendation=String(r.recommendation||'').split(/\n+/).filter(Boolean);
  const recLines=[...recommendation,...Array.from({length:Math.max(0,3-recommendation.length)},()=>'')];
  const ruled=text=>para(run(text||' '),{border:{bottom:{style:D.BorderStyle.SINGLE,size:6,color:'111111',space:1}},spacing:{after:80}});

  const doc=new D.Document({creator:'CampusCare',title:`Dental Record ${r.name||''}`.trim(),styles:{default:{document:{run:{font,size}}}},
    sections:[{properties:{page:{size:{width:pageW,height:pageH,orientation:D.PageOrientation.PORTRAIT},margin:{top:margin,bottom:margin,left:margin,right:margin,header:360,footer:300}}},
      headers:{default:header},...(footer?{footers:{default:footer}}:{}),
      children:[
        para(run('DENTAL RECORD',{bold:true,size:24}),{alignment:center,spacing:{before:120,after:200}}),
        info,
        para(run(''),{spacing:{after:160}}),
        await chart(PERMANENT_TEETH),
        para(run(''),{spacing:{after:200}}),
        await chart(PRIMARY_TEETH),
        para(run(''),{spacing:{after:200}}),
        bottom,
        para(run('RECOMMENDATION',{bold:true}),{spacing:{before:240,after:80}}),
        ...recLines.map(ruled),
        para(run(r.dentistName||'',{bold:true}),{alignment:D.AlignmentType.RIGHT,spacing:{before:400}}),
        para(run(r.dentistTitle||'Dentist'),{alignment:D.AlignmentType.RIGHT})
      ]}]});
  return D.Packer.toBlob(doc);
}
