import {measure} from './text.mjs';
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
export function validateRow(row) {
  assert(row&&typeof row.id==='string'&&row.id.length>0,'Rich row needs an id');
  assert(['definition','text','bullet'].includes(row.kind),`Unknown row kind: ${row.kind}`);
  const allowed=['id','kind','label','runs','segment','children'];
  assert(Object.keys(row).every(k=>allowed.includes(k)),`Unknown row field in ${row.id}; use semantic rows, not coordinates`);
  if(row.kind==='definition')assert(typeof row.label==='string'&&row.label.trim(),`Definition ${row.id} needs a label`);
  else assert(row.label===undefined,`Only definitions accept label: ${row.id}`);
  assert(Array.isArray(row.runs)&&row.runs.length>0,`Row ${row.id} needs runs`);
  const ids=new Set();
  for(const r of row.runs) {
    assert(typeof r.text==='string'&&r.text.length>0,`Empty run in ${row.id}`);
    assert(Object.keys(r).every(k=>['id','text','red','segment'].includes(k)),`Unknown run field in ${row.id}`);
    assert(r.red===undefined||typeof r.red==='boolean',`red must be boolean in ${row.id}`);
    if(r.id!==undefined){assert(typeof r.id==='string'&&r.id&&!ids.has(r.id),`Invalid/duplicate run id ${r.id}`);ids.add(r.id);}
  }
  assert(row.children===undefined||Array.isArray(row.children),`children must be an array: ${row.id}`);
}

// Wrap the entire logical line before applying styles. Style/target boundaries
// must not influence word wrapping or add whitespace between adjacent runs.
export function layoutRuns(parts,{x,y,width,size,metrics,hanging=0}) {
  const lineHeight=Math.round(size*1.22),cells=[],ranges=[];let text='',offset=0;
  for(const [partIndex,part] of parts.entries()) {text+=part.text;ranges.push({from:offset,to:offset+part.text.length,partIndex});offset+=part.text.length;}
  assert(text.trim(),'A rich row cannot be whitespace only');
  // Keep short clauses together (e.g. an attribute plus its value), regardless
  // of how the model split color/target runs. Long clauses still wrap normally.
  const tokens=text.match(/[^\n，。！？；：、,;:→]+[，。！？；：、,;:→]?|\n|[，。！？；：、,;:→]/gu)??[];
  let line=0,cursor=0,sourceIndex=0,rangeIndex=0;const hardStarts=new Set();
  const origin=()=>line?Math.min(hanging,width*.4):0;
  const nextLine=()=>{line++;cursor=origin();};
  for(const token of tokens) {
    if(token==='\n'){sourceIndex++;nextLine();hardStarts.add(line);continue;}
    const tokenWidth=measure(token,size,metrics);
    if(tokenWidth<=width-origin()&&cursor>origin()&&cursor+tokenWidth>width)nextLine();
    for(const char of token) {
      while(rangeIndex<ranges.length-1&&sourceIndex>=ranges[rangeIndex].to)rangeIndex++;
      const w=measure(char,size,metrics);
      if(cursor>origin()&&cursor+w>width)nextLine();
      assert(w<=width-origin(),`Glyph cannot fit rich row: ${char}`);
      cells.push({char,x:x+cursor,y:y+size+line*lineHeight,w,line,partIndex:ranges[rangeIndex].partIndex});
      cursor+=w;sourceIndex+=char.length;
    }
  }
  // Keep a single trailing Han glyph with its preceding glyph. This is based on
  // the logical text, so color and target boundaries still cannot alter wrapping.
  const tail=cells.filter(c=>c.line===line&&!/^\s$/.test(c.char));
  const previousLine=cells.filter(c=>c.line===line-1),last=previousLine.at(-1);
  if(line>0&&!hardStarts.has(line)&&tail.length===1&&/^\p{Script=Han}$/u.test(tail[0].char)&&previousLine.length>1&&/^\p{Script=Han}$/u.test(last.char)&&last.w+tail[0].w<=width-origin()) {
    last.line=line;last.y=tail[0].y;last.x=x+origin();tail[0].x=last.x+last.w;
  }
  const fragments=[];
  for(const cell of cells) {
    const previous=fragments.at(-1);
    if(previous&&previous.line===cell.line&&previous.partIndex===cell.partIndex) {previous.text+=cell.char;previous.w+=cell.w;}
    else fragments.push({...cell,text:cell.char});
  }
  const rectangles=(selected)=>{
    const result=[];
    for(const cell of selected.filter(c=>!/^\s$/.test(c.char))) {
      const last=result.at(-1);
      if(last&&last.line===cell.line){last.w=cell.x+cell.w-last.x;}
      else result.push({x:cell.x,y:cell.y-size*.82,w:cell.w,h:size*.85,line:cell.line});
    }
    return result.map(({line,...r})=>r);
  };
  return {fragments,height:(line+1)*lineHeight,rects:rectangles(cells),partRects:parts.map((_,i)=>rectangles(cells.filter(c=>c.partIndex===i)))};
}

export function unionRects(rects) {
  assert(rects.length>0,'Target must contain visible text');
  const x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y));
  return {x,y,w:Math.max(...rects.map(r=>r.x+r.w))-x,h:Math.max(...rects.map(r=>r.y+r.h))-y,rects};
}

export function combinePaths(paths) {
  const points=[],strokes=[];let distance=0;
  const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  for(const path of paths) {
    if(points.length)distance+=dist(points.at(-1),path[0]);
    const from=distance;points.push(path[0]);
    for(let i=1;i<path.length;i++){distance+=dist(path[i-1],path[i]);points.push(path[i]);}
    strokes.push({points:path,from,to:distance});
  }
  return {points,strokes:strokes.map(s=>({...s,from:distance?s.from/distance:0,to:distance?s.to/distance:1}))};
}
