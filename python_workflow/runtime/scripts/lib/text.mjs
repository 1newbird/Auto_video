import {createHash} from 'node:crypto';
export const hash = (text) => createHash('sha256').update(text).digest('hex');
export const units = (text) => [...text].reduce((n,c)=>n+(/\s/.test(c)?0.12:/[。！？；!?;]/.test(c)?2.3:/[，、,:：]/.test(c)?1.2:/[\x00-\x7f]/.test(c)?0.43:1),0);
export const visualUnits = (text) => [...text].reduce((n,c)=>n+(/[\x00-\x7f]/.test(c)?0.53:1),0);
export function normalizeScript(raw) {
  return raw.replace(/^\uFEFF/,'').replace(/[\u200b-\u200d\uFEFF]/g,'').split(/\r?\n/)
    .filter(line=>!/^\s*#{1,6}\s/.test(line))
    .map(line=>line.replace(/^\s*[-*+]\s+/,'').replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1').replace(/[\t ]+/g,' ').trim())
    .filter(Boolean).join('\n').trim();
}
export function segmentSource(text) {
  const result=[];let start=0;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(/[。！？；\n]/.test(c) || (/[，,]/.test(c)&&units(text.slice(start,i+1))>28) || i===text.length-1) {
      if(!text.slice(start,i+1).trim()&&result.length) {result.at(-1).end=i+1;result.at(-1).text+=text.slice(start,i+1);}
      else result.push({id:`s${String(result.length+1).padStart(3,'0')}`,start,end:i+1,text:text.slice(start,i+1)});
      start=i+1;
    }
  }
  return result;
}
export function captionChunks(text,max=24) {
  const result=[];let rest=text;
  while(rest.length) {
    let end=0,lastBreak=0;
    for(const c of rest) {
      if(visualUnits(rest.slice(0,end)+c)>max&&end>0)break;
      end+=c.length;
      if(/[，。！？；、：,!?;:\s]/.test(c)&&visualUnits(rest.slice(0,end))>=8)lastBreak=end;
    }
    if(end<rest.length&&lastBreak>0)end=lastBreak;
    if(!end)end=[...rest][0].length;
    while(end<rest.length&&/[，。！？；、：,!?;:）)\]」』\s]/.test(rest[end]))end++;
    const chunk=rest.slice(0,end);
    if(!chunk.trim()&&result.length)result[result.length-1]+=chunk;
    else result.push(chunk);
    rest=rest.slice(end);
  }
  return result;
}
export function captionLines(text) {
  const cleaned=text.replace(/\s+/g,' ').trim();
  if(visualUnits(cleaned)<=18)return [cleaned];
  let pivot=1,best=Infinity;
  for(let i=1;i<cleaned.length;i++) {
    if(/[，。！？；、：,!?;:）)\]」』]/.test(cleaned[i])||/[（(\[「『]/.test(cleaned[i-1]))continue;
    if(/[a-zA-Z]/.test(cleaned[i-1])&&/[a-zA-Z]/.test(cleaned[i]))continue;
    const a=visualUnits(cleaned.slice(0,i)),b=visualUnits(cleaned.slice(i));
    if(Math.max(a,b)<=18&&Math.abs(a-b)<best){best=Math.abs(a-b);pivot=i;}
  }
  if(best===Infinity)pivot=Math.floor(cleaned.length/2);
  return [cleaned.slice(0,pivot).trim(),cleaned.slice(pivot).trim()];
}
export function measure(text,size,metrics) {
  return [...text].reduce((n,c)=>{
    const w=metrics.widths[c.codePointAt(0)];
    if(w===undefined)throw new Error(`Handwriting font has no glyph: ${c}`);
    return n+w*size/metrics.unitsPerEm;
  },0);
}
export function wrap(text,width,size,metrics) {
  const lines=[];
  for(const paragraph of text.split('\n')) {
    let line='';
    const tokens=paragraph.match(/[A-Za-z0-9_./-]+|\s+|[^\s]/gu)??[];
    for(const token of tokens) {
      if(line&&measure(line+token,size,metrics)>width){lines.push(line.trimEnd());line='';}
      if(measure(token,size,metrics)>width) {
        for(const c of token) {if(line&&measure(line+c,size,metrics)>width){lines.push(line);line='';}line+=c;}
      } else line+=(line?token:token.trimStart());
    }
    if(line)lines.push(line.trimEnd());
  }
  return lines;
}
