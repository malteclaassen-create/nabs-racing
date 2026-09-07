import {useId, useState} from 'react';

// Both the original live marker and Kenney's model render point along +x.
export const FORMULA_CAR_HALF = 11;
const BODY = 'M11,0 L8.2,-1.1 L5.5,-1.4 L3.5,-3 L0.5,-3 L-1.5,-1.6 L-6.5,-1.6 L-6.5,1.6 L-1.5,1.6 L0.5,3 L3.5,3 L5.5,1.4 L8.2,1.1 Z';
const WHEELS = [[4.2,-4.4],[4.2,2.4],[-6.8,-4.7],[-6.8,2.7]];

export default function FormulaCar({color, detail = false}) {
  return detail ? <RenderedCar color={color}/> : <Silhouette color={color}/>;
}

function RenderedCar({color}) {
  const id = useId();
  const [failed, setFailed] = useState(false);
  if (failed) return <Silhouette color={color}/>;
  const rgb = [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
  return <g data-car-model="kenney-race">
    <defs><filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="100%" height="100%">
      <feColorMatrix type="matrix" values={`${rgb[0]} 0 0 0 0  0 ${rgb[1]} 0 0 0  0 0 ${rgb[2]} 0 0  0 0 0 1 0`}/>
    </filter></defs>
    <image href="/models/kenney-race/top-base.png" x={-11} y={-5.5} width={22} height={11} onError={()=>setFailed(true)}/>
    <image href="/models/kenney-race/top-paint.png" x={-11} y={-5.5} width={22} height={11} filter={`url(#${id})`} onError={()=>setFailed(true)}/>
  </g>;
}

function Silhouette({color}) {
  return <>
    {WHEELS.map(([x,y],i) => <rect key={i} x={x} y={y} width={2.6} height={2} rx={0.7} fill="#111827" />)}
    <path d="M7.6,-4.6 L9.4,-4.6 L9.4,4.6 L7.6,4.6 Z" fill="#1f2937" />
    <path d="M-9.6,-4.2 L-7.9,-4.2 L-7.9,4.2 L-9.6,4.2 Z" fill="#1f2937" />
    <path d={BODY} fill={color} stroke="rgba(15,23,42,0.85)" strokeWidth={0.5} />
  </>;
}
