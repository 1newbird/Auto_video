// Semantic, vertically stacked elements. Coordinates stay inside the compiler.
import {measure,wrap} from './text.mjs';
import pageLayout from '../../src/layout.json' with {type:'json'};
const must=(ok,message)=>{if(!ok)throw new Error(message);};
const fields={
  section:['title','rows','elements'],text:['rows'],note:['rows'],tree:['title','rows'],
  divider:[],flow:['nodes','direction','links'],relation:['nodes','links'],parallel:['groups','reason'],
};
export function layoutElements(elements,{x,y,width,segment,addText,addRow,shape,reveal,targets,metrics,ink,diagramScale=1},depth=0) {
  must(Array.isArray(elements)&&elements.length>0,'Mixed layout needs elements');
  must(width>0,'Mixed layout has no usable width; reduce indentation or split the page');
  const start=y;
  const spacing=diagramScale;
  for(const [index,e] of elements.entries()) {
    try {
    must(e&&fields[e.kind]&&typeof e.id==='string'&&e.id,'Unknown or missing element kind/id');
    for(const key of Object.keys(e))must(['id','kind','segment',...fields[e.kind]].includes(key),`Unknown ${e.kind} field: ${key}`);
    const s=e.segment??segment,at=reveal(s),top=y,existing=new Set(Object.keys(targets));
    must(!targets[e.id],`Duplicate target ${e.id}`);
    if(e.kind==='section'&&e.elements!==undefined) {
      must(typeof e.title==='string'&&e.title.trim()&&e.rows===undefined,`Section ${e.id} needs title and elements, without rows`);
      y+=addText(e.id,e.title,x,y,Math.round((depth?45:52)*spacing),width,s)+12*spacing;
      const firstItem=Object.keys(targets);
      y+=layoutElements(e.elements,{x:x+44*spacing,y,width:width-44*spacing,segment:s,addText,addRow,shape,reveal,targets,metrics,ink,diagramScale},depth+1);
      for(const id of Object.keys(targets).filter(id=>!firstItem.includes(id)))must(targets[id].visibleFrom>=at,`Section child precedes heading: ${id}`);
    } else if(['section','text','note','tree'].includes(e.kind)) {
      if(e.title)y+=addText(e.id,e.title,x,y,Math.round(45*spacing),width,s)+12*spacing;
      must(Array.isArray(e.rows)&&e.rows.length>0,`${e.id} needs rows`);
      const inset=(e.kind==='note'?24:12)*spacing;
      for(const row of e.rows)y+=addRow(row,x+inset,y,width-inset,s,0,at)+8*spacing;
      if(e.kind==='note')shape(`${e.id}:rule`,`M ${x+3} ${top+6} L ${x+3} ${y-8}`,at,3,'#ab3d34');
    } else if(e.kind==='divider') {
      shape(e.id,`M ${x} ${y+5} L ${x+width} ${y+5}`,at,1.5,'#999');y+=18*spacing;
    } else if(e.kind==='parallel') {
      must(typeof e.reason==='string'&&e.reason.trim(),'Parallel groups need a semantic reason');
      must(Array.isArray(e.groups)&&e.groups.length===2,'Parallel requires two local groups');
      const gap=44*spacing,w=(width-gap)/2;
      y+=Math.max(...e.groups.map((group,i)=>layoutElements(group,{x:x+i*(w+gap),y,width:w,segment:s,addText,addRow,shape,reveal,targets,metrics,ink,diagramScale},depth+1)));
    } else {
      const nodes=e.nodes;
      must(Array.isArray(nodes)&&nodes.length>=2,`${e.id} needs at least 2 nodes`);
      const vertical=e.kind==='flow'&&e.direction==='vertical';
      must(e.direction===undefined||['vertical','horizontal'].includes(e.direction),'Invalid flow direction');
      for(const n of nodes) {
        must(typeof n.id==='string'&&n.id, 'Diagram node needs an id');
        for(const key of Object.keys(n))must(['id','title','detail','segment','red'].includes(key),`Unknown diagram node field: ${key}`);
        must(n.red===undefined||typeof n.red==='boolean',`Node ${n.id} red must be boolean`);
        must(typeof n.title==='string'&&n.title.trim(),`Missing node title ${n.id}`);
        must(n.detail===undefined||typeof n.detail==='string',`Node ${n.id} detail must be text`);
      }
      // Measure before drawing. Fit the actual text and boxes rather than cap node count.
      // 0.55 keeps detail text at >=18 px on the 1080-wide board.
      let fit;
      for(let step=Math.round(diagramScale*100);step>=55;step-=5) {
        const scale=step/100,gap=(e.kind==='relation'?160:60)*scale;
        const w=vertical?width:(width-gap*(nodes.length-1))/nodes.length;
        const padding=32*scale,titleSize=Math.round(38*scale),detailSize=Math.round(32*scale);
        if(w<=padding)continue;
        let fitsWidth=true;
        const heights=nodes.map(n=>{
          const titleLines=wrap(n.title,w-padding,titleSize,metrics);
          const detailLines=n.detail?wrap(n.detail,w-padding,detailSize,metrics):[];
          fitsWidth&&=titleLines.every(t=>measure(t,titleSize,metrics)<=w-padding+.01)
            &&detailLines.every(t=>measure(t,detailSize,metrics)<=w-padding+.01);
          return 40*scale+titleLines.length*Math.round(titleSize*1.36)
            +(detailLines.length?12*scale+detailLines.length*Math.round(detailSize*1.36):0);
        });
        const h=Math.max(...heights),verticalGap=62*scale;
        const total=vertical?nodes.length*h+(nodes.length-1)*verticalGap:h;
        if(fitsWidth&&y+total<=pageLayout.boardBottom) {fit={scale,gap,w,h,padding,titleSize,detailSize,verticalGap,total};break;}
      }
      must(fit,`Diagram ${e.id} does not fit available space even at 18px detail text; split the page`);
      const {scale,gap,w,h,padding,titleSize,detailSize,verticalGap,total}=fit,boxes=new Map();
      for(const [i,n] of nodes.entries()) {
        const nx=vertical?x:x+i*(w+gap),ny=vertical?y+i*(h+verticalGap):y,ns=n.segment??s,na=reveal(ns);
        must(na>=at,`Diagram node precedes its group: ${n.id}`);
        shape(`${n.id}:box`,`M ${nx} ${ny} L ${nx+w} ${ny} L ${nx+w} ${ny+h} L ${nx} ${ny+h} Z`,na,1.8);
        let used=addText(n.id,n.title,nx+w/2,ny+18*scale,titleSize,w-padding,ns,!!n.red,'middle');
        if(n.detail)used+=addText(`${n.id}:detail`,n.detail,nx+w/2,ny+18*scale+used+12*scale,detailSize,w-padding,ns,false,'middle');
        boxes.set(n.id,{x:nx,y:ny,w,h,at:na});
      }
      const links=e.kind==='flow'?(e.links??nodes.slice(1).map((n,i)=>({from:nodes[i].id,to:n.id}))):e.links;
      must(Array.isArray(links)&&links.length>0,'Relation needs explicit links');
      for(const [i,l] of links.entries()) {
        for(const key of Object.keys(l))must(['from','to','label','segment'].includes(key),`Unknown link field: ${key}`);
        const a=boxes.get(l.from),b=boxes.get(l.to);
        must(a&&b&&a!==b,`Invalid relation ${l.from} -> ${l.to}`);
        must(Math.abs(nodes.findIndex(n=>n.id===l.from)-nodes.findIndex(n=>n.id===l.to))===1,'Connect adjacent diagram nodes to avoid crossing unrelated objects');
        const la=l.segment?reveal(l.segment):Math.max(a.at,b.at);
        must(la>=a.at&&la>=b.at,'Relation cannot precede its nodes');
        let p,q;
        if(vertical&&a.y<b.y){p=[a.x+a.w/2,a.y+a.h+8*scale];q=[b.x+b.w/2,b.y-10*scale];}
        else if(vertical){p=[a.x+a.w/2,a.y-8*scale];q=[b.x+b.w/2,b.y+b.h+10*scale];}
        else if(a.x<b.x){p=[a.x+a.w+8*scale,a.y+a.h/2];q=[b.x-10*scale,b.y+b.h/2];}
        else {p=[a.x-8*scale,a.y+a.h/2];q=[b.x+b.w+10*scale,b.y+b.h/2];}
        const angle=Math.atan2(q[1]-p[1],q[0]-p[0]),dx=Math.cos(angle),dy=Math.sin(angle);
        shape(`${e.id}:edge:${i}`,`M ${p[0]} ${p[1]} L ${q[0]} ${q[1]} M ${q[0]-scale*(12*dx-7*dy)} ${q[1]-scale*(12*dy+7*dx)} L ${q[0]} ${q[1]} L ${q[0]-scale*(12*dx+7*dy)} ${q[1]-scale*(12*dy-7*dx)}`,la,2,ink);
        if(l.label) {
          const labelSize=Math.round(30*scale);
          must(!vertical&&measure(l.label,labelSize,metrics)<=gap-20*scale,'Relation label must fit between nodes');
          // Choose the later node segment when no explicit edge segment is supplied.
          const ls=l.segment??(a.at>=b.at?(nodes.find(n=>n.id===l.from).segment??s):(nodes.find(n=>n.id===l.to).segment??s));
          addText(`${e.id}:label:${i}`,l.label,(p[0]+q[0])/2,p[1]-52*scale,labelSize,gap-20*scale,ls,false,'middle');
        }
      }
      y+=total;
    }
    must(y<=pageLayout.boardBottom,`Page overflows at ${e.id}; shorten board text or split the page`);
    // Structural elements can also be pointed at; their children keep precise targets.
    if(!e.title) {
      must(!targets[e.id],`Duplicate target ${e.id}`);
      const last=Object.entries(targets).filter(([id])=>!existing.has(id)).map(([,t])=>t).reduce((a,b)=>b.visibleFrom>a.visibleFrom?b:a,{visibleFrom:at,segment:s});
      targets[e.id]={x,y:top,w:width,h:Math.max(10,y-top),visibleFrom:last.visibleFrom,red:false,segment:last.segment};
    }
    y+=18*spacing;
    } catch(error) {throw new Error(`elements[${index}] (${e?.id??'missing id'}): ${error.message}`,{cause:error});}
  }
  return y-start;
}
