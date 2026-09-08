import {useEffect, useId, useMemo, useRef, useState} from 'react';
import FormulaCar, {FORMULA_CAR_HALF} from './FormulaCar.jsx';
import {recordedPose} from '../utils/telemetryGeometry.js';

const METRES = [1,2,5,10,20,50,100,200,500,1000,2000];
const path = (x,y,from=0,to=x.length-1) => x.slice(from,to+1).map((v,i)=>`${v},${y[from+i]}`).join(' ');

// Time-gain colouring, in three strengths per side rather than one: a stretch
// where B loses 4 ms a slice should not look the same as one where it loses
// 1.3. Strength is drawn as line WIDTH, at full colour throughout — a first
// version faded the weaker levels instead, and on a real lap, where most of
// the gain is small, that washed the whole map out. Level 0 is "level" and
// stays neutral.
const HEAT_STEP = 1.2; // ms per slice
const HEAT_WIDTH = [2.4, 2.4, 3.1, 3.8];

export default function TelemetryTrackMap({lapA,lapB,n,cursor,cursorB,motionA,onPick,onReset,mode='gain',zoom=1,track,colorA,colorB,sections=[],activeSection=null,onSection,markers,focusRange=null,exportRef=null}) {
  const svgRef=useRef(null), drag=useRef(null);
  const setSvg=(el)=>{svgRef.current=el; if(exportRef) exportRef.current=el;};
  const [size,setSize]=useState({width:600,height:360});
  const [pan,setPan]=useState({x:0,y:0});
  const gridId=useId();
  useEffect(()=>{
    const element=svgRef.current;
    if(!element) return;
    const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));
    observer.observe(element);
    return ()=>observer.disconnect();
  },[]);
  useEffect(()=>setPan({x:0,y:0}),[cursor,motionA,zoom,mode]);

  const geo=useMemo(()=>{
    if(!lapA?.x || !lapA?.z) return null;
    let W,H,projX,projY,mPerUnit;
    const calib=track?.calib;
    if(calib?.scaleFactor>0) {
      W=calib.width; H=calib.height; mPerUnit=calib.scaleFactor;
      projX=v=>(v/10+calib.xOffset)/calib.scaleFactor+(calib.padding||0);
      projY=v=>(v/10+calib.zOffset)/calib.scaleFactor+(calib.padding||0);
    } else {
      const xs=lapA.x.map(v=>v/10), ys=lapA.z.map(v=>v/10);
      const minX=Math.min(...xs), minY=Math.min(...ys);
      const spanX=Math.max(1,Math.max(...xs)-minX), spanY=Math.max(1,Math.max(...ys)-minY);
      // The margin has to hold the section numbers, which sit ~26 screen
      // pixels outside the line. A margin that is a share of the track's size
      // is fine on a desktop and nothing on a phone, where a tall circuit's
      // top and bottom numbers were cut off — so it is measured in pixels of
      // the box the map is drawn in.
      const perPixel=Math.max(spanX/Math.max(1,size.width),spanY/Math.max(1,size.height));
      const pad=Math.max(Math.max(spanX,spanY)*0.04,30*perPixel);
      W=spanX+2*pad; H=spanY+2*pad; mPerUnit=1;
      projX=v=>v/10-minX+pad; projY=v=>v/10-minY+pad;
    }
    const a={x:lapA.x.slice(0,n).map(projX),y:lapA.z.slice(0,n).map(projY)};
    const b=lapB?.x && lapB?.z ? {x:lapB.x.slice(0,n).map(projX),y:lapB.z.slice(0,n).map(projY)} : null;
    const centroid={x:a.x.reduce((s,v)=>s+v,0)/n, y:a.y.reduce((s,v)=>s+v,0)/n};
    return {W,H,mPerUnit,a,b,centroid,pathA:path(a.x,a.y),pathB:b?path(b.x,b.y):null,image:calib?.scaleFactor?track.href:null};
  },[lapA,lapB,n,track,size]);

  const segments=useMemo(()=>{
    if(!geo) return [];
    if(!lapB) return [{points:geo.pathA,color:colorA,width:2.6}];
    const pace=Array.from({length:n-1},(_,i)=>(lapB.t[i+1]-lapB.t[i])-(lapA.t[i+1]-lapA.t[i]));
    const levels=pace.map((_,i)=>{
      const samples=pace.slice(Math.max(0,i-5),Math.min(pace.length,i+6));
      const value=samples.reduce((a,b)=>a+b,0)/samples.length;
      const strength=Math.min(3,Math.floor(Math.abs(value)/HEAT_STEP));
      return strength===0?0:value>0?strength:-strength;
    });
    const output=[];
    for(let start=0;start<n-1;) {
      let end=start+1;
      while(end<n-1 && levels[end]===levels[start]) end++;
      const level=levels[start];
      output.push({points:path(geo.a.x,geo.a.y,start,end),color:level>0?colorA:level<0?colorB:'var(--c-faint)',width:HEAT_WIDTH[Math.abs(level)]});
      start=end;
    }
    return output;
  },[geo,lapA,lapB,n,colorA,colorB]);
  if(!geo) return null;

  const unitsPerPixel=Math.max(geo.W/Math.max(1,size.width),geo.H/Math.max(1,size.height));
  const localPixel=unitsPerPixel/zoom;
  const a=recordedPose(geo.a.x,geo.a.y,motionA??cursor);
  const b=geo.b?recordedPose(geo.b.x,geo.b.y,cursorB??cursor):null;
  const lines=mode==='lines';
  const center=b && lines && cursorB==null ? {x:(a.x+b.x)/2,y:(a.y+b.y)/2}:a;
  const cx=zoom>1?center.x+pan.x:geo.W/2, cy=zoom>1?center.y+pan.y:geo.H/2;
  const transform=`translate(${geo.W/2-zoom*cx} ${geo.H/2-zoom*cy}) scale(${zoom})`;
  const barM=METRES.find(m=>m/geo.mPerUnit/localPixel>=65)||2000;
  const barPixels=barM/geo.mPerUnit/localPixel;
  const gridM=METRES.find(m=>m/geo.mPerUnit/localPixel>=42)||2000;
  const gridUnits=gridM/geo.mPerUnit;
  const carPixels=Math.max(28,Math.min(68,5.2/geo.mPerUnit/localPixel));
  const carScale=carPixels*localPixel/(FORMULA_CAR_HALF*2);
  const pick=(event)=>{
    const svg=svgRef.current, matrix=svg?.getScreenCTM();
    if(!matrix) return;
    const point=svg.createSVGPoint(); point.x=event.clientX; point.y=event.clientY;
    const local=point.matrixTransform(matrix.inverse());
    const x=(local.x-geo.W/2)/zoom+cx, y=(local.y-geo.H/2)/zoom+cy;
    let best=0,distance=Infinity;
    for(let i=0;i<n;i++) {
      const d=(geo.a.x[i]-x)**2+(geo.a.y[i]-y)**2;
      if(d<distance) {best=i;distance=d;}
    }
    onPick(best);
  };
  const car=(pose,side,color)=> pose && <g key={side} transform={`translate(${pose.x} ${pose.y})`} aria-label={`Lap ${side} car`}>
    <g transform={`rotate(${pose.heading}) scale(${carScale})`} opacity={side==='B'?0.78:1}>
      <FormulaCar color={color} detail />
    </g>
    <text x={(side==='A'?-1:1)*(carPixels/2+12)*localPixel} y={0} textAnchor="middle" dominantBaseline="central" fill={color} stroke="var(--c-card)" strokeWidth={3*localPixel} paintOrder="stroke" fontSize={12*localPixel} fontWeight="800">{side}</text>
  </g>;

  // Brake points (filled) and back-on-full-throttle points (hollow), one of
  // each per slow section, on each lap's own line. Sized in screen pixels so
  // they stay legible at every zoom.
  const marker=(pts,i,color,kind,key,small)=>{
    if(!pts || i==null) return null;
    const r=(kind==='brake'?4.4:3.8)*(small?0.85:1)*localPixel;
    return kind==='brake'
      ? <circle key={key} cx={pts.x[i]} cy={pts.y[i]} r={r} fill={color} stroke="var(--c-card)" strokeWidth={1.4*localPixel} />
      : <circle key={key} cx={pts.x[i]} cy={pts.y[i]} r={r} fill="var(--c-card)" stroke={color} strokeWidth={1.7*localPixel} />;
  };
  const markerLayer=markers && <g aria-hidden="true">
    {markers.b && geo.b && markers.b.brake.map((i,k)=>marker(geo.b,i,colorB,'brake',`bb${k}`,true))}
    {markers.b && geo.b && markers.b.gas.map((i,k)=>marker(geo.b,i,colorB,'gas',`bg${k}`,true))}
    {markers.a && markers.a.brake.map((i,k)=>marker(geo.a,i,colorA,'brake',`ab${k}`))}
    {markers.a && markers.a.gas.map((i,k)=>marker(geo.a,i,colorA,'gas',`ag${k}`))}
  </g>;

  // Section numbers sit just outside the line at each apex, pushed away from
  // the track's middle so they never sit on the tarmac. Click one to jump.
  const sectionLabel=(s)=>{
    const x=geo.a.x[s.apex], y=geo.a.y[s.apex];
    const dx=x-geo.centroid.x, dy=y-geo.centroid.y, d=Math.hypot(dx,dy)||1;
    const off=16*localPixel, r=8*localPixel;
    const active=s.n===activeSection;
    return <g key={s.n} transform={`translate(${x+dx/d*off} ${y+dy/d*off})`} style={{cursor:'pointer'}} role="button" aria-label={`Slow section ${s.n}`}
      onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();onSection?.(s);}}>
      <circle r={r} fill={active?'rgb(var(--c-brand))':'var(--c-card)'} stroke={active?'rgb(var(--c-brand))':'var(--c-text3)'} strokeWidth={1.2*localPixel} />
      <text textAnchor="middle" dominantBaseline="central" fontSize={9.5*localPixel} fontWeight="800" fill={active?'#0F172A':'var(--c-text)'} fontFamily="JetBrains Mono, ui-monospace, monospace">{s.n}</text>
    </g>;
  };
  const gate=recordedPose(geo.a.x,geo.a.y,0);

  return <div className="relative h-full w-full overflow-hidden bg-surface2/40">
    <svg ref={setSvg} viewBox={`0 0 ${geo.W} ${geo.H}`} className="h-full w-full touch-pan-y select-none" style={{cursor:zoom>1?'grab':'crosshair'}} aria-label={lines?'Track map, both racing lines':'Track map, time gain'}
      onPointerDown={e=>{if(!e.isPrimary||e.button!==0)return;if(motionA!=null)onPick(Math.round(motionA));drag.current={x:e.clientX,y:e.clientY,pan,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}}
      onPointerMove={e=>{const d=drag.current;if(!d||zoom===1)return;if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>4)d.moved=true;if(d.moved)setPan({x:d.pan.x-(e.clientX-d.x)*localPixel,y:d.pan.y-(e.clientY-d.y)*localPixel});}}
      onPointerUp={e=>{const d=drag.current;drag.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);if(d&&!d.moved)pick(e);}}
      onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
      onDoubleClick={()=>{setPan({x:0,y:0});onReset();}}>
      <defs><pattern id={gridId} width={gridUnits} height={gridUnits} patternUnits="userSpaceOnUse"><path d={`M${gridUnits},0H0V${gridUnits}`} fill="none" stroke="var(--c-border)" strokeWidth={localPixel} opacity={0.4}/></pattern></defs>
      <g transform={transform}>
        {zoom>1&&<rect x={0} y={0} width={geo.W} height={geo.H} fill={`url(#${gridId})`} />}
        {geo.image&&<image href={geo.image} width={geo.W} height={geo.H} opacity={lines?0.7:0.4} preserveAspectRatio="none" />}
        <polyline points={geo.pathA} fill="none" stroke="var(--c-card)" strokeWidth={8} strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity={0.85}/>
        {lines?<>
          <polyline points={geo.pathA} fill="none" stroke={colorA} strokeWidth={2.3} strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
          {geo.pathB&&<polyline points={geo.pathB} fill="none" stroke={colorB} strokeWidth={2.3} strokeDasharray="7 4" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>}
        </>:segments.map((s,i)=><polyline key={i} points={s.points} fill="none" stroke={s.color} strokeWidth={s.width} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>)}
        <g transform={`translate(${gate.x} ${gate.y}) rotate(${gate.heading})`} aria-label="Start and finish line">
          <line x1={0} x2={0} y1={-8*localPixel} y2={8*localPixel} stroke="var(--c-card)" strokeWidth={4*localPixel} strokeLinecap="round"/>
          <line x1={0} x2={0} y1={-8*localPixel} y2={8*localPixel} stroke="var(--c-text)" strokeWidth={2*localPixel} strokeLinecap="round" strokeDasharray={`${3*localPixel} ${2*localPixel}`}/>
        </g>
        {markerLayer}
        {/* The graphs are zoomed to a stretch: fade the rest of the lap so the
            map shows the same stretch they do. */}
        {focusRange && focusRange[0]>0 && <polyline points={path(geo.a.x,geo.a.y,0,focusRange[0])} fill="none" stroke="var(--c-card)" strokeOpacity={0.7} strokeWidth={9} strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>}
        {focusRange && focusRange[1]<n-1 && <polyline points={path(geo.a.x,geo.a.y,focusRange[1],n-1)} fill="none" stroke="var(--c-card)" strokeOpacity={0.7} strokeWidth={9} strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>}
        {sections.map(sectionLabel)}
        {car(b,'B',colorB)}
        {car(a,'A',colorA)}
      </g>
    </svg>
    <div className="pointer-events-none absolute bottom-3 left-3 rounded bg-card/85 px-2 py-1 font-mono text-[10px] tabular-nums text-light">
      <span>{barM} m</span><div className="mt-1 border-x border-b border-light" style={{width:barPixels,height:3}}/>
    </div>
    <span className="pointer-events-none absolute right-3 top-3 rounded bg-card/85 px-2 py-1 font-mono text-[10px] text-light">{zoom.toFixed(0)}×</span>
  </div>;
}
