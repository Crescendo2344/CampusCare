// Health Education articles: reading time and light formatting of plain-text content.
// Staff write plain text; blank lines separate paragraphs, "- " lines become a list,
// "1. " lines a numbered list, and a short line that ends with ":" a subheading.

export function readingMinutes(text){
  const words=String(text||'').trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1,Math.round(words/200));
}

export function articleBlocks(text){
  const blocks=[];
  for(const chunk of String(text||'').replace(/\r\n/g,'\n').split(/\n\s*\n/)){
    const lines=chunk.split('\n').map(line=>line.trim()).filter(Boolean);
    if(!lines.length)continue;
    if(lines.every(line=>/^[-•*]\s+/.test(line)))blocks.push({type:'ul',items:lines.map(line=>line.replace(/^[-•*]\s+/,''))});
    else if(lines.every(line=>/^\d+[.)]\s+/.test(line)))blocks.push({type:'ol',items:lines.map(line=>line.replace(/^\d+[.)]\s+/,''))});
    else if(lines.length===1&&lines[0].length<=80&&lines[0].endsWith(':'))blocks.push({type:'h',text:lines[0].slice(0,-1)});
    else blocks.push({type:'p',lines});
  }
  return blocks;
}

export function articleBodyHtml(text,escape){
  return articleBlocks(text).map(block=>{
    if(block.type==='ul')return `<ul>${block.items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`;
    if(block.type==='ol')return `<ol>${block.items.map(item=>`<li>${escape(item)}</li>`).join('')}</ol>`;
    if(block.type==='h')return `<h3>${escape(block.text)}</h3>`;
    return `<p>${block.lines.map(escape).join('<br>')}</p>`;
  }).join('');
}

// Up to three other published articles, same category first, newest first.
export function relatedArticles(article,all,limit=3){
  const others=all.filter(a=>a.id!==article.id&&a.published);
  const newest=(a,b)=>String(b.publishedAt||b.createdAt).localeCompare(String(a.publishedAt||a.createdAt));
  return [...others.filter(a=>a.category===article.category).sort(newest),...others.filter(a=>a.category!==article.category).sort(newest)].slice(0,limit);
}
