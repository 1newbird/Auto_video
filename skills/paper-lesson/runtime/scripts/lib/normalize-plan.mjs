// Deterministic compatibility fixes only. Never invent content or drop fields.
export function normalizePlan(input, source, metrics) {
  const plan=structuredClone(input),repairs=[];
  if(!Array.isArray(plan?.pages))return {plan,repairs};
  const issues=[];
  const order=new Map(source.segments.map((s,i)=>[s.id,i]));
  const fix=(path,kind,before,after)=>repairs.push({path,kind,before,after});
  // Only board display text changes. IDs, source text and spoken quotes stay exact.
  const boardFields=new Set(['title','subtitle','text','label','detail']);
  const symbols={'⓪':'0.','→':'->','←':'<-','↔':'<->','⇒':'=>','⇐':'<=','⇔':'<=>','•':'·','…':'...'};
  function fallback(c) {
    const cp=c.codePointAt(0);
    for(const [start,count] of [[0x2460,20],[0x2776,10],[0x2780,10],[0x278a,10]]) {
      if(cp>=start&&cp<start+count)return `${cp-start+1}.`;
    }
    return symbols[c];
  }
  function boardText(value,path) {
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach((v,i)=>boardText(v,`${path}[${i}]`));return;}
    for(const [key,text] of Object.entries(value)) {
      if(key==='gestures')continue;
      const here=`${path}.${key}`;
      if(boardFields.has(key)&&typeof text==='string'&&metrics) {
        const missing=new Set();
        const normalized=[...text].map(c=>{
          if(c==='\n'||metrics.widths[c.codePointAt(0)]!==undefined)return c;
          const replacement=fallback(c);
          if(replacement&&[...replacement].every(v=>metrics.widths[v.codePointAt(0)]!==undefined))return replacement;
          missing.add(c);return c;
        }).join('');
        if(normalized!==text){value[key]=normalized;fix(here,'font-symbol-fallback',text,normalized);}
        if(missing.size)issues.push({path:here,message:`Handwriting font has no glyph: ${[...missing].join(' ')}`});
      } else if(typeof text==='object')boardText(text,here);
    }
  }
  boardText(plan.pages,'pages');
  function elements(list,path,inherited,pageSegments) {
    if(!Array.isArray(list)||!list.length)throw new Error(`${path}: expected a nonempty elements array`);
    for(const [i,e] of list.entries()) {
      const here=`${path}[${i}]`;
      if(!e||typeof e!=='object'||Array.isArray(e))throw new Error(`${here}: expected an element object`);
      const segment=e.segment??inherited;
      if(e.kind==='section'&&e.elements!==undefined)elements(e.elements,`${here}.elements`,segment,pageSegments);
      if(e.kind==='parallel'&&Array.isArray(e.groups)) {
        for(let j=0;j<e.groups.length;j++) {
          const group=e.groups[j],gp=`${here}.groups[${j}]`;
          if(group&&typeof group==='object'&&!Array.isArray(group)&&Object.keys(group).length===1&&Array.isArray(group.elements)) {
            e.groups[j]=group.elements;
            fix(gp,'unwrap-elements','{elements: [...]}','[...]');
          }
          elements(e.groups[j],gp,segment,pageSegments);
        }
      }
      if(['flow','relation'].includes(e.kind)&&Array.isArray(e.nodes)&&Array.isArray(e.links)) {
        const nodes=new Map(e.nodes.filter(n=>n&&typeof n==='object').map(n=>[n.id,n]));
        for(const [j,link] of e.links.entries()) {
          if(!link?.segment)continue;
          const a=nodes.get(link.from),b=nodes.get(link.to);
          if(!a||!b)continue; // Compiler reports missing endpoints; do not guess them.
          const segments=[link.segment,a.segment??segment,b.segment??segment];
          if(!segments.every(s=>pageSegments.includes(s)&&order.has(s)))continue;
          const latest=segments.reduce((a,b)=>order.get(a)>order.get(b)?a:b);
          if(latest!==link.segment) {
            fix(`${here}.links[${j}].segment`,'wait-for-nodes',link.segment,latest);
            link.segment=latest;
          }
        }
      }
    }
  }
  for(const [i,page] of plan.pages.entries())if(plan.schemaVersion===3&&page?.layout==='mixed') {
    const here=`pages[${i}] (${page.id??'missing id'}).elements`;
    try {elements(page.elements,here,page.segments?.[0],page.segments??[]);}
    catch(error){issues.push({path:here,message:error.message});}
  }
  if(issues.length)throw Object.assign(new Error(issues.map(i=>`${i.path}: ${i.message}`).join('\n')),{issues,repairs});
  return {plan,repairs};
}
