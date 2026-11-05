// Split only at existing semantic block boundaries with disjoint narration.
// Never cut a diagram, rewrite text, reorder segments, or move a gesture away
// from its target. A block that cannot fit alone remains a clear error.
export function splitForCapacity(page, usedPageIds) {
  if(page.layout!=='mixed'||page.segments.length<2)return null;
  const indices=new Map(page.segments.map((id,i)=>[id,i]));
  function cuts(elements) {
    const result=[];
    for(let i=1;i<elements.length;i++)result.push([elements.slice(0,i),elements.slice(i)]);
    for(let i=0;i<elements.length;i++) {
      const e=elements[i];
      if(e.kind==='section'&&e.elements)for(const [left,right] of cuts(e.elements))
        result.push([[...elements.slice(0,i),{...e,elements:left}],[{...e,elements:right},...elements.slice(i+1)]]);
    }
    return result;
  }
  function refs(value, inherited=page.segments[0], result=[]) {
    if(!value||typeof value!=='object')return result;
    const segment=value.segment??inherited;
    // Section headings repeat on a continuation; child blocks keep their times.
    if((value.id||value.segment)&&!(value.kind==='section'&&value.elements))result.push(indices.get(segment));
    for(const [key,item] of Object.entries(value))if(key!=='segment')refs(item,segment,result);
    return result;
  }
  function ids(value,result=new Set()) {
    if(!value||typeof value!=='object')return result;
    if(value.id)result.add(value.id);
    Object.values(value).forEach(v=>ids(v,result));return result;
  }
  function moveHeadings(elements, first) {
    return elements.map(e=>e.kind==='section'&&e.elements?
      {...e,segment:indices.get(e.segment??page.segments[0])<indices.get(first)?first:e.segment,
        elements:moveHeadings(e.elements,first)}:e);
  }
  const candidates=[];
  for(const [left,right] of cuts(page.elements)) {
    const a=refs(left),b=refs(right);
    if(!a.length||!b.length||[...a,...b].some(n=>!Number.isInteger(n)))continue;
    const cut=Math.min(...b);
    if(cut<=Math.max(...a)||cut<1)continue;
    const leftIds=ids(left),rightIds=ids(right);
    if((page.gestures??[]).some(g=>{
      const set=indices.get(g.segment)<cut?leftIds:rightIds;
      return !set.has(g.target)||(g.to&&!set.has(g.to));
    }))continue;
    candidates.push({left,right,cut,score:Math.abs(cut-page.segments.length/2)});
  }
  candidates.sort((a,b)=>a.score-b.score);
  if(!candidates.length)return null;
  const {left,right,cut}=candidates[0];
  let suffix=2;while(usedPageIds.has(`${page.id}-part${suffix}`))suffix++;
  return [
    {...page,elements:left,segments:page.segments.slice(0,cut),gestures:(page.gestures??[]).filter(g=>indices.get(g.segment)<cut)},
    {...page,id:`${page.id}-part${suffix}`,elements:moveHeadings(right,page.segments[cut]),segments:page.segments.slice(cut),gestures:(page.gestures??[]).filter(g=>indices.get(g.segment)>=cut)},
  ];
}
