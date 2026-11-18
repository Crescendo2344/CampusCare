// The CTU letterhead and footer for Word (.docx) files built with the docx library, matching the
// letterhead printed on every CampusCare document (see ctu-letterhead.js).
import {CTU_LOGO_SRC,BAGONG_PILIPINAS_SRC,CTU_FOOTER_SRC,LETTERHEAD_LINES,currentLetterheadClinic,letterheadContact,letterheadUnit} from './ctu-letterhead.js';

export const assetBytes=async path=>{try{const response=await fetch(path);return response.ok?new Uint8Array(await response.arrayBuffer()):null;}catch{return null;}};
const noLine={style:'none',size:0,color:'FFFFFF'};

/**
 * @param D the docx library
 * @param {{contentW:number,clinic?:string,unit?:boolean,font?:string}} options contentW in twips
 * @returns {Promise<{header:any,footer:any|undefined}>} a page Header and Footer
 */
export async function docxLetterhead(D,{contentW,clinic,unit=true,font='Arial'}){
  const which=clinic===undefined?currentLetterheadClinic():clinic;
  const {email,phone}=letterheadContact(which);
  const [seal,bagong,foot]=await Promise.all([CTU_LOGO_SRC,BAGONG_PILIPINAS_SRC,CTU_FOOTER_SRC].map(assetBytes));
  const none={top:{...noLine,style:D.BorderStyle.NONE},bottom:{...noLine,style:D.BorderStyle.NONE},left:{...noLine,style:D.BorderStyle.NONE},right:{...noLine,style:D.BorderStyle.NONE}};
  const center=D.AlignmentType.CENTER;
  const para=(children,o={})=>new D.Paragraph({children:Array.isArray(children)?children:[children],spacing:{before:0,after:0},...o});
  const line=(text,size,bold=false)=>para(new D.TextRun({text,font,size,bold}),{alignment:center});
  const side=1500;
  const cell=(width,children)=>new D.TableCell({borders:none,width:{size:width,type:D.WidthType.DXA},verticalAlign:D.VerticalAlign.CENTER,children});
  const table=new D.Table({width:{size:contentW,type:D.WidthType.DXA},columnWidths:[side,contentW-2*side,side],
    borders:{...none,insideHorizontal:none.top,insideVertical:none.top},
    rows:[new D.TableRow({children:[
      cell(side,[seal?para(new D.ImageRun({data:seal,transformation:{width:70,height:70}}),{alignment:D.AlignmentType.RIGHT}):para([])]),
      cell(contentW-2*side,[line(LETTERHEAD_LINES[0],19),line(LETTERHEAD_LINES[1],23,true),line(LETTERHEAD_LINES[2],19,true),
        line(LETTERHEAD_LINES[3],17),line(email,17),line(`Phone: ${phone}`,17)]),
      cell(side,[bagong?para(new D.ImageRun({data:bagong,transformation:{width:68,height:64}})):para([])])
    ]})]});
  const header=new D.Header({children:[table,...(unit?[para(new D.TextRun({text:letterheadUnit(which),font,size:22,bold:true}),{alignment:center,spacing:{before:60,after:0}})]:[])]});
  const footW=Math.round(contentW/15); // pixels at 96 dpi
  const footer=foot?new D.Footer({children:[para(new D.ImageRun({data:foot,transformation:{width:footW,height:Math.round(footW*91/1332)}}),{alignment:center})]}):undefined;
  return {header,footer};
}
