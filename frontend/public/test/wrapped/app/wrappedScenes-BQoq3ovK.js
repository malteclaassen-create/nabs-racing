import{c as Du}from"./index.js";/**
 * @license
 * Copyright 2010-2025 Three.js Authors
 * SPDX-License-Identifier: MIT
 */const ya="180",Iu=0,ac=1,Lu=2,Dl=1,Uu=2,Sn=3,bn=0,It=1,un=2,kn=0,ii=1,Bi=2,cc=3,lc=4,Nu=5,ti=100,Fu=101,Ou=102,Bu=103,zu=104,ku=200,Hu=201,Gu=202,Vu=203,Co=204,Po=205,Wu=206,Xu=207,ju=208,Qu=209,Ku=210,Yu=211,qu=212,Ju=213,Zu=214,Ro=0,Do=1,Io=2,zi=3,Lo=4,Uo=5,No=6,Fo=7,Sa=0,$u=1,eh=2,Hn=0,th=1,nh=2,ih=3,sh=4,rh=5,oh=6,ah=7,uc="attached",ch="detached",Il=300,ki=301,Hi=302,Oo=303,Bo=304,Cr=306,ri=1e3,zn=1001,yr=1002,Lt=1003,Ll=1004,ps=1005,Nt=1006,mr=1007,Tn=1008,dn=1009,Ul=1010,Nl=1011,Ts=1012,Ta=1013,oi=1014,en=1015,Us=1016,Ea=1017,wa=1018,Es=1020,Fl=35902,Ol=35899,Bl=1021,zl=1022,Kt=1023,ws=1026,bs=1027,ba=1028,Ca=1029,kl=1030,Pa=1031,Ra=1033,gr=33776,vr=33777,_r=33778,xr=33779,zo=35840,ko=35841,Ho=35842,Go=35843,Vo=36196,Wo=37492,Xo=37496,jo=37808,Qo=37809,Ko=37810,Yo=37811,qo=37812,Jo=37813,Zo=37814,$o=37815,ea=37816,ta=37817,na=37818,ia=37819,sa=37820,ra=37821,oa=36492,aa=36494,ca=36495,la=36283,ua=36284,ha=36285,da=36286,Cs=2300,Ps=2301,Fr=2302,hc=2400,dc=2401,fc=2402,lh=2500,uh=0,Hl=1,fa=2,hh=3200,dh=3201,Da=0,fh=1,Bn="",yt="srgb",bt="srgb-linear",Sr="linear",tt="srgb",Ai=7680,Ac=519,Ah=512,ph=513,mh=514,Gl=515,gh=516,vh=517,_h=518,xh=519,Aa=35044,pc="300 es",hn=2e3,Tr=2001;class qi{addEventListener(e,t){this._listeners===void 0&&(this._listeners={});const n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){const n=this._listeners;return n===void 0?!1:n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){const n=this._listeners;if(n===void 0)return;const i=n[e];if(i!==void 0){const r=i.indexOf(t);r!==-1&&i.splice(r,1)}}dispatchEvent(e){const t=this._listeners;if(t===void 0)return;const n=t[e.type];if(n!==void 0){e.target=this;const i=n.slice(0);for(let r=0,o=i.length;r<o;r++)i[r].call(this,e);e.target=null}}}const Tt=["00","01","02","03","04","05","06","07","08","09","0a","0b","0c","0d","0e","0f","10","11","12","13","14","15","16","17","18","19","1a","1b","1c","1d","1e","1f","20","21","22","23","24","25","26","27","28","29","2a","2b","2c","2d","2e","2f","30","31","32","33","34","35","36","37","38","39","3a","3b","3c","3d","3e","3f","40","41","42","43","44","45","46","47","48","49","4a","4b","4c","4d","4e","4f","50","51","52","53","54","55","56","57","58","59","5a","5b","5c","5d","5e","5f","60","61","62","63","64","65","66","67","68","69","6a","6b","6c","6d","6e","6f","70","71","72","73","74","75","76","77","78","79","7a","7b","7c","7d","7e","7f","80","81","82","83","84","85","86","87","88","89","8a","8b","8c","8d","8e","8f","90","91","92","93","94","95","96","97","98","99","9a","9b","9c","9d","9e","9f","a0","a1","a2","a3","a4","a5","a6","a7","a8","a9","aa","ab","ac","ad","ae","af","b0","b1","b2","b3","b4","b5","b6","b7","b8","b9","ba","bb","bc","bd","be","bf","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","ca","cb","cc","cd","ce","cf","d0","d1","d2","d3","d4","d5","d6","d7","d8","d9","da","db","dc","dd","de","df","e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","ea","eb","ec","ed","ee","ef","f0","f1","f2","f3","f4","f5","f6","f7","f8","f9","fa","fb","fc","fd","fe","ff"];let mc=1234567;const vs=Math.PI/180,Gi=180/Math.PI;function tn(){const s=Math.random()*4294967295|0,e=Math.random()*4294967295|0,t=Math.random()*4294967295|0,n=Math.random()*4294967295|0;return(Tt[s&255]+Tt[s>>8&255]+Tt[s>>16&255]+Tt[s>>24&255]+"-"+Tt[e&255]+Tt[e>>8&255]+"-"+Tt[e>>16&15|64]+Tt[e>>24&255]+"-"+Tt[t&63|128]+Tt[t>>8&255]+"-"+Tt[t>>16&255]+Tt[t>>24&255]+Tt[n&255]+Tt[n>>8&255]+Tt[n>>16&255]+Tt[n>>24&255]).toLowerCase()}function Ge(s,e,t){return Math.max(e,Math.min(t,s))}function Ia(s,e){return(s%e+e)%e}function Mh(s,e,t,n,i){return n+(s-e)*(i-n)/(t-e)}function yh(s,e,t){return s!==e?(t-s)/(e-s):0}function _s(s,e,t){return(1-t)*s+t*e}function Sh(s,e,t,n){return _s(s,e,1-Math.exp(-t*n))}function Th(s,e=1){return e-Math.abs(Ia(s,e*2)-e)}function Eh(s,e,t){return s<=e?0:s>=t?1:(s=(s-e)/(t-e),s*s*(3-2*s))}function wh(s,e,t){return s<=e?0:s>=t?1:(s=(s-e)/(t-e),s*s*s*(s*(s*6-15)+10))}function bh(s,e){return s+Math.floor(Math.random()*(e-s+1))}function Ch(s,e){return s+Math.random()*(e-s)}function Ph(s){return s*(.5-Math.random())}function Rh(s){s!==void 0&&(mc=s);let e=mc+=1831565813;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}function Dh(s){return s*vs}function Ih(s){return s*Gi}function Lh(s){return(s&s-1)===0&&s!==0}function Uh(s){return Math.pow(2,Math.ceil(Math.log(s)/Math.LN2))}function Nh(s){return Math.pow(2,Math.floor(Math.log(s)/Math.LN2))}function Fh(s,e,t,n,i){const r=Math.cos,o=Math.sin,a=r(t/2),c=o(t/2),l=r((e+n)/2),u=o((e+n)/2),h=r((e-n)/2),d=o((e-n)/2),f=r((n-e)/2),m=o((n-e)/2);switch(i){case"XYX":s.set(a*u,c*h,c*d,a*l);break;case"YZY":s.set(c*d,a*u,c*h,a*l);break;case"ZXZ":s.set(c*h,c*d,a*u,a*l);break;case"XZX":s.set(a*u,c*m,c*f,a*l);break;case"YXY":s.set(c*f,a*u,c*m,a*l);break;case"ZYZ":s.set(c*m,c*f,a*u,a*l);break;default:console.warn("THREE.MathUtils: .setQuaternionFromProperEuler() encountered an unknown order: "+i)}}function $t(s,e){switch(e.constructor){case Float32Array:return s;case Uint32Array:return s/4294967295;case Uint16Array:return s/65535;case Uint8Array:return s/255;case Int32Array:return Math.max(s/2147483647,-1);case Int16Array:return Math.max(s/32767,-1);case Int8Array:return Math.max(s/127,-1);default:throw new Error("Invalid component type.")}}function Ze(s,e){switch(e.constructor){case Float32Array:return s;case Uint32Array:return Math.round(s*4294967295);case Uint16Array:return Math.round(s*65535);case Uint8Array:return Math.round(s*255);case Int32Array:return Math.round(s*2147483647);case Int16Array:return Math.round(s*32767);case Int8Array:return Math.round(s*127);default:throw new Error("Invalid component type.")}}const Vl={DEG2RAD:vs,RAD2DEG:Gi,generateUUID:tn,clamp:Ge,euclideanModulo:Ia,mapLinear:Mh,inverseLerp:yh,lerp:_s,damp:Sh,pingpong:Th,smoothstep:Eh,smootherstep:wh,randInt:bh,randFloat:Ch,randFloatSpread:Ph,seededRandom:Rh,degToRad:Dh,radToDeg:Ih,isPowerOfTwo:Lh,ceilPowerOfTwo:Uh,floorPowerOfTwo:Nh,setQuaternionFromProperEuler:Fh,normalize:Ze,denormalize:$t};class fe{constructor(e=0,t=0){fe.prototype.isVector2=!0,this.x=e,this.y=t}get width(){return this.x}set width(e){this.x=e}get height(){return this.y}set height(e){this.y=e}set(e,t){return this.x=e,this.y=t,this}setScalar(e){return this.x=e,this.y=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y)}copy(e){return this.x=e.x,this.y=e.y,this}add(e){return this.x+=e.x,this.y+=e.y,this}addScalar(e){return this.x+=e,this.y+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this}subScalar(e){return this.x-=e,this.y-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this}multiply(e){return this.x*=e.x,this.y*=e.y,this}multiplyScalar(e){return this.x*=e,this.y*=e,this}divide(e){return this.x/=e.x,this.y/=e.y,this}divideScalar(e){return this.multiplyScalar(1/e)}applyMatrix3(e){const t=this.x,n=this.y,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6],this.y=i[1]*t+i[4]*n+i[7],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this}clamp(e,t){return this.x=Ge(this.x,e.x,t.x),this.y=Ge(this.y,e.y,t.y),this}clampScalar(e,t){return this.x=Ge(this.x,e,t),this.y=Ge(this.y,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Ge(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this}negate(){return this.x=-this.x,this.y=-this.y,this}dot(e){return this.x*e.x+this.y*e.y}cross(e){return this.x*e.y-this.y*e.x}lengthSq(){return this.x*this.x+this.y*this.y}length(){return Math.sqrt(this.x*this.x+this.y*this.y)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)}normalize(){return this.divideScalar(this.length()||1)}angle(){return Math.atan2(-this.y,-this.x)+Math.PI}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Ge(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y;return t*t+n*n}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this}equals(e){return e.x===this.x&&e.y===this.y}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this}rotateAround(e,t){const n=Math.cos(t),i=Math.sin(t),r=this.x-e.x,o=this.y-e.y;return this.x=r*n-o*i+e.x,this.y=r*i+o*n+e.y,this}random(){return this.x=Math.random(),this.y=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y}}class fn{constructor(e=0,t=0,n=0,i=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=i}static slerpFlat(e,t,n,i,r,o,a){let c=n[i+0],l=n[i+1],u=n[i+2],h=n[i+3];const d=r[o+0],f=r[o+1],m=r[o+2],g=r[o+3];if(a===0){e[t+0]=c,e[t+1]=l,e[t+2]=u,e[t+3]=h;return}if(a===1){e[t+0]=d,e[t+1]=f,e[t+2]=m,e[t+3]=g;return}if(h!==g||c!==d||l!==f||u!==m){let p=1-a;const A=c*d+l*f+u*m+h*g,T=A>=0?1:-1,y=1-A*A;if(y>Number.EPSILON){const w=Math.sqrt(y),E=Math.atan2(w,A*T);p=Math.sin(p*E)/w,a=Math.sin(a*E)/w}const v=a*T;if(c=c*p+d*v,l=l*p+f*v,u=u*p+m*v,h=h*p+g*v,p===1-a){const w=1/Math.sqrt(c*c+l*l+u*u+h*h);c*=w,l*=w,u*=w,h*=w}}e[t]=c,e[t+1]=l,e[t+2]=u,e[t+3]=h}static multiplyQuaternionsFlat(e,t,n,i,r,o){const a=n[i],c=n[i+1],l=n[i+2],u=n[i+3],h=r[o],d=r[o+1],f=r[o+2],m=r[o+3];return e[t]=a*m+u*h+c*f-l*d,e[t+1]=c*m+u*d+l*h-a*f,e[t+2]=l*m+u*f+a*d-c*h,e[t+3]=u*m-a*h-c*d-l*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,i){return this._x=e,this._y=t,this._z=n,this._w=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){const n=e._x,i=e._y,r=e._z,o=e._order,a=Math.cos,c=Math.sin,l=a(n/2),u=a(i/2),h=a(r/2),d=c(n/2),f=c(i/2),m=c(r/2);switch(o){case"XYZ":this._x=d*u*h+l*f*m,this._y=l*f*h-d*u*m,this._z=l*u*m+d*f*h,this._w=l*u*h-d*f*m;break;case"YXZ":this._x=d*u*h+l*f*m,this._y=l*f*h-d*u*m,this._z=l*u*m-d*f*h,this._w=l*u*h+d*f*m;break;case"ZXY":this._x=d*u*h-l*f*m,this._y=l*f*h+d*u*m,this._z=l*u*m+d*f*h,this._w=l*u*h-d*f*m;break;case"ZYX":this._x=d*u*h-l*f*m,this._y=l*f*h+d*u*m,this._z=l*u*m-d*f*h,this._w=l*u*h+d*f*m;break;case"YZX":this._x=d*u*h+l*f*m,this._y=l*f*h+d*u*m,this._z=l*u*m-d*f*h,this._w=l*u*h-d*f*m;break;case"XZY":this._x=d*u*h-l*f*m,this._y=l*f*h-d*u*m,this._z=l*u*m+d*f*h,this._w=l*u*h+d*f*m;break;default:console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: "+o)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){const n=t/2,i=Math.sin(n);return this._x=e.x*i,this._y=e.y*i,this._z=e.z*i,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){const t=e.elements,n=t[0],i=t[4],r=t[8],o=t[1],a=t[5],c=t[9],l=t[2],u=t[6],h=t[10],d=n+a+h;if(d>0){const f=.5/Math.sqrt(d+1);this._w=.25/f,this._x=(u-c)*f,this._y=(r-l)*f,this._z=(o-i)*f}else if(n>a&&n>h){const f=2*Math.sqrt(1+n-a-h);this._w=(u-c)/f,this._x=.25*f,this._y=(i+o)/f,this._z=(r+l)/f}else if(a>h){const f=2*Math.sqrt(1+a-n-h);this._w=(r-l)/f,this._x=(i+o)/f,this._y=.25*f,this._z=(c+u)/f}else{const f=2*Math.sqrt(1+h-n-a);this._w=(o-i)/f,this._x=(r+l)/f,this._y=(c+u)/f,this._z=.25*f}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(Ge(this.dot(e),-1,1)))}rotateTowards(e,t){const n=this.angleTo(e);if(n===0)return this;const i=Math.min(1,t/n);return this.slerp(e,i),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x=this._x*e,this._y=this._y*e,this._z=this._z*e,this._w=this._w*e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){const n=e._x,i=e._y,r=e._z,o=e._w,a=t._x,c=t._y,l=t._z,u=t._w;return this._x=n*u+o*a+i*l-r*c,this._y=i*u+o*c+r*a-n*l,this._z=r*u+o*l+n*c-i*a,this._w=o*u-n*a-i*c-r*l,this._onChangeCallback(),this}slerp(e,t){if(t===0)return this;if(t===1)return this.copy(e);const n=this._x,i=this._y,r=this._z,o=this._w;let a=o*e._w+n*e._x+i*e._y+r*e._z;if(a<0?(this._w=-e._w,this._x=-e._x,this._y=-e._y,this._z=-e._z,a=-a):this.copy(e),a>=1)return this._w=o,this._x=n,this._y=i,this._z=r,this;const c=1-a*a;if(c<=Number.EPSILON){const f=1-t;return this._w=f*o+t*this._w,this._x=f*n+t*this._x,this._y=f*i+t*this._y,this._z=f*r+t*this._z,this.normalize(),this}const l=Math.sqrt(c),u=Math.atan2(l,a),h=Math.sin((1-t)*u)/l,d=Math.sin(t*u)/l;return this._w=o*h+this._w*d,this._x=n*h+this._x*d,this._y=i*h+this._y*d,this._z=r*h+this._z*d,this._onChangeCallback(),this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){const e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),i=Math.sqrt(1-n),r=Math.sqrt(n);return this.set(i*Math.sin(e),i*Math.cos(e),r*Math.sin(t),r*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}}class R{constructor(e=0,t=0,n=0){R.prototype.isVector3=!0,this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(gc.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(gc.setFromAxisAngle(e,t))}applyMatrix3(e){const t=this.x,n=this.y,i=this.z,r=e.elements;return this.x=r[0]*t+r[3]*n+r[6]*i,this.y=r[1]*t+r[4]*n+r[7]*i,this.z=r[2]*t+r[5]*n+r[8]*i,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){const t=this.x,n=this.y,i=this.z,r=e.elements,o=1/(r[3]*t+r[7]*n+r[11]*i+r[15]);return this.x=(r[0]*t+r[4]*n+r[8]*i+r[12])*o,this.y=(r[1]*t+r[5]*n+r[9]*i+r[13])*o,this.z=(r[2]*t+r[6]*n+r[10]*i+r[14])*o,this}applyQuaternion(e){const t=this.x,n=this.y,i=this.z,r=e.x,o=e.y,a=e.z,c=e.w,l=2*(o*i-a*n),u=2*(a*t-r*i),h=2*(r*n-o*t);return this.x=t+c*l+o*h-a*u,this.y=n+c*u+a*l-r*h,this.z=i+c*h+r*u-o*l,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){const t=this.x,n=this.y,i=this.z,r=e.elements;return this.x=r[0]*t+r[4]*n+r[8]*i,this.y=r[1]*t+r[5]*n+r[9]*i,this.z=r[2]*t+r[6]*n+r[10]*i,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=Ge(this.x,e.x,t.x),this.y=Ge(this.y,e.y,t.y),this.z=Ge(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=Ge(this.x,e,t),this.y=Ge(this.y,e,t),this.z=Ge(this.z,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Ge(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){const n=e.x,i=e.y,r=e.z,o=t.x,a=t.y,c=t.z;return this.x=i*c-r*a,this.y=r*o-n*c,this.z=n*a-i*o,this}projectOnVector(e){const t=e.lengthSq();if(t===0)return this.set(0,0,0);const n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return Or.copy(this).projectOnVector(e),this.sub(Or)}reflect(e){return this.sub(Or.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){const t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;const n=this.dot(e)/t;return Math.acos(Ge(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){const t=this.x-e.x,n=this.y-e.y,i=this.z-e.z;return t*t+n*n+i*i}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){const i=Math.sin(t)*e;return this.x=i*Math.sin(n),this.y=Math.cos(t)*e,this.z=i*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){const t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),i=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=i,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){const e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}}const Or=new R,gc=new fn;class ke{constructor(e,t,n,i,r,o,a,c,l){ke.prototype.isMatrix3=!0,this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,i,r,o,a,c,l)}set(e,t,n,i,r,o,a,c,l){const u=this.elements;return u[0]=e,u[1]=i,u[2]=a,u[3]=t,u[4]=r,u[5]=c,u[6]=n,u[7]=o,u[8]=l,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){const t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,i=t.elements,r=this.elements,o=n[0],a=n[3],c=n[6],l=n[1],u=n[4],h=n[7],d=n[2],f=n[5],m=n[8],g=i[0],p=i[3],A=i[6],T=i[1],y=i[4],v=i[7],w=i[2],E=i[5],C=i[8];return r[0]=o*g+a*T+c*w,r[3]=o*p+a*y+c*E,r[6]=o*A+a*v+c*C,r[1]=l*g+u*T+h*w,r[4]=l*p+u*y+h*E,r[7]=l*A+u*v+h*C,r[2]=d*g+f*T+m*w,r[5]=d*p+f*y+m*E,r[8]=d*A+f*v+m*C,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[1],i=e[2],r=e[3],o=e[4],a=e[5],c=e[6],l=e[7],u=e[8];return t*o*u-t*a*l-n*r*u+n*a*c+i*r*l-i*o*c}invert(){const e=this.elements,t=e[0],n=e[1],i=e[2],r=e[3],o=e[4],a=e[5],c=e[6],l=e[7],u=e[8],h=u*o-a*l,d=a*c-u*r,f=l*r-o*c,m=t*h+n*d+i*f;if(m===0)return this.set(0,0,0,0,0,0,0,0,0);const g=1/m;return e[0]=h*g,e[1]=(i*l-u*n)*g,e[2]=(a*n-i*o)*g,e[3]=d*g,e[4]=(u*t-i*c)*g,e[5]=(i*r-a*t)*g,e[6]=f*g,e[7]=(n*c-l*t)*g,e[8]=(o*t-n*r)*g,this}transpose(){let e;const t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){const t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,i,r,o,a){const c=Math.cos(r),l=Math.sin(r);return this.set(n*c,n*l,-n*(c*o+l*a)+o+e,-i*l,i*c,-i*(-l*o+c*a)+a+t,0,0,1),this}scale(e,t){return this.premultiply(Br.makeScale(e,t)),this}rotate(e){return this.premultiply(Br.makeRotation(-e)),this}translate(e,t){return this.premultiply(Br.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){const t=this.elements,n=e.elements;for(let i=0;i<9;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}}const Br=new ke;function Wl(s){for(let e=s.length-1;e>=0;--e)if(s[e]>=65535)return!0;return!1}function Rs(s){return document.createElementNS("http://www.w3.org/1999/xhtml",s)}function Oh(){const s=Rs("canvas");return s.style.display="block",s}const vc={};function Ds(s){s in vc||(vc[s]=!0,console.warn(s))}function Bh(s,e,t){return new Promise(function(n,i){function r(){switch(s.clientWaitSync(e,s.SYNC_FLUSH_COMMANDS_BIT,0)){case s.WAIT_FAILED:i();break;case s.TIMEOUT_EXPIRED:setTimeout(r,t);break;default:n()}}setTimeout(r,t)})}const _c=new ke().set(.4123908,.3575843,.1804808,.212639,.7151687,.0721923,.0193308,.1191948,.9505322),xc=new ke().set(3.2409699,-1.5373832,-.4986108,-.9692436,1.8759675,.0415551,.0556301,-.203977,1.0569715);function zh(){const s={enabled:!0,workingColorSpace:bt,spaces:{},convert:function(i,r,o){return this.enabled===!1||r===o||!r||!o||(this.spaces[r].transfer===tt&&(i.r=wn(i.r),i.g=wn(i.g),i.b=wn(i.b)),this.spaces[r].primaries!==this.spaces[o].primaries&&(i.applyMatrix3(this.spaces[r].toXYZ),i.applyMatrix3(this.spaces[o].fromXYZ)),this.spaces[o].transfer===tt&&(i.r=Fi(i.r),i.g=Fi(i.g),i.b=Fi(i.b))),i},workingToColorSpace:function(i,r){return this.convert(i,this.workingColorSpace,r)},colorSpaceToWorking:function(i,r){return this.convert(i,r,this.workingColorSpace)},getPrimaries:function(i){return this.spaces[i].primaries},getTransfer:function(i){return i===Bn?Sr:this.spaces[i].transfer},getToneMappingMode:function(i){return this.spaces[i].outputColorSpaceConfig.toneMappingMode||"standard"},getLuminanceCoefficients:function(i,r=this.workingColorSpace){return i.fromArray(this.spaces[r].luminanceCoefficients)},define:function(i){Object.assign(this.spaces,i)},_getMatrix:function(i,r,o){return i.copy(this.spaces[r].toXYZ).multiply(this.spaces[o].fromXYZ)},_getDrawingBufferColorSpace:function(i){return this.spaces[i].outputColorSpaceConfig.drawingBufferColorSpace},_getUnpackColorSpace:function(i=this.workingColorSpace){return this.spaces[i].workingColorSpaceConfig.unpackColorSpace},fromWorkingColorSpace:function(i,r){return Ds("THREE.ColorManagement: .fromWorkingColorSpace() has been renamed to .workingToColorSpace()."),s.workingToColorSpace(i,r)},toWorkingColorSpace:function(i,r){return Ds("THREE.ColorManagement: .toWorkingColorSpace() has been renamed to .colorSpaceToWorking()."),s.colorSpaceToWorking(i,r)}},e=[.64,.33,.3,.6,.15,.06],t=[.2126,.7152,.0722],n=[.3127,.329];return s.define({[bt]:{primaries:e,whitePoint:n,transfer:Sr,toXYZ:_c,fromXYZ:xc,luminanceCoefficients:t,workingColorSpaceConfig:{unpackColorSpace:yt},outputColorSpaceConfig:{drawingBufferColorSpace:yt}},[yt]:{primaries:e,whitePoint:n,transfer:tt,toXYZ:_c,fromXYZ:xc,luminanceCoefficients:t,outputColorSpaceConfig:{drawingBufferColorSpace:yt}}}),s}const je=zh();function wn(s){return s<.04045?s*.0773993808:Math.pow(s*.9478672986+.0521327014,2.4)}function Fi(s){return s<.0031308?s*12.92:1.055*Math.pow(s,.41666)-.055}let pi;class kh{static getDataURL(e,t="image/png"){if(/^data:/i.test(e.src)||typeof HTMLCanvasElement>"u")return e.src;let n;if(e instanceof HTMLCanvasElement)n=e;else{pi===void 0&&(pi=Rs("canvas")),pi.width=e.width,pi.height=e.height;const i=pi.getContext("2d");e instanceof ImageData?i.putImageData(e,0,0):i.drawImage(e,0,0,e.width,e.height),n=pi}return n.toDataURL(t)}static sRGBToLinear(e){if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap){const t=Rs("canvas");t.width=e.width,t.height=e.height;const n=t.getContext("2d");n.drawImage(e,0,0,e.width,e.height);const i=n.getImageData(0,0,e.width,e.height),r=i.data;for(let o=0;o<r.length;o++)r[o]=wn(r[o]/255)*255;return n.putImageData(i,0,0),t}else if(e.data){const t=e.data.slice(0);for(let n=0;n<t.length;n++)t instanceof Uint8Array||t instanceof Uint8ClampedArray?t[n]=Math.floor(wn(t[n]/255)*255):t[n]=wn(t[n]);return{data:t,width:e.width,height:e.height}}else return console.warn("THREE.ImageUtils.sRGBToLinear(): Unsupported image type. No color space conversion applied."),e}}let Hh=0;class La{constructor(e=null){this.isSource=!0,Object.defineProperty(this,"id",{value:Hh++}),this.uuid=tn(),this.data=e,this.dataReady=!0,this.version=0}getSize(e){const t=this.data;return typeof HTMLVideoElement<"u"&&t instanceof HTMLVideoElement?e.set(t.videoWidth,t.videoHeight,0):t instanceof VideoFrame?e.set(t.displayHeight,t.displayWidth,0):t!==null?e.set(t.width,t.height,t.depth||0):e.set(0,0,0),e}set needsUpdate(e){e===!0&&this.version++}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.images[this.uuid]!==void 0)return e.images[this.uuid];const n={uuid:this.uuid,url:""},i=this.data;if(i!==null){let r;if(Array.isArray(i)){r=[];for(let o=0,a=i.length;o<a;o++)i[o].isDataTexture?r.push(zr(i[o].image)):r.push(zr(i[o]))}else r=zr(i);n.url=r}return t||(e.images[this.uuid]=n),n}}function zr(s){return typeof HTMLImageElement<"u"&&s instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&s instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&s instanceof ImageBitmap?kh.getDataURL(s):s.data?{data:Array.from(s.data),width:s.width,height:s.height,type:s.data.constructor.name}:(console.warn("THREE.Texture: Unable to serialize Texture."),{})}let Gh=0;const kr=new R;class gt extends qi{constructor(e=gt.DEFAULT_IMAGE,t=gt.DEFAULT_MAPPING,n=zn,i=zn,r=Nt,o=Tn,a=Kt,c=dn,l=gt.DEFAULT_ANISOTROPY,u=Bn){super(),this.isTexture=!0,Object.defineProperty(this,"id",{value:Gh++}),this.uuid=tn(),this.name="",this.source=new La(e),this.mipmaps=[],this.mapping=t,this.channel=0,this.wrapS=n,this.wrapT=i,this.magFilter=r,this.minFilter=o,this.anisotropy=l,this.format=a,this.internalFormat=null,this.type=c,this.offset=new fe(0,0),this.repeat=new fe(1,1),this.center=new fe(0,0),this.rotation=0,this.matrixAutoUpdate=!0,this.matrix=new ke,this.generateMipmaps=!0,this.premultiplyAlpha=!1,this.flipY=!0,this.unpackAlignment=4,this.colorSpace=u,this.userData={},this.updateRanges=[],this.version=0,this.onUpdate=null,this.renderTarget=null,this.isRenderTargetTexture=!1,this.isArrayTexture=!!(e&&e.depth&&e.depth>1),this.pmremVersion=0}get width(){return this.source.getSize(kr).x}get height(){return this.source.getSize(kr).y}get depth(){return this.source.getSize(kr).z}get image(){return this.source.data}set image(e=null){this.source.data=e}updateMatrix(){this.matrix.setUvTransform(this.offset.x,this.offset.y,this.repeat.x,this.repeat.y,this.rotation,this.center.x,this.center.y)}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}clone(){return new this.constructor().copy(this)}copy(e){return this.name=e.name,this.source=e.source,this.mipmaps=e.mipmaps.slice(0),this.mapping=e.mapping,this.channel=e.channel,this.wrapS=e.wrapS,this.wrapT=e.wrapT,this.magFilter=e.magFilter,this.minFilter=e.minFilter,this.anisotropy=e.anisotropy,this.format=e.format,this.internalFormat=e.internalFormat,this.type=e.type,this.offset.copy(e.offset),this.repeat.copy(e.repeat),this.center.copy(e.center),this.rotation=e.rotation,this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrix.copy(e.matrix),this.generateMipmaps=e.generateMipmaps,this.premultiplyAlpha=e.premultiplyAlpha,this.flipY=e.flipY,this.unpackAlignment=e.unpackAlignment,this.colorSpace=e.colorSpace,this.renderTarget=e.renderTarget,this.isRenderTargetTexture=e.isRenderTargetTexture,this.isArrayTexture=e.isArrayTexture,this.userData=JSON.parse(JSON.stringify(e.userData)),this.needsUpdate=!0,this}setValues(e){for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Texture.setValues(): parameter '${t}' has value of undefined.`);continue}const i=this[t];if(i===void 0){console.warn(`THREE.Texture.setValues(): property '${t}' does not exist.`);continue}i&&n&&i.isVector2&&n.isVector2||i&&n&&i.isVector3&&n.isVector3||i&&n&&i.isMatrix3&&n.isMatrix3?i.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";if(!t&&e.textures[this.uuid]!==void 0)return e.textures[this.uuid];const n={metadata:{version:4.7,type:"Texture",generator:"Texture.toJSON"},uuid:this.uuid,name:this.name,image:this.source.toJSON(e).uuid,mapping:this.mapping,channel:this.channel,repeat:[this.repeat.x,this.repeat.y],offset:[this.offset.x,this.offset.y],center:[this.center.x,this.center.y],rotation:this.rotation,wrap:[this.wrapS,this.wrapT],format:this.format,internalFormat:this.internalFormat,type:this.type,colorSpace:this.colorSpace,minFilter:this.minFilter,magFilter:this.magFilter,anisotropy:this.anisotropy,flipY:this.flipY,generateMipmaps:this.generateMipmaps,premultiplyAlpha:this.premultiplyAlpha,unpackAlignment:this.unpackAlignment};return Object.keys(this.userData).length>0&&(n.userData=this.userData),t||(e.textures[this.uuid]=n),n}dispose(){this.dispatchEvent({type:"dispose"})}transformUv(e){if(this.mapping!==Il)return e;if(e.applyMatrix3(this.matrix),e.x<0||e.x>1)switch(this.wrapS){case ri:e.x=e.x-Math.floor(e.x);break;case zn:e.x=e.x<0?0:1;break;case yr:Math.abs(Math.floor(e.x)%2)===1?e.x=Math.ceil(e.x)-e.x:e.x=e.x-Math.floor(e.x);break}if(e.y<0||e.y>1)switch(this.wrapT){case ri:e.y=e.y-Math.floor(e.y);break;case zn:e.y=e.y<0?0:1;break;case yr:Math.abs(Math.floor(e.y)%2)===1?e.y=Math.ceil(e.y)-e.y:e.y=e.y-Math.floor(e.y);break}return this.flipY&&(e.y=1-e.y),e}set needsUpdate(e){e===!0&&(this.version++,this.source.needsUpdate=!0)}set needsPMREMUpdate(e){e===!0&&this.pmremVersion++}}gt.DEFAULT_IMAGE=null;gt.DEFAULT_MAPPING=Il;gt.DEFAULT_ANISOTROPY=1;class qe{constructor(e=0,t=0,n=0,i=1){qe.prototype.isVector4=!0,this.x=e,this.y=t,this.z=n,this.w=i}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,i){return this.x=e,this.y=t,this.z=n,this.w=i,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw new Error("index is out of range: "+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw new Error("index is out of range: "+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w!==void 0?e.w:1,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){const t=this.x,n=this.y,i=this.z,r=this.w,o=e.elements;return this.x=o[0]*t+o[4]*n+o[8]*i+o[12]*r,this.y=o[1]*t+o[5]*n+o[9]*i+o[13]*r,this.z=o[2]*t+o[6]*n+o[10]*i+o[14]*r,this.w=o[3]*t+o[7]*n+o[11]*i+o[15]*r,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);const t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,i,r;const c=e.elements,l=c[0],u=c[4],h=c[8],d=c[1],f=c[5],m=c[9],g=c[2],p=c[6],A=c[10];if(Math.abs(u-d)<.01&&Math.abs(h-g)<.01&&Math.abs(m-p)<.01){if(Math.abs(u+d)<.1&&Math.abs(h+g)<.1&&Math.abs(m+p)<.1&&Math.abs(l+f+A-3)<.1)return this.set(1,0,0,0),this;t=Math.PI;const y=(l+1)/2,v=(f+1)/2,w=(A+1)/2,E=(u+d)/4,C=(h+g)/4,P=(m+p)/4;return y>v&&y>w?y<.01?(n=0,i=.707106781,r=.707106781):(n=Math.sqrt(y),i=E/n,r=C/n):v>w?v<.01?(n=.707106781,i=0,r=.707106781):(i=Math.sqrt(v),n=E/i,r=P/i):w<.01?(n=.707106781,i=.707106781,r=0):(r=Math.sqrt(w),n=C/r,i=P/r),this.set(n,i,r,t),this}let T=Math.sqrt((p-m)*(p-m)+(h-g)*(h-g)+(d-u)*(d-u));return Math.abs(T)<.001&&(T=1),this.x=(p-m)/T,this.y=(h-g)/T,this.z=(d-u)/T,this.w=Math.acos((l+f+A-1)/2),this}setFromMatrixPosition(e){const t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=Ge(this.x,e.x,t.x),this.y=Ge(this.y,e.y,t.y),this.z=Ge(this.z,e.z,t.z),this.w=Ge(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=Ge(this.x,e,t),this.y=Ge(this.y,e,t),this.z=Ge(this.z,e,t),this.w=Ge(this.w,e,t),this}clampLength(e,t){const n=this.length();return this.divideScalar(n||1).multiplyScalar(Ge(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}}class Vh extends qi{constructor(e=1,t=1,n={}){super(),n=Object.assign({generateMipmaps:!1,internalFormat:null,minFilter:Nt,depthBuffer:!0,stencilBuffer:!1,resolveDepthBuffer:!0,resolveStencilBuffer:!0,depthTexture:null,samples:0,count:1,depth:1,multiview:!1},n),this.isRenderTarget=!0,this.width=e,this.height=t,this.depth=n.depth,this.scissor=new qe(0,0,e,t),this.scissorTest=!1,this.viewport=new qe(0,0,e,t);const i={width:e,height:t,depth:n.depth},r=new gt(i);this.textures=[];const o=n.count;for(let a=0;a<o;a++)this.textures[a]=r.clone(),this.textures[a].isRenderTargetTexture=!0,this.textures[a].renderTarget=this;this._setTextureOptions(n),this.depthBuffer=n.depthBuffer,this.stencilBuffer=n.stencilBuffer,this.resolveDepthBuffer=n.resolveDepthBuffer,this.resolveStencilBuffer=n.resolveStencilBuffer,this._depthTexture=null,this.depthTexture=n.depthTexture,this.samples=n.samples,this.multiview=n.multiview}_setTextureOptions(e={}){const t={minFilter:Nt,generateMipmaps:!1,flipY:!1,internalFormat:null};e.mapping!==void 0&&(t.mapping=e.mapping),e.wrapS!==void 0&&(t.wrapS=e.wrapS),e.wrapT!==void 0&&(t.wrapT=e.wrapT),e.wrapR!==void 0&&(t.wrapR=e.wrapR),e.magFilter!==void 0&&(t.magFilter=e.magFilter),e.minFilter!==void 0&&(t.minFilter=e.minFilter),e.format!==void 0&&(t.format=e.format),e.type!==void 0&&(t.type=e.type),e.anisotropy!==void 0&&(t.anisotropy=e.anisotropy),e.colorSpace!==void 0&&(t.colorSpace=e.colorSpace),e.flipY!==void 0&&(t.flipY=e.flipY),e.generateMipmaps!==void 0&&(t.generateMipmaps=e.generateMipmaps),e.internalFormat!==void 0&&(t.internalFormat=e.internalFormat);for(let n=0;n<this.textures.length;n++)this.textures[n].setValues(t)}get texture(){return this.textures[0]}set texture(e){this.textures[0]=e}set depthTexture(e){this._depthTexture!==null&&(this._depthTexture.renderTarget=null),e!==null&&(e.renderTarget=this),this._depthTexture=e}get depthTexture(){return this._depthTexture}setSize(e,t,n=1){if(this.width!==e||this.height!==t||this.depth!==n){this.width=e,this.height=t,this.depth=n;for(let i=0,r=this.textures.length;i<r;i++)this.textures[i].image.width=e,this.textures[i].image.height=t,this.textures[i].image.depth=n,this.textures[i].isArrayTexture=this.textures[i].image.depth>1;this.dispose()}this.viewport.set(0,0,e,t),this.scissor.set(0,0,e,t)}clone(){return new this.constructor().copy(this)}copy(e){this.width=e.width,this.height=e.height,this.depth=e.depth,this.scissor.copy(e.scissor),this.scissorTest=e.scissorTest,this.viewport.copy(e.viewport),this.textures.length=0;for(let t=0,n=e.textures.length;t<n;t++){this.textures[t]=e.textures[t].clone(),this.textures[t].isRenderTargetTexture=!0,this.textures[t].renderTarget=this;const i=Object.assign({},e.textures[t].image);this.textures[t].source=new La(i)}return this.depthBuffer=e.depthBuffer,this.stencilBuffer=e.stencilBuffer,this.resolveDepthBuffer=e.resolveDepthBuffer,this.resolveStencilBuffer=e.resolveStencilBuffer,e.depthTexture!==null&&(this.depthTexture=e.depthTexture.clone()),this.samples=e.samples,this}dispose(){this.dispatchEvent({type:"dispose"})}}class Gn extends Vh{constructor(e=1,t=1,n={}){super(e,t,n),this.isWebGLRenderTarget=!0}}class Xl extends gt{constructor(e=null,t=1,n=1,i=1){super(null),this.isDataArrayTexture=!0,this.image={data:e,width:t,height:n,depth:i},this.magFilter=Lt,this.minFilter=Lt,this.wrapR=zn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1,this.layerUpdates=new Set}addLayerUpdate(e){this.layerUpdates.add(e)}clearLayerUpdates(){this.layerUpdates.clear()}}class Wh extends gt{constructor(e=null,t=1,n=1,i=1){super(null),this.isData3DTexture=!0,this.image={data:e,width:t,height:n,depth:i},this.magFilter=Lt,this.minFilter=Lt,this.wrapR=zn,this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}class nn{constructor(e=new R(1/0,1/0,1/0),t=new R(-1/0,-1/0,-1/0)){this.isBox3=!0,this.min=e,this.max=t}set(e,t){return this.min.copy(e),this.max.copy(t),this}setFromArray(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t+=3)this.expandByPoint(qt.fromArray(e,t));return this}setFromBufferAttribute(e){this.makeEmpty();for(let t=0,n=e.count;t<n;t++)this.expandByPoint(qt.fromBufferAttribute(e,t));return this}setFromPoints(e){this.makeEmpty();for(let t=0,n=e.length;t<n;t++)this.expandByPoint(e[t]);return this}setFromCenterAndSize(e,t){const n=qt.copy(t).multiplyScalar(.5);return this.min.copy(e).sub(n),this.max.copy(e).add(n),this}setFromObject(e,t=!1){return this.makeEmpty(),this.expandByObject(e,t)}clone(){return new this.constructor().copy(this)}copy(e){return this.min.copy(e.min),this.max.copy(e.max),this}makeEmpty(){return this.min.x=this.min.y=this.min.z=1/0,this.max.x=this.max.y=this.max.z=-1/0,this}isEmpty(){return this.max.x<this.min.x||this.max.y<this.min.y||this.max.z<this.min.z}getCenter(e){return this.isEmpty()?e.set(0,0,0):e.addVectors(this.min,this.max).multiplyScalar(.5)}getSize(e){return this.isEmpty()?e.set(0,0,0):e.subVectors(this.max,this.min)}expandByPoint(e){return this.min.min(e),this.max.max(e),this}expandByVector(e){return this.min.sub(e),this.max.add(e),this}expandByScalar(e){return this.min.addScalar(-e),this.max.addScalar(e),this}expandByObject(e,t=!1){e.updateWorldMatrix(!1,!1);const n=e.geometry;if(n!==void 0){const r=n.getAttribute("position");if(t===!0&&r!==void 0&&e.isInstancedMesh!==!0)for(let o=0,a=r.count;o<a;o++)e.isMesh===!0?e.getVertexPosition(o,qt):qt.fromBufferAttribute(r,o),qt.applyMatrix4(e.matrixWorld),this.expandByPoint(qt);else e.boundingBox!==void 0?(e.boundingBox===null&&e.computeBoundingBox(),zs.copy(e.boundingBox)):(n.boundingBox===null&&n.computeBoundingBox(),zs.copy(n.boundingBox)),zs.applyMatrix4(e.matrixWorld),this.union(zs)}const i=e.children;for(let r=0,o=i.length;r<o;r++)this.expandByObject(i[r],t);return this}containsPoint(e){return e.x>=this.min.x&&e.x<=this.max.x&&e.y>=this.min.y&&e.y<=this.max.y&&e.z>=this.min.z&&e.z<=this.max.z}containsBox(e){return this.min.x<=e.min.x&&e.max.x<=this.max.x&&this.min.y<=e.min.y&&e.max.y<=this.max.y&&this.min.z<=e.min.z&&e.max.z<=this.max.z}getParameter(e,t){return t.set((e.x-this.min.x)/(this.max.x-this.min.x),(e.y-this.min.y)/(this.max.y-this.min.y),(e.z-this.min.z)/(this.max.z-this.min.z))}intersectsBox(e){return e.max.x>=this.min.x&&e.min.x<=this.max.x&&e.max.y>=this.min.y&&e.min.y<=this.max.y&&e.max.z>=this.min.z&&e.min.z<=this.max.z}intersectsSphere(e){return this.clampPoint(e.center,qt),qt.distanceToSquared(e.center)<=e.radius*e.radius}intersectsPlane(e){let t,n;return e.normal.x>0?(t=e.normal.x*this.min.x,n=e.normal.x*this.max.x):(t=e.normal.x*this.max.x,n=e.normal.x*this.min.x),e.normal.y>0?(t+=e.normal.y*this.min.y,n+=e.normal.y*this.max.y):(t+=e.normal.y*this.max.y,n+=e.normal.y*this.min.y),e.normal.z>0?(t+=e.normal.z*this.min.z,n+=e.normal.z*this.max.z):(t+=e.normal.z*this.max.z,n+=e.normal.z*this.min.z),t<=-e.constant&&n>=-e.constant}intersectsTriangle(e){if(this.isEmpty())return!1;this.getCenter(is),ks.subVectors(this.max,is),mi.subVectors(e.a,is),gi.subVectors(e.b,is),vi.subVectors(e.c,is),Dn.subVectors(gi,mi),In.subVectors(vi,gi),jn.subVectors(mi,vi);let t=[0,-Dn.z,Dn.y,0,-In.z,In.y,0,-jn.z,jn.y,Dn.z,0,-Dn.x,In.z,0,-In.x,jn.z,0,-jn.x,-Dn.y,Dn.x,0,-In.y,In.x,0,-jn.y,jn.x,0];return!Hr(t,mi,gi,vi,ks)||(t=[1,0,0,0,1,0,0,0,1],!Hr(t,mi,gi,vi,ks))?!1:(Hs.crossVectors(Dn,In),t=[Hs.x,Hs.y,Hs.z],Hr(t,mi,gi,vi,ks))}clampPoint(e,t){return t.copy(e).clamp(this.min,this.max)}distanceToPoint(e){return this.clampPoint(e,qt).distanceTo(e)}getBoundingSphere(e){return this.isEmpty()?e.makeEmpty():(this.getCenter(e.center),e.radius=this.getSize(qt).length()*.5),e}intersect(e){return this.min.max(e.min),this.max.min(e.max),this.isEmpty()&&this.makeEmpty(),this}union(e){return this.min.min(e.min),this.max.max(e.max),this}applyMatrix4(e){return this.isEmpty()?this:(gn[0].set(this.min.x,this.min.y,this.min.z).applyMatrix4(e),gn[1].set(this.min.x,this.min.y,this.max.z).applyMatrix4(e),gn[2].set(this.min.x,this.max.y,this.min.z).applyMatrix4(e),gn[3].set(this.min.x,this.max.y,this.max.z).applyMatrix4(e),gn[4].set(this.max.x,this.min.y,this.min.z).applyMatrix4(e),gn[5].set(this.max.x,this.min.y,this.max.z).applyMatrix4(e),gn[6].set(this.max.x,this.max.y,this.min.z).applyMatrix4(e),gn[7].set(this.max.x,this.max.y,this.max.z).applyMatrix4(e),this.setFromPoints(gn),this)}translate(e){return this.min.add(e),this.max.add(e),this}equals(e){return e.min.equals(this.min)&&e.max.equals(this.max)}toJSON(){return{min:this.min.toArray(),max:this.max.toArray()}}fromJSON(e){return this.min.fromArray(e.min),this.max.fromArray(e.max),this}}const gn=[new R,new R,new R,new R,new R,new R,new R,new R],qt=new R,zs=new nn,mi=new R,gi=new R,vi=new R,Dn=new R,In=new R,jn=new R,is=new R,ks=new R,Hs=new R,Qn=new R;function Hr(s,e,t,n,i){for(let r=0,o=s.length-3;r<=o;r+=3){Qn.fromArray(s,r);const a=i.x*Math.abs(Qn.x)+i.y*Math.abs(Qn.y)+i.z*Math.abs(Qn.z),c=e.dot(Qn),l=t.dot(Qn),u=n.dot(Qn);if(Math.max(-Math.max(c,l,u),Math.min(c,l,u))>a)return!1}return!0}const Xh=new nn,ss=new R,Gr=new R;class An{constructor(e=new R,t=-1){this.isSphere=!0,this.center=e,this.radius=t}set(e,t){return this.center.copy(e),this.radius=t,this}setFromPoints(e,t){const n=this.center;t!==void 0?n.copy(t):Xh.setFromPoints(e).getCenter(n);let i=0;for(let r=0,o=e.length;r<o;r++)i=Math.max(i,n.distanceToSquared(e[r]));return this.radius=Math.sqrt(i),this}copy(e){return this.center.copy(e.center),this.radius=e.radius,this}isEmpty(){return this.radius<0}makeEmpty(){return this.center.set(0,0,0),this.radius=-1,this}containsPoint(e){return e.distanceToSquared(this.center)<=this.radius*this.radius}distanceToPoint(e){return e.distanceTo(this.center)-this.radius}intersectsSphere(e){const t=this.radius+e.radius;return e.center.distanceToSquared(this.center)<=t*t}intersectsBox(e){return e.intersectsSphere(this)}intersectsPlane(e){return Math.abs(e.distanceToPoint(this.center))<=this.radius}clampPoint(e,t){const n=this.center.distanceToSquared(e);return t.copy(e),n>this.radius*this.radius&&(t.sub(this.center).normalize(),t.multiplyScalar(this.radius).add(this.center)),t}getBoundingBox(e){return this.isEmpty()?(e.makeEmpty(),e):(e.set(this.center,this.center),e.expandByScalar(this.radius),e)}applyMatrix4(e){return this.center.applyMatrix4(e),this.radius=this.radius*e.getMaxScaleOnAxis(),this}translate(e){return this.center.add(e),this}expandByPoint(e){if(this.isEmpty())return this.center.copy(e),this.radius=0,this;ss.subVectors(e,this.center);const t=ss.lengthSq();if(t>this.radius*this.radius){const n=Math.sqrt(t),i=(n-this.radius)*.5;this.center.addScaledVector(ss,i/n),this.radius+=i}return this}union(e){return e.isEmpty()?this:this.isEmpty()?(this.copy(e),this):(this.center.equals(e.center)===!0?this.radius=Math.max(this.radius,e.radius):(Gr.subVectors(e.center,this.center).setLength(e.radius),this.expandByPoint(ss.copy(e.center).add(Gr)),this.expandByPoint(ss.copy(e.center).sub(Gr))),this)}equals(e){return e.center.equals(this.center)&&e.radius===this.radius}clone(){return new this.constructor().copy(this)}toJSON(){return{radius:this.radius,center:this.center.toArray()}}fromJSON(e){return this.radius=e.radius,this.center.fromArray(e.center),this}}const vn=new R,Vr=new R,Gs=new R,Ln=new R,Wr=new R,Vs=new R,Xr=new R;class Pr{constructor(e=new R,t=new R(0,0,-1)){this.origin=e,this.direction=t}set(e,t){return this.origin.copy(e),this.direction.copy(t),this}copy(e){return this.origin.copy(e.origin),this.direction.copy(e.direction),this}at(e,t){return t.copy(this.origin).addScaledVector(this.direction,e)}lookAt(e){return this.direction.copy(e).sub(this.origin).normalize(),this}recast(e){return this.origin.copy(this.at(e,vn)),this}closestPointToPoint(e,t){t.subVectors(e,this.origin);const n=t.dot(this.direction);return n<0?t.copy(this.origin):t.copy(this.origin).addScaledVector(this.direction,n)}distanceToPoint(e){return Math.sqrt(this.distanceSqToPoint(e))}distanceSqToPoint(e){const t=vn.subVectors(e,this.origin).dot(this.direction);return t<0?this.origin.distanceToSquared(e):(vn.copy(this.origin).addScaledVector(this.direction,t),vn.distanceToSquared(e))}distanceSqToSegment(e,t,n,i){Vr.copy(e).add(t).multiplyScalar(.5),Gs.copy(t).sub(e).normalize(),Ln.copy(this.origin).sub(Vr);const r=e.distanceTo(t)*.5,o=-this.direction.dot(Gs),a=Ln.dot(this.direction),c=-Ln.dot(Gs),l=Ln.lengthSq(),u=Math.abs(1-o*o);let h,d,f,m;if(u>0)if(h=o*c-a,d=o*a-c,m=r*u,h>=0)if(d>=-m)if(d<=m){const g=1/u;h*=g,d*=g,f=h*(h+o*d+2*a)+d*(o*h+d+2*c)+l}else d=r,h=Math.max(0,-(o*d+a)),f=-h*h+d*(d+2*c)+l;else d=-r,h=Math.max(0,-(o*d+a)),f=-h*h+d*(d+2*c)+l;else d<=-m?(h=Math.max(0,-(-o*r+a)),d=h>0?-r:Math.min(Math.max(-r,-c),r),f=-h*h+d*(d+2*c)+l):d<=m?(h=0,d=Math.min(Math.max(-r,-c),r),f=d*(d+2*c)+l):(h=Math.max(0,-(o*r+a)),d=h>0?r:Math.min(Math.max(-r,-c),r),f=-h*h+d*(d+2*c)+l);else d=o>0?-r:r,h=Math.max(0,-(o*d+a)),f=-h*h+d*(d+2*c)+l;return n&&n.copy(this.origin).addScaledVector(this.direction,h),i&&i.copy(Vr).addScaledVector(Gs,d),f}intersectSphere(e,t){vn.subVectors(e.center,this.origin);const n=vn.dot(this.direction),i=vn.dot(vn)-n*n,r=e.radius*e.radius;if(i>r)return null;const o=Math.sqrt(r-i),a=n-o,c=n+o;return c<0?null:a<0?this.at(c,t):this.at(a,t)}intersectsSphere(e){return e.radius<0?!1:this.distanceSqToPoint(e.center)<=e.radius*e.radius}distanceToPlane(e){const t=e.normal.dot(this.direction);if(t===0)return e.distanceToPoint(this.origin)===0?0:null;const n=-(this.origin.dot(e.normal)+e.constant)/t;return n>=0?n:null}intersectPlane(e,t){const n=this.distanceToPlane(e);return n===null?null:this.at(n,t)}intersectsPlane(e){const t=e.distanceToPoint(this.origin);return t===0||e.normal.dot(this.direction)*t<0}intersectBox(e,t){let n,i,r,o,a,c;const l=1/this.direction.x,u=1/this.direction.y,h=1/this.direction.z,d=this.origin;return l>=0?(n=(e.min.x-d.x)*l,i=(e.max.x-d.x)*l):(n=(e.max.x-d.x)*l,i=(e.min.x-d.x)*l),u>=0?(r=(e.min.y-d.y)*u,o=(e.max.y-d.y)*u):(r=(e.max.y-d.y)*u,o=(e.min.y-d.y)*u),n>o||r>i||((r>n||isNaN(n))&&(n=r),(o<i||isNaN(i))&&(i=o),h>=0?(a=(e.min.z-d.z)*h,c=(e.max.z-d.z)*h):(a=(e.max.z-d.z)*h,c=(e.min.z-d.z)*h),n>c||a>i)||((a>n||n!==n)&&(n=a),(c<i||i!==i)&&(i=c),i<0)?null:this.at(n>=0?n:i,t)}intersectsBox(e){return this.intersectBox(e,vn)!==null}intersectTriangle(e,t,n,i,r){Wr.subVectors(t,e),Vs.subVectors(n,e),Xr.crossVectors(Wr,Vs);let o=this.direction.dot(Xr),a;if(o>0){if(i)return null;a=1}else if(o<0)a=-1,o=-o;else return null;Ln.subVectors(this.origin,e);const c=a*this.direction.dot(Vs.crossVectors(Ln,Vs));if(c<0)return null;const l=a*this.direction.dot(Wr.cross(Ln));if(l<0||c+l>o)return null;const u=-a*Ln.dot(Xr);return u<0?null:this.at(u/o,r)}applyMatrix4(e){return this.origin.applyMatrix4(e),this.direction.transformDirection(e),this}equals(e){return e.origin.equals(this.origin)&&e.direction.equals(this.direction)}clone(){return new this.constructor().copy(this)}}class Ne{constructor(e,t,n,i,r,o,a,c,l,u,h,d,f,m,g,p){Ne.prototype.isMatrix4=!0,this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,i,r,o,a,c,l,u,h,d,f,m,g,p)}set(e,t,n,i,r,o,a,c,l,u,h,d,f,m,g,p){const A=this.elements;return A[0]=e,A[4]=t,A[8]=n,A[12]=i,A[1]=r,A[5]=o,A[9]=a,A[13]=c,A[2]=l,A[6]=u,A[10]=h,A[14]=d,A[3]=f,A[7]=m,A[11]=g,A[15]=p,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new Ne().fromArray(this.elements)}copy(e){const t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){const t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){const t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){const t=this.elements,n=e.elements,i=1/_i.setFromMatrixColumn(e,0).length(),r=1/_i.setFromMatrixColumn(e,1).length(),o=1/_i.setFromMatrixColumn(e,2).length();return t[0]=n[0]*i,t[1]=n[1]*i,t[2]=n[2]*i,t[3]=0,t[4]=n[4]*r,t[5]=n[5]*r,t[6]=n[6]*r,t[7]=0,t[8]=n[8]*o,t[9]=n[9]*o,t[10]=n[10]*o,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){const t=this.elements,n=e.x,i=e.y,r=e.z,o=Math.cos(n),a=Math.sin(n),c=Math.cos(i),l=Math.sin(i),u=Math.cos(r),h=Math.sin(r);if(e.order==="XYZ"){const d=o*u,f=o*h,m=a*u,g=a*h;t[0]=c*u,t[4]=-c*h,t[8]=l,t[1]=f+m*l,t[5]=d-g*l,t[9]=-a*c,t[2]=g-d*l,t[6]=m+f*l,t[10]=o*c}else if(e.order==="YXZ"){const d=c*u,f=c*h,m=l*u,g=l*h;t[0]=d+g*a,t[4]=m*a-f,t[8]=o*l,t[1]=o*h,t[5]=o*u,t[9]=-a,t[2]=f*a-m,t[6]=g+d*a,t[10]=o*c}else if(e.order==="ZXY"){const d=c*u,f=c*h,m=l*u,g=l*h;t[0]=d-g*a,t[4]=-o*h,t[8]=m+f*a,t[1]=f+m*a,t[5]=o*u,t[9]=g-d*a,t[2]=-o*l,t[6]=a,t[10]=o*c}else if(e.order==="ZYX"){const d=o*u,f=o*h,m=a*u,g=a*h;t[0]=c*u,t[4]=m*l-f,t[8]=d*l+g,t[1]=c*h,t[5]=g*l+d,t[9]=f*l-m,t[2]=-l,t[6]=a*c,t[10]=o*c}else if(e.order==="YZX"){const d=o*c,f=o*l,m=a*c,g=a*l;t[0]=c*u,t[4]=g-d*h,t[8]=m*h+f,t[1]=h,t[5]=o*u,t[9]=-a*u,t[2]=-l*u,t[6]=f*h+m,t[10]=d-g*h}else if(e.order==="XZY"){const d=o*c,f=o*l,m=a*c,g=a*l;t[0]=c*u,t[4]=-h,t[8]=l*u,t[1]=d*h+g,t[5]=o*u,t[9]=f*h-m,t[2]=m*h-f,t[6]=a*u,t[10]=g*h+d}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(jh,e,Qh)}lookAt(e,t,n){const i=this.elements;return zt.subVectors(e,t),zt.lengthSq()===0&&(zt.z=1),zt.normalize(),Un.crossVectors(n,zt),Un.lengthSq()===0&&(Math.abs(n.z)===1?zt.x+=1e-4:zt.z+=1e-4,zt.normalize(),Un.crossVectors(n,zt)),Un.normalize(),Ws.crossVectors(zt,Un),i[0]=Un.x,i[4]=Ws.x,i[8]=zt.x,i[1]=Un.y,i[5]=Ws.y,i[9]=zt.y,i[2]=Un.z,i[6]=Ws.z,i[10]=zt.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){const n=e.elements,i=t.elements,r=this.elements,o=n[0],a=n[4],c=n[8],l=n[12],u=n[1],h=n[5],d=n[9],f=n[13],m=n[2],g=n[6],p=n[10],A=n[14],T=n[3],y=n[7],v=n[11],w=n[15],E=i[0],C=i[4],P=i[8],x=i[12],M=i[1],I=i[5],F=i[9],z=i[13],G=i[2],j=i[6],B=i[10],J=i[14],W=i[3],K=i[7],$=i[11],le=i[15];return r[0]=o*E+a*M+c*G+l*W,r[4]=o*C+a*I+c*j+l*K,r[8]=o*P+a*F+c*B+l*$,r[12]=o*x+a*z+c*J+l*le,r[1]=u*E+h*M+d*G+f*W,r[5]=u*C+h*I+d*j+f*K,r[9]=u*P+h*F+d*B+f*$,r[13]=u*x+h*z+d*J+f*le,r[2]=m*E+g*M+p*G+A*W,r[6]=m*C+g*I+p*j+A*K,r[10]=m*P+g*F+p*B+A*$,r[14]=m*x+g*z+p*J+A*le,r[3]=T*E+y*M+v*G+w*W,r[7]=T*C+y*I+v*j+w*K,r[11]=T*P+y*F+v*B+w*$,r[15]=T*x+y*z+v*J+w*le,this}multiplyScalar(e){const t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){const e=this.elements,t=e[0],n=e[4],i=e[8],r=e[12],o=e[1],a=e[5],c=e[9],l=e[13],u=e[2],h=e[6],d=e[10],f=e[14],m=e[3],g=e[7],p=e[11],A=e[15];return m*(+r*c*h-i*l*h-r*a*d+n*l*d+i*a*f-n*c*f)+g*(+t*c*f-t*l*d+r*o*d-i*o*f+i*l*u-r*c*u)+p*(+t*l*h-t*a*f-r*o*h+n*o*f+r*a*u-n*l*u)+A*(-i*a*u-t*c*h+t*a*d+i*o*h-n*o*d+n*c*u)}transpose(){const e=this.elements;let t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){const i=this.elements;return e.isVector3?(i[12]=e.x,i[13]=e.y,i[14]=e.z):(i[12]=e,i[13]=t,i[14]=n),this}invert(){const e=this.elements,t=e[0],n=e[1],i=e[2],r=e[3],o=e[4],a=e[5],c=e[6],l=e[7],u=e[8],h=e[9],d=e[10],f=e[11],m=e[12],g=e[13],p=e[14],A=e[15],T=h*p*l-g*d*l+g*c*f-a*p*f-h*c*A+a*d*A,y=m*d*l-u*p*l-m*c*f+o*p*f+u*c*A-o*d*A,v=u*g*l-m*h*l+m*a*f-o*g*f-u*a*A+o*h*A,w=m*h*c-u*g*c-m*a*d+o*g*d+u*a*p-o*h*p,E=t*T+n*y+i*v+r*w;if(E===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);const C=1/E;return e[0]=T*C,e[1]=(g*d*r-h*p*r-g*i*f+n*p*f+h*i*A-n*d*A)*C,e[2]=(a*p*r-g*c*r+g*i*l-n*p*l-a*i*A+n*c*A)*C,e[3]=(h*c*r-a*d*r-h*i*l+n*d*l+a*i*f-n*c*f)*C,e[4]=y*C,e[5]=(u*p*r-m*d*r+m*i*f-t*p*f-u*i*A+t*d*A)*C,e[6]=(m*c*r-o*p*r-m*i*l+t*p*l+o*i*A-t*c*A)*C,e[7]=(o*d*r-u*c*r+u*i*l-t*d*l-o*i*f+t*c*f)*C,e[8]=v*C,e[9]=(m*h*r-u*g*r-m*n*f+t*g*f+u*n*A-t*h*A)*C,e[10]=(o*g*r-m*a*r+m*n*l-t*g*l-o*n*A+t*a*A)*C,e[11]=(u*a*r-o*h*r-u*n*l+t*h*l+o*n*f-t*a*f)*C,e[12]=w*C,e[13]=(u*g*i-m*h*i+m*n*d-t*g*d-u*n*p+t*h*p)*C,e[14]=(m*a*i-o*g*i-m*n*c+t*g*c+o*n*p-t*a*p)*C,e[15]=(o*h*i-u*a*i+u*n*c-t*h*c-o*n*d+t*a*d)*C,this}scale(e){const t=this.elements,n=e.x,i=e.y,r=e.z;return t[0]*=n,t[4]*=i,t[8]*=r,t[1]*=n,t[5]*=i,t[9]*=r,t[2]*=n,t[6]*=i,t[10]*=r,t[3]*=n,t[7]*=i,t[11]*=r,this}getMaxScaleOnAxis(){const e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],i=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,i))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){const t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){const t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){const n=Math.cos(t),i=Math.sin(t),r=1-n,o=e.x,a=e.y,c=e.z,l=r*o,u=r*a;return this.set(l*o+n,l*a-i*c,l*c+i*a,0,l*a+i*c,u*a+n,u*c-i*o,0,l*c-i*a,u*c+i*o,r*c*c+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,i,r,o){return this.set(1,n,r,0,e,1,o,0,t,i,1,0,0,0,0,1),this}compose(e,t,n){const i=this.elements,r=t._x,o=t._y,a=t._z,c=t._w,l=r+r,u=o+o,h=a+a,d=r*l,f=r*u,m=r*h,g=o*u,p=o*h,A=a*h,T=c*l,y=c*u,v=c*h,w=n.x,E=n.y,C=n.z;return i[0]=(1-(g+A))*w,i[1]=(f+v)*w,i[2]=(m-y)*w,i[3]=0,i[4]=(f-v)*E,i[5]=(1-(d+A))*E,i[6]=(p+T)*E,i[7]=0,i[8]=(m+y)*C,i[9]=(p-T)*C,i[10]=(1-(d+g))*C,i[11]=0,i[12]=e.x,i[13]=e.y,i[14]=e.z,i[15]=1,this}decompose(e,t,n){const i=this.elements;let r=_i.set(i[0],i[1],i[2]).length();const o=_i.set(i[4],i[5],i[6]).length(),a=_i.set(i[8],i[9],i[10]).length();this.determinant()<0&&(r=-r),e.x=i[12],e.y=i[13],e.z=i[14],Jt.copy(this);const l=1/r,u=1/o,h=1/a;return Jt.elements[0]*=l,Jt.elements[1]*=l,Jt.elements[2]*=l,Jt.elements[4]*=u,Jt.elements[5]*=u,Jt.elements[6]*=u,Jt.elements[8]*=h,Jt.elements[9]*=h,Jt.elements[10]*=h,t.setFromRotationMatrix(Jt),n.x=r,n.y=o,n.z=a,this}makePerspective(e,t,n,i,r,o,a=hn,c=!1){const l=this.elements,u=2*r/(t-e),h=2*r/(n-i),d=(t+e)/(t-e),f=(n+i)/(n-i);let m,g;if(c)m=r/(o-r),g=o*r/(o-r);else if(a===hn)m=-(o+r)/(o-r),g=-2*o*r/(o-r);else if(a===Tr)m=-o/(o-r),g=-o*r/(o-r);else throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: "+a);return l[0]=u,l[4]=0,l[8]=d,l[12]=0,l[1]=0,l[5]=h,l[9]=f,l[13]=0,l[2]=0,l[6]=0,l[10]=m,l[14]=g,l[3]=0,l[7]=0,l[11]=-1,l[15]=0,this}makeOrthographic(e,t,n,i,r,o,a=hn,c=!1){const l=this.elements,u=2/(t-e),h=2/(n-i),d=-(t+e)/(t-e),f=-(n+i)/(n-i);let m,g;if(c)m=1/(o-r),g=o/(o-r);else if(a===hn)m=-2/(o-r),g=-(o+r)/(o-r);else if(a===Tr)m=-1/(o-r),g=-r/(o-r);else throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: "+a);return l[0]=u,l[4]=0,l[8]=0,l[12]=d,l[1]=0,l[5]=h,l[9]=0,l[13]=f,l[2]=0,l[6]=0,l[10]=m,l[14]=g,l[3]=0,l[7]=0,l[11]=0,l[15]=1,this}equals(e){const t=this.elements,n=e.elements;for(let i=0;i<16;i++)if(t[i]!==n[i])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){const n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}}const _i=new R,Jt=new Ne,jh=new R(0,0,0),Qh=new R(1,1,1),Un=new R,Ws=new R,zt=new R,Mc=new Ne,yc=new fn;class sn{constructor(e=0,t=0,n=0,i=sn.DEFAULT_ORDER){this.isEuler=!0,this._x=e,this._y=t,this._z=n,this._order=i}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get order(){return this._order}set order(e){this._order=e,this._onChangeCallback()}set(e,t,n,i=this._order){return this._x=e,this._y=t,this._z=n,this._order=i,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._order)}copy(e){return this._x=e._x,this._y=e._y,this._z=e._z,this._order=e._order,this._onChangeCallback(),this}setFromRotationMatrix(e,t=this._order,n=!0){const i=e.elements,r=i[0],o=i[4],a=i[8],c=i[1],l=i[5],u=i[9],h=i[2],d=i[6],f=i[10];switch(t){case"XYZ":this._y=Math.asin(Ge(a,-1,1)),Math.abs(a)<.9999999?(this._x=Math.atan2(-u,f),this._z=Math.atan2(-o,r)):(this._x=Math.atan2(d,l),this._z=0);break;case"YXZ":this._x=Math.asin(-Ge(u,-1,1)),Math.abs(u)<.9999999?(this._y=Math.atan2(a,f),this._z=Math.atan2(c,l)):(this._y=Math.atan2(-h,r),this._z=0);break;case"ZXY":this._x=Math.asin(Ge(d,-1,1)),Math.abs(d)<.9999999?(this._y=Math.atan2(-h,f),this._z=Math.atan2(-o,l)):(this._y=0,this._z=Math.atan2(c,r));break;case"ZYX":this._y=Math.asin(-Ge(h,-1,1)),Math.abs(h)<.9999999?(this._x=Math.atan2(d,f),this._z=Math.atan2(c,r)):(this._x=0,this._z=Math.atan2(-o,l));break;case"YZX":this._z=Math.asin(Ge(c,-1,1)),Math.abs(c)<.9999999?(this._x=Math.atan2(-u,l),this._y=Math.atan2(-h,r)):(this._x=0,this._y=Math.atan2(a,f));break;case"XZY":this._z=Math.asin(-Ge(o,-1,1)),Math.abs(o)<.9999999?(this._x=Math.atan2(d,l),this._y=Math.atan2(a,r)):(this._x=Math.atan2(-u,f),this._y=0);break;default:console.warn("THREE.Euler: .setFromRotationMatrix() encountered an unknown order: "+t)}return this._order=t,n===!0&&this._onChangeCallback(),this}setFromQuaternion(e,t,n){return Mc.makeRotationFromQuaternion(e),this.setFromRotationMatrix(Mc,t,n)}setFromVector3(e,t=this._order){return this.set(e.x,e.y,e.z,t)}reorder(e){return yc.setFromEuler(this),this.setFromQuaternion(yc,e)}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._order===this._order}fromArray(e){return this._x=e[0],this._y=e[1],this._z=e[2],e[3]!==void 0&&(this._order=e[3]),this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._order,e}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._order}}sn.DEFAULT_ORDER="XYZ";class jl{constructor(){this.mask=1}set(e){this.mask=(1<<e|0)>>>0}enable(e){this.mask|=1<<e|0}enableAll(){this.mask=-1}toggle(e){this.mask^=1<<e|0}disable(e){this.mask&=~(1<<e|0)}disableAll(){this.mask=0}test(e){return(this.mask&e.mask)!==0}isEnabled(e){return(this.mask&(1<<e|0))!==0}}let Kh=0;const Sc=new R,xi=new fn,_n=new Ne,Xs=new R,rs=new R,Yh=new R,qh=new fn,Tc=new R(1,0,0),Ec=new R(0,1,0),wc=new R(0,0,1),bc={type:"added"},Jh={type:"removed"},Mi={type:"childadded",child:null},jr={type:"childremoved",child:null};class ot extends qi{constructor(){super(),this.isObject3D=!0,Object.defineProperty(this,"id",{value:Kh++}),this.uuid=tn(),this.name="",this.type="Object3D",this.parent=null,this.children=[],this.up=ot.DEFAULT_UP.clone();const e=new R,t=new sn,n=new fn,i=new R(1,1,1);function r(){n.setFromEuler(t,!1)}function o(){t.setFromQuaternion(n,void 0,!1)}t._onChange(r),n._onChange(o),Object.defineProperties(this,{position:{configurable:!0,enumerable:!0,value:e},rotation:{configurable:!0,enumerable:!0,value:t},quaternion:{configurable:!0,enumerable:!0,value:n},scale:{configurable:!0,enumerable:!0,value:i},modelViewMatrix:{value:new Ne},normalMatrix:{value:new ke}}),this.matrix=new Ne,this.matrixWorld=new Ne,this.matrixAutoUpdate=ot.DEFAULT_MATRIX_AUTO_UPDATE,this.matrixWorldAutoUpdate=ot.DEFAULT_MATRIX_WORLD_AUTO_UPDATE,this.matrixWorldNeedsUpdate=!1,this.layers=new jl,this.visible=!0,this.castShadow=!1,this.receiveShadow=!1,this.frustumCulled=!0,this.renderOrder=0,this.animations=[],this.customDepthMaterial=void 0,this.customDistanceMaterial=void 0,this.userData={}}onBeforeShadow(){}onAfterShadow(){}onBeforeRender(){}onAfterRender(){}applyMatrix4(e){this.matrixAutoUpdate&&this.updateMatrix(),this.matrix.premultiply(e),this.matrix.decompose(this.position,this.quaternion,this.scale)}applyQuaternion(e){return this.quaternion.premultiply(e),this}setRotationFromAxisAngle(e,t){this.quaternion.setFromAxisAngle(e,t)}setRotationFromEuler(e){this.quaternion.setFromEuler(e,!0)}setRotationFromMatrix(e){this.quaternion.setFromRotationMatrix(e)}setRotationFromQuaternion(e){this.quaternion.copy(e)}rotateOnAxis(e,t){return xi.setFromAxisAngle(e,t),this.quaternion.multiply(xi),this}rotateOnWorldAxis(e,t){return xi.setFromAxisAngle(e,t),this.quaternion.premultiply(xi),this}rotateX(e){return this.rotateOnAxis(Tc,e)}rotateY(e){return this.rotateOnAxis(Ec,e)}rotateZ(e){return this.rotateOnAxis(wc,e)}translateOnAxis(e,t){return Sc.copy(e).applyQuaternion(this.quaternion),this.position.add(Sc.multiplyScalar(t)),this}translateX(e){return this.translateOnAxis(Tc,e)}translateY(e){return this.translateOnAxis(Ec,e)}translateZ(e){return this.translateOnAxis(wc,e)}localToWorld(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(this.matrixWorld)}worldToLocal(e){return this.updateWorldMatrix(!0,!1),e.applyMatrix4(_n.copy(this.matrixWorld).invert())}lookAt(e,t,n){e.isVector3?Xs.copy(e):Xs.set(e,t,n);const i=this.parent;this.updateWorldMatrix(!0,!1),rs.setFromMatrixPosition(this.matrixWorld),this.isCamera||this.isLight?_n.lookAt(rs,Xs,this.up):_n.lookAt(Xs,rs,this.up),this.quaternion.setFromRotationMatrix(_n),i&&(_n.extractRotation(i.matrixWorld),xi.setFromRotationMatrix(_n),this.quaternion.premultiply(xi.invert()))}add(e){if(arguments.length>1){for(let t=0;t<arguments.length;t++)this.add(arguments[t]);return this}return e===this?(console.error("THREE.Object3D.add: object can't be added as a child of itself.",e),this):(e&&e.isObject3D?(e.removeFromParent(),e.parent=this,this.children.push(e),e.dispatchEvent(bc),Mi.child=e,this.dispatchEvent(Mi),Mi.child=null):console.error("THREE.Object3D.add: object not an instance of THREE.Object3D.",e),this)}remove(e){if(arguments.length>1){for(let n=0;n<arguments.length;n++)this.remove(arguments[n]);return this}const t=this.children.indexOf(e);return t!==-1&&(e.parent=null,this.children.splice(t,1),e.dispatchEvent(Jh),jr.child=e,this.dispatchEvent(jr),jr.child=null),this}removeFromParent(){const e=this.parent;return e!==null&&e.remove(this),this}clear(){return this.remove(...this.children)}attach(e){return this.updateWorldMatrix(!0,!1),_n.copy(this.matrixWorld).invert(),e.parent!==null&&(e.parent.updateWorldMatrix(!0,!1),_n.multiply(e.parent.matrixWorld)),e.applyMatrix4(_n),e.removeFromParent(),e.parent=this,this.children.push(e),e.updateWorldMatrix(!1,!0),e.dispatchEvent(bc),Mi.child=e,this.dispatchEvent(Mi),Mi.child=null,this}getObjectById(e){return this.getObjectByProperty("id",e)}getObjectByName(e){return this.getObjectByProperty("name",e)}getObjectByProperty(e,t){if(this[e]===t)return this;for(let n=0,i=this.children.length;n<i;n++){const o=this.children[n].getObjectByProperty(e,t);if(o!==void 0)return o}}getObjectsByProperty(e,t,n=[]){this[e]===t&&n.push(this);const i=this.children;for(let r=0,o=i.length;r<o;r++)i[r].getObjectsByProperty(e,t,n);return n}getWorldPosition(e){return this.updateWorldMatrix(!0,!1),e.setFromMatrixPosition(this.matrixWorld)}getWorldQuaternion(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(rs,e,Yh),e}getWorldScale(e){return this.updateWorldMatrix(!0,!1),this.matrixWorld.decompose(rs,qh,e),e}getWorldDirection(e){this.updateWorldMatrix(!0,!1);const t=this.matrixWorld.elements;return e.set(t[8],t[9],t[10]).normalize()}raycast(){}traverse(e){e(this);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverse(e)}traverseVisible(e){if(this.visible===!1)return;e(this);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].traverseVisible(e)}traverseAncestors(e){const t=this.parent;t!==null&&(e(t),t.traverseAncestors(e))}updateMatrix(){this.matrix.compose(this.position,this.quaternion,this.scale),this.matrixWorldNeedsUpdate=!0}updateMatrixWorld(e){this.matrixAutoUpdate&&this.updateMatrix(),(this.matrixWorldNeedsUpdate||e)&&(this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),this.matrixWorldNeedsUpdate=!1,e=!0);const t=this.children;for(let n=0,i=t.length;n<i;n++)t[n].updateMatrixWorld(e)}updateWorldMatrix(e,t){const n=this.parent;if(e===!0&&n!==null&&n.updateWorldMatrix(!0,!1),this.matrixAutoUpdate&&this.updateMatrix(),this.matrixWorldAutoUpdate===!0&&(this.parent===null?this.matrixWorld.copy(this.matrix):this.matrixWorld.multiplyMatrices(this.parent.matrixWorld,this.matrix)),t===!0){const i=this.children;for(let r=0,o=i.length;r<o;r++)i[r].updateWorldMatrix(!1,!0)}}toJSON(e){const t=e===void 0||typeof e=="string",n={};t&&(e={geometries:{},materials:{},textures:{},images:{},shapes:{},skeletons:{},animations:{},nodes:{}},n.metadata={version:4.7,type:"Object",generator:"Object3D.toJSON"});const i={};i.uuid=this.uuid,i.type=this.type,this.name!==""&&(i.name=this.name),this.castShadow===!0&&(i.castShadow=!0),this.receiveShadow===!0&&(i.receiveShadow=!0),this.visible===!1&&(i.visible=!1),this.frustumCulled===!1&&(i.frustumCulled=!1),this.renderOrder!==0&&(i.renderOrder=this.renderOrder),Object.keys(this.userData).length>0&&(i.userData=this.userData),i.layers=this.layers.mask,i.matrix=this.matrix.toArray(),i.up=this.up.toArray(),this.matrixAutoUpdate===!1&&(i.matrixAutoUpdate=!1),this.isInstancedMesh&&(i.type="InstancedMesh",i.count=this.count,i.instanceMatrix=this.instanceMatrix.toJSON(),this.instanceColor!==null&&(i.instanceColor=this.instanceColor.toJSON())),this.isBatchedMesh&&(i.type="BatchedMesh",i.perObjectFrustumCulled=this.perObjectFrustumCulled,i.sortObjects=this.sortObjects,i.drawRanges=this._drawRanges,i.reservedRanges=this._reservedRanges,i.geometryInfo=this._geometryInfo.map(a=>({...a,boundingBox:a.boundingBox?a.boundingBox.toJSON():void 0,boundingSphere:a.boundingSphere?a.boundingSphere.toJSON():void 0})),i.instanceInfo=this._instanceInfo.map(a=>({...a})),i.availableInstanceIds=this._availableInstanceIds.slice(),i.availableGeometryIds=this._availableGeometryIds.slice(),i.nextIndexStart=this._nextIndexStart,i.nextVertexStart=this._nextVertexStart,i.geometryCount=this._geometryCount,i.maxInstanceCount=this._maxInstanceCount,i.maxVertexCount=this._maxVertexCount,i.maxIndexCount=this._maxIndexCount,i.geometryInitialized=this._geometryInitialized,i.matricesTexture=this._matricesTexture.toJSON(e),i.indirectTexture=this._indirectTexture.toJSON(e),this._colorsTexture!==null&&(i.colorsTexture=this._colorsTexture.toJSON(e)),this.boundingSphere!==null&&(i.boundingSphere=this.boundingSphere.toJSON()),this.boundingBox!==null&&(i.boundingBox=this.boundingBox.toJSON()));function r(a,c){return a[c.uuid]===void 0&&(a[c.uuid]=c.toJSON(e)),c.uuid}if(this.isScene)this.background&&(this.background.isColor?i.background=this.background.toJSON():this.background.isTexture&&(i.background=this.background.toJSON(e).uuid)),this.environment&&this.environment.isTexture&&this.environment.isRenderTargetTexture!==!0&&(i.environment=this.environment.toJSON(e).uuid);else if(this.isMesh||this.isLine||this.isPoints){i.geometry=r(e.geometries,this.geometry);const a=this.geometry.parameters;if(a!==void 0&&a.shapes!==void 0){const c=a.shapes;if(Array.isArray(c))for(let l=0,u=c.length;l<u;l++){const h=c[l];r(e.shapes,h)}else r(e.shapes,c)}}if(this.isSkinnedMesh&&(i.bindMode=this.bindMode,i.bindMatrix=this.bindMatrix.toArray(),this.skeleton!==void 0&&(r(e.skeletons,this.skeleton),i.skeleton=this.skeleton.uuid)),this.material!==void 0)if(Array.isArray(this.material)){const a=[];for(let c=0,l=this.material.length;c<l;c++)a.push(r(e.materials,this.material[c]));i.material=a}else i.material=r(e.materials,this.material);if(this.children.length>0){i.children=[];for(let a=0;a<this.children.length;a++)i.children.push(this.children[a].toJSON(e).object)}if(this.animations.length>0){i.animations=[];for(let a=0;a<this.animations.length;a++){const c=this.animations[a];i.animations.push(r(e.animations,c))}}if(t){const a=o(e.geometries),c=o(e.materials),l=o(e.textures),u=o(e.images),h=o(e.shapes),d=o(e.skeletons),f=o(e.animations),m=o(e.nodes);a.length>0&&(n.geometries=a),c.length>0&&(n.materials=c),l.length>0&&(n.textures=l),u.length>0&&(n.images=u),h.length>0&&(n.shapes=h),d.length>0&&(n.skeletons=d),f.length>0&&(n.animations=f),m.length>0&&(n.nodes=m)}return n.object=i,n;function o(a){const c=[];for(const l in a){const u=a[l];delete u.metadata,c.push(u)}return c}}clone(e){return new this.constructor().copy(this,e)}copy(e,t=!0){if(this.name=e.name,this.up.copy(e.up),this.position.copy(e.position),this.rotation.order=e.rotation.order,this.quaternion.copy(e.quaternion),this.scale.copy(e.scale),this.matrix.copy(e.matrix),this.matrixWorld.copy(e.matrixWorld),this.matrixAutoUpdate=e.matrixAutoUpdate,this.matrixWorldAutoUpdate=e.matrixWorldAutoUpdate,this.matrixWorldNeedsUpdate=e.matrixWorldNeedsUpdate,this.layers.mask=e.layers.mask,this.visible=e.visible,this.castShadow=e.castShadow,this.receiveShadow=e.receiveShadow,this.frustumCulled=e.frustumCulled,this.renderOrder=e.renderOrder,this.animations=e.animations.slice(),this.userData=JSON.parse(JSON.stringify(e.userData)),t===!0)for(let n=0;n<e.children.length;n++){const i=e.children[n];this.add(i.clone())}return this}}ot.DEFAULT_UP=new R(0,1,0);ot.DEFAULT_MATRIX_AUTO_UPDATE=!0;ot.DEFAULT_MATRIX_WORLD_AUTO_UPDATE=!0;const Zt=new R,xn=new R,Qr=new R,Mn=new R,yi=new R,Si=new R,Cc=new R,Kr=new R,Yr=new R,qr=new R,Jr=new qe,Zr=new qe,$r=new qe;class Qt{constructor(e=new R,t=new R,n=new R){this.a=e,this.b=t,this.c=n}static getNormal(e,t,n,i){i.subVectors(n,t),Zt.subVectors(e,t),i.cross(Zt);const r=i.lengthSq();return r>0?i.multiplyScalar(1/Math.sqrt(r)):i.set(0,0,0)}static getBarycoord(e,t,n,i,r){Zt.subVectors(i,t),xn.subVectors(n,t),Qr.subVectors(e,t);const o=Zt.dot(Zt),a=Zt.dot(xn),c=Zt.dot(Qr),l=xn.dot(xn),u=xn.dot(Qr),h=o*l-a*a;if(h===0)return r.set(0,0,0),null;const d=1/h,f=(l*c-a*u)*d,m=(o*u-a*c)*d;return r.set(1-f-m,m,f)}static containsPoint(e,t,n,i){return this.getBarycoord(e,t,n,i,Mn)===null?!1:Mn.x>=0&&Mn.y>=0&&Mn.x+Mn.y<=1}static getInterpolation(e,t,n,i,r,o,a,c){return this.getBarycoord(e,t,n,i,Mn)===null?(c.x=0,c.y=0,"z"in c&&(c.z=0),"w"in c&&(c.w=0),null):(c.setScalar(0),c.addScaledVector(r,Mn.x),c.addScaledVector(o,Mn.y),c.addScaledVector(a,Mn.z),c)}static getInterpolatedAttribute(e,t,n,i,r,o){return Jr.setScalar(0),Zr.setScalar(0),$r.setScalar(0),Jr.fromBufferAttribute(e,t),Zr.fromBufferAttribute(e,n),$r.fromBufferAttribute(e,i),o.setScalar(0),o.addScaledVector(Jr,r.x),o.addScaledVector(Zr,r.y),o.addScaledVector($r,r.z),o}static isFrontFacing(e,t,n,i){return Zt.subVectors(n,t),xn.subVectors(e,t),Zt.cross(xn).dot(i)<0}set(e,t,n){return this.a.copy(e),this.b.copy(t),this.c.copy(n),this}setFromPointsAndIndices(e,t,n,i){return this.a.copy(e[t]),this.b.copy(e[n]),this.c.copy(e[i]),this}setFromAttributeAndIndices(e,t,n,i){return this.a.fromBufferAttribute(e,t),this.b.fromBufferAttribute(e,n),this.c.fromBufferAttribute(e,i),this}clone(){return new this.constructor().copy(this)}copy(e){return this.a.copy(e.a),this.b.copy(e.b),this.c.copy(e.c),this}getArea(){return Zt.subVectors(this.c,this.b),xn.subVectors(this.a,this.b),Zt.cross(xn).length()*.5}getMidpoint(e){return e.addVectors(this.a,this.b).add(this.c).multiplyScalar(1/3)}getNormal(e){return Qt.getNormal(this.a,this.b,this.c,e)}getPlane(e){return e.setFromCoplanarPoints(this.a,this.b,this.c)}getBarycoord(e,t){return Qt.getBarycoord(e,this.a,this.b,this.c,t)}getInterpolation(e,t,n,i,r){return Qt.getInterpolation(e,this.a,this.b,this.c,t,n,i,r)}containsPoint(e){return Qt.containsPoint(e,this.a,this.b,this.c)}isFrontFacing(e){return Qt.isFrontFacing(this.a,this.b,this.c,e)}intersectsBox(e){return e.intersectsTriangle(this)}closestPointToPoint(e,t){const n=this.a,i=this.b,r=this.c;let o,a;yi.subVectors(i,n),Si.subVectors(r,n),Kr.subVectors(e,n);const c=yi.dot(Kr),l=Si.dot(Kr);if(c<=0&&l<=0)return t.copy(n);Yr.subVectors(e,i);const u=yi.dot(Yr),h=Si.dot(Yr);if(u>=0&&h<=u)return t.copy(i);const d=c*h-u*l;if(d<=0&&c>=0&&u<=0)return o=c/(c-u),t.copy(n).addScaledVector(yi,o);qr.subVectors(e,r);const f=yi.dot(qr),m=Si.dot(qr);if(m>=0&&f<=m)return t.copy(r);const g=f*l-c*m;if(g<=0&&l>=0&&m<=0)return a=l/(l-m),t.copy(n).addScaledVector(Si,a);const p=u*m-f*h;if(p<=0&&h-u>=0&&f-m>=0)return Cc.subVectors(r,i),a=(h-u)/(h-u+(f-m)),t.copy(i).addScaledVector(Cc,a);const A=1/(p+g+d);return o=g*A,a=d*A,t.copy(n).addScaledVector(yi,o).addScaledVector(Si,a)}equals(e){return e.a.equals(this.a)&&e.b.equals(this.b)&&e.c.equals(this.c)}}const Ql={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074},Nn={h:0,s:0,l:0},js={h:0,s:0,l:0};function eo(s,e,t){return t<0&&(t+=1),t>1&&(t-=1),t<1/6?s+(e-s)*6*t:t<1/2?e:t<2/3?s+(e-s)*6*(2/3-t):s}class be{constructor(e,t,n){return this.isColor=!0,this.r=1,this.g=1,this.b=1,this.set(e,t,n)}set(e,t,n){if(t===void 0&&n===void 0){const i=e;i&&i.isColor?this.copy(i):typeof i=="number"?this.setHex(i):typeof i=="string"&&this.setStyle(i)}else this.setRGB(e,t,n);return this}setScalar(e){return this.r=e,this.g=e,this.b=e,this}setHex(e,t=yt){return e=Math.floor(e),this.r=(e>>16&255)/255,this.g=(e>>8&255)/255,this.b=(e&255)/255,je.colorSpaceToWorking(this,t),this}setRGB(e,t,n,i=je.workingColorSpace){return this.r=e,this.g=t,this.b=n,je.colorSpaceToWorking(this,i),this}setHSL(e,t,n,i=je.workingColorSpace){if(e=Ia(e,1),t=Ge(t,0,1),n=Ge(n,0,1),t===0)this.r=this.g=this.b=n;else{const r=n<=.5?n*(1+t):n+t-n*t,o=2*n-r;this.r=eo(o,r,e+1/3),this.g=eo(o,r,e),this.b=eo(o,r,e-1/3)}return je.colorSpaceToWorking(this,i),this}setStyle(e,t=yt){function n(r){r!==void 0&&parseFloat(r)<1&&console.warn("THREE.Color: Alpha component of "+e+" will be ignored.")}let i;if(i=/^(\w+)\(([^\)]*)\)/.exec(e)){let r;const o=i[1],a=i[2];switch(o){case"rgb":case"rgba":if(r=/^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(255,parseInt(r[1],10))/255,Math.min(255,parseInt(r[2],10))/255,Math.min(255,parseInt(r[3],10))/255,t);if(r=/^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setRGB(Math.min(100,parseInt(r[1],10))/100,Math.min(100,parseInt(r[2],10))/100,Math.min(100,parseInt(r[3],10))/100,t);break;case"hsl":case"hsla":if(r=/^\s*(\d*\.?\d+)\s*,\s*(\d*\.?\d+)\%\s*,\s*(\d*\.?\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(a))return n(r[4]),this.setHSL(parseFloat(r[1])/360,parseFloat(r[2])/100,parseFloat(r[3])/100,t);break;default:console.warn("THREE.Color: Unknown color model "+e)}}else if(i=/^\#([A-Fa-f\d]+)$/.exec(e)){const r=i[1],o=r.length;if(o===3)return this.setRGB(parseInt(r.charAt(0),16)/15,parseInt(r.charAt(1),16)/15,parseInt(r.charAt(2),16)/15,t);if(o===6)return this.setHex(parseInt(r,16),t);console.warn("THREE.Color: Invalid hex color "+e)}else if(e&&e.length>0)return this.setColorName(e,t);return this}setColorName(e,t=yt){const n=Ql[e.toLowerCase()];return n!==void 0?this.setHex(n,t):console.warn("THREE.Color: Unknown color "+e),this}clone(){return new this.constructor(this.r,this.g,this.b)}copy(e){return this.r=e.r,this.g=e.g,this.b=e.b,this}copySRGBToLinear(e){return this.r=wn(e.r),this.g=wn(e.g),this.b=wn(e.b),this}copyLinearToSRGB(e){return this.r=Fi(e.r),this.g=Fi(e.g),this.b=Fi(e.b),this}convertSRGBToLinear(){return this.copySRGBToLinear(this),this}convertLinearToSRGB(){return this.copyLinearToSRGB(this),this}getHex(e=yt){return je.workingToColorSpace(Et.copy(this),e),Math.round(Ge(Et.r*255,0,255))*65536+Math.round(Ge(Et.g*255,0,255))*256+Math.round(Ge(Et.b*255,0,255))}getHexString(e=yt){return("000000"+this.getHex(e).toString(16)).slice(-6)}getHSL(e,t=je.workingColorSpace){je.workingToColorSpace(Et.copy(this),t);const n=Et.r,i=Et.g,r=Et.b,o=Math.max(n,i,r),a=Math.min(n,i,r);let c,l;const u=(a+o)/2;if(a===o)c=0,l=0;else{const h=o-a;switch(l=u<=.5?h/(o+a):h/(2-o-a),o){case n:c=(i-r)/h+(i<r?6:0);break;case i:c=(r-n)/h+2;break;case r:c=(n-i)/h+4;break}c/=6}return e.h=c,e.s=l,e.l=u,e}getRGB(e,t=je.workingColorSpace){return je.workingToColorSpace(Et.copy(this),t),e.r=Et.r,e.g=Et.g,e.b=Et.b,e}getStyle(e=yt){je.workingToColorSpace(Et.copy(this),e);const t=Et.r,n=Et.g,i=Et.b;return e!==yt?`color(${e} ${t.toFixed(3)} ${n.toFixed(3)} ${i.toFixed(3)})`:`rgb(${Math.round(t*255)},${Math.round(n*255)},${Math.round(i*255)})`}offsetHSL(e,t,n){return this.getHSL(Nn),this.setHSL(Nn.h+e,Nn.s+t,Nn.l+n)}add(e){return this.r+=e.r,this.g+=e.g,this.b+=e.b,this}addColors(e,t){return this.r=e.r+t.r,this.g=e.g+t.g,this.b=e.b+t.b,this}addScalar(e){return this.r+=e,this.g+=e,this.b+=e,this}sub(e){return this.r=Math.max(0,this.r-e.r),this.g=Math.max(0,this.g-e.g),this.b=Math.max(0,this.b-e.b),this}multiply(e){return this.r*=e.r,this.g*=e.g,this.b*=e.b,this}multiplyScalar(e){return this.r*=e,this.g*=e,this.b*=e,this}lerp(e,t){return this.r+=(e.r-this.r)*t,this.g+=(e.g-this.g)*t,this.b+=(e.b-this.b)*t,this}lerpColors(e,t,n){return this.r=e.r+(t.r-e.r)*n,this.g=e.g+(t.g-e.g)*n,this.b=e.b+(t.b-e.b)*n,this}lerpHSL(e,t){this.getHSL(Nn),e.getHSL(js);const n=_s(Nn.h,js.h,t),i=_s(Nn.s,js.s,t),r=_s(Nn.l,js.l,t);return this.setHSL(n,i,r),this}setFromVector3(e){return this.r=e.x,this.g=e.y,this.b=e.z,this}applyMatrix3(e){const t=this.r,n=this.g,i=this.b,r=e.elements;return this.r=r[0]*t+r[3]*n+r[6]*i,this.g=r[1]*t+r[4]*n+r[7]*i,this.b=r[2]*t+r[5]*n+r[8]*i,this}equals(e){return e.r===this.r&&e.g===this.g&&e.b===this.b}fromArray(e,t=0){return this.r=e[t],this.g=e[t+1],this.b=e[t+2],this}toArray(e=[],t=0){return e[t]=this.r,e[t+1]=this.g,e[t+2]=this.b,e}fromBufferAttribute(e,t){return this.r=e.getX(t),this.g=e.getY(t),this.b=e.getZ(t),this}toJSON(){return this.getHex()}*[Symbol.iterator](){yield this.r,yield this.g,yield this.b}}const Et=new be;be.NAMES=Ql;let Zh=0;class Yt extends qi{constructor(){super(),this.isMaterial=!0,Object.defineProperty(this,"id",{value:Zh++}),this.uuid=tn(),this.name="",this.type="Material",this.blending=ii,this.side=bn,this.vertexColors=!1,this.opacity=1,this.transparent=!1,this.alphaHash=!1,this.blendSrc=Co,this.blendDst=Po,this.blendEquation=ti,this.blendSrcAlpha=null,this.blendDstAlpha=null,this.blendEquationAlpha=null,this.blendColor=new be(0,0,0),this.blendAlpha=0,this.depthFunc=zi,this.depthTest=!0,this.depthWrite=!0,this.stencilWriteMask=255,this.stencilFunc=Ac,this.stencilRef=0,this.stencilFuncMask=255,this.stencilFail=Ai,this.stencilZFail=Ai,this.stencilZPass=Ai,this.stencilWrite=!1,this.clippingPlanes=null,this.clipIntersection=!1,this.clipShadows=!1,this.shadowSide=null,this.colorWrite=!0,this.precision=null,this.polygonOffset=!1,this.polygonOffsetFactor=0,this.polygonOffsetUnits=0,this.dithering=!1,this.alphaToCoverage=!1,this.premultipliedAlpha=!1,this.forceSinglePass=!1,this.allowOverride=!0,this.visible=!0,this.toneMapped=!0,this.userData={},this.version=0,this._alphaTest=0}get alphaTest(){return this._alphaTest}set alphaTest(e){this._alphaTest>0!=e>0&&this.version++,this._alphaTest=e}onBeforeRender(){}onBeforeCompile(){}customProgramCacheKey(){return this.onBeforeCompile.toString()}setValues(e){if(e!==void 0)for(const t in e){const n=e[t];if(n===void 0){console.warn(`THREE.Material: parameter '${t}' has value of undefined.`);continue}const i=this[t];if(i===void 0){console.warn(`THREE.Material: '${t}' is not a property of THREE.${this.type}.`);continue}i&&i.isColor?i.set(n):i&&i.isVector3&&n&&n.isVector3?i.copy(n):this[t]=n}}toJSON(e){const t=e===void 0||typeof e=="string";t&&(e={textures:{},images:{}});const n={metadata:{version:4.7,type:"Material",generator:"Material.toJSON"}};n.uuid=this.uuid,n.type=this.type,this.name!==""&&(n.name=this.name),this.color&&this.color.isColor&&(n.color=this.color.getHex()),this.roughness!==void 0&&(n.roughness=this.roughness),this.metalness!==void 0&&(n.metalness=this.metalness),this.sheen!==void 0&&(n.sheen=this.sheen),this.sheenColor&&this.sheenColor.isColor&&(n.sheenColor=this.sheenColor.getHex()),this.sheenRoughness!==void 0&&(n.sheenRoughness=this.sheenRoughness),this.emissive&&this.emissive.isColor&&(n.emissive=this.emissive.getHex()),this.emissiveIntensity!==void 0&&this.emissiveIntensity!==1&&(n.emissiveIntensity=this.emissiveIntensity),this.specular&&this.specular.isColor&&(n.specular=this.specular.getHex()),this.specularIntensity!==void 0&&(n.specularIntensity=this.specularIntensity),this.specularColor&&this.specularColor.isColor&&(n.specularColor=this.specularColor.getHex()),this.shininess!==void 0&&(n.shininess=this.shininess),this.clearcoat!==void 0&&(n.clearcoat=this.clearcoat),this.clearcoatRoughness!==void 0&&(n.clearcoatRoughness=this.clearcoatRoughness),this.clearcoatMap&&this.clearcoatMap.isTexture&&(n.clearcoatMap=this.clearcoatMap.toJSON(e).uuid),this.clearcoatRoughnessMap&&this.clearcoatRoughnessMap.isTexture&&(n.clearcoatRoughnessMap=this.clearcoatRoughnessMap.toJSON(e).uuid),this.clearcoatNormalMap&&this.clearcoatNormalMap.isTexture&&(n.clearcoatNormalMap=this.clearcoatNormalMap.toJSON(e).uuid,n.clearcoatNormalScale=this.clearcoatNormalScale.toArray()),this.sheenColorMap&&this.sheenColorMap.isTexture&&(n.sheenColorMap=this.sheenColorMap.toJSON(e).uuid),this.sheenRoughnessMap&&this.sheenRoughnessMap.isTexture&&(n.sheenRoughnessMap=this.sheenRoughnessMap.toJSON(e).uuid),this.dispersion!==void 0&&(n.dispersion=this.dispersion),this.iridescence!==void 0&&(n.iridescence=this.iridescence),this.iridescenceIOR!==void 0&&(n.iridescenceIOR=this.iridescenceIOR),this.iridescenceThicknessRange!==void 0&&(n.iridescenceThicknessRange=this.iridescenceThicknessRange),this.iridescenceMap&&this.iridescenceMap.isTexture&&(n.iridescenceMap=this.iridescenceMap.toJSON(e).uuid),this.iridescenceThicknessMap&&this.iridescenceThicknessMap.isTexture&&(n.iridescenceThicknessMap=this.iridescenceThicknessMap.toJSON(e).uuid),this.anisotropy!==void 0&&(n.anisotropy=this.anisotropy),this.anisotropyRotation!==void 0&&(n.anisotropyRotation=this.anisotropyRotation),this.anisotropyMap&&this.anisotropyMap.isTexture&&(n.anisotropyMap=this.anisotropyMap.toJSON(e).uuid),this.map&&this.map.isTexture&&(n.map=this.map.toJSON(e).uuid),this.matcap&&this.matcap.isTexture&&(n.matcap=this.matcap.toJSON(e).uuid),this.alphaMap&&this.alphaMap.isTexture&&(n.alphaMap=this.alphaMap.toJSON(e).uuid),this.lightMap&&this.lightMap.isTexture&&(n.lightMap=this.lightMap.toJSON(e).uuid,n.lightMapIntensity=this.lightMapIntensity),this.aoMap&&this.aoMap.isTexture&&(n.aoMap=this.aoMap.toJSON(e).uuid,n.aoMapIntensity=this.aoMapIntensity),this.bumpMap&&this.bumpMap.isTexture&&(n.bumpMap=this.bumpMap.toJSON(e).uuid,n.bumpScale=this.bumpScale),this.normalMap&&this.normalMap.isTexture&&(n.normalMap=this.normalMap.toJSON(e).uuid,n.normalMapType=this.normalMapType,n.normalScale=this.normalScale.toArray()),this.displacementMap&&this.displacementMap.isTexture&&(n.displacementMap=this.displacementMap.toJSON(e).uuid,n.displacementScale=this.displacementScale,n.displacementBias=this.displacementBias),this.roughnessMap&&this.roughnessMap.isTexture&&(n.roughnessMap=this.roughnessMap.toJSON(e).uuid),this.metalnessMap&&this.metalnessMap.isTexture&&(n.metalnessMap=this.metalnessMap.toJSON(e).uuid),this.emissiveMap&&this.emissiveMap.isTexture&&(n.emissiveMap=this.emissiveMap.toJSON(e).uuid),this.specularMap&&this.specularMap.isTexture&&(n.specularMap=this.specularMap.toJSON(e).uuid),this.specularIntensityMap&&this.specularIntensityMap.isTexture&&(n.specularIntensityMap=this.specularIntensityMap.toJSON(e).uuid),this.specularColorMap&&this.specularColorMap.isTexture&&(n.specularColorMap=this.specularColorMap.toJSON(e).uuid),this.envMap&&this.envMap.isTexture&&(n.envMap=this.envMap.toJSON(e).uuid,this.combine!==void 0&&(n.combine=this.combine)),this.envMapRotation!==void 0&&(n.envMapRotation=this.envMapRotation.toArray()),this.envMapIntensity!==void 0&&(n.envMapIntensity=this.envMapIntensity),this.reflectivity!==void 0&&(n.reflectivity=this.reflectivity),this.refractionRatio!==void 0&&(n.refractionRatio=this.refractionRatio),this.gradientMap&&this.gradientMap.isTexture&&(n.gradientMap=this.gradientMap.toJSON(e).uuid),this.transmission!==void 0&&(n.transmission=this.transmission),this.transmissionMap&&this.transmissionMap.isTexture&&(n.transmissionMap=this.transmissionMap.toJSON(e).uuid),this.thickness!==void 0&&(n.thickness=this.thickness),this.thicknessMap&&this.thicknessMap.isTexture&&(n.thicknessMap=this.thicknessMap.toJSON(e).uuid),this.attenuationDistance!==void 0&&this.attenuationDistance!==1/0&&(n.attenuationDistance=this.attenuationDistance),this.attenuationColor!==void 0&&(n.attenuationColor=this.attenuationColor.getHex()),this.size!==void 0&&(n.size=this.size),this.shadowSide!==null&&(n.shadowSide=this.shadowSide),this.sizeAttenuation!==void 0&&(n.sizeAttenuation=this.sizeAttenuation),this.blending!==ii&&(n.blending=this.blending),this.side!==bn&&(n.side=this.side),this.vertexColors===!0&&(n.vertexColors=!0),this.opacity<1&&(n.opacity=this.opacity),this.transparent===!0&&(n.transparent=!0),this.blendSrc!==Co&&(n.blendSrc=this.blendSrc),this.blendDst!==Po&&(n.blendDst=this.blendDst),this.blendEquation!==ti&&(n.blendEquation=this.blendEquation),this.blendSrcAlpha!==null&&(n.blendSrcAlpha=this.blendSrcAlpha),this.blendDstAlpha!==null&&(n.blendDstAlpha=this.blendDstAlpha),this.blendEquationAlpha!==null&&(n.blendEquationAlpha=this.blendEquationAlpha),this.blendColor&&this.blendColor.isColor&&(n.blendColor=this.blendColor.getHex()),this.blendAlpha!==0&&(n.blendAlpha=this.blendAlpha),this.depthFunc!==zi&&(n.depthFunc=this.depthFunc),this.depthTest===!1&&(n.depthTest=this.depthTest),this.depthWrite===!1&&(n.depthWrite=this.depthWrite),this.colorWrite===!1&&(n.colorWrite=this.colorWrite),this.stencilWriteMask!==255&&(n.stencilWriteMask=this.stencilWriteMask),this.stencilFunc!==Ac&&(n.stencilFunc=this.stencilFunc),this.stencilRef!==0&&(n.stencilRef=this.stencilRef),this.stencilFuncMask!==255&&(n.stencilFuncMask=this.stencilFuncMask),this.stencilFail!==Ai&&(n.stencilFail=this.stencilFail),this.stencilZFail!==Ai&&(n.stencilZFail=this.stencilZFail),this.stencilZPass!==Ai&&(n.stencilZPass=this.stencilZPass),this.stencilWrite===!0&&(n.stencilWrite=this.stencilWrite),this.rotation!==void 0&&this.rotation!==0&&(n.rotation=this.rotation),this.polygonOffset===!0&&(n.polygonOffset=!0),this.polygonOffsetFactor!==0&&(n.polygonOffsetFactor=this.polygonOffsetFactor),this.polygonOffsetUnits!==0&&(n.polygonOffsetUnits=this.polygonOffsetUnits),this.linewidth!==void 0&&this.linewidth!==1&&(n.linewidth=this.linewidth),this.dashSize!==void 0&&(n.dashSize=this.dashSize),this.gapSize!==void 0&&(n.gapSize=this.gapSize),this.scale!==void 0&&(n.scale=this.scale),this.dithering===!0&&(n.dithering=!0),this.alphaTest>0&&(n.alphaTest=this.alphaTest),this.alphaHash===!0&&(n.alphaHash=!0),this.alphaToCoverage===!0&&(n.alphaToCoverage=!0),this.premultipliedAlpha===!0&&(n.premultipliedAlpha=!0),this.forceSinglePass===!0&&(n.forceSinglePass=!0),this.wireframe===!0&&(n.wireframe=!0),this.wireframeLinewidth>1&&(n.wireframeLinewidth=this.wireframeLinewidth),this.wireframeLinecap!=="round"&&(n.wireframeLinecap=this.wireframeLinecap),this.wireframeLinejoin!=="round"&&(n.wireframeLinejoin=this.wireframeLinejoin),this.flatShading===!0&&(n.flatShading=!0),this.visible===!1&&(n.visible=!1),this.toneMapped===!1&&(n.toneMapped=!1),this.fog===!1&&(n.fog=!1),Object.keys(this.userData).length>0&&(n.userData=this.userData);function i(r){const o=[];for(const a in r){const c=r[a];delete c.metadata,o.push(c)}return o}if(t){const r=i(e.textures),o=i(e.images);r.length>0&&(n.textures=r),o.length>0&&(n.images=o)}return n}clone(){return new this.constructor().copy(this)}copy(e){this.name=e.name,this.blending=e.blending,this.side=e.side,this.vertexColors=e.vertexColors,this.opacity=e.opacity,this.transparent=e.transparent,this.blendSrc=e.blendSrc,this.blendDst=e.blendDst,this.blendEquation=e.blendEquation,this.blendSrcAlpha=e.blendSrcAlpha,this.blendDstAlpha=e.blendDstAlpha,this.blendEquationAlpha=e.blendEquationAlpha,this.blendColor.copy(e.blendColor),this.blendAlpha=e.blendAlpha,this.depthFunc=e.depthFunc,this.depthTest=e.depthTest,this.depthWrite=e.depthWrite,this.stencilWriteMask=e.stencilWriteMask,this.stencilFunc=e.stencilFunc,this.stencilRef=e.stencilRef,this.stencilFuncMask=e.stencilFuncMask,this.stencilFail=e.stencilFail,this.stencilZFail=e.stencilZFail,this.stencilZPass=e.stencilZPass,this.stencilWrite=e.stencilWrite;const t=e.clippingPlanes;let n=null;if(t!==null){const i=t.length;n=new Array(i);for(let r=0;r!==i;++r)n[r]=t[r].clone()}return this.clippingPlanes=n,this.clipIntersection=e.clipIntersection,this.clipShadows=e.clipShadows,this.shadowSide=e.shadowSide,this.colorWrite=e.colorWrite,this.precision=e.precision,this.polygonOffset=e.polygonOffset,this.polygonOffsetFactor=e.polygonOffsetFactor,this.polygonOffsetUnits=e.polygonOffsetUnits,this.dithering=e.dithering,this.alphaTest=e.alphaTest,this.alphaHash=e.alphaHash,this.alphaToCoverage=e.alphaToCoverage,this.premultipliedAlpha=e.premultipliedAlpha,this.forceSinglePass=e.forceSinglePass,this.visible=e.visible,this.toneMapped=e.toneMapped,this.userData=JSON.parse(JSON.stringify(e.userData)),this}dispose(){this.dispatchEvent({type:"dispose"})}set needsUpdate(e){e===!0&&this.version++}}class Ht extends Yt{constructor(e){super(),this.isMeshBasicMaterial=!0,this.type="MeshBasicMaterial",this.color=new be(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new sn,this.combine=Sa,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.fog=e.fog,this}}const At=new R,Qs=new fe;let $h=0;class vt{constructor(e,t,n=!1){if(Array.isArray(e))throw new TypeError("THREE.BufferAttribute: array should be a Typed Array.");this.isBufferAttribute=!0,Object.defineProperty(this,"id",{value:$h++}),this.name="",this.array=e,this.itemSize=t,this.count=e!==void 0?e.length/t:0,this.normalized=n,this.usage=Aa,this.updateRanges=[],this.gpuType=en,this.version=0}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.name=e.name,this.array=new e.array.constructor(e.array),this.itemSize=e.itemSize,this.count=e.count,this.normalized=e.normalized,this.usage=e.usage,this.gpuType=e.gpuType,this}copyAt(e,t,n){e*=this.itemSize,n*=t.itemSize;for(let i=0,r=this.itemSize;i<r;i++)this.array[e+i]=t.array[n+i];return this}copyArray(e){return this.array.set(e),this}applyMatrix3(e){if(this.itemSize===2)for(let t=0,n=this.count;t<n;t++)Qs.fromBufferAttribute(this,t),Qs.applyMatrix3(e),this.setXY(t,Qs.x,Qs.y);else if(this.itemSize===3)for(let t=0,n=this.count;t<n;t++)At.fromBufferAttribute(this,t),At.applyMatrix3(e),this.setXYZ(t,At.x,At.y,At.z);return this}applyMatrix4(e){for(let t=0,n=this.count;t<n;t++)At.fromBufferAttribute(this,t),At.applyMatrix4(e),this.setXYZ(t,At.x,At.y,At.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)At.fromBufferAttribute(this,t),At.applyNormalMatrix(e),this.setXYZ(t,At.x,At.y,At.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)At.fromBufferAttribute(this,t),At.transformDirection(e),this.setXYZ(t,At.x,At.y,At.z);return this}set(e,t=0){return this.array.set(e,t),this}getComponent(e,t){let n=this.array[e*this.itemSize+t];return this.normalized&&(n=$t(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Ze(n,this.array)),this.array[e*this.itemSize+t]=n,this}getX(e){let t=this.array[e*this.itemSize];return this.normalized&&(t=$t(t,this.array)),t}setX(e,t){return this.normalized&&(t=Ze(t,this.array)),this.array[e*this.itemSize]=t,this}getY(e){let t=this.array[e*this.itemSize+1];return this.normalized&&(t=$t(t,this.array)),t}setY(e,t){return this.normalized&&(t=Ze(t,this.array)),this.array[e*this.itemSize+1]=t,this}getZ(e){let t=this.array[e*this.itemSize+2];return this.normalized&&(t=$t(t,this.array)),t}setZ(e,t){return this.normalized&&(t=Ze(t,this.array)),this.array[e*this.itemSize+2]=t,this}getW(e){let t=this.array[e*this.itemSize+3];return this.normalized&&(t=$t(t,this.array)),t}setW(e,t){return this.normalized&&(t=Ze(t,this.array)),this.array[e*this.itemSize+3]=t,this}setXY(e,t,n){return e*=this.itemSize,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array)),this.array[e+0]=t,this.array[e+1]=n,this}setXYZ(e,t,n,i){return e*=this.itemSize,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array),i=Ze(i,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this}setXYZW(e,t,n,i,r){return e*=this.itemSize,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array),i=Ze(i,this.array),r=Ze(r,this.array)),this.array[e+0]=t,this.array[e+1]=n,this.array[e+2]=i,this.array[e+3]=r,this}onUpload(e){return this.onUploadCallback=e,this}clone(){return new this.constructor(this.array,this.itemSize).copy(this)}toJSON(){const e={itemSize:this.itemSize,type:this.array.constructor.name,array:Array.from(this.array),normalized:this.normalized};return this.name!==""&&(e.name=this.name),this.usage!==Aa&&(e.usage=this.usage),e}}class Kl extends vt{constructor(e,t,n){super(new Uint16Array(e),t,n)}}class Yl extends vt{constructor(e,t,n){super(new Uint32Array(e),t,n)}}class ft extends vt{constructor(e,t,n){super(new Float32Array(e),t,n)}}let ed=0;const Xt=new Ne,to=new ot,Ti=new R,kt=new nn,os=new nn,Mt=new R;class St extends qi{constructor(){super(),this.isBufferGeometry=!0,Object.defineProperty(this,"id",{value:ed++}),this.uuid=tn(),this.name="",this.type="BufferGeometry",this.index=null,this.indirect=null,this.attributes={},this.morphAttributes={},this.morphTargetsRelative=!1,this.groups=[],this.boundingBox=null,this.boundingSphere=null,this.drawRange={start:0,count:1/0},this.userData={}}getIndex(){return this.index}setIndex(e){return Array.isArray(e)?this.index=new(Wl(e)?Yl:Kl)(e,1):this.index=e,this}setIndirect(e){return this.indirect=e,this}getIndirect(){return this.indirect}getAttribute(e){return this.attributes[e]}setAttribute(e,t){return this.attributes[e]=t,this}deleteAttribute(e){return delete this.attributes[e],this}hasAttribute(e){return this.attributes[e]!==void 0}addGroup(e,t,n=0){this.groups.push({start:e,count:t,materialIndex:n})}clearGroups(){this.groups=[]}setDrawRange(e,t){this.drawRange.start=e,this.drawRange.count=t}applyMatrix4(e){const t=this.attributes.position;t!==void 0&&(t.applyMatrix4(e),t.needsUpdate=!0);const n=this.attributes.normal;if(n!==void 0){const r=new ke().getNormalMatrix(e);n.applyNormalMatrix(r),n.needsUpdate=!0}const i=this.attributes.tangent;return i!==void 0&&(i.transformDirection(e),i.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}applyQuaternion(e){return Xt.makeRotationFromQuaternion(e),this.applyMatrix4(Xt),this}rotateX(e){return Xt.makeRotationX(e),this.applyMatrix4(Xt),this}rotateY(e){return Xt.makeRotationY(e),this.applyMatrix4(Xt),this}rotateZ(e){return Xt.makeRotationZ(e),this.applyMatrix4(Xt),this}translate(e,t,n){return Xt.makeTranslation(e,t,n),this.applyMatrix4(Xt),this}scale(e,t,n){return Xt.makeScale(e,t,n),this.applyMatrix4(Xt),this}lookAt(e){return to.lookAt(e),to.updateMatrix(),this.applyMatrix4(to.matrix),this}center(){return this.computeBoundingBox(),this.boundingBox.getCenter(Ti).negate(),this.translate(Ti.x,Ti.y,Ti.z),this}setFromPoints(e){const t=this.getAttribute("position");if(t===void 0){const n=[];for(let i=0,r=e.length;i<r;i++){const o=e[i];n.push(o.x,o.y,o.z||0)}this.setAttribute("position",new ft(n,3))}else{const n=Math.min(e.length,t.count);for(let i=0;i<n;i++){const r=e[i];t.setXYZ(i,r.x,r.y,r.z||0)}e.length>t.count&&console.warn("THREE.BufferGeometry: Buffer size too small for points data. Use .dispose() and create a new geometry."),t.needsUpdate=!0}return this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new nn);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingBox(): GLBufferAttribute requires a manual bounding box.",this),this.boundingBox.set(new R(-1/0,-1/0,-1/0),new R(1/0,1/0,1/0));return}if(e!==void 0){if(this.boundingBox.setFromBufferAttribute(e),t)for(let n=0,i=t.length;n<i;n++){const r=t[n];kt.setFromBufferAttribute(r),this.morphTargetsRelative?(Mt.addVectors(this.boundingBox.min,kt.min),this.boundingBox.expandByPoint(Mt),Mt.addVectors(this.boundingBox.max,kt.max),this.boundingBox.expandByPoint(Mt)):(this.boundingBox.expandByPoint(kt.min),this.boundingBox.expandByPoint(kt.max))}}else this.boundingBox.makeEmpty();(isNaN(this.boundingBox.min.x)||isNaN(this.boundingBox.min.y)||isNaN(this.boundingBox.min.z))&&console.error('THREE.BufferGeometry.computeBoundingBox(): Computed min/max have NaN values. The "position" attribute is likely to have NaN values.',this)}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new An);const e=this.attributes.position,t=this.morphAttributes.position;if(e&&e.isGLBufferAttribute){console.error("THREE.BufferGeometry.computeBoundingSphere(): GLBufferAttribute requires a manual bounding sphere.",this),this.boundingSphere.set(new R,1/0);return}if(e){const n=this.boundingSphere.center;if(kt.setFromBufferAttribute(e),t)for(let r=0,o=t.length;r<o;r++){const a=t[r];os.setFromBufferAttribute(a),this.morphTargetsRelative?(Mt.addVectors(kt.min,os.min),kt.expandByPoint(Mt),Mt.addVectors(kt.max,os.max),kt.expandByPoint(Mt)):(kt.expandByPoint(os.min),kt.expandByPoint(os.max))}kt.getCenter(n);let i=0;for(let r=0,o=e.count;r<o;r++)Mt.fromBufferAttribute(e,r),i=Math.max(i,n.distanceToSquared(Mt));if(t)for(let r=0,o=t.length;r<o;r++){const a=t[r],c=this.morphTargetsRelative;for(let l=0,u=a.count;l<u;l++)Mt.fromBufferAttribute(a,l),c&&(Ti.fromBufferAttribute(e,l),Mt.add(Ti)),i=Math.max(i,n.distanceToSquared(Mt))}this.boundingSphere.radius=Math.sqrt(i),isNaN(this.boundingSphere.radius)&&console.error('THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values.',this)}}computeTangents(){const e=this.index,t=this.attributes;if(e===null||t.position===void 0||t.normal===void 0||t.uv===void 0){console.error("THREE.BufferGeometry: .computeTangents() failed. Missing required attributes (index, position, normal or uv)");return}const n=t.position,i=t.normal,r=t.uv;this.hasAttribute("tangent")===!1&&this.setAttribute("tangent",new vt(new Float32Array(4*n.count),4));const o=this.getAttribute("tangent"),a=[],c=[];for(let P=0;P<n.count;P++)a[P]=new R,c[P]=new R;const l=new R,u=new R,h=new R,d=new fe,f=new fe,m=new fe,g=new R,p=new R;function A(P,x,M){l.fromBufferAttribute(n,P),u.fromBufferAttribute(n,x),h.fromBufferAttribute(n,M),d.fromBufferAttribute(r,P),f.fromBufferAttribute(r,x),m.fromBufferAttribute(r,M),u.sub(l),h.sub(l),f.sub(d),m.sub(d);const I=1/(f.x*m.y-m.x*f.y);isFinite(I)&&(g.copy(u).multiplyScalar(m.y).addScaledVector(h,-f.y).multiplyScalar(I),p.copy(h).multiplyScalar(f.x).addScaledVector(u,-m.x).multiplyScalar(I),a[P].add(g),a[x].add(g),a[M].add(g),c[P].add(p),c[x].add(p),c[M].add(p))}let T=this.groups;T.length===0&&(T=[{start:0,count:e.count}]);for(let P=0,x=T.length;P<x;++P){const M=T[P],I=M.start,F=M.count;for(let z=I,G=I+F;z<G;z+=3)A(e.getX(z+0),e.getX(z+1),e.getX(z+2))}const y=new R,v=new R,w=new R,E=new R;function C(P){w.fromBufferAttribute(i,P),E.copy(w);const x=a[P];y.copy(x),y.sub(w.multiplyScalar(w.dot(x))).normalize(),v.crossVectors(E,x);const I=v.dot(c[P])<0?-1:1;o.setXYZW(P,y.x,y.y,y.z,I)}for(let P=0,x=T.length;P<x;++P){const M=T[P],I=M.start,F=M.count;for(let z=I,G=I+F;z<G;z+=3)C(e.getX(z+0)),C(e.getX(z+1)),C(e.getX(z+2))}}computeVertexNormals(){const e=this.index,t=this.getAttribute("position");if(t!==void 0){let n=this.getAttribute("normal");if(n===void 0)n=new vt(new Float32Array(t.count*3),3),this.setAttribute("normal",n);else for(let d=0,f=n.count;d<f;d++)n.setXYZ(d,0,0,0);const i=new R,r=new R,o=new R,a=new R,c=new R,l=new R,u=new R,h=new R;if(e)for(let d=0,f=e.count;d<f;d+=3){const m=e.getX(d+0),g=e.getX(d+1),p=e.getX(d+2);i.fromBufferAttribute(t,m),r.fromBufferAttribute(t,g),o.fromBufferAttribute(t,p),u.subVectors(o,r),h.subVectors(i,r),u.cross(h),a.fromBufferAttribute(n,m),c.fromBufferAttribute(n,g),l.fromBufferAttribute(n,p),a.add(u),c.add(u),l.add(u),n.setXYZ(m,a.x,a.y,a.z),n.setXYZ(g,c.x,c.y,c.z),n.setXYZ(p,l.x,l.y,l.z)}else for(let d=0,f=t.count;d<f;d+=3)i.fromBufferAttribute(t,d+0),r.fromBufferAttribute(t,d+1),o.fromBufferAttribute(t,d+2),u.subVectors(o,r),h.subVectors(i,r),u.cross(h),n.setXYZ(d+0,u.x,u.y,u.z),n.setXYZ(d+1,u.x,u.y,u.z),n.setXYZ(d+2,u.x,u.y,u.z);this.normalizeNormals(),n.needsUpdate=!0}}normalizeNormals(){const e=this.attributes.normal;for(let t=0,n=e.count;t<n;t++)Mt.fromBufferAttribute(e,t),Mt.normalize(),e.setXYZ(t,Mt.x,Mt.y,Mt.z)}toNonIndexed(){function e(a,c){const l=a.array,u=a.itemSize,h=a.normalized,d=new l.constructor(c.length*u);let f=0,m=0;for(let g=0,p=c.length;g<p;g++){a.isInterleavedBufferAttribute?f=c[g]*a.data.stride+a.offset:f=c[g]*u;for(let A=0;A<u;A++)d[m++]=l[f++]}return new vt(d,u,h)}if(this.index===null)return console.warn("THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed."),this;const t=new St,n=this.index.array,i=this.attributes;for(const a in i){const c=i[a],l=e(c,n);t.setAttribute(a,l)}const r=this.morphAttributes;for(const a in r){const c=[],l=r[a];for(let u=0,h=l.length;u<h;u++){const d=l[u],f=e(d,n);c.push(f)}t.morphAttributes[a]=c}t.morphTargetsRelative=this.morphTargetsRelative;const o=this.groups;for(let a=0,c=o.length;a<c;a++){const l=o[a];t.addGroup(l.start,l.count,l.materialIndex)}return t}toJSON(){const e={metadata:{version:4.7,type:"BufferGeometry",generator:"BufferGeometry.toJSON"}};if(e.uuid=this.uuid,e.type=this.type,this.name!==""&&(e.name=this.name),Object.keys(this.userData).length>0&&(e.userData=this.userData),this.parameters!==void 0){const c=this.parameters;for(const l in c)c[l]!==void 0&&(e[l]=c[l]);return e}e.data={attributes:{}};const t=this.index;t!==null&&(e.data.index={type:t.array.constructor.name,array:Array.prototype.slice.call(t.array)});const n=this.attributes;for(const c in n){const l=n[c];e.data.attributes[c]=l.toJSON(e.data)}const i={};let r=!1;for(const c in this.morphAttributes){const l=this.morphAttributes[c],u=[];for(let h=0,d=l.length;h<d;h++){const f=l[h];u.push(f.toJSON(e.data))}u.length>0&&(i[c]=u,r=!0)}r&&(e.data.morphAttributes=i,e.data.morphTargetsRelative=this.morphTargetsRelative);const o=this.groups;o.length>0&&(e.data.groups=JSON.parse(JSON.stringify(o)));const a=this.boundingSphere;return a!==null&&(e.data.boundingSphere=a.toJSON()),e}clone(){return new this.constructor().copy(this)}copy(e){this.index=null,this.attributes={},this.morphAttributes={},this.groups=[],this.boundingBox=null,this.boundingSphere=null;const t={};this.name=e.name;const n=e.index;n!==null&&this.setIndex(n.clone());const i=e.attributes;for(const l in i){const u=i[l];this.setAttribute(l,u.clone(t))}const r=e.morphAttributes;for(const l in r){const u=[],h=r[l];for(let d=0,f=h.length;d<f;d++)u.push(h[d].clone(t));this.morphAttributes[l]=u}this.morphTargetsRelative=e.morphTargetsRelative;const o=e.groups;for(let l=0,u=o.length;l<u;l++){const h=o[l];this.addGroup(h.start,h.count,h.materialIndex)}const a=e.boundingBox;a!==null&&(this.boundingBox=a.clone());const c=e.boundingSphere;return c!==null&&(this.boundingSphere=c.clone()),this.drawRange.start=e.drawRange.start,this.drawRange.count=e.drawRange.count,this.userData=e.userData,this}dispose(){this.dispatchEvent({type:"dispose"})}}const Pc=new Ne,Kn=new Pr,Ks=new An,Rc=new R,Ys=new R,qs=new R,Js=new R,no=new R,Zs=new R,Dc=new R,$s=new R;class Qe extends ot{constructor(e=new St,t=new Ht){super(),this.isMesh=!0,this.type="Mesh",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.count=1,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),e.morphTargetInfluences!==void 0&&(this.morphTargetInfluences=e.morphTargetInfluences.slice()),e.morphTargetDictionary!==void 0&&(this.morphTargetDictionary=Object.assign({},e.morphTargetDictionary)),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=i.length;r<o;r++){const a=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}getVertexPosition(e,t){const n=this.geometry,i=n.attributes.position,r=n.morphAttributes.position,o=n.morphTargetsRelative;t.fromBufferAttribute(i,e);const a=this.morphTargetInfluences;if(r&&a){Zs.set(0,0,0);for(let c=0,l=r.length;c<l;c++){const u=a[c],h=r[c];u!==0&&(no.fromBufferAttribute(h,e),o?Zs.addScaledVector(no,u):Zs.addScaledVector(no.sub(t),u))}t.add(Zs)}return t}raycast(e,t){const n=this.geometry,i=this.material,r=this.matrixWorld;i!==void 0&&(n.boundingSphere===null&&n.computeBoundingSphere(),Ks.copy(n.boundingSphere),Ks.applyMatrix4(r),Kn.copy(e.ray).recast(e.near),!(Ks.containsPoint(Kn.origin)===!1&&(Kn.intersectSphere(Ks,Rc)===null||Kn.origin.distanceToSquared(Rc)>(e.far-e.near)**2))&&(Pc.copy(r).invert(),Kn.copy(e.ray).applyMatrix4(Pc),!(n.boundingBox!==null&&Kn.intersectsBox(n.boundingBox)===!1)&&this._computeIntersections(e,t,Kn)))}_computeIntersections(e,t,n){let i;const r=this.geometry,o=this.material,a=r.index,c=r.attributes.position,l=r.attributes.uv,u=r.attributes.uv1,h=r.attributes.normal,d=r.groups,f=r.drawRange;if(a!==null)if(Array.isArray(o))for(let m=0,g=d.length;m<g;m++){const p=d[m],A=o[p.materialIndex],T=Math.max(p.start,f.start),y=Math.min(a.count,Math.min(p.start+p.count,f.start+f.count));for(let v=T,w=y;v<w;v+=3){const E=a.getX(v),C=a.getX(v+1),P=a.getX(v+2);i=er(this,A,e,n,l,u,h,E,C,P),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=p.materialIndex,t.push(i))}}else{const m=Math.max(0,f.start),g=Math.min(a.count,f.start+f.count);for(let p=m,A=g;p<A;p+=3){const T=a.getX(p),y=a.getX(p+1),v=a.getX(p+2);i=er(this,o,e,n,l,u,h,T,y,v),i&&(i.faceIndex=Math.floor(p/3),t.push(i))}}else if(c!==void 0)if(Array.isArray(o))for(let m=0,g=d.length;m<g;m++){const p=d[m],A=o[p.materialIndex],T=Math.max(p.start,f.start),y=Math.min(c.count,Math.min(p.start+p.count,f.start+f.count));for(let v=T,w=y;v<w;v+=3){const E=v,C=v+1,P=v+2;i=er(this,A,e,n,l,u,h,E,C,P),i&&(i.faceIndex=Math.floor(v/3),i.face.materialIndex=p.materialIndex,t.push(i))}}else{const m=Math.max(0,f.start),g=Math.min(c.count,f.start+f.count);for(let p=m,A=g;p<A;p+=3){const T=p,y=p+1,v=p+2;i=er(this,o,e,n,l,u,h,T,y,v),i&&(i.faceIndex=Math.floor(p/3),t.push(i))}}}}function td(s,e,t,n,i,r,o,a){let c;if(e.side===It?c=n.intersectTriangle(o,r,i,!0,a):c=n.intersectTriangle(i,r,o,e.side===bn,a),c===null)return null;$s.copy(a),$s.applyMatrix4(s.matrixWorld);const l=t.ray.origin.distanceTo($s);return l<t.near||l>t.far?null:{distance:l,point:$s.clone(),object:s}}function er(s,e,t,n,i,r,o,a,c,l){s.getVertexPosition(a,Ys),s.getVertexPosition(c,qs),s.getVertexPosition(l,Js);const u=td(s,e,t,n,Ys,qs,Js,Dc);if(u){const h=new R;Qt.getBarycoord(Dc,Ys,qs,Js,h),i&&(u.uv=Qt.getInterpolatedAttribute(i,a,c,l,h,new fe)),r&&(u.uv1=Qt.getInterpolatedAttribute(r,a,c,l,h,new fe)),o&&(u.normal=Qt.getInterpolatedAttribute(o,a,c,l,h,new R),u.normal.dot(n.direction)>0&&u.normal.multiplyScalar(-1));const d={a,b:c,c:l,normal:new R,materialIndex:0};Qt.getNormal(Ys,qs,Js,d.normal),u.face=d,u.barycoord=h}return u}class rn extends St{constructor(e=1,t=1,n=1,i=1,r=1,o=1){super(),this.type="BoxGeometry",this.parameters={width:e,height:t,depth:n,widthSegments:i,heightSegments:r,depthSegments:o};const a=this;i=Math.floor(i),r=Math.floor(r),o=Math.floor(o);const c=[],l=[],u=[],h=[];let d=0,f=0;m("z","y","x",-1,-1,n,t,e,o,r,0),m("z","y","x",1,-1,n,t,-e,o,r,1),m("x","z","y",1,1,e,n,t,i,o,2),m("x","z","y",1,-1,e,n,-t,i,o,3),m("x","y","z",1,-1,e,t,n,i,r,4),m("x","y","z",-1,-1,e,t,-n,i,r,5),this.setIndex(c),this.setAttribute("position",new ft(l,3)),this.setAttribute("normal",new ft(u,3)),this.setAttribute("uv",new ft(h,2));function m(g,p,A,T,y,v,w,E,C,P,x){const M=v/C,I=w/P,F=v/2,z=w/2,G=E/2,j=C+1,B=P+1;let J=0,W=0;const K=new R;for(let $=0;$<B;$++){const le=$*I-z;for(let De=0;De<j;De++){const Ve=De*M-F;K[g]=Ve*T,K[p]=le*y,K[A]=G,l.push(K.x,K.y,K.z),K[g]=0,K[p]=0,K[A]=E>0?1:-1,u.push(K.x,K.y,K.z),h.push(De/C),h.push(1-$/P),J+=1}}for(let $=0;$<P;$++)for(let le=0;le<C;le++){const De=d+le+j*$,Ve=d+le+j*($+1),Ye=d+(le+1)+j*($+1),ae=d+(le+1)+j*$;c.push(De,Ve,ae),c.push(Ve,Ye,ae),W+=6}a.addGroup(f,W,x),f+=W,d+=J}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new rn(e.width,e.height,e.depth,e.widthSegments,e.heightSegments,e.depthSegments)}}function Vi(s){const e={};for(const t in s){e[t]={};for(const n in s[t]){const i=s[t][n];i&&(i.isColor||i.isMatrix3||i.isMatrix4||i.isVector2||i.isVector3||i.isVector4||i.isTexture||i.isQuaternion)?i.isRenderTargetTexture?(console.warn("UniformsUtils: Textures of render targets cannot be cloned via cloneUniforms() or mergeUniforms()."),e[t][n]=null):e[t][n]=i.clone():Array.isArray(i)?e[t][n]=i.slice():e[t][n]=i}}return e}function Rt(s){const e={};for(let t=0;t<s.length;t++){const n=Vi(s[t]);for(const i in n)e[i]=n[i]}return e}function nd(s){const e=[];for(let t=0;t<s.length;t++)e.push(s[t].clone());return e}function ql(s){const e=s.getRenderTarget();return e===null?s.outputColorSpace:e.isXRRenderTarget===!0?e.texture.colorSpace:je.workingColorSpace}const id={clone:Vi,merge:Rt};var sd=`void main() {
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,rd=`void main() {
	gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );
}`;class Vn extends Yt{constructor(e){super(),this.isShaderMaterial=!0,this.type="ShaderMaterial",this.defines={},this.uniforms={},this.uniformsGroups=[],this.vertexShader=sd,this.fragmentShader=rd,this.linewidth=1,this.wireframe=!1,this.wireframeLinewidth=1,this.fog=!1,this.lights=!1,this.clipping=!1,this.forceSinglePass=!0,this.extensions={clipCullDistance:!1,multiDraw:!1},this.defaultAttributeValues={color:[1,1,1],uv:[0,0],uv1:[0,0]},this.index0AttributeName=void 0,this.uniformsNeedUpdate=!1,this.glslVersion=null,e!==void 0&&this.setValues(e)}copy(e){return super.copy(e),this.fragmentShader=e.fragmentShader,this.vertexShader=e.vertexShader,this.uniforms=Vi(e.uniforms),this.uniformsGroups=nd(e.uniformsGroups),this.defines=Object.assign({},e.defines),this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.fog=e.fog,this.lights=e.lights,this.clipping=e.clipping,this.extensions=Object.assign({},e.extensions),this.glslVersion=e.glslVersion,this}toJSON(e){const t=super.toJSON(e);t.glslVersion=this.glslVersion,t.uniforms={};for(const i in this.uniforms){const o=this.uniforms[i].value;o&&o.isTexture?t.uniforms[i]={type:"t",value:o.toJSON(e).uuid}:o&&o.isColor?t.uniforms[i]={type:"c",value:o.getHex()}:o&&o.isVector2?t.uniforms[i]={type:"v2",value:o.toArray()}:o&&o.isVector3?t.uniforms[i]={type:"v3",value:o.toArray()}:o&&o.isVector4?t.uniforms[i]={type:"v4",value:o.toArray()}:o&&o.isMatrix3?t.uniforms[i]={type:"m3",value:o.toArray()}:o&&o.isMatrix4?t.uniforms[i]={type:"m4",value:o.toArray()}:t.uniforms[i]={value:o}}Object.keys(this.defines).length>0&&(t.defines=this.defines),t.vertexShader=this.vertexShader,t.fragmentShader=this.fragmentShader,t.lights=this.lights,t.clipping=this.clipping;const n={};for(const i in this.extensions)this.extensions[i]===!0&&(n[i]=!0);return Object.keys(n).length>0&&(t.extensions=n),t}}class Jl extends ot{constructor(){super(),this.isCamera=!0,this.type="Camera",this.matrixWorldInverse=new Ne,this.projectionMatrix=new Ne,this.projectionMatrixInverse=new Ne,this.coordinateSystem=hn,this._reversedDepth=!1}get reversedDepth(){return this._reversedDepth}copy(e,t){return super.copy(e,t),this.matrixWorldInverse.copy(e.matrixWorldInverse),this.projectionMatrix.copy(e.projectionMatrix),this.projectionMatrixInverse.copy(e.projectionMatrixInverse),this.coordinateSystem=e.coordinateSystem,this}getWorldDirection(e){return super.getWorldDirection(e).negate()}updateMatrixWorld(e){super.updateMatrixWorld(e),this.matrixWorldInverse.copy(this.matrixWorld).invert()}updateWorldMatrix(e,t){super.updateWorldMatrix(e,t),this.matrixWorldInverse.copy(this.matrixWorld).invert()}clone(){return new this.constructor().copy(this)}}const Fn=new R,Ic=new fe,Lc=new fe;class Dt extends Jl{constructor(e=50,t=1,n=.1,i=2e3){super(),this.isPerspectiveCamera=!0,this.type="PerspectiveCamera",this.fov=e,this.zoom=1,this.near=n,this.far=i,this.focus=10,this.aspect=t,this.view=null,this.filmGauge=35,this.filmOffset=0,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.fov=e.fov,this.zoom=e.zoom,this.near=e.near,this.far=e.far,this.focus=e.focus,this.aspect=e.aspect,this.view=e.view===null?null:Object.assign({},e.view),this.filmGauge=e.filmGauge,this.filmOffset=e.filmOffset,this}setFocalLength(e){const t=.5*this.getFilmHeight()/e;this.fov=Gi*2*Math.atan(t),this.updateProjectionMatrix()}getFocalLength(){const e=Math.tan(vs*.5*this.fov);return .5*this.getFilmHeight()/e}getEffectiveFOV(){return Gi*2*Math.atan(Math.tan(vs*.5*this.fov)/this.zoom)}getFilmWidth(){return this.filmGauge*Math.min(this.aspect,1)}getFilmHeight(){return this.filmGauge/Math.max(this.aspect,1)}getViewBounds(e,t,n){Fn.set(-1,-1,.5).applyMatrix4(this.projectionMatrixInverse),t.set(Fn.x,Fn.y).multiplyScalar(-e/Fn.z),Fn.set(1,1,.5).applyMatrix4(this.projectionMatrixInverse),n.set(Fn.x,Fn.y).multiplyScalar(-e/Fn.z)}getViewSize(e,t){return this.getViewBounds(e,Ic,Lc),t.subVectors(Lc,Ic)}setViewOffset(e,t,n,i,r,o){this.aspect=e/t,this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=this.near;let t=e*Math.tan(vs*.5*this.fov)/this.zoom,n=2*t,i=this.aspect*n,r=-.5*i;const o=this.view;if(this.view!==null&&this.view.enabled){const c=o.fullWidth,l=o.fullHeight;r+=o.offsetX*i/c,t-=o.offsetY*n/l,i*=o.width/c,n*=o.height/l}const a=this.filmOffset;a!==0&&(r+=e*a/this.getFilmWidth()),this.projectionMatrix.makePerspective(r,r+i,t,t-n,e,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.fov=this.fov,t.object.zoom=this.zoom,t.object.near=this.near,t.object.far=this.far,t.object.focus=this.focus,t.object.aspect=this.aspect,this.view!==null&&(t.object.view=Object.assign({},this.view)),t.object.filmGauge=this.filmGauge,t.object.filmOffset=this.filmOffset,t}}const Ei=-90,wi=1;class od extends ot{constructor(e,t,n){super(),this.type="CubeCamera",this.renderTarget=n,this.coordinateSystem=null,this.activeMipmapLevel=0;const i=new Dt(Ei,wi,e,t);i.layers=this.layers,this.add(i);const r=new Dt(Ei,wi,e,t);r.layers=this.layers,this.add(r);const o=new Dt(Ei,wi,e,t);o.layers=this.layers,this.add(o);const a=new Dt(Ei,wi,e,t);a.layers=this.layers,this.add(a);const c=new Dt(Ei,wi,e,t);c.layers=this.layers,this.add(c);const l=new Dt(Ei,wi,e,t);l.layers=this.layers,this.add(l)}updateCoordinateSystem(){const e=this.coordinateSystem,t=this.children.concat(),[n,i,r,o,a,c]=t;for(const l of t)this.remove(l);if(e===hn)n.up.set(0,1,0),n.lookAt(1,0,0),i.up.set(0,1,0),i.lookAt(-1,0,0),r.up.set(0,0,-1),r.lookAt(0,1,0),o.up.set(0,0,1),o.lookAt(0,-1,0),a.up.set(0,1,0),a.lookAt(0,0,1),c.up.set(0,1,0),c.lookAt(0,0,-1);else if(e===Tr)n.up.set(0,-1,0),n.lookAt(-1,0,0),i.up.set(0,-1,0),i.lookAt(1,0,0),r.up.set(0,0,1),r.lookAt(0,1,0),o.up.set(0,0,-1),o.lookAt(0,-1,0),a.up.set(0,-1,0),a.lookAt(0,0,1),c.up.set(0,-1,0),c.lookAt(0,0,-1);else throw new Error("THREE.CubeCamera.updateCoordinateSystem(): Invalid coordinate system: "+e);for(const l of t)this.add(l),l.updateMatrixWorld()}update(e,t){this.parent===null&&this.updateMatrixWorld();const{renderTarget:n,activeMipmapLevel:i}=this;this.coordinateSystem!==e.coordinateSystem&&(this.coordinateSystem=e.coordinateSystem,this.updateCoordinateSystem());const[r,o,a,c,l,u]=this.children,h=e.getRenderTarget(),d=e.getActiveCubeFace(),f=e.getActiveMipmapLevel(),m=e.xr.enabled;e.xr.enabled=!1;const g=n.texture.generateMipmaps;n.texture.generateMipmaps=!1,e.setRenderTarget(n,0,i),e.render(t,r),e.setRenderTarget(n,1,i),e.render(t,o),e.setRenderTarget(n,2,i),e.render(t,a),e.setRenderTarget(n,3,i),e.render(t,c),e.setRenderTarget(n,4,i),e.render(t,l),n.texture.generateMipmaps=g,e.setRenderTarget(n,5,i),e.render(t,u),e.setRenderTarget(h,d,f),e.xr.enabled=m,n.texture.needsPMREMUpdate=!0}}class Zl extends gt{constructor(e=[],t=ki,n,i,r,o,a,c,l,u){super(e,t,n,i,r,o,a,c,l,u),this.isCubeTexture=!0,this.flipY=!1}get images(){return this.image}set images(e){this.image=e}}class ad extends Gn{constructor(e=1,t={}){super(e,e,t),this.isWebGLCubeRenderTarget=!0;const n={width:e,height:e,depth:1},i=[n,n,n,n,n,n];this.texture=new Zl(i),this._setTextureOptions(t),this.texture.isRenderTargetTexture=!0}fromEquirectangularTexture(e,t){this.texture.type=t.type,this.texture.colorSpace=t.colorSpace,this.texture.generateMipmaps=t.generateMipmaps,this.texture.minFilter=t.minFilter,this.texture.magFilter=t.magFilter;const n={uniforms:{tEquirect:{value:null}},vertexShader:`

				varying vec3 vWorldDirection;

				vec3 transformDirection( in vec3 dir, in mat4 matrix ) {

					return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );

				}

				void main() {

					vWorldDirection = transformDirection( position, modelMatrix );

					#include <begin_vertex>
					#include <project_vertex>

				}
			`,fragmentShader:`

				uniform sampler2D tEquirect;

				varying vec3 vWorldDirection;

				#include <common>

				void main() {

					vec3 direction = normalize( vWorldDirection );

					vec2 sampleUV = equirectUv( direction );

					gl_FragColor = texture2D( tEquirect, sampleUV );

				}
			`},i=new rn(5,5,5),r=new Vn({name:"CubemapFromEquirect",uniforms:Vi(n.uniforms),vertexShader:n.vertexShader,fragmentShader:n.fragmentShader,side:It,blending:kn});r.uniforms.tEquirect.value=t;const o=new Qe(i,r),a=t.minFilter;return t.minFilter===Tn&&(t.minFilter=Nt),new od(1,10,this).update(e,o),t.minFilter=a,o.geometry.dispose(),o.material.dispose(),this}clear(e,t=!0,n=!0,i=!0){const r=e.getRenderTarget();for(let o=0;o<6;o++)e.setRenderTarget(this,o),e.clear(t,n,i);e.setRenderTarget(r)}}class Ft extends ot{constructor(){super(),this.isGroup=!0,this.type="Group"}}const cd={type:"move"};class io{constructor(){this._targetRay=null,this._grip=null,this._hand=null}getHandSpace(){return this._hand===null&&(this._hand=new Ft,this._hand.matrixAutoUpdate=!1,this._hand.visible=!1,this._hand.joints={},this._hand.inputState={pinching:!1}),this._hand}getTargetRaySpace(){return this._targetRay===null&&(this._targetRay=new Ft,this._targetRay.matrixAutoUpdate=!1,this._targetRay.visible=!1,this._targetRay.hasLinearVelocity=!1,this._targetRay.linearVelocity=new R,this._targetRay.hasAngularVelocity=!1,this._targetRay.angularVelocity=new R),this._targetRay}getGripSpace(){return this._grip===null&&(this._grip=new Ft,this._grip.matrixAutoUpdate=!1,this._grip.visible=!1,this._grip.hasLinearVelocity=!1,this._grip.linearVelocity=new R,this._grip.hasAngularVelocity=!1,this._grip.angularVelocity=new R),this._grip}dispatchEvent(e){return this._targetRay!==null&&this._targetRay.dispatchEvent(e),this._grip!==null&&this._grip.dispatchEvent(e),this._hand!==null&&this._hand.dispatchEvent(e),this}connect(e){if(e&&e.hand){const t=this._hand;if(t)for(const n of e.hand.values())this._getHandJoint(t,n)}return this.dispatchEvent({type:"connected",data:e}),this}disconnect(e){return this.dispatchEvent({type:"disconnected",data:e}),this._targetRay!==null&&(this._targetRay.visible=!1),this._grip!==null&&(this._grip.visible=!1),this._hand!==null&&(this._hand.visible=!1),this}update(e,t,n){let i=null,r=null,o=null;const a=this._targetRay,c=this._grip,l=this._hand;if(e&&t.session.visibilityState!=="visible-blurred"){if(l&&e.hand){o=!0;for(const g of e.hand.values()){const p=t.getJointPose(g,n),A=this._getHandJoint(l,g);p!==null&&(A.matrix.fromArray(p.transform.matrix),A.matrix.decompose(A.position,A.rotation,A.scale),A.matrixWorldNeedsUpdate=!0,A.jointRadius=p.radius),A.visible=p!==null}const u=l.joints["index-finger-tip"],h=l.joints["thumb-tip"],d=u.position.distanceTo(h.position),f=.02,m=.005;l.inputState.pinching&&d>f+m?(l.inputState.pinching=!1,this.dispatchEvent({type:"pinchend",handedness:e.handedness,target:this})):!l.inputState.pinching&&d<=f-m&&(l.inputState.pinching=!0,this.dispatchEvent({type:"pinchstart",handedness:e.handedness,target:this}))}else c!==null&&e.gripSpace&&(r=t.getPose(e.gripSpace,n),r!==null&&(c.matrix.fromArray(r.transform.matrix),c.matrix.decompose(c.position,c.rotation,c.scale),c.matrixWorldNeedsUpdate=!0,r.linearVelocity?(c.hasLinearVelocity=!0,c.linearVelocity.copy(r.linearVelocity)):c.hasLinearVelocity=!1,r.angularVelocity?(c.hasAngularVelocity=!0,c.angularVelocity.copy(r.angularVelocity)):c.hasAngularVelocity=!1));a!==null&&(i=t.getPose(e.targetRaySpace,n),i===null&&r!==null&&(i=r),i!==null&&(a.matrix.fromArray(i.transform.matrix),a.matrix.decompose(a.position,a.rotation,a.scale),a.matrixWorldNeedsUpdate=!0,i.linearVelocity?(a.hasLinearVelocity=!0,a.linearVelocity.copy(i.linearVelocity)):a.hasLinearVelocity=!1,i.angularVelocity?(a.hasAngularVelocity=!0,a.angularVelocity.copy(i.angularVelocity)):a.hasAngularVelocity=!1,this.dispatchEvent(cd)))}return a!==null&&(a.visible=i!==null),c!==null&&(c.visible=r!==null),l!==null&&(l.visible=o!==null),this}_getHandJoint(e,t){if(e.joints[t.jointName]===void 0){const n=new Ft;n.matrixAutoUpdate=!1,n.visible=!1,e.joints[t.jointName]=n,e.add(n)}return e.joints[t.jointName]}}class Ua{constructor(e,t=1,n=1e3){this.isFog=!0,this.name="",this.color=new be(e),this.near=t,this.far=n}clone(){return new Ua(this.color,this.near,this.far)}toJSON(){return{type:"Fog",name:this.name,color:this.color.getHex(),near:this.near,far:this.far}}}class $l extends ot{constructor(){super(),this.isScene=!0,this.type="Scene",this.background=null,this.environment=null,this.fog=null,this.backgroundBlurriness=0,this.backgroundIntensity=1,this.backgroundRotation=new sn,this.environmentIntensity=1,this.environmentRotation=new sn,this.overrideMaterial=null,typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}copy(e,t){return super.copy(e,t),e.background!==null&&(this.background=e.background.clone()),e.environment!==null&&(this.environment=e.environment.clone()),e.fog!==null&&(this.fog=e.fog.clone()),this.backgroundBlurriness=e.backgroundBlurriness,this.backgroundIntensity=e.backgroundIntensity,this.backgroundRotation.copy(e.backgroundRotation),this.environmentIntensity=e.environmentIntensity,this.environmentRotation.copy(e.environmentRotation),e.overrideMaterial!==null&&(this.overrideMaterial=e.overrideMaterial.clone()),this.matrixAutoUpdate=e.matrixAutoUpdate,this}toJSON(e){const t=super.toJSON(e);return this.fog!==null&&(t.object.fog=this.fog.toJSON()),this.backgroundBlurriness>0&&(t.object.backgroundBlurriness=this.backgroundBlurriness),this.backgroundIntensity!==1&&(t.object.backgroundIntensity=this.backgroundIntensity),t.object.backgroundRotation=this.backgroundRotation.toArray(),this.environmentIntensity!==1&&(t.object.environmentIntensity=this.environmentIntensity),t.object.environmentRotation=this.environmentRotation.toArray(),t}}class eu{constructor(e,t){this.isInterleavedBuffer=!0,this.array=e,this.stride=t,this.count=e!==void 0?e.length/t:0,this.usage=Aa,this.updateRanges=[],this.version=0,this.uuid=tn()}onUploadCallback(){}set needsUpdate(e){e===!0&&this.version++}setUsage(e){return this.usage=e,this}addUpdateRange(e,t){this.updateRanges.push({start:e,count:t})}clearUpdateRanges(){this.updateRanges.length=0}copy(e){return this.array=new e.array.constructor(e.array),this.count=e.count,this.stride=e.stride,this.usage=e.usage,this}copyAt(e,t,n){e*=this.stride,n*=t.stride;for(let i=0,r=this.stride;i<r;i++)this.array[e+i]=t.array[n+i];return this}set(e,t=0){return this.array.set(e,t),this}clone(e){e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=tn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=this.array.slice(0).buffer);const t=new this.array.constructor(e.arrayBuffers[this.array.buffer._uuid]),n=new this.constructor(t,this.stride);return n.setUsage(this.usage),n}onUpload(e){return this.onUploadCallback=e,this}toJSON(e){return e.arrayBuffers===void 0&&(e.arrayBuffers={}),this.array.buffer._uuid===void 0&&(this.array.buffer._uuid=tn()),e.arrayBuffers[this.array.buffer._uuid]===void 0&&(e.arrayBuffers[this.array.buffer._uuid]=Array.from(new Uint32Array(this.array.buffer))),{uuid:this.uuid,buffer:this.array.buffer._uuid,type:this.array.constructor.name,stride:this.stride}}}const Pt=new R;class Is{constructor(e,t,n,i=!1){this.isInterleavedBufferAttribute=!0,this.name="",this.data=e,this.itemSize=t,this.offset=n,this.normalized=i}get count(){return this.data.count}get array(){return this.data.array}set needsUpdate(e){this.data.needsUpdate=e}applyMatrix4(e){for(let t=0,n=this.data.count;t<n;t++)Pt.fromBufferAttribute(this,t),Pt.applyMatrix4(e),this.setXYZ(t,Pt.x,Pt.y,Pt.z);return this}applyNormalMatrix(e){for(let t=0,n=this.count;t<n;t++)Pt.fromBufferAttribute(this,t),Pt.applyNormalMatrix(e),this.setXYZ(t,Pt.x,Pt.y,Pt.z);return this}transformDirection(e){for(let t=0,n=this.count;t<n;t++)Pt.fromBufferAttribute(this,t),Pt.transformDirection(e),this.setXYZ(t,Pt.x,Pt.y,Pt.z);return this}getComponent(e,t){let n=this.array[e*this.data.stride+this.offset+t];return this.normalized&&(n=$t(n,this.array)),n}setComponent(e,t,n){return this.normalized&&(n=Ze(n,this.array)),this.data.array[e*this.data.stride+this.offset+t]=n,this}setX(e,t){return this.normalized&&(t=Ze(t,this.array)),this.data.array[e*this.data.stride+this.offset]=t,this}setY(e,t){return this.normalized&&(t=Ze(t,this.array)),this.data.array[e*this.data.stride+this.offset+1]=t,this}setZ(e,t){return this.normalized&&(t=Ze(t,this.array)),this.data.array[e*this.data.stride+this.offset+2]=t,this}setW(e,t){return this.normalized&&(t=Ze(t,this.array)),this.data.array[e*this.data.stride+this.offset+3]=t,this}getX(e){let t=this.data.array[e*this.data.stride+this.offset];return this.normalized&&(t=$t(t,this.array)),t}getY(e){let t=this.data.array[e*this.data.stride+this.offset+1];return this.normalized&&(t=$t(t,this.array)),t}getZ(e){let t=this.data.array[e*this.data.stride+this.offset+2];return this.normalized&&(t=$t(t,this.array)),t}getW(e){let t=this.data.array[e*this.data.stride+this.offset+3];return this.normalized&&(t=$t(t,this.array)),t}setXY(e,t,n){return e=e*this.data.stride+this.offset,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this}setXYZ(e,t,n,i){return e=e*this.data.stride+this.offset,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array),i=Ze(i,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=i,this}setXYZW(e,t,n,i,r){return e=e*this.data.stride+this.offset,this.normalized&&(t=Ze(t,this.array),n=Ze(n,this.array),i=Ze(i,this.array),r=Ze(r,this.array)),this.data.array[e+0]=t,this.data.array[e+1]=n,this.data.array[e+2]=i,this.data.array[e+3]=r,this}clone(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.clone(): Cloning an interleaved buffer attribute will de-interleave buffer data.");const t=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[i+r])}return new vt(new this.array.constructor(t),this.itemSize,this.normalized)}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.clone(e)),new Is(e.interleavedBuffers[this.data.uuid],this.itemSize,this.offset,this.normalized)}toJSON(e){if(e===void 0){console.log("THREE.InterleavedBufferAttribute.toJSON(): Serializing an interleaved buffer attribute will de-interleave buffer data.");const t=[];for(let n=0;n<this.count;n++){const i=n*this.data.stride+this.offset;for(let r=0;r<this.itemSize;r++)t.push(this.data.array[i+r])}return{itemSize:this.itemSize,type:this.array.constructor.name,array:t,normalized:this.normalized}}else return e.interleavedBuffers===void 0&&(e.interleavedBuffers={}),e.interleavedBuffers[this.data.uuid]===void 0&&(e.interleavedBuffers[this.data.uuid]=this.data.toJSON(e)),{isInterleavedBufferAttribute:!0,itemSize:this.itemSize,data:this.data.uuid,offset:this.offset,normalized:this.normalized}}}class Na extends Yt{constructor(e){super(),this.isSpriteMaterial=!0,this.type="SpriteMaterial",this.color=new be(16777215),this.map=null,this.alphaMap=null,this.rotation=0,this.sizeAttenuation=!0,this.transparent=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.rotation=e.rotation,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}}let bi;const as=new R,Ci=new R,Pi=new R,Ri=new fe,cs=new fe,tu=new Ne,tr=new R,ls=new R,nr=new R,Uc=new fe,so=new fe,Nc=new fe;class nu extends ot{constructor(e=new Na){if(super(),this.isSprite=!0,this.type="Sprite",bi===void 0){bi=new St;const t=new Float32Array([-.5,-.5,0,0,0,.5,-.5,0,1,0,.5,.5,0,1,1,-.5,.5,0,0,1]),n=new eu(t,5);bi.setIndex([0,1,2,0,2,3]),bi.setAttribute("position",new Is(n,3,0,!1)),bi.setAttribute("uv",new Is(n,2,3,!1))}this.geometry=bi,this.material=e,this.center=new fe(.5,.5),this.count=1}raycast(e,t){e.camera===null&&console.error('THREE.Sprite: "Raycaster.camera" needs to be set in order to raycast against sprites.'),Ci.setFromMatrixScale(this.matrixWorld),tu.copy(e.camera.matrixWorld),this.modelViewMatrix.multiplyMatrices(e.camera.matrixWorldInverse,this.matrixWorld),Pi.setFromMatrixPosition(this.modelViewMatrix),e.camera.isPerspectiveCamera&&this.material.sizeAttenuation===!1&&Ci.multiplyScalar(-Pi.z);const n=this.material.rotation;let i,r;n!==0&&(r=Math.cos(n),i=Math.sin(n));const o=this.center;ir(tr.set(-.5,-.5,0),Pi,o,Ci,i,r),ir(ls.set(.5,-.5,0),Pi,o,Ci,i,r),ir(nr.set(.5,.5,0),Pi,o,Ci,i,r),Uc.set(0,0),so.set(1,0),Nc.set(1,1);let a=e.ray.intersectTriangle(tr,ls,nr,!1,as);if(a===null&&(ir(ls.set(-.5,.5,0),Pi,o,Ci,i,r),so.set(0,1),a=e.ray.intersectTriangle(tr,nr,ls,!1,as),a===null))return;const c=e.ray.origin.distanceTo(as);c<e.near||c>e.far||t.push({distance:c,point:as.clone(),uv:Qt.getInterpolation(as,tr,ls,nr,Uc,so,Nc,new fe),face:null,object:this})}copy(e,t){return super.copy(e,t),e.center!==void 0&&this.center.copy(e.center),this.material=e.material,this}}function ir(s,e,t,n,i,r){Ri.subVectors(s,t).addScalar(.5).multiply(n),i!==void 0?(cs.x=r*Ri.x-i*Ri.y,cs.y=i*Ri.x+r*Ri.y):cs.copy(Ri),s.copy(e),s.x+=cs.x,s.y+=cs.y,s.applyMatrix4(tu)}const Fc=new R,Oc=new qe,Bc=new qe,ld=new R,zc=new Ne,sr=new R,ro=new An,kc=new Ne,oo=new Pr;class ud extends Qe{constructor(e,t){super(e,t),this.isSkinnedMesh=!0,this.type="SkinnedMesh",this.bindMode=uc,this.bindMatrix=new Ne,this.bindMatrixInverse=new Ne,this.boundingBox=null,this.boundingSphere=null}computeBoundingBox(){const e=this.geometry;this.boundingBox===null&&(this.boundingBox=new nn),this.boundingBox.makeEmpty();const t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,sr),this.boundingBox.expandByPoint(sr)}computeBoundingSphere(){const e=this.geometry;this.boundingSphere===null&&(this.boundingSphere=new An),this.boundingSphere.makeEmpty();const t=e.getAttribute("position");for(let n=0;n<t.count;n++)this.getVertexPosition(n,sr),this.boundingSphere.expandByPoint(sr)}copy(e,t){return super.copy(e,t),this.bindMode=e.bindMode,this.bindMatrix.copy(e.bindMatrix),this.bindMatrixInverse.copy(e.bindMatrixInverse),this.skeleton=e.skeleton,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}raycast(e,t){const n=this.material,i=this.matrixWorld;n!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),ro.copy(this.boundingSphere),ro.applyMatrix4(i),e.ray.intersectsSphere(ro)!==!1&&(kc.copy(i).invert(),oo.copy(e.ray).applyMatrix4(kc),!(this.boundingBox!==null&&oo.intersectsBox(this.boundingBox)===!1)&&this._computeIntersections(e,t,oo)))}getVertexPosition(e,t){return super.getVertexPosition(e,t),this.applyBoneTransform(e,t),t}bind(e,t){this.skeleton=e,t===void 0&&(this.updateMatrixWorld(!0),this.skeleton.calculateInverses(),t=this.matrixWorld),this.bindMatrix.copy(t),this.bindMatrixInverse.copy(t).invert()}pose(){this.skeleton.pose()}normalizeSkinWeights(){const e=new qe,t=this.geometry.attributes.skinWeight;for(let n=0,i=t.count;n<i;n++){e.fromBufferAttribute(t,n);const r=1/e.manhattanLength();r!==1/0?e.multiplyScalar(r):e.set(1,0,0,0),t.setXYZW(n,e.x,e.y,e.z,e.w)}}updateMatrixWorld(e){super.updateMatrixWorld(e),this.bindMode===uc?this.bindMatrixInverse.copy(this.matrixWorld).invert():this.bindMode===ch?this.bindMatrixInverse.copy(this.bindMatrix).invert():console.warn("THREE.SkinnedMesh: Unrecognized bindMode: "+this.bindMode)}applyBoneTransform(e,t){const n=this.skeleton,i=this.geometry;Oc.fromBufferAttribute(i.attributes.skinIndex,e),Bc.fromBufferAttribute(i.attributes.skinWeight,e),Fc.copy(t).applyMatrix4(this.bindMatrix),t.set(0,0,0);for(let r=0;r<4;r++){const o=Bc.getComponent(r);if(o!==0){const a=Oc.getComponent(r);zc.multiplyMatrices(n.bones[a].matrixWorld,n.boneInverses[a]),t.addScaledVector(ld.copy(Fc).applyMatrix4(zc),o)}}return t.applyMatrix4(this.bindMatrixInverse)}}class iu extends ot{constructor(){super(),this.isBone=!0,this.type="Bone"}}class su extends gt{constructor(e=null,t=1,n=1,i,r,o,a,c,l=Lt,u=Lt,h,d){super(null,o,a,c,l,u,i,r,h,d),this.isDataTexture=!0,this.image={data:e,width:t,height:n},this.generateMipmaps=!1,this.flipY=!1,this.unpackAlignment=1}}const Hc=new Ne,hd=new Ne;class Fa{constructor(e=[],t=[]){this.uuid=tn(),this.bones=e.slice(0),this.boneInverses=t,this.boneMatrices=null,this.boneTexture=null,this.init()}init(){const e=this.bones,t=this.boneInverses;if(this.boneMatrices=new Float32Array(e.length*16),t.length===0)this.calculateInverses();else if(e.length!==t.length){console.warn("THREE.Skeleton: Number of inverse bone matrices does not match amount of bones."),this.boneInverses=[];for(let n=0,i=this.bones.length;n<i;n++)this.boneInverses.push(new Ne)}}calculateInverses(){this.boneInverses.length=0;for(let e=0,t=this.bones.length;e<t;e++){const n=new Ne;this.bones[e]&&n.copy(this.bones[e].matrixWorld).invert(),this.boneInverses.push(n)}}pose(){for(let e=0,t=this.bones.length;e<t;e++){const n=this.bones[e];n&&n.matrixWorld.copy(this.boneInverses[e]).invert()}for(let e=0,t=this.bones.length;e<t;e++){const n=this.bones[e];n&&(n.parent&&n.parent.isBone?(n.matrix.copy(n.parent.matrixWorld).invert(),n.matrix.multiply(n.matrixWorld)):n.matrix.copy(n.matrixWorld),n.matrix.decompose(n.position,n.quaternion,n.scale))}}update(){const e=this.bones,t=this.boneInverses,n=this.boneMatrices,i=this.boneTexture;for(let r=0,o=e.length;r<o;r++){const a=e[r]?e[r].matrixWorld:hd;Hc.multiplyMatrices(a,t[r]),Hc.toArray(n,r*16)}i!==null&&(i.needsUpdate=!0)}clone(){return new Fa(this.bones,this.boneInverses)}computeBoneTexture(){let e=Math.sqrt(this.bones.length*4);e=Math.ceil(e/4)*4,e=Math.max(e,4);const t=new Float32Array(e*e*4);t.set(this.boneMatrices);const n=new su(t,e,e,Kt,en);return n.needsUpdate=!0,this.boneMatrices=t,this.boneTexture=n,this}getBoneByName(e){for(let t=0,n=this.bones.length;t<n;t++){const i=this.bones[t];if(i.name===e)return i}}dispose(){this.boneTexture!==null&&(this.boneTexture.dispose(),this.boneTexture=null)}fromJSON(e,t){this.uuid=e.uuid;for(let n=0,i=e.bones.length;n<i;n++){const r=e.bones[n];let o=t[r];o===void 0&&(console.warn("THREE.Skeleton: No bone found with UUID:",r),o=new iu),this.bones.push(o),this.boneInverses.push(new Ne().fromArray(e.boneInverses[n]))}return this.init(),this}toJSON(){const e={metadata:{version:4.7,type:"Skeleton",generator:"Skeleton.toJSON"},bones:[],boneInverses:[]};e.uuid=this.uuid;const t=this.bones,n=this.boneInverses;for(let i=0,r=t.length;i<r;i++){const o=t[i];e.bones.push(o.uuid);const a=n[i];e.boneInverses.push(a.toArray())}return e}}class pa extends vt{constructor(e,t,n,i=1){super(e,t,n),this.isInstancedBufferAttribute=!0,this.meshPerAttribute=i}copy(e){return super.copy(e),this.meshPerAttribute=e.meshPerAttribute,this}toJSON(){const e=super.toJSON();return e.meshPerAttribute=this.meshPerAttribute,e.isInstancedBufferAttribute=!0,e}}const Di=new Ne,Gc=new Ne,rr=[],Vc=new nn,dd=new Ne,us=new Qe,hs=new An;class Ns extends Qe{constructor(e,t,n){super(e,t),this.isInstancedMesh=!0,this.instanceMatrix=new pa(new Float32Array(n*16),16),this.instanceColor=null,this.morphTexture=null,this.count=n,this.boundingBox=null,this.boundingSphere=null;for(let i=0;i<n;i++)this.setMatrixAt(i,dd)}computeBoundingBox(){const e=this.geometry,t=this.count;this.boundingBox===null&&(this.boundingBox=new nn),e.boundingBox===null&&e.computeBoundingBox(),this.boundingBox.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Di),Vc.copy(e.boundingBox).applyMatrix4(Di),this.boundingBox.union(Vc)}computeBoundingSphere(){const e=this.geometry,t=this.count;this.boundingSphere===null&&(this.boundingSphere=new An),e.boundingSphere===null&&e.computeBoundingSphere(),this.boundingSphere.makeEmpty();for(let n=0;n<t;n++)this.getMatrixAt(n,Di),hs.copy(e.boundingSphere).applyMatrix4(Di),this.boundingSphere.union(hs)}copy(e,t){return super.copy(e,t),this.instanceMatrix.copy(e.instanceMatrix),e.morphTexture!==null&&(this.morphTexture=e.morphTexture.clone()),e.instanceColor!==null&&(this.instanceColor=e.instanceColor.clone()),this.count=e.count,e.boundingBox!==null&&(this.boundingBox=e.boundingBox.clone()),e.boundingSphere!==null&&(this.boundingSphere=e.boundingSphere.clone()),this}getColorAt(e,t){t.fromArray(this.instanceColor.array,e*3)}getMatrixAt(e,t){t.fromArray(this.instanceMatrix.array,e*16)}getMorphAt(e,t){const n=t.morphTargetInfluences,i=this.morphTexture.source.data.data,r=n.length+1,o=e*r+1;for(let a=0;a<n.length;a++)n[a]=i[o+a]}raycast(e,t){const n=this.matrixWorld,i=this.count;if(us.geometry=this.geometry,us.material=this.material,us.material!==void 0&&(this.boundingSphere===null&&this.computeBoundingSphere(),hs.copy(this.boundingSphere),hs.applyMatrix4(n),e.ray.intersectsSphere(hs)!==!1))for(let r=0;r<i;r++){this.getMatrixAt(r,Di),Gc.multiplyMatrices(n,Di),us.matrixWorld=Gc,us.raycast(e,rr);for(let o=0,a=rr.length;o<a;o++){const c=rr[o];c.instanceId=r,c.object=this,t.push(c)}rr.length=0}}setColorAt(e,t){this.instanceColor===null&&(this.instanceColor=new pa(new Float32Array(this.instanceMatrix.count*3).fill(1),3)),t.toArray(this.instanceColor.array,e*3)}setMatrixAt(e,t){t.toArray(this.instanceMatrix.array,e*16)}setMorphAt(e,t){const n=t.morphTargetInfluences,i=n.length+1;this.morphTexture===null&&(this.morphTexture=new su(new Float32Array(i*this.count),i,this.count,ba,en));const r=this.morphTexture.source.data.data;let o=0;for(let l=0;l<n.length;l++)o+=n[l];const a=this.geometry.morphTargetsRelative?1:1-o,c=i*e;r[c]=a,r.set(n,c+1)}updateMorphTargets(){}dispose(){this.dispatchEvent({type:"dispose"}),this.morphTexture!==null&&(this.morphTexture.dispose(),this.morphTexture=null)}}const ao=new R,fd=new R,Ad=new ke;class $n{constructor(e=new R(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,i){return this.normal.set(e,t,n),this.constant=i,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){const i=ao.subVectors(n,t).cross(fd.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(i,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){const e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t){const n=e.delta(ao),i=this.normal.dot(n);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;const r=-(e.start.dot(this.normal)+this.constant)/i;return r<0||r>1?null:t.copy(e.start).addScaledVector(n,r)}intersectsLine(e){const t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){const n=t||Ad.getNormalMatrix(e),i=this.coplanarPoint(ao).applyMatrix4(e),r=this.normal.applyMatrix3(n).normalize();return this.constant=-i.dot(r),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}}const Yn=new An,pd=new fe(.5,.5),or=new R;class Oa{constructor(e=new $n,t=new $n,n=new $n,i=new $n,r=new $n,o=new $n){this.planes=[e,t,n,i,r,o]}set(e,t,n,i,r,o){const a=this.planes;return a[0].copy(e),a[1].copy(t),a[2].copy(n),a[3].copy(i),a[4].copy(r),a[5].copy(o),this}copy(e){const t=this.planes;for(let n=0;n<6;n++)t[n].copy(e.planes[n]);return this}setFromProjectionMatrix(e,t=hn,n=!1){const i=this.planes,r=e.elements,o=r[0],a=r[1],c=r[2],l=r[3],u=r[4],h=r[5],d=r[6],f=r[7],m=r[8],g=r[9],p=r[10],A=r[11],T=r[12],y=r[13],v=r[14],w=r[15];if(i[0].setComponents(l-o,f-u,A-m,w-T).normalize(),i[1].setComponents(l+o,f+u,A+m,w+T).normalize(),i[2].setComponents(l+a,f+h,A+g,w+y).normalize(),i[3].setComponents(l-a,f-h,A-g,w-y).normalize(),n)i[4].setComponents(c,d,p,v).normalize(),i[5].setComponents(l-c,f-d,A-p,w-v).normalize();else if(i[4].setComponents(l-c,f-d,A-p,w-v).normalize(),t===hn)i[5].setComponents(l+c,f+d,A+p,w+v).normalize();else if(t===Tr)i[5].setComponents(c,d,p,v).normalize();else throw new Error("THREE.Frustum.setFromProjectionMatrix(): Invalid coordinate system: "+t);return this}intersectsObject(e){if(e.boundingSphere!==void 0)e.boundingSphere===null&&e.computeBoundingSphere(),Yn.copy(e.boundingSphere).applyMatrix4(e.matrixWorld);else{const t=e.geometry;t.boundingSphere===null&&t.computeBoundingSphere(),Yn.copy(t.boundingSphere).applyMatrix4(e.matrixWorld)}return this.intersectsSphere(Yn)}intersectsSprite(e){Yn.center.set(0,0,0);const t=pd.distanceTo(e.center);return Yn.radius=.7071067811865476+t,Yn.applyMatrix4(e.matrixWorld),this.intersectsSphere(Yn)}intersectsSphere(e){const t=this.planes,n=e.center,i=-e.radius;for(let r=0;r<6;r++)if(t[r].distanceToPoint(n)<i)return!1;return!0}intersectsBox(e){const t=this.planes;for(let n=0;n<6;n++){const i=t[n];if(or.x=i.normal.x>0?e.max.x:e.min.x,or.y=i.normal.y>0?e.max.y:e.min.y,or.z=i.normal.z>0?e.max.z:e.min.z,i.distanceToPoint(or)<0)return!1}return!0}containsPoint(e){const t=this.planes;for(let n=0;n<6;n++)if(t[n].distanceToPoint(e)<0)return!1;return!0}clone(){return new this.constructor().copy(this)}}class ru extends Yt{constructor(e){super(),this.isLineBasicMaterial=!0,this.type="LineBasicMaterial",this.color=new be(16777215),this.map=null,this.linewidth=1,this.linecap="round",this.linejoin="round",this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.linewidth=e.linewidth,this.linecap=e.linecap,this.linejoin=e.linejoin,this.fog=e.fog,this}}const Er=new R,wr=new R,Wc=new Ne,ds=new Pr,ar=new An,co=new R,Xc=new R;class Ba extends ot{constructor(e=new St,t=new ru){super(),this.isLine=!0,this.type="Line",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[0];for(let i=1,r=t.count;i<r;i++)Er.fromBufferAttribute(t,i-1),wr.fromBufferAttribute(t,i),n[i]=n[i-1],n[i]+=Er.distanceTo(wr);e.setAttribute("lineDistance",new ft(n,1))}else console.warn("THREE.Line.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}raycast(e,t){const n=this.geometry,i=this.matrixWorld,r=e.params.Line.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),ar.copy(n.boundingSphere),ar.applyMatrix4(i),ar.radius+=r,e.ray.intersectsSphere(ar)===!1)return;Wc.copy(i).invert(),ds.copy(e.ray).applyMatrix4(Wc);const a=r/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=this.isLineSegments?2:1,u=n.index,d=n.attributes.position;if(u!==null){const f=Math.max(0,o.start),m=Math.min(u.count,o.start+o.count);for(let g=f,p=m-1;g<p;g+=l){const A=u.getX(g),T=u.getX(g+1),y=cr(this,e,ds,c,A,T,g);y&&t.push(y)}if(this.isLineLoop){const g=u.getX(m-1),p=u.getX(f),A=cr(this,e,ds,c,g,p,m-1);A&&t.push(A)}}else{const f=Math.max(0,o.start),m=Math.min(d.count,o.start+o.count);for(let g=f,p=m-1;g<p;g+=l){const A=cr(this,e,ds,c,g,g+1,g);A&&t.push(A)}if(this.isLineLoop){const g=cr(this,e,ds,c,m-1,f,m-1);g&&t.push(g)}}}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=i.length;r<o;r++){const a=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}}function cr(s,e,t,n,i,r,o){const a=s.geometry.attributes.position;if(Er.fromBufferAttribute(a,i),wr.fromBufferAttribute(a,r),t.distanceSqToSegment(Er,wr,co,Xc)>n)return;co.applyMatrix4(s.matrixWorld);const l=e.ray.origin.distanceTo(co);if(!(l<e.near||l>e.far))return{distance:l,point:Xc.clone().applyMatrix4(s.matrixWorld),index:o,face:null,faceIndex:null,barycoord:null,object:s}}const jc=new R,Qc=new R;class md extends Ba{constructor(e,t){super(e,t),this.isLineSegments=!0,this.type="LineSegments"}computeLineDistances(){const e=this.geometry;if(e.index===null){const t=e.attributes.position,n=[];for(let i=0,r=t.count;i<r;i+=2)jc.fromBufferAttribute(t,i),Qc.fromBufferAttribute(t,i+1),n[i]=i===0?0:n[i-1],n[i+1]=n[i]+jc.distanceTo(Qc);e.setAttribute("lineDistance",new ft(n,1))}else console.warn("THREE.LineSegments.computeLineDistances(): Computation only possible with non-indexed BufferGeometry.");return this}}class gd extends Ba{constructor(e,t){super(e,t),this.isLineLoop=!0,this.type="LineLoop"}}class za extends Yt{constructor(e){super(),this.isPointsMaterial=!0,this.type="PointsMaterial",this.color=new be(16777215),this.map=null,this.alphaMap=null,this.size=1,this.sizeAttenuation=!0,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.alphaMap=e.alphaMap,this.size=e.size,this.sizeAttenuation=e.sizeAttenuation,this.fog=e.fog,this}}const Kc=new Ne,ma=new Pr,lr=new An,ur=new R;class ou extends ot{constructor(e=new St,t=new za){super(),this.isPoints=!0,this.type="Points",this.geometry=e,this.material=t,this.morphTargetDictionary=void 0,this.morphTargetInfluences=void 0,this.updateMorphTargets()}copy(e,t){return super.copy(e,t),this.material=Array.isArray(e.material)?e.material.slice():e.material,this.geometry=e.geometry,this}raycast(e,t){const n=this.geometry,i=this.matrixWorld,r=e.params.Points.threshold,o=n.drawRange;if(n.boundingSphere===null&&n.computeBoundingSphere(),lr.copy(n.boundingSphere),lr.applyMatrix4(i),lr.radius+=r,e.ray.intersectsSphere(lr)===!1)return;Kc.copy(i).invert(),ma.copy(e.ray).applyMatrix4(Kc);const a=r/((this.scale.x+this.scale.y+this.scale.z)/3),c=a*a,l=n.index,h=n.attributes.position;if(l!==null){const d=Math.max(0,o.start),f=Math.min(l.count,o.start+o.count);for(let m=d,g=f;m<g;m++){const p=l.getX(m);ur.fromBufferAttribute(h,p),Yc(ur,p,c,i,e,t,this)}}else{const d=Math.max(0,o.start),f=Math.min(h.count,o.start+o.count);for(let m=d,g=f;m<g;m++)ur.fromBufferAttribute(h,m),Yc(ur,m,c,i,e,t,this)}}updateMorphTargets(){const t=this.geometry.morphAttributes,n=Object.keys(t);if(n.length>0){const i=t[n[0]];if(i!==void 0){this.morphTargetInfluences=[],this.morphTargetDictionary={};for(let r=0,o=i.length;r<o;r++){const a=i[r].name||String(r);this.morphTargetInfluences.push(0),this.morphTargetDictionary[a]=r}}}}}function Yc(s,e,t,n,i,r,o){const a=ma.distanceSqToPoint(s);if(a<t){const c=new R;ma.closestPointToPoint(s,c),c.applyMatrix4(n);const l=i.ray.origin.distanceTo(c);if(l<i.near||l>i.far)return;r.push({distance:l,distanceToRay:Math.sqrt(a),point:c,index:e,face:null,faceIndex:null,barycoord:null,object:o})}}class li extends gt{constructor(e,t,n,i,r,o,a,c,l){super(e,t,n,i,r,o,a,c,l),this.isCanvasTexture=!0,this.needsUpdate=!0}}class au extends gt{constructor(e,t,n=oi,i,r,o,a=Lt,c=Lt,l,u=ws,h=1){if(u!==ws&&u!==bs)throw new Error("DepthTexture format must be either THREE.DepthFormat or THREE.DepthStencilFormat");const d={width:e,height:t,depth:h};super(d,i,r,o,a,c,u,n,l),this.isDepthTexture=!0,this.flipY=!1,this.generateMipmaps=!1,this.compareFunction=null}copy(e){return super.copy(e),this.source=new La(Object.assign({},e.image)),this.compareFunction=e.compareFunction,this}toJSON(e){const t=super.toJSON(e);return this.compareFunction!==null&&(t.compareFunction=this.compareFunction),t}}class cu extends gt{constructor(e=null){super(),this.sourceTexture=e,this.isExternalTexture=!0}copy(e){return super.copy(e),this.sourceTexture=e.sourceTexture,this}}class ka extends St{constructor(e=1,t=1,n=1,i=32,r=1,o=!1,a=0,c=Math.PI*2){super(),this.type="CylinderGeometry",this.parameters={radiusTop:e,radiusBottom:t,height:n,radialSegments:i,heightSegments:r,openEnded:o,thetaStart:a,thetaLength:c};const l=this;i=Math.floor(i),r=Math.floor(r);const u=[],h=[],d=[],f=[];let m=0;const g=[],p=n/2;let A=0;T(),o===!1&&(e>0&&y(!0),t>0&&y(!1)),this.setIndex(u),this.setAttribute("position",new ft(h,3)),this.setAttribute("normal",new ft(d,3)),this.setAttribute("uv",new ft(f,2));function T(){const v=new R,w=new R;let E=0;const C=(t-e)/n;for(let P=0;P<=r;P++){const x=[],M=P/r,I=M*(t-e)+e;for(let F=0;F<=i;F++){const z=F/i,G=z*c+a,j=Math.sin(G),B=Math.cos(G);w.x=I*j,w.y=-M*n+p,w.z=I*B,h.push(w.x,w.y,w.z),v.set(j,C,B).normalize(),d.push(v.x,v.y,v.z),f.push(z,1-M),x.push(m++)}g.push(x)}for(let P=0;P<i;P++)for(let x=0;x<r;x++){const M=g[x][P],I=g[x+1][P],F=g[x+1][P+1],z=g[x][P+1];(e>0||x!==0)&&(u.push(M,I,z),E+=3),(t>0||x!==r-1)&&(u.push(I,F,z),E+=3)}l.addGroup(A,E,0),A+=E}function y(v){const w=m,E=new fe,C=new R;let P=0;const x=v===!0?e:t,M=v===!0?1:-1;for(let F=1;F<=i;F++)h.push(0,p*M,0),d.push(0,M,0),f.push(.5,.5),m++;const I=m;for(let F=0;F<=i;F++){const G=F/i*c+a,j=Math.cos(G),B=Math.sin(G);C.x=x*B,C.y=p*M,C.z=x*j,h.push(C.x,C.y,C.z),d.push(0,M,0),E.x=j*.5+.5,E.y=B*.5*M+.5,f.push(E.x,E.y),m++}for(let F=0;F<i;F++){const z=w+F,G=I+F;v===!0?u.push(G,G+1,z):u.push(G+1,G,z),P+=3}l.addGroup(A,P,v===!0?1:2),A+=P}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new ka(e.radiusTop,e.radiusBottom,e.height,e.radialSegments,e.heightSegments,e.openEnded,e.thetaStart,e.thetaLength)}}class Pn{constructor(){this.type="Curve",this.arcLengthDivisions=200,this.needsUpdate=!1,this.cacheArcLengths=null}getPoint(){console.warn("THREE.Curve: .getPoint() not implemented.")}getPointAt(e,t){const n=this.getUtoTmapping(e);return this.getPoint(n,t)}getPoints(e=5){const t=[];for(let n=0;n<=e;n++)t.push(this.getPoint(n/e));return t}getSpacedPoints(e=5){const t=[];for(let n=0;n<=e;n++)t.push(this.getPointAt(n/e));return t}getLength(){const e=this.getLengths();return e[e.length-1]}getLengths(e=this.arcLengthDivisions){if(this.cacheArcLengths&&this.cacheArcLengths.length===e+1&&!this.needsUpdate)return this.cacheArcLengths;this.needsUpdate=!1;const t=[];let n,i=this.getPoint(0),r=0;t.push(0);for(let o=1;o<=e;o++)n=this.getPoint(o/e),r+=n.distanceTo(i),t.push(r),i=n;return this.cacheArcLengths=t,t}updateArcLengths(){this.needsUpdate=!0,this.getLengths()}getUtoTmapping(e,t=null){const n=this.getLengths();let i=0;const r=n.length;let o;t?o=t:o=e*n[r-1];let a=0,c=r-1,l;for(;a<=c;)if(i=Math.floor(a+(c-a)/2),l=n[i]-o,l<0)a=i+1;else if(l>0)c=i-1;else{c=i;break}if(i=c,n[i]===o)return i/(r-1);const u=n[i],d=n[i+1]-u,f=(o-u)/d;return(i+f)/(r-1)}getTangent(e,t){let i=e-1e-4,r=e+1e-4;i<0&&(i=0),r>1&&(r=1);const o=this.getPoint(i),a=this.getPoint(r),c=t||(o.isVector2?new fe:new R);return c.copy(a).sub(o).normalize(),c}getTangentAt(e,t){const n=this.getUtoTmapping(e);return this.getTangent(n,t)}computeFrenetFrames(e,t=!1){const n=new R,i=[],r=[],o=[],a=new R,c=new Ne;for(let f=0;f<=e;f++){const m=f/e;i[f]=this.getTangentAt(m,new R)}r[0]=new R,o[0]=new R;let l=Number.MAX_VALUE;const u=Math.abs(i[0].x),h=Math.abs(i[0].y),d=Math.abs(i[0].z);u<=l&&(l=u,n.set(1,0,0)),h<=l&&(l=h,n.set(0,1,0)),d<=l&&n.set(0,0,1),a.crossVectors(i[0],n).normalize(),r[0].crossVectors(i[0],a),o[0].crossVectors(i[0],r[0]);for(let f=1;f<=e;f++){if(r[f]=r[f-1].clone(),o[f]=o[f-1].clone(),a.crossVectors(i[f-1],i[f]),a.length()>Number.EPSILON){a.normalize();const m=Math.acos(Ge(i[f-1].dot(i[f]),-1,1));r[f].applyMatrix4(c.makeRotationAxis(a,m))}o[f].crossVectors(i[f],r[f])}if(t===!0){let f=Math.acos(Ge(r[0].dot(r[e]),-1,1));f/=e,i[0].dot(a.crossVectors(r[0],r[e]))>0&&(f=-f);for(let m=1;m<=e;m++)r[m].applyMatrix4(c.makeRotationAxis(i[m],f*m)),o[m].crossVectors(i[m],r[m])}return{tangents:i,normals:r,binormals:o}}clone(){return new this.constructor().copy(this)}copy(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}toJSON(){const e={metadata:{version:4.7,type:"Curve",generator:"Curve.toJSON"}};return e.arcLengthDivisions=this.arcLengthDivisions,e.type=this.type,e}fromJSON(e){return this.arcLengthDivisions=e.arcLengthDivisions,this}}class lu extends Pn{constructor(e=0,t=0,n=1,i=1,r=0,o=Math.PI*2,a=!1,c=0){super(),this.isEllipseCurve=!0,this.type="EllipseCurve",this.aX=e,this.aY=t,this.xRadius=n,this.yRadius=i,this.aStartAngle=r,this.aEndAngle=o,this.aClockwise=a,this.aRotation=c}getPoint(e,t=new fe){const n=t,i=Math.PI*2;let r=this.aEndAngle-this.aStartAngle;const o=Math.abs(r)<Number.EPSILON;for(;r<0;)r+=i;for(;r>i;)r-=i;r<Number.EPSILON&&(o?r=0:r=i),this.aClockwise===!0&&!o&&(r===i?r=-i:r=r-i);const a=this.aStartAngle+e*r;let c=this.aX+this.xRadius*Math.cos(a),l=this.aY+this.yRadius*Math.sin(a);if(this.aRotation!==0){const u=Math.cos(this.aRotation),h=Math.sin(this.aRotation),d=c-this.aX,f=l-this.aY;c=d*u-f*h+this.aX,l=d*h+f*u+this.aY}return n.set(c,l)}copy(e){return super.copy(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}toJSON(){const e=super.toJSON();return e.aX=this.aX,e.aY=this.aY,e.xRadius=this.xRadius,e.yRadius=this.yRadius,e.aStartAngle=this.aStartAngle,e.aEndAngle=this.aEndAngle,e.aClockwise=this.aClockwise,e.aRotation=this.aRotation,e}fromJSON(e){return super.fromJSON(e),this.aX=e.aX,this.aY=e.aY,this.xRadius=e.xRadius,this.yRadius=e.yRadius,this.aStartAngle=e.aStartAngle,this.aEndAngle=e.aEndAngle,this.aClockwise=e.aClockwise,this.aRotation=e.aRotation,this}}class vd extends lu{constructor(e,t,n,i,r,o){super(e,t,n,n,i,r,o),this.isArcCurve=!0,this.type="ArcCurve"}}function Ha(){let s=0,e=0,t=0,n=0;function i(r,o,a,c){s=r,e=a,t=-3*r+3*o-2*a-c,n=2*r-2*o+a+c}return{initCatmullRom:function(r,o,a,c,l){i(o,a,l*(a-r),l*(c-o))},initNonuniformCatmullRom:function(r,o,a,c,l,u,h){let d=(o-r)/l-(a-r)/(l+u)+(a-o)/u,f=(a-o)/u-(c-o)/(u+h)+(c-a)/h;d*=u,f*=u,i(o,a,d,f)},calc:function(r){const o=r*r,a=o*r;return s+e*r+t*o+n*a}}}const hr=new R,lo=new Ha,uo=new Ha,ho=new Ha;class Ga extends Pn{constructor(e=[],t=!1,n="centripetal",i=.5){super(),this.isCatmullRomCurve3=!0,this.type="CatmullRomCurve3",this.points=e,this.closed=t,this.curveType=n,this.tension=i}getPoint(e,t=new R){const n=t,i=this.points,r=i.length,o=(r-(this.closed?0:1))*e;let a=Math.floor(o),c=o-a;this.closed?a+=a>0?0:(Math.floor(Math.abs(a)/r)+1)*r:c===0&&a===r-1&&(a=r-2,c=1);let l,u;this.closed||a>0?l=i[(a-1)%r]:(hr.subVectors(i[0],i[1]).add(i[0]),l=hr);const h=i[a%r],d=i[(a+1)%r];if(this.closed||a+2<r?u=i[(a+2)%r]:(hr.subVectors(i[r-1],i[r-2]).add(i[r-1]),u=hr),this.curveType==="centripetal"||this.curveType==="chordal"){const f=this.curveType==="chordal"?.5:.25;let m=Math.pow(l.distanceToSquared(h),f),g=Math.pow(h.distanceToSquared(d),f),p=Math.pow(d.distanceToSquared(u),f);g<1e-4&&(g=1),m<1e-4&&(m=g),p<1e-4&&(p=g),lo.initNonuniformCatmullRom(l.x,h.x,d.x,u.x,m,g,p),uo.initNonuniformCatmullRom(l.y,h.y,d.y,u.y,m,g,p),ho.initNonuniformCatmullRom(l.z,h.z,d.z,u.z,m,g,p)}else this.curveType==="catmullrom"&&(lo.initCatmullRom(l.x,h.x,d.x,u.x,this.tension),uo.initCatmullRom(l.y,h.y,d.y,u.y,this.tension),ho.initCatmullRom(l.z,h.z,d.z,u.z,this.tension));return n.set(lo.calc(c),uo.calc(c),ho.calc(c)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(i.clone())}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}toJSON(){const e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){const i=this.points[t];e.points.push(i.toArray())}return e.closed=this.closed,e.curveType=this.curveType,e.tension=this.tension,e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(new R().fromArray(i))}return this.closed=e.closed,this.curveType=e.curveType,this.tension=e.tension,this}}function qc(s,e,t,n,i){const r=(n-e)*.5,o=(i-t)*.5,a=s*s,c=s*a;return(2*t-2*n+r+o)*c+(-3*t+3*n-2*r-o)*a+r*s+t}function _d(s,e){const t=1-s;return t*t*e}function xd(s,e){return 2*(1-s)*s*e}function Md(s,e){return s*s*e}function xs(s,e,t,n){return _d(s,e)+xd(s,t)+Md(s,n)}function yd(s,e){const t=1-s;return t*t*t*e}function Sd(s,e){const t=1-s;return 3*t*t*s*e}function Td(s,e){return 3*(1-s)*s*s*e}function Ed(s,e){return s*s*s*e}function Ms(s,e,t,n,i){return yd(s,e)+Sd(s,t)+Td(s,n)+Ed(s,i)}class wd extends Pn{constructor(e=new fe,t=new fe,n=new fe,i=new fe){super(),this.isCubicBezierCurve=!0,this.type="CubicBezierCurve",this.v0=e,this.v1=t,this.v2=n,this.v3=i}getPoint(e,t=new fe){const n=t,i=this.v0,r=this.v1,o=this.v2,a=this.v3;return n.set(Ms(e,i.x,r.x,o.x,a.x),Ms(e,i.y,r.y,o.y,a.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}}class bd extends Pn{constructor(e=new R,t=new R,n=new R,i=new R){super(),this.isCubicBezierCurve3=!0,this.type="CubicBezierCurve3",this.v0=e,this.v1=t,this.v2=n,this.v3=i}getPoint(e,t=new R){const n=t,i=this.v0,r=this.v1,o=this.v2,a=this.v3;return n.set(Ms(e,i.x,r.x,o.x,a.x),Ms(e,i.y,r.y,o.y,a.y),Ms(e,i.z,r.z,o.z,a.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this.v3.copy(e.v3),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e.v3=this.v3.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this.v3.fromArray(e.v3),this}}class Cd extends Pn{constructor(e=new fe,t=new fe){super(),this.isLineCurve=!0,this.type="LineCurve",this.v1=e,this.v2=t}getPoint(e,t=new fe){const n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new fe){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class Pd extends Pn{constructor(e=new R,t=new R){super(),this.isLineCurve3=!0,this.type="LineCurve3",this.v1=e,this.v2=t}getPoint(e,t=new R){const n=t;return e===1?n.copy(this.v2):(n.copy(this.v2).sub(this.v1),n.multiplyScalar(e).add(this.v1)),n}getPointAt(e,t){return this.getPoint(e,t)}getTangent(e,t=new R){return t.subVectors(this.v2,this.v1).normalize()}getTangentAt(e,t){return this.getTangent(e,t)}copy(e){return super.copy(e),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class Rd extends Pn{constructor(e=new fe,t=new fe,n=new fe){super(),this.isQuadraticBezierCurve=!0,this.type="QuadraticBezierCurve",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new fe){const n=t,i=this.v0,r=this.v1,o=this.v2;return n.set(xs(e,i.x,r.x,o.x),xs(e,i.y,r.y,o.y)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class uu extends Pn{constructor(e=new R,t=new R,n=new R){super(),this.isQuadraticBezierCurve3=!0,this.type="QuadraticBezierCurve3",this.v0=e,this.v1=t,this.v2=n}getPoint(e,t=new R){const n=t,i=this.v0,r=this.v1,o=this.v2;return n.set(xs(e,i.x,r.x,o.x),xs(e,i.y,r.y,o.y),xs(e,i.z,r.z,o.z)),n}copy(e){return super.copy(e),this.v0.copy(e.v0),this.v1.copy(e.v1),this.v2.copy(e.v2),this}toJSON(){const e=super.toJSON();return e.v0=this.v0.toArray(),e.v1=this.v1.toArray(),e.v2=this.v2.toArray(),e}fromJSON(e){return super.fromJSON(e),this.v0.fromArray(e.v0),this.v1.fromArray(e.v1),this.v2.fromArray(e.v2),this}}class Dd extends Pn{constructor(e=[]){super(),this.isSplineCurve=!0,this.type="SplineCurve",this.points=e}getPoint(e,t=new fe){const n=t,i=this.points,r=(i.length-1)*e,o=Math.floor(r),a=r-o,c=i[o===0?o:o-1],l=i[o],u=i[o>i.length-2?i.length-1:o+1],h=i[o>i.length-3?i.length-1:o+2];return n.set(qc(a,c.x,l.x,u.x,h.x),qc(a,c.y,l.y,u.y,h.y)),n}copy(e){super.copy(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(i.clone())}return this}toJSON(){const e=super.toJSON();e.points=[];for(let t=0,n=this.points.length;t<n;t++){const i=this.points[t];e.points.push(i.toArray())}return e}fromJSON(e){super.fromJSON(e),this.points=[];for(let t=0,n=e.points.length;t<n;t++){const i=e.points[t];this.points.push(new fe().fromArray(i))}return this}}var Id=Object.freeze({__proto__:null,ArcCurve:vd,CatmullRomCurve3:Ga,CubicBezierCurve:wd,CubicBezierCurve3:bd,EllipseCurve:lu,LineCurve:Cd,LineCurve3:Pd,QuadraticBezierCurve:Rd,QuadraticBezierCurve3:uu,SplineCurve:Dd});class Va extends St{constructor(e=[new fe(0,-.5),new fe(.5,0),new fe(0,.5)],t=12,n=0,i=Math.PI*2){super(),this.type="LatheGeometry",this.parameters={points:e,segments:t,phiStart:n,phiLength:i},t=Math.floor(t),i=Ge(i,0,Math.PI*2);const r=[],o=[],a=[],c=[],l=[],u=1/t,h=new R,d=new fe,f=new R,m=new R,g=new R;let p=0,A=0;for(let T=0;T<=e.length-1;T++)switch(T){case 0:p=e[T+1].x-e[T].x,A=e[T+1].y-e[T].y,f.x=A*1,f.y=-p,f.z=A*0,g.copy(f),f.normalize(),c.push(f.x,f.y,f.z);break;case e.length-1:c.push(g.x,g.y,g.z);break;default:p=e[T+1].x-e[T].x,A=e[T+1].y-e[T].y,f.x=A*1,f.y=-p,f.z=A*0,m.copy(f),f.x+=g.x,f.y+=g.y,f.z+=g.z,f.normalize(),c.push(f.x,f.y,f.z),g.copy(m)}for(let T=0;T<=t;T++){const y=n+T*u*i,v=Math.sin(y),w=Math.cos(y);for(let E=0;E<=e.length-1;E++){h.x=e[E].x*v,h.y=e[E].y,h.z=e[E].x*w,o.push(h.x,h.y,h.z),d.x=T/t,d.y=E/(e.length-1),a.push(d.x,d.y);const C=c[3*E+0]*v,P=c[3*E+1],x=c[3*E+0]*w;l.push(C,P,x)}}for(let T=0;T<t;T++)for(let y=0;y<e.length-1;y++){const v=y+T*e.length,w=v,E=v+e.length,C=v+e.length+1,P=v+1;r.push(w,E,P),r.push(C,P,E)}this.setIndex(r),this.setAttribute("position",new ft(o,3)),this.setAttribute("uv",new ft(a,2)),this.setAttribute("normal",new ft(l,3))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Va(e.points,e.segments,e.phiStart,e.phiLength)}}class Rn extends St{constructor(e=1,t=1,n=1,i=1){super(),this.type="PlaneGeometry",this.parameters={width:e,height:t,widthSegments:n,heightSegments:i};const r=e/2,o=t/2,a=Math.floor(n),c=Math.floor(i),l=a+1,u=c+1,h=e/a,d=t/c,f=[],m=[],g=[],p=[];for(let A=0;A<u;A++){const T=A*d-o;for(let y=0;y<l;y++){const v=y*h-r;m.push(v,-T,0),g.push(0,0,1),p.push(y/a),p.push(1-A/c)}}for(let A=0;A<c;A++)for(let T=0;T<a;T++){const y=T+l*A,v=T+l*(A+1),w=T+1+l*(A+1),E=T+1+l*A;f.push(y,v,E),f.push(v,w,E)}this.setIndex(f),this.setAttribute("position",new ft(m,3)),this.setAttribute("normal",new ft(g,3)),this.setAttribute("uv",new ft(p,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Rn(e.width,e.height,e.widthSegments,e.heightSegments)}}class Rr extends St{constructor(e=1,t=32,n=16,i=0,r=Math.PI*2,o=0,a=Math.PI){super(),this.type="SphereGeometry",this.parameters={radius:e,widthSegments:t,heightSegments:n,phiStart:i,phiLength:r,thetaStart:o,thetaLength:a},t=Math.max(3,Math.floor(t)),n=Math.max(2,Math.floor(n));const c=Math.min(o+a,Math.PI);let l=0;const u=[],h=new R,d=new R,f=[],m=[],g=[],p=[];for(let A=0;A<=n;A++){const T=[],y=A/n;let v=0;A===0&&o===0?v=.5/t:A===n&&c===Math.PI&&(v=-.5/t);for(let w=0;w<=t;w++){const E=w/t;h.x=-e*Math.cos(i+E*r)*Math.sin(o+y*a),h.y=e*Math.cos(o+y*a),h.z=e*Math.sin(i+E*r)*Math.sin(o+y*a),m.push(h.x,h.y,h.z),d.copy(h).normalize(),g.push(d.x,d.y,d.z),p.push(E+v,1-y),T.push(l++)}u.push(T)}for(let A=0;A<n;A++)for(let T=0;T<t;T++){const y=u[A][T+1],v=u[A][T],w=u[A+1][T],E=u[A+1][T+1];(A!==0||o>0)&&f.push(y,v,E),(A!==n-1||c<Math.PI)&&f.push(v,w,E)}this.setIndex(f),this.setAttribute("position",new ft(m,3)),this.setAttribute("normal",new ft(g,3)),this.setAttribute("uv",new ft(p,2))}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}static fromJSON(e){return new Rr(e.radius,e.widthSegments,e.heightSegments,e.phiStart,e.phiLength,e.thetaStart,e.thetaLength)}}class Dr extends St{constructor(e=new uu(new R(-1,-1,0),new R(-1,1,0),new R(1,1,0)),t=64,n=1,i=8,r=!1){super(),this.type="TubeGeometry",this.parameters={path:e,tubularSegments:t,radius:n,radialSegments:i,closed:r};const o=e.computeFrenetFrames(t,r);this.tangents=o.tangents,this.normals=o.normals,this.binormals=o.binormals;const a=new R,c=new R,l=new fe;let u=new R;const h=[],d=[],f=[],m=[];g(),this.setIndex(m),this.setAttribute("position",new ft(h,3)),this.setAttribute("normal",new ft(d,3)),this.setAttribute("uv",new ft(f,2));function g(){for(let y=0;y<t;y++)p(y);p(r===!1?t:0),T(),A()}function p(y){u=e.getPointAt(y/t,u);const v=o.normals[y],w=o.binormals[y];for(let E=0;E<=i;E++){const C=E/i*Math.PI*2,P=Math.sin(C),x=-Math.cos(C);c.x=x*v.x+P*w.x,c.y=x*v.y+P*w.y,c.z=x*v.z+P*w.z,c.normalize(),d.push(c.x,c.y,c.z),a.x=u.x+n*c.x,a.y=u.y+n*c.y,a.z=u.z+n*c.z,h.push(a.x,a.y,a.z)}}function A(){for(let y=1;y<=t;y++)for(let v=1;v<=i;v++){const w=(i+1)*(y-1)+(v-1),E=(i+1)*y+(v-1),C=(i+1)*y+v,P=(i+1)*(y-1)+v;m.push(w,E,P),m.push(E,C,P)}}function T(){for(let y=0;y<=t;y++)for(let v=0;v<=i;v++)l.x=y/t,l.y=v/i,f.push(l.x,l.y)}}copy(e){return super.copy(e),this.parameters=Object.assign({},e.parameters),this}toJSON(){const e=super.toJSON();return e.path=this.parameters.path.toJSON(),e}static fromJSON(e){return new Dr(new Id[e.path.type]().fromJSON(e.path),e.tubularSegments,e.radius,e.radialSegments,e.closed)}}class pt extends Yt{constructor(e){super(),this.isMeshStandardMaterial=!0,this.type="MeshStandardMaterial",this.defines={STANDARD:""},this.color=new be(16777215),this.roughness=1,this.metalness=0,this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new be(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Da,this.normalScale=new fe(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.roughnessMap=null,this.metalnessMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new sn,this.envMapIntensity=1,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.defines={STANDARD:""},this.color.copy(e.color),this.roughness=e.roughness,this.metalness=e.metalness,this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.roughnessMap=e.roughnessMap,this.metalnessMap=e.metalnessMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.envMapIntensity=e.envMapIntensity,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class pn extends pt{constructor(e){super(),this.isMeshPhysicalMaterial=!0,this.defines={STANDARD:"",PHYSICAL:""},this.type="MeshPhysicalMaterial",this.anisotropyRotation=0,this.anisotropyMap=null,this.clearcoatMap=null,this.clearcoatRoughness=0,this.clearcoatRoughnessMap=null,this.clearcoatNormalScale=new fe(1,1),this.clearcoatNormalMap=null,this.ior=1.5,Object.defineProperty(this,"reflectivity",{get:function(){return Ge(2.5*(this.ior-1)/(this.ior+1),0,1)},set:function(t){this.ior=(1+.4*t)/(1-.4*t)}}),this.iridescenceMap=null,this.iridescenceIOR=1.3,this.iridescenceThicknessRange=[100,400],this.iridescenceThicknessMap=null,this.sheenColor=new be(0),this.sheenColorMap=null,this.sheenRoughness=1,this.sheenRoughnessMap=null,this.transmissionMap=null,this.thickness=0,this.thicknessMap=null,this.attenuationDistance=1/0,this.attenuationColor=new be(1,1,1),this.specularIntensity=1,this.specularIntensityMap=null,this.specularColor=new be(1,1,1),this.specularColorMap=null,this._anisotropy=0,this._clearcoat=0,this._dispersion=0,this._iridescence=0,this._sheen=0,this._transmission=0,this.setValues(e)}get anisotropy(){return this._anisotropy}set anisotropy(e){this._anisotropy>0!=e>0&&this.version++,this._anisotropy=e}get clearcoat(){return this._clearcoat}set clearcoat(e){this._clearcoat>0!=e>0&&this.version++,this._clearcoat=e}get iridescence(){return this._iridescence}set iridescence(e){this._iridescence>0!=e>0&&this.version++,this._iridescence=e}get dispersion(){return this._dispersion}set dispersion(e){this._dispersion>0!=e>0&&this.version++,this._dispersion=e}get sheen(){return this._sheen}set sheen(e){this._sheen>0!=e>0&&this.version++,this._sheen=e}get transmission(){return this._transmission}set transmission(e){this._transmission>0!=e>0&&this.version++,this._transmission=e}copy(e){return super.copy(e),this.defines={STANDARD:"",PHYSICAL:""},this.anisotropy=e.anisotropy,this.anisotropyRotation=e.anisotropyRotation,this.anisotropyMap=e.anisotropyMap,this.clearcoat=e.clearcoat,this.clearcoatMap=e.clearcoatMap,this.clearcoatRoughness=e.clearcoatRoughness,this.clearcoatRoughnessMap=e.clearcoatRoughnessMap,this.clearcoatNormalMap=e.clearcoatNormalMap,this.clearcoatNormalScale.copy(e.clearcoatNormalScale),this.dispersion=e.dispersion,this.ior=e.ior,this.iridescence=e.iridescence,this.iridescenceMap=e.iridescenceMap,this.iridescenceIOR=e.iridescenceIOR,this.iridescenceThicknessRange=[...e.iridescenceThicknessRange],this.iridescenceThicknessMap=e.iridescenceThicknessMap,this.sheen=e.sheen,this.sheenColor.copy(e.sheenColor),this.sheenColorMap=e.sheenColorMap,this.sheenRoughness=e.sheenRoughness,this.sheenRoughnessMap=e.sheenRoughnessMap,this.transmission=e.transmission,this.transmissionMap=e.transmissionMap,this.thickness=e.thickness,this.thicknessMap=e.thicknessMap,this.attenuationDistance=e.attenuationDistance,this.attenuationColor.copy(e.attenuationColor),this.specularIntensity=e.specularIntensity,this.specularIntensityMap=e.specularIntensityMap,this.specularColor.copy(e.specularColor),this.specularColorMap=e.specularColorMap,this}}class Ld extends Yt{constructor(e){super(),this.isMeshLambertMaterial=!0,this.type="MeshLambertMaterial",this.color=new be(16777215),this.map=null,this.lightMap=null,this.lightMapIntensity=1,this.aoMap=null,this.aoMapIntensity=1,this.emissive=new be(0),this.emissiveIntensity=1,this.emissiveMap=null,this.bumpMap=null,this.bumpScale=1,this.normalMap=null,this.normalMapType=Da,this.normalScale=new fe(1,1),this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.specularMap=null,this.alphaMap=null,this.envMap=null,this.envMapRotation=new sn,this.combine=Sa,this.reflectivity=1,this.refractionRatio=.98,this.wireframe=!1,this.wireframeLinewidth=1,this.wireframeLinecap="round",this.wireframeLinejoin="round",this.flatShading=!1,this.fog=!0,this.setValues(e)}copy(e){return super.copy(e),this.color.copy(e.color),this.map=e.map,this.lightMap=e.lightMap,this.lightMapIntensity=e.lightMapIntensity,this.aoMap=e.aoMap,this.aoMapIntensity=e.aoMapIntensity,this.emissive.copy(e.emissive),this.emissiveMap=e.emissiveMap,this.emissiveIntensity=e.emissiveIntensity,this.bumpMap=e.bumpMap,this.bumpScale=e.bumpScale,this.normalMap=e.normalMap,this.normalMapType=e.normalMapType,this.normalScale.copy(e.normalScale),this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.specularMap=e.specularMap,this.alphaMap=e.alphaMap,this.envMap=e.envMap,this.envMapRotation.copy(e.envMapRotation),this.combine=e.combine,this.reflectivity=e.reflectivity,this.refractionRatio=e.refractionRatio,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this.wireframeLinecap=e.wireframeLinecap,this.wireframeLinejoin=e.wireframeLinejoin,this.flatShading=e.flatShading,this.fog=e.fog,this}}class Ud extends Yt{constructor(e){super(),this.isMeshDepthMaterial=!0,this.type="MeshDepthMaterial",this.depthPacking=hh,this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.wireframe=!1,this.wireframeLinewidth=1,this.setValues(e)}copy(e){return super.copy(e),this.depthPacking=e.depthPacking,this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this.wireframe=e.wireframe,this.wireframeLinewidth=e.wireframeLinewidth,this}}class Nd extends Yt{constructor(e){super(),this.isMeshDistanceMaterial=!0,this.type="MeshDistanceMaterial",this.map=null,this.alphaMap=null,this.displacementMap=null,this.displacementScale=1,this.displacementBias=0,this.setValues(e)}copy(e){return super.copy(e),this.map=e.map,this.alphaMap=e.alphaMap,this.displacementMap=e.displacementMap,this.displacementScale=e.displacementScale,this.displacementBias=e.displacementBias,this}}function dr(s,e){return!s||s.constructor===e?s:typeof e.BYTES_PER_ELEMENT=="number"?new e(s):Array.prototype.slice.call(s)}function Fd(s){return ArrayBuffer.isView(s)&&!(s instanceof DataView)}function Od(s){function e(i,r){return s[i]-s[r]}const t=s.length,n=new Array(t);for(let i=0;i!==t;++i)n[i]=i;return n.sort(e),n}function Jc(s,e,t){const n=s.length,i=new s.constructor(n);for(let r=0,o=0;o!==n;++r){const a=t[r]*e;for(let c=0;c!==e;++c)i[o++]=s[a+c]}return i}function hu(s,e,t,n){let i=1,r=s[0];for(;r!==void 0&&r[n]===void 0;)r=s[i++];if(r===void 0)return;let o=r[n];if(o!==void 0)if(Array.isArray(o))do o=r[n],o!==void 0&&(e.push(r.time),t.push(...o)),r=s[i++];while(r!==void 0);else if(o.toArray!==void 0)do o=r[n],o!==void 0&&(e.push(r.time),o.toArray(t,t.length)),r=s[i++];while(r!==void 0);else do o=r[n],o!==void 0&&(e.push(r.time),t.push(o)),r=s[i++];while(r!==void 0)}class Fs{constructor(e,t,n,i){this.parameterPositions=e,this._cachedIndex=0,this.resultBuffer=i!==void 0?i:new t.constructor(n),this.sampleValues=t,this.valueSize=n,this.settings=null,this.DefaultSettings_={}}evaluate(e){const t=this.parameterPositions;let n=this._cachedIndex,i=t[n],r=t[n-1];n:{e:{let o;t:{i:if(!(e<i)){for(let a=n+2;;){if(i===void 0){if(e<r)break i;return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}if(n===a)break;if(r=i,i=t[++n],e<i)break e}o=t.length;break t}if(!(e>=r)){const a=t[1];e<a&&(n=2,r=a);for(let c=n-2;;){if(r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(n===c)break;if(i=r,r=t[--n-1],e>=r)break e}o=n,n=0;break t}break n}for(;n<o;){const a=n+o>>>1;e<t[a]?o=a:n=a+1}if(i=t[n],r=t[n-1],r===void 0)return this._cachedIndex=0,this.copySampleValue_(0);if(i===void 0)return n=t.length,this._cachedIndex=n,this.copySampleValue_(n-1)}this._cachedIndex=n,this.intervalChanged_(n,r,i)}return this.interpolate_(n,r,e,i)}getSettings_(){return this.settings||this.DefaultSettings_}copySampleValue_(e){const t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,r=e*i;for(let o=0;o!==i;++o)t[o]=n[r+o];return t}interpolate_(){throw new Error("call to abstract method")}intervalChanged_(){}}class Bd extends Fs{constructor(e,t,n,i){super(e,t,n,i),this._weightPrev=-0,this._offsetPrev=-0,this._weightNext=-0,this._offsetNext=-0,this.DefaultSettings_={endingStart:hc,endingEnd:hc}}intervalChanged_(e,t,n){const i=this.parameterPositions;let r=e-2,o=e+1,a=i[r],c=i[o];if(a===void 0)switch(this.getSettings_().endingStart){case dc:r=e,a=2*t-n;break;case fc:r=i.length-2,a=t+i[r]-i[r+1];break;default:r=e,a=n}if(c===void 0)switch(this.getSettings_().endingEnd){case dc:o=e,c=2*n-t;break;case fc:o=1,c=n+i[1]-i[0];break;default:o=e-1,c=t}const l=(n-t)*.5,u=this.valueSize;this._weightPrev=l/(t-a),this._weightNext=l/(c-n),this._offsetPrev=r*u,this._offsetNext=o*u}interpolate_(e,t,n,i){const r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=e*a,l=c-a,u=this._offsetPrev,h=this._offsetNext,d=this._weightPrev,f=this._weightNext,m=(n-t)/(i-t),g=m*m,p=g*m,A=-d*p+2*d*g-d*m,T=(1+d)*p+(-1.5-2*d)*g+(-.5+d)*m+1,y=(-1-f)*p+(1.5+f)*g+.5*m,v=f*p-f*g;for(let w=0;w!==a;++w)r[w]=A*o[u+w]+T*o[l+w]+y*o[c+w]+v*o[h+w];return r}}class zd extends Fs{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){const r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=e*a,l=c-a,u=(n-t)/(i-t),h=1-u;for(let d=0;d!==a;++d)r[d]=o[l+d]*h+o[c+d]*u;return r}}class kd extends Fs{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e){return this.copySampleValue_(e-1)}}class on{constructor(e,t,n,i){if(e===void 0)throw new Error("THREE.KeyframeTrack: track name is undefined");if(t===void 0||t.length===0)throw new Error("THREE.KeyframeTrack: no keyframes in track named "+e);this.name=e,this.times=dr(t,this.TimeBufferType),this.values=dr(n,this.ValueBufferType),this.setInterpolation(i||this.DefaultInterpolation)}static toJSON(e){const t=e.constructor;let n;if(t.toJSON!==this.toJSON)n=t.toJSON(e);else{n={name:e.name,times:dr(e.times,Array),values:dr(e.values,Array)};const i=e.getInterpolation();i!==e.DefaultInterpolation&&(n.interpolation=i)}return n.type=e.ValueTypeName,n}InterpolantFactoryMethodDiscrete(e){return new kd(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodLinear(e){return new zd(this.times,this.values,this.getValueSize(),e)}InterpolantFactoryMethodSmooth(e){return new Bd(this.times,this.values,this.getValueSize(),e)}setInterpolation(e){let t;switch(e){case Cs:t=this.InterpolantFactoryMethodDiscrete;break;case Ps:t=this.InterpolantFactoryMethodLinear;break;case Fr:t=this.InterpolantFactoryMethodSmooth;break}if(t===void 0){const n="unsupported interpolation for "+this.ValueTypeName+" keyframe track named "+this.name;if(this.createInterpolant===void 0)if(e!==this.DefaultInterpolation)this.setInterpolation(this.DefaultInterpolation);else throw new Error(n);return console.warn("THREE.KeyframeTrack:",n),this}return this.createInterpolant=t,this}getInterpolation(){switch(this.createInterpolant){case this.InterpolantFactoryMethodDiscrete:return Cs;case this.InterpolantFactoryMethodLinear:return Ps;case this.InterpolantFactoryMethodSmooth:return Fr}}getValueSize(){return this.values.length/this.times.length}shift(e){if(e!==0){const t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]+=e}return this}scale(e){if(e!==1){const t=this.times;for(let n=0,i=t.length;n!==i;++n)t[n]*=e}return this}trim(e,t){const n=this.times,i=n.length;let r=0,o=i-1;for(;r!==i&&n[r]<e;)++r;for(;o!==-1&&n[o]>t;)--o;if(++o,r!==0||o!==i){r>=o&&(o=Math.max(o,1),r=o-1);const a=this.getValueSize();this.times=n.slice(r,o),this.values=this.values.slice(r*a,o*a)}return this}validate(){let e=!0;const t=this.getValueSize();t-Math.floor(t)!==0&&(console.error("THREE.KeyframeTrack: Invalid value size in track.",this),e=!1);const n=this.times,i=this.values,r=n.length;r===0&&(console.error("THREE.KeyframeTrack: Track is empty.",this),e=!1);let o=null;for(let a=0;a!==r;a++){const c=n[a];if(typeof c=="number"&&isNaN(c)){console.error("THREE.KeyframeTrack: Time is not a valid number.",this,a,c),e=!1;break}if(o!==null&&o>c){console.error("THREE.KeyframeTrack: Out of order keys.",this,a,c,o),e=!1;break}o=c}if(i!==void 0&&Fd(i))for(let a=0,c=i.length;a!==c;++a){const l=i[a];if(isNaN(l)){console.error("THREE.KeyframeTrack: Value is not a valid number.",this,a,l),e=!1;break}}return e}optimize(){const e=this.times.slice(),t=this.values.slice(),n=this.getValueSize(),i=this.getInterpolation()===Fr,r=e.length-1;let o=1;for(let a=1;a<r;++a){let c=!1;const l=e[a],u=e[a+1];if(l!==u&&(a!==1||l!==e[0]))if(i)c=!0;else{const h=a*n,d=h-n,f=h+n;for(let m=0;m!==n;++m){const g=t[h+m];if(g!==t[d+m]||g!==t[f+m]){c=!0;break}}}if(c){if(a!==o){e[o]=e[a];const h=a*n,d=o*n;for(let f=0;f!==n;++f)t[d+f]=t[h+f]}++o}}if(r>0){e[o]=e[r];for(let a=r*n,c=o*n,l=0;l!==n;++l)t[c+l]=t[a+l];++o}return o!==e.length?(this.times=e.slice(0,o),this.values=t.slice(0,o*n)):(this.times=e,this.values=t),this}clone(){const e=this.times.slice(),t=this.values.slice(),n=this.constructor,i=new n(this.name,e,t);return i.createInterpolant=this.createInterpolant,i}}on.prototype.ValueTypeName="";on.prototype.TimeBufferType=Float32Array;on.prototype.ValueBufferType=Float32Array;on.prototype.DefaultInterpolation=Ps;class Ji extends on{constructor(e,t,n){super(e,t,n)}}Ji.prototype.ValueTypeName="bool";Ji.prototype.ValueBufferType=Array;Ji.prototype.DefaultInterpolation=Cs;Ji.prototype.InterpolantFactoryMethodLinear=void 0;Ji.prototype.InterpolantFactoryMethodSmooth=void 0;class du extends on{constructor(e,t,n,i){super(e,t,n,i)}}du.prototype.ValueTypeName="color";class Wi extends on{constructor(e,t,n,i){super(e,t,n,i)}}Wi.prototype.ValueTypeName="number";class Hd extends Fs{constructor(e,t,n,i){super(e,t,n,i)}interpolate_(e,t,n,i){const r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=(n-t)/(i-t);let l=e*a;for(let u=l+a;l!==u;l+=4)fn.slerpFlat(r,0,o,l-a,o,l,c);return r}}class Xi extends on{constructor(e,t,n,i){super(e,t,n,i)}InterpolantFactoryMethodLinear(e){return new Hd(this.times,this.values,this.getValueSize(),e)}}Xi.prototype.ValueTypeName="quaternion";Xi.prototype.InterpolantFactoryMethodSmooth=void 0;class Zi extends on{constructor(e,t,n){super(e,t,n)}}Zi.prototype.ValueTypeName="string";Zi.prototype.ValueBufferType=Array;Zi.prototype.DefaultInterpolation=Cs;Zi.prototype.InterpolantFactoryMethodLinear=void 0;Zi.prototype.InterpolantFactoryMethodSmooth=void 0;class ji extends on{constructor(e,t,n,i){super(e,t,n,i)}}ji.prototype.ValueTypeName="vector";class Gd{constructor(e="",t=-1,n=[],i=lh){this.name=e,this.tracks=n,this.duration=t,this.blendMode=i,this.uuid=tn(),this.userData={},this.duration<0&&this.resetDuration()}static parse(e){const t=[],n=e.tracks,i=1/(e.fps||1);for(let o=0,a=n.length;o!==a;++o)t.push(Wd(n[o]).scale(i));const r=new this(e.name,e.duration,t,e.blendMode);return r.uuid=e.uuid,r.userData=JSON.parse(e.userData||"{}"),r}static toJSON(e){const t=[],n=e.tracks,i={name:e.name,duration:e.duration,tracks:t,uuid:e.uuid,blendMode:e.blendMode,userData:JSON.stringify(e.userData)};for(let r=0,o=n.length;r!==o;++r)t.push(on.toJSON(n[r]));return i}static CreateFromMorphTargetSequence(e,t,n,i){const r=t.length,o=[];for(let a=0;a<r;a++){let c=[],l=[];c.push((a+r-1)%r,a,(a+1)%r),l.push(0,1,0);const u=Od(c);c=Jc(c,1,u),l=Jc(l,1,u),!i&&c[0]===0&&(c.push(r),l.push(l[0])),o.push(new Wi(".morphTargetInfluences["+t[a].name+"]",c,l).scale(1/n))}return new this(e,-1,o)}static findByName(e,t){let n=e;if(!Array.isArray(e)){const i=e;n=i.geometry&&i.geometry.animations||i.animations}for(let i=0;i<n.length;i++)if(n[i].name===t)return n[i];return null}static CreateClipsFromMorphTargetSequences(e,t,n){const i={},r=/^([\w-]*?)([\d]+)$/;for(let a=0,c=e.length;a<c;a++){const l=e[a],u=l.name.match(r);if(u&&u.length>1){const h=u[1];let d=i[h];d||(i[h]=d=[]),d.push(l)}}const o=[];for(const a in i)o.push(this.CreateFromMorphTargetSequence(a,i[a],t,n));return o}static parseAnimation(e,t){if(console.warn("THREE.AnimationClip: parseAnimation() is deprecated and will be removed with r185"),!e)return console.error("THREE.AnimationClip: No animation in JSONLoader data."),null;const n=function(h,d,f,m,g){if(f.length!==0){const p=[],A=[];hu(f,p,A,m),p.length!==0&&g.push(new h(d,p,A))}},i=[],r=e.name||"default",o=e.fps||30,a=e.blendMode;let c=e.length||-1;const l=e.hierarchy||[];for(let h=0;h<l.length;h++){const d=l[h].keys;if(!(!d||d.length===0))if(d[0].morphTargets){const f={};let m;for(m=0;m<d.length;m++)if(d[m].morphTargets)for(let g=0;g<d[m].morphTargets.length;g++)f[d[m].morphTargets[g]]=-1;for(const g in f){const p=[],A=[];for(let T=0;T!==d[m].morphTargets.length;++T){const y=d[m];p.push(y.time),A.push(y.morphTarget===g?1:0)}i.push(new Wi(".morphTargetInfluence["+g+"]",p,A))}c=f.length*o}else{const f=".bones["+t[h].name+"]";n(ji,f+".position",d,"pos",i),n(Xi,f+".quaternion",d,"rot",i),n(ji,f+".scale",d,"scl",i)}}return i.length===0?null:new this(r,c,i,a)}resetDuration(){const e=this.tracks;let t=0;for(let n=0,i=e.length;n!==i;++n){const r=this.tracks[n];t=Math.max(t,r.times[r.times.length-1])}return this.duration=t,this}trim(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].trim(0,this.duration);return this}validate(){let e=!0;for(let t=0;t<this.tracks.length;t++)e=e&&this.tracks[t].validate();return e}optimize(){for(let e=0;e<this.tracks.length;e++)this.tracks[e].optimize();return this}clone(){const e=[];for(let n=0;n<this.tracks.length;n++)e.push(this.tracks[n].clone());const t=new this.constructor(this.name,this.duration,e,this.blendMode);return t.userData=JSON.parse(JSON.stringify(this.userData)),t}toJSON(){return this.constructor.toJSON(this)}}function Vd(s){switch(s.toLowerCase()){case"scalar":case"double":case"float":case"number":case"integer":return Wi;case"vector":case"vector2":case"vector3":case"vector4":return ji;case"color":return du;case"quaternion":return Xi;case"bool":case"boolean":return Ji;case"string":return Zi}throw new Error("THREE.KeyframeTrack: Unsupported typeName: "+s)}function Wd(s){if(s.type===void 0)throw new Error("THREE.KeyframeTrack: track type undefined, can not parse");const e=Vd(s.type);if(s.times===void 0){const t=[],n=[];hu(s.keys,t,n,"value"),s.times=t,s.values=n}return e.parse!==void 0?e.parse(s):new e(s.name,s.times,s.values,s.interpolation)}const En={enabled:!1,files:{},add:function(s,e){this.enabled!==!1&&(this.files[s]=e)},get:function(s){if(this.enabled!==!1)return this.files[s]},remove:function(s){delete this.files[s]},clear:function(){this.files={}}};class Xd{constructor(e,t,n){const i=this;let r=!1,o=0,a=0,c;const l=[];this.onStart=void 0,this.onLoad=e,this.onProgress=t,this.onError=n,this.abortController=new AbortController,this.itemStart=function(u){a++,r===!1&&i.onStart!==void 0&&i.onStart(u,o,a),r=!0},this.itemEnd=function(u){o++,i.onProgress!==void 0&&i.onProgress(u,o,a),o===a&&(r=!1,i.onLoad!==void 0&&i.onLoad())},this.itemError=function(u){i.onError!==void 0&&i.onError(u)},this.resolveURL=function(u){return c?c(u):u},this.setURLModifier=function(u){return c=u,this},this.addHandler=function(u,h){return l.push(u,h),this},this.removeHandler=function(u){const h=l.indexOf(u);return h!==-1&&l.splice(h,2),this},this.getHandler=function(u){for(let h=0,d=l.length;h<d;h+=2){const f=l[h],m=l[h+1];if(f.global&&(f.lastIndex=0),f.test(u))return m}return null},this.abort=function(){return this.abortController.abort(),this.abortController=new AbortController,this}}}const jd=new Xd;class $i{constructor(e){this.manager=e!==void 0?e:jd,this.crossOrigin="anonymous",this.withCredentials=!1,this.path="",this.resourcePath="",this.requestHeader={}}load(){}loadAsync(e,t){const n=this;return new Promise(function(i,r){n.load(e,i,t,r)})}parse(){}setCrossOrigin(e){return this.crossOrigin=e,this}setWithCredentials(e){return this.withCredentials=e,this}setPath(e){return this.path=e,this}setResourcePath(e){return this.resourcePath=e,this}setRequestHeader(e){return this.requestHeader=e,this}abort(){return this}}$i.DEFAULT_MATERIAL_NAME="__DEFAULT";const yn={};class Qd extends Error{constructor(e,t){super(e),this.response=t}}class fu extends $i{constructor(e){super(e),this.mimeType="",this.responseType="",this._abortController=new AbortController}load(e,t,n,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const r=En.get(`file:${e}`);if(r!==void 0)return this.manager.itemStart(e),setTimeout(()=>{t&&t(r),this.manager.itemEnd(e)},0),r;if(yn[e]!==void 0){yn[e].push({onLoad:t,onProgress:n,onError:i});return}yn[e]=[],yn[e].push({onLoad:t,onProgress:n,onError:i});const o=new Request(e,{headers:new Headers(this.requestHeader),credentials:this.withCredentials?"include":"same-origin",signal:typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal}),a=this.mimeType,c=this.responseType;fetch(o).then(l=>{if(l.status===200||l.status===0){if(l.status===0&&console.warn("THREE.FileLoader: HTTP Status 0 received."),typeof ReadableStream>"u"||l.body===void 0||l.body.getReader===void 0)return l;const u=yn[e],h=l.body.getReader(),d=l.headers.get("X-File-Size")||l.headers.get("Content-Length"),f=d?parseInt(d):0,m=f!==0;let g=0;const p=new ReadableStream({start(A){T();function T(){h.read().then(({done:y,value:v})=>{if(y)A.close();else{g+=v.byteLength;const w=new ProgressEvent("progress",{lengthComputable:m,loaded:g,total:f});for(let E=0,C=u.length;E<C;E++){const P=u[E];P.onProgress&&P.onProgress(w)}A.enqueue(v),T()}},y=>{A.error(y)})}}});return new Response(p)}else throw new Qd(`fetch for "${l.url}" responded with ${l.status}: ${l.statusText}`,l)}).then(l=>{switch(c){case"arraybuffer":return l.arrayBuffer();case"blob":return l.blob();case"document":return l.text().then(u=>new DOMParser().parseFromString(u,a));case"json":return l.json();default:if(a==="")return l.text();{const h=/charset="?([^;"\s]*)"?/i.exec(a),d=h&&h[1]?h[1].toLowerCase():void 0,f=new TextDecoder(d);return l.arrayBuffer().then(m=>f.decode(m))}}}).then(l=>{En.add(`file:${e}`,l);const u=yn[e];delete yn[e];for(let h=0,d=u.length;h<d;h++){const f=u[h];f.onLoad&&f.onLoad(l)}}).catch(l=>{const u=yn[e];if(u===void 0)throw this.manager.itemError(e),l;delete yn[e];for(let h=0,d=u.length;h<d;h++){const f=u[h];f.onError&&f.onError(l)}this.manager.itemError(e)}).finally(()=>{this.manager.itemEnd(e)}),this.manager.itemStart(e)}setResponseType(e){return this.responseType=e,this}setMimeType(e){return this.mimeType=e,this}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}}const Ii=new WeakMap;class Kd extends $i{constructor(e){super(e)}load(e,t,n,i){this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const r=this,o=En.get(`image:${e}`);if(o!==void 0){if(o.complete===!0)r.manager.itemStart(e),setTimeout(function(){t&&t(o),r.manager.itemEnd(e)},0);else{let h=Ii.get(o);h===void 0&&(h=[],Ii.set(o,h)),h.push({onLoad:t,onError:i})}return o}const a=Rs("img");function c(){u(),t&&t(this);const h=Ii.get(this)||[];for(let d=0;d<h.length;d++){const f=h[d];f.onLoad&&f.onLoad(this)}Ii.delete(this),r.manager.itemEnd(e)}function l(h){u(),i&&i(h),En.remove(`image:${e}`);const d=Ii.get(this)||[];for(let f=0;f<d.length;f++){const m=d[f];m.onError&&m.onError(h)}Ii.delete(this),r.manager.itemError(e),r.manager.itemEnd(e)}function u(){a.removeEventListener("load",c,!1),a.removeEventListener("error",l,!1)}return a.addEventListener("load",c,!1),a.addEventListener("error",l,!1),e.slice(0,5)!=="data:"&&this.crossOrigin!==void 0&&(a.crossOrigin=this.crossOrigin),En.add(`image:${e}`,a),r.manager.itemStart(e),a.src=e,a}}class Yd extends $i{constructor(e){super(e)}load(e,t,n,i){const r=new gt,o=new Kd(this.manager);return o.setCrossOrigin(this.crossOrigin),o.setPath(this.path),o.load(e,function(a){r.image=a,r.needsUpdate=!0,t!==void 0&&t(r)},n,i),r}}class Ir extends ot{constructor(e,t=1){super(),this.isLight=!0,this.type="Light",this.color=new be(e),this.intensity=t}dispose(){}copy(e,t){return super.copy(e,t),this.color.copy(e.color),this.intensity=e.intensity,this}toJSON(e){const t=super.toJSON(e);return t.object.color=this.color.getHex(),t.object.intensity=this.intensity,this.groundColor!==void 0&&(t.object.groundColor=this.groundColor.getHex()),this.distance!==void 0&&(t.object.distance=this.distance),this.angle!==void 0&&(t.object.angle=this.angle),this.decay!==void 0&&(t.object.decay=this.decay),this.penumbra!==void 0&&(t.object.penumbra=this.penumbra),this.shadow!==void 0&&(t.object.shadow=this.shadow.toJSON()),this.target!==void 0&&(t.object.target=this.target.uuid),t}}class qd extends Ir{constructor(e,t,n){super(e,n),this.isHemisphereLight=!0,this.type="HemisphereLight",this.position.copy(ot.DEFAULT_UP),this.updateMatrix(),this.groundColor=new be(t)}copy(e,t){return super.copy(e,t),this.groundColor.copy(e.groundColor),this}}const fo=new Ne,Zc=new R,$c=new R;class Wa{constructor(e){this.camera=e,this.intensity=1,this.bias=0,this.normalBias=0,this.radius=1,this.blurSamples=8,this.mapSize=new fe(512,512),this.mapType=dn,this.map=null,this.mapPass=null,this.matrix=new Ne,this.autoUpdate=!0,this.needsUpdate=!1,this._frustum=new Oa,this._frameExtents=new fe(1,1),this._viewportCount=1,this._viewports=[new qe(0,0,1,1)]}getViewportCount(){return this._viewportCount}getFrustum(){return this._frustum}updateMatrices(e){const t=this.camera,n=this.matrix;Zc.setFromMatrixPosition(e.matrixWorld),t.position.copy(Zc),$c.setFromMatrixPosition(e.target.matrixWorld),t.lookAt($c),t.updateMatrixWorld(),fo.multiplyMatrices(t.projectionMatrix,t.matrixWorldInverse),this._frustum.setFromProjectionMatrix(fo,t.coordinateSystem,t.reversedDepth),t.reversedDepth?n.set(.5,0,0,.5,0,.5,0,.5,0,0,1,0,0,0,0,1):n.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),n.multiply(fo)}getViewport(e){return this._viewports[e]}getFrameExtents(){return this._frameExtents}dispose(){this.map&&this.map.dispose(),this.mapPass&&this.mapPass.dispose()}copy(e){return this.camera=e.camera.clone(),this.intensity=e.intensity,this.bias=e.bias,this.radius=e.radius,this.autoUpdate=e.autoUpdate,this.needsUpdate=e.needsUpdate,this.normalBias=e.normalBias,this.blurSamples=e.blurSamples,this.mapSize.copy(e.mapSize),this}clone(){return new this.constructor().copy(this)}toJSON(){const e={};return this.intensity!==1&&(e.intensity=this.intensity),this.bias!==0&&(e.bias=this.bias),this.normalBias!==0&&(e.normalBias=this.normalBias),this.radius!==1&&(e.radius=this.radius),(this.mapSize.x!==512||this.mapSize.y!==512)&&(e.mapSize=this.mapSize.toArray()),e.camera=this.camera.toJSON(!1).object,delete e.camera.matrix,e}}class Jd extends Wa{constructor(){super(new Dt(50,1,.5,500)),this.isSpotLightShadow=!0,this.focus=1,this.aspect=1}updateMatrices(e){const t=this.camera,n=Gi*2*e.angle*this.focus,i=this.mapSize.width/this.mapSize.height*this.aspect,r=e.distance||t.far;(n!==t.fov||i!==t.aspect||r!==t.far)&&(t.fov=n,t.aspect=i,t.far=r,t.updateProjectionMatrix()),super.updateMatrices(e)}copy(e){return super.copy(e),this.focus=e.focus,this}}class Zd extends Ir{constructor(e,t,n=0,i=Math.PI/3,r=0,o=2){super(e,t),this.isSpotLight=!0,this.type="SpotLight",this.position.copy(ot.DEFAULT_UP),this.updateMatrix(),this.target=new ot,this.distance=n,this.angle=i,this.penumbra=r,this.decay=o,this.map=null,this.shadow=new Jd}get power(){return this.intensity*Math.PI}set power(e){this.intensity=e/Math.PI}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.angle=e.angle,this.penumbra=e.penumbra,this.decay=e.decay,this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}const el=new Ne,fs=new R,Ao=new R;class $d extends Wa{constructor(){super(new Dt(90,1,.5,500)),this.isPointLightShadow=!0,this._frameExtents=new fe(4,2),this._viewportCount=6,this._viewports=[new qe(2,1,1,1),new qe(0,1,1,1),new qe(3,1,1,1),new qe(1,1,1,1),new qe(3,0,1,1),new qe(1,0,1,1)],this._cubeDirections=[new R(1,0,0),new R(-1,0,0),new R(0,0,1),new R(0,0,-1),new R(0,1,0),new R(0,-1,0)],this._cubeUps=[new R(0,1,0),new R(0,1,0),new R(0,1,0),new R(0,1,0),new R(0,0,1),new R(0,0,-1)]}updateMatrices(e,t=0){const n=this.camera,i=this.matrix,r=e.distance||n.far;r!==n.far&&(n.far=r,n.updateProjectionMatrix()),fs.setFromMatrixPosition(e.matrixWorld),n.position.copy(fs),Ao.copy(n.position),Ao.add(this._cubeDirections[t]),n.up.copy(this._cubeUps[t]),n.lookAt(Ao),n.updateMatrixWorld(),i.makeTranslation(-fs.x,-fs.y,-fs.z),el.multiplyMatrices(n.projectionMatrix,n.matrixWorldInverse),this._frustum.setFromProjectionMatrix(el,n.coordinateSystem,n.reversedDepth)}}class Xa extends Ir{constructor(e,t,n=0,i=2){super(e,t),this.isPointLight=!0,this.type="PointLight",this.distance=n,this.decay=i,this.shadow=new $d}get power(){return this.intensity*4*Math.PI}set power(e){this.intensity=e/(4*Math.PI)}dispose(){this.shadow.dispose()}copy(e,t){return super.copy(e,t),this.distance=e.distance,this.decay=e.decay,this.shadow=e.shadow.clone(),this}}class ja extends Jl{constructor(e=-1,t=1,n=1,i=-1,r=.1,o=2e3){super(),this.isOrthographicCamera=!0,this.type="OrthographicCamera",this.zoom=1,this.view=null,this.left=e,this.right=t,this.top=n,this.bottom=i,this.near=r,this.far=o,this.updateProjectionMatrix()}copy(e,t){return super.copy(e,t),this.left=e.left,this.right=e.right,this.top=e.top,this.bottom=e.bottom,this.near=e.near,this.far=e.far,this.zoom=e.zoom,this.view=e.view===null?null:Object.assign({},e.view),this}setViewOffset(e,t,n,i,r,o){this.view===null&&(this.view={enabled:!0,fullWidth:1,fullHeight:1,offsetX:0,offsetY:0,width:1,height:1}),this.view.enabled=!0,this.view.fullWidth=e,this.view.fullHeight=t,this.view.offsetX=n,this.view.offsetY=i,this.view.width=r,this.view.height=o,this.updateProjectionMatrix()}clearViewOffset(){this.view!==null&&(this.view.enabled=!1),this.updateProjectionMatrix()}updateProjectionMatrix(){const e=(this.right-this.left)/(2*this.zoom),t=(this.top-this.bottom)/(2*this.zoom),n=(this.right+this.left)/2,i=(this.top+this.bottom)/2;let r=n-e,o=n+e,a=i+t,c=i-t;if(this.view!==null&&this.view.enabled){const l=(this.right-this.left)/this.view.fullWidth/this.zoom,u=(this.top-this.bottom)/this.view.fullHeight/this.zoom;r+=l*this.view.offsetX,o=r+l*this.view.width,a-=u*this.view.offsetY,c=a-u*this.view.height}this.projectionMatrix.makeOrthographic(r,o,a,c,this.near,this.far,this.coordinateSystem,this.reversedDepth),this.projectionMatrixInverse.copy(this.projectionMatrix).invert()}toJSON(e){const t=super.toJSON(e);return t.object.zoom=this.zoom,t.object.left=this.left,t.object.right=this.right,t.object.top=this.top,t.object.bottom=this.bottom,t.object.near=this.near,t.object.far=this.far,this.view!==null&&(t.object.view=Object.assign({},this.view)),t}}class ef extends Wa{constructor(){super(new ja(-5,5,5,-5,.5,500)),this.isDirectionalLightShadow=!0}}class ga extends Ir{constructor(e,t){super(e,t),this.isDirectionalLight=!0,this.type="DirectionalLight",this.position.copy(ot.DEFAULT_UP),this.updateMatrix(),this.target=new ot,this.shadow=new ef}dispose(){this.shadow.dispose()}copy(e){return super.copy(e),this.target=e.target.clone(),this.shadow=e.shadow.clone(),this}}class ys{static extractUrlBase(e){const t=e.lastIndexOf("/");return t===-1?"./":e.slice(0,t+1)}static resolveURL(e,t){return typeof e!="string"||e===""?"":(/^https?:\/\//i.test(t)&&/^\//.test(e)&&(t=t.replace(/(^https?:\/\/[^\/]+).*/i,"$1")),/^(https?:)?\/\//i.test(e)||/^data:.*,.*$/i.test(e)||/^blob:.*$/i.test(e)?e:t+e)}}const po=new WeakMap;class tf extends $i{constructor(e){super(e),this.isImageBitmapLoader=!0,typeof createImageBitmap>"u"&&console.warn("THREE.ImageBitmapLoader: createImageBitmap() not supported."),typeof fetch>"u"&&console.warn("THREE.ImageBitmapLoader: fetch() not supported."),this.options={premultiplyAlpha:"none"},this._abortController=new AbortController}setOptions(e){return this.options=e,this}load(e,t,n,i){e===void 0&&(e=""),this.path!==void 0&&(e=this.path+e),e=this.manager.resolveURL(e);const r=this,o=En.get(`image-bitmap:${e}`);if(o!==void 0){if(r.manager.itemStart(e),o.then){o.then(l=>{if(po.has(o)===!0)i&&i(po.get(o)),r.manager.itemError(e),r.manager.itemEnd(e);else return t&&t(l),r.manager.itemEnd(e),l});return}return setTimeout(function(){t&&t(o),r.manager.itemEnd(e)},0),o}const a={};a.credentials=this.crossOrigin==="anonymous"?"same-origin":"include",a.headers=this.requestHeader,a.signal=typeof AbortSignal.any=="function"?AbortSignal.any([this._abortController.signal,this.manager.abortController.signal]):this._abortController.signal;const c=fetch(e,a).then(function(l){return l.blob()}).then(function(l){return createImageBitmap(l,Object.assign(r.options,{colorSpaceConversion:"none"}))}).then(function(l){return En.add(`image-bitmap:${e}`,l),t&&t(l),r.manager.itemEnd(e),l}).catch(function(l){i&&i(l),po.set(c,l),En.remove(`image-bitmap:${e}`),r.manager.itemError(e),r.manager.itemEnd(e)});En.add(`image-bitmap:${e}`,c),r.manager.itemStart(e)}abort(){return this._abortController.abort(),this._abortController=new AbortController,this}}class nf extends Dt{constructor(e=[]){super(),this.isArrayCamera=!0,this.isMultiViewCamera=!1,this.cameras=e}}const Qa="\\[\\]\\.:\\/",sf=new RegExp("["+Qa+"]","g"),Ka="[^"+Qa+"]",rf="[^"+Qa.replace("\\.","")+"]",of=/((?:WC+[\/:])*)/.source.replace("WC",Ka),af=/(WCOD+)?/.source.replace("WCOD",rf),cf=/(?:\.(WC+)(?:\[(.+)\])?)?/.source.replace("WC",Ka),lf=/\.(WC+)(?:\[(.+)\])?/.source.replace("WC",Ka),uf=new RegExp("^"+of+af+cf+lf+"$"),hf=["material","materials","bones","map"];class df{constructor(e,t,n){const i=n||$e.parseTrackName(t);this._targetGroup=e,this._bindings=e.subscribe_(t,i)}getValue(e,t){this.bind();const n=this._targetGroup.nCachedObjects_,i=this._bindings[n];i!==void 0&&i.getValue(e,t)}setValue(e,t){const n=this._bindings;for(let i=this._targetGroup.nCachedObjects_,r=n.length;i!==r;++i)n[i].setValue(e,t)}bind(){const e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].bind()}unbind(){const e=this._bindings;for(let t=this._targetGroup.nCachedObjects_,n=e.length;t!==n;++t)e[t].unbind()}}class $e{constructor(e,t,n){this.path=t,this.parsedPath=n||$e.parseTrackName(t),this.node=$e.findNode(e,this.parsedPath.nodeName),this.rootNode=e,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}static create(e,t,n){return e&&e.isAnimationObjectGroup?new $e.Composite(e,t,n):new $e(e,t,n)}static sanitizeNodeName(e){return e.replace(/\s/g,"_").replace(sf,"")}static parseTrackName(e){const t=uf.exec(e);if(t===null)throw new Error("PropertyBinding: Cannot parse trackName: "+e);const n={nodeName:t[2],objectName:t[3],objectIndex:t[4],propertyName:t[5],propertyIndex:t[6]},i=n.nodeName&&n.nodeName.lastIndexOf(".");if(i!==void 0&&i!==-1){const r=n.nodeName.substring(i+1);hf.indexOf(r)!==-1&&(n.nodeName=n.nodeName.substring(0,i),n.objectName=r)}if(n.propertyName===null||n.propertyName.length===0)throw new Error("PropertyBinding: can not parse propertyName from trackName: "+e);return n}static findNode(e,t){if(t===void 0||t===""||t==="."||t===-1||t===e.name||t===e.uuid)return e;if(e.skeleton){const n=e.skeleton.getBoneByName(t);if(n!==void 0)return n}if(e.children){const n=function(r){for(let o=0;o<r.length;o++){const a=r[o];if(a.name===t||a.uuid===t)return a;const c=n(a.children);if(c)return c}return null},i=n(e.children);if(i)return i}return null}_getValue_unavailable(){}_setValue_unavailable(){}_getValue_direct(e,t){e[t]=this.targetObject[this.propertyName]}_getValue_array(e,t){const n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)e[t++]=n[i]}_getValue_arrayElement(e,t){e[t]=this.resolvedProperty[this.propertyIndex]}_getValue_toArray(e,t){this.resolvedProperty.toArray(e,t)}_setValue_direct(e,t){this.targetObject[this.propertyName]=e[t]}_setValue_direct_setNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.needsUpdate=!0}_setValue_direct_setMatrixWorldNeedsUpdate(e,t){this.targetObject[this.propertyName]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_array(e,t){const n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)n[i]=e[t++]}_setValue_array_setNeedsUpdate(e,t){const n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)n[i]=e[t++];this.targetObject.needsUpdate=!0}_setValue_array_setMatrixWorldNeedsUpdate(e,t){const n=this.resolvedProperty;for(let i=0,r=n.length;i!==r;++i)n[i]=e[t++];this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_arrayElement(e,t){this.resolvedProperty[this.propertyIndex]=e[t]}_setValue_arrayElement_setNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.needsUpdate=!0}_setValue_arrayElement_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty[this.propertyIndex]=e[t],this.targetObject.matrixWorldNeedsUpdate=!0}_setValue_fromArray(e,t){this.resolvedProperty.fromArray(e,t)}_setValue_fromArray_setNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.needsUpdate=!0}_setValue_fromArray_setMatrixWorldNeedsUpdate(e,t){this.resolvedProperty.fromArray(e,t),this.targetObject.matrixWorldNeedsUpdate=!0}_getValue_unbound(e,t){this.bind(),this.getValue(e,t)}_setValue_unbound(e,t){this.bind(),this.setValue(e,t)}bind(){let e=this.node;const t=this.parsedPath,n=t.objectName,i=t.propertyName;let r=t.propertyIndex;if(e||(e=$e.findNode(this.rootNode,t.nodeName),this.node=e),this.getValue=this._getValue_unavailable,this.setValue=this._setValue_unavailable,!e){console.warn("THREE.PropertyBinding: No target node found for track: "+this.path+".");return}if(n){let l=t.objectIndex;switch(n){case"materials":if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.materials){console.error("THREE.PropertyBinding: Can not bind to material.materials as node.material does not have a materials array.",this);return}e=e.material.materials;break;case"bones":if(!e.skeleton){console.error("THREE.PropertyBinding: Can not bind to bones as node does not have a skeleton.",this);return}e=e.skeleton.bones;for(let u=0;u<e.length;u++)if(e[u].name===l){l=u;break}break;case"map":if("map"in e){e=e.map;break}if(!e.material){console.error("THREE.PropertyBinding: Can not bind to material as node does not have a material.",this);return}if(!e.material.map){console.error("THREE.PropertyBinding: Can not bind to material.map as node.material does not have a map.",this);return}e=e.material.map;break;default:if(e[n]===void 0){console.error("THREE.PropertyBinding: Can not bind to objectName of node undefined.",this);return}e=e[n]}if(l!==void 0){if(e[l]===void 0){console.error("THREE.PropertyBinding: Trying to bind to objectIndex of objectName, but is undefined.",this,e);return}e=e[l]}}const o=e[i];if(o===void 0){const l=t.nodeName;console.error("THREE.PropertyBinding: Trying to update property for track: "+l+"."+i+" but it wasn't found.",e);return}let a=this.Versioning.None;this.targetObject=e,e.isMaterial===!0?a=this.Versioning.NeedsUpdate:e.isObject3D===!0&&(a=this.Versioning.MatrixWorldNeedsUpdate);let c=this.BindingType.Direct;if(r!==void 0){if(i==="morphTargetInfluences"){if(!e.geometry){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.",this);return}if(!e.geometry.morphAttributes){console.error("THREE.PropertyBinding: Can not bind to morphTargetInfluences because node does not have a geometry.morphAttributes.",this);return}e.morphTargetDictionary[r]!==void 0&&(r=e.morphTargetDictionary[r])}c=this.BindingType.ArrayElement,this.resolvedProperty=o,this.propertyIndex=r}else o.fromArray!==void 0&&o.toArray!==void 0?(c=this.BindingType.HasFromToArray,this.resolvedProperty=o):Array.isArray(o)?(c=this.BindingType.EntireArray,this.resolvedProperty=o):this.propertyName=i;this.getValue=this.GetterByBindingType[c],this.setValue=this.SetterByBindingTypeAndVersioning[c][a]}unbind(){this.node=null,this.getValue=this._getValue_unbound,this.setValue=this._setValue_unbound}}$e.Composite=df;$e.prototype.BindingType={Direct:0,EntireArray:1,ArrayElement:2,HasFromToArray:3};$e.prototype.Versioning={None:0,NeedsUpdate:1,MatrixWorldNeedsUpdate:2};$e.prototype.GetterByBindingType=[$e.prototype._getValue_direct,$e.prototype._getValue_array,$e.prototype._getValue_arrayElement,$e.prototype._getValue_toArray];$e.prototype.SetterByBindingTypeAndVersioning=[[$e.prototype._setValue_direct,$e.prototype._setValue_direct_setNeedsUpdate,$e.prototype._setValue_direct_setMatrixWorldNeedsUpdate],[$e.prototype._setValue_array,$e.prototype._setValue_array_setNeedsUpdate,$e.prototype._setValue_array_setMatrixWorldNeedsUpdate],[$e.prototype._setValue_arrayElement,$e.prototype._setValue_arrayElement_setNeedsUpdate,$e.prototype._setValue_arrayElement_setMatrixWorldNeedsUpdate],[$e.prototype._setValue_fromArray,$e.prototype._setValue_fromArray_setNeedsUpdate,$e.prototype._setValue_fromArray_setMatrixWorldNeedsUpdate]];function tl(s,e,t,n){const i=ff(n);switch(t){case Bl:return s*e;case ba:return s*e/i.components*i.byteLength;case Ca:return s*e/i.components*i.byteLength;case kl:return s*e*2/i.components*i.byteLength;case Pa:return s*e*2/i.components*i.byteLength;case zl:return s*e*3/i.components*i.byteLength;case Kt:return s*e*4/i.components*i.byteLength;case Ra:return s*e*4/i.components*i.byteLength;case gr:case vr:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*8;case _r:case xr:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*16;case ko:case Go:return Math.max(s,16)*Math.max(e,8)/4;case zo:case Ho:return Math.max(s,8)*Math.max(e,8)/2;case Vo:case Wo:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*8;case Xo:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*16;case jo:return Math.floor((s+3)/4)*Math.floor((e+3)/4)*16;case Qo:return Math.floor((s+4)/5)*Math.floor((e+3)/4)*16;case Ko:return Math.floor((s+4)/5)*Math.floor((e+4)/5)*16;case Yo:return Math.floor((s+5)/6)*Math.floor((e+4)/5)*16;case qo:return Math.floor((s+5)/6)*Math.floor((e+5)/6)*16;case Jo:return Math.floor((s+7)/8)*Math.floor((e+4)/5)*16;case Zo:return Math.floor((s+7)/8)*Math.floor((e+5)/6)*16;case $o:return Math.floor((s+7)/8)*Math.floor((e+7)/8)*16;case ea:return Math.floor((s+9)/10)*Math.floor((e+4)/5)*16;case ta:return Math.floor((s+9)/10)*Math.floor((e+5)/6)*16;case na:return Math.floor((s+9)/10)*Math.floor((e+7)/8)*16;case ia:return Math.floor((s+9)/10)*Math.floor((e+9)/10)*16;case sa:return Math.floor((s+11)/12)*Math.floor((e+9)/10)*16;case ra:return Math.floor((s+11)/12)*Math.floor((e+11)/12)*16;case oa:case aa:case ca:return Math.ceil(s/4)*Math.ceil(e/4)*16;case la:case ua:return Math.ceil(s/4)*Math.ceil(e/4)*8;case ha:case da:return Math.ceil(s/4)*Math.ceil(e/4)*16}throw new Error(`Unable to determine texture byte length for ${t} format.`)}function ff(s){switch(s){case dn:case Ul:return{byteLength:1,components:1};case Ts:case Nl:case Us:return{byteLength:2,components:1};case Ea:case wa:return{byteLength:2,components:4};case oi:case Ta:case en:return{byteLength:4,components:1};case Fl:case Ol:return{byteLength:4,components:3}}throw new Error(`Unknown texture type ${s}.`)}typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register",{detail:{revision:ya}}));typeof window<"u"&&(window.__THREE__?console.warn("WARNING: Multiple instances of Three.js being imported."):window.__THREE__=ya);/**
 * @license
 * Copyright 2010-2025 Three.js Authors
 * SPDX-License-Identifier: MIT
 */function Au(){let s=null,e=!1,t=null,n=null;function i(r,o){t(r,o),n=s.requestAnimationFrame(i)}return{start:function(){e!==!0&&t!==null&&(n=s.requestAnimationFrame(i),e=!0)},stop:function(){s.cancelAnimationFrame(n),e=!1},setAnimationLoop:function(r){t=r},setContext:function(r){s=r}}}function Af(s){const e=new WeakMap;function t(a,c){const l=a.array,u=a.usage,h=l.byteLength,d=s.createBuffer();s.bindBuffer(c,d),s.bufferData(c,l,u),a.onUploadCallback();let f;if(l instanceof Float32Array)f=s.FLOAT;else if(typeof Float16Array<"u"&&l instanceof Float16Array)f=s.HALF_FLOAT;else if(l instanceof Uint16Array)a.isFloat16BufferAttribute?f=s.HALF_FLOAT:f=s.UNSIGNED_SHORT;else if(l instanceof Int16Array)f=s.SHORT;else if(l instanceof Uint32Array)f=s.UNSIGNED_INT;else if(l instanceof Int32Array)f=s.INT;else if(l instanceof Int8Array)f=s.BYTE;else if(l instanceof Uint8Array)f=s.UNSIGNED_BYTE;else if(l instanceof Uint8ClampedArray)f=s.UNSIGNED_BYTE;else throw new Error("THREE.WebGLAttributes: Unsupported buffer data format: "+l);return{buffer:d,type:f,bytesPerElement:l.BYTES_PER_ELEMENT,version:a.version,size:h}}function n(a,c,l){const u=c.array,h=c.updateRanges;if(s.bindBuffer(l,a),h.length===0)s.bufferSubData(l,0,u);else{h.sort((f,m)=>f.start-m.start);let d=0;for(let f=1;f<h.length;f++){const m=h[d],g=h[f];g.start<=m.start+m.count+1?m.count=Math.max(m.count,g.start+g.count-m.start):(++d,h[d]=g)}h.length=d+1;for(let f=0,m=h.length;f<m;f++){const g=h[f];s.bufferSubData(l,g.start*u.BYTES_PER_ELEMENT,u,g.start,g.count)}c.clearUpdateRanges()}c.onUploadCallback()}function i(a){return a.isInterleavedBufferAttribute&&(a=a.data),e.get(a)}function r(a){a.isInterleavedBufferAttribute&&(a=a.data);const c=e.get(a);c&&(s.deleteBuffer(c.buffer),e.delete(a))}function o(a,c){if(a.isInterleavedBufferAttribute&&(a=a.data),a.isGLBufferAttribute){const u=e.get(a);(!u||u.version<a.version)&&e.set(a,{buffer:a.buffer,type:a.type,bytesPerElement:a.elementSize,version:a.version});return}const l=e.get(a);if(l===void 0)e.set(a,t(a,c));else if(l.version<a.version){if(l.size!==a.array.byteLength)throw new Error("THREE.WebGLAttributes: The size of the buffer attribute's array buffer does not match the original size. Resizing buffer attributes is not supported.");n(l.buffer,a,c),l.version=a.version}}return{get:i,remove:r,update:o}}var pf=`#ifdef USE_ALPHAHASH
	if ( diffuseColor.a < getAlphaHashThreshold( vPosition ) ) discard;
#endif`,mf=`#ifdef USE_ALPHAHASH
	const float ALPHA_HASH_SCALE = 0.05;
	float hash2D( vec2 value ) {
		return fract( 1.0e4 * sin( 17.0 * value.x + 0.1 * value.y ) * ( 0.1 + abs( sin( 13.0 * value.y + value.x ) ) ) );
	}
	float hash3D( vec3 value ) {
		return hash2D( vec2( hash2D( value.xy ), value.z ) );
	}
	float getAlphaHashThreshold( vec3 position ) {
		float maxDeriv = max(
			length( dFdx( position.xyz ) ),
			length( dFdy( position.xyz ) )
		);
		float pixScale = 1.0 / ( ALPHA_HASH_SCALE * maxDeriv );
		vec2 pixScales = vec2(
			exp2( floor( log2( pixScale ) ) ),
			exp2( ceil( log2( pixScale ) ) )
		);
		vec2 alpha = vec2(
			hash3D( floor( pixScales.x * position.xyz ) ),
			hash3D( floor( pixScales.y * position.xyz ) )
		);
		float lerpFactor = fract( log2( pixScale ) );
		float x = ( 1.0 - lerpFactor ) * alpha.x + lerpFactor * alpha.y;
		float a = min( lerpFactor, 1.0 - lerpFactor );
		vec3 cases = vec3(
			x * x / ( 2.0 * a * ( 1.0 - a ) ),
			( x - 0.5 * a ) / ( 1.0 - a ),
			1.0 - ( ( 1.0 - x ) * ( 1.0 - x ) / ( 2.0 * a * ( 1.0 - a ) ) )
		);
		float threshold = ( x < ( 1.0 - a ) )
			? ( ( x < a ) ? cases.x : cases.y )
			: cases.z;
		return clamp( threshold , 1.0e-6, 1.0 );
	}
#endif`,gf=`#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g;
#endif`,vf=`#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,_f=`#ifdef USE_ALPHATEST
	#ifdef ALPHA_TO_COVERAGE
	diffuseColor.a = smoothstep( alphaTest, alphaTest + fwidth( diffuseColor.a ), diffuseColor.a );
	if ( diffuseColor.a == 0.0 ) discard;
	#else
	if ( diffuseColor.a < alphaTest ) discard;
	#endif
#endif`,xf=`#ifdef USE_ALPHATEST
	uniform float alphaTest;
#endif`,Mf=`#ifdef USE_AOMAP
	float ambientOcclusion = ( texture2D( aoMap, vAoMapUv ).r - 1.0 ) * aoMapIntensity + 1.0;
	reflectedLight.indirectDiffuse *= ambientOcclusion;
	#if defined( USE_CLEARCOAT ) 
		clearcoatSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_SHEEN ) 
		sheenSpecularIndirect *= ambientOcclusion;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD )
		float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
		reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
	#endif
#endif`,yf=`#ifdef USE_AOMAP
	uniform sampler2D aoMap;
	uniform float aoMapIntensity;
#endif`,Sf=`#ifdef USE_BATCHING
	#if ! defined( GL_ANGLE_multi_draw )
	#define gl_DrawID _gl_DrawID
	uniform int _gl_DrawID;
	#endif
	uniform highp sampler2D batchingTexture;
	uniform highp usampler2D batchingIdTexture;
	mat4 getBatchingMatrix( const in float i ) {
		int size = textureSize( batchingTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( batchingTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( batchingTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( batchingTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( batchingTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
	float getIndirectIndex( const in int i ) {
		int size = textureSize( batchingIdTexture, 0 ).x;
		int x = i % size;
		int y = i / size;
		return float( texelFetch( batchingIdTexture, ivec2( x, y ), 0 ).r );
	}
#endif
#ifdef USE_BATCHING_COLOR
	uniform sampler2D batchingColorTexture;
	vec3 getBatchingColor( const in float i ) {
		int size = textureSize( batchingColorTexture, 0 ).x;
		int j = int( i );
		int x = j % size;
		int y = j / size;
		return texelFetch( batchingColorTexture, ivec2( x, y ), 0 ).rgb;
	}
#endif`,Tf=`#ifdef USE_BATCHING
	mat4 batchingMatrix = getBatchingMatrix( getIndirectIndex( gl_DrawID ) );
#endif`,Ef=`vec3 transformed = vec3( position );
#ifdef USE_ALPHAHASH
	vPosition = vec3( position );
#endif`,wf=`vec3 objectNormal = vec3( normal );
#ifdef USE_TANGENT
	vec3 objectTangent = vec3( tangent.xyz );
#endif`,bf=`float G_BlinnPhong_Implicit( ) {
	return 0.25;
}
float D_BlinnPhong( const in float shininess, const in float dotNH ) {
	return RECIPROCAL_PI * ( shininess * 0.5 + 1.0 ) * pow( dotNH, shininess );
}
vec3 BRDF_BlinnPhong( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in vec3 specularColor, const in float shininess ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( specularColor, 1.0, dotVH );
	float G = G_BlinnPhong_Implicit( );
	float D = D_BlinnPhong( shininess, dotNH );
	return F * ( G * D );
} // validated`,Cf=`#ifdef USE_IRIDESCENCE
	const mat3 XYZ_TO_REC709 = mat3(
		 3.2404542, -0.9692660,  0.0556434,
		-1.5371385,  1.8760108, -0.2040259,
		-0.4985314,  0.0415560,  1.0572252
	);
	vec3 Fresnel0ToIor( vec3 fresnel0 ) {
		vec3 sqrtF0 = sqrt( fresnel0 );
		return ( vec3( 1.0 ) + sqrtF0 ) / ( vec3( 1.0 ) - sqrtF0 );
	}
	vec3 IorToFresnel0( vec3 transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - vec3( incidentIor ) ) / ( transmittedIor + vec3( incidentIor ) ) );
	}
	float IorToFresnel0( float transmittedIor, float incidentIor ) {
		return pow2( ( transmittedIor - incidentIor ) / ( transmittedIor + incidentIor ));
	}
	vec3 evalSensitivity( float OPD, vec3 shift ) {
		float phase = 2.0 * PI * OPD * 1.0e-9;
		vec3 val = vec3( 5.4856e-13, 4.4201e-13, 5.2481e-13 );
		vec3 pos = vec3( 1.6810e+06, 1.7953e+06, 2.2084e+06 );
		vec3 var = vec3( 4.3278e+09, 9.3046e+09, 6.6121e+09 );
		vec3 xyz = val * sqrt( 2.0 * PI * var ) * cos( pos * phase + shift ) * exp( - pow2( phase ) * var );
		xyz.x += 9.7470e-14 * sqrt( 2.0 * PI * 4.5282e+09 ) * cos( 2.2399e+06 * phase + shift[ 0 ] ) * exp( - 4.5282e+09 * pow2( phase ) );
		xyz /= 1.0685e-7;
		vec3 rgb = XYZ_TO_REC709 * xyz;
		return rgb;
	}
	vec3 evalIridescence( float outsideIOR, float eta2, float cosTheta1, float thinFilmThickness, vec3 baseF0 ) {
		vec3 I;
		float iridescenceIOR = mix( outsideIOR, eta2, smoothstep( 0.0, 0.03, thinFilmThickness ) );
		float sinTheta2Sq = pow2( outsideIOR / iridescenceIOR ) * ( 1.0 - pow2( cosTheta1 ) );
		float cosTheta2Sq = 1.0 - sinTheta2Sq;
		if ( cosTheta2Sq < 0.0 ) {
			return vec3( 1.0 );
		}
		float cosTheta2 = sqrt( cosTheta2Sq );
		float R0 = IorToFresnel0( iridescenceIOR, outsideIOR );
		float R12 = F_Schlick( R0, 1.0, cosTheta1 );
		float T121 = 1.0 - R12;
		float phi12 = 0.0;
		if ( iridescenceIOR < outsideIOR ) phi12 = PI;
		float phi21 = PI - phi12;
		vec3 baseIOR = Fresnel0ToIor( clamp( baseF0, 0.0, 0.9999 ) );		vec3 R1 = IorToFresnel0( baseIOR, iridescenceIOR );
		vec3 R23 = F_Schlick( R1, 1.0, cosTheta2 );
		vec3 phi23 = vec3( 0.0 );
		if ( baseIOR[ 0 ] < iridescenceIOR ) phi23[ 0 ] = PI;
		if ( baseIOR[ 1 ] < iridescenceIOR ) phi23[ 1 ] = PI;
		if ( baseIOR[ 2 ] < iridescenceIOR ) phi23[ 2 ] = PI;
		float OPD = 2.0 * iridescenceIOR * thinFilmThickness * cosTheta2;
		vec3 phi = vec3( phi21 ) + phi23;
		vec3 R123 = clamp( R12 * R23, 1e-5, 0.9999 );
		vec3 r123 = sqrt( R123 );
		vec3 Rs = pow2( T121 ) * R23 / ( vec3( 1.0 ) - R123 );
		vec3 C0 = R12 + Rs;
		I = C0;
		vec3 Cm = Rs - T121;
		for ( int m = 1; m <= 2; ++ m ) {
			Cm *= r123;
			vec3 Sm = 2.0 * evalSensitivity( float( m ) * OPD, float( m ) * phi );
			I += Cm * Sm;
		}
		return max( I, vec3( 0.0 ) );
	}
#endif`,Pf=`#ifdef USE_BUMPMAP
	uniform sampler2D bumpMap;
	uniform float bumpScale;
	vec2 dHdxy_fwd() {
		vec2 dSTdx = dFdx( vBumpMapUv );
		vec2 dSTdy = dFdy( vBumpMapUv );
		float Hll = bumpScale * texture2D( bumpMap, vBumpMapUv ).x;
		float dBx = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdx ).x - Hll;
		float dBy = bumpScale * texture2D( bumpMap, vBumpMapUv + dSTdy ).x - Hll;
		return vec2( dBx, dBy );
	}
	vec3 perturbNormalArb( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
		vec3 vSigmaX = normalize( dFdx( surf_pos.xyz ) );
		vec3 vSigmaY = normalize( dFdy( surf_pos.xyz ) );
		vec3 vN = surf_norm;
		vec3 R1 = cross( vSigmaY, vN );
		vec3 R2 = cross( vN, vSigmaX );
		float fDet = dot( vSigmaX, R1 ) * faceDirection;
		vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
		return normalize( abs( fDet ) * surf_norm - vGrad );
	}
#endif`,Rf=`#if NUM_CLIPPING_PLANES > 0
	vec4 plane;
	#ifdef ALPHA_TO_COVERAGE
		float distanceToPlane, distanceGradient;
		float clipOpacity = 1.0;
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
			distanceGradient = fwidth( distanceToPlane ) / 2.0;
			clipOpacity *= smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			if ( clipOpacity == 0.0 ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			float unionClipOpacity = 1.0;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				distanceToPlane = - dot( vClipPosition, plane.xyz ) + plane.w;
				distanceGradient = fwidth( distanceToPlane ) / 2.0;
				unionClipOpacity *= 1.0 - smoothstep( - distanceGradient, distanceGradient, distanceToPlane );
			}
			#pragma unroll_loop_end
			clipOpacity *= 1.0 - unionClipOpacity;
		#endif
		diffuseColor.a *= clipOpacity;
		if ( diffuseColor.a == 0.0 ) discard;
	#else
		#pragma unroll_loop_start
		for ( int i = 0; i < UNION_CLIPPING_PLANES; i ++ ) {
			plane = clippingPlanes[ i ];
			if ( dot( vClipPosition, plane.xyz ) > plane.w ) discard;
		}
		#pragma unroll_loop_end
		#if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
			bool clipped = true;
			#pragma unroll_loop_start
			for ( int i = UNION_CLIPPING_PLANES; i < NUM_CLIPPING_PLANES; i ++ ) {
				plane = clippingPlanes[ i ];
				clipped = ( dot( vClipPosition, plane.xyz ) > plane.w ) && clipped;
			}
			#pragma unroll_loop_end
			if ( clipped ) discard;
		#endif
	#endif
#endif`,Df=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
	uniform vec4 clippingPlanes[ NUM_CLIPPING_PLANES ];
#endif`,If=`#if NUM_CLIPPING_PLANES > 0
	varying vec3 vClipPosition;
#endif`,Lf=`#if NUM_CLIPPING_PLANES > 0
	vClipPosition = - mvPosition.xyz;
#endif`,Uf=`#if defined( USE_COLOR_ALPHA )
	diffuseColor *= vColor;
#elif defined( USE_COLOR )
	diffuseColor.rgb *= vColor;
#endif`,Nf=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR )
	varying vec3 vColor;
#endif`,Ff=`#if defined( USE_COLOR_ALPHA )
	varying vec4 vColor;
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	varying vec3 vColor;
#endif`,Of=`#if defined( USE_COLOR_ALPHA )
	vColor = vec4( 1.0 );
#elif defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR ) || defined( USE_BATCHING_COLOR )
	vColor = vec3( 1.0 );
#endif
#ifdef USE_COLOR
	vColor *= color;
#endif
#ifdef USE_INSTANCING_COLOR
	vColor.xyz *= instanceColor.xyz;
#endif
#ifdef USE_BATCHING_COLOR
	vec3 batchingColor = getBatchingColor( getIndirectIndex( gl_DrawID ) );
	vColor.xyz *= batchingColor.xyz;
#endif`,Bf=`#define PI 3.141592653589793
#define PI2 6.283185307179586
#define PI_HALF 1.5707963267948966
#define RECIPROCAL_PI 0.3183098861837907
#define RECIPROCAL_PI2 0.15915494309189535
#define EPSILON 1e-6
#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
#define whiteComplement( a ) ( 1.0 - saturate( a ) )
float pow2( const in float x ) { return x*x; }
vec3 pow2( const in vec3 x ) { return x*x; }
float pow3( const in float x ) { return x*x*x; }
float pow4( const in float x ) { float x2 = x*x; return x2*x2; }
float max3( const in vec3 v ) { return max( max( v.x, v.y ), v.z ); }
float average( const in vec3 v ) { return dot( v, vec3( 0.3333333 ) ); }
highp float rand( const in vec2 uv ) {
	const highp float a = 12.9898, b = 78.233, c = 43758.5453;
	highp float dt = dot( uv.xy, vec2( a,b ) ), sn = mod( dt, PI );
	return fract( sin( sn ) * c );
}
#ifdef HIGH_PRECISION
	float precisionSafeLength( vec3 v ) { return length( v ); }
#else
	float precisionSafeLength( vec3 v ) {
		float maxComponent = max3( abs( v ) );
		return length( v / maxComponent ) * maxComponent;
	}
#endif
struct IncidentLight {
	vec3 color;
	vec3 direction;
	bool visible;
};
struct ReflectedLight {
	vec3 directDiffuse;
	vec3 directSpecular;
	vec3 indirectDiffuse;
	vec3 indirectSpecular;
};
#ifdef USE_ALPHAHASH
	varying vec3 vPosition;
#endif
vec3 transformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( matrix * vec4( dir, 0.0 ) ).xyz );
}
vec3 inverseTransformDirection( in vec3 dir, in mat4 matrix ) {
	return normalize( ( vec4( dir, 0.0 ) * matrix ).xyz );
}
mat3 transposeMat3( const in mat3 m ) {
	mat3 tmp;
	tmp[ 0 ] = vec3( m[ 0 ].x, m[ 1 ].x, m[ 2 ].x );
	tmp[ 1 ] = vec3( m[ 0 ].y, m[ 1 ].y, m[ 2 ].y );
	tmp[ 2 ] = vec3( m[ 0 ].z, m[ 1 ].z, m[ 2 ].z );
	return tmp;
}
bool isPerspectiveMatrix( mat4 m ) {
	return m[ 2 ][ 3 ] == - 1.0;
}
vec2 equirectUv( in vec3 dir ) {
	float u = atan( dir.z, dir.x ) * RECIPROCAL_PI2 + 0.5;
	float v = asin( clamp( dir.y, - 1.0, 1.0 ) ) * RECIPROCAL_PI + 0.5;
	return vec2( u, v );
}
vec3 BRDF_Lambert( const in vec3 diffuseColor ) {
	return RECIPROCAL_PI * diffuseColor;
}
vec3 F_Schlick( const in vec3 f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
}
float F_Schlick( const in float f0, const in float f90, const in float dotVH ) {
	float fresnel = exp2( ( - 5.55473 * dotVH - 6.98316 ) * dotVH );
	return f0 * ( 1.0 - fresnel ) + ( f90 * fresnel );
} // validated`,zf=`#ifdef ENVMAP_TYPE_CUBE_UV
	#define cubeUV_minMipLevel 4.0
	#define cubeUV_minTileSize 16.0
	float getFace( vec3 direction ) {
		vec3 absDirection = abs( direction );
		float face = - 1.0;
		if ( absDirection.x > absDirection.z ) {
			if ( absDirection.x > absDirection.y )
				face = direction.x > 0.0 ? 0.0 : 3.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		} else {
			if ( absDirection.z > absDirection.y )
				face = direction.z > 0.0 ? 2.0 : 5.0;
			else
				face = direction.y > 0.0 ? 1.0 : 4.0;
		}
		return face;
	}
	vec2 getUV( vec3 direction, float face ) {
		vec2 uv;
		if ( face == 0.0 ) {
			uv = vec2( direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 1.0 ) {
			uv = vec2( - direction.x, - direction.z ) / abs( direction.y );
		} else if ( face == 2.0 ) {
			uv = vec2( - direction.x, direction.y ) / abs( direction.z );
		} else if ( face == 3.0 ) {
			uv = vec2( - direction.z, direction.y ) / abs( direction.x );
		} else if ( face == 4.0 ) {
			uv = vec2( - direction.x, direction.z ) / abs( direction.y );
		} else {
			uv = vec2( direction.x, direction.y ) / abs( direction.z );
		}
		return 0.5 * ( uv + 1.0 );
	}
	vec3 bilinearCubeUV( sampler2D envMap, vec3 direction, float mipInt ) {
		float face = getFace( direction );
		float filterInt = max( cubeUV_minMipLevel - mipInt, 0.0 );
		mipInt = max( mipInt, cubeUV_minMipLevel );
		float faceSize = exp2( mipInt );
		highp vec2 uv = getUV( direction, face ) * ( faceSize - 2.0 ) + 1.0;
		if ( face > 2.0 ) {
			uv.y += faceSize;
			face -= 3.0;
		}
		uv.x += face * faceSize;
		uv.x += filterInt * 3.0 * cubeUV_minTileSize;
		uv.y += 4.0 * ( exp2( CUBEUV_MAX_MIP ) - faceSize );
		uv.x *= CUBEUV_TEXEL_WIDTH;
		uv.y *= CUBEUV_TEXEL_HEIGHT;
		#ifdef texture2DGradEXT
			return texture2DGradEXT( envMap, uv, vec2( 0.0 ), vec2( 0.0 ) ).rgb;
		#else
			return texture2D( envMap, uv ).rgb;
		#endif
	}
	#define cubeUV_r0 1.0
	#define cubeUV_m0 - 2.0
	#define cubeUV_r1 0.8
	#define cubeUV_m1 - 1.0
	#define cubeUV_r4 0.4
	#define cubeUV_m4 2.0
	#define cubeUV_r5 0.305
	#define cubeUV_m5 3.0
	#define cubeUV_r6 0.21
	#define cubeUV_m6 4.0
	float roughnessToMip( float roughness ) {
		float mip = 0.0;
		if ( roughness >= cubeUV_r1 ) {
			mip = ( cubeUV_r0 - roughness ) * ( cubeUV_m1 - cubeUV_m0 ) / ( cubeUV_r0 - cubeUV_r1 ) + cubeUV_m0;
		} else if ( roughness >= cubeUV_r4 ) {
			mip = ( cubeUV_r1 - roughness ) * ( cubeUV_m4 - cubeUV_m1 ) / ( cubeUV_r1 - cubeUV_r4 ) + cubeUV_m1;
		} else if ( roughness >= cubeUV_r5 ) {
			mip = ( cubeUV_r4 - roughness ) * ( cubeUV_m5 - cubeUV_m4 ) / ( cubeUV_r4 - cubeUV_r5 ) + cubeUV_m4;
		} else if ( roughness >= cubeUV_r6 ) {
			mip = ( cubeUV_r5 - roughness ) * ( cubeUV_m6 - cubeUV_m5 ) / ( cubeUV_r5 - cubeUV_r6 ) + cubeUV_m5;
		} else {
			mip = - 2.0 * log2( 1.16 * roughness );		}
		return mip;
	}
	vec4 textureCubeUV( sampler2D envMap, vec3 sampleDir, float roughness ) {
		float mip = clamp( roughnessToMip( roughness ), cubeUV_m0, CUBEUV_MAX_MIP );
		float mipF = fract( mip );
		float mipInt = floor( mip );
		vec3 color0 = bilinearCubeUV( envMap, sampleDir, mipInt );
		if ( mipF == 0.0 ) {
			return vec4( color0, 1.0 );
		} else {
			vec3 color1 = bilinearCubeUV( envMap, sampleDir, mipInt + 1.0 );
			return vec4( mix( color0, color1, mipF ), 1.0 );
		}
	}
#endif`,kf=`vec3 transformedNormal = objectNormal;
#ifdef USE_TANGENT
	vec3 transformedTangent = objectTangent;
#endif
#ifdef USE_BATCHING
	mat3 bm = mat3( batchingMatrix );
	transformedNormal /= vec3( dot( bm[ 0 ], bm[ 0 ] ), dot( bm[ 1 ], bm[ 1 ] ), dot( bm[ 2 ], bm[ 2 ] ) );
	transformedNormal = bm * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = bm * transformedTangent;
	#endif
#endif
#ifdef USE_INSTANCING
	mat3 im = mat3( instanceMatrix );
	transformedNormal /= vec3( dot( im[ 0 ], im[ 0 ] ), dot( im[ 1 ], im[ 1 ] ), dot( im[ 2 ], im[ 2 ] ) );
	transformedNormal = im * transformedNormal;
	#ifdef USE_TANGENT
		transformedTangent = im * transformedTangent;
	#endif
#endif
transformedNormal = normalMatrix * transformedNormal;
#ifdef FLIP_SIDED
	transformedNormal = - transformedNormal;
#endif
#ifdef USE_TANGENT
	transformedTangent = ( modelViewMatrix * vec4( transformedTangent, 0.0 ) ).xyz;
	#ifdef FLIP_SIDED
		transformedTangent = - transformedTangent;
	#endif
#endif`,Hf=`#ifdef USE_DISPLACEMENTMAP
	uniform sampler2D displacementMap;
	uniform float displacementScale;
	uniform float displacementBias;
#endif`,Gf=`#ifdef USE_DISPLACEMENTMAP
	transformed += normalize( objectNormal ) * ( texture2D( displacementMap, vDisplacementMapUv ).x * displacementScale + displacementBias );
#endif`,Vf=`#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vEmissiveMapUv );
	#ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
		emissiveColor = sRGBTransferEOTF( emissiveColor );
	#endif
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,Wf=`#ifdef USE_EMISSIVEMAP
	uniform sampler2D emissiveMap;
#endif`,Xf="gl_FragColor = linearToOutputTexel( gl_FragColor );",jf=`vec4 LinearTransferOETF( in vec4 value ) {
	return value;
}
vec4 sRGBTransferEOTF( in vec4 value ) {
	return vec4( mix( pow( value.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), value.rgb * 0.0773993808, vec3( lessThanEqual( value.rgb, vec3( 0.04045 ) ) ) ), value.a );
}
vec4 sRGBTransferOETF( in vec4 value ) {
	return vec4( mix( pow( value.rgb, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value.rgb * 12.92, vec3( lessThanEqual( value.rgb, vec3( 0.0031308 ) ) ) ), value.a );
}`,Qf=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vec3 cameraToFrag;
		if ( isOrthographic ) {
			cameraToFrag = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToFrag = normalize( vWorldPosition - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vec3 reflectVec = reflect( cameraToFrag, worldNormal );
		#else
			vec3 reflectVec = refract( cameraToFrag, worldNormal, refractionRatio );
		#endif
	#else
		vec3 reflectVec = vReflect;
	#endif
	#ifdef ENVMAP_TYPE_CUBE
		vec4 envColor = textureCube( envMap, envMapRotation * vec3( flipEnvMap * reflectVec.x, reflectVec.yz ) );
	#else
		vec4 envColor = vec4( 0.0 );
	#endif
	#ifdef ENVMAP_BLENDING_MULTIPLY
		outgoingLight = mix( outgoingLight, outgoingLight * envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_MIX )
		outgoingLight = mix( outgoingLight, envColor.xyz, specularStrength * reflectivity );
	#elif defined( ENVMAP_BLENDING_ADD )
		outgoingLight += envColor.xyz * specularStrength * reflectivity;
	#endif
#endif`,Kf=`#ifdef USE_ENVMAP
	uniform float envMapIntensity;
	uniform float flipEnvMap;
	uniform mat3 envMapRotation;
	#ifdef ENVMAP_TYPE_CUBE
		uniform samplerCube envMap;
	#else
		uniform sampler2D envMap;
	#endif
	
#endif`,Yf=`#ifdef USE_ENVMAP
	uniform float reflectivity;
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		varying vec3 vWorldPosition;
		uniform float refractionRatio;
	#else
		varying vec3 vReflect;
	#endif
#endif`,qf=`#ifdef USE_ENVMAP
	#if defined( USE_BUMPMAP ) || defined( USE_NORMALMAP ) || defined( PHONG ) || defined( LAMBERT )
		#define ENV_WORLDPOS
	#endif
	#ifdef ENV_WORLDPOS
		
		varying vec3 vWorldPosition;
	#else
		varying vec3 vReflect;
		uniform float refractionRatio;
	#endif
#endif`,Jf=`#ifdef USE_ENVMAP
	#ifdef ENV_WORLDPOS
		vWorldPosition = worldPosition.xyz;
	#else
		vec3 cameraToVertex;
		if ( isOrthographic ) {
			cameraToVertex = normalize( vec3( - viewMatrix[ 0 ][ 2 ], - viewMatrix[ 1 ][ 2 ], - viewMatrix[ 2 ][ 2 ] ) );
		} else {
			cameraToVertex = normalize( worldPosition.xyz - cameraPosition );
		}
		vec3 worldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
		#ifdef ENVMAP_MODE_REFLECTION
			vReflect = reflect( cameraToVertex, worldNormal );
		#else
			vReflect = refract( cameraToVertex, worldNormal, refractionRatio );
		#endif
	#endif
#endif`,Zf=`#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
#endif`,$f=`#ifdef USE_FOG
	varying float vFogDepth;
#endif`,eA=`#ifdef USE_FOG
	#ifdef FOG_EXP2
		float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`,tA=`#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`,nA=`#ifdef USE_GRADIENTMAP
	uniform sampler2D gradientMap;
#endif
vec3 getGradientIrradiance( vec3 normal, vec3 lightDirection ) {
	float dotNL = dot( normal, lightDirection );
	vec2 coord = vec2( dotNL * 0.5 + 0.5, 0.0 );
	#ifdef USE_GRADIENTMAP
		return vec3( texture2D( gradientMap, coord ).r );
	#else
		vec2 fw = fwidth( coord ) * 0.5;
		return mix( vec3( 0.7 ), vec3( 1.0 ), smoothstep( 0.7 - fw.x, 0.7 + fw.x, coord.x ) );
	#endif
}`,iA=`#ifdef USE_LIGHTMAP
	uniform sampler2D lightMap;
	uniform float lightMapIntensity;
#endif`,sA=`LambertMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularStrength = specularStrength;`,rA=`varying vec3 vViewPosition;
struct LambertMaterial {
	vec3 diffuseColor;
	float specularStrength;
};
void RE_Direct_Lambert( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Lambert( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Lambert
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Lambert`,oA=`uniform bool receiveShadow;
uniform vec3 ambientLightColor;
#if defined( USE_LIGHT_PROBES )
	uniform vec3 lightProbe[ 9 ];
#endif
vec3 shGetIrradianceAt( in vec3 normal, in vec3 shCoefficients[ 9 ] ) {
	float x = normal.x, y = normal.y, z = normal.z;
	vec3 result = shCoefficients[ 0 ] * 0.886227;
	result += shCoefficients[ 1 ] * 2.0 * 0.511664 * y;
	result += shCoefficients[ 2 ] * 2.0 * 0.511664 * z;
	result += shCoefficients[ 3 ] * 2.0 * 0.511664 * x;
	result += shCoefficients[ 4 ] * 2.0 * 0.429043 * x * y;
	result += shCoefficients[ 5 ] * 2.0 * 0.429043 * y * z;
	result += shCoefficients[ 6 ] * ( 0.743125 * z * z - 0.247708 );
	result += shCoefficients[ 7 ] * 2.0 * 0.429043 * x * z;
	result += shCoefficients[ 8 ] * 0.429043 * ( x * x - y * y );
	return result;
}
vec3 getLightProbeIrradiance( const in vec3 lightProbe[ 9 ], const in vec3 normal ) {
	vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
	vec3 irradiance = shGetIrradianceAt( worldNormal, lightProbe );
	return irradiance;
}
vec3 getAmbientLightIrradiance( const in vec3 ambientLightColor ) {
	vec3 irradiance = ambientLightColor;
	return irradiance;
}
float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {
	float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );
	if ( cutoffDistance > 0.0 ) {
		distanceFalloff *= pow2( saturate( 1.0 - pow4( lightDistance / cutoffDistance ) ) );
	}
	return distanceFalloff;
}
float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {
	return smoothstep( coneCosine, penumbraCosine, angleCosine );
}
#if NUM_DIR_LIGHTS > 0
	struct DirectionalLight {
		vec3 direction;
		vec3 color;
	};
	uniform DirectionalLight directionalLights[ NUM_DIR_LIGHTS ];
	void getDirectionalLightInfo( const in DirectionalLight directionalLight, out IncidentLight light ) {
		light.color = directionalLight.color;
		light.direction = directionalLight.direction;
		light.visible = true;
	}
#endif
#if NUM_POINT_LIGHTS > 0
	struct PointLight {
		vec3 position;
		vec3 color;
		float distance;
		float decay;
	};
	uniform PointLight pointLights[ NUM_POINT_LIGHTS ];
	void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = pointLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float lightDistance = length( lVector );
		light.color = pointLight.color;
		light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );
		light.visible = ( light.color != vec3( 0.0 ) );
	}
#endif
#if NUM_SPOT_LIGHTS > 0
	struct SpotLight {
		vec3 position;
		vec3 direction;
		vec3 color;
		float distance;
		float decay;
		float coneCos;
		float penumbraCos;
	};
	uniform SpotLight spotLights[ NUM_SPOT_LIGHTS ];
	void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {
		vec3 lVector = spotLight.position - geometryPosition;
		light.direction = normalize( lVector );
		float angleCos = dot( light.direction, spotLight.direction );
		float spotAttenuation = getSpotAttenuation( spotLight.coneCos, spotLight.penumbraCos, angleCos );
		if ( spotAttenuation > 0.0 ) {
			float lightDistance = length( lVector );
			light.color = spotLight.color * spotAttenuation;
			light.color *= getDistanceAttenuation( lightDistance, spotLight.distance, spotLight.decay );
			light.visible = ( light.color != vec3( 0.0 ) );
		} else {
			light.color = vec3( 0.0 );
			light.visible = false;
		}
	}
#endif
#if NUM_RECT_AREA_LIGHTS > 0
	struct RectAreaLight {
		vec3 color;
		vec3 position;
		vec3 halfWidth;
		vec3 halfHeight;
	};
	uniform sampler2D ltc_1;	uniform sampler2D ltc_2;
	uniform RectAreaLight rectAreaLights[ NUM_RECT_AREA_LIGHTS ];
#endif
#if NUM_HEMI_LIGHTS > 0
	struct HemisphereLight {
		vec3 direction;
		vec3 skyColor;
		vec3 groundColor;
	};
	uniform HemisphereLight hemisphereLights[ NUM_HEMI_LIGHTS ];
	vec3 getHemisphereLightIrradiance( const in HemisphereLight hemiLight, const in vec3 normal ) {
		float dotNL = dot( normal, hemiLight.direction );
		float hemiDiffuseWeight = 0.5 * dotNL + 0.5;
		vec3 irradiance = mix( hemiLight.groundColor, hemiLight.skyColor, hemiDiffuseWeight );
		return irradiance;
	}
#endif`,aA=`#ifdef USE_ENVMAP
	vec3 getIBLIrradiance( const in vec3 normal ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 worldNormal = inverseTransformDirection( normal, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * worldNormal, 1.0 );
			return PI * envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	vec3 getIBLRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness ) {
		#ifdef ENVMAP_TYPE_CUBE_UV
			vec3 reflectVec = reflect( - viewDir, normal );
			reflectVec = normalize( mix( reflectVec, normal, roughness * roughness) );
			reflectVec = inverseTransformDirection( reflectVec, viewMatrix );
			vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );
			return envMapColor.rgb * envMapIntensity;
		#else
			return vec3( 0.0 );
		#endif
	}
	#ifdef USE_ANISOTROPY
		vec3 getIBLAnisotropyRadiance( const in vec3 viewDir, const in vec3 normal, const in float roughness, const in vec3 bitangent, const in float anisotropy ) {
			#ifdef ENVMAP_TYPE_CUBE_UV
				vec3 bentNormal = cross( bitangent, viewDir );
				bentNormal = normalize( cross( bentNormal, bitangent ) );
				bentNormal = normalize( mix( bentNormal, normal, pow2( pow2( 1.0 - anisotropy * ( 1.0 - roughness ) ) ) ) );
				return getIBLRadiance( viewDir, bentNormal, roughness );
			#else
				return vec3( 0.0 );
			#endif
		}
	#endif
#endif`,cA=`ToonMaterial material;
material.diffuseColor = diffuseColor.rgb;`,lA=`varying vec3 vViewPosition;
struct ToonMaterial {
	vec3 diffuseColor;
};
void RE_Direct_Toon( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Toon( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_Toon
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Toon`,uA=`BlinnPhongMaterial material;
material.diffuseColor = diffuseColor.rgb;
material.specularColor = specular;
material.specularShininess = shininess;
material.specularStrength = specularStrength;`,hA=`varying vec3 vViewPosition;
struct BlinnPhongMaterial {
	vec3 diffuseColor;
	vec3 specularColor;
	float specularShininess;
	float specularStrength;
};
void RE_Direct_BlinnPhong( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
	reflectedLight.directSpecular += irradiance * BRDF_BlinnPhong( directLight.direction, geometryViewDir, geometryNormal, material.specularColor, material.specularShininess ) * material.specularStrength;
}
void RE_IndirectDiffuse_BlinnPhong( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in BlinnPhongMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
#define RE_Direct				RE_Direct_BlinnPhong
#define RE_IndirectDiffuse		RE_IndirectDiffuse_BlinnPhong`,dA=`PhysicalMaterial material;
material.diffuseColor = diffuseColor.rgb * ( 1.0 - metalnessFactor );
vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );
float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );
material.roughness = max( roughnessFactor, 0.0525 );material.roughness += geometryRoughness;
material.roughness = min( material.roughness, 1.0 );
#ifdef IOR
	material.ior = ior;
	#ifdef USE_SPECULAR
		float specularIntensityFactor = specularIntensity;
		vec3 specularColorFactor = specularColor;
		#ifdef USE_SPECULAR_COLORMAP
			specularColorFactor *= texture2D( specularColorMap, vSpecularColorMapUv ).rgb;
		#endif
		#ifdef USE_SPECULAR_INTENSITYMAP
			specularIntensityFactor *= texture2D( specularIntensityMap, vSpecularIntensityMapUv ).a;
		#endif
		material.specularF90 = mix( specularIntensityFactor, 1.0, metalnessFactor );
	#else
		float specularIntensityFactor = 1.0;
		vec3 specularColorFactor = vec3( 1.0 );
		material.specularF90 = 1.0;
	#endif
	material.specularColor = mix( min( pow2( ( material.ior - 1.0 ) / ( material.ior + 1.0 ) ) * specularColorFactor, vec3( 1.0 ) ) * specularIntensityFactor, diffuseColor.rgb, metalnessFactor );
#else
	material.specularColor = mix( vec3( 0.04 ), diffuseColor.rgb, metalnessFactor );
	material.specularF90 = 1.0;
#endif
#ifdef USE_CLEARCOAT
	material.clearcoat = clearcoat;
	material.clearcoatRoughness = clearcoatRoughness;
	material.clearcoatF0 = vec3( 0.04 );
	material.clearcoatF90 = 1.0;
	#ifdef USE_CLEARCOATMAP
		material.clearcoat *= texture2D( clearcoatMap, vClearcoatMapUv ).x;
	#endif
	#ifdef USE_CLEARCOAT_ROUGHNESSMAP
		material.clearcoatRoughness *= texture2D( clearcoatRoughnessMap, vClearcoatRoughnessMapUv ).y;
	#endif
	material.clearcoat = saturate( material.clearcoat );	material.clearcoatRoughness = max( material.clearcoatRoughness, 0.0525 );
	material.clearcoatRoughness += geometryRoughness;
	material.clearcoatRoughness = min( material.clearcoatRoughness, 1.0 );
#endif
#ifdef USE_DISPERSION
	material.dispersion = dispersion;
#endif
#ifdef USE_IRIDESCENCE
	material.iridescence = iridescence;
	material.iridescenceIOR = iridescenceIOR;
	#ifdef USE_IRIDESCENCEMAP
		material.iridescence *= texture2D( iridescenceMap, vIridescenceMapUv ).r;
	#endif
	#ifdef USE_IRIDESCENCE_THICKNESSMAP
		material.iridescenceThickness = (iridescenceThicknessMaximum - iridescenceThicknessMinimum) * texture2D( iridescenceThicknessMap, vIridescenceThicknessMapUv ).g + iridescenceThicknessMinimum;
	#else
		material.iridescenceThickness = iridescenceThicknessMaximum;
	#endif
#endif
#ifdef USE_SHEEN
	material.sheenColor = sheenColor;
	#ifdef USE_SHEEN_COLORMAP
		material.sheenColor *= texture2D( sheenColorMap, vSheenColorMapUv ).rgb;
	#endif
	material.sheenRoughness = clamp( sheenRoughness, 0.07, 1.0 );
	#ifdef USE_SHEEN_ROUGHNESSMAP
		material.sheenRoughness *= texture2D( sheenRoughnessMap, vSheenRoughnessMapUv ).a;
	#endif
#endif
#ifdef USE_ANISOTROPY
	#ifdef USE_ANISOTROPYMAP
		mat2 anisotropyMat = mat2( anisotropyVector.x, anisotropyVector.y, - anisotropyVector.y, anisotropyVector.x );
		vec3 anisotropyPolar = texture2D( anisotropyMap, vAnisotropyMapUv ).rgb;
		vec2 anisotropyV = anisotropyMat * normalize( 2.0 * anisotropyPolar.rg - vec2( 1.0 ) ) * anisotropyPolar.b;
	#else
		vec2 anisotropyV = anisotropyVector;
	#endif
	material.anisotropy = length( anisotropyV );
	if( material.anisotropy == 0.0 ) {
		anisotropyV = vec2( 1.0, 0.0 );
	} else {
		anisotropyV /= material.anisotropy;
		material.anisotropy = saturate( material.anisotropy );
	}
	material.alphaT = mix( pow2( material.roughness ), 1.0, pow2( material.anisotropy ) );
	material.anisotropyT = tbn[ 0 ] * anisotropyV.x + tbn[ 1 ] * anisotropyV.y;
	material.anisotropyB = tbn[ 1 ] * anisotropyV.x - tbn[ 0 ] * anisotropyV.y;
#endif`,fA=`struct PhysicalMaterial {
	vec3 diffuseColor;
	float roughness;
	vec3 specularColor;
	float specularF90;
	float dispersion;
	#ifdef USE_CLEARCOAT
		float clearcoat;
		float clearcoatRoughness;
		vec3 clearcoatF0;
		float clearcoatF90;
	#endif
	#ifdef USE_IRIDESCENCE
		float iridescence;
		float iridescenceIOR;
		float iridescenceThickness;
		vec3 iridescenceFresnel;
		vec3 iridescenceF0;
	#endif
	#ifdef USE_SHEEN
		vec3 sheenColor;
		float sheenRoughness;
	#endif
	#ifdef IOR
		float ior;
	#endif
	#ifdef USE_TRANSMISSION
		float transmission;
		float transmissionAlpha;
		float thickness;
		float attenuationDistance;
		vec3 attenuationColor;
	#endif
	#ifdef USE_ANISOTROPY
		float anisotropy;
		float alphaT;
		vec3 anisotropyT;
		vec3 anisotropyB;
	#endif
};
vec3 clearcoatSpecularDirect = vec3( 0.0 );
vec3 clearcoatSpecularIndirect = vec3( 0.0 );
vec3 sheenSpecularDirect = vec3( 0.0 );
vec3 sheenSpecularIndirect = vec3(0.0 );
vec3 Schlick_to_F0( const in vec3 f, const in float f90, const in float dotVH ) {
    float x = clamp( 1.0 - dotVH, 0.0, 1.0 );
    float x2 = x * x;
    float x5 = clamp( x * x2 * x2, 0.0, 0.9999 );
    return ( f - vec3( f90 ) * x5 ) / ( 1.0 - x5 );
}
float V_GGX_SmithCorrelated( const in float alpha, const in float dotNL, const in float dotNV ) {
	float a2 = pow2( alpha );
	float gv = dotNL * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNV ) );
	float gl = dotNV * sqrt( a2 + ( 1.0 - a2 ) * pow2( dotNL ) );
	return 0.5 / max( gv + gl, EPSILON );
}
float D_GGX( const in float alpha, const in float dotNH ) {
	float a2 = pow2( alpha );
	float denom = pow2( dotNH ) * ( a2 - 1.0 ) + 1.0;
	return RECIPROCAL_PI * a2 / pow2( denom );
}
#ifdef USE_ANISOTROPY
	float V_GGX_SmithCorrelated_Anisotropic( const in float alphaT, const in float alphaB, const in float dotTV, const in float dotBV, const in float dotTL, const in float dotBL, const in float dotNV, const in float dotNL ) {
		float gv = dotNL * length( vec3( alphaT * dotTV, alphaB * dotBV, dotNV ) );
		float gl = dotNV * length( vec3( alphaT * dotTL, alphaB * dotBL, dotNL ) );
		float v = 0.5 / ( gv + gl );
		return saturate(v);
	}
	float D_GGX_Anisotropic( const in float alphaT, const in float alphaB, const in float dotNH, const in float dotTH, const in float dotBH ) {
		float a2 = alphaT * alphaB;
		highp vec3 v = vec3( alphaB * dotTH, alphaT * dotBH, a2 * dotNH );
		highp float v2 = dot( v, v );
		float w2 = a2 / v2;
		return RECIPROCAL_PI * a2 * pow2 ( w2 );
	}
#endif
#ifdef USE_CLEARCOAT
	vec3 BRDF_GGX_Clearcoat( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material) {
		vec3 f0 = material.clearcoatF0;
		float f90 = material.clearcoatF90;
		float roughness = material.clearcoatRoughness;
		float alpha = pow2( roughness );
		vec3 halfDir = normalize( lightDir + viewDir );
		float dotNL = saturate( dot( normal, lightDir ) );
		float dotNV = saturate( dot( normal, viewDir ) );
		float dotNH = saturate( dot( normal, halfDir ) );
		float dotVH = saturate( dot( viewDir, halfDir ) );
		vec3 F = F_Schlick( f0, f90, dotVH );
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
		return F * ( V * D );
	}
#endif
vec3 BRDF_GGX( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, const in PhysicalMaterial material ) {
	vec3 f0 = material.specularColor;
	float f90 = material.specularF90;
	float roughness = material.roughness;
	float alpha = pow2( roughness );
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float dotVH = saturate( dot( viewDir, halfDir ) );
	vec3 F = F_Schlick( f0, f90, dotVH );
	#ifdef USE_IRIDESCENCE
		F = mix( F, material.iridescenceFresnel, material.iridescence );
	#endif
	#ifdef USE_ANISOTROPY
		float dotTL = dot( material.anisotropyT, lightDir );
		float dotTV = dot( material.anisotropyT, viewDir );
		float dotTH = dot( material.anisotropyT, halfDir );
		float dotBL = dot( material.anisotropyB, lightDir );
		float dotBV = dot( material.anisotropyB, viewDir );
		float dotBH = dot( material.anisotropyB, halfDir );
		float V = V_GGX_SmithCorrelated_Anisotropic( material.alphaT, alpha, dotTV, dotBV, dotTL, dotBL, dotNV, dotNL );
		float D = D_GGX_Anisotropic( material.alphaT, alpha, dotNH, dotTH, dotBH );
	#else
		float V = V_GGX_SmithCorrelated( alpha, dotNL, dotNV );
		float D = D_GGX( alpha, dotNH );
	#endif
	return F * ( V * D );
}
vec2 LTC_Uv( const in vec3 N, const in vec3 V, const in float roughness ) {
	const float LUT_SIZE = 64.0;
	const float LUT_SCALE = ( LUT_SIZE - 1.0 ) / LUT_SIZE;
	const float LUT_BIAS = 0.5 / LUT_SIZE;
	float dotNV = saturate( dot( N, V ) );
	vec2 uv = vec2( roughness, sqrt( 1.0 - dotNV ) );
	uv = uv * LUT_SCALE + LUT_BIAS;
	return uv;
}
float LTC_ClippedSphereFormFactor( const in vec3 f ) {
	float l = length( f );
	return max( ( l * l + f.z ) / ( l + 1.0 ), 0.0 );
}
vec3 LTC_EdgeVectorFormFactor( const in vec3 v1, const in vec3 v2 ) {
	float x = dot( v1, v2 );
	float y = abs( x );
	float a = 0.8543985 + ( 0.4965155 + 0.0145206 * y ) * y;
	float b = 3.4175940 + ( 4.1616724 + y ) * y;
	float v = a / b;
	float theta_sintheta = ( x > 0.0 ) ? v : 0.5 * inversesqrt( max( 1.0 - x * x, 1e-7 ) ) - v;
	return cross( v1, v2 ) * theta_sintheta;
}
vec3 LTC_Evaluate( const in vec3 N, const in vec3 V, const in vec3 P, const in mat3 mInv, const in vec3 rectCoords[ 4 ] ) {
	vec3 v1 = rectCoords[ 1 ] - rectCoords[ 0 ];
	vec3 v2 = rectCoords[ 3 ] - rectCoords[ 0 ];
	vec3 lightNormal = cross( v1, v2 );
	if( dot( lightNormal, P - rectCoords[ 0 ] ) < 0.0 ) return vec3( 0.0 );
	vec3 T1, T2;
	T1 = normalize( V - N * dot( V, N ) );
	T2 = - cross( N, T1 );
	mat3 mat = mInv * transposeMat3( mat3( T1, T2, N ) );
	vec3 coords[ 4 ];
	coords[ 0 ] = mat * ( rectCoords[ 0 ] - P );
	coords[ 1 ] = mat * ( rectCoords[ 1 ] - P );
	coords[ 2 ] = mat * ( rectCoords[ 2 ] - P );
	coords[ 3 ] = mat * ( rectCoords[ 3 ] - P );
	coords[ 0 ] = normalize( coords[ 0 ] );
	coords[ 1 ] = normalize( coords[ 1 ] );
	coords[ 2 ] = normalize( coords[ 2 ] );
	coords[ 3 ] = normalize( coords[ 3 ] );
	vec3 vectorFormFactor = vec3( 0.0 );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 0 ], coords[ 1 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 1 ], coords[ 2 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 2 ], coords[ 3 ] );
	vectorFormFactor += LTC_EdgeVectorFormFactor( coords[ 3 ], coords[ 0 ] );
	float result = LTC_ClippedSphereFormFactor( vectorFormFactor );
	return vec3( result );
}
#if defined( USE_SHEEN )
float D_Charlie( float roughness, float dotNH ) {
	float alpha = pow2( roughness );
	float invAlpha = 1.0 / alpha;
	float cos2h = dotNH * dotNH;
	float sin2h = max( 1.0 - cos2h, 0.0078125 );
	return ( 2.0 + invAlpha ) * pow( sin2h, invAlpha * 0.5 ) / ( 2.0 * PI );
}
float V_Neubelt( float dotNV, float dotNL ) {
	return saturate( 1.0 / ( 4.0 * ( dotNL + dotNV - dotNL * dotNV ) ) );
}
vec3 BRDF_Sheen( const in vec3 lightDir, const in vec3 viewDir, const in vec3 normal, vec3 sheenColor, const in float sheenRoughness ) {
	vec3 halfDir = normalize( lightDir + viewDir );
	float dotNL = saturate( dot( normal, lightDir ) );
	float dotNV = saturate( dot( normal, viewDir ) );
	float dotNH = saturate( dot( normal, halfDir ) );
	float D = D_Charlie( sheenRoughness, dotNH );
	float V = V_Neubelt( dotNV, dotNL );
	return sheenColor * ( D * V );
}
#endif
float IBLSheenBRDF( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	float r2 = roughness * roughness;
	float a = roughness < 0.25 ? -339.2 * r2 + 161.4 * roughness - 25.9 : -8.48 * r2 + 14.3 * roughness - 9.95;
	float b = roughness < 0.25 ? 44.0 * r2 - 23.7 * roughness + 3.26 : 1.97 * r2 - 3.27 * roughness + 0.72;
	float DG = exp( a * dotNV + b ) + ( roughness < 0.25 ? 0.0 : 0.1 * ( roughness - 0.25 ) );
	return saturate( DG * RECIPROCAL_PI );
}
vec2 DFGApprox( const in vec3 normal, const in vec3 viewDir, const in float roughness ) {
	float dotNV = saturate( dot( normal, viewDir ) );
	const vec4 c0 = vec4( - 1, - 0.0275, - 0.572, 0.022 );
	const vec4 c1 = vec4( 1, 0.0425, 1.04, - 0.04 );
	vec4 r = roughness * c0 + c1;
	float a004 = min( r.x * r.x, exp2( - 9.28 * dotNV ) ) * r.x + r.y;
	vec2 fab = vec2( - 1.04, 1.04 ) * a004 + r.zw;
	return fab;
}
vec3 EnvironmentBRDF( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness ) {
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	return specularColor * fab.x + specularF90 * fab.y;
}
#ifdef USE_IRIDESCENCE
void computeMultiscatteringIridescence( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float iridescence, const in vec3 iridescenceF0, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#else
void computeMultiscattering( const in vec3 normal, const in vec3 viewDir, const in vec3 specularColor, const in float specularF90, const in float roughness, inout vec3 singleScatter, inout vec3 multiScatter ) {
#endif
	vec2 fab = DFGApprox( normal, viewDir, roughness );
	#ifdef USE_IRIDESCENCE
		vec3 Fr = mix( specularColor, iridescenceF0, iridescence );
	#else
		vec3 Fr = specularColor;
	#endif
	vec3 FssEss = Fr * fab.x + specularF90 * fab.y;
	float Ess = fab.x + fab.y;
	float Ems = 1.0 - Ess;
	vec3 Favg = Fr + ( 1.0 - Fr ) * 0.047619;	vec3 Fms = FssEss * Favg / ( 1.0 - Ems * Favg );
	singleScatter += FssEss;
	multiScatter += Fms * Ems;
}
#if NUM_RECT_AREA_LIGHTS > 0
	void RE_Direct_RectArea_Physical( const in RectAreaLight rectAreaLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
		vec3 normal = geometryNormal;
		vec3 viewDir = geometryViewDir;
		vec3 position = geometryPosition;
		vec3 lightPos = rectAreaLight.position;
		vec3 halfWidth = rectAreaLight.halfWidth;
		vec3 halfHeight = rectAreaLight.halfHeight;
		vec3 lightColor = rectAreaLight.color;
		float roughness = material.roughness;
		vec3 rectCoords[ 4 ];
		rectCoords[ 0 ] = lightPos + halfWidth - halfHeight;		rectCoords[ 1 ] = lightPos - halfWidth - halfHeight;
		rectCoords[ 2 ] = lightPos - halfWidth + halfHeight;
		rectCoords[ 3 ] = lightPos + halfWidth + halfHeight;
		vec2 uv = LTC_Uv( normal, viewDir, roughness );
		vec4 t1 = texture2D( ltc_1, uv );
		vec4 t2 = texture2D( ltc_2, uv );
		mat3 mInv = mat3(
			vec3( t1.x, 0, t1.y ),
			vec3(    0, 1,    0 ),
			vec3( t1.z, 0, t1.w )
		);
		vec3 fresnel = ( material.specularColor * t2.x + ( vec3( 1.0 ) - material.specularColor ) * t2.y );
		reflectedLight.directSpecular += lightColor * fresnel * LTC_Evaluate( normal, viewDir, position, mInv, rectCoords );
		reflectedLight.directDiffuse += lightColor * material.diffuseColor * LTC_Evaluate( normal, viewDir, position, mat3( 1.0 ), rectCoords );
	}
#endif
void RE_Direct_Physical( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	float dotNL = saturate( dot( geometryNormal, directLight.direction ) );
	vec3 irradiance = dotNL * directLight.color;
	#ifdef USE_CLEARCOAT
		float dotNLcc = saturate( dot( geometryClearcoatNormal, directLight.direction ) );
		vec3 ccIrradiance = dotNLcc * directLight.color;
		clearcoatSpecularDirect += ccIrradiance * BRDF_GGX_Clearcoat( directLight.direction, geometryViewDir, geometryClearcoatNormal, material );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularDirect += irradiance * BRDF_Sheen( directLight.direction, geometryViewDir, geometryNormal, material.sheenColor, material.sheenRoughness );
	#endif
	reflectedLight.directSpecular += irradiance * BRDF_GGX( directLight.direction, geometryViewDir, geometryNormal, material );
	reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectDiffuse_Physical( const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
	reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
}
void RE_IndirectSpecular_Physical( const in vec3 radiance, const in vec3 irradiance, const in vec3 clearcoatRadiance, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
	#ifdef USE_CLEARCOAT
		clearcoatSpecularIndirect += clearcoatRadiance * EnvironmentBRDF( geometryClearcoatNormal, geometryViewDir, material.clearcoatF0, material.clearcoatF90, material.clearcoatRoughness );
	#endif
	#ifdef USE_SHEEN
		sheenSpecularIndirect += irradiance * material.sheenColor * IBLSheenBRDF( geometryNormal, geometryViewDir, material.sheenRoughness );
	#endif
	vec3 singleScattering = vec3( 0.0 );
	vec3 multiScattering = vec3( 0.0 );
	vec3 cosineWeightedIrradiance = irradiance * RECIPROCAL_PI;
	#ifdef USE_IRIDESCENCE
		computeMultiscatteringIridescence( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.iridescence, material.iridescenceFresnel, material.roughness, singleScattering, multiScattering );
	#else
		computeMultiscattering( geometryNormal, geometryViewDir, material.specularColor, material.specularF90, material.roughness, singleScattering, multiScattering );
	#endif
	vec3 totalScattering = singleScattering + multiScattering;
	vec3 diffuse = material.diffuseColor * ( 1.0 - max( max( totalScattering.r, totalScattering.g ), totalScattering.b ) );
	reflectedLight.indirectSpecular += radiance * singleScattering;
	reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;
	reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;
}
#define RE_Direct				RE_Direct_Physical
#define RE_Direct_RectArea		RE_Direct_RectArea_Physical
#define RE_IndirectDiffuse		RE_IndirectDiffuse_Physical
#define RE_IndirectSpecular		RE_IndirectSpecular_Physical
float computeSpecularOcclusion( const in float dotNV, const in float ambientOcclusion, const in float roughness ) {
	return saturate( pow( dotNV + ambientOcclusion, exp2( - 16.0 * roughness - 1.0 ) ) - 1.0 + ambientOcclusion );
}`,AA=`
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
#ifdef USE_CLEARCOAT
	geometryClearcoatNormal = clearcoatNormal;
#endif
#ifdef USE_IRIDESCENCE
	float dotNVi = saturate( dot( normal, geometryViewDir ) );
	if ( material.iridescenceThickness == 0.0 ) {
		material.iridescence = 0.0;
	} else {
		material.iridescence = saturate( material.iridescence );
	}
	if ( material.iridescence > 0.0 ) {
		material.iridescenceFresnel = evalIridescence( 1.0, material.iridescenceIOR, dotNVi, material.iridescenceThickness, material.specularColor );
		material.iridescenceF0 = Schlick_to_F0( material.iridescenceFresnel, 1.0, dotNVi );
	}
#endif
IncidentLight directLight;
#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )
	PointLight pointLight;
	#if defined( USE_SHADOWMAP ) && NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHTS; i ++ ) {
		pointLight = pointLights[ i ];
		getPointLightInfo( pointLight, geometryPosition, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_POINT_LIGHT_SHADOWS )
		pointLightShadow = pointLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getPointShadow( pointShadowMap[ i ], pointLightShadow.shadowMapSize, pointLightShadow.shadowIntensity, pointLightShadow.shadowBias, pointLightShadow.shadowRadius, vPointShadowCoord[ i ], pointLightShadow.shadowCameraNear, pointLightShadow.shadowCameraFar ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )
	SpotLight spotLight;
	vec4 spotColor;
	vec3 spotLightCoord;
	bool inSpotLightMap;
	#if defined( USE_SHADOWMAP ) && NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHTS; i ++ ) {
		spotLight = spotLights[ i ];
		getSpotLightInfo( spotLight, geometryPosition, directLight );
		#if ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#define SPOT_LIGHT_MAP_INDEX UNROLLED_LOOP_INDEX
		#elif ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		#define SPOT_LIGHT_MAP_INDEX NUM_SPOT_LIGHT_MAPS
		#else
		#define SPOT_LIGHT_MAP_INDEX ( UNROLLED_LOOP_INDEX - NUM_SPOT_LIGHT_SHADOWS + NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS )
		#endif
		#if ( SPOT_LIGHT_MAP_INDEX < NUM_SPOT_LIGHT_MAPS )
			spotLightCoord = vSpotLightCoord[ i ].xyz / vSpotLightCoord[ i ].w;
			inSpotLightMap = all( lessThan( abs( spotLightCoord * 2. - 1. ), vec3( 1.0 ) ) );
			spotColor = texture2D( spotLightMap[ SPOT_LIGHT_MAP_INDEX ], spotLightCoord.xy );
			directLight.color = inSpotLightMap ? directLight.color * spotColor.rgb : directLight.color;
		#endif
		#undef SPOT_LIGHT_MAP_INDEX
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
		spotLightShadow = spotLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( spotShadowMap[ i ], spotLightShadow.shadowMapSize, spotLightShadow.shadowIntensity, spotLightShadow.shadowBias, spotLightShadow.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )
	DirectionalLight directionalLight;
	#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLightShadow;
	#endif
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {
		directionalLight = directionalLights[ i ];
		getDirectionalLightInfo( directionalLight, directLight );
		#if defined( USE_SHADOWMAP ) && ( UNROLLED_LOOP_INDEX < NUM_DIR_LIGHT_SHADOWS )
		directionalLightShadow = directionalLightShadows[ i ];
		directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
		#endif
		RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )
	RectAreaLight rectAreaLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_RECT_AREA_LIGHTS; i ++ ) {
		rectAreaLight = rectAreaLights[ i ];
		RE_Direct_RectArea( rectAreaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
	}
	#pragma unroll_loop_end
#endif
#if defined( RE_IndirectDiffuse )
	vec3 iblIrradiance = vec3( 0.0 );
	vec3 irradiance = getAmbientLightIrradiance( ambientLightColor );
	#if defined( USE_LIGHT_PROBES )
		irradiance += getLightProbeIrradiance( lightProbe, geometryNormal );
	#endif
	#if ( NUM_HEMI_LIGHTS > 0 )
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_HEMI_LIGHTS; i ++ ) {
			irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );
		}
		#pragma unroll_loop_end
	#endif
#endif
#if defined( RE_IndirectSpecular )
	vec3 radiance = vec3( 0.0 );
	vec3 clearcoatRadiance = vec3( 0.0 );
#endif`,pA=`#if defined( RE_IndirectDiffuse )
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
		irradiance += lightMapIrradiance;
	#endif
	#if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
		iblIrradiance += getIBLIrradiance( geometryNormal );
	#endif
#endif
#if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
	#ifdef USE_ANISOTROPY
		radiance += getIBLAnisotropyRadiance( geometryViewDir, geometryNormal, material.roughness, material.anisotropyB, material.anisotropy );
	#else
		radiance += getIBLRadiance( geometryViewDir, geometryNormal, material.roughness );
	#endif
	#ifdef USE_CLEARCOAT
		clearcoatRadiance += getIBLRadiance( geometryViewDir, geometryClearcoatNormal, material.clearcoatRoughness );
	#endif
#endif`,mA=`#if defined( RE_IndirectDiffuse )
	RE_IndirectDiffuse( irradiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif
#if defined( RE_IndirectSpecular )
	RE_IndirectSpecular( radiance, iblIrradiance, clearcoatRadiance, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
#endif`,gA=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	gl_FragDepth = vIsPerspective == 0.0 ? gl_FragCoord.z : log2( vFragDepth ) * logDepthBufFC * 0.5;
#endif`,vA=`#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
	uniform float logDepthBufFC;
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,_A=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	varying float vFragDepth;
	varying float vIsPerspective;
#endif`,xA=`#ifdef USE_LOGARITHMIC_DEPTH_BUFFER
	vFragDepth = 1.0 + gl_Position.w;
	vIsPerspective = float( isPerspectiveMatrix( projectionMatrix ) );
#endif`,MA=`#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`,yA=`#ifdef USE_MAP
	uniform sampler2D map;
#endif`,SA=`#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
	#if defined( USE_POINTS_UV )
		vec2 uv = vUv;
	#else
		vec2 uv = ( uvTransform * vec3( gl_PointCoord.x, 1.0 - gl_PointCoord.y, 1 ) ).xy;
	#endif
#endif
#ifdef USE_MAP
	diffuseColor *= texture2D( map, uv );
#endif
#ifdef USE_ALPHAMAP
	diffuseColor.a *= texture2D( alphaMap, uv ).g;
#endif`,TA=`#if defined( USE_POINTS_UV )
	varying vec2 vUv;
#else
	#if defined( USE_MAP ) || defined( USE_ALPHAMAP )
		uniform mat3 uvTransform;
	#endif
#endif
#ifdef USE_MAP
	uniform sampler2D map;
#endif
#ifdef USE_ALPHAMAP
	uniform sampler2D alphaMap;
#endif`,EA=`float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
	vec4 texelMetalness = texture2D( metalnessMap, vMetalnessMapUv );
	metalnessFactor *= texelMetalness.b;
#endif`,wA=`#ifdef USE_METALNESSMAP
	uniform sampler2D metalnessMap;
#endif`,bA=`#ifdef USE_INSTANCING_MORPH
	float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	float morphTargetBaseInfluence = texelFetch( morphTexture, ivec2( 0, gl_InstanceID ), 0 ).r;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		morphTargetInfluences[i] =  texelFetch( morphTexture, ivec2( i + 1, gl_InstanceID ), 0 ).r;
	}
#endif`,CA=`#if defined( USE_MORPHCOLORS )
	vColor *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		#if defined( USE_COLOR_ALPHA )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ) * morphTargetInfluences[ i ];
		#elif defined( USE_COLOR )
			if ( morphTargetInfluences[ i ] != 0.0 ) vColor += getMorph( gl_VertexID, i, 2 ).rgb * morphTargetInfluences[ i ];
		#endif
	}
#endif`,PA=`#ifdef USE_MORPHNORMALS
	objectNormal *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) objectNormal += getMorph( gl_VertexID, i, 1 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,RA=`#ifdef USE_MORPHTARGETS
	#ifndef USE_INSTANCING_MORPH
		uniform float morphTargetBaseInfluence;
		uniform float morphTargetInfluences[ MORPHTARGETS_COUNT ];
	#endif
	uniform sampler2DArray morphTargetsTexture;
	uniform ivec2 morphTargetsTextureSize;
	vec4 getMorph( const in int vertexIndex, const in int morphTargetIndex, const in int offset ) {
		int texelIndex = vertexIndex * MORPHTARGETS_TEXTURE_STRIDE + offset;
		int y = texelIndex / morphTargetsTextureSize.x;
		int x = texelIndex - y * morphTargetsTextureSize.x;
		ivec3 morphUV = ivec3( x, y, morphTargetIndex );
		return texelFetch( morphTargetsTexture, morphUV, 0 );
	}
#endif`,DA=`#ifdef USE_MORPHTARGETS
	transformed *= morphTargetBaseInfluence;
	for ( int i = 0; i < MORPHTARGETS_COUNT; i ++ ) {
		if ( morphTargetInfluences[ i ] != 0.0 ) transformed += getMorph( gl_VertexID, i, 0 ).xyz * morphTargetInfluences[ i ];
	}
#endif`,IA=`float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
#ifdef FLAT_SHADED
	vec3 fdx = dFdx( vViewPosition );
	vec3 fdy = dFdy( vViewPosition );
	vec3 normal = normalize( cross( fdx, fdy ) );
#else
	vec3 normal = normalize( vNormal );
	#ifdef DOUBLE_SIDED
		normal *= faceDirection;
	#endif
#endif
#if defined( USE_NORMALMAP_TANGENTSPACE ) || defined( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY )
	#ifdef USE_TANGENT
		mat3 tbn = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn = getTangentFrame( - vViewPosition, normal,
		#if defined( USE_NORMALMAP )
			vNormalMapUv
		#elif defined( USE_CLEARCOAT_NORMALMAP )
			vClearcoatNormalMapUv
		#else
			vUv
		#endif
		);
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn[0] *= faceDirection;
		tbn[1] *= faceDirection;
	#endif
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	#ifdef USE_TANGENT
		mat3 tbn2 = mat3( normalize( vTangent ), normalize( vBitangent ), normal );
	#else
		mat3 tbn2 = getTangentFrame( - vViewPosition, normal, vClearcoatNormalMapUv );
	#endif
	#if defined( DOUBLE_SIDED ) && ! defined( FLAT_SHADED )
		tbn2[0] *= faceDirection;
		tbn2[1] *= faceDirection;
	#endif
#endif
vec3 nonPerturbedNormal = normal;`,LA=`#ifdef USE_NORMALMAP_OBJECTSPACE
	normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	#ifdef FLIP_SIDED
		normal = - normal;
	#endif
	#ifdef DOUBLE_SIDED
		normal = normal * faceDirection;
	#endif
	normal = normalize( normalMatrix * normal );
#elif defined( USE_NORMALMAP_TANGENTSPACE )
	vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
	mapN.xy *= normalScale;
	normal = normalize( tbn * mapN );
#elif defined( USE_BUMPMAP )
	normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif`,UA=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,NA=`#ifndef FLAT_SHADED
	varying vec3 vNormal;
	#ifdef USE_TANGENT
		varying vec3 vTangent;
		varying vec3 vBitangent;
	#endif
#endif`,FA=`#ifndef FLAT_SHADED
	vNormal = normalize( transformedNormal );
	#ifdef USE_TANGENT
		vTangent = normalize( transformedTangent );
		vBitangent = normalize( cross( vNormal, vTangent ) * tangent.w );
	#endif
#endif`,OA=`#ifdef USE_NORMALMAP
	uniform sampler2D normalMap;
	uniform vec2 normalScale;
#endif
#ifdef USE_NORMALMAP_OBJECTSPACE
	uniform mat3 normalMatrix;
#endif
#if ! defined ( USE_TANGENT ) && ( defined ( USE_NORMALMAP_TANGENTSPACE ) || defined ( USE_CLEARCOAT_NORMALMAP ) || defined( USE_ANISOTROPY ) )
	mat3 getTangentFrame( vec3 eye_pos, vec3 surf_norm, vec2 uv ) {
		vec3 q0 = dFdx( eye_pos.xyz );
		vec3 q1 = dFdy( eye_pos.xyz );
		vec2 st0 = dFdx( uv.st );
		vec2 st1 = dFdy( uv.st );
		vec3 N = surf_norm;
		vec3 q1perp = cross( q1, N );
		vec3 q0perp = cross( N, q0 );
		vec3 T = q1perp * st0.x + q0perp * st1.x;
		vec3 B = q1perp * st0.y + q0perp * st1.y;
		float det = max( dot( T, T ), dot( B, B ) );
		float scale = ( det == 0.0 ) ? 0.0 : inversesqrt( det );
		return mat3( T * scale, B * scale, N );
	}
#endif`,BA=`#ifdef USE_CLEARCOAT
	vec3 clearcoatNormal = nonPerturbedNormal;
#endif`,zA=`#ifdef USE_CLEARCOAT_NORMALMAP
	vec3 clearcoatMapN = texture2D( clearcoatNormalMap, vClearcoatNormalMapUv ).xyz * 2.0 - 1.0;
	clearcoatMapN.xy *= clearcoatNormalScale;
	clearcoatNormal = normalize( tbn2 * clearcoatMapN );
#endif`,kA=`#ifdef USE_CLEARCOATMAP
	uniform sampler2D clearcoatMap;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform sampler2D clearcoatNormalMap;
	uniform vec2 clearcoatNormalScale;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform sampler2D clearcoatRoughnessMap;
#endif`,HA=`#ifdef USE_IRIDESCENCEMAP
	uniform sampler2D iridescenceMap;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform sampler2D iridescenceThicknessMap;
#endif`,GA=`#ifdef OPAQUE
diffuseColor.a = 1.0;
#endif
#ifdef USE_TRANSMISSION
diffuseColor.a *= material.transmissionAlpha;
#endif
gl_FragColor = vec4( outgoingLight, diffuseColor.a );`,VA=`vec3 packNormalToRGB( const in vec3 normal ) {
	return normalize( normal ) * 0.5 + 0.5;
}
vec3 unpackRGBToNormal( const in vec3 rgb ) {
	return 2.0 * rgb.xyz - 1.0;
}
const float PackUpscale = 256. / 255.;const float UnpackDownscale = 255. / 256.;const float ShiftRight8 = 1. / 256.;
const float Inv255 = 1. / 255.;
const vec4 PackFactors = vec4( 1.0, 256.0, 256.0 * 256.0, 256.0 * 256.0 * 256.0 );
const vec2 UnpackFactors2 = vec2( UnpackDownscale, 1.0 / PackFactors.g );
const vec3 UnpackFactors3 = vec3( UnpackDownscale / PackFactors.rg, 1.0 / PackFactors.b );
const vec4 UnpackFactors4 = vec4( UnpackDownscale / PackFactors.rgb, 1.0 / PackFactors.a );
vec4 packDepthToRGBA( const in float v ) {
	if( v <= 0.0 )
		return vec4( 0., 0., 0., 0. );
	if( v >= 1.0 )
		return vec4( 1., 1., 1., 1. );
	float vuf;
	float af = modf( v * PackFactors.a, vuf );
	float bf = modf( vuf * ShiftRight8, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec4( vuf * Inv255, gf * PackUpscale, bf * PackUpscale, af );
}
vec3 packDepthToRGB( const in float v ) {
	if( v <= 0.0 )
		return vec3( 0., 0., 0. );
	if( v >= 1.0 )
		return vec3( 1., 1., 1. );
	float vuf;
	float bf = modf( v * PackFactors.b, vuf );
	float gf = modf( vuf * ShiftRight8, vuf );
	return vec3( vuf * Inv255, gf * PackUpscale, bf );
}
vec2 packDepthToRG( const in float v ) {
	if( v <= 0.0 )
		return vec2( 0., 0. );
	if( v >= 1.0 )
		return vec2( 1., 1. );
	float vuf;
	float gf = modf( v * 256., vuf );
	return vec2( vuf * Inv255, gf );
}
float unpackRGBAToDepth( const in vec4 v ) {
	return dot( v, UnpackFactors4 );
}
float unpackRGBToDepth( const in vec3 v ) {
	return dot( v, UnpackFactors3 );
}
float unpackRGToDepth( const in vec2 v ) {
	return v.r * UnpackFactors2.r + v.g * UnpackFactors2.g;
}
vec4 pack2HalfToRGBA( const in vec2 v ) {
	vec4 r = vec4( v.x, fract( v.x * 255.0 ), v.y, fract( v.y * 255.0 ) );
	return vec4( r.x - r.y / 255.0, r.y, r.z - r.w / 255.0, r.w );
}
vec2 unpackRGBATo2Half( const in vec4 v ) {
	return vec2( v.x + ( v.y / 255.0 ), v.z + ( v.w / 255.0 ) );
}
float viewZToOrthographicDepth( const in float viewZ, const in float near, const in float far ) {
	return ( viewZ + near ) / ( near - far );
}
float orthographicDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return depth * ( near - far ) - near;
}
float viewZToPerspectiveDepth( const in float viewZ, const in float near, const in float far ) {
	return ( ( near + viewZ ) * far ) / ( ( far - near ) * viewZ );
}
float perspectiveDepthToViewZ( const in float depth, const in float near, const in float far ) {
	return ( near * far ) / ( ( far - near ) * depth - far );
}`,WA=`#ifdef PREMULTIPLIED_ALPHA
	gl_FragColor.rgb *= gl_FragColor.a;
#endif`,XA=`vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
	mvPosition = batchingMatrix * mvPosition;
#endif
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,jA=`#ifdef DITHERING
	gl_FragColor.rgb = dithering( gl_FragColor.rgb );
#endif`,QA=`#ifdef DITHERING
	vec3 dithering( vec3 color ) {
		float grid_position = rand( gl_FragCoord.xy );
		vec3 dither_shift_RGB = vec3( 0.25 / 255.0, -0.25 / 255.0, 0.25 / 255.0 );
		dither_shift_RGB = mix( 2.0 * dither_shift_RGB, -2.0 * dither_shift_RGB, grid_position );
		return color + dither_shift_RGB;
	}
#endif`,KA=`float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
	vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv );
	roughnessFactor *= texelRoughness.g;
#endif`,YA=`#ifdef USE_ROUGHNESSMAP
	uniform sampler2D roughnessMap;
#endif`,qA=`#if NUM_SPOT_LIGHT_COORDS > 0
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#if NUM_SPOT_LIGHT_MAPS > 0
	uniform sampler2D spotLightMap[ NUM_SPOT_LIGHT_MAPS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform sampler2D directionalShadowMap[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		uniform sampler2D spotShadowMap[ NUM_SPOT_LIGHT_SHADOWS ];
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform sampler2D pointShadowMap[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
	float texture2DCompare( sampler2D depths, vec2 uv, float compare ) {
		float depth = unpackRGBAToDepth( texture2D( depths, uv ) );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			return step( depth, compare );
		#else
			return step( compare, depth );
		#endif
	}
	vec2 texture2DDistribution( sampler2D shadow, vec2 uv ) {
		return unpackRGBATo2Half( texture2D( shadow, uv ) );
	}
	float VSMShadow( sampler2D shadow, vec2 uv, float compare ) {
		float occlusion = 1.0;
		vec2 distribution = texture2DDistribution( shadow, uv );
		#ifdef USE_REVERSED_DEPTH_BUFFER
			float hard_shadow = step( distribution.x, compare );
		#else
			float hard_shadow = step( compare, distribution.x );
		#endif
		if ( hard_shadow != 1.0 ) {
			float distance = compare - distribution.x;
			float variance = max( 0.00000, distribution.y * distribution.y );
			float softness_probability = variance / (variance + distance * distance );			softness_probability = clamp( ( softness_probability - 0.3 ) / ( 0.95 - 0.3 ), 0.0, 1.0 );			occlusion = clamp( max( hard_shadow, softness_probability ), 0.0, 1.0 );
		}
		return occlusion;
	}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
		float shadow = 1.0;
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;
		if ( frustumTest ) {
		#if defined( SHADOWMAP_TYPE_PCF )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx0 = - texelSize.x * shadowRadius;
			float dy0 = - texelSize.y * shadowRadius;
			float dx1 = + texelSize.x * shadowRadius;
			float dy1 = + texelSize.y * shadowRadius;
			float dx2 = dx0 / 2.0;
			float dy2 = dy0 / 2.0;
			float dx3 = dx1 / 2.0;
			float dy3 = dy1 / 2.0;
			shadow = (
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy2 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx2, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx3, dy3 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( 0.0, dy1 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, shadowCoord.xy + vec2( dx1, dy1 ), shadowCoord.z )
			) * ( 1.0 / 17.0 );
		#elif defined( SHADOWMAP_TYPE_PCF_SOFT )
			vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
			float dx = texelSize.x;
			float dy = texelSize.y;
			vec2 uv = shadowCoord.xy;
			vec2 f = fract( uv * shadowMapSize + 0.5 );
			uv -= f * texelSize;
			shadow = (
				texture2DCompare( shadowMap, uv, shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( dx, 0.0 ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + vec2( 0.0, dy ), shadowCoord.z ) +
				texture2DCompare( shadowMap, uv + texelSize, shadowCoord.z ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, 0.0 ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( -dx, dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, dy ), shadowCoord.z ),
					 f.x ) +
				mix( texture2DCompare( shadowMap, uv + vec2( 0.0, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( 0.0, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( texture2DCompare( shadowMap, uv + vec2( dx, -dy ), shadowCoord.z ),
					 texture2DCompare( shadowMap, uv + vec2( dx, 2.0 * dy ), shadowCoord.z ),
					 f.y ) +
				mix( mix( texture2DCompare( shadowMap, uv + vec2( -dx, -dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, -dy ), shadowCoord.z ),
						  f.x ),
					 mix( texture2DCompare( shadowMap, uv + vec2( -dx, 2.0 * dy ), shadowCoord.z ),
						  texture2DCompare( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), shadowCoord.z ),
						  f.x ),
					 f.y )
			) * ( 1.0 / 9.0 );
		#elif defined( SHADOWMAP_TYPE_VSM )
			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );
		#else
			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );
		#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
	vec2 cubeToUV( vec3 v, float texelSizeY ) {
		vec3 absV = abs( v );
		float scaleToCube = 1.0 / max( absV.x, max( absV.y, absV.z ) );
		absV *= scaleToCube;
		v *= scaleToCube * ( 1.0 - 2.0 * texelSizeY );
		vec2 planar = v.xy;
		float almostATexel = 1.5 * texelSizeY;
		float almostOne = 1.0 - almostATexel;
		if ( absV.z >= almostOne ) {
			if ( v.z > 0.0 )
				planar.x = 4.0 - v.x;
		} else if ( absV.x >= almostOne ) {
			float signX = sign( v.x );
			planar.x = v.z * signX + 2.0 * signX;
		} else if ( absV.y >= almostOne ) {
			float signY = sign( v.y );
			planar.x = v.x + 2.0 * signY + 2.0;
			planar.y = v.z * signY - 2.0;
		}
		return vec2( 0.125, 0.25 ) * planar + vec2( 0.375, 0.75 );
	}
	float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {
		float shadow = 1.0;
		vec3 lightToPosition = shadowCoord.xyz;
		
		float lightToPositionLength = length( lightToPosition );
		if ( lightToPositionLength - shadowCameraFar <= 0.0 && lightToPositionLength - shadowCameraNear >= 0.0 ) {
			float dp = ( lightToPositionLength - shadowCameraNear ) / ( shadowCameraFar - shadowCameraNear );			dp += shadowBias;
			vec3 bd3D = normalize( lightToPosition );
			vec2 texelSize = vec2( 1.0 ) / ( shadowMapSize * vec2( 4.0, 2.0 ) );
			#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT ) || defined( SHADOWMAP_TYPE_VSM )
				vec2 offset = vec2( - 1, 1 ) * shadowRadius * texelSize.y;
				shadow = (
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yyx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxy, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.xxx, texelSize.y ), dp ) +
					texture2DCompare( shadowMap, cubeToUV( bd3D + offset.yxx, texelSize.y ), dp )
				) * ( 1.0 / 9.0 );
			#else
				shadow = texture2DCompare( shadowMap, cubeToUV( bd3D, texelSize.y ), dp );
			#endif
		}
		return mix( 1.0, shadow, shadowIntensity );
	}
#endif`,JA=`#if NUM_SPOT_LIGHT_COORDS > 0
	uniform mat4 spotLightMatrix[ NUM_SPOT_LIGHT_COORDS ];
	varying vec4 vSpotLightCoord[ NUM_SPOT_LIGHT_COORDS ];
#endif
#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
		uniform mat4 directionalShadowMatrix[ NUM_DIR_LIGHT_SHADOWS ];
		varying vec4 vDirectionalShadowCoord[ NUM_DIR_LIGHT_SHADOWS ];
		struct DirectionalLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform DirectionalLightShadow directionalLightShadows[ NUM_DIR_LIGHT_SHADOWS ];
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
		struct SpotLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
		};
		uniform SpotLightShadow spotLightShadows[ NUM_SPOT_LIGHT_SHADOWS ];
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		uniform mat4 pointShadowMatrix[ NUM_POINT_LIGHT_SHADOWS ];
		varying vec4 vPointShadowCoord[ NUM_POINT_LIGHT_SHADOWS ];
		struct PointLightShadow {
			float shadowIntensity;
			float shadowBias;
			float shadowNormalBias;
			float shadowRadius;
			vec2 shadowMapSize;
			float shadowCameraNear;
			float shadowCameraFar;
		};
		uniform PointLightShadow pointLightShadows[ NUM_POINT_LIGHT_SHADOWS ];
	#endif
#endif`,ZA=`#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowWorldPosition = worldPosition + vec4( shadowWorldNormal * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowWorldPosition.xyz += shadowWorldNormal * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif`,$A=`float getShadowMask() {
	float shadow = 1.0;
	#ifdef USE_SHADOWMAP
	#if NUM_DIR_LIGHT_SHADOWS > 0
	DirectionalLightShadow directionalLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
		directionalLight = directionalLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( directionalShadowMap[ i ], directionalLight.shadowMapSize, directionalLight.shadowIntensity, directionalLight.shadowBias, directionalLight.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_SPOT_LIGHT_SHADOWS > 0
	SpotLightShadow spotLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_SHADOWS; i ++ ) {
		spotLight = spotLightShadows[ i ];
		shadow *= receiveShadow ? getShadow( spotShadowMap[ i ], spotLight.shadowMapSize, spotLight.shadowIntensity, spotLight.shadowBias, spotLight.shadowRadius, vSpotLightCoord[ i ] ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
	PointLightShadow pointLight;
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
		pointLight = pointLightShadows[ i ];
		shadow *= receiveShadow ? getPointShadow( pointShadowMap[ i ], pointLight.shadowMapSize, pointLight.shadowIntensity, pointLight.shadowBias, pointLight.shadowRadius, vPointShadowCoord[ i ], pointLight.shadowCameraNear, pointLight.shadowCameraFar ) : 1.0;
	}
	#pragma unroll_loop_end
	#endif
	#endif
	return shadow;
}`,ep=`#ifdef USE_SKINNING
	mat4 boneMatX = getBoneMatrix( skinIndex.x );
	mat4 boneMatY = getBoneMatrix( skinIndex.y );
	mat4 boneMatZ = getBoneMatrix( skinIndex.z );
	mat4 boneMatW = getBoneMatrix( skinIndex.w );
#endif`,tp=`#ifdef USE_SKINNING
	uniform mat4 bindMatrix;
	uniform mat4 bindMatrixInverse;
	uniform highp sampler2D boneTexture;
	mat4 getBoneMatrix( const in float i ) {
		int size = textureSize( boneTexture, 0 ).x;
		int j = int( i ) * 4;
		int x = j % size;
		int y = j / size;
		vec4 v1 = texelFetch( boneTexture, ivec2( x, y ), 0 );
		vec4 v2 = texelFetch( boneTexture, ivec2( x + 1, y ), 0 );
		vec4 v3 = texelFetch( boneTexture, ivec2( x + 2, y ), 0 );
		vec4 v4 = texelFetch( boneTexture, ivec2( x + 3, y ), 0 );
		return mat4( v1, v2, v3, v4 );
	}
#endif`,np=`#ifdef USE_SKINNING
	vec4 skinVertex = bindMatrix * vec4( transformed, 1.0 );
	vec4 skinned = vec4( 0.0 );
	skinned += boneMatX * skinVertex * skinWeight.x;
	skinned += boneMatY * skinVertex * skinWeight.y;
	skinned += boneMatZ * skinVertex * skinWeight.z;
	skinned += boneMatW * skinVertex * skinWeight.w;
	transformed = ( bindMatrixInverse * skinned ).xyz;
#endif`,ip=`#ifdef USE_SKINNING
	mat4 skinMatrix = mat4( 0.0 );
	skinMatrix += skinWeight.x * boneMatX;
	skinMatrix += skinWeight.y * boneMatY;
	skinMatrix += skinWeight.z * boneMatZ;
	skinMatrix += skinWeight.w * boneMatW;
	skinMatrix = bindMatrixInverse * skinMatrix * bindMatrix;
	objectNormal = vec4( skinMatrix * vec4( objectNormal, 0.0 ) ).xyz;
	#ifdef USE_TANGENT
		objectTangent = vec4( skinMatrix * vec4( objectTangent, 0.0 ) ).xyz;
	#endif
#endif`,sp=`float specularStrength;
#ifdef USE_SPECULARMAP
	vec4 texelSpecular = texture2D( specularMap, vSpecularMapUv );
	specularStrength = texelSpecular.r;
#else
	specularStrength = 1.0;
#endif`,rp=`#ifdef USE_SPECULARMAP
	uniform sampler2D specularMap;
#endif`,op=`#if defined( TONE_MAPPING )
	gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );
#endif`,ap=`#ifndef saturate
#define saturate( a ) clamp( a, 0.0, 1.0 )
#endif
uniform float toneMappingExposure;
vec3 LinearToneMapping( vec3 color ) {
	return saturate( toneMappingExposure * color );
}
vec3 ReinhardToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	return saturate( color / ( vec3( 1.0 ) + color ) );
}
vec3 CineonToneMapping( vec3 color ) {
	color *= toneMappingExposure;
	color = max( vec3( 0.0 ), color - 0.004 );
	return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}
vec3 RRTAndODTFit( vec3 v ) {
	vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
	vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
	return a / b;
}
vec3 ACESFilmicToneMapping( vec3 color ) {
	const mat3 ACESInputMat = mat3(
		vec3( 0.59719, 0.07600, 0.02840 ),		vec3( 0.35458, 0.90834, 0.13383 ),
		vec3( 0.04823, 0.01566, 0.83777 )
	);
	const mat3 ACESOutputMat = mat3(
		vec3(  1.60475, -0.10208, -0.00327 ),		vec3( -0.53108,  1.10813, -0.07276 ),
		vec3( -0.07367, -0.00605,  1.07602 )
	);
	color *= toneMappingExposure / 0.6;
	color = ACESInputMat * color;
	color = RRTAndODTFit( color );
	color = ACESOutputMat * color;
	return saturate( color );
}
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
	vec3( 1.6605, - 0.1246, - 0.0182 ),
	vec3( - 0.5876, 1.1329, - 0.1006 ),
	vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
	vec3( 0.6274, 0.0691, 0.0164 ),
	vec3( 0.3293, 0.9195, 0.0880 ),
	vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxDefaultContrastApprox( vec3 x ) {
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	return + 15.5 * x4 * x2
		- 40.14 * x4 * x
		+ 31.96 * x4
		- 6.868 * x2 * x
		+ 0.4298 * x2
		+ 0.1191 * x
		- 0.00232;
}
vec3 AgXToneMapping( vec3 color ) {
	const mat3 AgXInsetMatrix = mat3(
		vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
		vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
		vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
	);
	const mat3 AgXOutsetMatrix = mat3(
		vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
		vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
		vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
	);
	const float AgxMinEv = - 12.47393;	const float AgxMaxEv = 4.026069;
	color *= toneMappingExposure;
	color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
	color = AgXInsetMatrix * color;
	color = max( color, 1e-10 );	color = log2( color );
	color = ( color - AgxMinEv ) / ( AgxMaxEv - AgxMinEv );
	color = clamp( color, 0.0, 1.0 );
	color = agxDefaultContrastApprox( color );
	color = AgXOutsetMatrix * color;
	color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
	color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
	color = clamp( color, 0.0, 1.0 );
	return color;
}
vec3 NeutralToneMapping( vec3 color ) {
	const float StartCompression = 0.8 - 0.04;
	const float Desaturation = 0.15;
	color *= toneMappingExposure;
	float x = min( color.r, min( color.g, color.b ) );
	float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
	color -= offset;
	float peak = max( color.r, max( color.g, color.b ) );
	if ( peak < StartCompression ) return color;
	float d = 1. - StartCompression;
	float newPeak = 1. - d * d / ( peak + d - StartCompression );
	color *= newPeak / peak;
	float g = 1. - 1. / ( Desaturation * ( peak - newPeak ) + 1. );
	return mix( color, vec3( newPeak ), g );
}
vec3 CustomToneMapping( vec3 color ) { return color; }`,cp=`#ifdef USE_TRANSMISSION
	material.transmission = transmission;
	material.transmissionAlpha = 1.0;
	material.thickness = thickness;
	material.attenuationDistance = attenuationDistance;
	material.attenuationColor = attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		material.transmission *= texture2D( transmissionMap, vTransmissionMapUv ).r;
	#endif
	#ifdef USE_THICKNESSMAP
		material.thickness *= texture2D( thicknessMap, vThicknessMapUv ).g;
	#endif
	vec3 pos = vWorldPosition;
	vec3 v = normalize( cameraPosition - pos );
	vec3 n = inverseTransformDirection( normal, viewMatrix );
	vec4 transmitted = getIBLVolumeRefraction(
		n, v, material.roughness, material.diffuseColor, material.specularColor, material.specularF90,
		pos, modelMatrix, viewMatrix, projectionMatrix, material.dispersion, material.ior, material.thickness,
		material.attenuationColor, material.attenuationDistance );
	material.transmissionAlpha = mix( material.transmissionAlpha, transmitted.a, material.transmission );
	totalDiffuse = mix( totalDiffuse, transmitted.rgb, material.transmission );
#endif`,lp=`#ifdef USE_TRANSMISSION
	uniform float transmission;
	uniform float thickness;
	uniform float attenuationDistance;
	uniform vec3 attenuationColor;
	#ifdef USE_TRANSMISSIONMAP
		uniform sampler2D transmissionMap;
	#endif
	#ifdef USE_THICKNESSMAP
		uniform sampler2D thicknessMap;
	#endif
	uniform vec2 transmissionSamplerSize;
	uniform sampler2D transmissionSamplerMap;
	uniform mat4 modelMatrix;
	uniform mat4 projectionMatrix;
	varying vec3 vWorldPosition;
	float w0( float a ) {
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - a + 3.0 ) - 3.0 ) + 1.0 );
	}
	float w1( float a ) {
		return ( 1.0 / 6.0 ) * ( a *  a * ( 3.0 * a - 6.0 ) + 4.0 );
	}
	float w2( float a ){
		return ( 1.0 / 6.0 ) * ( a * ( a * ( - 3.0 * a + 3.0 ) + 3.0 ) + 1.0 );
	}
	float w3( float a ) {
		return ( 1.0 / 6.0 ) * ( a * a * a );
	}
	float g0( float a ) {
		return w0( a ) + w1( a );
	}
	float g1( float a ) {
		return w2( a ) + w3( a );
	}
	float h0( float a ) {
		return - 1.0 + w1( a ) / ( w0( a ) + w1( a ) );
	}
	float h1( float a ) {
		return 1.0 + w3( a ) / ( w2( a ) + w3( a ) );
	}
	vec4 bicubic( sampler2D tex, vec2 uv, vec4 texelSize, float lod ) {
		uv = uv * texelSize.zw + 0.5;
		vec2 iuv = floor( uv );
		vec2 fuv = fract( uv );
		float g0x = g0( fuv.x );
		float g1x = g1( fuv.x );
		float h0x = h0( fuv.x );
		float h1x = h1( fuv.x );
		float h0y = h0( fuv.y );
		float h1y = h1( fuv.y );
		vec2 p0 = ( vec2( iuv.x + h0x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p1 = ( vec2( iuv.x + h1x, iuv.y + h0y ) - 0.5 ) * texelSize.xy;
		vec2 p2 = ( vec2( iuv.x + h0x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		vec2 p3 = ( vec2( iuv.x + h1x, iuv.y + h1y ) - 0.5 ) * texelSize.xy;
		return g0( fuv.y ) * ( g0x * textureLod( tex, p0, lod ) + g1x * textureLod( tex, p1, lod ) ) +
			g1( fuv.y ) * ( g0x * textureLod( tex, p2, lod ) + g1x * textureLod( tex, p3, lod ) );
	}
	vec4 textureBicubic( sampler2D sampler, vec2 uv, float lod ) {
		vec2 fLodSize = vec2( textureSize( sampler, int( lod ) ) );
		vec2 cLodSize = vec2( textureSize( sampler, int( lod + 1.0 ) ) );
		vec2 fLodSizeInv = 1.0 / fLodSize;
		vec2 cLodSizeInv = 1.0 / cLodSize;
		vec4 fSample = bicubic( sampler, uv, vec4( fLodSizeInv, fLodSize ), floor( lod ) );
		vec4 cSample = bicubic( sampler, uv, vec4( cLodSizeInv, cLodSize ), ceil( lod ) );
		return mix( fSample, cSample, fract( lod ) );
	}
	vec3 getVolumeTransmissionRay( const in vec3 n, const in vec3 v, const in float thickness, const in float ior, const in mat4 modelMatrix ) {
		vec3 refractionVector = refract( - v, normalize( n ), 1.0 / ior );
		vec3 modelScale;
		modelScale.x = length( vec3( modelMatrix[ 0 ].xyz ) );
		modelScale.y = length( vec3( modelMatrix[ 1 ].xyz ) );
		modelScale.z = length( vec3( modelMatrix[ 2 ].xyz ) );
		return normalize( refractionVector ) * thickness * modelScale;
	}
	float applyIorToRoughness( const in float roughness, const in float ior ) {
		return roughness * clamp( ior * 2.0 - 2.0, 0.0, 1.0 );
	}
	vec4 getTransmissionSample( const in vec2 fragCoord, const in float roughness, const in float ior ) {
		float lod = log2( transmissionSamplerSize.x ) * applyIorToRoughness( roughness, ior );
		return textureBicubic( transmissionSamplerMap, fragCoord.xy, lod );
	}
	vec3 volumeAttenuation( const in float transmissionDistance, const in vec3 attenuationColor, const in float attenuationDistance ) {
		if ( isinf( attenuationDistance ) ) {
			return vec3( 1.0 );
		} else {
			vec3 attenuationCoefficient = -log( attenuationColor ) / attenuationDistance;
			vec3 transmittance = exp( - attenuationCoefficient * transmissionDistance );			return transmittance;
		}
	}
	vec4 getIBLVolumeRefraction( const in vec3 n, const in vec3 v, const in float roughness, const in vec3 diffuseColor,
		const in vec3 specularColor, const in float specularF90, const in vec3 position, const in mat4 modelMatrix,
		const in mat4 viewMatrix, const in mat4 projMatrix, const in float dispersion, const in float ior, const in float thickness,
		const in vec3 attenuationColor, const in float attenuationDistance ) {
		vec4 transmittedLight;
		vec3 transmittance;
		#ifdef USE_DISPERSION
			float halfSpread = ( ior - 1.0 ) * 0.025 * dispersion;
			vec3 iors = vec3( ior - halfSpread, ior, ior + halfSpread );
			for ( int i = 0; i < 3; i ++ ) {
				vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, iors[ i ], modelMatrix );
				vec3 refractedRayExit = position + transmissionRay;
				vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
				vec2 refractionCoords = ndcPos.xy / ndcPos.w;
				refractionCoords += 1.0;
				refractionCoords /= 2.0;
				vec4 transmissionSample = getTransmissionSample( refractionCoords, roughness, iors[ i ] );
				transmittedLight[ i ] = transmissionSample[ i ];
				transmittedLight.a += transmissionSample.a;
				transmittance[ i ] = diffuseColor[ i ] * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance )[ i ];
			}
			transmittedLight.a /= 3.0;
		#else
			vec3 transmissionRay = getVolumeTransmissionRay( n, v, thickness, ior, modelMatrix );
			vec3 refractedRayExit = position + transmissionRay;
			vec4 ndcPos = projMatrix * viewMatrix * vec4( refractedRayExit, 1.0 );
			vec2 refractionCoords = ndcPos.xy / ndcPos.w;
			refractionCoords += 1.0;
			refractionCoords /= 2.0;
			transmittedLight = getTransmissionSample( refractionCoords, roughness, ior );
			transmittance = diffuseColor * volumeAttenuation( length( transmissionRay ), attenuationColor, attenuationDistance );
		#endif
		vec3 attenuatedColor = transmittance * transmittedLight.rgb;
		vec3 F = EnvironmentBRDF( n, v, specularColor, specularF90, roughness );
		float transmittanceFactor = ( transmittance.r + transmittance.g + transmittance.b ) / 3.0;
		return vec4( ( 1.0 - F ) * attenuatedColor, 1.0 - ( 1.0 - transmittedLight.a ) * transmittanceFactor );
	}
#endif`,up=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_SPECULARMAP
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,hp=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	varying vec2 vUv;
#endif
#ifdef USE_MAP
	uniform mat3 mapTransform;
	varying vec2 vMapUv;
#endif
#ifdef USE_ALPHAMAP
	uniform mat3 alphaMapTransform;
	varying vec2 vAlphaMapUv;
#endif
#ifdef USE_LIGHTMAP
	uniform mat3 lightMapTransform;
	varying vec2 vLightMapUv;
#endif
#ifdef USE_AOMAP
	uniform mat3 aoMapTransform;
	varying vec2 vAoMapUv;
#endif
#ifdef USE_BUMPMAP
	uniform mat3 bumpMapTransform;
	varying vec2 vBumpMapUv;
#endif
#ifdef USE_NORMALMAP
	uniform mat3 normalMapTransform;
	varying vec2 vNormalMapUv;
#endif
#ifdef USE_DISPLACEMENTMAP
	uniform mat3 displacementMapTransform;
	varying vec2 vDisplacementMapUv;
#endif
#ifdef USE_EMISSIVEMAP
	uniform mat3 emissiveMapTransform;
	varying vec2 vEmissiveMapUv;
#endif
#ifdef USE_METALNESSMAP
	uniform mat3 metalnessMapTransform;
	varying vec2 vMetalnessMapUv;
#endif
#ifdef USE_ROUGHNESSMAP
	uniform mat3 roughnessMapTransform;
	varying vec2 vRoughnessMapUv;
#endif
#ifdef USE_ANISOTROPYMAP
	uniform mat3 anisotropyMapTransform;
	varying vec2 vAnisotropyMapUv;
#endif
#ifdef USE_CLEARCOATMAP
	uniform mat3 clearcoatMapTransform;
	varying vec2 vClearcoatMapUv;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	uniform mat3 clearcoatNormalMapTransform;
	varying vec2 vClearcoatNormalMapUv;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	uniform mat3 clearcoatRoughnessMapTransform;
	varying vec2 vClearcoatRoughnessMapUv;
#endif
#ifdef USE_SHEEN_COLORMAP
	uniform mat3 sheenColorMapTransform;
	varying vec2 vSheenColorMapUv;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	uniform mat3 sheenRoughnessMapTransform;
	varying vec2 vSheenRoughnessMapUv;
#endif
#ifdef USE_IRIDESCENCEMAP
	uniform mat3 iridescenceMapTransform;
	varying vec2 vIridescenceMapUv;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	uniform mat3 iridescenceThicknessMapTransform;
	varying vec2 vIridescenceThicknessMapUv;
#endif
#ifdef USE_SPECULARMAP
	uniform mat3 specularMapTransform;
	varying vec2 vSpecularMapUv;
#endif
#ifdef USE_SPECULAR_COLORMAP
	uniform mat3 specularColorMapTransform;
	varying vec2 vSpecularColorMapUv;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	uniform mat3 specularIntensityMapTransform;
	varying vec2 vSpecularIntensityMapUv;
#endif
#ifdef USE_TRANSMISSIONMAP
	uniform mat3 transmissionMapTransform;
	varying vec2 vTransmissionMapUv;
#endif
#ifdef USE_THICKNESSMAP
	uniform mat3 thicknessMapTransform;
	varying vec2 vThicknessMapUv;
#endif`,dp=`#if defined( USE_UV ) || defined( USE_ANISOTROPY )
	vUv = vec3( uv, 1 ).xy;
#endif
#ifdef USE_MAP
	vMapUv = ( mapTransform * vec3( MAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ALPHAMAP
	vAlphaMapUv = ( alphaMapTransform * vec3( ALPHAMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_LIGHTMAP
	vLightMapUv = ( lightMapTransform * vec3( LIGHTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_AOMAP
	vAoMapUv = ( aoMapTransform * vec3( AOMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_BUMPMAP
	vBumpMapUv = ( bumpMapTransform * vec3( BUMPMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_NORMALMAP
	vNormalMapUv = ( normalMapTransform * vec3( NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_DISPLACEMENTMAP
	vDisplacementMapUv = ( displacementMapTransform * vec3( DISPLACEMENTMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_EMISSIVEMAP
	vEmissiveMapUv = ( emissiveMapTransform * vec3( EMISSIVEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_METALNESSMAP
	vMetalnessMapUv = ( metalnessMapTransform * vec3( METALNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ROUGHNESSMAP
	vRoughnessMapUv = ( roughnessMapTransform * vec3( ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_ANISOTROPYMAP
	vAnisotropyMapUv = ( anisotropyMapTransform * vec3( ANISOTROPYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOATMAP
	vClearcoatMapUv = ( clearcoatMapTransform * vec3( CLEARCOATMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_NORMALMAP
	vClearcoatNormalMapUv = ( clearcoatNormalMapTransform * vec3( CLEARCOAT_NORMALMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_CLEARCOAT_ROUGHNESSMAP
	vClearcoatRoughnessMapUv = ( clearcoatRoughnessMapTransform * vec3( CLEARCOAT_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCEMAP
	vIridescenceMapUv = ( iridescenceMapTransform * vec3( IRIDESCENCEMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_IRIDESCENCE_THICKNESSMAP
	vIridescenceThicknessMapUv = ( iridescenceThicknessMapTransform * vec3( IRIDESCENCE_THICKNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_COLORMAP
	vSheenColorMapUv = ( sheenColorMapTransform * vec3( SHEEN_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SHEEN_ROUGHNESSMAP
	vSheenRoughnessMapUv = ( sheenRoughnessMapTransform * vec3( SHEEN_ROUGHNESSMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULARMAP
	vSpecularMapUv = ( specularMapTransform * vec3( SPECULARMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_COLORMAP
	vSpecularColorMapUv = ( specularColorMapTransform * vec3( SPECULAR_COLORMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_SPECULAR_INTENSITYMAP
	vSpecularIntensityMapUv = ( specularIntensityMapTransform * vec3( SPECULAR_INTENSITYMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_TRANSMISSIONMAP
	vTransmissionMapUv = ( transmissionMapTransform * vec3( TRANSMISSIONMAP_UV, 1 ) ).xy;
#endif
#ifdef USE_THICKNESSMAP
	vThicknessMapUv = ( thicknessMapTransform * vec3( THICKNESSMAP_UV, 1 ) ).xy;
#endif`,fp=`#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
	vec4 worldPosition = vec4( transformed, 1.0 );
	#ifdef USE_BATCHING
		worldPosition = batchingMatrix * worldPosition;
	#endif
	#ifdef USE_INSTANCING
		worldPosition = instanceMatrix * worldPosition;
	#endif
	worldPosition = modelMatrix * worldPosition;
#endif`;const Ap=`varying vec2 vUv;
uniform mat3 uvTransform;
void main() {
	vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	gl_Position = vec4( position.xy, 1.0, 1.0 );
}`,pp=`uniform sampler2D t2D;
uniform float backgroundIntensity;
varying vec2 vUv;
void main() {
	vec4 texColor = texture2D( t2D, vUv );
	#ifdef DECODE_VIDEO_TEXTURE
		texColor = vec4( mix( pow( texColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), texColor.rgb * 0.0773993808, vec3( lessThanEqual( texColor.rgb, vec3( 0.04045 ) ) ) ), texColor.w );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,mp=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,gp=`#ifdef ENVMAP_TYPE_CUBE
	uniform samplerCube envMap;
#elif defined( ENVMAP_TYPE_CUBE_UV )
	uniform sampler2D envMap;
#endif
uniform float flipEnvMap;
uniform float backgroundBlurriness;
uniform float backgroundIntensity;
uniform mat3 backgroundRotation;
varying vec3 vWorldDirection;
#include <cube_uv_reflection_fragment>
void main() {
	#ifdef ENVMAP_TYPE_CUBE
		vec4 texColor = textureCube( envMap, backgroundRotation * vec3( flipEnvMap * vWorldDirection.x, vWorldDirection.yz ) );
	#elif defined( ENVMAP_TYPE_CUBE_UV )
		vec4 texColor = textureCubeUV( envMap, backgroundRotation * vWorldDirection, backgroundBlurriness );
	#else
		vec4 texColor = vec4( 0.0, 0.0, 0.0, 1.0 );
	#endif
	texColor.rgb *= backgroundIntensity;
	gl_FragColor = texColor;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,vp=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
	gl_Position.z = gl_Position.w;
}`,_p=`uniform samplerCube tCube;
uniform float tFlip;
uniform float opacity;
varying vec3 vWorldDirection;
void main() {
	vec4 texColor = textureCube( tCube, vec3( tFlip * vWorldDirection.x, vWorldDirection.yz ) );
	gl_FragColor = texColor;
	gl_FragColor.a *= opacity;
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,xp=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
varying vec2 vHighPrecisionZW;
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vHighPrecisionZW = gl_Position.zw;
}`,Mp=`#if DEPTH_PACKING == 3200
	uniform float opacity;
#endif
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
varying vec2 vHighPrecisionZW;
void main() {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#if DEPTH_PACKING == 3200
		diffuseColor.a = opacity;
	#endif
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <logdepthbuf_fragment>
	#ifdef USE_REVERSED_DEPTH_BUFFER
		float fragCoordZ = vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ];
	#else
		float fragCoordZ = 0.5 * vHighPrecisionZW[ 0 ] / vHighPrecisionZW[ 1 ] + 0.5;
	#endif
	#if DEPTH_PACKING == 3200
		gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );
	#elif DEPTH_PACKING == 3201
		gl_FragColor = packDepthToRGBA( fragCoordZ );
	#elif DEPTH_PACKING == 3202
		gl_FragColor = vec4( packDepthToRGB( fragCoordZ ), 1.0 );
	#elif DEPTH_PACKING == 3203
		gl_FragColor = vec4( packDepthToRG( fragCoordZ ), 0.0, 1.0 );
	#endif
}`,yp=`#define DISTANCE
varying vec3 vWorldPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <skinbase_vertex>
	#include <morphinstance_vertex>
	#ifdef USE_DISPLACEMENTMAP
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <worldpos_vertex>
	#include <clipping_planes_vertex>
	vWorldPosition = worldPosition.xyz;
}`,Sp=`#define DISTANCE
uniform vec3 referencePosition;
uniform float nearDistance;
uniform float farDistance;
varying vec3 vWorldPosition;
#include <common>
#include <packing>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <clipping_planes_pars_fragment>
void main () {
	vec4 diffuseColor = vec4( 1.0 );
	#include <clipping_planes_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	float dist = length( vWorldPosition - referencePosition );
	dist = ( dist - nearDistance ) / ( farDistance - nearDistance );
	dist = saturate( dist );
	gl_FragColor = packDepthToRGBA( dist );
}`,Tp=`varying vec3 vWorldDirection;
#include <common>
void main() {
	vWorldDirection = transformDirection( position, modelMatrix );
	#include <begin_vertex>
	#include <project_vertex>
}`,Ep=`uniform sampler2D tEquirect;
varying vec3 vWorldDirection;
#include <common>
void main() {
	vec3 direction = normalize( vWorldDirection );
	vec2 sampleUV = equirectUv( direction );
	gl_FragColor = texture2D( tEquirect, sampleUV );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}`,wp=`uniform float scale;
attribute float lineDistance;
varying float vLineDistance;
#include <common>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	vLineDistance = scale * lineDistance;
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,bp=`uniform vec3 diffuse;
uniform float opacity;
uniform float dashSize;
uniform float totalSize;
varying float vLineDistance;
#include <common>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	if ( mod( vLineDistance, totalSize ) > dashSize ) {
		discard;
	}
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Cp=`#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#if defined ( USE_ENVMAP ) || defined ( USE_SKINNING )
		#include <beginnormal_vertex>
		#include <morphnormal_vertex>
		#include <skinbase_vertex>
		#include <skinnormal_vertex>
		#include <defaultnormal_vertex>
	#endif
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <fog_vertex>
}`,Pp=`uniform vec3 diffuse;
uniform float opacity;
#ifndef FLAT_SHADED
	varying vec3 vNormal;
#endif
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	#ifdef USE_LIGHTMAP
		vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
		reflectedLight.indirectDiffuse += lightMapTexel.rgb * lightMapIntensity * RECIPROCAL_PI;
	#else
		reflectedLight.indirectDiffuse += vec3( 1.0 );
	#endif
	#include <aomap_fragment>
	reflectedLight.indirectDiffuse *= diffuseColor.rgb;
	vec3 outgoingLight = reflectedLight.indirectDiffuse;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Rp=`#define LAMBERT
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Dp=`#define LAMBERT
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_lambert_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_lambert_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Ip=`#define MATCAP
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <color_pars_vertex>
#include <displacementmap_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
	vViewPosition = - mvPosition.xyz;
}`,Lp=`#define MATCAP
uniform vec3 diffuse;
uniform float opacity;
uniform sampler2D matcap;
varying vec3 vViewPosition;
#include <common>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	vec3 viewDir = normalize( vViewPosition );
	vec3 x = normalize( vec3( viewDir.z, 0.0, - viewDir.x ) );
	vec3 y = cross( viewDir, x );
	vec2 uv = vec2( dot( x, normal ), dot( y, normal ) ) * 0.495 + 0.5;
	#ifdef USE_MATCAP
		vec4 matcapColor = texture2D( matcap, uv );
	#else
		vec4 matcapColor = vec4( vec3( mix( 0.2, 0.8, uv.y ) ), 1.0 );
	#endif
	vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Up=`#define NORMAL
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	vViewPosition = - mvPosition.xyz;
#endif
}`,Np=`#define NORMAL
uniform float opacity;
#if defined( FLAT_SHADED ) || defined( USE_BUMPMAP ) || defined( USE_NORMALMAP_TANGENTSPACE )
	varying vec3 vViewPosition;
#endif
#include <packing>
#include <uv_pars_fragment>
#include <normal_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( 0.0, 0.0, 0.0, opacity );
	#include <clipping_planes_fragment>
	#include <logdepthbuf_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	gl_FragColor = vec4( packNormalToRGB( normal ), diffuseColor.a );
	#ifdef OPAQUE
		gl_FragColor.a = 1.0;
	#endif
}`,Fp=`#define PHONG
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <envmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <envmap_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Op=`#define PHONG
uniform vec3 diffuse;
uniform vec3 emissive;
uniform vec3 specular;
uniform float shininess;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_phong_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <specularmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <specularmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_phong_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + reflectedLight.directSpecular + reflectedLight.indirectSpecular + totalEmissiveRadiance;
	#include <envmap_fragment>
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Bp=`#define STANDARD
varying vec3 vViewPosition;
#ifdef USE_TRANSMISSION
	varying vec3 vWorldPosition;
#endif
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
#ifdef USE_TRANSMISSION
	vWorldPosition = worldPosition.xyz;
#endif
}`,zp=`#define STANDARD
#ifdef PHYSICAL
	#define IOR
	#define USE_SPECULAR
#endif
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float roughness;
uniform float metalness;
uniform float opacity;
#ifdef IOR
	uniform float ior;
#endif
#ifdef USE_SPECULAR
	uniform float specularIntensity;
	uniform vec3 specularColor;
	#ifdef USE_SPECULAR_COLORMAP
		uniform sampler2D specularColorMap;
	#endif
	#ifdef USE_SPECULAR_INTENSITYMAP
		uniform sampler2D specularIntensityMap;
	#endif
#endif
#ifdef USE_CLEARCOAT
	uniform float clearcoat;
	uniform float clearcoatRoughness;
#endif
#ifdef USE_DISPERSION
	uniform float dispersion;
#endif
#ifdef USE_IRIDESCENCE
	uniform float iridescence;
	uniform float iridescenceIOR;
	uniform float iridescenceThicknessMinimum;
	uniform float iridescenceThicknessMaximum;
#endif
#ifdef USE_SHEEN
	uniform vec3 sheenColor;
	uniform float sheenRoughness;
	#ifdef USE_SHEEN_COLORMAP
		uniform sampler2D sheenColorMap;
	#endif
	#ifdef USE_SHEEN_ROUGHNESSMAP
		uniform sampler2D sheenRoughnessMap;
	#endif
#endif
#ifdef USE_ANISOTROPY
	uniform vec2 anisotropyVector;
	#ifdef USE_ANISOTROPYMAP
		uniform sampler2D anisotropyMap;
	#endif
#endif
varying vec3 vViewPosition;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <iridescence_fragment>
#include <cube_uv_reflection_fragment>
#include <envmap_common_pars_fragment>
#include <envmap_physical_pars_fragment>
#include <fog_pars_fragment>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_physical_pars_fragment>
#include <transmission_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <clearcoat_pars_fragment>
#include <iridescence_pars_fragment>
#include <roughnessmap_pars_fragment>
#include <metalnessmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <roughnessmap_fragment>
	#include <metalnessmap_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <clearcoat_normal_fragment_begin>
	#include <clearcoat_normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_physical_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
	vec3 totalSpecular = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
	#include <transmission_fragment>
	vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
	#ifdef USE_SHEEN
		float sheenEnergyComp = 1.0 - 0.157 * max3( material.sheenColor );
		outgoingLight = outgoingLight * sheenEnergyComp + sheenSpecularDirect + sheenSpecularIndirect;
	#endif
	#ifdef USE_CLEARCOAT
		float dotNVcc = saturate( dot( geometryClearcoatNormal, geometryViewDir ) );
		vec3 Fcc = F_Schlick( material.clearcoatF0, material.clearcoatF90, dotNVcc );
		outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc ) + ( clearcoatSpecularDirect + clearcoatSpecularIndirect ) * material.clearcoat;
	#endif
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,kp=`#define TOON
varying vec3 vViewPosition;
#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <displacementmap_pars_vertex>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <normal_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <normal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <displacementmap_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	vViewPosition = - mvPosition.xyz;
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Hp=`#define TOON
uniform vec3 diffuse;
uniform vec3 emissive;
uniform float opacity;
#include <common>
#include <packing>
#include <dithering_pars_fragment>
#include <color_pars_fragment>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <aomap_pars_fragment>
#include <lightmap_pars_fragment>
#include <emissivemap_pars_fragment>
#include <gradientmap_pars_fragment>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <normal_pars_fragment>
#include <lights_toon_pars_fragment>
#include <shadowmap_pars_fragment>
#include <bumpmap_pars_fragment>
#include <normalmap_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 totalEmissiveRadiance = emissive;
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <color_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	#include <normal_fragment_begin>
	#include <normal_fragment_maps>
	#include <emissivemap_fragment>
	#include <lights_toon_fragment>
	#include <lights_fragment_begin>
	#include <lights_fragment_maps>
	#include <lights_fragment_end>
	#include <aomap_fragment>
	vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
	#include <dithering_fragment>
}`,Gp=`uniform float size;
uniform float scale;
#include <common>
#include <color_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
#ifdef USE_POINTS_UV
	varying vec2 vUv;
	uniform mat3 uvTransform;
#endif
void main() {
	#ifdef USE_POINTS_UV
		vUv = ( uvTransform * vec3( uv, 1 ) ).xy;
	#endif
	#include <color_vertex>
	#include <morphinstance_vertex>
	#include <morphcolor_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <project_vertex>
	gl_PointSize = size;
	#ifdef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) gl_PointSize *= ( scale / - mvPosition.z );
	#endif
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <worldpos_vertex>
	#include <fog_vertex>
}`,Vp=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <color_pars_fragment>
#include <map_particle_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_particle_fragment>
	#include <color_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
	#include <premultiplied_alpha_fragment>
}`,Wp=`#include <common>
#include <batching_pars_vertex>
#include <fog_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
void main() {
	#include <batching_vertex>
	#include <beginnormal_vertex>
	#include <morphinstance_vertex>
	#include <morphnormal_vertex>
	#include <skinbase_vertex>
	#include <skinnormal_vertex>
	#include <defaultnormal_vertex>
	#include <begin_vertex>
	#include <morphtarget_vertex>
	#include <skinning_vertex>
	#include <project_vertex>
	#include <logdepthbuf_vertex>
	#include <worldpos_vertex>
	#include <shadowmap_vertex>
	#include <fog_vertex>
}`,Xp=`uniform vec3 color;
uniform float opacity;
#include <common>
#include <packing>
#include <fog_pars_fragment>
#include <bsdfs>
#include <lights_pars_begin>
#include <logdepthbuf_pars_fragment>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
void main() {
	#include <logdepthbuf_fragment>
	gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,jp=`uniform float rotation;
uniform vec2 center;
#include <common>
#include <uv_pars_vertex>
#include <fog_pars_vertex>
#include <logdepthbuf_pars_vertex>
#include <clipping_planes_pars_vertex>
void main() {
	#include <uv_vertex>
	vec4 mvPosition = modelViewMatrix[ 3 ];
	vec2 scale = vec2( length( modelMatrix[ 0 ].xyz ), length( modelMatrix[ 1 ].xyz ) );
	#ifndef USE_SIZEATTENUATION
		bool isPerspective = isPerspectiveMatrix( projectionMatrix );
		if ( isPerspective ) scale *= - mvPosition.z;
	#endif
	vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale;
	vec2 rotatedPosition;
	rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
	rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
	mvPosition.xy += rotatedPosition;
	gl_Position = projectionMatrix * mvPosition;
	#include <logdepthbuf_vertex>
	#include <clipping_planes_vertex>
	#include <fog_vertex>
}`,Qp=`uniform vec3 diffuse;
uniform float opacity;
#include <common>
#include <uv_pars_fragment>
#include <map_pars_fragment>
#include <alphamap_pars_fragment>
#include <alphatest_pars_fragment>
#include <alphahash_pars_fragment>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <clipping_planes_pars_fragment>
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <clipping_planes_fragment>
	vec3 outgoingLight = vec3( 0.0 );
	#include <logdepthbuf_fragment>
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	#include <alphahash_fragment>
	outgoingLight = diffuseColor.rgb;
	#include <opaque_fragment>
	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}`,He={alphahash_fragment:pf,alphahash_pars_fragment:mf,alphamap_fragment:gf,alphamap_pars_fragment:vf,alphatest_fragment:_f,alphatest_pars_fragment:xf,aomap_fragment:Mf,aomap_pars_fragment:yf,batching_pars_vertex:Sf,batching_vertex:Tf,begin_vertex:Ef,beginnormal_vertex:wf,bsdfs:bf,iridescence_fragment:Cf,bumpmap_pars_fragment:Pf,clipping_planes_fragment:Rf,clipping_planes_pars_fragment:Df,clipping_planes_pars_vertex:If,clipping_planes_vertex:Lf,color_fragment:Uf,color_pars_fragment:Nf,color_pars_vertex:Ff,color_vertex:Of,common:Bf,cube_uv_reflection_fragment:zf,defaultnormal_vertex:kf,displacementmap_pars_vertex:Hf,displacementmap_vertex:Gf,emissivemap_fragment:Vf,emissivemap_pars_fragment:Wf,colorspace_fragment:Xf,colorspace_pars_fragment:jf,envmap_fragment:Qf,envmap_common_pars_fragment:Kf,envmap_pars_fragment:Yf,envmap_pars_vertex:qf,envmap_physical_pars_fragment:aA,envmap_vertex:Jf,fog_vertex:Zf,fog_pars_vertex:$f,fog_fragment:eA,fog_pars_fragment:tA,gradientmap_pars_fragment:nA,lightmap_pars_fragment:iA,lights_lambert_fragment:sA,lights_lambert_pars_fragment:rA,lights_pars_begin:oA,lights_toon_fragment:cA,lights_toon_pars_fragment:lA,lights_phong_fragment:uA,lights_phong_pars_fragment:hA,lights_physical_fragment:dA,lights_physical_pars_fragment:fA,lights_fragment_begin:AA,lights_fragment_maps:pA,lights_fragment_end:mA,logdepthbuf_fragment:gA,logdepthbuf_pars_fragment:vA,logdepthbuf_pars_vertex:_A,logdepthbuf_vertex:xA,map_fragment:MA,map_pars_fragment:yA,map_particle_fragment:SA,map_particle_pars_fragment:TA,metalnessmap_fragment:EA,metalnessmap_pars_fragment:wA,morphinstance_vertex:bA,morphcolor_vertex:CA,morphnormal_vertex:PA,morphtarget_pars_vertex:RA,morphtarget_vertex:DA,normal_fragment_begin:IA,normal_fragment_maps:LA,normal_pars_fragment:UA,normal_pars_vertex:NA,normal_vertex:FA,normalmap_pars_fragment:OA,clearcoat_normal_fragment_begin:BA,clearcoat_normal_fragment_maps:zA,clearcoat_pars_fragment:kA,iridescence_pars_fragment:HA,opaque_fragment:GA,packing:VA,premultiplied_alpha_fragment:WA,project_vertex:XA,dithering_fragment:jA,dithering_pars_fragment:QA,roughnessmap_fragment:KA,roughnessmap_pars_fragment:YA,shadowmap_pars_fragment:qA,shadowmap_pars_vertex:JA,shadowmap_vertex:ZA,shadowmask_pars_fragment:$A,skinbase_vertex:ep,skinning_pars_vertex:tp,skinning_vertex:np,skinnormal_vertex:ip,specularmap_fragment:sp,specularmap_pars_fragment:rp,tonemapping_fragment:op,tonemapping_pars_fragment:ap,transmission_fragment:cp,transmission_pars_fragment:lp,uv_pars_fragment:up,uv_pars_vertex:hp,uv_vertex:dp,worldpos_vertex:fp,background_vert:Ap,background_frag:pp,backgroundCube_vert:mp,backgroundCube_frag:gp,cube_vert:vp,cube_frag:_p,depth_vert:xp,depth_frag:Mp,distanceRGBA_vert:yp,distanceRGBA_frag:Sp,equirect_vert:Tp,equirect_frag:Ep,linedashed_vert:wp,linedashed_frag:bp,meshbasic_vert:Cp,meshbasic_frag:Pp,meshlambert_vert:Rp,meshlambert_frag:Dp,meshmatcap_vert:Ip,meshmatcap_frag:Lp,meshnormal_vert:Up,meshnormal_frag:Np,meshphong_vert:Fp,meshphong_frag:Op,meshphysical_vert:Bp,meshphysical_frag:zp,meshtoon_vert:kp,meshtoon_frag:Hp,points_vert:Gp,points_frag:Vp,shadow_vert:Wp,shadow_frag:Xp,sprite_vert:jp,sprite_frag:Qp},ce={common:{diffuse:{value:new be(16777215)},opacity:{value:1},map:{value:null},mapTransform:{value:new ke},alphaMap:{value:null},alphaMapTransform:{value:new ke},alphaTest:{value:0}},specularmap:{specularMap:{value:null},specularMapTransform:{value:new ke}},envmap:{envMap:{value:null},envMapRotation:{value:new ke},flipEnvMap:{value:-1},reflectivity:{value:1},ior:{value:1.5},refractionRatio:{value:.98}},aomap:{aoMap:{value:null},aoMapIntensity:{value:1},aoMapTransform:{value:new ke}},lightmap:{lightMap:{value:null},lightMapIntensity:{value:1},lightMapTransform:{value:new ke}},bumpmap:{bumpMap:{value:null},bumpMapTransform:{value:new ke},bumpScale:{value:1}},normalmap:{normalMap:{value:null},normalMapTransform:{value:new ke},normalScale:{value:new fe(1,1)}},displacementmap:{displacementMap:{value:null},displacementMapTransform:{value:new ke},displacementScale:{value:1},displacementBias:{value:0}},emissivemap:{emissiveMap:{value:null},emissiveMapTransform:{value:new ke}},metalnessmap:{metalnessMap:{value:null},metalnessMapTransform:{value:new ke}},roughnessmap:{roughnessMap:{value:null},roughnessMapTransform:{value:new ke}},gradientmap:{gradientMap:{value:null}},fog:{fogDensity:{value:25e-5},fogNear:{value:1},fogFar:{value:2e3},fogColor:{value:new be(16777215)}},lights:{ambientLightColor:{value:[]},lightProbe:{value:[]},directionalLights:{value:[],properties:{direction:{},color:{}}},directionalLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},directionalShadowMap:{value:[]},directionalShadowMatrix:{value:[]},spotLights:{value:[],properties:{color:{},position:{},direction:{},distance:{},coneCos:{},penumbraCos:{},decay:{}}},spotLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{}}},spotLightMap:{value:[]},spotShadowMap:{value:[]},spotLightMatrix:{value:[]},pointLights:{value:[],properties:{color:{},position:{},decay:{},distance:{}}},pointLightShadows:{value:[],properties:{shadowIntensity:1,shadowBias:{},shadowNormalBias:{},shadowRadius:{},shadowMapSize:{},shadowCameraNear:{},shadowCameraFar:{}}},pointShadowMap:{value:[]},pointShadowMatrix:{value:[]},hemisphereLights:{value:[],properties:{direction:{},skyColor:{},groundColor:{}}},rectAreaLights:{value:[],properties:{color:{},position:{},width:{},height:{}}},ltc_1:{value:null},ltc_2:{value:null}},points:{diffuse:{value:new be(16777215)},opacity:{value:1},size:{value:1},scale:{value:1},map:{value:null},alphaMap:{value:null},alphaMapTransform:{value:new ke},alphaTest:{value:0},uvTransform:{value:new ke}},sprite:{diffuse:{value:new be(16777215)},opacity:{value:1},center:{value:new fe(.5,.5)},rotation:{value:0},map:{value:null},mapTransform:{value:new ke},alphaMap:{value:null},alphaMapTransform:{value:new ke},alphaTest:{value:0}}},ln={basic:{uniforms:Rt([ce.common,ce.specularmap,ce.envmap,ce.aomap,ce.lightmap,ce.fog]),vertexShader:He.meshbasic_vert,fragmentShader:He.meshbasic_frag},lambert:{uniforms:Rt([ce.common,ce.specularmap,ce.envmap,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.fog,ce.lights,{emissive:{value:new be(0)}}]),vertexShader:He.meshlambert_vert,fragmentShader:He.meshlambert_frag},phong:{uniforms:Rt([ce.common,ce.specularmap,ce.envmap,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.fog,ce.lights,{emissive:{value:new be(0)},specular:{value:new be(1118481)},shininess:{value:30}}]),vertexShader:He.meshphong_vert,fragmentShader:He.meshphong_frag},standard:{uniforms:Rt([ce.common,ce.envmap,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.roughnessmap,ce.metalnessmap,ce.fog,ce.lights,{emissive:{value:new be(0)},roughness:{value:1},metalness:{value:0},envMapIntensity:{value:1}}]),vertexShader:He.meshphysical_vert,fragmentShader:He.meshphysical_frag},toon:{uniforms:Rt([ce.common,ce.aomap,ce.lightmap,ce.emissivemap,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.gradientmap,ce.fog,ce.lights,{emissive:{value:new be(0)}}]),vertexShader:He.meshtoon_vert,fragmentShader:He.meshtoon_frag},matcap:{uniforms:Rt([ce.common,ce.bumpmap,ce.normalmap,ce.displacementmap,ce.fog,{matcap:{value:null}}]),vertexShader:He.meshmatcap_vert,fragmentShader:He.meshmatcap_frag},points:{uniforms:Rt([ce.points,ce.fog]),vertexShader:He.points_vert,fragmentShader:He.points_frag},dashed:{uniforms:Rt([ce.common,ce.fog,{scale:{value:1},dashSize:{value:1},totalSize:{value:2}}]),vertexShader:He.linedashed_vert,fragmentShader:He.linedashed_frag},depth:{uniforms:Rt([ce.common,ce.displacementmap]),vertexShader:He.depth_vert,fragmentShader:He.depth_frag},normal:{uniforms:Rt([ce.common,ce.bumpmap,ce.normalmap,ce.displacementmap,{opacity:{value:1}}]),vertexShader:He.meshnormal_vert,fragmentShader:He.meshnormal_frag},sprite:{uniforms:Rt([ce.sprite,ce.fog]),vertexShader:He.sprite_vert,fragmentShader:He.sprite_frag},background:{uniforms:{uvTransform:{value:new ke},t2D:{value:null},backgroundIntensity:{value:1}},vertexShader:He.background_vert,fragmentShader:He.background_frag},backgroundCube:{uniforms:{envMap:{value:null},flipEnvMap:{value:-1},backgroundBlurriness:{value:0},backgroundIntensity:{value:1},backgroundRotation:{value:new ke}},vertexShader:He.backgroundCube_vert,fragmentShader:He.backgroundCube_frag},cube:{uniforms:{tCube:{value:null},tFlip:{value:-1},opacity:{value:1}},vertexShader:He.cube_vert,fragmentShader:He.cube_frag},equirect:{uniforms:{tEquirect:{value:null}},vertexShader:He.equirect_vert,fragmentShader:He.equirect_frag},distanceRGBA:{uniforms:Rt([ce.common,ce.displacementmap,{referencePosition:{value:new R},nearDistance:{value:1},farDistance:{value:1e3}}]),vertexShader:He.distanceRGBA_vert,fragmentShader:He.distanceRGBA_frag},shadow:{uniforms:Rt([ce.lights,ce.fog,{color:{value:new be(0)},opacity:{value:1}}]),vertexShader:He.shadow_vert,fragmentShader:He.shadow_frag}};ln.physical={uniforms:Rt([ln.standard.uniforms,{clearcoat:{value:0},clearcoatMap:{value:null},clearcoatMapTransform:{value:new ke},clearcoatNormalMap:{value:null},clearcoatNormalMapTransform:{value:new ke},clearcoatNormalScale:{value:new fe(1,1)},clearcoatRoughness:{value:0},clearcoatRoughnessMap:{value:null},clearcoatRoughnessMapTransform:{value:new ke},dispersion:{value:0},iridescence:{value:0},iridescenceMap:{value:null},iridescenceMapTransform:{value:new ke},iridescenceIOR:{value:1.3},iridescenceThicknessMinimum:{value:100},iridescenceThicknessMaximum:{value:400},iridescenceThicknessMap:{value:null},iridescenceThicknessMapTransform:{value:new ke},sheen:{value:0},sheenColor:{value:new be(0)},sheenColorMap:{value:null},sheenColorMapTransform:{value:new ke},sheenRoughness:{value:1},sheenRoughnessMap:{value:null},sheenRoughnessMapTransform:{value:new ke},transmission:{value:0},transmissionMap:{value:null},transmissionMapTransform:{value:new ke},transmissionSamplerSize:{value:new fe},transmissionSamplerMap:{value:null},thickness:{value:0},thicknessMap:{value:null},thicknessMapTransform:{value:new ke},attenuationDistance:{value:0},attenuationColor:{value:new be(0)},specularColor:{value:new be(1,1,1)},specularColorMap:{value:null},specularColorMapTransform:{value:new ke},specularIntensity:{value:1},specularIntensityMap:{value:null},specularIntensityMapTransform:{value:new ke},anisotropyVector:{value:new fe},anisotropyMap:{value:null},anisotropyMapTransform:{value:new ke}}]),vertexShader:He.meshphysical_vert,fragmentShader:He.meshphysical_frag};const fr={r:0,b:0,g:0},qn=new sn,Kp=new Ne;function Yp(s,e,t,n,i,r,o){const a=new be(0);let c=r===!0?0:1,l,u,h=null,d=0,f=null;function m(y){let v=y.isScene===!0?y.background:null;return v&&v.isTexture&&(v=(y.backgroundBlurriness>0?t:e).get(v)),v}function g(y){let v=!1;const w=m(y);w===null?A(a,c):w&&w.isColor&&(A(w,1),v=!0);const E=s.xr.getEnvironmentBlendMode();E==="additive"?n.buffers.color.setClear(0,0,0,1,o):E==="alpha-blend"&&n.buffers.color.setClear(0,0,0,0,o),(s.autoClear||v)&&(n.buffers.depth.setTest(!0),n.buffers.depth.setMask(!0),n.buffers.color.setMask(!0),s.clear(s.autoClearColor,s.autoClearDepth,s.autoClearStencil))}function p(y,v){const w=m(v);w&&(w.isCubeTexture||w.mapping===Cr)?(u===void 0&&(u=new Qe(new rn(1,1,1),new Vn({name:"BackgroundCubeMaterial",uniforms:Vi(ln.backgroundCube.uniforms),vertexShader:ln.backgroundCube.vertexShader,fragmentShader:ln.backgroundCube.fragmentShader,side:It,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),u.geometry.deleteAttribute("normal"),u.geometry.deleteAttribute("uv"),u.onBeforeRender=function(E,C,P){this.matrixWorld.copyPosition(P.matrixWorld)},Object.defineProperty(u.material,"envMap",{get:function(){return this.uniforms.envMap.value}}),i.update(u)),qn.copy(v.backgroundRotation),qn.x*=-1,qn.y*=-1,qn.z*=-1,w.isCubeTexture&&w.isRenderTargetTexture===!1&&(qn.y*=-1,qn.z*=-1),u.material.uniforms.envMap.value=w,u.material.uniforms.flipEnvMap.value=w.isCubeTexture&&w.isRenderTargetTexture===!1?-1:1,u.material.uniforms.backgroundBlurriness.value=v.backgroundBlurriness,u.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,u.material.uniforms.backgroundRotation.value.setFromMatrix4(Kp.makeRotationFromEuler(qn)),u.material.toneMapped=je.getTransfer(w.colorSpace)!==tt,(h!==w||d!==w.version||f!==s.toneMapping)&&(u.material.needsUpdate=!0,h=w,d=w.version,f=s.toneMapping),u.layers.enableAll(),y.unshift(u,u.geometry,u.material,0,0,null)):w&&w.isTexture&&(l===void 0&&(l=new Qe(new Rn(2,2),new Vn({name:"BackgroundMaterial",uniforms:Vi(ln.background.uniforms),vertexShader:ln.background.vertexShader,fragmentShader:ln.background.fragmentShader,side:bn,depthTest:!1,depthWrite:!1,fog:!1,allowOverride:!1})),l.geometry.deleteAttribute("normal"),Object.defineProperty(l.material,"map",{get:function(){return this.uniforms.t2D.value}}),i.update(l)),l.material.uniforms.t2D.value=w,l.material.uniforms.backgroundIntensity.value=v.backgroundIntensity,l.material.toneMapped=je.getTransfer(w.colorSpace)!==tt,w.matrixAutoUpdate===!0&&w.updateMatrix(),l.material.uniforms.uvTransform.value.copy(w.matrix),(h!==w||d!==w.version||f!==s.toneMapping)&&(l.material.needsUpdate=!0,h=w,d=w.version,f=s.toneMapping),l.layers.enableAll(),y.unshift(l,l.geometry,l.material,0,0,null))}function A(y,v){y.getRGB(fr,ql(s)),n.buffers.color.setClear(fr.r,fr.g,fr.b,v,o)}function T(){u!==void 0&&(u.geometry.dispose(),u.material.dispose(),u=void 0),l!==void 0&&(l.geometry.dispose(),l.material.dispose(),l=void 0)}return{getClearColor:function(){return a},setClearColor:function(y,v=1){a.set(y),c=v,A(a,c)},getClearAlpha:function(){return c},setClearAlpha:function(y){c=y,A(a,c)},render:g,addToRenderList:p,dispose:T}}function qp(s,e){const t=s.getParameter(s.MAX_VERTEX_ATTRIBS),n={},i=d(null);let r=i,o=!1;function a(M,I,F,z,G){let j=!1;const B=h(z,F,I);r!==B&&(r=B,l(r.object)),j=f(M,z,F,G),j&&m(M,z,F,G),G!==null&&e.update(G,s.ELEMENT_ARRAY_BUFFER),(j||o)&&(o=!1,v(M,I,F,z),G!==null&&s.bindBuffer(s.ELEMENT_ARRAY_BUFFER,e.get(G).buffer))}function c(){return s.createVertexArray()}function l(M){return s.bindVertexArray(M)}function u(M){return s.deleteVertexArray(M)}function h(M,I,F){const z=F.wireframe===!0;let G=n[M.id];G===void 0&&(G={},n[M.id]=G);let j=G[I.id];j===void 0&&(j={},G[I.id]=j);let B=j[z];return B===void 0&&(B=d(c()),j[z]=B),B}function d(M){const I=[],F=[],z=[];for(let G=0;G<t;G++)I[G]=0,F[G]=0,z[G]=0;return{geometry:null,program:null,wireframe:!1,newAttributes:I,enabledAttributes:F,attributeDivisors:z,object:M,attributes:{},index:null}}function f(M,I,F,z){const G=r.attributes,j=I.attributes;let B=0;const J=F.getAttributes();for(const W in J)if(J[W].location>=0){const $=G[W];let le=j[W];if(le===void 0&&(W==="instanceMatrix"&&M.instanceMatrix&&(le=M.instanceMatrix),W==="instanceColor"&&M.instanceColor&&(le=M.instanceColor)),$===void 0||$.attribute!==le||le&&$.data!==le.data)return!0;B++}return r.attributesNum!==B||r.index!==z}function m(M,I,F,z){const G={},j=I.attributes;let B=0;const J=F.getAttributes();for(const W in J)if(J[W].location>=0){let $=j[W];$===void 0&&(W==="instanceMatrix"&&M.instanceMatrix&&($=M.instanceMatrix),W==="instanceColor"&&M.instanceColor&&($=M.instanceColor));const le={};le.attribute=$,$&&$.data&&(le.data=$.data),G[W]=le,B++}r.attributes=G,r.attributesNum=B,r.index=z}function g(){const M=r.newAttributes;for(let I=0,F=M.length;I<F;I++)M[I]=0}function p(M){A(M,0)}function A(M,I){const F=r.newAttributes,z=r.enabledAttributes,G=r.attributeDivisors;F[M]=1,z[M]===0&&(s.enableVertexAttribArray(M),z[M]=1),G[M]!==I&&(s.vertexAttribDivisor(M,I),G[M]=I)}function T(){const M=r.newAttributes,I=r.enabledAttributes;for(let F=0,z=I.length;F<z;F++)I[F]!==M[F]&&(s.disableVertexAttribArray(F),I[F]=0)}function y(M,I,F,z,G,j,B){B===!0?s.vertexAttribIPointer(M,I,F,G,j):s.vertexAttribPointer(M,I,F,z,G,j)}function v(M,I,F,z){g();const G=z.attributes,j=F.getAttributes(),B=I.defaultAttributeValues;for(const J in j){const W=j[J];if(W.location>=0){let K=G[J];if(K===void 0&&(J==="instanceMatrix"&&M.instanceMatrix&&(K=M.instanceMatrix),J==="instanceColor"&&M.instanceColor&&(K=M.instanceColor)),K!==void 0){const $=K.normalized,le=K.itemSize,De=e.get(K);if(De===void 0)continue;const Ve=De.buffer,Ye=De.type,ae=De.bytesPerElement,k=Ye===s.INT||Ye===s.UNSIGNED_INT||K.gpuType===Ta;if(K.isInterleavedBufferAttribute){const X=K.data,se=X.stride,_e=K.offset;if(X.isInstancedInterleavedBuffer){for(let me=0;me<W.locationSize;me++)A(W.location+me,X.meshPerAttribute);M.isInstancedMesh!==!0&&z._maxInstanceCount===void 0&&(z._maxInstanceCount=X.meshPerAttribute*X.count)}else for(let me=0;me<W.locationSize;me++)p(W.location+me);s.bindBuffer(s.ARRAY_BUFFER,Ve);for(let me=0;me<W.locationSize;me++)y(W.location+me,le/W.locationSize,Ye,$,se*ae,(_e+le/W.locationSize*me)*ae,k)}else{if(K.isInstancedBufferAttribute){for(let X=0;X<W.locationSize;X++)A(W.location+X,K.meshPerAttribute);M.isInstancedMesh!==!0&&z._maxInstanceCount===void 0&&(z._maxInstanceCount=K.meshPerAttribute*K.count)}else for(let X=0;X<W.locationSize;X++)p(W.location+X);s.bindBuffer(s.ARRAY_BUFFER,Ve);for(let X=0;X<W.locationSize;X++)y(W.location+X,le/W.locationSize,Ye,$,le*ae,le/W.locationSize*X*ae,k)}}else if(B!==void 0){const $=B[J];if($!==void 0)switch($.length){case 2:s.vertexAttrib2fv(W.location,$);break;case 3:s.vertexAttrib3fv(W.location,$);break;case 4:s.vertexAttrib4fv(W.location,$);break;default:s.vertexAttrib1fv(W.location,$)}}}}T()}function w(){P();for(const M in n){const I=n[M];for(const F in I){const z=I[F];for(const G in z)u(z[G].object),delete z[G];delete I[F]}delete n[M]}}function E(M){if(n[M.id]===void 0)return;const I=n[M.id];for(const F in I){const z=I[F];for(const G in z)u(z[G].object),delete z[G];delete I[F]}delete n[M.id]}function C(M){for(const I in n){const F=n[I];if(F[M.id]===void 0)continue;const z=F[M.id];for(const G in z)u(z[G].object),delete z[G];delete F[M.id]}}function P(){x(),o=!0,r!==i&&(r=i,l(r.object))}function x(){i.geometry=null,i.program=null,i.wireframe=!1}return{setup:a,reset:P,resetDefaultState:x,dispose:w,releaseStatesOfGeometry:E,releaseStatesOfProgram:C,initAttributes:g,enableAttribute:p,disableUnusedAttributes:T}}function Jp(s,e,t){let n;function i(l){n=l}function r(l,u){s.drawArrays(n,l,u),t.update(u,n,1)}function o(l,u,h){h!==0&&(s.drawArraysInstanced(n,l,u,h),t.update(u,n,h))}function a(l,u,h){if(h===0)return;e.get("WEBGL_multi_draw").multiDrawArraysWEBGL(n,l,0,u,0,h);let f=0;for(let m=0;m<h;m++)f+=u[m];t.update(f,n,1)}function c(l,u,h,d){if(h===0)return;const f=e.get("WEBGL_multi_draw");if(f===null)for(let m=0;m<l.length;m++)o(l[m],u[m],d[m]);else{f.multiDrawArraysInstancedWEBGL(n,l,0,u,0,d,0,h);let m=0;for(let g=0;g<h;g++)m+=u[g]*d[g];t.update(m,n,1)}}this.setMode=i,this.render=r,this.renderInstances=o,this.renderMultiDraw=a,this.renderMultiDrawInstances=c}function Zp(s,e,t,n){let i;function r(){if(i!==void 0)return i;if(e.has("EXT_texture_filter_anisotropic")===!0){const C=e.get("EXT_texture_filter_anisotropic");i=s.getParameter(C.MAX_TEXTURE_MAX_ANISOTROPY_EXT)}else i=0;return i}function o(C){return!(C!==Kt&&n.convert(C)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_FORMAT))}function a(C){const P=C===Us&&(e.has("EXT_color_buffer_half_float")||e.has("EXT_color_buffer_float"));return!(C!==dn&&n.convert(C)!==s.getParameter(s.IMPLEMENTATION_COLOR_READ_TYPE)&&C!==en&&!P)}function c(C){if(C==="highp"){if(s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.HIGH_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.HIGH_FLOAT).precision>0)return"highp";C="mediump"}return C==="mediump"&&s.getShaderPrecisionFormat(s.VERTEX_SHADER,s.MEDIUM_FLOAT).precision>0&&s.getShaderPrecisionFormat(s.FRAGMENT_SHADER,s.MEDIUM_FLOAT).precision>0?"mediump":"lowp"}let l=t.precision!==void 0?t.precision:"highp";const u=c(l);u!==l&&(console.warn("THREE.WebGLRenderer:",l,"not supported, using",u,"instead."),l=u);const h=t.logarithmicDepthBuffer===!0,d=t.reversedDepthBuffer===!0&&e.has("EXT_clip_control"),f=s.getParameter(s.MAX_TEXTURE_IMAGE_UNITS),m=s.getParameter(s.MAX_VERTEX_TEXTURE_IMAGE_UNITS),g=s.getParameter(s.MAX_TEXTURE_SIZE),p=s.getParameter(s.MAX_CUBE_MAP_TEXTURE_SIZE),A=s.getParameter(s.MAX_VERTEX_ATTRIBS),T=s.getParameter(s.MAX_VERTEX_UNIFORM_VECTORS),y=s.getParameter(s.MAX_VARYING_VECTORS),v=s.getParameter(s.MAX_FRAGMENT_UNIFORM_VECTORS),w=m>0,E=s.getParameter(s.MAX_SAMPLES);return{isWebGL2:!0,getMaxAnisotropy:r,getMaxPrecision:c,textureFormatReadable:o,textureTypeReadable:a,precision:l,logarithmicDepthBuffer:h,reversedDepthBuffer:d,maxTextures:f,maxVertexTextures:m,maxTextureSize:g,maxCubemapSize:p,maxAttributes:A,maxVertexUniforms:T,maxVaryings:y,maxFragmentUniforms:v,vertexTextures:w,maxSamples:E}}function $p(s){const e=this;let t=null,n=0,i=!1,r=!1;const o=new $n,a=new ke,c={value:null,needsUpdate:!1};this.uniform=c,this.numPlanes=0,this.numIntersection=0,this.init=function(h,d){const f=h.length!==0||d||n!==0||i;return i=d,n=h.length,f},this.beginShadows=function(){r=!0,u(null)},this.endShadows=function(){r=!1},this.setGlobalState=function(h,d){t=u(h,d,0)},this.setState=function(h,d,f){const m=h.clippingPlanes,g=h.clipIntersection,p=h.clipShadows,A=s.get(h);if(!i||m===null||m.length===0||r&&!p)r?u(null):l();else{const T=r?0:n,y=T*4;let v=A.clippingState||null;c.value=v,v=u(m,d,y,f);for(let w=0;w!==y;++w)v[w]=t[w];A.clippingState=v,this.numIntersection=g?this.numPlanes:0,this.numPlanes+=T}};function l(){c.value!==t&&(c.value=t,c.needsUpdate=n>0),e.numPlanes=n,e.numIntersection=0}function u(h,d,f,m){const g=h!==null?h.length:0;let p=null;if(g!==0){if(p=c.value,m!==!0||p===null){const A=f+g*4,T=d.matrixWorldInverse;a.getNormalMatrix(T),(p===null||p.length<A)&&(p=new Float32Array(A));for(let y=0,v=f;y!==g;++y,v+=4)o.copy(h[y]).applyMatrix4(T,a),o.normal.toArray(p,v),p[v+3]=o.constant}c.value=p,c.needsUpdate=!0}return e.numPlanes=g,e.numIntersection=0,p}}function em(s){let e=new WeakMap;function t(o,a){return a===Oo?o.mapping=ki:a===Bo&&(o.mapping=Hi),o}function n(o){if(o&&o.isTexture){const a=o.mapping;if(a===Oo||a===Bo)if(e.has(o)){const c=e.get(o).texture;return t(c,o.mapping)}else{const c=o.image;if(c&&c.height>0){const l=new ad(c.height);return l.fromEquirectangularTexture(s,o),e.set(o,l),o.addEventListener("dispose",i),t(l.texture,o.mapping)}else return null}}return o}function i(o){const a=o.target;a.removeEventListener("dispose",i);const c=e.get(a);c!==void 0&&(e.delete(a),c.dispose())}function r(){e=new WeakMap}return{get:n,dispose:r}}const Ni=4,nl=[.125,.215,.35,.446,.526,.582],ni=20,mo=new ja,il=new be;let go=null,vo=0,_o=0,xo=!1;const ei=(1+Math.sqrt(5))/2,Li=1/ei,sl=[new R(-ei,Li,0),new R(ei,Li,0),new R(-Li,0,ei),new R(Li,0,ei),new R(0,ei,-Li),new R(0,ei,Li),new R(-1,1,-1),new R(1,1,-1),new R(-1,1,1),new R(1,1,1)],tm=new R;class va{constructor(e){this._renderer=e,this._pingPongRenderTarget=null,this._lodMax=0,this._cubeSize=0,this._lodPlanes=[],this._sizeLods=[],this._sigmas=[],this._blurMaterial=null,this._cubemapMaterial=null,this._equirectMaterial=null,this._compileMaterial(this._blurMaterial)}fromScene(e,t=0,n=.1,i=100,r={}){const{size:o=256,position:a=tm}=r;go=this._renderer.getRenderTarget(),vo=this._renderer.getActiveCubeFace(),_o=this._renderer.getActiveMipmapLevel(),xo=this._renderer.xr.enabled,this._renderer.xr.enabled=!1,this._setSize(o);const c=this._allocateTargets();return c.depthBuffer=!0,this._sceneToCubeUV(e,n,i,c,a),t>0&&this._blur(c,0,0,t),this._applyPMREM(c),this._cleanup(c),c}fromEquirectangular(e,t=null){return this._fromTexture(e,t)}fromCubemap(e,t=null){return this._fromTexture(e,t)}compileCubemapShader(){this._cubemapMaterial===null&&(this._cubemapMaterial=al(),this._compileMaterial(this._cubemapMaterial))}compileEquirectangularShader(){this._equirectMaterial===null&&(this._equirectMaterial=ol(),this._compileMaterial(this._equirectMaterial))}dispose(){this._dispose(),this._cubemapMaterial!==null&&this._cubemapMaterial.dispose(),this._equirectMaterial!==null&&this._equirectMaterial.dispose()}_setSize(e){this._lodMax=Math.floor(Math.log2(e)),this._cubeSize=Math.pow(2,this._lodMax)}_dispose(){this._blurMaterial!==null&&this._blurMaterial.dispose(),this._pingPongRenderTarget!==null&&this._pingPongRenderTarget.dispose();for(let e=0;e<this._lodPlanes.length;e++)this._lodPlanes[e].dispose()}_cleanup(e){this._renderer.setRenderTarget(go,vo,_o),this._renderer.xr.enabled=xo,e.scissorTest=!1,Ar(e,0,0,e.width,e.height)}_fromTexture(e,t){e.mapping===ki||e.mapping===Hi?this._setSize(e.image.length===0?16:e.image[0].width||e.image[0].image.width):this._setSize(e.image.width/4),go=this._renderer.getRenderTarget(),vo=this._renderer.getActiveCubeFace(),_o=this._renderer.getActiveMipmapLevel(),xo=this._renderer.xr.enabled,this._renderer.xr.enabled=!1;const n=t||this._allocateTargets();return this._textureToCubeUV(e,n),this._applyPMREM(n),this._cleanup(n),n}_allocateTargets(){const e=3*Math.max(this._cubeSize,112),t=4*this._cubeSize,n={magFilter:Nt,minFilter:Nt,generateMipmaps:!1,type:Us,format:Kt,colorSpace:bt,depthBuffer:!1},i=rl(e,t,n);if(this._pingPongRenderTarget===null||this._pingPongRenderTarget.width!==e||this._pingPongRenderTarget.height!==t){this._pingPongRenderTarget!==null&&this._dispose(),this._pingPongRenderTarget=rl(e,t,n);const{_lodMax:r}=this;({sizeLods:this._sizeLods,lodPlanes:this._lodPlanes,sigmas:this._sigmas}=nm(r)),this._blurMaterial=im(r,e,t)}return i}_compileMaterial(e){const t=new Qe(this._lodPlanes[0],e);this._renderer.compile(t,mo)}_sceneToCubeUV(e,t,n,i,r){const c=new Dt(90,1,t,n),l=[1,-1,1,1,1,1],u=[1,1,1,-1,-1,-1],h=this._renderer,d=h.autoClear,f=h.toneMapping;h.getClearColor(il),h.toneMapping=Hn,h.autoClear=!1,h.state.buffers.depth.getReversed()&&(h.setRenderTarget(i),h.clearDepth(),h.setRenderTarget(null));const g=new Ht({name:"PMREM.Background",side:It,depthWrite:!1,depthTest:!1}),p=new Qe(new rn,g);let A=!1;const T=e.background;T?T.isColor&&(g.color.copy(T),e.background=null,A=!0):(g.color.copy(il),A=!0);for(let y=0;y<6;y++){const v=y%3;v===0?(c.up.set(0,l[y],0),c.position.set(r.x,r.y,r.z),c.lookAt(r.x+u[y],r.y,r.z)):v===1?(c.up.set(0,0,l[y]),c.position.set(r.x,r.y,r.z),c.lookAt(r.x,r.y+u[y],r.z)):(c.up.set(0,l[y],0),c.position.set(r.x,r.y,r.z),c.lookAt(r.x,r.y,r.z+u[y]));const w=this._cubeSize;Ar(i,v*w,y>2?w:0,w,w),h.setRenderTarget(i),A&&h.render(p,c),h.render(e,c)}p.geometry.dispose(),p.material.dispose(),h.toneMapping=f,h.autoClear=d,e.background=T}_textureToCubeUV(e,t){const n=this._renderer,i=e.mapping===ki||e.mapping===Hi;i?(this._cubemapMaterial===null&&(this._cubemapMaterial=al()),this._cubemapMaterial.uniforms.flipEnvMap.value=e.isRenderTargetTexture===!1?-1:1):this._equirectMaterial===null&&(this._equirectMaterial=ol());const r=i?this._cubemapMaterial:this._equirectMaterial,o=new Qe(this._lodPlanes[0],r),a=r.uniforms;a.envMap.value=e;const c=this._cubeSize;Ar(t,0,0,3*c,2*c),n.setRenderTarget(t),n.render(o,mo)}_applyPMREM(e){const t=this._renderer,n=t.autoClear;t.autoClear=!1;const i=this._lodPlanes.length;for(let r=1;r<i;r++){const o=Math.sqrt(this._sigmas[r]*this._sigmas[r]-this._sigmas[r-1]*this._sigmas[r-1]),a=sl[(i-r-1)%sl.length];this._blur(e,r-1,r,o,a)}t.autoClear=n}_blur(e,t,n,i,r){const o=this._pingPongRenderTarget;this._halfBlur(e,o,t,n,i,"latitudinal",r),this._halfBlur(o,e,n,n,i,"longitudinal",r)}_halfBlur(e,t,n,i,r,o,a){const c=this._renderer,l=this._blurMaterial;o!=="latitudinal"&&o!=="longitudinal"&&console.error("blur direction must be either latitudinal or longitudinal!");const u=3,h=new Qe(this._lodPlanes[i],l),d=l.uniforms,f=this._sizeLods[n]-1,m=isFinite(r)?Math.PI/(2*f):2*Math.PI/(2*ni-1),g=r/m,p=isFinite(r)?1+Math.floor(u*g):ni;p>ni&&console.warn(`sigmaRadians, ${r}, is too large and will clip, as it requested ${p} samples when the maximum is set to ${ni}`);const A=[];let T=0;for(let C=0;C<ni;++C){const P=C/g,x=Math.exp(-P*P/2);A.push(x),C===0?T+=x:C<p&&(T+=2*x)}for(let C=0;C<A.length;C++)A[C]=A[C]/T;d.envMap.value=e.texture,d.samples.value=p,d.weights.value=A,d.latitudinal.value=o==="latitudinal",a&&(d.poleAxis.value=a);const{_lodMax:y}=this;d.dTheta.value=m,d.mipInt.value=y-n;const v=this._sizeLods[i],w=3*v*(i>y-Ni?i-y+Ni:0),E=4*(this._cubeSize-v);Ar(t,w,E,3*v,2*v),c.setRenderTarget(t),c.render(h,mo)}}function nm(s){const e=[],t=[],n=[];let i=s;const r=s-Ni+1+nl.length;for(let o=0;o<r;o++){const a=Math.pow(2,i);t.push(a);let c=1/a;o>s-Ni?c=nl[o-s+Ni-1]:o===0&&(c=0),n.push(c);const l=1/(a-2),u=-l,h=1+l,d=[u,u,h,u,h,h,u,u,h,h,u,h],f=6,m=6,g=3,p=2,A=1,T=new Float32Array(g*m*f),y=new Float32Array(p*m*f),v=new Float32Array(A*m*f);for(let E=0;E<f;E++){const C=E%3*2/3-1,P=E>2?0:-1,x=[C,P,0,C+2/3,P,0,C+2/3,P+1,0,C,P,0,C+2/3,P+1,0,C,P+1,0];T.set(x,g*m*E),y.set(d,p*m*E);const M=[E,E,E,E,E,E];v.set(M,A*m*E)}const w=new St;w.setAttribute("position",new vt(T,g)),w.setAttribute("uv",new vt(y,p)),w.setAttribute("faceIndex",new vt(v,A)),e.push(w),i>Ni&&i--}return{lodPlanes:e,sizeLods:t,sigmas:n}}function rl(s,e,t){const n=new Gn(s,e,t);return n.texture.mapping=Cr,n.texture.name="PMREM.cubeUv",n.scissorTest=!0,n}function Ar(s,e,t,n,i){s.viewport.set(e,t,n,i),s.scissor.set(e,t,n,i)}function im(s,e,t){const n=new Float32Array(ni),i=new R(0,1,0);return new Vn({name:"SphericalGaussianBlur",defines:{n:ni,CUBEUV_TEXEL_WIDTH:1/e,CUBEUV_TEXEL_HEIGHT:1/t,CUBEUV_MAX_MIP:`${s}.0`},uniforms:{envMap:{value:null},samples:{value:1},weights:{value:n},latitudinal:{value:!1},dTheta:{value:0},mipInt:{value:0},poleAxis:{value:i}},vertexShader:Ya(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;
			uniform int samples;
			uniform float weights[ n ];
			uniform bool latitudinal;
			uniform float dTheta;
			uniform float mipInt;
			uniform vec3 poleAxis;

			#define ENVMAP_TYPE_CUBE_UV
			#include <cube_uv_reflection_fragment>

			vec3 getSample( float theta, vec3 axis ) {

				float cosTheta = cos( theta );
				// Rodrigues' axis-angle rotation
				vec3 sampleDirection = vOutputDirection * cosTheta
					+ cross( axis, vOutputDirection ) * sin( theta )
					+ axis * dot( axis, vOutputDirection ) * ( 1.0 - cosTheta );

				return bilinearCubeUV( envMap, sampleDirection, mipInt );

			}

			void main() {

				vec3 axis = latitudinal ? poleAxis : cross( poleAxis, vOutputDirection );

				if ( all( equal( axis, vec3( 0.0 ) ) ) ) {

					axis = vec3( vOutputDirection.z, 0.0, - vOutputDirection.x );

				}

				axis = normalize( axis );

				gl_FragColor = vec4( 0.0, 0.0, 0.0, 1.0 );
				gl_FragColor.rgb += weights[ 0 ] * getSample( 0.0, axis );

				for ( int i = 1; i < n; i++ ) {

					if ( i >= samples ) {

						break;

					}

					float theta = dTheta * float( i );
					gl_FragColor.rgb += weights[ i ] * getSample( -1.0 * theta, axis );
					gl_FragColor.rgb += weights[ i ] * getSample( theta, axis );

				}

			}
		`,blending:kn,depthTest:!1,depthWrite:!1})}function ol(){return new Vn({name:"EquirectangularToCubeUV",uniforms:{envMap:{value:null}},vertexShader:Ya(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			varying vec3 vOutputDirection;

			uniform sampler2D envMap;

			#include <common>

			void main() {

				vec3 outputDirection = normalize( vOutputDirection );
				vec2 uv = equirectUv( outputDirection );

				gl_FragColor = vec4( texture2D ( envMap, uv ).rgb, 1.0 );

			}
		`,blending:kn,depthTest:!1,depthWrite:!1})}function al(){return new Vn({name:"CubemapToCubeUV",uniforms:{envMap:{value:null},flipEnvMap:{value:-1}},vertexShader:Ya(),fragmentShader:`

			precision mediump float;
			precision mediump int;

			uniform float flipEnvMap;

			varying vec3 vOutputDirection;

			uniform samplerCube envMap;

			void main() {

				gl_FragColor = textureCube( envMap, vec3( flipEnvMap * vOutputDirection.x, vOutputDirection.yz ) );

			}
		`,blending:kn,depthTest:!1,depthWrite:!1})}function Ya(){return`

		precision mediump float;
		precision mediump int;

		attribute float faceIndex;

		varying vec3 vOutputDirection;

		// RH coordinate system; PMREM face-indexing convention
		vec3 getDirection( vec2 uv, float face ) {

			uv = 2.0 * uv - 1.0;

			vec3 direction = vec3( uv, 1.0 );

			if ( face == 0.0 ) {

				direction = direction.zyx; // ( 1, v, u ) pos x

			} else if ( face == 1.0 ) {

				direction = direction.xzy;
				direction.xz *= -1.0; // ( -u, 1, -v ) pos y

			} else if ( face == 2.0 ) {

				direction.x *= -1.0; // ( -u, v, 1 ) pos z

			} else if ( face == 3.0 ) {

				direction = direction.zyx;
				direction.xz *= -1.0; // ( -1, v, -u ) neg x

			} else if ( face == 4.0 ) {

				direction = direction.xzy;
				direction.xy *= -1.0; // ( -u, -1, v ) neg y

			} else if ( face == 5.0 ) {

				direction.z *= -1.0; // ( u, v, -1 ) neg z

			}

			return direction;

		}

		void main() {

			vOutputDirection = getDirection( uv, faceIndex );
			gl_Position = vec4( position, 1.0 );

		}
	`}function sm(s){let e=new WeakMap,t=null;function n(a){if(a&&a.isTexture){const c=a.mapping,l=c===Oo||c===Bo,u=c===ki||c===Hi;if(l||u){let h=e.get(a);const d=h!==void 0?h.texture.pmremVersion:0;if(a.isRenderTargetTexture&&a.pmremVersion!==d)return t===null&&(t=new va(s)),h=l?t.fromEquirectangular(a,h):t.fromCubemap(a,h),h.texture.pmremVersion=a.pmremVersion,e.set(a,h),h.texture;if(h!==void 0)return h.texture;{const f=a.image;return l&&f&&f.height>0||u&&f&&i(f)?(t===null&&(t=new va(s)),h=l?t.fromEquirectangular(a):t.fromCubemap(a),h.texture.pmremVersion=a.pmremVersion,e.set(a,h),a.addEventListener("dispose",r),h.texture):null}}}return a}function i(a){let c=0;const l=6;for(let u=0;u<l;u++)a[u]!==void 0&&c++;return c===l}function r(a){const c=a.target;c.removeEventListener("dispose",r);const l=e.get(c);l!==void 0&&(e.delete(c),l.dispose())}function o(){e=new WeakMap,t!==null&&(t.dispose(),t=null)}return{get:n,dispose:o}}function rm(s){const e={};function t(n){if(e[n]!==void 0)return e[n];let i;switch(n){case"WEBGL_depth_texture":i=s.getExtension("WEBGL_depth_texture")||s.getExtension("MOZ_WEBGL_depth_texture")||s.getExtension("WEBKIT_WEBGL_depth_texture");break;case"EXT_texture_filter_anisotropic":i=s.getExtension("EXT_texture_filter_anisotropic")||s.getExtension("MOZ_EXT_texture_filter_anisotropic")||s.getExtension("WEBKIT_EXT_texture_filter_anisotropic");break;case"WEBGL_compressed_texture_s3tc":i=s.getExtension("WEBGL_compressed_texture_s3tc")||s.getExtension("MOZ_WEBGL_compressed_texture_s3tc")||s.getExtension("WEBKIT_WEBGL_compressed_texture_s3tc");break;case"WEBGL_compressed_texture_pvrtc":i=s.getExtension("WEBGL_compressed_texture_pvrtc")||s.getExtension("WEBKIT_WEBGL_compressed_texture_pvrtc");break;default:i=s.getExtension(n)}return e[n]=i,i}return{has:function(n){return t(n)!==null},init:function(){t("EXT_color_buffer_float"),t("WEBGL_clip_cull_distance"),t("OES_texture_float_linear"),t("EXT_color_buffer_half_float"),t("WEBGL_multisampled_render_to_texture"),t("WEBGL_render_shared_exponent")},get:function(n){const i=t(n);return i===null&&Ds("THREE.WebGLRenderer: "+n+" extension not supported."),i}}}function om(s,e,t,n){const i={},r=new WeakMap;function o(h){const d=h.target;d.index!==null&&e.remove(d.index);for(const m in d.attributes)e.remove(d.attributes[m]);d.removeEventListener("dispose",o),delete i[d.id];const f=r.get(d);f&&(e.remove(f),r.delete(d)),n.releaseStatesOfGeometry(d),d.isInstancedBufferGeometry===!0&&delete d._maxInstanceCount,t.memory.geometries--}function a(h,d){return i[d.id]===!0||(d.addEventListener("dispose",o),i[d.id]=!0,t.memory.geometries++),d}function c(h){const d=h.attributes;for(const f in d)e.update(d[f],s.ARRAY_BUFFER)}function l(h){const d=[],f=h.index,m=h.attributes.position;let g=0;if(f!==null){const T=f.array;g=f.version;for(let y=0,v=T.length;y<v;y+=3){const w=T[y+0],E=T[y+1],C=T[y+2];d.push(w,E,E,C,C,w)}}else if(m!==void 0){const T=m.array;g=m.version;for(let y=0,v=T.length/3-1;y<v;y+=3){const w=y+0,E=y+1,C=y+2;d.push(w,E,E,C,C,w)}}else return;const p=new(Wl(d)?Yl:Kl)(d,1);p.version=g;const A=r.get(h);A&&e.remove(A),r.set(h,p)}function u(h){const d=r.get(h);if(d){const f=h.index;f!==null&&d.version<f.version&&l(h)}else l(h);return r.get(h)}return{get:a,update:c,getWireframeAttribute:u}}function am(s,e,t){let n;function i(d){n=d}let r,o;function a(d){r=d.type,o=d.bytesPerElement}function c(d,f){s.drawElements(n,f,r,d*o),t.update(f,n,1)}function l(d,f,m){m!==0&&(s.drawElementsInstanced(n,f,r,d*o,m),t.update(f,n,m))}function u(d,f,m){if(m===0)return;e.get("WEBGL_multi_draw").multiDrawElementsWEBGL(n,f,0,r,d,0,m);let p=0;for(let A=0;A<m;A++)p+=f[A];t.update(p,n,1)}function h(d,f,m,g){if(m===0)return;const p=e.get("WEBGL_multi_draw");if(p===null)for(let A=0;A<d.length;A++)l(d[A]/o,f[A],g[A]);else{p.multiDrawElementsInstancedWEBGL(n,f,0,r,d,0,g,0,m);let A=0;for(let T=0;T<m;T++)A+=f[T]*g[T];t.update(A,n,1)}}this.setMode=i,this.setIndex=a,this.render=c,this.renderInstances=l,this.renderMultiDraw=u,this.renderMultiDrawInstances=h}function cm(s){const e={geometries:0,textures:0},t={frame:0,calls:0,triangles:0,points:0,lines:0};function n(r,o,a){switch(t.calls++,o){case s.TRIANGLES:t.triangles+=a*(r/3);break;case s.LINES:t.lines+=a*(r/2);break;case s.LINE_STRIP:t.lines+=a*(r-1);break;case s.LINE_LOOP:t.lines+=a*r;break;case s.POINTS:t.points+=a*r;break;default:console.error("THREE.WebGLInfo: Unknown draw mode:",o);break}}function i(){t.calls=0,t.triangles=0,t.points=0,t.lines=0}return{memory:e,render:t,programs:null,autoReset:!0,reset:i,update:n}}function lm(s,e,t){const n=new WeakMap,i=new qe;function r(o,a,c){const l=o.morphTargetInfluences,u=a.morphAttributes.position||a.morphAttributes.normal||a.morphAttributes.color,h=u!==void 0?u.length:0;let d=n.get(a);if(d===void 0||d.count!==h){let x=function(){C.dispose(),n.delete(a),a.removeEventListener("dispose",x)};d!==void 0&&d.texture.dispose();const f=a.morphAttributes.position!==void 0,m=a.morphAttributes.normal!==void 0,g=a.morphAttributes.color!==void 0,p=a.morphAttributes.position||[],A=a.morphAttributes.normal||[],T=a.morphAttributes.color||[];let y=0;f===!0&&(y=1),m===!0&&(y=2),g===!0&&(y=3);let v=a.attributes.position.count*y,w=1;v>e.maxTextureSize&&(w=Math.ceil(v/e.maxTextureSize),v=e.maxTextureSize);const E=new Float32Array(v*w*4*h),C=new Xl(E,v,w,h);C.type=en,C.needsUpdate=!0;const P=y*4;for(let M=0;M<h;M++){const I=p[M],F=A[M],z=T[M],G=v*w*4*M;for(let j=0;j<I.count;j++){const B=j*P;f===!0&&(i.fromBufferAttribute(I,j),E[G+B+0]=i.x,E[G+B+1]=i.y,E[G+B+2]=i.z,E[G+B+3]=0),m===!0&&(i.fromBufferAttribute(F,j),E[G+B+4]=i.x,E[G+B+5]=i.y,E[G+B+6]=i.z,E[G+B+7]=0),g===!0&&(i.fromBufferAttribute(z,j),E[G+B+8]=i.x,E[G+B+9]=i.y,E[G+B+10]=i.z,E[G+B+11]=z.itemSize===4?i.w:1)}}d={count:h,texture:C,size:new fe(v,w)},n.set(a,d),a.addEventListener("dispose",x)}if(o.isInstancedMesh===!0&&o.morphTexture!==null)c.getUniforms().setValue(s,"morphTexture",o.morphTexture,t);else{let f=0;for(let g=0;g<l.length;g++)f+=l[g];const m=a.morphTargetsRelative?1:1-f;c.getUniforms().setValue(s,"morphTargetBaseInfluence",m),c.getUniforms().setValue(s,"morphTargetInfluences",l)}c.getUniforms().setValue(s,"morphTargetsTexture",d.texture,t),c.getUniforms().setValue(s,"morphTargetsTextureSize",d.size)}return{update:r}}function um(s,e,t,n){let i=new WeakMap;function r(c){const l=n.render.frame,u=c.geometry,h=e.get(c,u);if(i.get(h)!==l&&(e.update(h),i.set(h,l)),c.isInstancedMesh&&(c.hasEventListener("dispose",a)===!1&&c.addEventListener("dispose",a),i.get(c)!==l&&(t.update(c.instanceMatrix,s.ARRAY_BUFFER),c.instanceColor!==null&&t.update(c.instanceColor,s.ARRAY_BUFFER),i.set(c,l))),c.isSkinnedMesh){const d=c.skeleton;i.get(d)!==l&&(d.update(),i.set(d,l))}return h}function o(){i=new WeakMap}function a(c){const l=c.target;l.removeEventListener("dispose",a),t.remove(l.instanceMatrix),l.instanceColor!==null&&t.remove(l.instanceColor)}return{update:r,dispose:o}}const pu=new gt,cl=new au(1,1),mu=new Xl,gu=new Wh,vu=new Zl,ll=[],ul=[],hl=new Float32Array(16),dl=new Float32Array(9),fl=new Float32Array(4);function es(s,e,t){const n=s[0];if(n<=0||n>0)return s;const i=e*t;let r=ll[i];if(r===void 0&&(r=new Float32Array(i),ll[i]=r),e!==0){n.toArray(r,0);for(let o=1,a=0;o!==e;++o)a+=t,s[o].toArray(r,a)}return r}function _t(s,e){if(s.length!==e.length)return!1;for(let t=0,n=s.length;t<n;t++)if(s[t]!==e[t])return!1;return!0}function xt(s,e){for(let t=0,n=e.length;t<n;t++)s[t]=e[t]}function Lr(s,e){let t=ul[e];t===void 0&&(t=new Int32Array(e),ul[e]=t);for(let n=0;n!==e;++n)t[n]=s.allocateTextureUnit();return t}function hm(s,e){const t=this.cache;t[0]!==e&&(s.uniform1f(this.addr,e),t[0]=e)}function dm(s,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(s.uniform2f(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(_t(t,e))return;s.uniform2fv(this.addr,e),xt(t,e)}}function fm(s,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(s.uniform3f(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else if(e.r!==void 0)(t[0]!==e.r||t[1]!==e.g||t[2]!==e.b)&&(s.uniform3f(this.addr,e.r,e.g,e.b),t[0]=e.r,t[1]=e.g,t[2]=e.b);else{if(_t(t,e))return;s.uniform3fv(this.addr,e),xt(t,e)}}function Am(s,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(s.uniform4f(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(_t(t,e))return;s.uniform4fv(this.addr,e),xt(t,e)}}function pm(s,e){const t=this.cache,n=e.elements;if(n===void 0){if(_t(t,e))return;s.uniformMatrix2fv(this.addr,!1,e),xt(t,e)}else{if(_t(t,n))return;fl.set(n),s.uniformMatrix2fv(this.addr,!1,fl),xt(t,n)}}function mm(s,e){const t=this.cache,n=e.elements;if(n===void 0){if(_t(t,e))return;s.uniformMatrix3fv(this.addr,!1,e),xt(t,e)}else{if(_t(t,n))return;dl.set(n),s.uniformMatrix3fv(this.addr,!1,dl),xt(t,n)}}function gm(s,e){const t=this.cache,n=e.elements;if(n===void 0){if(_t(t,e))return;s.uniformMatrix4fv(this.addr,!1,e),xt(t,e)}else{if(_t(t,n))return;hl.set(n),s.uniformMatrix4fv(this.addr,!1,hl),xt(t,n)}}function vm(s,e){const t=this.cache;t[0]!==e&&(s.uniform1i(this.addr,e),t[0]=e)}function _m(s,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(s.uniform2i(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(_t(t,e))return;s.uniform2iv(this.addr,e),xt(t,e)}}function xm(s,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(s.uniform3i(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(_t(t,e))return;s.uniform3iv(this.addr,e),xt(t,e)}}function Mm(s,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(s.uniform4i(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(_t(t,e))return;s.uniform4iv(this.addr,e),xt(t,e)}}function ym(s,e){const t=this.cache;t[0]!==e&&(s.uniform1ui(this.addr,e),t[0]=e)}function Sm(s,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y)&&(s.uniform2ui(this.addr,e.x,e.y),t[0]=e.x,t[1]=e.y);else{if(_t(t,e))return;s.uniform2uiv(this.addr,e),xt(t,e)}}function Tm(s,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z)&&(s.uniform3ui(this.addr,e.x,e.y,e.z),t[0]=e.x,t[1]=e.y,t[2]=e.z);else{if(_t(t,e))return;s.uniform3uiv(this.addr,e),xt(t,e)}}function Em(s,e){const t=this.cache;if(e.x!==void 0)(t[0]!==e.x||t[1]!==e.y||t[2]!==e.z||t[3]!==e.w)&&(s.uniform4ui(this.addr,e.x,e.y,e.z,e.w),t[0]=e.x,t[1]=e.y,t[2]=e.z,t[3]=e.w);else{if(_t(t,e))return;s.uniform4uiv(this.addr,e),xt(t,e)}}function wm(s,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i);let r;this.type===s.SAMPLER_2D_SHADOW?(cl.compareFunction=Gl,r=cl):r=pu,t.setTexture2D(e||r,i)}function bm(s,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),t.setTexture3D(e||gu,i)}function Cm(s,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),t.setTextureCube(e||vu,i)}function Pm(s,e,t){const n=this.cache,i=t.allocateTextureUnit();n[0]!==i&&(s.uniform1i(this.addr,i),n[0]=i),t.setTexture2DArray(e||mu,i)}function Rm(s){switch(s){case 5126:return hm;case 35664:return dm;case 35665:return fm;case 35666:return Am;case 35674:return pm;case 35675:return mm;case 35676:return gm;case 5124:case 35670:return vm;case 35667:case 35671:return _m;case 35668:case 35672:return xm;case 35669:case 35673:return Mm;case 5125:return ym;case 36294:return Sm;case 36295:return Tm;case 36296:return Em;case 35678:case 36198:case 36298:case 36306:case 35682:return wm;case 35679:case 36299:case 36307:return bm;case 35680:case 36300:case 36308:case 36293:return Cm;case 36289:case 36303:case 36311:case 36292:return Pm}}function Dm(s,e){s.uniform1fv(this.addr,e)}function Im(s,e){const t=es(e,this.size,2);s.uniform2fv(this.addr,t)}function Lm(s,e){const t=es(e,this.size,3);s.uniform3fv(this.addr,t)}function Um(s,e){const t=es(e,this.size,4);s.uniform4fv(this.addr,t)}function Nm(s,e){const t=es(e,this.size,4);s.uniformMatrix2fv(this.addr,!1,t)}function Fm(s,e){const t=es(e,this.size,9);s.uniformMatrix3fv(this.addr,!1,t)}function Om(s,e){const t=es(e,this.size,16);s.uniformMatrix4fv(this.addr,!1,t)}function Bm(s,e){s.uniform1iv(this.addr,e)}function zm(s,e){s.uniform2iv(this.addr,e)}function km(s,e){s.uniform3iv(this.addr,e)}function Hm(s,e){s.uniform4iv(this.addr,e)}function Gm(s,e){s.uniform1uiv(this.addr,e)}function Vm(s,e){s.uniform2uiv(this.addr,e)}function Wm(s,e){s.uniform3uiv(this.addr,e)}function Xm(s,e){s.uniform4uiv(this.addr,e)}function jm(s,e,t){const n=this.cache,i=e.length,r=Lr(t,i);_t(n,r)||(s.uniform1iv(this.addr,r),xt(n,r));for(let o=0;o!==i;++o)t.setTexture2D(e[o]||pu,r[o])}function Qm(s,e,t){const n=this.cache,i=e.length,r=Lr(t,i);_t(n,r)||(s.uniform1iv(this.addr,r),xt(n,r));for(let o=0;o!==i;++o)t.setTexture3D(e[o]||gu,r[o])}function Km(s,e,t){const n=this.cache,i=e.length,r=Lr(t,i);_t(n,r)||(s.uniform1iv(this.addr,r),xt(n,r));for(let o=0;o!==i;++o)t.setTextureCube(e[o]||vu,r[o])}function Ym(s,e,t){const n=this.cache,i=e.length,r=Lr(t,i);_t(n,r)||(s.uniform1iv(this.addr,r),xt(n,r));for(let o=0;o!==i;++o)t.setTexture2DArray(e[o]||mu,r[o])}function qm(s){switch(s){case 5126:return Dm;case 35664:return Im;case 35665:return Lm;case 35666:return Um;case 35674:return Nm;case 35675:return Fm;case 35676:return Om;case 5124:case 35670:return Bm;case 35667:case 35671:return zm;case 35668:case 35672:return km;case 35669:case 35673:return Hm;case 5125:return Gm;case 36294:return Vm;case 36295:return Wm;case 36296:return Xm;case 35678:case 36198:case 36298:case 36306:case 35682:return jm;case 35679:case 36299:case 36307:return Qm;case 35680:case 36300:case 36308:case 36293:return Km;case 36289:case 36303:case 36311:case 36292:return Ym}}class Jm{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.setValue=Rm(t.type)}}class Zm{constructor(e,t,n){this.id=e,this.addr=n,this.cache=[],this.type=t.type,this.size=t.size,this.setValue=qm(t.type)}}class $m{constructor(e){this.id=e,this.seq=[],this.map={}}setValue(e,t,n){const i=this.seq;for(let r=0,o=i.length;r!==o;++r){const a=i[r];a.setValue(e,t[a.id],n)}}}const Mo=/(\w+)(\])?(\[|\.)?/g;function Al(s,e){s.seq.push(e),s.map[e.id]=e}function eg(s,e,t){const n=s.name,i=n.length;for(Mo.lastIndex=0;;){const r=Mo.exec(n),o=Mo.lastIndex;let a=r[1];const c=r[2]==="]",l=r[3];if(c&&(a=a|0),l===void 0||l==="["&&o+2===i){Al(t,l===void 0?new Jm(a,s,e):new Zm(a,s,e));break}else{let h=t.map[a];h===void 0&&(h=new $m(a),Al(t,h)),t=h}}}class Mr{constructor(e,t){this.seq=[],this.map={};const n=e.getProgramParameter(t,e.ACTIVE_UNIFORMS);for(let i=0;i<n;++i){const r=e.getActiveUniform(t,i),o=e.getUniformLocation(t,r.name);eg(r,o,this)}}setValue(e,t,n,i){const r=this.map[t];r!==void 0&&r.setValue(e,n,i)}setOptional(e,t,n){const i=t[n];i!==void 0&&this.setValue(e,n,i)}static upload(e,t,n,i){for(let r=0,o=t.length;r!==o;++r){const a=t[r],c=n[a.id];c.needsUpdate!==!1&&a.setValue(e,c.value,i)}}static seqWithValue(e,t){const n=[];for(let i=0,r=e.length;i!==r;++i){const o=e[i];o.id in t&&n.push(o)}return n}}function pl(s,e,t){const n=s.createShader(e);return s.shaderSource(n,t),s.compileShader(n),n}const tg=37297;let ng=0;function ig(s,e){const t=s.split(`
`),n=[],i=Math.max(e-6,0),r=Math.min(e+6,t.length);for(let o=i;o<r;o++){const a=o+1;n.push(`${a===e?">":" "} ${a}: ${t[o]}`)}return n.join(`
`)}const ml=new ke;function sg(s){je._getMatrix(ml,je.workingColorSpace,s);const e=`mat3( ${ml.elements.map(t=>t.toFixed(4))} )`;switch(je.getTransfer(s)){case Sr:return[e,"LinearTransferOETF"];case tt:return[e,"sRGBTransferOETF"];default:return console.warn("THREE.WebGLProgram: Unsupported color space: ",s),[e,"LinearTransferOETF"]}}function gl(s,e,t){const n=s.getShaderParameter(e,s.COMPILE_STATUS),r=(s.getShaderInfoLog(e)||"").trim();if(n&&r==="")return"";const o=/ERROR: 0:(\d+)/.exec(r);if(o){const a=parseInt(o[1]);return t.toUpperCase()+`

`+r+`

`+ig(s.getShaderSource(e),a)}else return r}function rg(s,e){const t=sg(e);return[`vec4 ${s}( vec4 value ) {`,`	return ${t[1]}( vec4( value.rgb * ${t[0]}, value.a ) );`,"}"].join(`
`)}function og(s,e){let t;switch(e){case th:t="Linear";break;case nh:t="Reinhard";break;case ih:t="Cineon";break;case sh:t="ACESFilmic";break;case oh:t="AgX";break;case ah:t="Neutral";break;case rh:t="Custom";break;default:console.warn("THREE.WebGLProgram: Unsupported toneMapping:",e),t="Linear"}return"vec3 "+s+"( vec3 color ) { return "+t+"ToneMapping( color ); }"}const pr=new R;function ag(){je.getLuminanceCoefficients(pr);const s=pr.x.toFixed(4),e=pr.y.toFixed(4),t=pr.z.toFixed(4);return["float luminance( const in vec3 rgb ) {",`	const vec3 weights = vec3( ${s}, ${e}, ${t} );`,"	return dot( weights, rgb );","}"].join(`
`)}function cg(s){return[s.extensionClipCullDistance?"#extension GL_ANGLE_clip_cull_distance : require":"",s.extensionMultiDraw?"#extension GL_ANGLE_multi_draw : require":""].filter(ms).join(`
`)}function lg(s){const e=[];for(const t in s){const n=s[t];n!==!1&&e.push("#define "+t+" "+n)}return e.join(`
`)}function ug(s,e){const t={},n=s.getProgramParameter(e,s.ACTIVE_ATTRIBUTES);for(let i=0;i<n;i++){const r=s.getActiveAttrib(e,i),o=r.name;let a=1;r.type===s.FLOAT_MAT2&&(a=2),r.type===s.FLOAT_MAT3&&(a=3),r.type===s.FLOAT_MAT4&&(a=4),t[o]={type:r.type,location:s.getAttribLocation(e,o),locationSize:a}}return t}function ms(s){return s!==""}function vl(s,e){const t=e.numSpotLightShadows+e.numSpotLightMaps-e.numSpotLightShadowsWithMaps;return s.replace(/NUM_DIR_LIGHTS/g,e.numDirLights).replace(/NUM_SPOT_LIGHTS/g,e.numSpotLights).replace(/NUM_SPOT_LIGHT_MAPS/g,e.numSpotLightMaps).replace(/NUM_SPOT_LIGHT_COORDS/g,t).replace(/NUM_RECT_AREA_LIGHTS/g,e.numRectAreaLights).replace(/NUM_POINT_LIGHTS/g,e.numPointLights).replace(/NUM_HEMI_LIGHTS/g,e.numHemiLights).replace(/NUM_DIR_LIGHT_SHADOWS/g,e.numDirLightShadows).replace(/NUM_SPOT_LIGHT_SHADOWS_WITH_MAPS/g,e.numSpotLightShadowsWithMaps).replace(/NUM_SPOT_LIGHT_SHADOWS/g,e.numSpotLightShadows).replace(/NUM_POINT_LIGHT_SHADOWS/g,e.numPointLightShadows)}function _l(s,e){return s.replace(/NUM_CLIPPING_PLANES/g,e.numClippingPlanes).replace(/UNION_CLIPPING_PLANES/g,e.numClippingPlanes-e.numClipIntersection)}const hg=/^[ \t]*#include +<([\w\d./]+)>/gm;function _a(s){return s.replace(hg,fg)}const dg=new Map;function fg(s,e){let t=He[e];if(t===void 0){const n=dg.get(e);if(n!==void 0)t=He[n],console.warn('THREE.WebGLRenderer: Shader chunk "%s" has been deprecated. Use "%s" instead.',e,n);else throw new Error("Can not resolve #include <"+e+">")}return _a(t)}const Ag=/#pragma unroll_loop_start\s+for\s*\(\s*int\s+i\s*=\s*(\d+)\s*;\s*i\s*<\s*(\d+)\s*;\s*i\s*\+\+\s*\)\s*{([\s\S]+?)}\s+#pragma unroll_loop_end/g;function xl(s){return s.replace(Ag,pg)}function pg(s,e,t,n){let i="";for(let r=parseInt(e);r<parseInt(t);r++)i+=n.replace(/\[\s*i\s*\]/g,"[ "+r+" ]").replace(/UNROLLED_LOOP_INDEX/g,r);return i}function Ml(s){let e=`precision ${s.precision} float;
	precision ${s.precision} int;
	precision ${s.precision} sampler2D;
	precision ${s.precision} samplerCube;
	precision ${s.precision} sampler3D;
	precision ${s.precision} sampler2DArray;
	precision ${s.precision} sampler2DShadow;
	precision ${s.precision} samplerCubeShadow;
	precision ${s.precision} sampler2DArrayShadow;
	precision ${s.precision} isampler2D;
	precision ${s.precision} isampler3D;
	precision ${s.precision} isamplerCube;
	precision ${s.precision} isampler2DArray;
	precision ${s.precision} usampler2D;
	precision ${s.precision} usampler3D;
	precision ${s.precision} usamplerCube;
	precision ${s.precision} usampler2DArray;
	`;return s.precision==="highp"?e+=`
#define HIGH_PRECISION`:s.precision==="mediump"?e+=`
#define MEDIUM_PRECISION`:s.precision==="lowp"&&(e+=`
#define LOW_PRECISION`),e}function mg(s){let e="SHADOWMAP_TYPE_BASIC";return s.shadowMapType===Dl?e="SHADOWMAP_TYPE_PCF":s.shadowMapType===Uu?e="SHADOWMAP_TYPE_PCF_SOFT":s.shadowMapType===Sn&&(e="SHADOWMAP_TYPE_VSM"),e}function gg(s){let e="ENVMAP_TYPE_CUBE";if(s.envMap)switch(s.envMapMode){case ki:case Hi:e="ENVMAP_TYPE_CUBE";break;case Cr:e="ENVMAP_TYPE_CUBE_UV";break}return e}function vg(s){let e="ENVMAP_MODE_REFLECTION";if(s.envMap)switch(s.envMapMode){case Hi:e="ENVMAP_MODE_REFRACTION";break}return e}function _g(s){let e="ENVMAP_BLENDING_NONE";if(s.envMap)switch(s.combine){case Sa:e="ENVMAP_BLENDING_MULTIPLY";break;case $u:e="ENVMAP_BLENDING_MIX";break;case eh:e="ENVMAP_BLENDING_ADD";break}return e}function xg(s){const e=s.envMapCubeUVHeight;if(e===null)return null;const t=Math.log2(e)-2,n=1/e;return{texelWidth:1/(3*Math.max(Math.pow(2,t),7*16)),texelHeight:n,maxMip:t}}function Mg(s,e,t,n){const i=s.getContext(),r=t.defines;let o=t.vertexShader,a=t.fragmentShader;const c=mg(t),l=gg(t),u=vg(t),h=_g(t),d=xg(t),f=cg(t),m=lg(r),g=i.createProgram();let p,A,T=t.glslVersion?"#version "+t.glslVersion+`
`:"";t.isRawShaderMaterial?(p=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m].filter(ms).join(`
`),p.length>0&&(p+=`
`),A=["#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m].filter(ms).join(`
`),A.length>0&&(A+=`
`)):(p=[Ml(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m,t.extensionClipCullDistance?"#define USE_CLIP_DISTANCE":"",t.batching?"#define USE_BATCHING":"",t.batchingColor?"#define USE_BATCHING_COLOR":"",t.instancing?"#define USE_INSTANCING":"",t.instancingColor?"#define USE_INSTANCING_COLOR":"",t.instancingMorph?"#define USE_INSTANCING_MORPH":"",t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.map?"#define USE_MAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+u:"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.displacementMap?"#define USE_DISPLACEMENTMAP":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.mapUv?"#define MAP_UV "+t.mapUv:"",t.alphaMapUv?"#define ALPHAMAP_UV "+t.alphaMapUv:"",t.lightMapUv?"#define LIGHTMAP_UV "+t.lightMapUv:"",t.aoMapUv?"#define AOMAP_UV "+t.aoMapUv:"",t.emissiveMapUv?"#define EMISSIVEMAP_UV "+t.emissiveMapUv:"",t.bumpMapUv?"#define BUMPMAP_UV "+t.bumpMapUv:"",t.normalMapUv?"#define NORMALMAP_UV "+t.normalMapUv:"",t.displacementMapUv?"#define DISPLACEMENTMAP_UV "+t.displacementMapUv:"",t.metalnessMapUv?"#define METALNESSMAP_UV "+t.metalnessMapUv:"",t.roughnessMapUv?"#define ROUGHNESSMAP_UV "+t.roughnessMapUv:"",t.anisotropyMapUv?"#define ANISOTROPYMAP_UV "+t.anisotropyMapUv:"",t.clearcoatMapUv?"#define CLEARCOATMAP_UV "+t.clearcoatMapUv:"",t.clearcoatNormalMapUv?"#define CLEARCOAT_NORMALMAP_UV "+t.clearcoatNormalMapUv:"",t.clearcoatRoughnessMapUv?"#define CLEARCOAT_ROUGHNESSMAP_UV "+t.clearcoatRoughnessMapUv:"",t.iridescenceMapUv?"#define IRIDESCENCEMAP_UV "+t.iridescenceMapUv:"",t.iridescenceThicknessMapUv?"#define IRIDESCENCE_THICKNESSMAP_UV "+t.iridescenceThicknessMapUv:"",t.sheenColorMapUv?"#define SHEEN_COLORMAP_UV "+t.sheenColorMapUv:"",t.sheenRoughnessMapUv?"#define SHEEN_ROUGHNESSMAP_UV "+t.sheenRoughnessMapUv:"",t.specularMapUv?"#define SPECULARMAP_UV "+t.specularMapUv:"",t.specularColorMapUv?"#define SPECULAR_COLORMAP_UV "+t.specularColorMapUv:"",t.specularIntensityMapUv?"#define SPECULAR_INTENSITYMAP_UV "+t.specularIntensityMapUv:"",t.transmissionMapUv?"#define TRANSMISSIONMAP_UV "+t.transmissionMapUv:"",t.thicknessMapUv?"#define THICKNESSMAP_UV "+t.thicknessMapUv:"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.flatShading?"#define FLAT_SHADED":"",t.skinning?"#define USE_SKINNING":"",t.morphTargets?"#define USE_MORPHTARGETS":"",t.morphNormals&&t.flatShading===!1?"#define USE_MORPHNORMALS":"",t.morphColors?"#define USE_MORPHCOLORS":"",t.morphTargetsCount>0?"#define MORPHTARGETS_TEXTURE_STRIDE "+t.morphTextureStride:"",t.morphTargetsCount>0?"#define MORPHTARGETS_COUNT "+t.morphTargetsCount:"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.sizeAttenuation?"#define USE_SIZEATTENUATION":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 modelMatrix;","uniform mat4 modelViewMatrix;","uniform mat4 projectionMatrix;","uniform mat4 viewMatrix;","uniform mat3 normalMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;","#ifdef USE_INSTANCING","	attribute mat4 instanceMatrix;","#endif","#ifdef USE_INSTANCING_COLOR","	attribute vec3 instanceColor;","#endif","#ifdef USE_INSTANCING_MORPH","	uniform sampler2D morphTexture;","#endif","attribute vec3 position;","attribute vec3 normal;","attribute vec2 uv;","#ifdef USE_UV1","	attribute vec2 uv1;","#endif","#ifdef USE_UV2","	attribute vec2 uv2;","#endif","#ifdef USE_UV3","	attribute vec2 uv3;","#endif","#ifdef USE_TANGENT","	attribute vec4 tangent;","#endif","#if defined( USE_COLOR_ALPHA )","	attribute vec4 color;","#elif defined( USE_COLOR )","	attribute vec3 color;","#endif","#ifdef USE_SKINNING","	attribute vec4 skinIndex;","	attribute vec4 skinWeight;","#endif",`
`].filter(ms).join(`
`),A=[Ml(t),"#define SHADER_TYPE "+t.shaderType,"#define SHADER_NAME "+t.shaderName,m,t.useFog&&t.fog?"#define USE_FOG":"",t.useFog&&t.fogExp2?"#define FOG_EXP2":"",t.alphaToCoverage?"#define ALPHA_TO_COVERAGE":"",t.map?"#define USE_MAP":"",t.matcap?"#define USE_MATCAP":"",t.envMap?"#define USE_ENVMAP":"",t.envMap?"#define "+l:"",t.envMap?"#define "+u:"",t.envMap?"#define "+h:"",d?"#define CUBEUV_TEXEL_WIDTH "+d.texelWidth:"",d?"#define CUBEUV_TEXEL_HEIGHT "+d.texelHeight:"",d?"#define CUBEUV_MAX_MIP "+d.maxMip+".0":"",t.lightMap?"#define USE_LIGHTMAP":"",t.aoMap?"#define USE_AOMAP":"",t.bumpMap?"#define USE_BUMPMAP":"",t.normalMap?"#define USE_NORMALMAP":"",t.normalMapObjectSpace?"#define USE_NORMALMAP_OBJECTSPACE":"",t.normalMapTangentSpace?"#define USE_NORMALMAP_TANGENTSPACE":"",t.emissiveMap?"#define USE_EMISSIVEMAP":"",t.anisotropy?"#define USE_ANISOTROPY":"",t.anisotropyMap?"#define USE_ANISOTROPYMAP":"",t.clearcoat?"#define USE_CLEARCOAT":"",t.clearcoatMap?"#define USE_CLEARCOATMAP":"",t.clearcoatRoughnessMap?"#define USE_CLEARCOAT_ROUGHNESSMAP":"",t.clearcoatNormalMap?"#define USE_CLEARCOAT_NORMALMAP":"",t.dispersion?"#define USE_DISPERSION":"",t.iridescence?"#define USE_IRIDESCENCE":"",t.iridescenceMap?"#define USE_IRIDESCENCEMAP":"",t.iridescenceThicknessMap?"#define USE_IRIDESCENCE_THICKNESSMAP":"",t.specularMap?"#define USE_SPECULARMAP":"",t.specularColorMap?"#define USE_SPECULAR_COLORMAP":"",t.specularIntensityMap?"#define USE_SPECULAR_INTENSITYMAP":"",t.roughnessMap?"#define USE_ROUGHNESSMAP":"",t.metalnessMap?"#define USE_METALNESSMAP":"",t.alphaMap?"#define USE_ALPHAMAP":"",t.alphaTest?"#define USE_ALPHATEST":"",t.alphaHash?"#define USE_ALPHAHASH":"",t.sheen?"#define USE_SHEEN":"",t.sheenColorMap?"#define USE_SHEEN_COLORMAP":"",t.sheenRoughnessMap?"#define USE_SHEEN_ROUGHNESSMAP":"",t.transmission?"#define USE_TRANSMISSION":"",t.transmissionMap?"#define USE_TRANSMISSIONMAP":"",t.thicknessMap?"#define USE_THICKNESSMAP":"",t.vertexTangents&&t.flatShading===!1?"#define USE_TANGENT":"",t.vertexColors||t.instancingColor||t.batchingColor?"#define USE_COLOR":"",t.vertexAlphas?"#define USE_COLOR_ALPHA":"",t.vertexUv1s?"#define USE_UV1":"",t.vertexUv2s?"#define USE_UV2":"",t.vertexUv3s?"#define USE_UV3":"",t.pointsUvs?"#define USE_POINTS_UV":"",t.gradientMap?"#define USE_GRADIENTMAP":"",t.flatShading?"#define FLAT_SHADED":"",t.doubleSided?"#define DOUBLE_SIDED":"",t.flipSided?"#define FLIP_SIDED":"",t.shadowMapEnabled?"#define USE_SHADOWMAP":"",t.shadowMapEnabled?"#define "+c:"",t.premultipliedAlpha?"#define PREMULTIPLIED_ALPHA":"",t.numLightProbes>0?"#define USE_LIGHT_PROBES":"",t.decodeVideoTexture?"#define DECODE_VIDEO_TEXTURE":"",t.decodeVideoTextureEmissive?"#define DECODE_VIDEO_TEXTURE_EMISSIVE":"",t.logarithmicDepthBuffer?"#define USE_LOGARITHMIC_DEPTH_BUFFER":"",t.reversedDepthBuffer?"#define USE_REVERSED_DEPTH_BUFFER":"","uniform mat4 viewMatrix;","uniform vec3 cameraPosition;","uniform bool isOrthographic;",t.toneMapping!==Hn?"#define TONE_MAPPING":"",t.toneMapping!==Hn?He.tonemapping_pars_fragment:"",t.toneMapping!==Hn?og("toneMapping",t.toneMapping):"",t.dithering?"#define DITHERING":"",t.opaque?"#define OPAQUE":"",He.colorspace_pars_fragment,rg("linearToOutputTexel",t.outputColorSpace),ag(),t.useDepthPacking?"#define DEPTH_PACKING "+t.depthPacking:"",`
`].filter(ms).join(`
`)),o=_a(o),o=vl(o,t),o=_l(o,t),a=_a(a),a=vl(a,t),a=_l(a,t),o=xl(o),a=xl(a),t.isRawShaderMaterial!==!0&&(T=`#version 300 es
`,p=[f,"#define attribute in","#define varying out","#define texture2D texture"].join(`
`)+`
`+p,A=["#define varying in",t.glslVersion===pc?"":"layout(location = 0) out highp vec4 pc_fragColor;",t.glslVersion===pc?"":"#define gl_FragColor pc_fragColor","#define gl_FragDepthEXT gl_FragDepth","#define texture2D texture","#define textureCube texture","#define texture2DProj textureProj","#define texture2DLodEXT textureLod","#define texture2DProjLodEXT textureProjLod","#define textureCubeLodEXT textureLod","#define texture2DGradEXT textureGrad","#define texture2DProjGradEXT textureProjGrad","#define textureCubeGradEXT textureGrad"].join(`
`)+`
`+A);const y=T+p+o,v=T+A+a,w=pl(i,i.VERTEX_SHADER,y),E=pl(i,i.FRAGMENT_SHADER,v);i.attachShader(g,w),i.attachShader(g,E),t.index0AttributeName!==void 0?i.bindAttribLocation(g,0,t.index0AttributeName):t.morphTargets===!0&&i.bindAttribLocation(g,0,"position"),i.linkProgram(g);function C(I){if(s.debug.checkShaderErrors){const F=i.getProgramInfoLog(g)||"",z=i.getShaderInfoLog(w)||"",G=i.getShaderInfoLog(E)||"",j=F.trim(),B=z.trim(),J=G.trim();let W=!0,K=!0;if(i.getProgramParameter(g,i.LINK_STATUS)===!1)if(W=!1,typeof s.debug.onShaderError=="function")s.debug.onShaderError(i,g,w,E);else{const $=gl(i,w,"vertex"),le=gl(i,E,"fragment");console.error("THREE.WebGLProgram: Shader Error "+i.getError()+" - VALIDATE_STATUS "+i.getProgramParameter(g,i.VALIDATE_STATUS)+`

Material Name: `+I.name+`
Material Type: `+I.type+`

Program Info Log: `+j+`
`+$+`
`+le)}else j!==""?console.warn("THREE.WebGLProgram: Program Info Log:",j):(B===""||J==="")&&(K=!1);K&&(I.diagnostics={runnable:W,programLog:j,vertexShader:{log:B,prefix:p},fragmentShader:{log:J,prefix:A}})}i.deleteShader(w),i.deleteShader(E),P=new Mr(i,g),x=ug(i,g)}let P;this.getUniforms=function(){return P===void 0&&C(this),P};let x;this.getAttributes=function(){return x===void 0&&C(this),x};let M=t.rendererExtensionParallelShaderCompile===!1;return this.isReady=function(){return M===!1&&(M=i.getProgramParameter(g,tg)),M},this.destroy=function(){n.releaseStatesOfProgram(this),i.deleteProgram(g),this.program=void 0},this.type=t.shaderType,this.name=t.shaderName,this.id=ng++,this.cacheKey=e,this.usedTimes=1,this.program=g,this.vertexShader=w,this.fragmentShader=E,this}let yg=0;class Sg{constructor(){this.shaderCache=new Map,this.materialCache=new Map}update(e){const t=e.vertexShader,n=e.fragmentShader,i=this._getShaderStage(t),r=this._getShaderStage(n),o=this._getShaderCacheForMaterial(e);return o.has(i)===!1&&(o.add(i),i.usedTimes++),o.has(r)===!1&&(o.add(r),r.usedTimes++),this}remove(e){const t=this.materialCache.get(e);for(const n of t)n.usedTimes--,n.usedTimes===0&&this.shaderCache.delete(n.code);return this.materialCache.delete(e),this}getVertexShaderID(e){return this._getShaderStage(e.vertexShader).id}getFragmentShaderID(e){return this._getShaderStage(e.fragmentShader).id}dispose(){this.shaderCache.clear(),this.materialCache.clear()}_getShaderCacheForMaterial(e){const t=this.materialCache;let n=t.get(e);return n===void 0&&(n=new Set,t.set(e,n)),n}_getShaderStage(e){const t=this.shaderCache;let n=t.get(e);return n===void 0&&(n=new Tg(e),t.set(e,n)),n}}class Tg{constructor(e){this.id=yg++,this.code=e,this.usedTimes=0}}function Eg(s,e,t,n,i,r,o){const a=new jl,c=new Sg,l=new Set,u=[],h=i.logarithmicDepthBuffer,d=i.vertexTextures;let f=i.precision;const m={MeshDepthMaterial:"depth",MeshDistanceMaterial:"distanceRGBA",MeshNormalMaterial:"normal",MeshBasicMaterial:"basic",MeshLambertMaterial:"lambert",MeshPhongMaterial:"phong",MeshToonMaterial:"toon",MeshStandardMaterial:"physical",MeshPhysicalMaterial:"physical",MeshMatcapMaterial:"matcap",LineBasicMaterial:"basic",LineDashedMaterial:"dashed",PointsMaterial:"points",ShadowMaterial:"shadow",SpriteMaterial:"sprite"};function g(x){return l.add(x),x===0?"uv":`uv${x}`}function p(x,M,I,F,z){const G=F.fog,j=z.geometry,B=x.isMeshStandardMaterial?F.environment:null,J=(x.isMeshStandardMaterial?t:e).get(x.envMap||B),W=J&&J.mapping===Cr?J.image.height:null,K=m[x.type];x.precision!==null&&(f=i.getMaxPrecision(x.precision),f!==x.precision&&console.warn("THREE.WebGLProgram.getParameters:",x.precision,"not supported, using",f,"instead."));const $=j.morphAttributes.position||j.morphAttributes.normal||j.morphAttributes.color,le=$!==void 0?$.length:0;let De=0;j.morphAttributes.position!==void 0&&(De=1),j.morphAttributes.normal!==void 0&&(De=2),j.morphAttributes.color!==void 0&&(De=3);let Ve,Ye,ae,k;if(K){const Je=ln[K];Ve=Je.vertexShader,Ye=Je.fragmentShader}else Ve=x.vertexShader,Ye=x.fragmentShader,c.update(x),ae=c.getVertexShaderID(x),k=c.getFragmentShaderID(x);const X=s.getRenderTarget(),se=s.state.buffers.depth.getReversed(),_e=z.isInstancedMesh===!0,me=z.isBatchedMesh===!0,Fe=!!x.map,mt=!!x.matcap,D=!!J,st=!!x.aoMap,Le=!!x.lightMap,Ce=!!x.bumpMap,ve=!!x.normalMap,nt=!!x.displacementMap,Ae=!!x.emissiveMap,Oe=!!x.metalnessMap,ht=!!x.roughnessMap,dt=x.anisotropy>0,b=x.clearcoat>0,_=x.dispersion>0,O=x.iridescence>0,Y=x.sheen>0,Z=x.transmission>0,Q=dt&&!!x.anisotropyMap,Ee=b&&!!x.clearcoatMap,re=b&&!!x.clearcoatNormalMap,ye=b&&!!x.clearcoatRoughnessMap,Se=O&&!!x.iridescenceMap,ne=O&&!!x.iridescenceThicknessMap,de=Y&&!!x.sheenColorMap,Ie=Y&&!!x.sheenRoughnessMap,Te=!!x.specularMap,ue=!!x.specularColorMap,ze=!!x.specularIntensityMap,L=Z&&!!x.transmissionMap,ie=Z&&!!x.thicknessMap,oe=!!x.gradientMap,ge=!!x.alphaMap,ee=x.alphaTest>0,q=!!x.alphaHash,Me=!!x.extensions;let Be=Hn;x.toneMapped&&(X===null||X.isXRRenderTarget===!0)&&(Be=s.toneMapping);const rt={shaderID:K,shaderType:x.type,shaderName:x.name,vertexShader:Ve,fragmentShader:Ye,defines:x.defines,customVertexShaderID:ae,customFragmentShaderID:k,isRawShaderMaterial:x.isRawShaderMaterial===!0,glslVersion:x.glslVersion,precision:f,batching:me,batchingColor:me&&z._colorsTexture!==null,instancing:_e,instancingColor:_e&&z.instanceColor!==null,instancingMorph:_e&&z.morphTexture!==null,supportsVertexTextures:d,outputColorSpace:X===null?s.outputColorSpace:X.isXRRenderTarget===!0?X.texture.colorSpace:bt,alphaToCoverage:!!x.alphaToCoverage,map:Fe,matcap:mt,envMap:D,envMapMode:D&&J.mapping,envMapCubeUVHeight:W,aoMap:st,lightMap:Le,bumpMap:Ce,normalMap:ve,displacementMap:d&&nt,emissiveMap:Ae,normalMapObjectSpace:ve&&x.normalMapType===fh,normalMapTangentSpace:ve&&x.normalMapType===Da,metalnessMap:Oe,roughnessMap:ht,anisotropy:dt,anisotropyMap:Q,clearcoat:b,clearcoatMap:Ee,clearcoatNormalMap:re,clearcoatRoughnessMap:ye,dispersion:_,iridescence:O,iridescenceMap:Se,iridescenceThicknessMap:ne,sheen:Y,sheenColorMap:de,sheenRoughnessMap:Ie,specularMap:Te,specularColorMap:ue,specularIntensityMap:ze,transmission:Z,transmissionMap:L,thicknessMap:ie,gradientMap:oe,opaque:x.transparent===!1&&x.blending===ii&&x.alphaToCoverage===!1,alphaMap:ge,alphaTest:ee,alphaHash:q,combine:x.combine,mapUv:Fe&&g(x.map.channel),aoMapUv:st&&g(x.aoMap.channel),lightMapUv:Le&&g(x.lightMap.channel),bumpMapUv:Ce&&g(x.bumpMap.channel),normalMapUv:ve&&g(x.normalMap.channel),displacementMapUv:nt&&g(x.displacementMap.channel),emissiveMapUv:Ae&&g(x.emissiveMap.channel),metalnessMapUv:Oe&&g(x.metalnessMap.channel),roughnessMapUv:ht&&g(x.roughnessMap.channel),anisotropyMapUv:Q&&g(x.anisotropyMap.channel),clearcoatMapUv:Ee&&g(x.clearcoatMap.channel),clearcoatNormalMapUv:re&&g(x.clearcoatNormalMap.channel),clearcoatRoughnessMapUv:ye&&g(x.clearcoatRoughnessMap.channel),iridescenceMapUv:Se&&g(x.iridescenceMap.channel),iridescenceThicknessMapUv:ne&&g(x.iridescenceThicknessMap.channel),sheenColorMapUv:de&&g(x.sheenColorMap.channel),sheenRoughnessMapUv:Ie&&g(x.sheenRoughnessMap.channel),specularMapUv:Te&&g(x.specularMap.channel),specularColorMapUv:ue&&g(x.specularColorMap.channel),specularIntensityMapUv:ze&&g(x.specularIntensityMap.channel),transmissionMapUv:L&&g(x.transmissionMap.channel),thicknessMapUv:ie&&g(x.thicknessMap.channel),alphaMapUv:ge&&g(x.alphaMap.channel),vertexTangents:!!j.attributes.tangent&&(ve||dt),vertexColors:x.vertexColors,vertexAlphas:x.vertexColors===!0&&!!j.attributes.color&&j.attributes.color.itemSize===4,pointsUvs:z.isPoints===!0&&!!j.attributes.uv&&(Fe||ge),fog:!!G,useFog:x.fog===!0,fogExp2:!!G&&G.isFogExp2,flatShading:x.flatShading===!0&&x.wireframe===!1,sizeAttenuation:x.sizeAttenuation===!0,logarithmicDepthBuffer:h,reversedDepthBuffer:se,skinning:z.isSkinnedMesh===!0,morphTargets:j.morphAttributes.position!==void 0,morphNormals:j.morphAttributes.normal!==void 0,morphColors:j.morphAttributes.color!==void 0,morphTargetsCount:le,morphTextureStride:De,numDirLights:M.directional.length,numPointLights:M.point.length,numSpotLights:M.spot.length,numSpotLightMaps:M.spotLightMap.length,numRectAreaLights:M.rectArea.length,numHemiLights:M.hemi.length,numDirLightShadows:M.directionalShadowMap.length,numPointLightShadows:M.pointShadowMap.length,numSpotLightShadows:M.spotShadowMap.length,numSpotLightShadowsWithMaps:M.numSpotLightShadowsWithMaps,numLightProbes:M.numLightProbes,numClippingPlanes:o.numPlanes,numClipIntersection:o.numIntersection,dithering:x.dithering,shadowMapEnabled:s.shadowMap.enabled&&I.length>0,shadowMapType:s.shadowMap.type,toneMapping:Be,decodeVideoTexture:Fe&&x.map.isVideoTexture===!0&&je.getTransfer(x.map.colorSpace)===tt,decodeVideoTextureEmissive:Ae&&x.emissiveMap.isVideoTexture===!0&&je.getTransfer(x.emissiveMap.colorSpace)===tt,premultipliedAlpha:x.premultipliedAlpha,doubleSided:x.side===un,flipSided:x.side===It,useDepthPacking:x.depthPacking>=0,depthPacking:x.depthPacking||0,index0AttributeName:x.index0AttributeName,extensionClipCullDistance:Me&&x.extensions.clipCullDistance===!0&&n.has("WEBGL_clip_cull_distance"),extensionMultiDraw:(Me&&x.extensions.multiDraw===!0||me)&&n.has("WEBGL_multi_draw"),rendererExtensionParallelShaderCompile:n.has("KHR_parallel_shader_compile"),customProgramCacheKey:x.customProgramCacheKey()};return rt.vertexUv1s=l.has(1),rt.vertexUv2s=l.has(2),rt.vertexUv3s=l.has(3),l.clear(),rt}function A(x){const M=[];if(x.shaderID?M.push(x.shaderID):(M.push(x.customVertexShaderID),M.push(x.customFragmentShaderID)),x.defines!==void 0)for(const I in x.defines)M.push(I),M.push(x.defines[I]);return x.isRawShaderMaterial===!1&&(T(M,x),y(M,x),M.push(s.outputColorSpace)),M.push(x.customProgramCacheKey),M.join()}function T(x,M){x.push(M.precision),x.push(M.outputColorSpace),x.push(M.envMapMode),x.push(M.envMapCubeUVHeight),x.push(M.mapUv),x.push(M.alphaMapUv),x.push(M.lightMapUv),x.push(M.aoMapUv),x.push(M.bumpMapUv),x.push(M.normalMapUv),x.push(M.displacementMapUv),x.push(M.emissiveMapUv),x.push(M.metalnessMapUv),x.push(M.roughnessMapUv),x.push(M.anisotropyMapUv),x.push(M.clearcoatMapUv),x.push(M.clearcoatNormalMapUv),x.push(M.clearcoatRoughnessMapUv),x.push(M.iridescenceMapUv),x.push(M.iridescenceThicknessMapUv),x.push(M.sheenColorMapUv),x.push(M.sheenRoughnessMapUv),x.push(M.specularMapUv),x.push(M.specularColorMapUv),x.push(M.specularIntensityMapUv),x.push(M.transmissionMapUv),x.push(M.thicknessMapUv),x.push(M.combine),x.push(M.fogExp2),x.push(M.sizeAttenuation),x.push(M.morphTargetsCount),x.push(M.morphAttributeCount),x.push(M.numDirLights),x.push(M.numPointLights),x.push(M.numSpotLights),x.push(M.numSpotLightMaps),x.push(M.numHemiLights),x.push(M.numRectAreaLights),x.push(M.numDirLightShadows),x.push(M.numPointLightShadows),x.push(M.numSpotLightShadows),x.push(M.numSpotLightShadowsWithMaps),x.push(M.numLightProbes),x.push(M.shadowMapType),x.push(M.toneMapping),x.push(M.numClippingPlanes),x.push(M.numClipIntersection),x.push(M.depthPacking)}function y(x,M){a.disableAll(),M.supportsVertexTextures&&a.enable(0),M.instancing&&a.enable(1),M.instancingColor&&a.enable(2),M.instancingMorph&&a.enable(3),M.matcap&&a.enable(4),M.envMap&&a.enable(5),M.normalMapObjectSpace&&a.enable(6),M.normalMapTangentSpace&&a.enable(7),M.clearcoat&&a.enable(8),M.iridescence&&a.enable(9),M.alphaTest&&a.enable(10),M.vertexColors&&a.enable(11),M.vertexAlphas&&a.enable(12),M.vertexUv1s&&a.enable(13),M.vertexUv2s&&a.enable(14),M.vertexUv3s&&a.enable(15),M.vertexTangents&&a.enable(16),M.anisotropy&&a.enable(17),M.alphaHash&&a.enable(18),M.batching&&a.enable(19),M.dispersion&&a.enable(20),M.batchingColor&&a.enable(21),M.gradientMap&&a.enable(22),x.push(a.mask),a.disableAll(),M.fog&&a.enable(0),M.useFog&&a.enable(1),M.flatShading&&a.enable(2),M.logarithmicDepthBuffer&&a.enable(3),M.reversedDepthBuffer&&a.enable(4),M.skinning&&a.enable(5),M.morphTargets&&a.enable(6),M.morphNormals&&a.enable(7),M.morphColors&&a.enable(8),M.premultipliedAlpha&&a.enable(9),M.shadowMapEnabled&&a.enable(10),M.doubleSided&&a.enable(11),M.flipSided&&a.enable(12),M.useDepthPacking&&a.enable(13),M.dithering&&a.enable(14),M.transmission&&a.enable(15),M.sheen&&a.enable(16),M.opaque&&a.enable(17),M.pointsUvs&&a.enable(18),M.decodeVideoTexture&&a.enable(19),M.decodeVideoTextureEmissive&&a.enable(20),M.alphaToCoverage&&a.enable(21),x.push(a.mask)}function v(x){const M=m[x.type];let I;if(M){const F=ln[M];I=id.clone(F.uniforms)}else I=x.uniforms;return I}function w(x,M){let I;for(let F=0,z=u.length;F<z;F++){const G=u[F];if(G.cacheKey===M){I=G,++I.usedTimes;break}}return I===void 0&&(I=new Mg(s,M,x,r),u.push(I)),I}function E(x){if(--x.usedTimes===0){const M=u.indexOf(x);u[M]=u[u.length-1],u.pop(),x.destroy()}}function C(x){c.remove(x)}function P(){c.dispose()}return{getParameters:p,getProgramCacheKey:A,getUniforms:v,acquireProgram:w,releaseProgram:E,releaseShaderCache:C,programs:u,dispose:P}}function wg(){let s=new WeakMap;function e(o){return s.has(o)}function t(o){let a=s.get(o);return a===void 0&&(a={},s.set(o,a)),a}function n(o){s.delete(o)}function i(o,a,c){s.get(o)[a]=c}function r(){s=new WeakMap}return{has:e,get:t,remove:n,update:i,dispose:r}}function bg(s,e){return s.groupOrder!==e.groupOrder?s.groupOrder-e.groupOrder:s.renderOrder!==e.renderOrder?s.renderOrder-e.renderOrder:s.material.id!==e.material.id?s.material.id-e.material.id:s.z!==e.z?s.z-e.z:s.id-e.id}function yl(s,e){return s.groupOrder!==e.groupOrder?s.groupOrder-e.groupOrder:s.renderOrder!==e.renderOrder?s.renderOrder-e.renderOrder:s.z!==e.z?e.z-s.z:s.id-e.id}function Sl(){const s=[];let e=0;const t=[],n=[],i=[];function r(){e=0,t.length=0,n.length=0,i.length=0}function o(h,d,f,m,g,p){let A=s[e];return A===void 0?(A={id:h.id,object:h,geometry:d,material:f,groupOrder:m,renderOrder:h.renderOrder,z:g,group:p},s[e]=A):(A.id=h.id,A.object=h,A.geometry=d,A.material=f,A.groupOrder=m,A.renderOrder=h.renderOrder,A.z=g,A.group=p),e++,A}function a(h,d,f,m,g,p){const A=o(h,d,f,m,g,p);f.transmission>0?n.push(A):f.transparent===!0?i.push(A):t.push(A)}function c(h,d,f,m,g,p){const A=o(h,d,f,m,g,p);f.transmission>0?n.unshift(A):f.transparent===!0?i.unshift(A):t.unshift(A)}function l(h,d){t.length>1&&t.sort(h||bg),n.length>1&&n.sort(d||yl),i.length>1&&i.sort(d||yl)}function u(){for(let h=e,d=s.length;h<d;h++){const f=s[h];if(f.id===null)break;f.id=null,f.object=null,f.geometry=null,f.material=null,f.group=null}}return{opaque:t,transmissive:n,transparent:i,init:r,push:a,unshift:c,finish:u,sort:l}}function Cg(){let s=new WeakMap;function e(n,i){const r=s.get(n);let o;return r===void 0?(o=new Sl,s.set(n,[o])):i>=r.length?(o=new Sl,r.push(o)):o=r[i],o}function t(){s=new WeakMap}return{get:e,dispose:t}}function Pg(){const s={};return{get:function(e){if(s[e.id]!==void 0)return s[e.id];let t;switch(e.type){case"DirectionalLight":t={direction:new R,color:new be};break;case"SpotLight":t={position:new R,direction:new R,color:new be,distance:0,coneCos:0,penumbraCos:0,decay:0};break;case"PointLight":t={position:new R,color:new be,distance:0,decay:0};break;case"HemisphereLight":t={direction:new R,skyColor:new be,groundColor:new be};break;case"RectAreaLight":t={color:new be,position:new R,halfWidth:new R,halfHeight:new R};break}return s[e.id]=t,t}}}function Rg(){const s={};return{get:function(e){if(s[e.id]!==void 0)return s[e.id];let t;switch(e.type){case"DirectionalLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new fe};break;case"SpotLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new fe};break;case"PointLight":t={shadowIntensity:1,shadowBias:0,shadowNormalBias:0,shadowRadius:1,shadowMapSize:new fe,shadowCameraNear:1,shadowCameraFar:1e3};break}return s[e.id]=t,t}}}let Dg=0;function Ig(s,e){return(e.castShadow?2:0)-(s.castShadow?2:0)+(e.map?1:0)-(s.map?1:0)}function Lg(s){const e=new Pg,t=Rg(),n={version:0,hash:{directionalLength:-1,pointLength:-1,spotLength:-1,rectAreaLength:-1,hemiLength:-1,numDirectionalShadows:-1,numPointShadows:-1,numSpotShadows:-1,numSpotMaps:-1,numLightProbes:-1},ambient:[0,0,0],probe:[],directional:[],directionalShadow:[],directionalShadowMap:[],directionalShadowMatrix:[],spot:[],spotLightMap:[],spotShadow:[],spotShadowMap:[],spotLightMatrix:[],rectArea:[],rectAreaLTC1:null,rectAreaLTC2:null,point:[],pointShadow:[],pointShadowMap:[],pointShadowMatrix:[],hemi:[],numSpotLightShadowsWithMaps:0,numLightProbes:0};for(let l=0;l<9;l++)n.probe.push(new R);const i=new R,r=new Ne,o=new Ne;function a(l){let u=0,h=0,d=0;for(let x=0;x<9;x++)n.probe[x].set(0,0,0);let f=0,m=0,g=0,p=0,A=0,T=0,y=0,v=0,w=0,E=0,C=0;l.sort(Ig);for(let x=0,M=l.length;x<M;x++){const I=l[x],F=I.color,z=I.intensity,G=I.distance,j=I.shadow&&I.shadow.map?I.shadow.map.texture:null;if(I.isAmbientLight)u+=F.r*z,h+=F.g*z,d+=F.b*z;else if(I.isLightProbe){for(let B=0;B<9;B++)n.probe[B].addScaledVector(I.sh.coefficients[B],z);C++}else if(I.isDirectionalLight){const B=e.get(I);if(B.color.copy(I.color).multiplyScalar(I.intensity),I.castShadow){const J=I.shadow,W=t.get(I);W.shadowIntensity=J.intensity,W.shadowBias=J.bias,W.shadowNormalBias=J.normalBias,W.shadowRadius=J.radius,W.shadowMapSize=J.mapSize,n.directionalShadow[f]=W,n.directionalShadowMap[f]=j,n.directionalShadowMatrix[f]=I.shadow.matrix,T++}n.directional[f]=B,f++}else if(I.isSpotLight){const B=e.get(I);B.position.setFromMatrixPosition(I.matrixWorld),B.color.copy(F).multiplyScalar(z),B.distance=G,B.coneCos=Math.cos(I.angle),B.penumbraCos=Math.cos(I.angle*(1-I.penumbra)),B.decay=I.decay,n.spot[g]=B;const J=I.shadow;if(I.map&&(n.spotLightMap[w]=I.map,w++,J.updateMatrices(I),I.castShadow&&E++),n.spotLightMatrix[g]=J.matrix,I.castShadow){const W=t.get(I);W.shadowIntensity=J.intensity,W.shadowBias=J.bias,W.shadowNormalBias=J.normalBias,W.shadowRadius=J.radius,W.shadowMapSize=J.mapSize,n.spotShadow[g]=W,n.spotShadowMap[g]=j,v++}g++}else if(I.isRectAreaLight){const B=e.get(I);B.color.copy(F).multiplyScalar(z),B.halfWidth.set(I.width*.5,0,0),B.halfHeight.set(0,I.height*.5,0),n.rectArea[p]=B,p++}else if(I.isPointLight){const B=e.get(I);if(B.color.copy(I.color).multiplyScalar(I.intensity),B.distance=I.distance,B.decay=I.decay,I.castShadow){const J=I.shadow,W=t.get(I);W.shadowIntensity=J.intensity,W.shadowBias=J.bias,W.shadowNormalBias=J.normalBias,W.shadowRadius=J.radius,W.shadowMapSize=J.mapSize,W.shadowCameraNear=J.camera.near,W.shadowCameraFar=J.camera.far,n.pointShadow[m]=W,n.pointShadowMap[m]=j,n.pointShadowMatrix[m]=I.shadow.matrix,y++}n.point[m]=B,m++}else if(I.isHemisphereLight){const B=e.get(I);B.skyColor.copy(I.color).multiplyScalar(z),B.groundColor.copy(I.groundColor).multiplyScalar(z),n.hemi[A]=B,A++}}p>0&&(s.has("OES_texture_float_linear")===!0?(n.rectAreaLTC1=ce.LTC_FLOAT_1,n.rectAreaLTC2=ce.LTC_FLOAT_2):(n.rectAreaLTC1=ce.LTC_HALF_1,n.rectAreaLTC2=ce.LTC_HALF_2)),n.ambient[0]=u,n.ambient[1]=h,n.ambient[2]=d;const P=n.hash;(P.directionalLength!==f||P.pointLength!==m||P.spotLength!==g||P.rectAreaLength!==p||P.hemiLength!==A||P.numDirectionalShadows!==T||P.numPointShadows!==y||P.numSpotShadows!==v||P.numSpotMaps!==w||P.numLightProbes!==C)&&(n.directional.length=f,n.spot.length=g,n.rectArea.length=p,n.point.length=m,n.hemi.length=A,n.directionalShadow.length=T,n.directionalShadowMap.length=T,n.pointShadow.length=y,n.pointShadowMap.length=y,n.spotShadow.length=v,n.spotShadowMap.length=v,n.directionalShadowMatrix.length=T,n.pointShadowMatrix.length=y,n.spotLightMatrix.length=v+w-E,n.spotLightMap.length=w,n.numSpotLightShadowsWithMaps=E,n.numLightProbes=C,P.directionalLength=f,P.pointLength=m,P.spotLength=g,P.rectAreaLength=p,P.hemiLength=A,P.numDirectionalShadows=T,P.numPointShadows=y,P.numSpotShadows=v,P.numSpotMaps=w,P.numLightProbes=C,n.version=Dg++)}function c(l,u){let h=0,d=0,f=0,m=0,g=0;const p=u.matrixWorldInverse;for(let A=0,T=l.length;A<T;A++){const y=l[A];if(y.isDirectionalLight){const v=n.directional[h];v.direction.setFromMatrixPosition(y.matrixWorld),i.setFromMatrixPosition(y.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(p),h++}else if(y.isSpotLight){const v=n.spot[f];v.position.setFromMatrixPosition(y.matrixWorld),v.position.applyMatrix4(p),v.direction.setFromMatrixPosition(y.matrixWorld),i.setFromMatrixPosition(y.target.matrixWorld),v.direction.sub(i),v.direction.transformDirection(p),f++}else if(y.isRectAreaLight){const v=n.rectArea[m];v.position.setFromMatrixPosition(y.matrixWorld),v.position.applyMatrix4(p),o.identity(),r.copy(y.matrixWorld),r.premultiply(p),o.extractRotation(r),v.halfWidth.set(y.width*.5,0,0),v.halfHeight.set(0,y.height*.5,0),v.halfWidth.applyMatrix4(o),v.halfHeight.applyMatrix4(o),m++}else if(y.isPointLight){const v=n.point[d];v.position.setFromMatrixPosition(y.matrixWorld),v.position.applyMatrix4(p),d++}else if(y.isHemisphereLight){const v=n.hemi[g];v.direction.setFromMatrixPosition(y.matrixWorld),v.direction.transformDirection(p),g++}}}return{setup:a,setupView:c,state:n}}function Tl(s){const e=new Lg(s),t=[],n=[];function i(u){l.camera=u,t.length=0,n.length=0}function r(u){t.push(u)}function o(u){n.push(u)}function a(){e.setup(t)}function c(u){e.setupView(t,u)}const l={lightsArray:t,shadowsArray:n,camera:null,lights:e,transmissionRenderTarget:{}};return{init:i,state:l,setupLights:a,setupLightsView:c,pushLight:r,pushShadow:o}}function Ug(s){let e=new WeakMap;function t(i,r=0){const o=e.get(i);let a;return o===void 0?(a=new Tl(s),e.set(i,[a])):r>=o.length?(a=new Tl(s),o.push(a)):a=o[r],a}function n(){e=new WeakMap}return{get:t,dispose:n}}const Ng=`void main() {
	gl_Position = vec4( position, 1.0 );
}`,Fg=`uniform sampler2D shadow_pass;
uniform vec2 resolution;
uniform float radius;
#include <packing>
void main() {
	const float samples = float( VSM_SAMPLES );
	float mean = 0.0;
	float squared_mean = 0.0;
	float uvStride = samples <= 1.0 ? 0.0 : 2.0 / ( samples - 1.0 );
	float uvStart = samples <= 1.0 ? 0.0 : - 1.0;
	for ( float i = 0.0; i < samples; i ++ ) {
		float uvOffset = uvStart + i * uvStride;
		#ifdef HORIZONTAL_PASS
			vec2 distribution = unpackRGBATo2Half( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( uvOffset, 0.0 ) * radius ) / resolution ) );
			mean += distribution.x;
			squared_mean += distribution.y * distribution.y + distribution.x * distribution.x;
		#else
			float depth = unpackRGBAToDepth( texture2D( shadow_pass, ( gl_FragCoord.xy + vec2( 0.0, uvOffset ) * radius ) / resolution ) );
			mean += depth;
			squared_mean += depth * depth;
		#endif
	}
	mean = mean / samples;
	squared_mean = squared_mean / samples;
	float std_dev = sqrt( squared_mean - mean * mean );
	gl_FragColor = pack2HalfToRGBA( vec2( mean, std_dev ) );
}`;function Og(s,e,t){let n=new Oa;const i=new fe,r=new fe,o=new qe,a=new Ud({depthPacking:dh}),c=new Nd,l={},u=t.maxTextureSize,h={[bn]:It,[It]:bn,[un]:un},d=new Vn({defines:{VSM_SAMPLES:8},uniforms:{shadow_pass:{value:null},resolution:{value:new fe},radius:{value:4}},vertexShader:Ng,fragmentShader:Fg}),f=d.clone();f.defines.HORIZONTAL_PASS=1;const m=new St;m.setAttribute("position",new vt(new Float32Array([-1,-1,.5,3,-1,.5,-1,3,.5]),3));const g=new Qe(m,d),p=this;this.enabled=!1,this.autoUpdate=!0,this.needsUpdate=!1,this.type=Dl;let A=this.type;this.render=function(E,C,P){if(p.enabled===!1||p.autoUpdate===!1&&p.needsUpdate===!1||E.length===0)return;const x=s.getRenderTarget(),M=s.getActiveCubeFace(),I=s.getActiveMipmapLevel(),F=s.state;F.setBlending(kn),F.buffers.depth.getReversed()===!0?F.buffers.color.setClear(0,0,0,0):F.buffers.color.setClear(1,1,1,1),F.buffers.depth.setTest(!0),F.setScissorTest(!1);const z=A!==Sn&&this.type===Sn,G=A===Sn&&this.type!==Sn;for(let j=0,B=E.length;j<B;j++){const J=E[j],W=J.shadow;if(W===void 0){console.warn("THREE.WebGLShadowMap:",J,"has no shadow.");continue}if(W.autoUpdate===!1&&W.needsUpdate===!1)continue;i.copy(W.mapSize);const K=W.getFrameExtents();if(i.multiply(K),r.copy(W.mapSize),(i.x>u||i.y>u)&&(i.x>u&&(r.x=Math.floor(u/K.x),i.x=r.x*K.x,W.mapSize.x=r.x),i.y>u&&(r.y=Math.floor(u/K.y),i.y=r.y*K.y,W.mapSize.y=r.y)),W.map===null||z===!0||G===!0){const le=this.type!==Sn?{minFilter:Lt,magFilter:Lt}:{};W.map!==null&&W.map.dispose(),W.map=new Gn(i.x,i.y,le),W.map.texture.name=J.name+".shadowMap",W.camera.updateProjectionMatrix()}s.setRenderTarget(W.map),s.clear();const $=W.getViewportCount();for(let le=0;le<$;le++){const De=W.getViewport(le);o.set(r.x*De.x,r.y*De.y,r.x*De.z,r.y*De.w),F.viewport(o),W.updateMatrices(J,le),n=W.getFrustum(),v(C,P,W.camera,J,this.type)}W.isPointLightShadow!==!0&&this.type===Sn&&T(W,P),W.needsUpdate=!1}A=this.type,p.needsUpdate=!1,s.setRenderTarget(x,M,I)};function T(E,C){const P=e.update(g);d.defines.VSM_SAMPLES!==E.blurSamples&&(d.defines.VSM_SAMPLES=E.blurSamples,f.defines.VSM_SAMPLES=E.blurSamples,d.needsUpdate=!0,f.needsUpdate=!0),E.mapPass===null&&(E.mapPass=new Gn(i.x,i.y)),d.uniforms.shadow_pass.value=E.map.texture,d.uniforms.resolution.value=E.mapSize,d.uniforms.radius.value=E.radius,s.setRenderTarget(E.mapPass),s.clear(),s.renderBufferDirect(C,null,P,d,g,null),f.uniforms.shadow_pass.value=E.mapPass.texture,f.uniforms.resolution.value=E.mapSize,f.uniforms.radius.value=E.radius,s.setRenderTarget(E.map),s.clear(),s.renderBufferDirect(C,null,P,f,g,null)}function y(E,C,P,x){let M=null;const I=P.isPointLight===!0?E.customDistanceMaterial:E.customDepthMaterial;if(I!==void 0)M=I;else if(M=P.isPointLight===!0?c:a,s.localClippingEnabled&&C.clipShadows===!0&&Array.isArray(C.clippingPlanes)&&C.clippingPlanes.length!==0||C.displacementMap&&C.displacementScale!==0||C.alphaMap&&C.alphaTest>0||C.map&&C.alphaTest>0||C.alphaToCoverage===!0){const F=M.uuid,z=C.uuid;let G=l[F];G===void 0&&(G={},l[F]=G);let j=G[z];j===void 0&&(j=M.clone(),G[z]=j,C.addEventListener("dispose",w)),M=j}if(M.visible=C.visible,M.wireframe=C.wireframe,x===Sn?M.side=C.shadowSide!==null?C.shadowSide:C.side:M.side=C.shadowSide!==null?C.shadowSide:h[C.side],M.alphaMap=C.alphaMap,M.alphaTest=C.alphaToCoverage===!0?.5:C.alphaTest,M.map=C.map,M.clipShadows=C.clipShadows,M.clippingPlanes=C.clippingPlanes,M.clipIntersection=C.clipIntersection,M.displacementMap=C.displacementMap,M.displacementScale=C.displacementScale,M.displacementBias=C.displacementBias,M.wireframeLinewidth=C.wireframeLinewidth,M.linewidth=C.linewidth,P.isPointLight===!0&&M.isMeshDistanceMaterial===!0){const F=s.properties.get(M);F.light=P}return M}function v(E,C,P,x,M){if(E.visible===!1)return;if(E.layers.test(C.layers)&&(E.isMesh||E.isLine||E.isPoints)&&(E.castShadow||E.receiveShadow&&M===Sn)&&(!E.frustumCulled||n.intersectsObject(E))){E.modelViewMatrix.multiplyMatrices(P.matrixWorldInverse,E.matrixWorld);const z=e.update(E),G=E.material;if(Array.isArray(G)){const j=z.groups;for(let B=0,J=j.length;B<J;B++){const W=j[B],K=G[W.materialIndex];if(K&&K.visible){const $=y(E,K,x,M);E.onBeforeShadow(s,E,C,P,z,$,W),s.renderBufferDirect(P,null,z,$,E,W),E.onAfterShadow(s,E,C,P,z,$,W)}}}else if(G.visible){const j=y(E,G,x,M);E.onBeforeShadow(s,E,C,P,z,j,null),s.renderBufferDirect(P,null,z,j,E,null),E.onAfterShadow(s,E,C,P,z,j,null)}}const F=E.children;for(let z=0,G=F.length;z<G;z++)v(F[z],C,P,x,M)}function w(E){E.target.removeEventListener("dispose",w);for(const P in l){const x=l[P],M=E.target.uuid;M in x&&(x[M].dispose(),delete x[M])}}}const Bg={[Ro]:Do,[Io]:No,[Lo]:Fo,[zi]:Uo,[Do]:Ro,[No]:Io,[Fo]:Lo,[Uo]:zi};function zg(s,e){function t(){let L=!1;const ie=new qe;let oe=null;const ge=new qe(0,0,0,0);return{setMask:function(ee){oe!==ee&&!L&&(s.colorMask(ee,ee,ee,ee),oe=ee)},setLocked:function(ee){L=ee},setClear:function(ee,q,Me,Be,rt){rt===!0&&(ee*=Be,q*=Be,Me*=Be),ie.set(ee,q,Me,Be),ge.equals(ie)===!1&&(s.clearColor(ee,q,Me,Be),ge.copy(ie))},reset:function(){L=!1,oe=null,ge.set(-1,0,0,0)}}}function n(){let L=!1,ie=!1,oe=null,ge=null,ee=null;return{setReversed:function(q){if(ie!==q){const Me=e.get("EXT_clip_control");q?Me.clipControlEXT(Me.LOWER_LEFT_EXT,Me.ZERO_TO_ONE_EXT):Me.clipControlEXT(Me.LOWER_LEFT_EXT,Me.NEGATIVE_ONE_TO_ONE_EXT),ie=q;const Be=ee;ee=null,this.setClear(Be)}},getReversed:function(){return ie},setTest:function(q){q?X(s.DEPTH_TEST):se(s.DEPTH_TEST)},setMask:function(q){oe!==q&&!L&&(s.depthMask(q),oe=q)},setFunc:function(q){if(ie&&(q=Bg[q]),ge!==q){switch(q){case Ro:s.depthFunc(s.NEVER);break;case Do:s.depthFunc(s.ALWAYS);break;case Io:s.depthFunc(s.LESS);break;case zi:s.depthFunc(s.LEQUAL);break;case Lo:s.depthFunc(s.EQUAL);break;case Uo:s.depthFunc(s.GEQUAL);break;case No:s.depthFunc(s.GREATER);break;case Fo:s.depthFunc(s.NOTEQUAL);break;default:s.depthFunc(s.LEQUAL)}ge=q}},setLocked:function(q){L=q},setClear:function(q){ee!==q&&(ie&&(q=1-q),s.clearDepth(q),ee=q)},reset:function(){L=!1,oe=null,ge=null,ee=null,ie=!1}}}function i(){let L=!1,ie=null,oe=null,ge=null,ee=null,q=null,Me=null,Be=null,rt=null;return{setTest:function(Je){L||(Je?X(s.STENCIL_TEST):se(s.STENCIL_TEST))},setMask:function(Je){ie!==Je&&!L&&(s.stencilMask(Je),ie=Je)},setFunc:function(Je,mn,an){(oe!==Je||ge!==mn||ee!==an)&&(s.stencilFunc(Je,mn,an),oe=Je,ge=mn,ee=an)},setOp:function(Je,mn,an){(q!==Je||Me!==mn||Be!==an)&&(s.stencilOp(Je,mn,an),q=Je,Me=mn,Be=an)},setLocked:function(Je){L=Je},setClear:function(Je){rt!==Je&&(s.clearStencil(Je),rt=Je)},reset:function(){L=!1,ie=null,oe=null,ge=null,ee=null,q=null,Me=null,Be=null,rt=null}}}const r=new t,o=new n,a=new i,c=new WeakMap,l=new WeakMap;let u={},h={},d=new WeakMap,f=[],m=null,g=!1,p=null,A=null,T=null,y=null,v=null,w=null,E=null,C=new be(0,0,0),P=0,x=!1,M=null,I=null,F=null,z=null,G=null;const j=s.getParameter(s.MAX_COMBINED_TEXTURE_IMAGE_UNITS);let B=!1,J=0;const W=s.getParameter(s.VERSION);W.indexOf("WebGL")!==-1?(J=parseFloat(/^WebGL (\d)/.exec(W)[1]),B=J>=1):W.indexOf("OpenGL ES")!==-1&&(J=parseFloat(/^OpenGL ES (\d)/.exec(W)[1]),B=J>=2);let K=null,$={};const le=s.getParameter(s.SCISSOR_BOX),De=s.getParameter(s.VIEWPORT),Ve=new qe().fromArray(le),Ye=new qe().fromArray(De);function ae(L,ie,oe,ge){const ee=new Uint8Array(4),q=s.createTexture();s.bindTexture(L,q),s.texParameteri(L,s.TEXTURE_MIN_FILTER,s.NEAREST),s.texParameteri(L,s.TEXTURE_MAG_FILTER,s.NEAREST);for(let Me=0;Me<oe;Me++)L===s.TEXTURE_3D||L===s.TEXTURE_2D_ARRAY?s.texImage3D(ie,0,s.RGBA,1,1,ge,0,s.RGBA,s.UNSIGNED_BYTE,ee):s.texImage2D(ie+Me,0,s.RGBA,1,1,0,s.RGBA,s.UNSIGNED_BYTE,ee);return q}const k={};k[s.TEXTURE_2D]=ae(s.TEXTURE_2D,s.TEXTURE_2D,1),k[s.TEXTURE_CUBE_MAP]=ae(s.TEXTURE_CUBE_MAP,s.TEXTURE_CUBE_MAP_POSITIVE_X,6),k[s.TEXTURE_2D_ARRAY]=ae(s.TEXTURE_2D_ARRAY,s.TEXTURE_2D_ARRAY,1,1),k[s.TEXTURE_3D]=ae(s.TEXTURE_3D,s.TEXTURE_3D,1,1),r.setClear(0,0,0,1),o.setClear(1),a.setClear(0),X(s.DEPTH_TEST),o.setFunc(zi),Ce(!1),ve(ac),X(s.CULL_FACE),st(kn);function X(L){u[L]!==!0&&(s.enable(L),u[L]=!0)}function se(L){u[L]!==!1&&(s.disable(L),u[L]=!1)}function _e(L,ie){return h[L]!==ie?(s.bindFramebuffer(L,ie),h[L]=ie,L===s.DRAW_FRAMEBUFFER&&(h[s.FRAMEBUFFER]=ie),L===s.FRAMEBUFFER&&(h[s.DRAW_FRAMEBUFFER]=ie),!0):!1}function me(L,ie){let oe=f,ge=!1;if(L){oe=d.get(ie),oe===void 0&&(oe=[],d.set(ie,oe));const ee=L.textures;if(oe.length!==ee.length||oe[0]!==s.COLOR_ATTACHMENT0){for(let q=0,Me=ee.length;q<Me;q++)oe[q]=s.COLOR_ATTACHMENT0+q;oe.length=ee.length,ge=!0}}else oe[0]!==s.BACK&&(oe[0]=s.BACK,ge=!0);ge&&s.drawBuffers(oe)}function Fe(L){return m!==L?(s.useProgram(L),m=L,!0):!1}const mt={[ti]:s.FUNC_ADD,[Fu]:s.FUNC_SUBTRACT,[Ou]:s.FUNC_REVERSE_SUBTRACT};mt[Bu]=s.MIN,mt[zu]=s.MAX;const D={[ku]:s.ZERO,[Hu]:s.ONE,[Gu]:s.SRC_COLOR,[Co]:s.SRC_ALPHA,[Ku]:s.SRC_ALPHA_SATURATE,[ju]:s.DST_COLOR,[Wu]:s.DST_ALPHA,[Vu]:s.ONE_MINUS_SRC_COLOR,[Po]:s.ONE_MINUS_SRC_ALPHA,[Qu]:s.ONE_MINUS_DST_COLOR,[Xu]:s.ONE_MINUS_DST_ALPHA,[Yu]:s.CONSTANT_COLOR,[qu]:s.ONE_MINUS_CONSTANT_COLOR,[Ju]:s.CONSTANT_ALPHA,[Zu]:s.ONE_MINUS_CONSTANT_ALPHA};function st(L,ie,oe,ge,ee,q,Me,Be,rt,Je){if(L===kn){g===!0&&(se(s.BLEND),g=!1);return}if(g===!1&&(X(s.BLEND),g=!0),L!==Nu){if(L!==p||Je!==x){if((A!==ti||v!==ti)&&(s.blendEquation(s.FUNC_ADD),A=ti,v=ti),Je)switch(L){case ii:s.blendFuncSeparate(s.ONE,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case Bi:s.blendFunc(s.ONE,s.ONE);break;case cc:s.blendFuncSeparate(s.ZERO,s.ONE_MINUS_SRC_COLOR,s.ZERO,s.ONE);break;case lc:s.blendFuncSeparate(s.DST_COLOR,s.ONE_MINUS_SRC_ALPHA,s.ZERO,s.ONE);break;default:console.error("THREE.WebGLState: Invalid blending: ",L);break}else switch(L){case ii:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE_MINUS_SRC_ALPHA,s.ONE,s.ONE_MINUS_SRC_ALPHA);break;case Bi:s.blendFuncSeparate(s.SRC_ALPHA,s.ONE,s.ONE,s.ONE);break;case cc:console.error("THREE.WebGLState: SubtractiveBlending requires material.premultipliedAlpha = true");break;case lc:console.error("THREE.WebGLState: MultiplyBlending requires material.premultipliedAlpha = true");break;default:console.error("THREE.WebGLState: Invalid blending: ",L);break}T=null,y=null,w=null,E=null,C.set(0,0,0),P=0,p=L,x=Je}return}ee=ee||ie,q=q||oe,Me=Me||ge,(ie!==A||ee!==v)&&(s.blendEquationSeparate(mt[ie],mt[ee]),A=ie,v=ee),(oe!==T||ge!==y||q!==w||Me!==E)&&(s.blendFuncSeparate(D[oe],D[ge],D[q],D[Me]),T=oe,y=ge,w=q,E=Me),(Be.equals(C)===!1||rt!==P)&&(s.blendColor(Be.r,Be.g,Be.b,rt),C.copy(Be),P=rt),p=L,x=!1}function Le(L,ie){L.side===un?se(s.CULL_FACE):X(s.CULL_FACE);let oe=L.side===It;ie&&(oe=!oe),Ce(oe),L.blending===ii&&L.transparent===!1?st(kn):st(L.blending,L.blendEquation,L.blendSrc,L.blendDst,L.blendEquationAlpha,L.blendSrcAlpha,L.blendDstAlpha,L.blendColor,L.blendAlpha,L.premultipliedAlpha),o.setFunc(L.depthFunc),o.setTest(L.depthTest),o.setMask(L.depthWrite),r.setMask(L.colorWrite);const ge=L.stencilWrite;a.setTest(ge),ge&&(a.setMask(L.stencilWriteMask),a.setFunc(L.stencilFunc,L.stencilRef,L.stencilFuncMask),a.setOp(L.stencilFail,L.stencilZFail,L.stencilZPass)),Ae(L.polygonOffset,L.polygonOffsetFactor,L.polygonOffsetUnits),L.alphaToCoverage===!0?X(s.SAMPLE_ALPHA_TO_COVERAGE):se(s.SAMPLE_ALPHA_TO_COVERAGE)}function Ce(L){M!==L&&(L?s.frontFace(s.CW):s.frontFace(s.CCW),M=L)}function ve(L){L!==Iu?(X(s.CULL_FACE),L!==I&&(L===ac?s.cullFace(s.BACK):L===Lu?s.cullFace(s.FRONT):s.cullFace(s.FRONT_AND_BACK))):se(s.CULL_FACE),I=L}function nt(L){L!==F&&(B&&s.lineWidth(L),F=L)}function Ae(L,ie,oe){L?(X(s.POLYGON_OFFSET_FILL),(z!==ie||G!==oe)&&(s.polygonOffset(ie,oe),z=ie,G=oe)):se(s.POLYGON_OFFSET_FILL)}function Oe(L){L?X(s.SCISSOR_TEST):se(s.SCISSOR_TEST)}function ht(L){L===void 0&&(L=s.TEXTURE0+j-1),K!==L&&(s.activeTexture(L),K=L)}function dt(L,ie,oe){oe===void 0&&(K===null?oe=s.TEXTURE0+j-1:oe=K);let ge=$[oe];ge===void 0&&(ge={type:void 0,texture:void 0},$[oe]=ge),(ge.type!==L||ge.texture!==ie)&&(K!==oe&&(s.activeTexture(oe),K=oe),s.bindTexture(L,ie||k[L]),ge.type=L,ge.texture=ie)}function b(){const L=$[K];L!==void 0&&L.type!==void 0&&(s.bindTexture(L.type,null),L.type=void 0,L.texture=void 0)}function _(){try{s.compressedTexImage2D(...arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function O(){try{s.compressedTexImage3D(...arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Y(){try{s.texSubImage2D(...arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Z(){try{s.texSubImage3D(...arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Q(){try{s.compressedTexSubImage2D(...arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Ee(){try{s.compressedTexSubImage3D(...arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function re(){try{s.texStorage2D(...arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function ye(){try{s.texStorage3D(...arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function Se(){try{s.texImage2D(...arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function ne(){try{s.texImage3D(...arguments)}catch(L){console.error("THREE.WebGLState:",L)}}function de(L){Ve.equals(L)===!1&&(s.scissor(L.x,L.y,L.z,L.w),Ve.copy(L))}function Ie(L){Ye.equals(L)===!1&&(s.viewport(L.x,L.y,L.z,L.w),Ye.copy(L))}function Te(L,ie){let oe=l.get(ie);oe===void 0&&(oe=new WeakMap,l.set(ie,oe));let ge=oe.get(L);ge===void 0&&(ge=s.getUniformBlockIndex(ie,L.name),oe.set(L,ge))}function ue(L,ie){const ge=l.get(ie).get(L);c.get(ie)!==ge&&(s.uniformBlockBinding(ie,ge,L.__bindingPointIndex),c.set(ie,ge))}function ze(){s.disable(s.BLEND),s.disable(s.CULL_FACE),s.disable(s.DEPTH_TEST),s.disable(s.POLYGON_OFFSET_FILL),s.disable(s.SCISSOR_TEST),s.disable(s.STENCIL_TEST),s.disable(s.SAMPLE_ALPHA_TO_COVERAGE),s.blendEquation(s.FUNC_ADD),s.blendFunc(s.ONE,s.ZERO),s.blendFuncSeparate(s.ONE,s.ZERO,s.ONE,s.ZERO),s.blendColor(0,0,0,0),s.colorMask(!0,!0,!0,!0),s.clearColor(0,0,0,0),s.depthMask(!0),s.depthFunc(s.LESS),o.setReversed(!1),s.clearDepth(1),s.stencilMask(4294967295),s.stencilFunc(s.ALWAYS,0,4294967295),s.stencilOp(s.KEEP,s.KEEP,s.KEEP),s.clearStencil(0),s.cullFace(s.BACK),s.frontFace(s.CCW),s.polygonOffset(0,0),s.activeTexture(s.TEXTURE0),s.bindFramebuffer(s.FRAMEBUFFER,null),s.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),s.bindFramebuffer(s.READ_FRAMEBUFFER,null),s.useProgram(null),s.lineWidth(1),s.scissor(0,0,s.canvas.width,s.canvas.height),s.viewport(0,0,s.canvas.width,s.canvas.height),u={},K=null,$={},h={},d=new WeakMap,f=[],m=null,g=!1,p=null,A=null,T=null,y=null,v=null,w=null,E=null,C=new be(0,0,0),P=0,x=!1,M=null,I=null,F=null,z=null,G=null,Ve.set(0,0,s.canvas.width,s.canvas.height),Ye.set(0,0,s.canvas.width,s.canvas.height),r.reset(),o.reset(),a.reset()}return{buffers:{color:r,depth:o,stencil:a},enable:X,disable:se,bindFramebuffer:_e,drawBuffers:me,useProgram:Fe,setBlending:st,setMaterial:Le,setFlipSided:Ce,setCullFace:ve,setLineWidth:nt,setPolygonOffset:Ae,setScissorTest:Oe,activeTexture:ht,bindTexture:dt,unbindTexture:b,compressedTexImage2D:_,compressedTexImage3D:O,texImage2D:Se,texImage3D:ne,updateUBOMapping:Te,uniformBlockBinding:ue,texStorage2D:re,texStorage3D:ye,texSubImage2D:Y,texSubImage3D:Z,compressedTexSubImage2D:Q,compressedTexSubImage3D:Ee,scissor:de,viewport:Ie,reset:ze}}function kg(s,e,t,n,i,r,o){const a=e.has("WEBGL_multisampled_render_to_texture")?e.get("WEBGL_multisampled_render_to_texture"):null,c=typeof navigator>"u"?!1:/OculusBrowser/g.test(navigator.userAgent),l=new fe,u=new WeakMap;let h;const d=new WeakMap;let f=!1;try{f=typeof OffscreenCanvas<"u"&&new OffscreenCanvas(1,1).getContext("2d")!==null}catch{}function m(b,_){return f?new OffscreenCanvas(b,_):Rs("canvas")}function g(b,_,O){let Y=1;const Z=dt(b);if((Z.width>O||Z.height>O)&&(Y=O/Math.max(Z.width,Z.height)),Y<1)if(typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement||typeof HTMLCanvasElement<"u"&&b instanceof HTMLCanvasElement||typeof ImageBitmap<"u"&&b instanceof ImageBitmap||typeof VideoFrame<"u"&&b instanceof VideoFrame){const Q=Math.floor(Y*Z.width),Ee=Math.floor(Y*Z.height);h===void 0&&(h=m(Q,Ee));const re=_?m(Q,Ee):h;return re.width=Q,re.height=Ee,re.getContext("2d").drawImage(b,0,0,Q,Ee),console.warn("THREE.WebGLRenderer: Texture has been resized from ("+Z.width+"x"+Z.height+") to ("+Q+"x"+Ee+")."),re}else return"data"in b&&console.warn("THREE.WebGLRenderer: Image in DataTexture is too big ("+Z.width+"x"+Z.height+")."),b;return b}function p(b){return b.generateMipmaps}function A(b){s.generateMipmap(b)}function T(b){return b.isWebGLCubeRenderTarget?s.TEXTURE_CUBE_MAP:b.isWebGL3DRenderTarget?s.TEXTURE_3D:b.isWebGLArrayRenderTarget||b.isCompressedArrayTexture?s.TEXTURE_2D_ARRAY:s.TEXTURE_2D}function y(b,_,O,Y,Z=!1){if(b!==null){if(s[b]!==void 0)return s[b];console.warn("THREE.WebGLRenderer: Attempt to use non-existing WebGL internal format '"+b+"'")}let Q=_;if(_===s.RED&&(O===s.FLOAT&&(Q=s.R32F),O===s.HALF_FLOAT&&(Q=s.R16F),O===s.UNSIGNED_BYTE&&(Q=s.R8)),_===s.RED_INTEGER&&(O===s.UNSIGNED_BYTE&&(Q=s.R8UI),O===s.UNSIGNED_SHORT&&(Q=s.R16UI),O===s.UNSIGNED_INT&&(Q=s.R32UI),O===s.BYTE&&(Q=s.R8I),O===s.SHORT&&(Q=s.R16I),O===s.INT&&(Q=s.R32I)),_===s.RG&&(O===s.FLOAT&&(Q=s.RG32F),O===s.HALF_FLOAT&&(Q=s.RG16F),O===s.UNSIGNED_BYTE&&(Q=s.RG8)),_===s.RG_INTEGER&&(O===s.UNSIGNED_BYTE&&(Q=s.RG8UI),O===s.UNSIGNED_SHORT&&(Q=s.RG16UI),O===s.UNSIGNED_INT&&(Q=s.RG32UI),O===s.BYTE&&(Q=s.RG8I),O===s.SHORT&&(Q=s.RG16I),O===s.INT&&(Q=s.RG32I)),_===s.RGB_INTEGER&&(O===s.UNSIGNED_BYTE&&(Q=s.RGB8UI),O===s.UNSIGNED_SHORT&&(Q=s.RGB16UI),O===s.UNSIGNED_INT&&(Q=s.RGB32UI),O===s.BYTE&&(Q=s.RGB8I),O===s.SHORT&&(Q=s.RGB16I),O===s.INT&&(Q=s.RGB32I)),_===s.RGBA_INTEGER&&(O===s.UNSIGNED_BYTE&&(Q=s.RGBA8UI),O===s.UNSIGNED_SHORT&&(Q=s.RGBA16UI),O===s.UNSIGNED_INT&&(Q=s.RGBA32UI),O===s.BYTE&&(Q=s.RGBA8I),O===s.SHORT&&(Q=s.RGBA16I),O===s.INT&&(Q=s.RGBA32I)),_===s.RGB&&(O===s.UNSIGNED_INT_5_9_9_9_REV&&(Q=s.RGB9_E5),O===s.UNSIGNED_INT_10F_11F_11F_REV&&(Q=s.R11F_G11F_B10F)),_===s.RGBA){const Ee=Z?Sr:je.getTransfer(Y);O===s.FLOAT&&(Q=s.RGBA32F),O===s.HALF_FLOAT&&(Q=s.RGBA16F),O===s.UNSIGNED_BYTE&&(Q=Ee===tt?s.SRGB8_ALPHA8:s.RGBA8),O===s.UNSIGNED_SHORT_4_4_4_4&&(Q=s.RGBA4),O===s.UNSIGNED_SHORT_5_5_5_1&&(Q=s.RGB5_A1)}return(Q===s.R16F||Q===s.R32F||Q===s.RG16F||Q===s.RG32F||Q===s.RGBA16F||Q===s.RGBA32F)&&e.get("EXT_color_buffer_float"),Q}function v(b,_){let O;return b?_===null||_===oi||_===Es?O=s.DEPTH24_STENCIL8:_===en?O=s.DEPTH32F_STENCIL8:_===Ts&&(O=s.DEPTH24_STENCIL8,console.warn("DepthTexture: 16 bit depth attachment is not supported with stencil. Using 24-bit attachment.")):_===null||_===oi||_===Es?O=s.DEPTH_COMPONENT24:_===en?O=s.DEPTH_COMPONENT32F:_===Ts&&(O=s.DEPTH_COMPONENT16),O}function w(b,_){return p(b)===!0||b.isFramebufferTexture&&b.minFilter!==Lt&&b.minFilter!==Nt?Math.log2(Math.max(_.width,_.height))+1:b.mipmaps!==void 0&&b.mipmaps.length>0?b.mipmaps.length:b.isCompressedTexture&&Array.isArray(b.image)?_.mipmaps.length:1}function E(b){const _=b.target;_.removeEventListener("dispose",E),P(_),_.isVideoTexture&&u.delete(_)}function C(b){const _=b.target;_.removeEventListener("dispose",C),M(_)}function P(b){const _=n.get(b);if(_.__webglInit===void 0)return;const O=b.source,Y=d.get(O);if(Y){const Z=Y[_.__cacheKey];Z.usedTimes--,Z.usedTimes===0&&x(b),Object.keys(Y).length===0&&d.delete(O)}n.remove(b)}function x(b){const _=n.get(b);s.deleteTexture(_.__webglTexture);const O=b.source,Y=d.get(O);delete Y[_.__cacheKey],o.memory.textures--}function M(b){const _=n.get(b);if(b.depthTexture&&(b.depthTexture.dispose(),n.remove(b.depthTexture)),b.isWebGLCubeRenderTarget)for(let Y=0;Y<6;Y++){if(Array.isArray(_.__webglFramebuffer[Y]))for(let Z=0;Z<_.__webglFramebuffer[Y].length;Z++)s.deleteFramebuffer(_.__webglFramebuffer[Y][Z]);else s.deleteFramebuffer(_.__webglFramebuffer[Y]);_.__webglDepthbuffer&&s.deleteRenderbuffer(_.__webglDepthbuffer[Y])}else{if(Array.isArray(_.__webglFramebuffer))for(let Y=0;Y<_.__webglFramebuffer.length;Y++)s.deleteFramebuffer(_.__webglFramebuffer[Y]);else s.deleteFramebuffer(_.__webglFramebuffer);if(_.__webglDepthbuffer&&s.deleteRenderbuffer(_.__webglDepthbuffer),_.__webglMultisampledFramebuffer&&s.deleteFramebuffer(_.__webglMultisampledFramebuffer),_.__webglColorRenderbuffer)for(let Y=0;Y<_.__webglColorRenderbuffer.length;Y++)_.__webglColorRenderbuffer[Y]&&s.deleteRenderbuffer(_.__webglColorRenderbuffer[Y]);_.__webglDepthRenderbuffer&&s.deleteRenderbuffer(_.__webglDepthRenderbuffer)}const O=b.textures;for(let Y=0,Z=O.length;Y<Z;Y++){const Q=n.get(O[Y]);Q.__webglTexture&&(s.deleteTexture(Q.__webglTexture),o.memory.textures--),n.remove(O[Y])}n.remove(b)}let I=0;function F(){I=0}function z(){const b=I;return b>=i.maxTextures&&console.warn("THREE.WebGLTextures: Trying to use "+b+" texture units while this GPU supports only "+i.maxTextures),I+=1,b}function G(b){const _=[];return _.push(b.wrapS),_.push(b.wrapT),_.push(b.wrapR||0),_.push(b.magFilter),_.push(b.minFilter),_.push(b.anisotropy),_.push(b.internalFormat),_.push(b.format),_.push(b.type),_.push(b.generateMipmaps),_.push(b.premultiplyAlpha),_.push(b.flipY),_.push(b.unpackAlignment),_.push(b.colorSpace),_.join()}function j(b,_){const O=n.get(b);if(b.isVideoTexture&&Oe(b),b.isRenderTargetTexture===!1&&b.isExternalTexture!==!0&&b.version>0&&O.__version!==b.version){const Y=b.image;if(Y===null)console.warn("THREE.WebGLRenderer: Texture marked for update but no image data found.");else if(Y.complete===!1)console.warn("THREE.WebGLRenderer: Texture marked for update but image is incomplete");else{k(O,b,_);return}}else b.isExternalTexture&&(O.__webglTexture=b.sourceTexture?b.sourceTexture:null);t.bindTexture(s.TEXTURE_2D,O.__webglTexture,s.TEXTURE0+_)}function B(b,_){const O=n.get(b);if(b.isRenderTargetTexture===!1&&b.version>0&&O.__version!==b.version){k(O,b,_);return}t.bindTexture(s.TEXTURE_2D_ARRAY,O.__webglTexture,s.TEXTURE0+_)}function J(b,_){const O=n.get(b);if(b.isRenderTargetTexture===!1&&b.version>0&&O.__version!==b.version){k(O,b,_);return}t.bindTexture(s.TEXTURE_3D,O.__webglTexture,s.TEXTURE0+_)}function W(b,_){const O=n.get(b);if(b.version>0&&O.__version!==b.version){X(O,b,_);return}t.bindTexture(s.TEXTURE_CUBE_MAP,O.__webglTexture,s.TEXTURE0+_)}const K={[ri]:s.REPEAT,[zn]:s.CLAMP_TO_EDGE,[yr]:s.MIRRORED_REPEAT},$={[Lt]:s.NEAREST,[Ll]:s.NEAREST_MIPMAP_NEAREST,[ps]:s.NEAREST_MIPMAP_LINEAR,[Nt]:s.LINEAR,[mr]:s.LINEAR_MIPMAP_NEAREST,[Tn]:s.LINEAR_MIPMAP_LINEAR},le={[Ah]:s.NEVER,[xh]:s.ALWAYS,[ph]:s.LESS,[Gl]:s.LEQUAL,[mh]:s.EQUAL,[_h]:s.GEQUAL,[gh]:s.GREATER,[vh]:s.NOTEQUAL};function De(b,_){if(_.type===en&&e.has("OES_texture_float_linear")===!1&&(_.magFilter===Nt||_.magFilter===mr||_.magFilter===ps||_.magFilter===Tn||_.minFilter===Nt||_.minFilter===mr||_.minFilter===ps||_.minFilter===Tn)&&console.warn("THREE.WebGLRenderer: Unable to use linear filtering with floating point textures. OES_texture_float_linear not supported on this device."),s.texParameteri(b,s.TEXTURE_WRAP_S,K[_.wrapS]),s.texParameteri(b,s.TEXTURE_WRAP_T,K[_.wrapT]),(b===s.TEXTURE_3D||b===s.TEXTURE_2D_ARRAY)&&s.texParameteri(b,s.TEXTURE_WRAP_R,K[_.wrapR]),s.texParameteri(b,s.TEXTURE_MAG_FILTER,$[_.magFilter]),s.texParameteri(b,s.TEXTURE_MIN_FILTER,$[_.minFilter]),_.compareFunction&&(s.texParameteri(b,s.TEXTURE_COMPARE_MODE,s.COMPARE_REF_TO_TEXTURE),s.texParameteri(b,s.TEXTURE_COMPARE_FUNC,le[_.compareFunction])),e.has("EXT_texture_filter_anisotropic")===!0){if(_.magFilter===Lt||_.minFilter!==ps&&_.minFilter!==Tn||_.type===en&&e.has("OES_texture_float_linear")===!1)return;if(_.anisotropy>1||n.get(_).__currentAnisotropy){const O=e.get("EXT_texture_filter_anisotropic");s.texParameterf(b,O.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(_.anisotropy,i.getMaxAnisotropy())),n.get(_).__currentAnisotropy=_.anisotropy}}}function Ve(b,_){let O=!1;b.__webglInit===void 0&&(b.__webglInit=!0,_.addEventListener("dispose",E));const Y=_.source;let Z=d.get(Y);Z===void 0&&(Z={},d.set(Y,Z));const Q=G(_);if(Q!==b.__cacheKey){Z[Q]===void 0&&(Z[Q]={texture:s.createTexture(),usedTimes:0},o.memory.textures++,O=!0),Z[Q].usedTimes++;const Ee=Z[b.__cacheKey];Ee!==void 0&&(Z[b.__cacheKey].usedTimes--,Ee.usedTimes===0&&x(_)),b.__cacheKey=Q,b.__webglTexture=Z[Q].texture}return O}function Ye(b,_,O){return Math.floor(Math.floor(b/O)/_)}function ae(b,_,O,Y){const Q=b.updateRanges;if(Q.length===0)t.texSubImage2D(s.TEXTURE_2D,0,0,0,_.width,_.height,O,Y,_.data);else{Q.sort((ne,de)=>ne.start-de.start);let Ee=0;for(let ne=1;ne<Q.length;ne++){const de=Q[Ee],Ie=Q[ne],Te=de.start+de.count,ue=Ye(Ie.start,_.width,4),ze=Ye(de.start,_.width,4);Ie.start<=Te+1&&ue===ze&&Ye(Ie.start+Ie.count-1,_.width,4)===ue?de.count=Math.max(de.count,Ie.start+Ie.count-de.start):(++Ee,Q[Ee]=Ie)}Q.length=Ee+1;const re=s.getParameter(s.UNPACK_ROW_LENGTH),ye=s.getParameter(s.UNPACK_SKIP_PIXELS),Se=s.getParameter(s.UNPACK_SKIP_ROWS);s.pixelStorei(s.UNPACK_ROW_LENGTH,_.width);for(let ne=0,de=Q.length;ne<de;ne++){const Ie=Q[ne],Te=Math.floor(Ie.start/4),ue=Math.ceil(Ie.count/4),ze=Te%_.width,L=Math.floor(Te/_.width),ie=ue,oe=1;s.pixelStorei(s.UNPACK_SKIP_PIXELS,ze),s.pixelStorei(s.UNPACK_SKIP_ROWS,L),t.texSubImage2D(s.TEXTURE_2D,0,ze,L,ie,oe,O,Y,_.data)}b.clearUpdateRanges(),s.pixelStorei(s.UNPACK_ROW_LENGTH,re),s.pixelStorei(s.UNPACK_SKIP_PIXELS,ye),s.pixelStorei(s.UNPACK_SKIP_ROWS,Se)}}function k(b,_,O){let Y=s.TEXTURE_2D;(_.isDataArrayTexture||_.isCompressedArrayTexture)&&(Y=s.TEXTURE_2D_ARRAY),_.isData3DTexture&&(Y=s.TEXTURE_3D);const Z=Ve(b,_),Q=_.source;t.bindTexture(Y,b.__webglTexture,s.TEXTURE0+O);const Ee=n.get(Q);if(Q.version!==Ee.__version||Z===!0){t.activeTexture(s.TEXTURE0+O);const re=je.getPrimaries(je.workingColorSpace),ye=_.colorSpace===Bn?null:je.getPrimaries(_.colorSpace),Se=_.colorSpace===Bn||re===ye?s.NONE:s.BROWSER_DEFAULT_WEBGL;s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,_.flipY),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,_.premultiplyAlpha),s.pixelStorei(s.UNPACK_ALIGNMENT,_.unpackAlignment),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,Se);let ne=g(_.image,!1,i.maxTextureSize);ne=ht(_,ne);const de=r.convert(_.format,_.colorSpace),Ie=r.convert(_.type);let Te=y(_.internalFormat,de,Ie,_.colorSpace,_.isVideoTexture);De(Y,_);let ue;const ze=_.mipmaps,L=_.isVideoTexture!==!0,ie=Ee.__version===void 0||Z===!0,oe=Q.dataReady,ge=w(_,ne);if(_.isDepthTexture)Te=v(_.format===bs,_.type),ie&&(L?t.texStorage2D(s.TEXTURE_2D,1,Te,ne.width,ne.height):t.texImage2D(s.TEXTURE_2D,0,Te,ne.width,ne.height,0,de,Ie,null));else if(_.isDataTexture)if(ze.length>0){L&&ie&&t.texStorage2D(s.TEXTURE_2D,ge,Te,ze[0].width,ze[0].height);for(let ee=0,q=ze.length;ee<q;ee++)ue=ze[ee],L?oe&&t.texSubImage2D(s.TEXTURE_2D,ee,0,0,ue.width,ue.height,de,Ie,ue.data):t.texImage2D(s.TEXTURE_2D,ee,Te,ue.width,ue.height,0,de,Ie,ue.data);_.generateMipmaps=!1}else L?(ie&&t.texStorage2D(s.TEXTURE_2D,ge,Te,ne.width,ne.height),oe&&ae(_,ne,de,Ie)):t.texImage2D(s.TEXTURE_2D,0,Te,ne.width,ne.height,0,de,Ie,ne.data);else if(_.isCompressedTexture)if(_.isCompressedArrayTexture){L&&ie&&t.texStorage3D(s.TEXTURE_2D_ARRAY,ge,Te,ze[0].width,ze[0].height,ne.depth);for(let ee=0,q=ze.length;ee<q;ee++)if(ue=ze[ee],_.format!==Kt)if(de!==null)if(L){if(oe)if(_.layerUpdates.size>0){const Me=tl(ue.width,ue.height,_.format,_.type);for(const Be of _.layerUpdates){const rt=ue.data.subarray(Be*Me/ue.data.BYTES_PER_ELEMENT,(Be+1)*Me/ue.data.BYTES_PER_ELEMENT);t.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,ee,0,0,Be,ue.width,ue.height,1,de,rt)}_.clearLayerUpdates()}else t.compressedTexSubImage3D(s.TEXTURE_2D_ARRAY,ee,0,0,0,ue.width,ue.height,ne.depth,de,ue.data)}else t.compressedTexImage3D(s.TEXTURE_2D_ARRAY,ee,Te,ue.width,ue.height,ne.depth,0,ue.data,0,0);else console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()");else L?oe&&t.texSubImage3D(s.TEXTURE_2D_ARRAY,ee,0,0,0,ue.width,ue.height,ne.depth,de,Ie,ue.data):t.texImage3D(s.TEXTURE_2D_ARRAY,ee,Te,ue.width,ue.height,ne.depth,0,de,Ie,ue.data)}else{L&&ie&&t.texStorage2D(s.TEXTURE_2D,ge,Te,ze[0].width,ze[0].height);for(let ee=0,q=ze.length;ee<q;ee++)ue=ze[ee],_.format!==Kt?de!==null?L?oe&&t.compressedTexSubImage2D(s.TEXTURE_2D,ee,0,0,ue.width,ue.height,de,ue.data):t.compressedTexImage2D(s.TEXTURE_2D,ee,Te,ue.width,ue.height,0,ue.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .uploadTexture()"):L?oe&&t.texSubImage2D(s.TEXTURE_2D,ee,0,0,ue.width,ue.height,de,Ie,ue.data):t.texImage2D(s.TEXTURE_2D,ee,Te,ue.width,ue.height,0,de,Ie,ue.data)}else if(_.isDataArrayTexture)if(L){if(ie&&t.texStorage3D(s.TEXTURE_2D_ARRAY,ge,Te,ne.width,ne.height,ne.depth),oe)if(_.layerUpdates.size>0){const ee=tl(ne.width,ne.height,_.format,_.type);for(const q of _.layerUpdates){const Me=ne.data.subarray(q*ee/ne.data.BYTES_PER_ELEMENT,(q+1)*ee/ne.data.BYTES_PER_ELEMENT);t.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,q,ne.width,ne.height,1,de,Ie,Me)}_.clearLayerUpdates()}else t.texSubImage3D(s.TEXTURE_2D_ARRAY,0,0,0,0,ne.width,ne.height,ne.depth,de,Ie,ne.data)}else t.texImage3D(s.TEXTURE_2D_ARRAY,0,Te,ne.width,ne.height,ne.depth,0,de,Ie,ne.data);else if(_.isData3DTexture)L?(ie&&t.texStorage3D(s.TEXTURE_3D,ge,Te,ne.width,ne.height,ne.depth),oe&&t.texSubImage3D(s.TEXTURE_3D,0,0,0,0,ne.width,ne.height,ne.depth,de,Ie,ne.data)):t.texImage3D(s.TEXTURE_3D,0,Te,ne.width,ne.height,ne.depth,0,de,Ie,ne.data);else if(_.isFramebufferTexture){if(ie)if(L)t.texStorage2D(s.TEXTURE_2D,ge,Te,ne.width,ne.height);else{let ee=ne.width,q=ne.height;for(let Me=0;Me<ge;Me++)t.texImage2D(s.TEXTURE_2D,Me,Te,ee,q,0,de,Ie,null),ee>>=1,q>>=1}}else if(ze.length>0){if(L&&ie){const ee=dt(ze[0]);t.texStorage2D(s.TEXTURE_2D,ge,Te,ee.width,ee.height)}for(let ee=0,q=ze.length;ee<q;ee++)ue=ze[ee],L?oe&&t.texSubImage2D(s.TEXTURE_2D,ee,0,0,de,Ie,ue):t.texImage2D(s.TEXTURE_2D,ee,Te,de,Ie,ue);_.generateMipmaps=!1}else if(L){if(ie){const ee=dt(ne);t.texStorage2D(s.TEXTURE_2D,ge,Te,ee.width,ee.height)}oe&&t.texSubImage2D(s.TEXTURE_2D,0,0,0,de,Ie,ne)}else t.texImage2D(s.TEXTURE_2D,0,Te,de,Ie,ne);p(_)&&A(Y),Ee.__version=Q.version,_.onUpdate&&_.onUpdate(_)}b.__version=_.version}function X(b,_,O){if(_.image.length!==6)return;const Y=Ve(b,_),Z=_.source;t.bindTexture(s.TEXTURE_CUBE_MAP,b.__webglTexture,s.TEXTURE0+O);const Q=n.get(Z);if(Z.version!==Q.__version||Y===!0){t.activeTexture(s.TEXTURE0+O);const Ee=je.getPrimaries(je.workingColorSpace),re=_.colorSpace===Bn?null:je.getPrimaries(_.colorSpace),ye=_.colorSpace===Bn||Ee===re?s.NONE:s.BROWSER_DEFAULT_WEBGL;s.pixelStorei(s.UNPACK_FLIP_Y_WEBGL,_.flipY),s.pixelStorei(s.UNPACK_PREMULTIPLY_ALPHA_WEBGL,_.premultiplyAlpha),s.pixelStorei(s.UNPACK_ALIGNMENT,_.unpackAlignment),s.pixelStorei(s.UNPACK_COLORSPACE_CONVERSION_WEBGL,ye);const Se=_.isCompressedTexture||_.image[0].isCompressedTexture,ne=_.image[0]&&_.image[0].isDataTexture,de=[];for(let q=0;q<6;q++)!Se&&!ne?de[q]=g(_.image[q],!0,i.maxCubemapSize):de[q]=ne?_.image[q].image:_.image[q],de[q]=ht(_,de[q]);const Ie=de[0],Te=r.convert(_.format,_.colorSpace),ue=r.convert(_.type),ze=y(_.internalFormat,Te,ue,_.colorSpace),L=_.isVideoTexture!==!0,ie=Q.__version===void 0||Y===!0,oe=Z.dataReady;let ge=w(_,Ie);De(s.TEXTURE_CUBE_MAP,_);let ee;if(Se){L&&ie&&t.texStorage2D(s.TEXTURE_CUBE_MAP,ge,ze,Ie.width,Ie.height);for(let q=0;q<6;q++){ee=de[q].mipmaps;for(let Me=0;Me<ee.length;Me++){const Be=ee[Me];_.format!==Kt?Te!==null?L?oe&&t.compressedTexSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,Me,0,0,Be.width,Be.height,Te,Be.data):t.compressedTexImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,Me,ze,Be.width,Be.height,0,Be.data):console.warn("THREE.WebGLRenderer: Attempt to load unsupported compressed texture format in .setTextureCube()"):L?oe&&t.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,Me,0,0,Be.width,Be.height,Te,ue,Be.data):t.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,Me,ze,Be.width,Be.height,0,Te,ue,Be.data)}}}else{if(ee=_.mipmaps,L&&ie){ee.length>0&&ge++;const q=dt(de[0]);t.texStorage2D(s.TEXTURE_CUBE_MAP,ge,ze,q.width,q.height)}for(let q=0;q<6;q++)if(ne){L?oe&&t.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,0,0,0,de[q].width,de[q].height,Te,ue,de[q].data):t.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,0,ze,de[q].width,de[q].height,0,Te,ue,de[q].data);for(let Me=0;Me<ee.length;Me++){const rt=ee[Me].image[q].image;L?oe&&t.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,Me+1,0,0,rt.width,rt.height,Te,ue,rt.data):t.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,Me+1,ze,rt.width,rt.height,0,Te,ue,rt.data)}}else{L?oe&&t.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,0,0,0,Te,ue,de[q]):t.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,0,ze,Te,ue,de[q]);for(let Me=0;Me<ee.length;Me++){const Be=ee[Me];L?oe&&t.texSubImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,Me+1,0,0,Te,ue,Be.image[q]):t.texImage2D(s.TEXTURE_CUBE_MAP_POSITIVE_X+q,Me+1,ze,Te,ue,Be.image[q])}}}p(_)&&A(s.TEXTURE_CUBE_MAP),Q.__version=Z.version,_.onUpdate&&_.onUpdate(_)}b.__version=_.version}function se(b,_,O,Y,Z,Q){const Ee=r.convert(O.format,O.colorSpace),re=r.convert(O.type),ye=y(O.internalFormat,Ee,re,O.colorSpace),Se=n.get(_),ne=n.get(O);if(ne.__renderTarget=_,!Se.__hasExternalTextures){const de=Math.max(1,_.width>>Q),Ie=Math.max(1,_.height>>Q);Z===s.TEXTURE_3D||Z===s.TEXTURE_2D_ARRAY?t.texImage3D(Z,Q,ye,de,Ie,_.depth,0,Ee,re,null):t.texImage2D(Z,Q,ye,de,Ie,0,Ee,re,null)}t.bindFramebuffer(s.FRAMEBUFFER,b),Ae(_)?a.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,Y,Z,ne.__webglTexture,0,nt(_)):(Z===s.TEXTURE_2D||Z>=s.TEXTURE_CUBE_MAP_POSITIVE_X&&Z<=s.TEXTURE_CUBE_MAP_NEGATIVE_Z)&&s.framebufferTexture2D(s.FRAMEBUFFER,Y,Z,ne.__webglTexture,Q),t.bindFramebuffer(s.FRAMEBUFFER,null)}function _e(b,_,O){if(s.bindRenderbuffer(s.RENDERBUFFER,b),_.depthBuffer){const Y=_.depthTexture,Z=Y&&Y.isDepthTexture?Y.type:null,Q=v(_.stencilBuffer,Z),Ee=_.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,re=nt(_);Ae(_)?a.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,re,Q,_.width,_.height):O?s.renderbufferStorageMultisample(s.RENDERBUFFER,re,Q,_.width,_.height):s.renderbufferStorage(s.RENDERBUFFER,Q,_.width,_.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,Ee,s.RENDERBUFFER,b)}else{const Y=_.textures;for(let Z=0;Z<Y.length;Z++){const Q=Y[Z],Ee=r.convert(Q.format,Q.colorSpace),re=r.convert(Q.type),ye=y(Q.internalFormat,Ee,re,Q.colorSpace),Se=nt(_);O&&Ae(_)===!1?s.renderbufferStorageMultisample(s.RENDERBUFFER,Se,ye,_.width,_.height):Ae(_)?a.renderbufferStorageMultisampleEXT(s.RENDERBUFFER,Se,ye,_.width,_.height):s.renderbufferStorage(s.RENDERBUFFER,ye,_.width,_.height)}}s.bindRenderbuffer(s.RENDERBUFFER,null)}function me(b,_){if(_&&_.isWebGLCubeRenderTarget)throw new Error("Depth Texture with cube render targets is not supported");if(t.bindFramebuffer(s.FRAMEBUFFER,b),!(_.depthTexture&&_.depthTexture.isDepthTexture))throw new Error("renderTarget.depthTexture must be an instance of THREE.DepthTexture");const Y=n.get(_.depthTexture);Y.__renderTarget=_,(!Y.__webglTexture||_.depthTexture.image.width!==_.width||_.depthTexture.image.height!==_.height)&&(_.depthTexture.image.width=_.width,_.depthTexture.image.height=_.height,_.depthTexture.needsUpdate=!0),j(_.depthTexture,0);const Z=Y.__webglTexture,Q=nt(_);if(_.depthTexture.format===ws)Ae(_)?a.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.TEXTURE_2D,Z,0,Q):s.framebufferTexture2D(s.FRAMEBUFFER,s.DEPTH_ATTACHMENT,s.TEXTURE_2D,Z,0);else if(_.depthTexture.format===bs)Ae(_)?a.framebufferTexture2DMultisampleEXT(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.TEXTURE_2D,Z,0,Q):s.framebufferTexture2D(s.FRAMEBUFFER,s.DEPTH_STENCIL_ATTACHMENT,s.TEXTURE_2D,Z,0);else throw new Error("Unknown depthTexture format")}function Fe(b){const _=n.get(b),O=b.isWebGLCubeRenderTarget===!0;if(_.__boundDepthTexture!==b.depthTexture){const Y=b.depthTexture;if(_.__depthDisposeCallback&&_.__depthDisposeCallback(),Y){const Z=()=>{delete _.__boundDepthTexture,delete _.__depthDisposeCallback,Y.removeEventListener("dispose",Z)};Y.addEventListener("dispose",Z),_.__depthDisposeCallback=Z}_.__boundDepthTexture=Y}if(b.depthTexture&&!_.__autoAllocateDepthBuffer){if(O)throw new Error("target.depthTexture not supported in Cube render targets");const Y=b.texture.mipmaps;Y&&Y.length>0?me(_.__webglFramebuffer[0],b):me(_.__webglFramebuffer,b)}else if(O){_.__webglDepthbuffer=[];for(let Y=0;Y<6;Y++)if(t.bindFramebuffer(s.FRAMEBUFFER,_.__webglFramebuffer[Y]),_.__webglDepthbuffer[Y]===void 0)_.__webglDepthbuffer[Y]=s.createRenderbuffer(),_e(_.__webglDepthbuffer[Y],b,!1);else{const Z=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Q=_.__webglDepthbuffer[Y];s.bindRenderbuffer(s.RENDERBUFFER,Q),s.framebufferRenderbuffer(s.FRAMEBUFFER,Z,s.RENDERBUFFER,Q)}}else{const Y=b.texture.mipmaps;if(Y&&Y.length>0?t.bindFramebuffer(s.FRAMEBUFFER,_.__webglFramebuffer[0]):t.bindFramebuffer(s.FRAMEBUFFER,_.__webglFramebuffer),_.__webglDepthbuffer===void 0)_.__webglDepthbuffer=s.createRenderbuffer(),_e(_.__webglDepthbuffer,b,!1);else{const Z=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Q=_.__webglDepthbuffer;s.bindRenderbuffer(s.RENDERBUFFER,Q),s.framebufferRenderbuffer(s.FRAMEBUFFER,Z,s.RENDERBUFFER,Q)}}t.bindFramebuffer(s.FRAMEBUFFER,null)}function mt(b,_,O){const Y=n.get(b);_!==void 0&&se(Y.__webglFramebuffer,b,b.texture,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,0),O!==void 0&&Fe(b)}function D(b){const _=b.texture,O=n.get(b),Y=n.get(_);b.addEventListener("dispose",C);const Z=b.textures,Q=b.isWebGLCubeRenderTarget===!0,Ee=Z.length>1;if(Ee||(Y.__webglTexture===void 0&&(Y.__webglTexture=s.createTexture()),Y.__version=_.version,o.memory.textures++),Q){O.__webglFramebuffer=[];for(let re=0;re<6;re++)if(_.mipmaps&&_.mipmaps.length>0){O.__webglFramebuffer[re]=[];for(let ye=0;ye<_.mipmaps.length;ye++)O.__webglFramebuffer[re][ye]=s.createFramebuffer()}else O.__webglFramebuffer[re]=s.createFramebuffer()}else{if(_.mipmaps&&_.mipmaps.length>0){O.__webglFramebuffer=[];for(let re=0;re<_.mipmaps.length;re++)O.__webglFramebuffer[re]=s.createFramebuffer()}else O.__webglFramebuffer=s.createFramebuffer();if(Ee)for(let re=0,ye=Z.length;re<ye;re++){const Se=n.get(Z[re]);Se.__webglTexture===void 0&&(Se.__webglTexture=s.createTexture(),o.memory.textures++)}if(b.samples>0&&Ae(b)===!1){O.__webglMultisampledFramebuffer=s.createFramebuffer(),O.__webglColorRenderbuffer=[],t.bindFramebuffer(s.FRAMEBUFFER,O.__webglMultisampledFramebuffer);for(let re=0;re<Z.length;re++){const ye=Z[re];O.__webglColorRenderbuffer[re]=s.createRenderbuffer(),s.bindRenderbuffer(s.RENDERBUFFER,O.__webglColorRenderbuffer[re]);const Se=r.convert(ye.format,ye.colorSpace),ne=r.convert(ye.type),de=y(ye.internalFormat,Se,ne,ye.colorSpace,b.isXRRenderTarget===!0),Ie=nt(b);s.renderbufferStorageMultisample(s.RENDERBUFFER,Ie,de,b.width,b.height),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+re,s.RENDERBUFFER,O.__webglColorRenderbuffer[re])}s.bindRenderbuffer(s.RENDERBUFFER,null),b.depthBuffer&&(O.__webglDepthRenderbuffer=s.createRenderbuffer(),_e(O.__webglDepthRenderbuffer,b,!0)),t.bindFramebuffer(s.FRAMEBUFFER,null)}}if(Q){t.bindTexture(s.TEXTURE_CUBE_MAP,Y.__webglTexture),De(s.TEXTURE_CUBE_MAP,_);for(let re=0;re<6;re++)if(_.mipmaps&&_.mipmaps.length>0)for(let ye=0;ye<_.mipmaps.length;ye++)se(O.__webglFramebuffer[re][ye],b,_,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+re,ye);else se(O.__webglFramebuffer[re],b,_,s.COLOR_ATTACHMENT0,s.TEXTURE_CUBE_MAP_POSITIVE_X+re,0);p(_)&&A(s.TEXTURE_CUBE_MAP),t.unbindTexture()}else if(Ee){for(let re=0,ye=Z.length;re<ye;re++){const Se=Z[re],ne=n.get(Se);let de=s.TEXTURE_2D;(b.isWebGL3DRenderTarget||b.isWebGLArrayRenderTarget)&&(de=b.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),t.bindTexture(de,ne.__webglTexture),De(de,Se),se(O.__webglFramebuffer,b,Se,s.COLOR_ATTACHMENT0+re,de,0),p(Se)&&A(de)}t.unbindTexture()}else{let re=s.TEXTURE_2D;if((b.isWebGL3DRenderTarget||b.isWebGLArrayRenderTarget)&&(re=b.isWebGL3DRenderTarget?s.TEXTURE_3D:s.TEXTURE_2D_ARRAY),t.bindTexture(re,Y.__webglTexture),De(re,_),_.mipmaps&&_.mipmaps.length>0)for(let ye=0;ye<_.mipmaps.length;ye++)se(O.__webglFramebuffer[ye],b,_,s.COLOR_ATTACHMENT0,re,ye);else se(O.__webglFramebuffer,b,_,s.COLOR_ATTACHMENT0,re,0);p(_)&&A(re),t.unbindTexture()}b.depthBuffer&&Fe(b)}function st(b){const _=b.textures;for(let O=0,Y=_.length;O<Y;O++){const Z=_[O];if(p(Z)){const Q=T(b),Ee=n.get(Z).__webglTexture;t.bindTexture(Q,Ee),A(Q),t.unbindTexture()}}}const Le=[],Ce=[];function ve(b){if(b.samples>0){if(Ae(b)===!1){const _=b.textures,O=b.width,Y=b.height;let Z=s.COLOR_BUFFER_BIT;const Q=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT,Ee=n.get(b),re=_.length>1;if(re)for(let Se=0;Se<_.length;Se++)t.bindFramebuffer(s.FRAMEBUFFER,Ee.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+Se,s.RENDERBUFFER,null),t.bindFramebuffer(s.FRAMEBUFFER,Ee.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+Se,s.TEXTURE_2D,null,0);t.bindFramebuffer(s.READ_FRAMEBUFFER,Ee.__webglMultisampledFramebuffer);const ye=b.texture.mipmaps;ye&&ye.length>0?t.bindFramebuffer(s.DRAW_FRAMEBUFFER,Ee.__webglFramebuffer[0]):t.bindFramebuffer(s.DRAW_FRAMEBUFFER,Ee.__webglFramebuffer);for(let Se=0;Se<_.length;Se++){if(b.resolveDepthBuffer&&(b.depthBuffer&&(Z|=s.DEPTH_BUFFER_BIT),b.stencilBuffer&&b.resolveStencilBuffer&&(Z|=s.STENCIL_BUFFER_BIT)),re){s.framebufferRenderbuffer(s.READ_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.RENDERBUFFER,Ee.__webglColorRenderbuffer[Se]);const ne=n.get(_[Se]).__webglTexture;s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,ne,0)}s.blitFramebuffer(0,0,O,Y,0,0,O,Y,Z,s.NEAREST),c===!0&&(Le.length=0,Ce.length=0,Le.push(s.COLOR_ATTACHMENT0+Se),b.depthBuffer&&b.resolveDepthBuffer===!1&&(Le.push(Q),Ce.push(Q),s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,Ce)),s.invalidateFramebuffer(s.READ_FRAMEBUFFER,Le))}if(t.bindFramebuffer(s.READ_FRAMEBUFFER,null),t.bindFramebuffer(s.DRAW_FRAMEBUFFER,null),re)for(let Se=0;Se<_.length;Se++){t.bindFramebuffer(s.FRAMEBUFFER,Ee.__webglMultisampledFramebuffer),s.framebufferRenderbuffer(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0+Se,s.RENDERBUFFER,Ee.__webglColorRenderbuffer[Se]);const ne=n.get(_[Se]).__webglTexture;t.bindFramebuffer(s.FRAMEBUFFER,Ee.__webglFramebuffer),s.framebufferTexture2D(s.DRAW_FRAMEBUFFER,s.COLOR_ATTACHMENT0+Se,s.TEXTURE_2D,ne,0)}t.bindFramebuffer(s.DRAW_FRAMEBUFFER,Ee.__webglMultisampledFramebuffer)}else if(b.depthBuffer&&b.resolveDepthBuffer===!1&&c){const _=b.stencilBuffer?s.DEPTH_STENCIL_ATTACHMENT:s.DEPTH_ATTACHMENT;s.invalidateFramebuffer(s.DRAW_FRAMEBUFFER,[_])}}}function nt(b){return Math.min(i.maxSamples,b.samples)}function Ae(b){const _=n.get(b);return b.samples>0&&e.has("WEBGL_multisampled_render_to_texture")===!0&&_.__useRenderToTexture!==!1}function Oe(b){const _=o.render.frame;u.get(b)!==_&&(u.set(b,_),b.update())}function ht(b,_){const O=b.colorSpace,Y=b.format,Z=b.type;return b.isCompressedTexture===!0||b.isVideoTexture===!0||O!==bt&&O!==Bn&&(je.getTransfer(O)===tt?(Y!==Kt||Z!==dn)&&console.warn("THREE.WebGLTextures: sRGB encoded textures have to use RGBAFormat and UnsignedByteType."):console.error("THREE.WebGLTextures: Unsupported texture color space:",O)),_}function dt(b){return typeof HTMLImageElement<"u"&&b instanceof HTMLImageElement?(l.width=b.naturalWidth||b.width,l.height=b.naturalHeight||b.height):typeof VideoFrame<"u"&&b instanceof VideoFrame?(l.width=b.displayWidth,l.height=b.displayHeight):(l.width=b.width,l.height=b.height),l}this.allocateTextureUnit=z,this.resetTextureUnits=F,this.setTexture2D=j,this.setTexture2DArray=B,this.setTexture3D=J,this.setTextureCube=W,this.rebindTextures=mt,this.setupRenderTarget=D,this.updateRenderTargetMipmap=st,this.updateMultisampleRenderTarget=ve,this.setupDepthRenderbuffer=Fe,this.setupFrameBufferTexture=se,this.useMultisampledRTT=Ae}function Hg(s,e){function t(n,i=Bn){let r;const o=je.getTransfer(i);if(n===dn)return s.UNSIGNED_BYTE;if(n===Ea)return s.UNSIGNED_SHORT_4_4_4_4;if(n===wa)return s.UNSIGNED_SHORT_5_5_5_1;if(n===Fl)return s.UNSIGNED_INT_5_9_9_9_REV;if(n===Ol)return s.UNSIGNED_INT_10F_11F_11F_REV;if(n===Ul)return s.BYTE;if(n===Nl)return s.SHORT;if(n===Ts)return s.UNSIGNED_SHORT;if(n===Ta)return s.INT;if(n===oi)return s.UNSIGNED_INT;if(n===en)return s.FLOAT;if(n===Us)return s.HALF_FLOAT;if(n===Bl)return s.ALPHA;if(n===zl)return s.RGB;if(n===Kt)return s.RGBA;if(n===ws)return s.DEPTH_COMPONENT;if(n===bs)return s.DEPTH_STENCIL;if(n===ba)return s.RED;if(n===Ca)return s.RED_INTEGER;if(n===kl)return s.RG;if(n===Pa)return s.RG_INTEGER;if(n===Ra)return s.RGBA_INTEGER;if(n===gr||n===vr||n===_r||n===xr)if(o===tt)if(r=e.get("WEBGL_compressed_texture_s3tc_srgb"),r!==null){if(n===gr)return r.COMPRESSED_SRGB_S3TC_DXT1_EXT;if(n===vr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT1_EXT;if(n===_r)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT3_EXT;if(n===xr)return r.COMPRESSED_SRGB_ALPHA_S3TC_DXT5_EXT}else return null;else if(r=e.get("WEBGL_compressed_texture_s3tc"),r!==null){if(n===gr)return r.COMPRESSED_RGB_S3TC_DXT1_EXT;if(n===vr)return r.COMPRESSED_RGBA_S3TC_DXT1_EXT;if(n===_r)return r.COMPRESSED_RGBA_S3TC_DXT3_EXT;if(n===xr)return r.COMPRESSED_RGBA_S3TC_DXT5_EXT}else return null;if(n===zo||n===ko||n===Ho||n===Go)if(r=e.get("WEBGL_compressed_texture_pvrtc"),r!==null){if(n===zo)return r.COMPRESSED_RGB_PVRTC_4BPPV1_IMG;if(n===ko)return r.COMPRESSED_RGB_PVRTC_2BPPV1_IMG;if(n===Ho)return r.COMPRESSED_RGBA_PVRTC_4BPPV1_IMG;if(n===Go)return r.COMPRESSED_RGBA_PVRTC_2BPPV1_IMG}else return null;if(n===Vo||n===Wo||n===Xo)if(r=e.get("WEBGL_compressed_texture_etc"),r!==null){if(n===Vo||n===Wo)return o===tt?r.COMPRESSED_SRGB8_ETC2:r.COMPRESSED_RGB8_ETC2;if(n===Xo)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ETC2_EAC:r.COMPRESSED_RGBA8_ETC2_EAC}else return null;if(n===jo||n===Qo||n===Ko||n===Yo||n===qo||n===Jo||n===Zo||n===$o||n===ea||n===ta||n===na||n===ia||n===sa||n===ra)if(r=e.get("WEBGL_compressed_texture_astc"),r!==null){if(n===jo)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_4x4_KHR:r.COMPRESSED_RGBA_ASTC_4x4_KHR;if(n===Qo)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x4_KHR:r.COMPRESSED_RGBA_ASTC_5x4_KHR;if(n===Ko)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_5x5_KHR:r.COMPRESSED_RGBA_ASTC_5x5_KHR;if(n===Yo)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x5_KHR:r.COMPRESSED_RGBA_ASTC_6x5_KHR;if(n===qo)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_6x6_KHR:r.COMPRESSED_RGBA_ASTC_6x6_KHR;if(n===Jo)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x5_KHR:r.COMPRESSED_RGBA_ASTC_8x5_KHR;if(n===Zo)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x6_KHR:r.COMPRESSED_RGBA_ASTC_8x6_KHR;if(n===$o)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_8x8_KHR:r.COMPRESSED_RGBA_ASTC_8x8_KHR;if(n===ea)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x5_KHR:r.COMPRESSED_RGBA_ASTC_10x5_KHR;if(n===ta)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x6_KHR:r.COMPRESSED_RGBA_ASTC_10x6_KHR;if(n===na)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x8_KHR:r.COMPRESSED_RGBA_ASTC_10x8_KHR;if(n===ia)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_10x10_KHR:r.COMPRESSED_RGBA_ASTC_10x10_KHR;if(n===sa)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x10_KHR:r.COMPRESSED_RGBA_ASTC_12x10_KHR;if(n===ra)return o===tt?r.COMPRESSED_SRGB8_ALPHA8_ASTC_12x12_KHR:r.COMPRESSED_RGBA_ASTC_12x12_KHR}else return null;if(n===oa||n===aa||n===ca)if(r=e.get("EXT_texture_compression_bptc"),r!==null){if(n===oa)return o===tt?r.COMPRESSED_SRGB_ALPHA_BPTC_UNORM_EXT:r.COMPRESSED_RGBA_BPTC_UNORM_EXT;if(n===aa)return r.COMPRESSED_RGB_BPTC_SIGNED_FLOAT_EXT;if(n===ca)return r.COMPRESSED_RGB_BPTC_UNSIGNED_FLOAT_EXT}else return null;if(n===la||n===ua||n===ha||n===da)if(r=e.get("EXT_texture_compression_rgtc"),r!==null){if(n===la)return r.COMPRESSED_RED_RGTC1_EXT;if(n===ua)return r.COMPRESSED_SIGNED_RED_RGTC1_EXT;if(n===ha)return r.COMPRESSED_RED_GREEN_RGTC2_EXT;if(n===da)return r.COMPRESSED_SIGNED_RED_GREEN_RGTC2_EXT}else return null;return n===Es?s.UNSIGNED_INT_24_8:s[n]!==void 0?s[n]:null}return{convert:t}}const Gg=`
void main() {

	gl_Position = vec4( position, 1.0 );

}`,Vg=`
uniform sampler2DArray depthColor;
uniform float depthWidth;
uniform float depthHeight;

void main() {

	vec2 coord = vec2( gl_FragCoord.x / depthWidth, gl_FragCoord.y / depthHeight );

	if ( coord.x >= 1.0 ) {

		gl_FragDepth = texture( depthColor, vec3( coord.x - 1.0, coord.y, 1 ) ).r;

	} else {

		gl_FragDepth = texture( depthColor, vec3( coord.x, coord.y, 0 ) ).r;

	}

}`;class Wg{constructor(){this.texture=null,this.mesh=null,this.depthNear=0,this.depthFar=0}init(e,t){if(this.texture===null){const n=new cu(e.texture);(e.depthNear!==t.depthNear||e.depthFar!==t.depthFar)&&(this.depthNear=e.depthNear,this.depthFar=e.depthFar),this.texture=n}}getMesh(e){if(this.texture!==null&&this.mesh===null){const t=e.cameras[0].viewport,n=new Vn({vertexShader:Gg,fragmentShader:Vg,uniforms:{depthColor:{value:this.texture},depthWidth:{value:t.z},depthHeight:{value:t.w}}});this.mesh=new Qe(new Rn(20,20),n)}return this.mesh}reset(){this.texture=null,this.mesh=null}getDepthTexture(){return this.texture}}class Xg extends qi{constructor(e,t){super();const n=this;let i=null,r=1,o=null,a="local-floor",c=1,l=null,u=null,h=null,d=null,f=null,m=null;const g=typeof XRWebGLBinding<"u",p=new Wg,A={},T=t.getContextAttributes();let y=null,v=null;const w=[],E=[],C=new fe;let P=null;const x=new Dt;x.viewport=new qe;const M=new Dt;M.viewport=new qe;const I=[x,M],F=new nf;let z=null,G=null;this.cameraAutoUpdate=!0,this.enabled=!1,this.isPresenting=!1,this.getController=function(k){let X=w[k];return X===void 0&&(X=new io,w[k]=X),X.getTargetRaySpace()},this.getControllerGrip=function(k){let X=w[k];return X===void 0&&(X=new io,w[k]=X),X.getGripSpace()},this.getHand=function(k){let X=w[k];return X===void 0&&(X=new io,w[k]=X),X.getHandSpace()};function j(k){const X=E.indexOf(k.inputSource);if(X===-1)return;const se=w[X];se!==void 0&&(se.update(k.inputSource,k.frame,l||o),se.dispatchEvent({type:k.type,data:k.inputSource}))}function B(){i.removeEventListener("select",j),i.removeEventListener("selectstart",j),i.removeEventListener("selectend",j),i.removeEventListener("squeeze",j),i.removeEventListener("squeezestart",j),i.removeEventListener("squeezeend",j),i.removeEventListener("end",B),i.removeEventListener("inputsourceschange",J);for(let k=0;k<w.length;k++){const X=E[k];X!==null&&(E[k]=null,w[k].disconnect(X))}z=null,G=null,p.reset();for(const k in A)delete A[k];e.setRenderTarget(y),f=null,d=null,h=null,i=null,v=null,ae.stop(),n.isPresenting=!1,e.setPixelRatio(P),e.setSize(C.width,C.height,!1),n.dispatchEvent({type:"sessionend"})}this.setFramebufferScaleFactor=function(k){r=k,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change framebuffer scale while presenting.")},this.setReferenceSpaceType=function(k){a=k,n.isPresenting===!0&&console.warn("THREE.WebXRManager: Cannot change reference space type while presenting.")},this.getReferenceSpace=function(){return l||o},this.setReferenceSpace=function(k){l=k},this.getBaseLayer=function(){return d!==null?d:f},this.getBinding=function(){return h===null&&g&&(h=new XRWebGLBinding(i,t)),h},this.getFrame=function(){return m},this.getSession=function(){return i},this.setSession=async function(k){if(i=k,i!==null){if(y=e.getRenderTarget(),i.addEventListener("select",j),i.addEventListener("selectstart",j),i.addEventListener("selectend",j),i.addEventListener("squeeze",j),i.addEventListener("squeezestart",j),i.addEventListener("squeezeend",j),i.addEventListener("end",B),i.addEventListener("inputsourceschange",J),T.xrCompatible!==!0&&await t.makeXRCompatible(),P=e.getPixelRatio(),e.getSize(C),g&&"createProjectionLayer"in XRWebGLBinding.prototype){let se=null,_e=null,me=null;T.depth&&(me=T.stencil?t.DEPTH24_STENCIL8:t.DEPTH_COMPONENT24,se=T.stencil?bs:ws,_e=T.stencil?Es:oi);const Fe={colorFormat:t.RGBA8,depthFormat:me,scaleFactor:r};h=this.getBinding(),d=h.createProjectionLayer(Fe),i.updateRenderState({layers:[d]}),e.setPixelRatio(1),e.setSize(d.textureWidth,d.textureHeight,!1),v=new Gn(d.textureWidth,d.textureHeight,{format:Kt,type:dn,depthTexture:new au(d.textureWidth,d.textureHeight,_e,void 0,void 0,void 0,void 0,void 0,void 0,se),stencilBuffer:T.stencil,colorSpace:e.outputColorSpace,samples:T.antialias?4:0,resolveDepthBuffer:d.ignoreDepthValues===!1,resolveStencilBuffer:d.ignoreDepthValues===!1})}else{const se={antialias:T.antialias,alpha:!0,depth:T.depth,stencil:T.stencil,framebufferScaleFactor:r};f=new XRWebGLLayer(i,t,se),i.updateRenderState({baseLayer:f}),e.setPixelRatio(1),e.setSize(f.framebufferWidth,f.framebufferHeight,!1),v=new Gn(f.framebufferWidth,f.framebufferHeight,{format:Kt,type:dn,colorSpace:e.outputColorSpace,stencilBuffer:T.stencil,resolveDepthBuffer:f.ignoreDepthValues===!1,resolveStencilBuffer:f.ignoreDepthValues===!1})}v.isXRRenderTarget=!0,this.setFoveation(c),l=null,o=await i.requestReferenceSpace(a),ae.setContext(i),ae.start(),n.isPresenting=!0,n.dispatchEvent({type:"sessionstart"})}},this.getEnvironmentBlendMode=function(){if(i!==null)return i.environmentBlendMode},this.getDepthTexture=function(){return p.getDepthTexture()};function J(k){for(let X=0;X<k.removed.length;X++){const se=k.removed[X],_e=E.indexOf(se);_e>=0&&(E[_e]=null,w[_e].disconnect(se))}for(let X=0;X<k.added.length;X++){const se=k.added[X];let _e=E.indexOf(se);if(_e===-1){for(let Fe=0;Fe<w.length;Fe++)if(Fe>=E.length){E.push(se),_e=Fe;break}else if(E[Fe]===null){E[Fe]=se,_e=Fe;break}if(_e===-1)break}const me=w[_e];me&&me.connect(se)}}const W=new R,K=new R;function $(k,X,se){W.setFromMatrixPosition(X.matrixWorld),K.setFromMatrixPosition(se.matrixWorld);const _e=W.distanceTo(K),me=X.projectionMatrix.elements,Fe=se.projectionMatrix.elements,mt=me[14]/(me[10]-1),D=me[14]/(me[10]+1),st=(me[9]+1)/me[5],Le=(me[9]-1)/me[5],Ce=(me[8]-1)/me[0],ve=(Fe[8]+1)/Fe[0],nt=mt*Ce,Ae=mt*ve,Oe=_e/(-Ce+ve),ht=Oe*-Ce;if(X.matrixWorld.decompose(k.position,k.quaternion,k.scale),k.translateX(ht),k.translateZ(Oe),k.matrixWorld.compose(k.position,k.quaternion,k.scale),k.matrixWorldInverse.copy(k.matrixWorld).invert(),me[10]===-1)k.projectionMatrix.copy(X.projectionMatrix),k.projectionMatrixInverse.copy(X.projectionMatrixInverse);else{const dt=mt+Oe,b=D+Oe,_=nt-ht,O=Ae+(_e-ht),Y=st*D/b*dt,Z=Le*D/b*dt;k.projectionMatrix.makePerspective(_,O,Y,Z,dt,b),k.projectionMatrixInverse.copy(k.projectionMatrix).invert()}}function le(k,X){X===null?k.matrixWorld.copy(k.matrix):k.matrixWorld.multiplyMatrices(X.matrixWorld,k.matrix),k.matrixWorldInverse.copy(k.matrixWorld).invert()}this.updateCamera=function(k){if(i===null)return;let X=k.near,se=k.far;p.texture!==null&&(p.depthNear>0&&(X=p.depthNear),p.depthFar>0&&(se=p.depthFar)),F.near=M.near=x.near=X,F.far=M.far=x.far=se,(z!==F.near||G!==F.far)&&(i.updateRenderState({depthNear:F.near,depthFar:F.far}),z=F.near,G=F.far),F.layers.mask=k.layers.mask|6,x.layers.mask=F.layers.mask&3,M.layers.mask=F.layers.mask&5;const _e=k.parent,me=F.cameras;le(F,_e);for(let Fe=0;Fe<me.length;Fe++)le(me[Fe],_e);me.length===2?$(F,x,M):F.projectionMatrix.copy(x.projectionMatrix),De(k,F,_e)};function De(k,X,se){se===null?k.matrix.copy(X.matrixWorld):(k.matrix.copy(se.matrixWorld),k.matrix.invert(),k.matrix.multiply(X.matrixWorld)),k.matrix.decompose(k.position,k.quaternion,k.scale),k.updateMatrixWorld(!0),k.projectionMatrix.copy(X.projectionMatrix),k.projectionMatrixInverse.copy(X.projectionMatrixInverse),k.isPerspectiveCamera&&(k.fov=Gi*2*Math.atan(1/k.projectionMatrix.elements[5]),k.zoom=1)}this.getCamera=function(){return F},this.getFoveation=function(){if(!(d===null&&f===null))return c},this.setFoveation=function(k){c=k,d!==null&&(d.fixedFoveation=k),f!==null&&f.fixedFoveation!==void 0&&(f.fixedFoveation=k)},this.hasDepthSensing=function(){return p.texture!==null},this.getDepthSensingMesh=function(){return p.getMesh(F)},this.getCameraTexture=function(k){return A[k]};let Ve=null;function Ye(k,X){if(u=X.getViewerPose(l||o),m=X,u!==null){const se=u.views;f!==null&&(e.setRenderTargetFramebuffer(v,f.framebuffer),e.setRenderTarget(v));let _e=!1;se.length!==F.cameras.length&&(F.cameras.length=0,_e=!0);for(let D=0;D<se.length;D++){const st=se[D];let Le=null;if(f!==null)Le=f.getViewport(st);else{const ve=h.getViewSubImage(d,st);Le=ve.viewport,D===0&&(e.setRenderTargetTextures(v,ve.colorTexture,ve.depthStencilTexture),e.setRenderTarget(v))}let Ce=I[D];Ce===void 0&&(Ce=new Dt,Ce.layers.enable(D),Ce.viewport=new qe,I[D]=Ce),Ce.matrix.fromArray(st.transform.matrix),Ce.matrix.decompose(Ce.position,Ce.quaternion,Ce.scale),Ce.projectionMatrix.fromArray(st.projectionMatrix),Ce.projectionMatrixInverse.copy(Ce.projectionMatrix).invert(),Ce.viewport.set(Le.x,Le.y,Le.width,Le.height),D===0&&(F.matrix.copy(Ce.matrix),F.matrix.decompose(F.position,F.quaternion,F.scale)),_e===!0&&F.cameras.push(Ce)}const me=i.enabledFeatures;if(me&&me.includes("depth-sensing")&&i.depthUsage=="gpu-optimized"&&g){h=n.getBinding();const D=h.getDepthInformation(se[0]);D&&D.isValid&&D.texture&&p.init(D,i.renderState)}if(me&&me.includes("camera-access")&&g){e.state.unbindTexture(),h=n.getBinding();for(let D=0;D<se.length;D++){const st=se[D].camera;if(st){let Le=A[st];Le||(Le=new cu,A[st]=Le);const Ce=h.getCameraImage(st);Le.sourceTexture=Ce}}}}for(let se=0;se<w.length;se++){const _e=E[se],me=w[se];_e!==null&&me!==void 0&&me.update(_e,X,l||o)}Ve&&Ve(k,X),X.detectedPlanes&&n.dispatchEvent({type:"planesdetected",data:X}),m=null}const ae=new Au;ae.setAnimationLoop(Ye),this.setAnimationLoop=function(k){Ve=k},this.dispose=function(){}}}const Jn=new sn,jg=new Ne;function Qg(s,e){function t(p,A){p.matrixAutoUpdate===!0&&p.updateMatrix(),A.value.copy(p.matrix)}function n(p,A){A.color.getRGB(p.fogColor.value,ql(s)),A.isFog?(p.fogNear.value=A.near,p.fogFar.value=A.far):A.isFogExp2&&(p.fogDensity.value=A.density)}function i(p,A,T,y,v){A.isMeshBasicMaterial||A.isMeshLambertMaterial?r(p,A):A.isMeshToonMaterial?(r(p,A),h(p,A)):A.isMeshPhongMaterial?(r(p,A),u(p,A)):A.isMeshStandardMaterial?(r(p,A),d(p,A),A.isMeshPhysicalMaterial&&f(p,A,v)):A.isMeshMatcapMaterial?(r(p,A),m(p,A)):A.isMeshDepthMaterial?r(p,A):A.isMeshDistanceMaterial?(r(p,A),g(p,A)):A.isMeshNormalMaterial?r(p,A):A.isLineBasicMaterial?(o(p,A),A.isLineDashedMaterial&&a(p,A)):A.isPointsMaterial?c(p,A,T,y):A.isSpriteMaterial?l(p,A):A.isShadowMaterial?(p.color.value.copy(A.color),p.opacity.value=A.opacity):A.isShaderMaterial&&(A.uniformsNeedUpdate=!1)}function r(p,A){p.opacity.value=A.opacity,A.color&&p.diffuse.value.copy(A.color),A.emissive&&p.emissive.value.copy(A.emissive).multiplyScalar(A.emissiveIntensity),A.map&&(p.map.value=A.map,t(A.map,p.mapTransform)),A.alphaMap&&(p.alphaMap.value=A.alphaMap,t(A.alphaMap,p.alphaMapTransform)),A.bumpMap&&(p.bumpMap.value=A.bumpMap,t(A.bumpMap,p.bumpMapTransform),p.bumpScale.value=A.bumpScale,A.side===It&&(p.bumpScale.value*=-1)),A.normalMap&&(p.normalMap.value=A.normalMap,t(A.normalMap,p.normalMapTransform),p.normalScale.value.copy(A.normalScale),A.side===It&&p.normalScale.value.negate()),A.displacementMap&&(p.displacementMap.value=A.displacementMap,t(A.displacementMap,p.displacementMapTransform),p.displacementScale.value=A.displacementScale,p.displacementBias.value=A.displacementBias),A.emissiveMap&&(p.emissiveMap.value=A.emissiveMap,t(A.emissiveMap,p.emissiveMapTransform)),A.specularMap&&(p.specularMap.value=A.specularMap,t(A.specularMap,p.specularMapTransform)),A.alphaTest>0&&(p.alphaTest.value=A.alphaTest);const T=e.get(A),y=T.envMap,v=T.envMapRotation;y&&(p.envMap.value=y,Jn.copy(v),Jn.x*=-1,Jn.y*=-1,Jn.z*=-1,y.isCubeTexture&&y.isRenderTargetTexture===!1&&(Jn.y*=-1,Jn.z*=-1),p.envMapRotation.value.setFromMatrix4(jg.makeRotationFromEuler(Jn)),p.flipEnvMap.value=y.isCubeTexture&&y.isRenderTargetTexture===!1?-1:1,p.reflectivity.value=A.reflectivity,p.ior.value=A.ior,p.refractionRatio.value=A.refractionRatio),A.lightMap&&(p.lightMap.value=A.lightMap,p.lightMapIntensity.value=A.lightMapIntensity,t(A.lightMap,p.lightMapTransform)),A.aoMap&&(p.aoMap.value=A.aoMap,p.aoMapIntensity.value=A.aoMapIntensity,t(A.aoMap,p.aoMapTransform))}function o(p,A){p.diffuse.value.copy(A.color),p.opacity.value=A.opacity,A.map&&(p.map.value=A.map,t(A.map,p.mapTransform))}function a(p,A){p.dashSize.value=A.dashSize,p.totalSize.value=A.dashSize+A.gapSize,p.scale.value=A.scale}function c(p,A,T,y){p.diffuse.value.copy(A.color),p.opacity.value=A.opacity,p.size.value=A.size*T,p.scale.value=y*.5,A.map&&(p.map.value=A.map,t(A.map,p.uvTransform)),A.alphaMap&&(p.alphaMap.value=A.alphaMap,t(A.alphaMap,p.alphaMapTransform)),A.alphaTest>0&&(p.alphaTest.value=A.alphaTest)}function l(p,A){p.diffuse.value.copy(A.color),p.opacity.value=A.opacity,p.rotation.value=A.rotation,A.map&&(p.map.value=A.map,t(A.map,p.mapTransform)),A.alphaMap&&(p.alphaMap.value=A.alphaMap,t(A.alphaMap,p.alphaMapTransform)),A.alphaTest>0&&(p.alphaTest.value=A.alphaTest)}function u(p,A){p.specular.value.copy(A.specular),p.shininess.value=Math.max(A.shininess,1e-4)}function h(p,A){A.gradientMap&&(p.gradientMap.value=A.gradientMap)}function d(p,A){p.metalness.value=A.metalness,A.metalnessMap&&(p.metalnessMap.value=A.metalnessMap,t(A.metalnessMap,p.metalnessMapTransform)),p.roughness.value=A.roughness,A.roughnessMap&&(p.roughnessMap.value=A.roughnessMap,t(A.roughnessMap,p.roughnessMapTransform)),A.envMap&&(p.envMapIntensity.value=A.envMapIntensity)}function f(p,A,T){p.ior.value=A.ior,A.sheen>0&&(p.sheenColor.value.copy(A.sheenColor).multiplyScalar(A.sheen),p.sheenRoughness.value=A.sheenRoughness,A.sheenColorMap&&(p.sheenColorMap.value=A.sheenColorMap,t(A.sheenColorMap,p.sheenColorMapTransform)),A.sheenRoughnessMap&&(p.sheenRoughnessMap.value=A.sheenRoughnessMap,t(A.sheenRoughnessMap,p.sheenRoughnessMapTransform))),A.clearcoat>0&&(p.clearcoat.value=A.clearcoat,p.clearcoatRoughness.value=A.clearcoatRoughness,A.clearcoatMap&&(p.clearcoatMap.value=A.clearcoatMap,t(A.clearcoatMap,p.clearcoatMapTransform)),A.clearcoatRoughnessMap&&(p.clearcoatRoughnessMap.value=A.clearcoatRoughnessMap,t(A.clearcoatRoughnessMap,p.clearcoatRoughnessMapTransform)),A.clearcoatNormalMap&&(p.clearcoatNormalMap.value=A.clearcoatNormalMap,t(A.clearcoatNormalMap,p.clearcoatNormalMapTransform),p.clearcoatNormalScale.value.copy(A.clearcoatNormalScale),A.side===It&&p.clearcoatNormalScale.value.negate())),A.dispersion>0&&(p.dispersion.value=A.dispersion),A.iridescence>0&&(p.iridescence.value=A.iridescence,p.iridescenceIOR.value=A.iridescenceIOR,p.iridescenceThicknessMinimum.value=A.iridescenceThicknessRange[0],p.iridescenceThicknessMaximum.value=A.iridescenceThicknessRange[1],A.iridescenceMap&&(p.iridescenceMap.value=A.iridescenceMap,t(A.iridescenceMap,p.iridescenceMapTransform)),A.iridescenceThicknessMap&&(p.iridescenceThicknessMap.value=A.iridescenceThicknessMap,t(A.iridescenceThicknessMap,p.iridescenceThicknessMapTransform))),A.transmission>0&&(p.transmission.value=A.transmission,p.transmissionSamplerMap.value=T.texture,p.transmissionSamplerSize.value.set(T.width,T.height),A.transmissionMap&&(p.transmissionMap.value=A.transmissionMap,t(A.transmissionMap,p.transmissionMapTransform)),p.thickness.value=A.thickness,A.thicknessMap&&(p.thicknessMap.value=A.thicknessMap,t(A.thicknessMap,p.thicknessMapTransform)),p.attenuationDistance.value=A.attenuationDistance,p.attenuationColor.value.copy(A.attenuationColor)),A.anisotropy>0&&(p.anisotropyVector.value.set(A.anisotropy*Math.cos(A.anisotropyRotation),A.anisotropy*Math.sin(A.anisotropyRotation)),A.anisotropyMap&&(p.anisotropyMap.value=A.anisotropyMap,t(A.anisotropyMap,p.anisotropyMapTransform))),p.specularIntensity.value=A.specularIntensity,p.specularColor.value.copy(A.specularColor),A.specularColorMap&&(p.specularColorMap.value=A.specularColorMap,t(A.specularColorMap,p.specularColorMapTransform)),A.specularIntensityMap&&(p.specularIntensityMap.value=A.specularIntensityMap,t(A.specularIntensityMap,p.specularIntensityMapTransform))}function m(p,A){A.matcap&&(p.matcap.value=A.matcap)}function g(p,A){const T=e.get(A).light;p.referencePosition.value.setFromMatrixPosition(T.matrixWorld),p.nearDistance.value=T.shadow.camera.near,p.farDistance.value=T.shadow.camera.far}return{refreshFogUniforms:n,refreshMaterialUniforms:i}}function Kg(s,e,t,n){let i={},r={},o=[];const a=s.getParameter(s.MAX_UNIFORM_BUFFER_BINDINGS);function c(T,y){const v=y.program;n.uniformBlockBinding(T,v)}function l(T,y){let v=i[T.id];v===void 0&&(m(T),v=u(T),i[T.id]=v,T.addEventListener("dispose",p));const w=y.program;n.updateUBOMapping(T,w);const E=e.render.frame;r[T.id]!==E&&(d(T),r[T.id]=E)}function u(T){const y=h();T.__bindingPointIndex=y;const v=s.createBuffer(),w=T.__size,E=T.usage;return s.bindBuffer(s.UNIFORM_BUFFER,v),s.bufferData(s.UNIFORM_BUFFER,w,E),s.bindBuffer(s.UNIFORM_BUFFER,null),s.bindBufferBase(s.UNIFORM_BUFFER,y,v),v}function h(){for(let T=0;T<a;T++)if(o.indexOf(T)===-1)return o.push(T),T;return console.error("THREE.WebGLRenderer: Maximum number of simultaneously usable uniforms groups reached."),0}function d(T){const y=i[T.id],v=T.uniforms,w=T.__cache;s.bindBuffer(s.UNIFORM_BUFFER,y);for(let E=0,C=v.length;E<C;E++){const P=Array.isArray(v[E])?v[E]:[v[E]];for(let x=0,M=P.length;x<M;x++){const I=P[x];if(f(I,E,x,w)===!0){const F=I.__offset,z=Array.isArray(I.value)?I.value:[I.value];let G=0;for(let j=0;j<z.length;j++){const B=z[j],J=g(B);typeof B=="number"||typeof B=="boolean"?(I.__data[0]=B,s.bufferSubData(s.UNIFORM_BUFFER,F+G,I.__data)):B.isMatrix3?(I.__data[0]=B.elements[0],I.__data[1]=B.elements[1],I.__data[2]=B.elements[2],I.__data[3]=0,I.__data[4]=B.elements[3],I.__data[5]=B.elements[4],I.__data[6]=B.elements[5],I.__data[7]=0,I.__data[8]=B.elements[6],I.__data[9]=B.elements[7],I.__data[10]=B.elements[8],I.__data[11]=0):(B.toArray(I.__data,G),G+=J.storage/Float32Array.BYTES_PER_ELEMENT)}s.bufferSubData(s.UNIFORM_BUFFER,F,I.__data)}}}s.bindBuffer(s.UNIFORM_BUFFER,null)}function f(T,y,v,w){const E=T.value,C=y+"_"+v;if(w[C]===void 0)return typeof E=="number"||typeof E=="boolean"?w[C]=E:w[C]=E.clone(),!0;{const P=w[C];if(typeof E=="number"||typeof E=="boolean"){if(P!==E)return w[C]=E,!0}else if(P.equals(E)===!1)return P.copy(E),!0}return!1}function m(T){const y=T.uniforms;let v=0;const w=16;for(let C=0,P=y.length;C<P;C++){const x=Array.isArray(y[C])?y[C]:[y[C]];for(let M=0,I=x.length;M<I;M++){const F=x[M],z=Array.isArray(F.value)?F.value:[F.value];for(let G=0,j=z.length;G<j;G++){const B=z[G],J=g(B),W=v%w,K=W%J.boundary,$=W+K;v+=K,$!==0&&w-$<J.storage&&(v+=w-$),F.__data=new Float32Array(J.storage/Float32Array.BYTES_PER_ELEMENT),F.__offset=v,v+=J.storage}}}const E=v%w;return E>0&&(v+=w-E),T.__size=v,T.__cache={},this}function g(T){const y={boundary:0,storage:0};return typeof T=="number"||typeof T=="boolean"?(y.boundary=4,y.storage=4):T.isVector2?(y.boundary=8,y.storage=8):T.isVector3||T.isColor?(y.boundary=16,y.storage=12):T.isVector4?(y.boundary=16,y.storage=16):T.isMatrix3?(y.boundary=48,y.storage=48):T.isMatrix4?(y.boundary=64,y.storage=64):T.isTexture?console.warn("THREE.WebGLRenderer: Texture samplers can not be part of an uniforms group."):console.warn("THREE.WebGLRenderer: Unsupported uniform value type.",T),y}function p(T){const y=T.target;y.removeEventListener("dispose",p);const v=o.indexOf(y.__bindingPointIndex);o.splice(v,1),s.deleteBuffer(i[y.id]),delete i[y.id],delete r[y.id]}function A(){for(const T in i)s.deleteBuffer(i[T]);o=[],i={},r={}}return{bind:c,update:l,dispose:A}}class Yg{constructor(e={}){const{canvas:t=Oh(),context:n=null,depth:i=!0,stencil:r=!1,alpha:o=!1,antialias:a=!1,premultipliedAlpha:c=!0,preserveDrawingBuffer:l=!1,powerPreference:u="default",failIfMajorPerformanceCaveat:h=!1,reversedDepthBuffer:d=!1}=e;this.isWebGLRenderer=!0;let f;if(n!==null){if(typeof WebGLRenderingContext<"u"&&n instanceof WebGLRenderingContext)throw new Error("THREE.WebGLRenderer: WebGL 1 is not supported since r163.");f=n.getContextAttributes().alpha}else f=o;const m=new Uint32Array(4),g=new Int32Array(4);let p=null,A=null;const T=[],y=[];this.domElement=t,this.debug={checkShaderErrors:!0,onShaderError:null},this.autoClear=!0,this.autoClearColor=!0,this.autoClearDepth=!0,this.autoClearStencil=!0,this.sortObjects=!0,this.clippingPlanes=[],this.localClippingEnabled=!1,this.toneMapping=Hn,this.toneMappingExposure=1,this.transmissionResolutionScale=1;const v=this;let w=!1;this._outputColorSpace=yt;let E=0,C=0,P=null,x=-1,M=null;const I=new qe,F=new qe;let z=null;const G=new be(0);let j=0,B=t.width,J=t.height,W=1,K=null,$=null;const le=new qe(0,0,B,J),De=new qe(0,0,B,J);let Ve=!1;const Ye=new Oa;let ae=!1,k=!1;const X=new Ne,se=new R,_e=new qe,me={background:null,fog:null,environment:null,overrideMaterial:null,isScene:!0};let Fe=!1;function mt(){return P===null?W:1}let D=n;function st(S,U){return t.getContext(S,U)}try{const S={alpha:!0,depth:i,stencil:r,antialias:a,premultipliedAlpha:c,preserveDrawingBuffer:l,powerPreference:u,failIfMajorPerformanceCaveat:h};if("setAttribute"in t&&t.setAttribute("data-engine",`three.js r${ya}`),t.addEventListener("webglcontextlost",oe,!1),t.addEventListener("webglcontextrestored",ge,!1),t.addEventListener("webglcontextcreationerror",ee,!1),D===null){const U="webgl2";if(D=st(U,S),D===null)throw st(U)?new Error("Error creating WebGL context with your selected attributes."):new Error("Error creating WebGL context.")}}catch(S){throw console.error("THREE.WebGLRenderer: "+S.message),S}let Le,Ce,ve,nt,Ae,Oe,ht,dt,b,_,O,Y,Z,Q,Ee,re,ye,Se,ne,de,Ie,Te,ue,ze;function L(){Le=new rm(D),Le.init(),Te=new Hg(D,Le),Ce=new Zp(D,Le,e,Te),ve=new zg(D,Le),Ce.reversedDepthBuffer&&d&&ve.buffers.depth.setReversed(!0),nt=new cm(D),Ae=new wg,Oe=new kg(D,Le,ve,Ae,Ce,Te,nt),ht=new em(v),dt=new sm(v),b=new Af(D),ue=new qp(D,b),_=new om(D,b,nt,ue),O=new um(D,_,b,nt),ne=new lm(D,Ce,Oe),re=new $p(Ae),Y=new Eg(v,ht,dt,Le,Ce,ue,re),Z=new Qg(v,Ae),Q=new Cg,Ee=new Ug(Le),Se=new Yp(v,ht,dt,ve,O,f,c),ye=new Og(v,O,Ce),ze=new Kg(D,nt,Ce,ve),de=new Jp(D,Le,nt),Ie=new am(D,Le,nt),nt.programs=Y.programs,v.capabilities=Ce,v.extensions=Le,v.properties=Ae,v.renderLists=Q,v.shadowMap=ye,v.state=ve,v.info=nt}L();const ie=new Xg(v,D);this.xr=ie,this.getContext=function(){return D},this.getContextAttributes=function(){return D.getContextAttributes()},this.forceContextLoss=function(){const S=Le.get("WEBGL_lose_context");S&&S.loseContext()},this.forceContextRestore=function(){const S=Le.get("WEBGL_lose_context");S&&S.restoreContext()},this.getPixelRatio=function(){return W},this.setPixelRatio=function(S){S!==void 0&&(W=S,this.setSize(B,J,!1))},this.getSize=function(S){return S.set(B,J)},this.setSize=function(S,U,H=!0){if(ie.isPresenting){console.warn("THREE.WebGLRenderer: Can't change size while VR device is presenting.");return}B=S,J=U,t.width=Math.floor(S*W),t.height=Math.floor(U*W),H===!0&&(t.style.width=S+"px",t.style.height=U+"px"),this.setViewport(0,0,S,U)},this.getDrawingBufferSize=function(S){return S.set(B*W,J*W).floor()},this.setDrawingBufferSize=function(S,U,H){B=S,J=U,W=H,t.width=Math.floor(S*H),t.height=Math.floor(U*H),this.setViewport(0,0,S,U)},this.getCurrentViewport=function(S){return S.copy(I)},this.getViewport=function(S){return S.copy(le)},this.setViewport=function(S,U,H,V){S.isVector4?le.set(S.x,S.y,S.z,S.w):le.set(S,U,H,V),ve.viewport(I.copy(le).multiplyScalar(W).round())},this.getScissor=function(S){return S.copy(De)},this.setScissor=function(S,U,H,V){S.isVector4?De.set(S.x,S.y,S.z,S.w):De.set(S,U,H,V),ve.scissor(F.copy(De).multiplyScalar(W).round())},this.getScissorTest=function(){return Ve},this.setScissorTest=function(S){ve.setScissorTest(Ve=S)},this.setOpaqueSort=function(S){K=S},this.setTransparentSort=function(S){$=S},this.getClearColor=function(S){return S.copy(Se.getClearColor())},this.setClearColor=function(){Se.setClearColor(...arguments)},this.getClearAlpha=function(){return Se.getClearAlpha()},this.setClearAlpha=function(){Se.setClearAlpha(...arguments)},this.clear=function(S=!0,U=!0,H=!0){let V=0;if(S){let N=!1;if(P!==null){const te=P.texture.format;N=te===Ra||te===Pa||te===Ca}if(N){const te=P.texture.type,he=te===dn||te===oi||te===Ts||te===Es||te===Ea||te===wa,xe=Se.getClearColor(),pe=Se.getClearAlpha(),Re=xe.r,Ue=xe.g,we=xe.b;he?(m[0]=Re,m[1]=Ue,m[2]=we,m[3]=pe,D.clearBufferuiv(D.COLOR,0,m)):(g[0]=Re,g[1]=Ue,g[2]=we,g[3]=pe,D.clearBufferiv(D.COLOR,0,g))}else V|=D.COLOR_BUFFER_BIT}U&&(V|=D.DEPTH_BUFFER_BIT),H&&(V|=D.STENCIL_BUFFER_BIT,this.state.buffers.stencil.setMask(4294967295)),D.clear(V)},this.clearColor=function(){this.clear(!0,!1,!1)},this.clearDepth=function(){this.clear(!1,!0,!1)},this.clearStencil=function(){this.clear(!1,!1,!0)},this.dispose=function(){t.removeEventListener("webglcontextlost",oe,!1),t.removeEventListener("webglcontextrestored",ge,!1),t.removeEventListener("webglcontextcreationerror",ee,!1),Se.dispose(),Q.dispose(),Ee.dispose(),Ae.dispose(),ht.dispose(),dt.dispose(),O.dispose(),ue.dispose(),ze.dispose(),Y.dispose(),ie.dispose(),ie.removeEventListener("sessionstart",an),ie.removeEventListener("sessionend",tc),Wn.stop()};function oe(S){S.preventDefault(),console.log("THREE.WebGLRenderer: Context Lost."),w=!0}function ge(){console.log("THREE.WebGLRenderer: Context Restored."),w=!1;const S=nt.autoReset,U=ye.enabled,H=ye.autoUpdate,V=ye.needsUpdate,N=ye.type;L(),nt.autoReset=S,ye.enabled=U,ye.autoUpdate=H,ye.needsUpdate=V,ye.type=N}function ee(S){console.error("THREE.WebGLRenderer: A WebGL context could not be created. Reason: ",S.statusMessage)}function q(S){const U=S.target;U.removeEventListener("dispose",q),Me(U)}function Me(S){Be(S),Ae.remove(S)}function Be(S){const U=Ae.get(S).programs;U!==void 0&&(U.forEach(function(H){Y.releaseProgram(H)}),S.isShaderMaterial&&Y.releaseShaderCache(S))}this.renderBufferDirect=function(S,U,H,V,N,te){U===null&&(U=me);const he=N.isMesh&&N.matrixWorld.determinant()<0,xe=Eu(S,U,H,V,N);ve.setMaterial(V,he);let pe=H.index,Re=1;if(V.wireframe===!0){if(pe=_.getWireframeAttribute(H),pe===void 0)return;Re=2}const Ue=H.drawRange,we=H.attributes.position;let Xe=Ue.start*Re,et=(Ue.start+Ue.count)*Re;te!==null&&(Xe=Math.max(Xe,te.start*Re),et=Math.min(et,(te.start+te.count)*Re)),pe!==null?(Xe=Math.max(Xe,0),et=Math.min(et,pe.count)):we!=null&&(Xe=Math.max(Xe,0),et=Math.min(et,we.count));const ut=et-Xe;if(ut<0||ut===1/0)return;ue.setup(N,V,xe,H,pe);let at,it=de;if(pe!==null&&(at=b.get(pe),it=Ie,it.setIndex(at)),N.isMesh)V.wireframe===!0?(ve.setLineWidth(V.wireframeLinewidth*mt()),it.setMode(D.LINES)):it.setMode(D.TRIANGLES);else if(N.isLine){let Pe=V.linewidth;Pe===void 0&&(Pe=1),ve.setLineWidth(Pe*mt()),N.isLineSegments?it.setMode(D.LINES):N.isLineLoop?it.setMode(D.LINE_LOOP):it.setMode(D.LINE_STRIP)}else N.isPoints?it.setMode(D.POINTS):N.isSprite&&it.setMode(D.TRIANGLES);if(N.isBatchedMesh)if(N._multiDrawInstances!==null)Ds("THREE.WebGLRenderer: renderMultiDrawInstances has been deprecated and will be removed in r184. Append to renderMultiDraw arguments and use indirection."),it.renderMultiDrawInstances(N._multiDrawStarts,N._multiDrawCounts,N._multiDrawCount,N._multiDrawInstances);else if(Le.get("WEBGL_multi_draw"))it.renderMultiDraw(N._multiDrawStarts,N._multiDrawCounts,N._multiDrawCount);else{const Pe=N._multiDrawStarts,ct=N._multiDrawCounts,Ke=N._multiDrawCount,Ot=pe?b.get(pe).bytesPerElement:1,fi=Ae.get(V).currentProgram.getUniforms();for(let Bt=0;Bt<Ke;Bt++)fi.setValue(D,"_gl_DrawID",Bt),it.render(Pe[Bt]/Ot,ct[Bt])}else if(N.isInstancedMesh)it.renderInstances(Xe,ut,N.count);else if(H.isInstancedBufferGeometry){const Pe=H._maxInstanceCount!==void 0?H._maxInstanceCount:1/0,ct=Math.min(H.instanceCount,Pe);it.renderInstances(Xe,ut,ct)}else it.render(Xe,ut)};function rt(S,U,H){S.transparent===!0&&S.side===un&&S.forceSinglePass===!1?(S.side=It,S.needsUpdate=!0,Bs(S,U,H),S.side=bn,S.needsUpdate=!0,Bs(S,U,H),S.side=un):Bs(S,U,H)}this.compile=function(S,U,H=null){H===null&&(H=S),A=Ee.get(H),A.init(U),y.push(A),H.traverseVisible(function(N){N.isLight&&N.layers.test(U.layers)&&(A.pushLight(N),N.castShadow&&A.pushShadow(N))}),S!==H&&S.traverseVisible(function(N){N.isLight&&N.layers.test(U.layers)&&(A.pushLight(N),N.castShadow&&A.pushShadow(N))}),A.setupLights();const V=new Set;return S.traverse(function(N){if(!(N.isMesh||N.isPoints||N.isLine||N.isSprite))return;const te=N.material;if(te)if(Array.isArray(te))for(let he=0;he<te.length;he++){const xe=te[he];rt(xe,H,N),V.add(xe)}else rt(te,H,N),V.add(te)}),A=y.pop(),V},this.compileAsync=function(S,U,H=null){const V=this.compile(S,U,H);return new Promise(N=>{function te(){if(V.forEach(function(he){Ae.get(he).currentProgram.isReady()&&V.delete(he)}),V.size===0){N(S);return}setTimeout(te,10)}Le.get("KHR_parallel_shader_compile")!==null?te():setTimeout(te,10)})};let Je=null;function mn(S){Je&&Je(S)}function an(){Wn.stop()}function tc(){Wn.start()}const Wn=new Au;Wn.setAnimationLoop(mn),typeof self<"u"&&Wn.setContext(self),this.setAnimationLoop=function(S){Je=S,ie.setAnimationLoop(S),S===null?Wn.stop():Wn.start()},ie.addEventListener("sessionstart",an),ie.addEventListener("sessionend",tc),this.render=function(S,U){if(U!==void 0&&U.isCamera!==!0){console.error("THREE.WebGLRenderer.render: camera is not an instance of THREE.Camera.");return}if(w===!0)return;if(S.matrixWorldAutoUpdate===!0&&S.updateMatrixWorld(),U.parent===null&&U.matrixWorldAutoUpdate===!0&&U.updateMatrixWorld(),ie.enabled===!0&&ie.isPresenting===!0&&(ie.cameraAutoUpdate===!0&&ie.updateCamera(U),U=ie.getCamera()),S.isScene===!0&&S.onBeforeRender(v,S,U,P),A=Ee.get(S,y.length),A.init(U),y.push(A),X.multiplyMatrices(U.projectionMatrix,U.matrixWorldInverse),Ye.setFromProjectionMatrix(X,hn,U.reversedDepth),k=this.localClippingEnabled,ae=re.init(this.clippingPlanes,k),p=Q.get(S,T.length),p.init(),T.push(p),ie.enabled===!0&&ie.isPresenting===!0){const te=v.xr.getDepthSensingMesh();te!==null&&Ur(te,U,-1/0,v.sortObjects)}Ur(S,U,0,v.sortObjects),p.finish(),v.sortObjects===!0&&p.sort(K,$),Fe=ie.enabled===!1||ie.isPresenting===!1||ie.hasDepthSensing()===!1,Fe&&Se.addToRenderList(p,S),this.info.render.frame++,ae===!0&&re.beginShadows();const H=A.state.shadowsArray;ye.render(H,S,U),ae===!0&&re.endShadows(),this.info.autoReset===!0&&this.info.reset();const V=p.opaque,N=p.transmissive;if(A.setupLights(),U.isArrayCamera){const te=U.cameras;if(N.length>0)for(let he=0,xe=te.length;he<xe;he++){const pe=te[he];ic(V,N,S,pe)}Fe&&Se.render(S);for(let he=0,xe=te.length;he<xe;he++){const pe=te[he];nc(p,S,pe,pe.viewport)}}else N.length>0&&ic(V,N,S,U),Fe&&Se.render(S),nc(p,S,U);P!==null&&C===0&&(Oe.updateMultisampleRenderTarget(P),Oe.updateRenderTargetMipmap(P)),S.isScene===!0&&S.onAfterRender(v,S,U),ue.resetDefaultState(),x=-1,M=null,y.pop(),y.length>0?(A=y[y.length-1],ae===!0&&re.setGlobalState(v.clippingPlanes,A.state.camera)):A=null,T.pop(),T.length>0?p=T[T.length-1]:p=null};function Ur(S,U,H,V){if(S.visible===!1)return;if(S.layers.test(U.layers)){if(S.isGroup)H=S.renderOrder;else if(S.isLOD)S.autoUpdate===!0&&S.update(U);else if(S.isLight)A.pushLight(S),S.castShadow&&A.pushShadow(S);else if(S.isSprite){if(!S.frustumCulled||Ye.intersectsSprite(S)){V&&_e.setFromMatrixPosition(S.matrixWorld).applyMatrix4(X);const he=O.update(S),xe=S.material;xe.visible&&p.push(S,he,xe,H,_e.z,null)}}else if((S.isMesh||S.isLine||S.isPoints)&&(!S.frustumCulled||Ye.intersectsObject(S))){const he=O.update(S),xe=S.material;if(V&&(S.boundingSphere!==void 0?(S.boundingSphere===null&&S.computeBoundingSphere(),_e.copy(S.boundingSphere.center)):(he.boundingSphere===null&&he.computeBoundingSphere(),_e.copy(he.boundingSphere.center)),_e.applyMatrix4(S.matrixWorld).applyMatrix4(X)),Array.isArray(xe)){const pe=he.groups;for(let Re=0,Ue=pe.length;Re<Ue;Re++){const we=pe[Re],Xe=xe[we.materialIndex];Xe&&Xe.visible&&p.push(S,he,Xe,H,_e.z,we)}}else xe.visible&&p.push(S,he,xe,H,_e.z,null)}}const te=S.children;for(let he=0,xe=te.length;he<xe;he++)Ur(te[he],U,H,V)}function nc(S,U,H,V){const N=S.opaque,te=S.transmissive,he=S.transparent;A.setupLightsView(H),ae===!0&&re.setGlobalState(v.clippingPlanes,H),V&&ve.viewport(I.copy(V)),N.length>0&&Os(N,U,H),te.length>0&&Os(te,U,H),he.length>0&&Os(he,U,H),ve.buffers.depth.setTest(!0),ve.buffers.depth.setMask(!0),ve.buffers.color.setMask(!0),ve.setPolygonOffset(!1)}function ic(S,U,H,V){if((H.isScene===!0?H.overrideMaterial:null)!==null)return;A.state.transmissionRenderTarget[V.id]===void 0&&(A.state.transmissionRenderTarget[V.id]=new Gn(1,1,{generateMipmaps:!0,type:Le.has("EXT_color_buffer_half_float")||Le.has("EXT_color_buffer_float")?Us:dn,minFilter:Tn,samples:4,stencilBuffer:r,resolveDepthBuffer:!1,resolveStencilBuffer:!1,colorSpace:je.workingColorSpace}));const te=A.state.transmissionRenderTarget[V.id],he=V.viewport||I;te.setSize(he.z*v.transmissionResolutionScale,he.w*v.transmissionResolutionScale);const xe=v.getRenderTarget(),pe=v.getActiveCubeFace(),Re=v.getActiveMipmapLevel();v.setRenderTarget(te),v.getClearColor(G),j=v.getClearAlpha(),j<1&&v.setClearColor(16777215,.5),v.clear(),Fe&&Se.render(H);const Ue=v.toneMapping;v.toneMapping=Hn;const we=V.viewport;if(V.viewport!==void 0&&(V.viewport=void 0),A.setupLightsView(V),ae===!0&&re.setGlobalState(v.clippingPlanes,V),Os(S,H,V),Oe.updateMultisampleRenderTarget(te),Oe.updateRenderTargetMipmap(te),Le.has("WEBGL_multisampled_render_to_texture")===!1){let Xe=!1;for(let et=0,ut=U.length;et<ut;et++){const at=U[et],it=at.object,Pe=at.geometry,ct=at.material,Ke=at.group;if(ct.side===un&&it.layers.test(V.layers)){const Ot=ct.side;ct.side=It,ct.needsUpdate=!0,sc(it,H,V,Pe,ct,Ke),ct.side=Ot,ct.needsUpdate=!0,Xe=!0}}Xe===!0&&(Oe.updateMultisampleRenderTarget(te),Oe.updateRenderTargetMipmap(te))}v.setRenderTarget(xe,pe,Re),v.setClearColor(G,j),we!==void 0&&(V.viewport=we),v.toneMapping=Ue}function Os(S,U,H){const V=U.isScene===!0?U.overrideMaterial:null;for(let N=0,te=S.length;N<te;N++){const he=S[N],xe=he.object,pe=he.geometry,Re=he.group;let Ue=he.material;Ue.allowOverride===!0&&V!==null&&(Ue=V),xe.layers.test(H.layers)&&sc(xe,U,H,pe,Ue,Re)}}function sc(S,U,H,V,N,te){S.onBeforeRender(v,U,H,V,N,te),S.modelViewMatrix.multiplyMatrices(H.matrixWorldInverse,S.matrixWorld),S.normalMatrix.getNormalMatrix(S.modelViewMatrix),N.onBeforeRender(v,U,H,V,S,te),N.transparent===!0&&N.side===un&&N.forceSinglePass===!1?(N.side=It,N.needsUpdate=!0,v.renderBufferDirect(H,U,V,N,S,te),N.side=bn,N.needsUpdate=!0,v.renderBufferDirect(H,U,V,N,S,te),N.side=un):v.renderBufferDirect(H,U,V,N,S,te),S.onAfterRender(v,U,H,V,N,te)}function Bs(S,U,H){U.isScene!==!0&&(U=me);const V=Ae.get(S),N=A.state.lights,te=A.state.shadowsArray,he=N.state.version,xe=Y.getParameters(S,N.state,te,U,H),pe=Y.getProgramCacheKey(xe);let Re=V.programs;V.environment=S.isMeshStandardMaterial?U.environment:null,V.fog=U.fog,V.envMap=(S.isMeshStandardMaterial?dt:ht).get(S.envMap||V.environment),V.envMapRotation=V.environment!==null&&S.envMap===null?U.environmentRotation:S.envMapRotation,Re===void 0&&(S.addEventListener("dispose",q),Re=new Map,V.programs=Re);let Ue=Re.get(pe);if(Ue!==void 0){if(V.currentProgram===Ue&&V.lightsStateVersion===he)return oc(S,xe),Ue}else xe.uniforms=Y.getUniforms(S),S.onBeforeCompile(xe,v),Ue=Y.acquireProgram(xe,pe),Re.set(pe,Ue),V.uniforms=xe.uniforms;const we=V.uniforms;return(!S.isShaderMaterial&&!S.isRawShaderMaterial||S.clipping===!0)&&(we.clippingPlanes=re.uniform),oc(S,xe),V.needsLights=bu(S),V.lightsStateVersion=he,V.needsLights&&(we.ambientLightColor.value=N.state.ambient,we.lightProbe.value=N.state.probe,we.directionalLights.value=N.state.directional,we.directionalLightShadows.value=N.state.directionalShadow,we.spotLights.value=N.state.spot,we.spotLightShadows.value=N.state.spotShadow,we.rectAreaLights.value=N.state.rectArea,we.ltc_1.value=N.state.rectAreaLTC1,we.ltc_2.value=N.state.rectAreaLTC2,we.pointLights.value=N.state.point,we.pointLightShadows.value=N.state.pointShadow,we.hemisphereLights.value=N.state.hemi,we.directionalShadowMap.value=N.state.directionalShadowMap,we.directionalShadowMatrix.value=N.state.directionalShadowMatrix,we.spotShadowMap.value=N.state.spotShadowMap,we.spotLightMatrix.value=N.state.spotLightMatrix,we.spotLightMap.value=N.state.spotLightMap,we.pointShadowMap.value=N.state.pointShadowMap,we.pointShadowMatrix.value=N.state.pointShadowMatrix),V.currentProgram=Ue,V.uniformsList=null,Ue}function rc(S){if(S.uniformsList===null){const U=S.currentProgram.getUniforms();S.uniformsList=Mr.seqWithValue(U.seq,S.uniforms)}return S.uniformsList}function oc(S,U){const H=Ae.get(S);H.outputColorSpace=U.outputColorSpace,H.batching=U.batching,H.batchingColor=U.batchingColor,H.instancing=U.instancing,H.instancingColor=U.instancingColor,H.instancingMorph=U.instancingMorph,H.skinning=U.skinning,H.morphTargets=U.morphTargets,H.morphNormals=U.morphNormals,H.morphColors=U.morphColors,H.morphTargetsCount=U.morphTargetsCount,H.numClippingPlanes=U.numClippingPlanes,H.numIntersection=U.numClipIntersection,H.vertexAlphas=U.vertexAlphas,H.vertexTangents=U.vertexTangents,H.toneMapping=U.toneMapping}function Eu(S,U,H,V,N){U.isScene!==!0&&(U=me),Oe.resetTextureUnits();const te=U.fog,he=V.isMeshStandardMaterial?U.environment:null,xe=P===null?v.outputColorSpace:P.isXRRenderTarget===!0?P.texture.colorSpace:bt,pe=(V.isMeshStandardMaterial?dt:ht).get(V.envMap||he),Re=V.vertexColors===!0&&!!H.attributes.color&&H.attributes.color.itemSize===4,Ue=!!H.attributes.tangent&&(!!V.normalMap||V.anisotropy>0),we=!!H.morphAttributes.position,Xe=!!H.morphAttributes.normal,et=!!H.morphAttributes.color;let ut=Hn;V.toneMapped&&(P===null||P.isXRRenderTarget===!0)&&(ut=v.toneMapping);const at=H.morphAttributes.position||H.morphAttributes.normal||H.morphAttributes.color,it=at!==void 0?at.length:0,Pe=Ae.get(V),ct=A.state.lights;if(ae===!0&&(k===!0||S!==M)){const Ct=S===M&&V.id===x;re.setState(V,S,Ct)}let Ke=!1;V.version===Pe.__version?(Pe.needsLights&&Pe.lightsStateVersion!==ct.state.version||Pe.outputColorSpace!==xe||N.isBatchedMesh&&Pe.batching===!1||!N.isBatchedMesh&&Pe.batching===!0||N.isBatchedMesh&&Pe.batchingColor===!0&&N.colorTexture===null||N.isBatchedMesh&&Pe.batchingColor===!1&&N.colorTexture!==null||N.isInstancedMesh&&Pe.instancing===!1||!N.isInstancedMesh&&Pe.instancing===!0||N.isSkinnedMesh&&Pe.skinning===!1||!N.isSkinnedMesh&&Pe.skinning===!0||N.isInstancedMesh&&Pe.instancingColor===!0&&N.instanceColor===null||N.isInstancedMesh&&Pe.instancingColor===!1&&N.instanceColor!==null||N.isInstancedMesh&&Pe.instancingMorph===!0&&N.morphTexture===null||N.isInstancedMesh&&Pe.instancingMorph===!1&&N.morphTexture!==null||Pe.envMap!==pe||V.fog===!0&&Pe.fog!==te||Pe.numClippingPlanes!==void 0&&(Pe.numClippingPlanes!==re.numPlanes||Pe.numIntersection!==re.numIntersection)||Pe.vertexAlphas!==Re||Pe.vertexTangents!==Ue||Pe.morphTargets!==we||Pe.morphNormals!==Xe||Pe.morphColors!==et||Pe.toneMapping!==ut||Pe.morphTargetsCount!==it)&&(Ke=!0):(Ke=!0,Pe.__version=V.version);let Ot=Pe.currentProgram;Ke===!0&&(Ot=Bs(V,U,N));let fi=!1,Bt=!1,ns=!1;const lt=Ot.getUniforms(),Vt=Pe.uniforms;if(ve.useProgram(Ot.program)&&(fi=!0,Bt=!0,ns=!0),V.id!==x&&(x=V.id,Bt=!0),fi||M!==S){ve.buffers.depth.getReversed()&&S.reversedDepth!==!0&&(S._reversedDepth=!0,S.updateProjectionMatrix()),lt.setValue(D,"projectionMatrix",S.projectionMatrix),lt.setValue(D,"viewMatrix",S.matrixWorldInverse);const Ut=lt.map.cameraPosition;Ut!==void 0&&Ut.setValue(D,se.setFromMatrixPosition(S.matrixWorld)),Ce.logarithmicDepthBuffer&&lt.setValue(D,"logDepthBufFC",2/(Math.log(S.far+1)/Math.LN2)),(V.isMeshPhongMaterial||V.isMeshToonMaterial||V.isMeshLambertMaterial||V.isMeshBasicMaterial||V.isMeshStandardMaterial||V.isShaderMaterial)&&lt.setValue(D,"isOrthographic",S.isOrthographicCamera===!0),M!==S&&(M=S,Bt=!0,ns=!0)}if(N.isSkinnedMesh){lt.setOptional(D,N,"bindMatrix"),lt.setOptional(D,N,"bindMatrixInverse");const Ct=N.skeleton;Ct&&(Ct.boneTexture===null&&Ct.computeBoneTexture(),lt.setValue(D,"boneTexture",Ct.boneTexture,Oe))}N.isBatchedMesh&&(lt.setOptional(D,N,"batchingTexture"),lt.setValue(D,"batchingTexture",N._matricesTexture,Oe),lt.setOptional(D,N,"batchingIdTexture"),lt.setValue(D,"batchingIdTexture",N._indirectTexture,Oe),lt.setOptional(D,N,"batchingColorTexture"),N._colorsTexture!==null&&lt.setValue(D,"batchingColorTexture",N._colorsTexture,Oe));const Wt=H.morphAttributes;if((Wt.position!==void 0||Wt.normal!==void 0||Wt.color!==void 0)&&ne.update(N,H,Ot),(Bt||Pe.receiveShadow!==N.receiveShadow)&&(Pe.receiveShadow=N.receiveShadow,lt.setValue(D,"receiveShadow",N.receiveShadow)),V.isMeshGouraudMaterial&&V.envMap!==null&&(Vt.envMap.value=pe,Vt.flipEnvMap.value=pe.isCubeTexture&&pe.isRenderTargetTexture===!1?-1:1),V.isMeshStandardMaterial&&V.envMap===null&&U.environment!==null&&(Vt.envMapIntensity.value=U.environmentIntensity),Bt&&(lt.setValue(D,"toneMappingExposure",v.toneMappingExposure),Pe.needsLights&&wu(Vt,ns),te&&V.fog===!0&&Z.refreshFogUniforms(Vt,te),Z.refreshMaterialUniforms(Vt,V,W,J,A.state.transmissionRenderTarget[S.id]),Mr.upload(D,rc(Pe),Vt,Oe)),V.isShaderMaterial&&V.uniformsNeedUpdate===!0&&(Mr.upload(D,rc(Pe),Vt,Oe),V.uniformsNeedUpdate=!1),V.isSpriteMaterial&&lt.setValue(D,"center",N.center),lt.setValue(D,"modelViewMatrix",N.modelViewMatrix),lt.setValue(D,"normalMatrix",N.normalMatrix),lt.setValue(D,"modelMatrix",N.matrixWorld),V.isShaderMaterial||V.isRawShaderMaterial){const Ct=V.uniformsGroups;for(let Ut=0,Nr=Ct.length;Ut<Nr;Ut++){const Xn=Ct[Ut];ze.update(Xn,Ot),ze.bind(Xn,Ot)}}return Ot}function wu(S,U){S.ambientLightColor.needsUpdate=U,S.lightProbe.needsUpdate=U,S.directionalLights.needsUpdate=U,S.directionalLightShadows.needsUpdate=U,S.pointLights.needsUpdate=U,S.pointLightShadows.needsUpdate=U,S.spotLights.needsUpdate=U,S.spotLightShadows.needsUpdate=U,S.rectAreaLights.needsUpdate=U,S.hemisphereLights.needsUpdate=U}function bu(S){return S.isMeshLambertMaterial||S.isMeshToonMaterial||S.isMeshPhongMaterial||S.isMeshStandardMaterial||S.isShadowMaterial||S.isShaderMaterial&&S.lights===!0}this.getActiveCubeFace=function(){return E},this.getActiveMipmapLevel=function(){return C},this.getRenderTarget=function(){return P},this.setRenderTargetTextures=function(S,U,H){const V=Ae.get(S);V.__autoAllocateDepthBuffer=S.resolveDepthBuffer===!1,V.__autoAllocateDepthBuffer===!1&&(V.__useRenderToTexture=!1),Ae.get(S.texture).__webglTexture=U,Ae.get(S.depthTexture).__webglTexture=V.__autoAllocateDepthBuffer?void 0:H,V.__hasExternalTextures=!0},this.setRenderTargetFramebuffer=function(S,U){const H=Ae.get(S);H.__webglFramebuffer=U,H.__useDefaultFramebuffer=U===void 0};const Cu=D.createFramebuffer();this.setRenderTarget=function(S,U=0,H=0){P=S,E=U,C=H;let V=!0,N=null,te=!1,he=!1;if(S){const pe=Ae.get(S);if(pe.__useDefaultFramebuffer!==void 0)ve.bindFramebuffer(D.FRAMEBUFFER,null),V=!1;else if(pe.__webglFramebuffer===void 0)Oe.setupRenderTarget(S);else if(pe.__hasExternalTextures)Oe.rebindTextures(S,Ae.get(S.texture).__webglTexture,Ae.get(S.depthTexture).__webglTexture);else if(S.depthBuffer){const we=S.depthTexture;if(pe.__boundDepthTexture!==we){if(we!==null&&Ae.has(we)&&(S.width!==we.image.width||S.height!==we.image.height))throw new Error("WebGLRenderTarget: Attached DepthTexture is initialized to the incorrect size.");Oe.setupDepthRenderbuffer(S)}}const Re=S.texture;(Re.isData3DTexture||Re.isDataArrayTexture||Re.isCompressedArrayTexture)&&(he=!0);const Ue=Ae.get(S).__webglFramebuffer;S.isWebGLCubeRenderTarget?(Array.isArray(Ue[U])?N=Ue[U][H]:N=Ue[U],te=!0):S.samples>0&&Oe.useMultisampledRTT(S)===!1?N=Ae.get(S).__webglMultisampledFramebuffer:Array.isArray(Ue)?N=Ue[H]:N=Ue,I.copy(S.viewport),F.copy(S.scissor),z=S.scissorTest}else I.copy(le).multiplyScalar(W).floor(),F.copy(De).multiplyScalar(W).floor(),z=Ve;if(H!==0&&(N=Cu),ve.bindFramebuffer(D.FRAMEBUFFER,N)&&V&&ve.drawBuffers(S,N),ve.viewport(I),ve.scissor(F),ve.setScissorTest(z),te){const pe=Ae.get(S.texture);D.framebufferTexture2D(D.FRAMEBUFFER,D.COLOR_ATTACHMENT0,D.TEXTURE_CUBE_MAP_POSITIVE_X+U,pe.__webglTexture,H)}else if(he){const pe=U;for(let Re=0;Re<S.textures.length;Re++){const Ue=Ae.get(S.textures[Re]);D.framebufferTextureLayer(D.FRAMEBUFFER,D.COLOR_ATTACHMENT0+Re,Ue.__webglTexture,H,pe)}}else if(S!==null&&H!==0){const pe=Ae.get(S.texture);D.framebufferTexture2D(D.FRAMEBUFFER,D.COLOR_ATTACHMENT0,D.TEXTURE_2D,pe.__webglTexture,H)}x=-1},this.readRenderTargetPixels=function(S,U,H,V,N,te,he,xe=0){if(!(S&&S.isWebGLRenderTarget)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");return}let pe=Ae.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&he!==void 0&&(pe=pe[he]),pe){ve.bindFramebuffer(D.FRAMEBUFFER,pe);try{const Re=S.textures[xe],Ue=Re.format,we=Re.type;if(!Ce.textureFormatReadable(Ue)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in RGBA or implementation defined format.");return}if(!Ce.textureTypeReadable(we)){console.error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not in UnsignedByteType or implementation defined type.");return}U>=0&&U<=S.width-V&&H>=0&&H<=S.height-N&&(S.textures.length>1&&D.readBuffer(D.COLOR_ATTACHMENT0+xe),D.readPixels(U,H,V,N,Te.convert(Ue),Te.convert(we),te))}finally{const Re=P!==null?Ae.get(P).__webglFramebuffer:null;ve.bindFramebuffer(D.FRAMEBUFFER,Re)}}},this.readRenderTargetPixelsAsync=async function(S,U,H,V,N,te,he,xe=0){if(!(S&&S.isWebGLRenderTarget))throw new Error("THREE.WebGLRenderer.readRenderTargetPixels: renderTarget is not THREE.WebGLRenderTarget.");let pe=Ae.get(S).__webglFramebuffer;if(S.isWebGLCubeRenderTarget&&he!==void 0&&(pe=pe[he]),pe)if(U>=0&&U<=S.width-V&&H>=0&&H<=S.height-N){ve.bindFramebuffer(D.FRAMEBUFFER,pe);const Re=S.textures[xe],Ue=Re.format,we=Re.type;if(!Ce.textureFormatReadable(Ue))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in RGBA or implementation defined format.");if(!Ce.textureTypeReadable(we))throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: renderTarget is not in UnsignedByteType or implementation defined type.");const Xe=D.createBuffer();D.bindBuffer(D.PIXEL_PACK_BUFFER,Xe),D.bufferData(D.PIXEL_PACK_BUFFER,te.byteLength,D.STREAM_READ),S.textures.length>1&&D.readBuffer(D.COLOR_ATTACHMENT0+xe),D.readPixels(U,H,V,N,Te.convert(Ue),Te.convert(we),0);const et=P!==null?Ae.get(P).__webglFramebuffer:null;ve.bindFramebuffer(D.FRAMEBUFFER,et);const ut=D.fenceSync(D.SYNC_GPU_COMMANDS_COMPLETE,0);return D.flush(),await Bh(D,ut,4),D.bindBuffer(D.PIXEL_PACK_BUFFER,Xe),D.getBufferSubData(D.PIXEL_PACK_BUFFER,0,te),D.deleteBuffer(Xe),D.deleteSync(ut),te}else throw new Error("THREE.WebGLRenderer.readRenderTargetPixelsAsync: requested read bounds are out of range.")},this.copyFramebufferToTexture=function(S,U=null,H=0){const V=Math.pow(2,-H),N=Math.floor(S.image.width*V),te=Math.floor(S.image.height*V),he=U!==null?U.x:0,xe=U!==null?U.y:0;Oe.setTexture2D(S,0),D.copyTexSubImage2D(D.TEXTURE_2D,H,0,0,he,xe,N,te),ve.unbindTexture()};const Pu=D.createFramebuffer(),Ru=D.createFramebuffer();this.copyTextureToTexture=function(S,U,H=null,V=null,N=0,te=null){te===null&&(N!==0?(Ds("WebGLRenderer: copyTextureToTexture function signature has changed to support src and dst mipmap levels."),te=N,N=0):te=0);let he,xe,pe,Re,Ue,we,Xe,et,ut;const at=S.isCompressedTexture?S.mipmaps[te]:S.image;if(H!==null)he=H.max.x-H.min.x,xe=H.max.y-H.min.y,pe=H.isBox3?H.max.z-H.min.z:1,Re=H.min.x,Ue=H.min.y,we=H.isBox3?H.min.z:0;else{const Wt=Math.pow(2,-N);he=Math.floor(at.width*Wt),xe=Math.floor(at.height*Wt),S.isDataArrayTexture?pe=at.depth:S.isData3DTexture?pe=Math.floor(at.depth*Wt):pe=1,Re=0,Ue=0,we=0}V!==null?(Xe=V.x,et=V.y,ut=V.z):(Xe=0,et=0,ut=0);const it=Te.convert(U.format),Pe=Te.convert(U.type);let ct;U.isData3DTexture?(Oe.setTexture3D(U,0),ct=D.TEXTURE_3D):U.isDataArrayTexture||U.isCompressedArrayTexture?(Oe.setTexture2DArray(U,0),ct=D.TEXTURE_2D_ARRAY):(Oe.setTexture2D(U,0),ct=D.TEXTURE_2D),D.pixelStorei(D.UNPACK_FLIP_Y_WEBGL,U.flipY),D.pixelStorei(D.UNPACK_PREMULTIPLY_ALPHA_WEBGL,U.premultiplyAlpha),D.pixelStorei(D.UNPACK_ALIGNMENT,U.unpackAlignment);const Ke=D.getParameter(D.UNPACK_ROW_LENGTH),Ot=D.getParameter(D.UNPACK_IMAGE_HEIGHT),fi=D.getParameter(D.UNPACK_SKIP_PIXELS),Bt=D.getParameter(D.UNPACK_SKIP_ROWS),ns=D.getParameter(D.UNPACK_SKIP_IMAGES);D.pixelStorei(D.UNPACK_ROW_LENGTH,at.width),D.pixelStorei(D.UNPACK_IMAGE_HEIGHT,at.height),D.pixelStorei(D.UNPACK_SKIP_PIXELS,Re),D.pixelStorei(D.UNPACK_SKIP_ROWS,Ue),D.pixelStorei(D.UNPACK_SKIP_IMAGES,we);const lt=S.isDataArrayTexture||S.isData3DTexture,Vt=U.isDataArrayTexture||U.isData3DTexture;if(S.isDepthTexture){const Wt=Ae.get(S),Ct=Ae.get(U),Ut=Ae.get(Wt.__renderTarget),Nr=Ae.get(Ct.__renderTarget);ve.bindFramebuffer(D.READ_FRAMEBUFFER,Ut.__webglFramebuffer),ve.bindFramebuffer(D.DRAW_FRAMEBUFFER,Nr.__webglFramebuffer);for(let Xn=0;Xn<pe;Xn++)lt&&(D.framebufferTextureLayer(D.READ_FRAMEBUFFER,D.COLOR_ATTACHMENT0,Ae.get(S).__webglTexture,N,we+Xn),D.framebufferTextureLayer(D.DRAW_FRAMEBUFFER,D.COLOR_ATTACHMENT0,Ae.get(U).__webglTexture,te,ut+Xn)),D.blitFramebuffer(Re,Ue,he,xe,Xe,et,he,xe,D.DEPTH_BUFFER_BIT,D.NEAREST);ve.bindFramebuffer(D.READ_FRAMEBUFFER,null),ve.bindFramebuffer(D.DRAW_FRAMEBUFFER,null)}else if(N!==0||S.isRenderTargetTexture||Ae.has(S)){const Wt=Ae.get(S),Ct=Ae.get(U);ve.bindFramebuffer(D.READ_FRAMEBUFFER,Pu),ve.bindFramebuffer(D.DRAW_FRAMEBUFFER,Ru);for(let Ut=0;Ut<pe;Ut++)lt?D.framebufferTextureLayer(D.READ_FRAMEBUFFER,D.COLOR_ATTACHMENT0,Wt.__webglTexture,N,we+Ut):D.framebufferTexture2D(D.READ_FRAMEBUFFER,D.COLOR_ATTACHMENT0,D.TEXTURE_2D,Wt.__webglTexture,N),Vt?D.framebufferTextureLayer(D.DRAW_FRAMEBUFFER,D.COLOR_ATTACHMENT0,Ct.__webglTexture,te,ut+Ut):D.framebufferTexture2D(D.DRAW_FRAMEBUFFER,D.COLOR_ATTACHMENT0,D.TEXTURE_2D,Ct.__webglTexture,te),N!==0?D.blitFramebuffer(Re,Ue,he,xe,Xe,et,he,xe,D.COLOR_BUFFER_BIT,D.NEAREST):Vt?D.copyTexSubImage3D(ct,te,Xe,et,ut+Ut,Re,Ue,he,xe):D.copyTexSubImage2D(ct,te,Xe,et,Re,Ue,he,xe);ve.bindFramebuffer(D.READ_FRAMEBUFFER,null),ve.bindFramebuffer(D.DRAW_FRAMEBUFFER,null)}else Vt?S.isDataTexture||S.isData3DTexture?D.texSubImage3D(ct,te,Xe,et,ut,he,xe,pe,it,Pe,at.data):U.isCompressedArrayTexture?D.compressedTexSubImage3D(ct,te,Xe,et,ut,he,xe,pe,it,at.data):D.texSubImage3D(ct,te,Xe,et,ut,he,xe,pe,it,Pe,at):S.isDataTexture?D.texSubImage2D(D.TEXTURE_2D,te,Xe,et,he,xe,it,Pe,at.data):S.isCompressedTexture?D.compressedTexSubImage2D(D.TEXTURE_2D,te,Xe,et,at.width,at.height,it,at.data):D.texSubImage2D(D.TEXTURE_2D,te,Xe,et,he,xe,it,Pe,at);D.pixelStorei(D.UNPACK_ROW_LENGTH,Ke),D.pixelStorei(D.UNPACK_IMAGE_HEIGHT,Ot),D.pixelStorei(D.UNPACK_SKIP_PIXELS,fi),D.pixelStorei(D.UNPACK_SKIP_ROWS,Bt),D.pixelStorei(D.UNPACK_SKIP_IMAGES,ns),te===0&&U.generateMipmaps&&D.generateMipmap(ct),ve.unbindTexture()},this.initRenderTarget=function(S){Ae.get(S).__webglFramebuffer===void 0&&Oe.setupRenderTarget(S)},this.initTexture=function(S){S.isCubeTexture?Oe.setTextureCube(S,0):S.isData3DTexture?Oe.setTexture3D(S,0):S.isDataArrayTexture||S.isCompressedArrayTexture?Oe.setTexture2DArray(S,0):Oe.setTexture2D(S,0),ve.unbindTexture()},this.resetState=function(){E=0,C=0,P=null,ve.reset(),ue.reset()},typeof __THREE_DEVTOOLS__<"u"&&__THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("observe",{detail:this}))}get coordinateSystem(){return hn}get outputColorSpace(){return this._outputColorSpace}set outputColorSpace(e){this._outputColorSpace=e;const t=this.getContext();t.drawingBufferColorSpace=je._getDrawingBufferColorSpace(e),t.unpackColorSpace=je._getUnpackColorSpace()}}class qg extends $l{constructor(){super();const e=new rn;e.deleteAttribute("uv");const t=new pt({side:It}),n=new pt,i=new Xa(16777215,900,28,2);i.position.set(.418,16.199,.3),this.add(i);const r=new Qe(e,t);r.position.set(-.757,13.219,.717),r.scale.set(31.713,28.305,28.591),this.add(r);const o=new Ns(e,n,6),a=new ot;a.position.set(-10.906,2.009,1.846),a.rotation.set(0,-.195,0),a.scale.set(2.328,7.905,4.651),a.updateMatrix(),o.setMatrixAt(0,a.matrix),a.position.set(-5.607,-.754,-.758),a.rotation.set(0,.994,0),a.scale.set(1.97,1.534,3.955),a.updateMatrix(),o.setMatrixAt(1,a.matrix),a.position.set(6.167,.857,7.803),a.rotation.set(0,.561,0),a.scale.set(3.927,6.285,3.687),a.updateMatrix(),o.setMatrixAt(2,a.matrix),a.position.set(-2.017,.018,6.124),a.rotation.set(0,.333,0),a.scale.set(2.002,4.566,2.064),a.updateMatrix(),o.setMatrixAt(3,a.matrix),a.position.set(2.291,-.756,-2.621),a.rotation.set(0,-.286,0),a.scale.set(1.546,1.552,1.496),a.updateMatrix(),o.setMatrixAt(4,a.matrix),a.position.set(-2.193,-.369,-5.547),a.rotation.set(0,.516,0),a.scale.set(3.875,3.487,2.986),a.updateMatrix(),o.setMatrixAt(5,a.matrix),this.add(o);const c=new Qe(e,Ui(50));c.position.set(-16.116,14.37,8.208),c.scale.set(.1,2.428,2.739),this.add(c);const l=new Qe(e,Ui(50));l.position.set(-16.109,18.021,-8.207),l.scale.set(.1,2.425,2.751),this.add(l);const u=new Qe(e,Ui(17));u.position.set(14.904,12.198,-1.832),u.scale.set(.15,4.265,6.331),this.add(u);const h=new Qe(e,Ui(43));h.position.set(-.462,8.89,14.52),h.scale.set(4.38,5.441,.088),this.add(h);const d=new Qe(e,Ui(20));d.position.set(3.235,11.486,-12.541),d.scale.set(2.5,2,.1),this.add(d);const f=new Qe(e,Ui(100));f.position.set(0,20,0),f.scale.set(1,.1,1),this.add(f)}dispose(){const e=new Set;this.traverse(t=>{t.isMesh&&(e.add(t.geometry),e.add(t.material))});for(const t of e)t.dispose()}}function Ui(s){return new Ld({color:0,emissive:16777215,emissiveIntensity:s})}function El(s,e){if(e===uh)return console.warn("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Geometry already defined as triangles."),s;if(e===fa||e===Hl){let t=s.getIndex();if(t===null){const o=[],a=s.getAttribute("position");if(a!==void 0){for(let c=0;c<a.count;c++)o.push(c);s.setIndex(o),t=s.getIndex()}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Undefined position attribute. Processing not possible."),s}const n=t.count-2,i=[];if(e===fa)for(let o=1;o<=n;o++)i.push(t.getX(0)),i.push(t.getX(o)),i.push(t.getX(o+1));else for(let o=0;o<n;o++)o%2===0?(i.push(t.getX(o)),i.push(t.getX(o+1)),i.push(t.getX(o+2))):(i.push(t.getX(o+2)),i.push(t.getX(o+1)),i.push(t.getX(o)));i.length/3!==n&&console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unable to generate correct amount of triangles.");const r=s.clone();return r.setIndex(i),r.clearGroups(),r}else return console.error("THREE.BufferGeometryUtils.toTrianglesDrawMode(): Unknown draw mode:",e),s}class _u extends $i{constructor(e){super(e),this.dracoLoader=null,this.ktx2Loader=null,this.meshoptDecoder=null,this.pluginCallbacks=[],this.register(function(t){return new tv(t)}),this.register(function(t){return new nv(t)}),this.register(function(t){return new hv(t)}),this.register(function(t){return new dv(t)}),this.register(function(t){return new fv(t)}),this.register(function(t){return new sv(t)}),this.register(function(t){return new rv(t)}),this.register(function(t){return new ov(t)}),this.register(function(t){return new av(t)}),this.register(function(t){return new ev(t)}),this.register(function(t){return new cv(t)}),this.register(function(t){return new iv(t)}),this.register(function(t){return new uv(t)}),this.register(function(t){return new lv(t)}),this.register(function(t){return new Zg(t)}),this.register(function(t){return new Av(t)}),this.register(function(t){return new pv(t)})}load(e,t,n,i){const r=this;let o;if(this.resourcePath!=="")o=this.resourcePath;else if(this.path!==""){const l=ys.extractUrlBase(e);o=ys.resolveURL(l,this.path)}else o=ys.extractUrlBase(e);this.manager.itemStart(e);const a=function(l){i?i(l):console.error(l),r.manager.itemError(e),r.manager.itemEnd(e)},c=new fu(this.manager);c.setPath(this.path),c.setResponseType("arraybuffer"),c.setRequestHeader(this.requestHeader),c.setWithCredentials(this.withCredentials),c.load(e,function(l){try{r.parse(l,o,function(u){t(u),r.manager.itemEnd(e)},a)}catch(u){a(u)}},n,a)}setDRACOLoader(e){return this.dracoLoader=e,this}setKTX2Loader(e){return this.ktx2Loader=e,this}setMeshoptDecoder(e){return this.meshoptDecoder=e,this}register(e){return this.pluginCallbacks.indexOf(e)===-1&&this.pluginCallbacks.push(e),this}unregister(e){return this.pluginCallbacks.indexOf(e)!==-1&&this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(e),1),this}parse(e,t,n,i){let r;const o={},a={},c=new TextDecoder;if(typeof e=="string")r=JSON.parse(e);else if(e instanceof ArrayBuffer)if(c.decode(new Uint8Array(e,0,4))===xu){try{o[We.KHR_BINARY_GLTF]=new mv(e)}catch(h){i&&i(h);return}r=JSON.parse(o[We.KHR_BINARY_GLTF].content)}else r=JSON.parse(c.decode(e));else r=e;if(r.asset===void 0||r.asset.version[0]<2){i&&i(new Error("THREE.GLTFLoader: Unsupported asset. glTF versions >=2.0 are supported."));return}const l=new Pv(r,{path:t||this.resourcePath||"",crossOrigin:this.crossOrigin,requestHeader:this.requestHeader,manager:this.manager,ktx2Loader:this.ktx2Loader,meshoptDecoder:this.meshoptDecoder});l.fileLoader.setRequestHeader(this.requestHeader);for(let u=0;u<this.pluginCallbacks.length;u++){const h=this.pluginCallbacks[u](l);h.name||console.error("THREE.GLTFLoader: Invalid plugin found: missing name"),a[h.name]=h,o[h.name]=!0}if(r.extensionsUsed)for(let u=0;u<r.extensionsUsed.length;++u){const h=r.extensionsUsed[u],d=r.extensionsRequired||[];switch(h){case We.KHR_MATERIALS_UNLIT:o[h]=new $g;break;case We.KHR_DRACO_MESH_COMPRESSION:o[h]=new gv(r,this.dracoLoader);break;case We.KHR_TEXTURE_TRANSFORM:o[h]=new vv;break;case We.KHR_MESH_QUANTIZATION:o[h]=new _v;break;default:d.indexOf(h)>=0&&a[h]===void 0&&console.warn('THREE.GLTFLoader: Unknown extension "'+h+'".')}}l.setExtensions(o),l.setPlugins(a),l.parse(n,i)}parseAsync(e,t){const n=this;return new Promise(function(i,r){n.parse(e,t,i,r)})}}function Jg(){let s={};return{get:function(e){return s[e]},add:function(e,t){s[e]=t},remove:function(e){delete s[e]},removeAll:function(){s={}}}}const We={KHR_BINARY_GLTF:"KHR_binary_glTF",KHR_DRACO_MESH_COMPRESSION:"KHR_draco_mesh_compression",KHR_LIGHTS_PUNCTUAL:"KHR_lights_punctual",KHR_MATERIALS_CLEARCOAT:"KHR_materials_clearcoat",KHR_MATERIALS_DISPERSION:"KHR_materials_dispersion",KHR_MATERIALS_IOR:"KHR_materials_ior",KHR_MATERIALS_SHEEN:"KHR_materials_sheen",KHR_MATERIALS_SPECULAR:"KHR_materials_specular",KHR_MATERIALS_TRANSMISSION:"KHR_materials_transmission",KHR_MATERIALS_IRIDESCENCE:"KHR_materials_iridescence",KHR_MATERIALS_ANISOTROPY:"KHR_materials_anisotropy",KHR_MATERIALS_UNLIT:"KHR_materials_unlit",KHR_MATERIALS_VOLUME:"KHR_materials_volume",KHR_TEXTURE_BASISU:"KHR_texture_basisu",KHR_TEXTURE_TRANSFORM:"KHR_texture_transform",KHR_MESH_QUANTIZATION:"KHR_mesh_quantization",KHR_MATERIALS_EMISSIVE_STRENGTH:"KHR_materials_emissive_strength",EXT_MATERIALS_BUMP:"EXT_materials_bump",EXT_TEXTURE_WEBP:"EXT_texture_webp",EXT_TEXTURE_AVIF:"EXT_texture_avif",EXT_MESHOPT_COMPRESSION:"EXT_meshopt_compression",EXT_MESH_GPU_INSTANCING:"EXT_mesh_gpu_instancing"};class Zg{constructor(e){this.parser=e,this.name=We.KHR_LIGHTS_PUNCTUAL,this.cache={refs:{},uses:{}}}_markDefs(){const e=this.parser,t=this.parser.json.nodes||[];for(let n=0,i=t.length;n<i;n++){const r=t[n];r.extensions&&r.extensions[this.name]&&r.extensions[this.name].light!==void 0&&e._addNodeRef(this.cache,r.extensions[this.name].light)}}_loadLight(e){const t=this.parser,n="light:"+e;let i=t.cache.get(n);if(i)return i;const r=t.json,c=((r.extensions&&r.extensions[this.name]||{}).lights||[])[e];let l;const u=new be(16777215);c.color!==void 0&&u.setRGB(c.color[0],c.color[1],c.color[2],bt);const h=c.range!==void 0?c.range:0;switch(c.type){case"directional":l=new ga(u),l.target.position.set(0,0,-1),l.add(l.target);break;case"point":l=new Xa(u),l.distance=h;break;case"spot":l=new Zd(u),l.distance=h,c.spot=c.spot||{},c.spot.innerConeAngle=c.spot.innerConeAngle!==void 0?c.spot.innerConeAngle:0,c.spot.outerConeAngle=c.spot.outerConeAngle!==void 0?c.spot.outerConeAngle:Math.PI/4,l.angle=c.spot.outerConeAngle,l.penumbra=1-c.spot.innerConeAngle/c.spot.outerConeAngle,l.target.position.set(0,0,-1),l.add(l.target);break;default:throw new Error("THREE.GLTFLoader: Unexpected light type: "+c.type)}return l.position.set(0,0,0),cn(l,c),c.intensity!==void 0&&(l.intensity=c.intensity),l.name=t.createUniqueName(c.name||"light_"+e),i=Promise.resolve(l),t.cache.add(n,i),i}getDependency(e,t){if(e==="light")return this._loadLight(t)}createNodeAttachment(e){const t=this,n=this.parser,r=n.json.nodes[e],a=(r.extensions&&r.extensions[this.name]||{}).light;return a===void 0?null:this._loadLight(a).then(function(c){return n._getNodeRef(t.cache,a,c)})}}class $g{constructor(){this.name=We.KHR_MATERIALS_UNLIT}getMaterialType(){return Ht}extendParams(e,t,n){const i=[];e.color=new be(1,1,1),e.opacity=1;const r=t.pbrMetallicRoughness;if(r){if(Array.isArray(r.baseColorFactor)){const o=r.baseColorFactor;e.color.setRGB(o[0],o[1],o[2],bt),e.opacity=o[3]}r.baseColorTexture!==void 0&&i.push(n.assignTexture(e,"map",r.baseColorTexture,yt))}return Promise.all(i)}}class ev{constructor(e){this.parser=e,this.name=We.KHR_MATERIALS_EMISSIVE_STRENGTH}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=i.extensions[this.name].emissiveStrength;return r!==void 0&&(t.emissiveIntensity=r),Promise.resolve()}}class tv{constructor(e){this.parser=e,this.name=We.KHR_MATERIALS_CLEARCOAT}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:pn}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=[],o=i.extensions[this.name];if(o.clearcoatFactor!==void 0&&(t.clearcoat=o.clearcoatFactor),o.clearcoatTexture!==void 0&&r.push(n.assignTexture(t,"clearcoatMap",o.clearcoatTexture)),o.clearcoatRoughnessFactor!==void 0&&(t.clearcoatRoughness=o.clearcoatRoughnessFactor),o.clearcoatRoughnessTexture!==void 0&&r.push(n.assignTexture(t,"clearcoatRoughnessMap",o.clearcoatRoughnessTexture)),o.clearcoatNormalTexture!==void 0&&(r.push(n.assignTexture(t,"clearcoatNormalMap",o.clearcoatNormalTexture)),o.clearcoatNormalTexture.scale!==void 0)){const a=o.clearcoatNormalTexture.scale;t.clearcoatNormalScale=new fe(a,a)}return Promise.all(r)}}class nv{constructor(e){this.parser=e,this.name=We.KHR_MATERIALS_DISPERSION}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:pn}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=i.extensions[this.name];return t.dispersion=r.dispersion!==void 0?r.dispersion:0,Promise.resolve()}}class iv{constructor(e){this.parser=e,this.name=We.KHR_MATERIALS_IRIDESCENCE}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:pn}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=[],o=i.extensions[this.name];return o.iridescenceFactor!==void 0&&(t.iridescence=o.iridescenceFactor),o.iridescenceTexture!==void 0&&r.push(n.assignTexture(t,"iridescenceMap",o.iridescenceTexture)),o.iridescenceIor!==void 0&&(t.iridescenceIOR=o.iridescenceIor),t.iridescenceThicknessRange===void 0&&(t.iridescenceThicknessRange=[100,400]),o.iridescenceThicknessMinimum!==void 0&&(t.iridescenceThicknessRange[0]=o.iridescenceThicknessMinimum),o.iridescenceThicknessMaximum!==void 0&&(t.iridescenceThicknessRange[1]=o.iridescenceThicknessMaximum),o.iridescenceThicknessTexture!==void 0&&r.push(n.assignTexture(t,"iridescenceThicknessMap",o.iridescenceThicknessTexture)),Promise.all(r)}}class sv{constructor(e){this.parser=e,this.name=We.KHR_MATERIALS_SHEEN}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:pn}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=[];t.sheenColor=new be(0,0,0),t.sheenRoughness=0,t.sheen=1;const o=i.extensions[this.name];if(o.sheenColorFactor!==void 0){const a=o.sheenColorFactor;t.sheenColor.setRGB(a[0],a[1],a[2],bt)}return o.sheenRoughnessFactor!==void 0&&(t.sheenRoughness=o.sheenRoughnessFactor),o.sheenColorTexture!==void 0&&r.push(n.assignTexture(t,"sheenColorMap",o.sheenColorTexture,yt)),o.sheenRoughnessTexture!==void 0&&r.push(n.assignTexture(t,"sheenRoughnessMap",o.sheenRoughnessTexture)),Promise.all(r)}}class rv{constructor(e){this.parser=e,this.name=We.KHR_MATERIALS_TRANSMISSION}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:pn}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=[],o=i.extensions[this.name];return o.transmissionFactor!==void 0&&(t.transmission=o.transmissionFactor),o.transmissionTexture!==void 0&&r.push(n.assignTexture(t,"transmissionMap",o.transmissionTexture)),Promise.all(r)}}class ov{constructor(e){this.parser=e,this.name=We.KHR_MATERIALS_VOLUME}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:pn}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=[],o=i.extensions[this.name];t.thickness=o.thicknessFactor!==void 0?o.thicknessFactor:0,o.thicknessTexture!==void 0&&r.push(n.assignTexture(t,"thicknessMap",o.thicknessTexture)),t.attenuationDistance=o.attenuationDistance||1/0;const a=o.attenuationColor||[1,1,1];return t.attenuationColor=new be().setRGB(a[0],a[1],a[2],bt),Promise.all(r)}}class av{constructor(e){this.parser=e,this.name=We.KHR_MATERIALS_IOR}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:pn}extendMaterialParams(e,t){const i=this.parser.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=i.extensions[this.name];return t.ior=r.ior!==void 0?r.ior:1.5,Promise.resolve()}}class cv{constructor(e){this.parser=e,this.name=We.KHR_MATERIALS_SPECULAR}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:pn}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=[],o=i.extensions[this.name];t.specularIntensity=o.specularFactor!==void 0?o.specularFactor:1,o.specularTexture!==void 0&&r.push(n.assignTexture(t,"specularIntensityMap",o.specularTexture));const a=o.specularColorFactor||[1,1,1];return t.specularColor=new be().setRGB(a[0],a[1],a[2],bt),o.specularColorTexture!==void 0&&r.push(n.assignTexture(t,"specularColorMap",o.specularColorTexture,yt)),Promise.all(r)}}class lv{constructor(e){this.parser=e,this.name=We.EXT_MATERIALS_BUMP}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:pn}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=[],o=i.extensions[this.name];return t.bumpScale=o.bumpFactor!==void 0?o.bumpFactor:1,o.bumpTexture!==void 0&&r.push(n.assignTexture(t,"bumpMap",o.bumpTexture)),Promise.all(r)}}class uv{constructor(e){this.parser=e,this.name=We.KHR_MATERIALS_ANISOTROPY}getMaterialType(e){const n=this.parser.json.materials[e];return!n.extensions||!n.extensions[this.name]?null:pn}extendMaterialParams(e,t){const n=this.parser,i=n.json.materials[e];if(!i.extensions||!i.extensions[this.name])return Promise.resolve();const r=[],o=i.extensions[this.name];return o.anisotropyStrength!==void 0&&(t.anisotropy=o.anisotropyStrength),o.anisotropyRotation!==void 0&&(t.anisotropyRotation=o.anisotropyRotation),o.anisotropyTexture!==void 0&&r.push(n.assignTexture(t,"anisotropyMap",o.anisotropyTexture)),Promise.all(r)}}class hv{constructor(e){this.parser=e,this.name=We.KHR_TEXTURE_BASISU}loadTexture(e){const t=this.parser,n=t.json,i=n.textures[e];if(!i.extensions||!i.extensions[this.name])return null;const r=i.extensions[this.name],o=t.options.ktx2Loader;if(!o){if(n.extensionsRequired&&n.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setKTX2Loader must be called before loading KTX2 textures");return null}return t.loadTextureImage(e,r.source,o)}}class dv{constructor(e){this.parser=e,this.name=We.EXT_TEXTURE_WEBP}loadTexture(e){const t=this.name,n=this.parser,i=n.json,r=i.textures[e];if(!r.extensions||!r.extensions[t])return null;const o=r.extensions[t],a=i.images[o.source];let c=n.textureLoader;if(a.uri){const l=n.options.manager.getHandler(a.uri);l!==null&&(c=l)}return n.loadTextureImage(e,o.source,c)}}class fv{constructor(e){this.parser=e,this.name=We.EXT_TEXTURE_AVIF}loadTexture(e){const t=this.name,n=this.parser,i=n.json,r=i.textures[e];if(!r.extensions||!r.extensions[t])return null;const o=r.extensions[t],a=i.images[o.source];let c=n.textureLoader;if(a.uri){const l=n.options.manager.getHandler(a.uri);l!==null&&(c=l)}return n.loadTextureImage(e,o.source,c)}}class Av{constructor(e){this.name=We.EXT_MESHOPT_COMPRESSION,this.parser=e}loadBufferView(e){const t=this.parser.json,n=t.bufferViews[e];if(n.extensions&&n.extensions[this.name]){const i=n.extensions[this.name],r=this.parser.getDependency("buffer",i.buffer),o=this.parser.options.meshoptDecoder;if(!o||!o.supported){if(t.extensionsRequired&&t.extensionsRequired.indexOf(this.name)>=0)throw new Error("THREE.GLTFLoader: setMeshoptDecoder must be called before loading compressed files");return null}return r.then(function(a){const c=i.byteOffset||0,l=i.byteLength||0,u=i.count,h=i.byteStride,d=new Uint8Array(a,c,l);return o.decodeGltfBufferAsync?o.decodeGltfBufferAsync(u,h,d,i.mode,i.filter).then(function(f){return f.buffer}):o.ready.then(function(){const f=new ArrayBuffer(u*h);return o.decodeGltfBuffer(new Uint8Array(f),u,h,d,i.mode,i.filter),f})})}else return null}}class pv{constructor(e){this.name=We.EXT_MESH_GPU_INSTANCING,this.parser=e}createNodeMesh(e){const t=this.parser.json,n=t.nodes[e];if(!n.extensions||!n.extensions[this.name]||n.mesh===void 0)return null;const i=t.meshes[n.mesh];for(const l of i.primitives)if(l.mode!==jt.TRIANGLES&&l.mode!==jt.TRIANGLE_STRIP&&l.mode!==jt.TRIANGLE_FAN&&l.mode!==void 0)return null;const o=n.extensions[this.name].attributes,a=[],c={};for(const l in o)a.push(this.parser.getDependency("accessor",o[l]).then(u=>(c[l]=u,c[l])));return a.length<1?null:(a.push(this.parser.createNodeMesh(e)),Promise.all(a).then(l=>{const u=l.pop(),h=u.isGroup?u.children:[u],d=l[0].count,f=[];for(const m of h){const g=new Ne,p=new R,A=new fn,T=new R(1,1,1),y=new Ns(m.geometry,m.material,d);for(let v=0;v<d;v++)c.TRANSLATION&&p.fromBufferAttribute(c.TRANSLATION,v),c.ROTATION&&A.fromBufferAttribute(c.ROTATION,v),c.SCALE&&T.fromBufferAttribute(c.SCALE,v),y.setMatrixAt(v,g.compose(p,A,T));for(const v in c)if(v==="_COLOR_0"){const w=c[v];y.instanceColor=new pa(w.array,w.itemSize,w.normalized)}else v!=="TRANSLATION"&&v!=="ROTATION"&&v!=="SCALE"&&m.geometry.setAttribute(v,c[v]);ot.prototype.copy.call(y,m),this.parser.assignFinalMaterial(y),f.push(y)}return u.isGroup?(u.clear(),u.add(...f),u):f[0]}))}}const xu="glTF",As=12,wl={JSON:1313821514,BIN:5130562};class mv{constructor(e){this.name=We.KHR_BINARY_GLTF,this.content=null,this.body=null;const t=new DataView(e,0,As),n=new TextDecoder;if(this.header={magic:n.decode(new Uint8Array(e.slice(0,4))),version:t.getUint32(4,!0),length:t.getUint32(8,!0)},this.header.magic!==xu)throw new Error("THREE.GLTFLoader: Unsupported glTF-Binary header.");if(this.header.version<2)throw new Error("THREE.GLTFLoader: Legacy binary file detected.");const i=this.header.length-As,r=new DataView(e,As);let o=0;for(;o<i;){const a=r.getUint32(o,!0);o+=4;const c=r.getUint32(o,!0);if(o+=4,c===wl.JSON){const l=new Uint8Array(e,As+o,a);this.content=n.decode(l)}else if(c===wl.BIN){const l=As+o;this.body=e.slice(l,l+a)}o+=a}if(this.content===null)throw new Error("THREE.GLTFLoader: JSON content not found.")}}class gv{constructor(e,t){if(!t)throw new Error("THREE.GLTFLoader: No DRACOLoader instance provided.");this.name=We.KHR_DRACO_MESH_COMPRESSION,this.json=e,this.dracoLoader=t,this.dracoLoader.preload()}decodePrimitive(e,t){const n=this.json,i=this.dracoLoader,r=e.extensions[this.name].bufferView,o=e.extensions[this.name].attributes,a={},c={},l={};for(const u in o){const h=xa[u]||u.toLowerCase();a[h]=o[u]}for(const u in e.attributes){const h=xa[u]||u.toLowerCase();if(o[u]!==void 0){const d=n.accessors[e.attributes[u]],f=Oi[d.componentType];l[h]=f.name,c[h]=d.normalized===!0}}return t.getDependency("bufferView",r).then(function(u){return new Promise(function(h,d){i.decodeDracoFile(u,function(f){for(const m in f.attributes){const g=f.attributes[m],p=c[m];p!==void 0&&(g.normalized=p)}h(f)},a,l,bt,d)})})}}class vv{constructor(){this.name=We.KHR_TEXTURE_TRANSFORM}extendTexture(e,t){return(t.texCoord===void 0||t.texCoord===e.channel)&&t.offset===void 0&&t.rotation===void 0&&t.scale===void 0||(e=e.clone(),t.texCoord!==void 0&&(e.channel=t.texCoord),t.offset!==void 0&&e.offset.fromArray(t.offset),t.rotation!==void 0&&(e.rotation=t.rotation),t.scale!==void 0&&e.repeat.fromArray(t.scale),e.needsUpdate=!0),e}}class _v{constructor(){this.name=We.KHR_MESH_QUANTIZATION}}class Mu extends Fs{constructor(e,t,n,i){super(e,t,n,i)}copySampleValue_(e){const t=this.resultBuffer,n=this.sampleValues,i=this.valueSize,r=e*i*3+i;for(let o=0;o!==i;o++)t[o]=n[r+o];return t}interpolate_(e,t,n,i){const r=this.resultBuffer,o=this.sampleValues,a=this.valueSize,c=a*2,l=a*3,u=i-t,h=(n-t)/u,d=h*h,f=d*h,m=e*l,g=m-l,p=-2*f+3*d,A=f-d,T=1-p,y=A-d+h;for(let v=0;v!==a;v++){const w=o[g+v+a],E=o[g+v+c]*u,C=o[m+v+a],P=o[m+v]*u;r[v]=T*w+y*E+p*C+A*P}return r}}const xv=new fn;class Mv extends Mu{interpolate_(e,t,n,i){const r=super.interpolate_(e,t,n,i);return xv.fromArray(r).normalize().toArray(r),r}}const jt={POINTS:0,LINES:1,LINE_LOOP:2,LINE_STRIP:3,TRIANGLES:4,TRIANGLE_STRIP:5,TRIANGLE_FAN:6},Oi={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},bl={9728:Lt,9729:Nt,9984:Ll,9985:mr,9986:ps,9987:Tn},Cl={33071:zn,33648:yr,10497:ri},yo={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT2:4,MAT3:9,MAT4:16},xa={POSITION:"position",NORMAL:"normal",TANGENT:"tangent",TEXCOORD_0:"uv",TEXCOORD_1:"uv1",TEXCOORD_2:"uv2",TEXCOORD_3:"uv3",COLOR_0:"color",WEIGHTS_0:"skinWeight",JOINTS_0:"skinIndex"},On={scale:"scale",translation:"position",rotation:"quaternion",weights:"morphTargetInfluences"},yv={CUBICSPLINE:void 0,LINEAR:Ps,STEP:Cs},So={OPAQUE:"OPAQUE",MASK:"MASK",BLEND:"BLEND"};function Sv(s){return s.DefaultMaterial===void 0&&(s.DefaultMaterial=new pt({color:16777215,emissive:0,metalness:1,roughness:1,transparent:!1,depthTest:!0,side:bn})),s.DefaultMaterial}function Zn(s,e,t){for(const n in t.extensions)s[n]===void 0&&(e.userData.gltfExtensions=e.userData.gltfExtensions||{},e.userData.gltfExtensions[n]=t.extensions[n])}function cn(s,e){e.extras!==void 0&&(typeof e.extras=="object"?Object.assign(s.userData,e.extras):console.warn("THREE.GLTFLoader: Ignoring primitive type .extras, "+e.extras))}function Tv(s,e,t){let n=!1,i=!1,r=!1;for(let l=0,u=e.length;l<u;l++){const h=e[l];if(h.POSITION!==void 0&&(n=!0),h.NORMAL!==void 0&&(i=!0),h.COLOR_0!==void 0&&(r=!0),n&&i&&r)break}if(!n&&!i&&!r)return Promise.resolve(s);const o=[],a=[],c=[];for(let l=0,u=e.length;l<u;l++){const h=e[l];if(n){const d=h.POSITION!==void 0?t.getDependency("accessor",h.POSITION):s.attributes.position;o.push(d)}if(i){const d=h.NORMAL!==void 0?t.getDependency("accessor",h.NORMAL):s.attributes.normal;a.push(d)}if(r){const d=h.COLOR_0!==void 0?t.getDependency("accessor",h.COLOR_0):s.attributes.color;c.push(d)}}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(c)]).then(function(l){const u=l[0],h=l[1],d=l[2];return n&&(s.morphAttributes.position=u),i&&(s.morphAttributes.normal=h),r&&(s.morphAttributes.color=d),s.morphTargetsRelative=!0,s})}function Ev(s,e){if(s.updateMorphTargets(),e.weights!==void 0)for(let t=0,n=e.weights.length;t<n;t++)s.morphTargetInfluences[t]=e.weights[t];if(e.extras&&Array.isArray(e.extras.targetNames)){const t=e.extras.targetNames;if(s.morphTargetInfluences.length===t.length){s.morphTargetDictionary={};for(let n=0,i=t.length;n<i;n++)s.morphTargetDictionary[t[n]]=n}else console.warn("THREE.GLTFLoader: Invalid extras.targetNames length. Ignoring names.")}}function wv(s){let e;const t=s.extensions&&s.extensions[We.KHR_DRACO_MESH_COMPRESSION];if(t?e="draco:"+t.bufferView+":"+t.indices+":"+To(t.attributes):e=s.indices+":"+To(s.attributes)+":"+s.mode,s.targets!==void 0)for(let n=0,i=s.targets.length;n<i;n++)e+=":"+To(s.targets[n]);return e}function To(s){let e="";const t=Object.keys(s).sort();for(let n=0,i=t.length;n<i;n++)e+=t[n]+":"+s[t[n]]+";";return e}function Ma(s){switch(s){case Int8Array:return 1/127;case Uint8Array:return 1/255;case Int16Array:return 1/32767;case Uint16Array:return 1/65535;default:throw new Error("THREE.GLTFLoader: Unsupported normalized accessor component type.")}}function bv(s){return s.search(/\.jpe?g($|\?)/i)>0||s.search(/^data\:image\/jpeg/)===0?"image/jpeg":s.search(/\.webp($|\?)/i)>0||s.search(/^data\:image\/webp/)===0?"image/webp":s.search(/\.ktx2($|\?)/i)>0||s.search(/^data\:image\/ktx2/)===0?"image/ktx2":"image/png"}const Cv=new Ne;class Pv{constructor(e={},t={}){this.json=e,this.extensions={},this.plugins={},this.options=t,this.cache=new Jg,this.associations=new Map,this.primitiveCache={},this.nodeCache={},this.meshCache={refs:{},uses:{}},this.cameraCache={refs:{},uses:{}},this.lightCache={refs:{},uses:{}},this.sourceCache={},this.textureCache={},this.nodeNamesUsed={};let n=!1,i=-1,r=!1,o=-1;if(typeof navigator<"u"){const a=navigator.userAgent;n=/^((?!chrome|android).)*safari/i.test(a)===!0;const c=a.match(/Version\/(\d+)/);i=n&&c?parseInt(c[1],10):-1,r=a.indexOf("Firefox")>-1,o=r?a.match(/Firefox\/([0-9]+)\./)[1]:-1}typeof createImageBitmap>"u"||n&&i<17||r&&o<98?this.textureLoader=new Yd(this.options.manager):this.textureLoader=new tf(this.options.manager),this.textureLoader.setCrossOrigin(this.options.crossOrigin),this.textureLoader.setRequestHeader(this.options.requestHeader),this.fileLoader=new fu(this.options.manager),this.fileLoader.setResponseType("arraybuffer"),this.options.crossOrigin==="use-credentials"&&this.fileLoader.setWithCredentials(!0)}setExtensions(e){this.extensions=e}setPlugins(e){this.plugins=e}parse(e,t){const n=this,i=this.json,r=this.extensions;this.cache.removeAll(),this.nodeCache={},this._invokeAll(function(o){return o._markDefs&&o._markDefs()}),Promise.all(this._invokeAll(function(o){return o.beforeRoot&&o.beforeRoot()})).then(function(){return Promise.all([n.getDependencies("scene"),n.getDependencies("animation"),n.getDependencies("camera")])}).then(function(o){const a={scene:o[0][i.scene||0],scenes:o[0],animations:o[1],cameras:o[2],asset:i.asset,parser:n,userData:{}};return Zn(r,a,i),cn(a,i),Promise.all(n._invokeAll(function(c){return c.afterRoot&&c.afterRoot(a)})).then(function(){for(const c of a.scenes)c.updateMatrixWorld();e(a)})}).catch(t)}_markDefs(){const e=this.json.nodes||[],t=this.json.skins||[],n=this.json.meshes||[];for(let i=0,r=t.length;i<r;i++){const o=t[i].joints;for(let a=0,c=o.length;a<c;a++)e[o[a]].isBone=!0}for(let i=0,r=e.length;i<r;i++){const o=e[i];o.mesh!==void 0&&(this._addNodeRef(this.meshCache,o.mesh),o.skin!==void 0&&(n[o.mesh].isSkinnedMesh=!0)),o.camera!==void 0&&this._addNodeRef(this.cameraCache,o.camera)}}_addNodeRef(e,t){t!==void 0&&(e.refs[t]===void 0&&(e.refs[t]=e.uses[t]=0),e.refs[t]++)}_getNodeRef(e,t,n){if(e.refs[t]<=1)return n;const i=n.clone(),r=(o,a)=>{const c=this.associations.get(o);c!=null&&this.associations.set(a,c);for(const[l,u]of o.children.entries())r(u,a.children[l])};return r(n,i),i.name+="_instance_"+e.uses[t]++,i}_invokeOne(e){const t=Object.values(this.plugins);t.push(this);for(let n=0;n<t.length;n++){const i=e(t[n]);if(i)return i}return null}_invokeAll(e){const t=Object.values(this.plugins);t.unshift(this);const n=[];for(let i=0;i<t.length;i++){const r=e(t[i]);r&&n.push(r)}return n}getDependency(e,t){const n=e+":"+t;let i=this.cache.get(n);if(!i){switch(e){case"scene":i=this.loadScene(t);break;case"node":i=this._invokeOne(function(r){return r.loadNode&&r.loadNode(t)});break;case"mesh":i=this._invokeOne(function(r){return r.loadMesh&&r.loadMesh(t)});break;case"accessor":i=this.loadAccessor(t);break;case"bufferView":i=this._invokeOne(function(r){return r.loadBufferView&&r.loadBufferView(t)});break;case"buffer":i=this.loadBuffer(t);break;case"material":i=this._invokeOne(function(r){return r.loadMaterial&&r.loadMaterial(t)});break;case"texture":i=this._invokeOne(function(r){return r.loadTexture&&r.loadTexture(t)});break;case"skin":i=this.loadSkin(t);break;case"animation":i=this._invokeOne(function(r){return r.loadAnimation&&r.loadAnimation(t)});break;case"camera":i=this.loadCamera(t);break;default:if(i=this._invokeOne(function(r){return r!=this&&r.getDependency&&r.getDependency(e,t)}),!i)throw new Error("Unknown type: "+e);break}this.cache.add(n,i)}return i}getDependencies(e){let t=this.cache.get(e);if(!t){const n=this,i=this.json[e+(e==="mesh"?"es":"s")]||[];t=Promise.all(i.map(function(r,o){return n.getDependency(e,o)})),this.cache.add(e,t)}return t}loadBuffer(e){const t=this.json.buffers[e],n=this.fileLoader;if(t.type&&t.type!=="arraybuffer")throw new Error("THREE.GLTFLoader: "+t.type+" buffer type is not supported.");if(t.uri===void 0&&e===0)return Promise.resolve(this.extensions[We.KHR_BINARY_GLTF].body);const i=this.options;return new Promise(function(r,o){n.load(ys.resolveURL(t.uri,i.path),r,void 0,function(){o(new Error('THREE.GLTFLoader: Failed to load buffer "'+t.uri+'".'))})})}loadBufferView(e){const t=this.json.bufferViews[e];return this.getDependency("buffer",t.buffer).then(function(n){const i=t.byteLength||0,r=t.byteOffset||0;return n.slice(r,r+i)})}loadAccessor(e){const t=this,n=this.json,i=this.json.accessors[e];if(i.bufferView===void 0&&i.sparse===void 0){const o=yo[i.type],a=Oi[i.componentType],c=i.normalized===!0,l=new a(i.count*o);return Promise.resolve(new vt(l,o,c))}const r=[];return i.bufferView!==void 0?r.push(this.getDependency("bufferView",i.bufferView)):r.push(null),i.sparse!==void 0&&(r.push(this.getDependency("bufferView",i.sparse.indices.bufferView)),r.push(this.getDependency("bufferView",i.sparse.values.bufferView))),Promise.all(r).then(function(o){const a=o[0],c=yo[i.type],l=Oi[i.componentType],u=l.BYTES_PER_ELEMENT,h=u*c,d=i.byteOffset||0,f=i.bufferView!==void 0?n.bufferViews[i.bufferView].byteStride:void 0,m=i.normalized===!0;let g,p;if(f&&f!==h){const A=Math.floor(d/f),T="InterleavedBuffer:"+i.bufferView+":"+i.componentType+":"+A+":"+i.count;let y=t.cache.get(T);y||(g=new l(a,A*f,i.count*f/u),y=new eu(g,f/u),t.cache.add(T,y)),p=new Is(y,c,d%f/u,m)}else a===null?g=new l(i.count*c):g=new l(a,d,i.count*c),p=new vt(g,c,m);if(i.sparse!==void 0){const A=yo.SCALAR,T=Oi[i.sparse.indices.componentType],y=i.sparse.indices.byteOffset||0,v=i.sparse.values.byteOffset||0,w=new T(o[1],y,i.sparse.count*A),E=new l(o[2],v,i.sparse.count*c);a!==null&&(p=new vt(p.array.slice(),p.itemSize,p.normalized)),p.normalized=!1;for(let C=0,P=w.length;C<P;C++){const x=w[C];if(p.setX(x,E[C*c]),c>=2&&p.setY(x,E[C*c+1]),c>=3&&p.setZ(x,E[C*c+2]),c>=4&&p.setW(x,E[C*c+3]),c>=5)throw new Error("THREE.GLTFLoader: Unsupported itemSize in sparse BufferAttribute.")}p.normalized=m}return p})}loadTexture(e){const t=this.json,n=this.options,r=t.textures[e].source,o=t.images[r];let a=this.textureLoader;if(o.uri){const c=n.manager.getHandler(o.uri);c!==null&&(a=c)}return this.loadTextureImage(e,r,a)}loadTextureImage(e,t,n){const i=this,r=this.json,o=r.textures[e],a=r.images[t],c=(a.uri||a.bufferView)+":"+o.sampler;if(this.textureCache[c])return this.textureCache[c];const l=this.loadImageSource(t,n).then(function(u){u.flipY=!1,u.name=o.name||a.name||"",u.name===""&&typeof a.uri=="string"&&a.uri.startsWith("data:image/")===!1&&(u.name=a.uri);const d=(r.samplers||{})[o.sampler]||{};return u.magFilter=bl[d.magFilter]||Nt,u.minFilter=bl[d.minFilter]||Tn,u.wrapS=Cl[d.wrapS]||ri,u.wrapT=Cl[d.wrapT]||ri,u.generateMipmaps=!u.isCompressedTexture&&u.minFilter!==Lt&&u.minFilter!==Nt,i.associations.set(u,{textures:e}),u}).catch(function(){return null});return this.textureCache[c]=l,l}loadImageSource(e,t){const n=this,i=this.json,r=this.options;if(this.sourceCache[e]!==void 0)return this.sourceCache[e].then(h=>h.clone());const o=i.images[e],a=self.URL||self.webkitURL;let c=o.uri||"",l=!1;if(o.bufferView!==void 0)c=n.getDependency("bufferView",o.bufferView).then(function(h){l=!0;const d=new Blob([h],{type:o.mimeType});return c=a.createObjectURL(d),c});else if(o.uri===void 0)throw new Error("THREE.GLTFLoader: Image "+e+" is missing URI and bufferView");const u=Promise.resolve(c).then(function(h){return new Promise(function(d,f){let m=d;t.isImageBitmapLoader===!0&&(m=function(g){const p=new gt(g);p.needsUpdate=!0,d(p)}),t.load(ys.resolveURL(h,r.path),m,void 0,f)})}).then(function(h){return l===!0&&a.revokeObjectURL(c),cn(h,o),h.userData.mimeType=o.mimeType||bv(o.uri),h}).catch(function(h){throw console.error("THREE.GLTFLoader: Couldn't load texture",c),h});return this.sourceCache[e]=u,u}assignTexture(e,t,n,i){const r=this;return this.getDependency("texture",n.index).then(function(o){if(!o)return null;if(n.texCoord!==void 0&&n.texCoord>0&&(o=o.clone(),o.channel=n.texCoord),r.extensions[We.KHR_TEXTURE_TRANSFORM]){const a=n.extensions!==void 0?n.extensions[We.KHR_TEXTURE_TRANSFORM]:void 0;if(a){const c=r.associations.get(o);o=r.extensions[We.KHR_TEXTURE_TRANSFORM].extendTexture(o,a),r.associations.set(o,c)}}return i!==void 0&&(o.colorSpace=i),e[t]=o,o})}assignFinalMaterial(e){const t=e.geometry;let n=e.material;const i=t.attributes.tangent===void 0,r=t.attributes.color!==void 0,o=t.attributes.normal===void 0;if(e.isPoints){const a="PointsMaterial:"+n.uuid;let c=this.cache.get(a);c||(c=new za,Yt.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,c.sizeAttenuation=!1,this.cache.add(a,c)),n=c}else if(e.isLine){const a="LineBasicMaterial:"+n.uuid;let c=this.cache.get(a);c||(c=new ru,Yt.prototype.copy.call(c,n),c.color.copy(n.color),c.map=n.map,this.cache.add(a,c)),n=c}if(i||r||o){let a="ClonedMaterial:"+n.uuid+":";i&&(a+="derivative-tangents:"),r&&(a+="vertex-colors:"),o&&(a+="flat-shading:");let c=this.cache.get(a);c||(c=n.clone(),r&&(c.vertexColors=!0),o&&(c.flatShading=!0),i&&(c.normalScale&&(c.normalScale.y*=-1),c.clearcoatNormalScale&&(c.clearcoatNormalScale.y*=-1)),this.cache.add(a,c),this.associations.set(c,this.associations.get(n))),n=c}e.material=n}getMaterialType(){return pt}loadMaterial(e){const t=this,n=this.json,i=this.extensions,r=n.materials[e];let o;const a={},c=r.extensions||{},l=[];if(c[We.KHR_MATERIALS_UNLIT]){const h=i[We.KHR_MATERIALS_UNLIT];o=h.getMaterialType(),l.push(h.extendParams(a,r,t))}else{const h=r.pbrMetallicRoughness||{};if(a.color=new be(1,1,1),a.opacity=1,Array.isArray(h.baseColorFactor)){const d=h.baseColorFactor;a.color.setRGB(d[0],d[1],d[2],bt),a.opacity=d[3]}h.baseColorTexture!==void 0&&l.push(t.assignTexture(a,"map",h.baseColorTexture,yt)),a.metalness=h.metallicFactor!==void 0?h.metallicFactor:1,a.roughness=h.roughnessFactor!==void 0?h.roughnessFactor:1,h.metallicRoughnessTexture!==void 0&&(l.push(t.assignTexture(a,"metalnessMap",h.metallicRoughnessTexture)),l.push(t.assignTexture(a,"roughnessMap",h.metallicRoughnessTexture))),o=this._invokeOne(function(d){return d.getMaterialType&&d.getMaterialType(e)}),l.push(Promise.all(this._invokeAll(function(d){return d.extendMaterialParams&&d.extendMaterialParams(e,a)})))}r.doubleSided===!0&&(a.side=un);const u=r.alphaMode||So.OPAQUE;if(u===So.BLEND?(a.transparent=!0,a.depthWrite=!1):(a.transparent=!1,u===So.MASK&&(a.alphaTest=r.alphaCutoff!==void 0?r.alphaCutoff:.5)),r.normalTexture!==void 0&&o!==Ht&&(l.push(t.assignTexture(a,"normalMap",r.normalTexture)),a.normalScale=new fe(1,1),r.normalTexture.scale!==void 0)){const h=r.normalTexture.scale;a.normalScale.set(h,h)}if(r.occlusionTexture!==void 0&&o!==Ht&&(l.push(t.assignTexture(a,"aoMap",r.occlusionTexture)),r.occlusionTexture.strength!==void 0&&(a.aoMapIntensity=r.occlusionTexture.strength)),r.emissiveFactor!==void 0&&o!==Ht){const h=r.emissiveFactor;a.emissive=new be().setRGB(h[0],h[1],h[2],bt)}return r.emissiveTexture!==void 0&&o!==Ht&&l.push(t.assignTexture(a,"emissiveMap",r.emissiveTexture,yt)),Promise.all(l).then(function(){const h=new o(a);return r.name&&(h.name=r.name),cn(h,r),t.associations.set(h,{materials:e}),r.extensions&&Zn(i,h,r),h})}createUniqueName(e){const t=$e.sanitizeNodeName(e||"");return t in this.nodeNamesUsed?t+"_"+ ++this.nodeNamesUsed[t]:(this.nodeNamesUsed[t]=0,t)}loadGeometries(e){const t=this,n=this.extensions,i=this.primitiveCache;function r(a){return n[We.KHR_DRACO_MESH_COMPRESSION].decodePrimitive(a,t).then(function(c){return Pl(c,a,t)})}const o=[];for(let a=0,c=e.length;a<c;a++){const l=e[a],u=wv(l),h=i[u];if(h)o.push(h.promise);else{let d;l.extensions&&l.extensions[We.KHR_DRACO_MESH_COMPRESSION]?d=r(l):d=Pl(new St,l,t),i[u]={primitive:l,promise:d},o.push(d)}}return Promise.all(o)}loadMesh(e){const t=this,n=this.json,i=this.extensions,r=n.meshes[e],o=r.primitives,a=[];for(let c=0,l=o.length;c<l;c++){const u=o[c].material===void 0?Sv(this.cache):this.getDependency("material",o[c].material);a.push(u)}return a.push(t.loadGeometries(o)),Promise.all(a).then(function(c){const l=c.slice(0,c.length-1),u=c[c.length-1],h=[];for(let f=0,m=u.length;f<m;f++){const g=u[f],p=o[f];let A;const T=l[f];if(p.mode===jt.TRIANGLES||p.mode===jt.TRIANGLE_STRIP||p.mode===jt.TRIANGLE_FAN||p.mode===void 0)A=r.isSkinnedMesh===!0?new ud(g,T):new Qe(g,T),A.isSkinnedMesh===!0&&A.normalizeSkinWeights(),p.mode===jt.TRIANGLE_STRIP?A.geometry=El(A.geometry,Hl):p.mode===jt.TRIANGLE_FAN&&(A.geometry=El(A.geometry,fa));else if(p.mode===jt.LINES)A=new md(g,T);else if(p.mode===jt.LINE_STRIP)A=new Ba(g,T);else if(p.mode===jt.LINE_LOOP)A=new gd(g,T);else if(p.mode===jt.POINTS)A=new ou(g,T);else throw new Error("THREE.GLTFLoader: Primitive mode unsupported: "+p.mode);Object.keys(A.geometry.morphAttributes).length>0&&Ev(A,r),A.name=t.createUniqueName(r.name||"mesh_"+e),cn(A,r),p.extensions&&Zn(i,A,p),t.assignFinalMaterial(A),h.push(A)}for(let f=0,m=h.length;f<m;f++)t.associations.set(h[f],{meshes:e,primitives:f});if(h.length===1)return r.extensions&&Zn(i,h[0],r),h[0];const d=new Ft;r.extensions&&Zn(i,d,r),t.associations.set(d,{meshes:e});for(let f=0,m=h.length;f<m;f++)d.add(h[f]);return d})}loadCamera(e){let t;const n=this.json.cameras[e],i=n[n.type];if(!i){console.warn("THREE.GLTFLoader: Missing camera parameters.");return}return n.type==="perspective"?t=new Dt(Vl.radToDeg(i.yfov),i.aspectRatio||1,i.znear||1,i.zfar||2e6):n.type==="orthographic"&&(t=new ja(-i.xmag,i.xmag,i.ymag,-i.ymag,i.znear,i.zfar)),n.name&&(t.name=this.createUniqueName(n.name)),cn(t,n),Promise.resolve(t)}loadSkin(e){const t=this.json.skins[e],n=[];for(let i=0,r=t.joints.length;i<r;i++)n.push(this._loadNodeShallow(t.joints[i]));return t.inverseBindMatrices!==void 0?n.push(this.getDependency("accessor",t.inverseBindMatrices)):n.push(null),Promise.all(n).then(function(i){const r=i.pop(),o=i,a=[],c=[];for(let l=0,u=o.length;l<u;l++){const h=o[l];if(h){a.push(h);const d=new Ne;r!==null&&d.fromArray(r.array,l*16),c.push(d)}else console.warn('THREE.GLTFLoader: Joint "%s" could not be found.',t.joints[l])}return new Fa(a,c)})}loadAnimation(e){const t=this.json,n=this,i=t.animations[e],r=i.name?i.name:"animation_"+e,o=[],a=[],c=[],l=[],u=[];for(let h=0,d=i.channels.length;h<d;h++){const f=i.channels[h],m=i.samplers[f.sampler],g=f.target,p=g.node,A=i.parameters!==void 0?i.parameters[m.input]:m.input,T=i.parameters!==void 0?i.parameters[m.output]:m.output;g.node!==void 0&&(o.push(this.getDependency("node",p)),a.push(this.getDependency("accessor",A)),c.push(this.getDependency("accessor",T)),l.push(m),u.push(g))}return Promise.all([Promise.all(o),Promise.all(a),Promise.all(c),Promise.all(l),Promise.all(u)]).then(function(h){const d=h[0],f=h[1],m=h[2],g=h[3],p=h[4],A=[];for(let y=0,v=d.length;y<v;y++){const w=d[y],E=f[y],C=m[y],P=g[y],x=p[y];if(w===void 0)continue;w.updateMatrix&&w.updateMatrix();const M=n._createAnimationTracks(w,E,C,P,x);if(M)for(let I=0;I<M.length;I++)A.push(M[I])}const T=new Gd(r,void 0,A);return cn(T,i),T})}createNodeMesh(e){const t=this.json,n=this,i=t.nodes[e];return i.mesh===void 0?null:n.getDependency("mesh",i.mesh).then(function(r){const o=n._getNodeRef(n.meshCache,i.mesh,r);return i.weights!==void 0&&o.traverse(function(a){if(a.isMesh)for(let c=0,l=i.weights.length;c<l;c++)a.morphTargetInfluences[c]=i.weights[c]}),o})}loadNode(e){const t=this.json,n=this,i=t.nodes[e],r=n._loadNodeShallow(e),o=[],a=i.children||[];for(let l=0,u=a.length;l<u;l++)o.push(n.getDependency("node",a[l]));const c=i.skin===void 0?Promise.resolve(null):n.getDependency("skin",i.skin);return Promise.all([r,Promise.all(o),c]).then(function(l){const u=l[0],h=l[1],d=l[2];d!==null&&u.traverse(function(f){f.isSkinnedMesh&&f.bind(d,Cv)});for(let f=0,m=h.length;f<m;f++)u.add(h[f]);return u})}_loadNodeShallow(e){const t=this.json,n=this.extensions,i=this;if(this.nodeCache[e]!==void 0)return this.nodeCache[e];const r=t.nodes[e],o=r.name?i.createUniqueName(r.name):"",a=[],c=i._invokeOne(function(l){return l.createNodeMesh&&l.createNodeMesh(e)});return c&&a.push(c),r.camera!==void 0&&a.push(i.getDependency("camera",r.camera).then(function(l){return i._getNodeRef(i.cameraCache,r.camera,l)})),i._invokeAll(function(l){return l.createNodeAttachment&&l.createNodeAttachment(e)}).forEach(function(l){a.push(l)}),this.nodeCache[e]=Promise.all(a).then(function(l){let u;if(r.isBone===!0?u=new iu:l.length>1?u=new Ft:l.length===1?u=l[0]:u=new ot,u!==l[0])for(let h=0,d=l.length;h<d;h++)u.add(l[h]);if(r.name&&(u.userData.name=r.name,u.name=o),cn(u,r),r.extensions&&Zn(n,u,r),r.matrix!==void 0){const h=new Ne;h.fromArray(r.matrix),u.applyMatrix4(h)}else r.translation!==void 0&&u.position.fromArray(r.translation),r.rotation!==void 0&&u.quaternion.fromArray(r.rotation),r.scale!==void 0&&u.scale.fromArray(r.scale);if(!i.associations.has(u))i.associations.set(u,{});else if(r.mesh!==void 0&&i.meshCache.refs[r.mesh]>1){const h=i.associations.get(u);i.associations.set(u,{...h})}return i.associations.get(u).nodes=e,u}),this.nodeCache[e]}loadScene(e){const t=this.extensions,n=this.json.scenes[e],i=this,r=new Ft;n.name&&(r.name=i.createUniqueName(n.name)),cn(r,n),n.extensions&&Zn(t,r,n);const o=n.nodes||[],a=[];for(let c=0,l=o.length;c<l;c++)a.push(i.getDependency("node",o[c]));return Promise.all(a).then(function(c){for(let u=0,h=c.length;u<h;u++)r.add(c[u]);const l=u=>{const h=new Map;for(const[d,f]of i.associations)(d instanceof Yt||d instanceof gt)&&h.set(d,f);return u.traverse(d=>{const f=i.associations.get(d);f!=null&&h.set(d,f)}),h};return i.associations=l(r),r})}_createAnimationTracks(e,t,n,i,r){const o=[],a=e.name?e.name:e.uuid,c=[];On[r.path]===On.weights?e.traverse(function(d){d.morphTargetInfluences&&c.push(d.name?d.name:d.uuid)}):c.push(a);let l;switch(On[r.path]){case On.weights:l=Wi;break;case On.rotation:l=Xi;break;case On.translation:case On.scale:l=ji;break;default:switch(n.itemSize){case 1:l=Wi;break;case 2:case 3:default:l=ji;break}break}const u=i.interpolation!==void 0?yv[i.interpolation]:Ps,h=this._getArrayFromAccessor(n);for(let d=0,f=c.length;d<f;d++){const m=new l(c[d]+"."+On[r.path],t.array,h,u);i.interpolation==="CUBICSPLINE"&&this._createCubicSplineTrackInterpolant(m),o.push(m)}return o}_getArrayFromAccessor(e){let t=e.array;if(e.normalized){const n=Ma(t.constructor),i=new Float32Array(t.length);for(let r=0,o=t.length;r<o;r++)i[r]=t[r]*n;t=i}return t}_createCubicSplineTrackInterpolant(e){e.createInterpolant=function(n){const i=this instanceof Xi?Mv:Mu;return new i(this.times,this.values,this.getValueSize()/3,n)},e.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline=!0}}function Rv(s,e,t){const n=e.attributes,i=new nn;if(n.POSITION!==void 0){const a=t.json.accessors[n.POSITION],c=a.min,l=a.max;if(c!==void 0&&l!==void 0){if(i.set(new R(c[0],c[1],c[2]),new R(l[0],l[1],l[2])),a.normalized){const u=Ma(Oi[a.componentType]);i.min.multiplyScalar(u),i.max.multiplyScalar(u)}}else{console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.");return}}else return;const r=e.targets;if(r!==void 0){const a=new R,c=new R;for(let l=0,u=r.length;l<u;l++){const h=r[l];if(h.POSITION!==void 0){const d=t.json.accessors[h.POSITION],f=d.min,m=d.max;if(f!==void 0&&m!==void 0){if(c.setX(Math.max(Math.abs(f[0]),Math.abs(m[0]))),c.setY(Math.max(Math.abs(f[1]),Math.abs(m[1]))),c.setZ(Math.max(Math.abs(f[2]),Math.abs(m[2]))),d.normalized){const g=Ma(Oi[d.componentType]);c.multiplyScalar(g)}a.max(c)}else console.warn("THREE.GLTFLoader: Missing min/max properties for accessor POSITION.")}}i.expandByVector(a)}s.boundingBox=i;const o=new An;i.getCenter(o.center),o.radius=i.min.distanceTo(i.max)/2,s.boundingSphere=o}function Pl(s,e,t){const n=e.attributes,i=[];function r(o,a){return t.getDependency("accessor",o).then(function(c){s.setAttribute(a,c)})}for(const o in n){const a=xa[o]||o.toLowerCase();a in s.attributes||i.push(r(n[o],a))}if(e.indices!==void 0&&!s.index){const o=t.getDependency("accessor",e.indices).then(function(a){s.setIndex(a)});i.push(o)}return je.workingColorSpace!==bt&&"COLOR_0"in n&&console.warn(`THREE.GLTFLoader: Converting vertex colors from "srgb-linear" to "${je.workingColorSpace}" not supported.`),cn(s,e),Rv(s,e,t),Promise.all(i).then(function(){return e.targets!==void 0?Tv(s,e.targets,t):s})}const Dv="./models/kenney-racing-kit/raceCar.glb",Eo={length:4.8,width:1.8,height:.95},qa="red",Rl=/^wheel[-_]?(front|back)/i;let wo=null;function Iv(){return wo||(wo=new _u().loadAsync(Dv).then(s=>{const e=s.scene;let t=0;e.traverse(c=>{Rl.test(c.name)&&/front/i.test(c.name)&&(t+=c.position.z)});const n=new nn().setFromObject(e).getSize(new R),i=new R(Eo.width/n.x,Eo.height/n.y,Eo.length/n.z);e.scale.copy(i),e.traverse(c=>{c!==e&&Rl.test(c.name)&&c.scale.set(1,1,i.y/i.z)}),e.rotation.y=t>=0?Math.PI/2:-Math.PI/2;const r=new Ft;r.add(e);const o=new nn().setFromObject(r),a=o.getCenter(new R);return r.position.set(-a.x,-o.min.y,-a.z),r})),wo}je.enabled=!1;const yu=s=>Math.min(1,Math.max(0,s)),Gt=(s,e,t)=>s+(e-s)*t,wt=(s,e,t)=>yu((s-e)/(t-e)),Qi=s=>1-Math.pow(1-s,3),si=s=>s<.5?4*s*s*s:1-Math.pow(-2*s+2,3)/2,Su=s=>1+2.6*Math.pow(s-1,3)+1.6*Math.pow(s-1,2),br=16106818,Lv=14672874,Uv=13666892,Ja=6252146;function ui(){const s=[];return{add(e){return s.push(e),e},dispose(){var e;for(const t of s)(e=t==null?void 0:t.dispose)==null||e.call(t);s.length=0}}}function Cn(s,e){return{[qa]:s.add(new pt({color:e,metalness:.45,roughness:.3})),glass:s.add(new pt({color:724759,metalness:.6,roughness:.15})),carTire:s.add(new pt({color:1842209,metalness:0,roughness:.85})),grey:s.add(new pt({color:14277859,metalness:.5,roughness:.35}))}}function Tu(s){const e=new Ft,t=s[qa],n=s.carTire,i=(r,o,a,c,l,u,h)=>{const d=new Qe(new rn(r,o,a),c);d.position.set(l,u,h),e.add(d)};i(2.6,.4,.75,t,.1,.35,0),i(1.3,.25,.38,t,1.9,.28,0),i(.5,.06,1.7,t,2.45,.12,0),i(1.5,.34,1.25,t,-.45,.3,0),i(.4,.06,1,t,-2,.9,0);for(const[r,o]of[[1.55,.72],[1.55,-.72],[-1.45,.72],[-1.45,-.72]])i(.66,.66,.34,n,r,.33,o);return e}function Nv(s,e){const t=new Ft,n=s[qa].color,i=new Qe(e.add(new Rr(.42,32,16)),e.add(new Ht({color:n.clone().lerp(new be(16777215),.55)})));i.position.y=.6;const r=document.createElement("canvas");r.width=r.height=128;const o=r.getContext("2d"),a=o.createRadialGradient(64,64,0,64,64,64);a.addColorStop(0,`#${n.getHexString()}ff`),a.addColorStop(.35,`#${n.getHexString()}88`),a.addColorStop(1,`#${n.getHexString()}00`),o.fillStyle=a,o.fillRect(0,0,128,128);const c=new nu(e.add(new Na({map:e.add(new li(r)),blending:Bi,depthWrite:!1})));c.scale.setScalar(3.4),c.position.y=.6;const l=new Xa(n,6,9,2);return l.position.y=.8,t.add(i,c,l),t}function ts(s,e,t){if(s.marker)return Nv(e,t);if(!s.template)return Tu(e);const n=s.template.clone(!0);n.traverse(r=>{r.isMesh&&(r.material=e[r.material.name]||e.grey)});const i=new Ft;return i.add(n),i}function Za(s,e,t,n){const i=new Ft;if(!n.length)return i;if(!s.template){for(const a of n){const c=Tu(t);c.applyMatrix4(a),i.add(c)}return i}const r=s.template;r.updateMatrixWorld(!0);const o=new Ne;return r.traverse(a=>{if(!a.isMesh)return;const c=e.add(new Ns(a.geometry,t[a.material.name]||t.grey,n.length));n.forEach((l,u)=>c.setMatrixAt(u,o.multiplyMatrices(l,a.matrixWorld))),c.instanceMatrix.needsUpdate=!0,c.frustumCulled=!1,i.add(c)}),i}const $a=(s,e,t,n=0,i=1)=>new Ne().compose(new R(s,e,t),new fn().setFromAxisAngle(new R(0,1,0),n),new R(i,i,i));function ai(s,e,t=256){const n=document.createElement("canvas");n.width=n.height=t;const i=n.getContext("2d"),r=i.createRadialGradient(t/2,t/2,0,t/2,t/2,t/2);for(const[o,a]of e)r.addColorStop(o,a);return i.fillStyle=r,i.fillRect(0,0,t,t),s.add(new li(n))}function ci(s,e,t,n,{y:i=.01,opacity:r=1,additive:o=!1}={}){const a=s.add(new Ht({map:e,transparent:!0,opacity:r,depthWrite:!1,blending:o?Bi:ii})),c=new Qe(s.add(new Rn(t,n)),a);return c.rotation.x=-Math.PI/2,c.position.y=i,c}function Ls(s,e=1){const t=ai(s,[[0,"rgba(0,0,0,0.55)"],[.55,"rgba(0,0,0,0.25)"],[1,"rgba(0,0,0,0)"]]);return ci(s,t,6.4*e,3.2*e,{y:.015})}const Ki=s=>`#${new be(s).getHexString()}`;function Ss(s,e,{fg:t="#ffffff",bg:n="rgba(10,10,18,0.78)",height:i=1.6}={}){const r=document.createElement("canvas");r.width=384,r.height=160;const o=r.getContext("2d"),a=s.add(new li(r));a.minFilter=Nt,a.generateMipmaps=!1;const c=s.add(new Na({map:a,depthTest:!1,transparent:!0})),l=new nu(c);l.renderOrder=10,l.scale.set(i*r.width/r.height,i,1);let u=null;const h=d=>{var g;if(d===u)return;u=d,o.clearRect(0,0,r.width,r.height),o.font="900 104px Archivo, Inter, system-ui, sans-serif";const f=Math.min(r.width-8,o.measureText(d).width+64),m=(r.width-f)/2;o.fillStyle=n,o.beginPath(),(g=o.roundRect)==null||g.call(o,m,14,f,132,66),o.roundRect||o.rect(m,14,f,132),o.fill(),o.fillStyle=t,o.textAlign="center",o.textBaseline="middle",o.fillText(d,r.width/2,86),a.needsUpdate=!0};return h(e),{sprite:l,set:h}}function Fv(s,e,t,{closed:n=!1,lift:i=0}={}){const r=s.length,o=new Float32Array(r*2*3),a=new Float32Array(r*2*2);let c=0;for(let d=0;d<r;d++){const f=s[d],m=e(d);d>0&&(c+=f.distanceTo(s[d-1]));for(const[g,p]of[[0,-1],[1,1]])o[(d*2+g)*3]=f.x+m.x*(t/2)*p,o[(d*2+g)*3+1]=f.y+m.y*(t/2)*p+i,o[(d*2+g)*3+2]=f.z+m.z*(t/2)*p,a[(d*2+g)*2]=g,a[(d*2+g)*2+1]=c}const l=[],u=n?r:r-1;for(let d=0;d<u;d++){const f=d*2,m=(d+1)%r*2;l.push(f,m,f+1,f+1,m,m+1)}const h=new St;return h.setAttribute("position",new vt(o,3)),h.setAttribute("uv",new vt(a,2)),h.setIndex(l),h.computeVertexNormals(),h}function Ov(s,e,t,n=s.aspect){const i=Vl.degToRad(s.fov)/2,r=Math.atan(Math.tan(i)*n);return Math.max(t/2/Math.tan(i),e/2/Math.tan(r))}function Yi(s,e,t,n,{hs:i=1,vs:r=s.vShare}={}){return Ov(e,t/i,n/r,s.aspect*s.hShare)}function hi(s,{key:e=16777215,rim:t=16777215,rimStrength:n=1.4}={}){s.add(new qd(16777215,1909296,1.1));const i=new ga(e,2.2);i.position.set(6,12,8),s.add(i);const r=new ga(t,n);return r.position.set(-8,5,-10),s.add(r),{key:i,rim:r}}function di(s,e,{fogNear:t=40,fogFar:n=160}={}){const i=new $l;i.environment=s.env,e.bg&&(i.fog=new Ua(new be(e.bg),t,n));const r=new Dt(42,s.aspect,.1,2e3);return{scene:i,camera:r}}function ec(s,e,{count:t=260,area:n=16,top:i=16,from:r=0}={}){const o=s.add(new St),a=new Float32Array(t*3),c=new Float32Array(t*3),l=[],u=new be;for(let m=0;m<t;m++)l.push({x:(Math.random()-.5)*n,z:(Math.random()-.5)*n*.6,y:Math.random()*i,v:2.2+Math.random()*2.4,w:Math.random()*6.28,a:.4+Math.random()*.9}),u.set(e[m%e.length]),c.set([u.r,u.g,u.b],m*3);o.setAttribute("position",new vt(a,3)),o.setAttribute("color",new vt(c,3));const h=s.add(new za({size:.28,vertexColors:!0,transparent:!0,depthWrite:!1})),d=new ou(o,h);return d.frustumCulled=!1,{points:d,update:m=>{const g=m-r;if(d.visible=g>0,!(g<=0)){for(let p=0;p<t;p++){const A=l[p],T=(A.y+i-g*A.v)%i,y=(T<0?T+i:T)+.2;a[p*3]=A.x+Math.sin(g*A.a+A.w)*.6,a[p*3+1]=y,a[p*3+2]=A.z+Math.cos(g*A.a*.7+A.w)*.4}o.attributes.position.needsUpdate=!0,h.opacity=Math.min(1,g*2)}}}}function Bv(s,e){const t=ui(),{scene:n,camera:i}=di(s,e,{fogNear:20,fogFar:60});i.fov=38;const{key:r}=hi(n,{rim:e.paint,rimStrength:2.4}),o=ts(s,Cn(t,e.paint),t);n.add(o),n.add(Ls(t,1.05)),n.add(ci(t,ai(t,[[0,`${Ki(e.paint)}88`],[1,`${Ki(e.paint)}00`]]),12,12,{y:.01,additive:!0})),n.add(ci(t,ai(t,[[0,"rgba(255,255,255,0.10)"],[1,"rgba(255,255,255,0)"]]),34,34,{y:.005}));const a=new R(0,1.1,0);return{scene:n,camera:i,update:l=>{i.aspect=s.aspect,i.updateProjectionMatrix(),o.rotation.y=-1.53+l*.32;const u=Yi(s,i,5.4,3.4,{vs:1}),h=Gt(u*.5,u,Qi(wt(l,0,2.8))),d=Gt(.7,2.1,Qi(wt(l,0,2.8)));i.position.set(Math.sin(.35)*h,d,Math.cos(.35)*h),i.lookAt(a),r.position.set(Math.cos(l*.6)*9,11,Math.sin(l*.6)*9)},still:3.4,dispose:()=>t.dispose()}}const zv=new Set(["Spa-Francorchamps"]);function kv(s,e=420,t=!1){const n=Du(s);let i=[];if(n!=null&&n.path){const P=(n.path.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)||[]).map(Number);for(let x=0;x+1<P.length;x+=2)i.push([P[x],P[x+1]])}if(i.length<8){i=[];for(let P=0;P<64;P++){const x=P/64*Math.PI*2,M=Math.exp(-Math.pow((x-4.2)*2.2,2))*.25;i.push([Math.cos(x)*(.55-M)*100,Math.sin(x)*1*100])}}let r=1/0,o=-1/0,a=1/0,c=-1/0;for(const[P,x]of i)r=Math.min(r,P),o=Math.max(o,P),a=Math.min(a,x),c=Math.max(c,x);const l=(r+o)/2,u=(a+c)/2,h=t?c-a>(o-r)*1.1:o-r>(c-a)*1.1,d=200/Math.max(o-r,c-a);let f=i.map(([P,x])=>{const M=(P-l)*d,I=(x-u)*d;return h?new R(-I,0,M):new R(M,0,I)});const m=[...f,f[0]],g=[0];for(let P=1;P<m.length;P++)g.push(g[P-1]+m[P].distanceTo(m[P-1]));const p=g[g.length-1],A=[];let T=0;for(let P=0;P<e;P++){const x=P/e*p;for(;T<g.length-2&&g[T+1]<x;)T++;const M=(x-g[T])/Math.max(1e-6,g[T+1]-g[T]);A.push(m[T].clone().lerp(m[T+1],M))}for(let P=0;P<3;P++)A.splice(0,A.length,...A.map((x,M)=>x.clone().add(A[(M+e-1)%e]).add(A[(M+1)%e]).multiplyScalar(1/3)));f=A;const y=f.map((P,x)=>{const M=f[(x+e-2)%e],I=f[(x+2)%e],F=P.clone().sub(M).normalize(),z=I.clone().sub(P).normalize();return Math.acos(Math.min(1,Math.max(-1,F.dot(z))))/Math.max(.001,M.distanceTo(I))});if(n&&zv.has(n.circuit))return{points:f,curv:y};let v={len:0,end:0},w=0;for(let P=0;P<e*2;P++)y[P%e]<.012?(w+=1,w>v.len&&(v={len:w,end:P})):w=0;const E=(v.end-Math.floor(v.len*.25)+e)%e,C=P=>[...P.slice(E),...P.slice(0,E)];return{points:C(f),curv:C(y)}}function Hv(s,e){const t=ui(),{scene:n,camera:i}=di(s,e,{fogNear:260,fogFar:700});i.fov=40,i.near=2,hi(n,{rim:e.paint,rimStrength:1.2});const{points:r,curv:o}=kv(e.track,420,!!e.wide),a=r.length,c=r.map((ae,k)=>r[(k+1)%a].clone().sub(r[(k+a-1)%a]).normalize()),l=new R(0,1,0),u=c.map(ae=>new R().crossVectors(l,ae).normalize()),h=6.5;let d=1/0,f=-1/0,m=1/0,g=-1/0;for(const ae of r)d=Math.min(d,ae.x),f=Math.max(f,ae.x),m=Math.min(m,ae.z),g=Math.max(g,ae.z);const p=new R((d+f)/2,0,(m+g)/2),A=Math.max(f-d,g-m)+40,T=2048,y=ae=>(ae+A/2)/A*T,v=T/A,w=document.createElement("canvas");w.width=w.height=T;const E=w.getContext("2d");E.lineJoin="round",E.lineCap="round";const C=(ae=0,k=a)=>{E.beginPath();for(let X=ae;X<=k;X++){const se=r[X%a],_e=y(se.x-p.x),me=y(se.z-p.z);X===ae?E.moveTo(_e,me):E.lineTo(_e,me)}};E.strokeStyle="#f4f5f7",E.lineWidth=(h+1.6)*v,C(),E.closePath(),E.stroke(),E.strokeStyle="#d7263d",E.setLineDash([1.6*v,1.6*v]);for(let ae=0;ae<a;ae++){if(o[ae]<=.02)continue;let k=ae;for(;k<a&&o[k]>.02;)k++;C(ae,k),E.stroke(),ae=k}E.setLineDash([]),E.strokeStyle="#23262d",E.lineWidth=h*v,C(),E.closePath(),E.stroke();{const ae=r[0],k=Math.atan2(c[0].z,c[0].x);E.save(),E.translate(y(ae.x-p.x),y(ae.z-p.z)),E.rotate(k);const X=h*v/8;for(let se=0;se<2;se++)for(let _e=0;_e<8;_e++)E.fillStyle=(se+_e)%2?"#111":"#fff",E.fillRect(-X+se*X,-h*v/2+_e*X,X,X);E.restore()}const P=t.add(new li(w));P.anisotropy=s.maxAnisotropy||4;const x=new Qe(t.add(new Rn(A,A)),t.add(new pt({map:P,transparent:!0,roughness:.9,metalness:0})));x.rotation.x=-Math.PI/2,x.position.set(p.x,0,p.z),n.add(x);const M=t.add(Fv(r,ae=>u[ae],2.2,{closed:!0,lift:.25})),I=new Qe(M,t.add(new Ht({color:e.paint,transparent:!0,opacity:.95,depthWrite:!1,polygonOffset:!0,polygonOffsetFactor:-2,polygonOffsetUnits:-2})));I.renderOrder=2,M.setDrawRange(0,0),n.add(I);const F=2,z=ts(s,Cn(t,e.paint),t);z.scale.setScalar(F);const G=Ls(t,F);n.add(z,G);const j=Ss(t,`P${e.position}`,{height:8});j.sprite.visible=!1,n.add(j.sprite);const B=ec(t,[br,16777215,e.paint],{count:180,area:40,top:26,from:99});n.add(B.points);const J=o.map(ae=>Math.max(.36,1/(1+14*ae))),W=J.map((ae,k)=>{let X=0;for(let se=-6;se<=6;se++)X+=J[(k+se+a)%a];return X/13}),K=[0];for(let ae=0;ae<a;ae++)K.push(K[ae]+1/W[ae]);const $=K[a],le=ae=>{const k=yu(ae)*$;let X=0,se=a;for(;X<se-1;){const _e=X+se>>1;K[_e]<=k?X=_e:se=_e}return X+(k-K[X])/Math.max(1e-6,K[X+1]-K[X])},De=[.8,6.9],Ve=.22;return{scene:n,camera:i,update:ae=>{i.aspect=s.aspect,i.updateProjectionMatrix();const k=.98,X=f-d,se=g-m,_e=X*Math.cos(Ve)+se*Math.sin(Ve)+30,me=(se*Math.cos(Ve)+X*Math.sin(Ve))*Math.sin(k)+40,Fe=Yi(s,i,_e,me,{hs:s.wide?1:.92,vs:s.wide?.95:s.vShare})*1.08*Gt(1.25,1,Qi(wt(ae,0,2.2)));n.fog&&(n.fog.near=Fe*1.05,n.fog.far=Fe*2.4);const mt=Math.sin(ae*.22)*Ve;i.position.set(p.x+Math.sin(mt)*Math.cos(k)*Fe,Math.sin(k)*Fe,p.z+Math.cos(mt)*Math.cos(k)*Fe),i.lookAt(p);const D=wt(ae,De[0],De[1]),st=D<.94?D:.94+.06*Qi((D-.94)/.06),Le=le(st),Ce=Math.floor(Le)%a,ve=(Ce+1)%a,nt=Le-Math.floor(Le),Ae=r[Ce].clone().lerp(r[ve],nt),Oe=c[Ce].clone().lerp(c[ve],nt).normalize();z.position.copy(Ae).setY(.3),z.rotation.y=Math.atan2(-Oe.z,Oe.x),G.position.set(Ae.x,.32,Ae.z),G.rotation.z=z.rotation.y,M.setDrawRange(0,Math.min(a,Math.floor(Le))*6);const ht=ae>=De[1];j.sprite.visible=ht,j.sprite.position.copy(Ae).setY(11),e.position<=3&&ht?(B.points.position.copy(Ae),B.update(ae-De[1]+.001)):B.points.visible=!1},still:7.6,dispose:()=>t.dispose()}}function Gv(s,e){const t=ui(),{scene:n,camera:i}=di(s,e,{fogNear:60,fogFar:190});i.fov=44,hi(n,{rim:e.paint});const r=Math.max(2,e.from),o=Math.max(1,Math.min(r-1,e.to)),a=9,c=B=>(B-1)*a,l=B=>B%2?-2.3:2.3,u=Math.max(1,o-2),h=r+2,d=c(h)-c(u)+160,f=document.createElement("canvas");f.width=64,f.height=256;const m=f.getContext("2d");m.fillStyle="#23262d",m.fillRect(0,0,64,256),m.fillStyle="rgba(255,255,255,0.85)",m.fillRect(29,0,6,128),m.fillStyle="rgba(255,255,255,0.9)",m.fillRect(0,0,3,256),m.fillRect(61,0,3,256);const g=t.add(new li(f));g.wrapT=ri,g.repeat.set(1,d/24),g.anisotropy=4;const p=new Qe(t.add(new Rn(13,d)),t.add(new pt({map:g,roughness:.9})));p.rotation.x=-Math.PI/2,p.position.set(0,0,(c(u)+c(h))/2-20),n.add(p);const A=Math.PI/2,T=[];for(let B=u;B<=h;B++)B!==r&&T.push($a(l(B),0,c(B),A));n.add(Za(s,t,Cn(t,Ja),T));for(let B=u;B<=h;B++){if(B===r)continue;const J=Ls(t);J.position.set(l(B),.015,c(B)),J.rotation.z=A,n.add(J)}const y=ts(s,Cn(t,e.paint),t);y.rotation.y=A;const v=Ls(t);v.rotation.z=A,n.add(y,v);const w=ci(t,ai(t,[[0,`${Ki(e.paint)}aa`],[1,`${Ki(e.paint)}00`]]),9,9,{y:.02,additive:!0});n.add(w);const E=Ss(t,`P${r}`,{height:1.9});n.add(E.sprite);const C=70,P=t.add(new rn(.06,.06,7)),x=new Ns(P,t.add(new Ht({color:16777215,transparent:!0,opacity:.55,blending:Bi,depthWrite:!1})),C);t.add(x),x.frustumCulled=!1;const M=Array.from({length:C},(B,J)=>({x:(J%2?1:-1)*(7.2+Math.random()*9),y:.3+Math.random()*3.2,z:Math.random(),v:.55+Math.random()*.6}));n.add(x);const I=d,F=new Ne,z=c(o)-a/2+1,G=[1,6.2];return{scene:n,camera:i,update:B=>{i.aspect=s.aspect,i.updateProjectionMatrix(),g.offset.y=B*1.6;const J=p.position.z-I/2;M.forEach((k,X)=>{const se=((k.z+B*k.v*.35)%1+1)%1;F.makeTranslation(k.x,k.y,J+se*I),x.setMatrixAt(X,F)}),x.instanceMatrix.needsUpdate=!0;const W=si(wt(B,G[0],G[1])),K=Gt(c(r),z,W),$=Gt(l(r),0,si(wt(B,G[0]-.4,G[0]+.5)));y.position.set($,0,K),v.position.set($,.015,K),w.position.set($,.02,K);let le=0;for(let k=o;k<r;k++)K<c(k)-2.5&&(le+=1);E.set(`P${r-le}`),E.sprite.position.set($,3.4,K);const De=new R($+6,7.5,K+17),Ve=new R($-10,7,K-20),Ye=si(wt(B,G[1]-.2,G[1]+1.4)),ae=wt(B,G[1]-.2,G[1]+.5);E.sprite.material.opacity=1-ae,E.sprite.visible=ae<1,i.position.copy(De.lerp(Ve,Ye)),i.lookAt(new R($+Gt(0,1.5,Ye),.8,K+Gt(-14,4,Ye)))},still:7.8,dispose:()=>t.dispose()}}const Vv="data:model/gltf-binary;base64,Z2xURgIAAABEgAAAoAgAAEpTT057ImFzc2V0Ijp7InZlcnNpb24iOiIyLjAiLCJnZW5lcmF0b3IiOiJ0cm9waHlfc3BsaXQiLCJjb3B5cmlnaHQiOiJUcm9waHkgYnkgQ3JlYXRpdmVUcmlvLCBDQzAgMS4wIChwb2x5LnBpenphL20vZkx5OEttbUQxdCkifSwic2NlbmUiOjAsInNjZW5lcyI6W3sibm9kZXMiOlswLDEsMl19XSwibm9kZXMiOlt7Im5hbWUiOiJjdXAiLCJtZXNoIjowfSx7Im5hbWUiOiJiYXNlIiwibWVzaCI6MX0seyJuYW1lIjoicGxhdGUiLCJtZXNoIjoyfV0sIm1lc2hlcyI6W3sibmFtZSI6ImN1cCIsInByaW1pdGl2ZXMiOlt7ImF0dHJpYnV0ZXMiOnsiUE9TSVRJT04iOjAsIk5PUk1BTCI6MX0sImluZGljZXMiOjIsIm1hdGVyaWFsIjowfV19LHsibmFtZSI6ImJhc2UiLCJwcmltaXRpdmVzIjpbeyJhdHRyaWJ1dGVzIjp7IlBPU0lUSU9OIjozLCJOT1JNQUwiOjR9LCJpbmRpY2VzIjo1LCJtYXRlcmlhbCI6MX1dfSx7Im5hbWUiOiJwbGF0ZSIsInByaW1pdGl2ZXMiOlt7ImF0dHJpYnV0ZXMiOnsiUE9TSVRJT04iOjYsIk5PUk1BTCI6N30sImluZGljZXMiOjgsIm1hdGVyaWFsIjoyfV19XSwibWF0ZXJpYWxzIjpbeyJuYW1lIjoiY3VwIn0seyJuYW1lIjoiYmFzZSJ9LHsibmFtZSI6InBsYXRlIn1dLCJhY2Nlc3NvcnMiOlt7ImJ1ZmZlclZpZXciOjAsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50Ijo5NjAsInR5cGUiOiJWRUMzIiwibWluIjpbLTAuMjU1MTQzOTQwNDQ4NzYxLDAuMTI1MDU5Njc5MTUwNTgxMzYsLTAuMjAyOTg3NzkwMTA3NzI3MDVdLCJtYXgiOlswLjI3ODI4MDgyNDQyMjgzNjMsMS4wLDAuMTg0MzI5NzYzMDU0ODQ3NzJdfSx7ImJ1ZmZlclZpZXciOjEsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50Ijo5NjAsInR5cGUiOiJWRUMzIn0seyJidWZmZXJWaWV3IjoyLCJjb21wb25lbnRUeXBlIjo1MTI1LCJjb3VudCI6MTQ3MCwidHlwZSI6IlNDQUxBUiJ9LHsiYnVmZmVyVmlldyI6MywiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjM2LCJ0eXBlIjoiVkVDMyIsIm1pbiI6Wy0wLjI4MjY3MDM3ODY4NDk5NzU2LDAuMCwtMC4xOTU4ODIxNzEzOTI0NDA4XSwibWF4IjpbMC4yODI2NzAzNzg2ODQ5OTc1NiwwLjEyNTYzMTMzMjM5NzQ2MDk0LDAuMTk2NzA2MjA1NjA2NDYwNTddfSx7ImJ1ZmZlclZpZXciOjQsImNvbXBvbmVudFR5cGUiOjUxMjYsImNvdW50IjozNiwidHlwZSI6IlZFQzMifSx7ImJ1ZmZlclZpZXciOjUsImNvbXBvbmVudFR5cGUiOjUxMjUsImNvdW50Ijo1NCwidHlwZSI6IlNDQUxBUiJ9LHsiYnVmZmVyVmlldyI6NiwiY29tcG9uZW50VHlwZSI6NTEyNiwiY291bnQiOjIwLCJ0eXBlIjoiVkVDMyIsIm1pbiI6Wy0wLjE2MzkwMDQ0OTg3MjAxNjksMC4wMzA4MzgwNzk3NTA1Mzc4NzIsMC4xOTY3MDYyMDU2MDY0NjA1N10sIm1heCI6WzAuMTYzOTAwNTA5NDc2NjYxNjgsMC4wOTQ3OTMyMDA0OTI4NTg4OSwwLjIwMjk4Nzc5MDEwNzcyNzA1XX0seyJidWZmZXJWaWV3Ijo3LCJjb21wb25lbnRUeXBlIjo1MTI2LCJjb3VudCI6MjAsInR5cGUiOiJWRUMzIn0seyJidWZmZXJWaWV3Ijo4LCJjb21wb25lbnRUeXBlIjo1MTI1LCJjb3VudCI6MzAsInR5cGUiOiJTQ0FMQVIifV0sImJ1ZmZlclZpZXdzIjpbeyJidWZmZXIiOjAsImJ5dGVPZmZzZXQiOjAsImJ5dGVMZW5ndGgiOjExNTIwLCJ0YXJnZXQiOjM0OTYyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MTE1MjAsImJ5dGVMZW5ndGgiOjExNTIwLCJ0YXJnZXQiOjM0OTYyfSx7ImJ1ZmZlciI6MCwiYnl0ZU9mZnNldCI6MjMwNDAsImJ5dGVMZW5ndGgiOjU4ODAsInRhcmdl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5wUxPurdOL4s6n8/KU94vajZ+r0AAIA/siISvqtXBL4v6n8/hw0Zvh5rL77//38/py5uvY8uTz4s6n8/KU94vVSoGj4v6n8/hw0Zvqi9Ez4AAIA/siISvsK7RT7//38/py5uvY8uTz4s6n8/2OIrPcK7RT7//38/py5uvcK7RT7//38//MIhPY8uTz4s6n8/KU94verdOL4s6n8/2OIrPR5rL77//38/py5uverdOL4s6n8/KU94vR5rL77//38//MIhPVSoGj4s6n8/dPIFPsK7RT7//38//MIhPai9Ez7//38/kg/+PY8uTz4s6n8/2OIrPXOadD3//38/5wUxPojXibx5yAw//8fAPdVXG73//38/5wUxPmMuHj15yAw//8fAPcK7RT7//38/py5uvY1tsT17yAw/pzeuvWkz6j17yAw/lsIXvai9Ez4AAIA/siISvmkz6j17yAw/wa2WPGMuHj15yAw//8fAPY1tsT17yAw/dwGIPevLhL17yAw/dwGIPYjXibx5yAw//8fAPSCSvb17yAw/wa2WPGkz6j17yAw/lsIXvSCSvb17yAw/lsIXvYjXibx7yAw/3v3mvevLhL17yAw/pzeuvWMuHj17yAw/3v3mvY1tsT17yAw/pzeuvXOadD0AAIA//CBEvo1tsT17yAw/pzeuvai9Ez4AAIA/siISvmMuHj17yAw/3v3mvWMuHj15yAw//8fAPXOadD3//38/5wUxPo1tsT17yAw/dwGIPai9Ez7//38/kg/+PcK7RT7//38//MIhPY1tsT17yAw/dwGIPai9Ez7//38/kg/+PWkz6j17yAw/wa2WPGkz6j17yAw/wa2WPMK7RT7//38//MIhPcK7RT7//38/py5uvWkz6j17yAw/lsIXvevLhL17yAw/dwGIPdVXG73//38/5wUxPojXibx5yAw//8fAPajZ+r3//38/kg/+PR5rL77//38/py5uvevLhL17yAw/pzeuvajZ+r0AAIA/siISviCSvb17yAw/lsIXvevLhL17yAw/dwGIPR5rL77//38//MIhPajZ+r3//38/kg/+PSCSvb17yAw/wa2WPCCSvb17yAw/wa2WPB5rL77//38/py5uvR5rL77//38//MIhPSCSvb17yAw/lsIXvajZ+r0AAIA/siISvuvLhL17yAw/pzeuvdVXG70AAIA/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RQIAAEYCAABHAgAASAIAAEcCAABGAgAASQIAAEoCAABLAgAATAIAAEsCAABKAgAATQIAAE4CAABPAgAAUAIAAE8CAABOAgAAUQIAAFICAABTAgAAVAIAAFICAABVAgAAUwIAAFYCAABXAgAAWAIAAFcCAABWAgAAWQIAAFoCAABbAgAAXAIAAFwCAABdAgAAWgIAAF4CAABfAgAAYAIAAF8CAABeAgAAYQIAAGICAABjAgAAZAIAAGMCAABiAgAAZQIAAGYCAABnAgAAaAIAAGcCAABmAgAAaQIAAGoCAABrAgAAbAIAAGsCAABqAgAAbQIAAG4CAABvAgAAcAIAAG8CAABuAgAAcQIAAHICAABzAgAAdAIAAHQCAAB1AgAAcgIAAHYCAAB3AgAAeAIAAHcCAAB2AgAAeQIAAHoCAAB7AgAAfAIAAHsCAAB6AgAAfQIAAH4CAAB/AgAAgAIAAH8CAAB+AgAAgQIAAIICAACDAgAAhAIAAIMCAACCAgAAhQIAAIYCAACHAgAAiAIAAIgCAACHAgAAiQIAAIoCAACLAgAAjAIAAIsCAACKAgAAjQIAAI4CAACPAgAAkAIAAI4CAACQAgAAkQIAAJICAACTAgAAlAIAAJQCAACVAgAAkgIAAJYCAACXAgAAmAIAAJcCAACWAgAAmQIAAJoCAACbAgAAnAIAAJsCAACaAgAAnQIAAJ4CAACfAgAAoAIAAKACAACfAgAAoQIAAKICAACjAgAApAIAAKMCAACiAgAApQIAAKYCAACnAgAAqAIAAKcCAACmAgAAqQIAAKoCAACrAgAArAIAAKsCAACqAgAArQIAAK4CAACvAgAAsAIAALACAACvAgAAsQIAALICAACzAgAAtAIAALMCAACyAgAAtQIAALYCAAC3AgAAuAIAALgCAAC3AgAAuQIAALoCAAC7AgAAvAIAALsCAAC6AgAAvQIAAL4CAAC/AgAAwAIAAMACAADBAgAAvgIAAMICAADDAgAAxAIAAMMCAADCAgAAxQIAAMYCAADHAgAAyAIAAMYCAADIAgAAyQIAAMoCAADLAgAAzAIAAMsCAADKAgAAzQIAAM4CAADPAgAA0AIAAM4CAADQAgAA0QIAANICAADTAgAA1AIAANMCAADSAgAA1QIAANYCAADXAgAA2AIAANcCAADWAgAA2QIAANoCAADbAgAA3AIAANsCAADaAgAA3QIAAN4CAADfAgAA4AIAAN8CAADeAgAA4QIAAOICAADjAgAA5AIAAOMCAADiAgAA5QIAAOYCAADnAgAA6AIAAOcCAADpAgAA6gIAAOkCAADnAgAA5gIAAOkCAADmAgAA6wIAAOwCAADtAgAA6wIAAOwCAADrAgAA5gIAAO0CAADsAgAA7gIAAO0CAADuAgAA7wIAAO4CAADsAgAA8AIAAPACAADsAgAA8QIAAPICAADzAgAA9AIAAPMCAADyAgAA9QIAAPYCAAD3AgAA+AIAAPcCAAD5AgAA+AIAAPoCAAD7AgAA/AIAAPsCAAD6AgAA/QIAAP4CAAD/AgAAAAMAAP4CAAAAAwAAAQMAAAIDAAADAwAABAMAAAMDAAACAwAABQMAAAYDAAAHAwAACAMAAAcDAAAGAwAACQMAAAoDAAALAwAADAMAAAsDAAAKAwAADQMAAA4DAAAPAwAAEAMAAA8DAAAOAwAAEQMAABIDAAATAwAAFAMAABQDAAATAwAAFQMAABYDAAAXAwAAGAMAABgDAAAXAwAAGQMAABoDAAAbAwAAHAMAABwDAAAdAwAAGgMAAB4DAAAfAwAAIAMAAB8DAAAeAwAAIQMAACIDAAAjAwAAJAMAACMDAAAiAwAAJQMAACYDAAAnAwAAKAMAACgDAAAnAwAAKQMAACoDAAArAwAALAMAACsDAAAqAwAALQMAAC4DAAArAwAALQMAAC0DAAAvAwAALgMAADADAAAxAwAAMgMAADADAAAyAwAAMwMAADQDAAA1AwAANgMAADQDAAA2AwAANwMAADgDAAA2AwAANQMAADkDAAA6AwAAOwMAADoDAAA5AwAAPAMAAD0DAAA+AwAAPwMAAD0DAAA/AwAAQAMAAEEDAABCAwAAQwMAAEMDAABCAwAARAMAAEUDAABGAwAARwMAAEgDAABHAwAARgMAAEkDAABKAwAASwMAAEoDAABJAwAATAMAAE0DAABOAwAATwMAAFADAABPAwAATgMAAFEDAABSAwAAUwMAAFEDAABTAwAAVAMAAFUDAABWAwAAVwMAAFUDAABXAwAAWAMAAFYDAABZAwAAWgMAAFYDAABaAwAAVwMAAFsDAABcAwAAXQMAAFwDAABbAwAAXgMAAF8DAABgAwAAYQMAAGADAABfAwAAYgMAAGMDAABkAwAA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",Wv=1.9;let bo=null;function Xv(){return bo||(bo=new _u().loadAsync(Vv).then(s=>s.scene)),bo}function jv(s,e,t=null){if(t){const o=t.clone(!0),a=s.add(new pt({color:2763315,metalness:.4,roughness:.45})),c=s.add(new pt({color:15263455,metalness:.6,roughness:.3}));o.traverse(u=>{u.isMesh&&(u.material=u.name==="cup"?e:u.name==="plate"?c:a)}),o.scale.setScalar(Wv);const l=new Ft;return l.add(o),l}const n=new Ft,i=[[0,0],[.42,0],[.42,.06],[.36,.1],[.36,.15],[.22,.2],[.09,.28],[.07,.42],[.1,.5],[.16,.54],[.1,.58],[.13,.62],[.3,.68],[.44,.8],[.52,.98],[.55,1.16],[.59,1.21],[.55,1.24],[.5,1.17],[.47,1],[.38,.85],[.16,.75],[0,.73]].map(([o,a])=>new fe(o,a)),r=new Qe(s.add(new Va(i,48)),e);n.add(r);for(const o of[-1,1]){const a=new Ga([[.52,1.1],[.72,1.13],[.82,1],[.74,.85],[.46,.82]].map(([c,l])=>new R(o*c,l,0)));n.add(new Qe(s.add(new Dr(a,32,.034,10,!1)),e))}return n}function Qv(s,e){const t=ui(),{scene:n,camera:i}=di(s,e,{fogNear:25,fogFar:70});i.fov=36,hi(n,{rim:16777215,rimStrength:2});const r=(e.tones&&e.tones.length?e.tones:["gold"]).slice(0,6),o=A=>{const T=A==="gold"?br:A==="silver"?Lv:A==="bronze"?Uv:e.paint;return t.add(new pt({color:T,metalness:1,roughness:.2,envMapIntensity:1.4}))},a=t.add(new pt({color:1381660,roughness:.55,metalness:.2})),c=t.add(new ka(.62,.7,.9,40)),l=r.length,u=l<=3?l:Math.ceil(l/2),h=Math.ceil(l/u),d=r.map((A,T)=>{const y=Math.floor(T/u),v=y===h-1?l-y*u:u,E=(T-y*u-(v-1)/2)*1.9,C=-y*2.1,P=y*1,x=new Qe(c,a);x.position.set(E,P+.45,C),n.add(x);const M=jv(t,o(A),s.trophy);return M.position.set(E,P+.9,C),n.add(M),{cup:M,y:P+.9,at:.45+T*.32}}),f=ec(t,[16777215,br,16774084],{count:120,area:8,top:6,from:.6});f.points.material.size=.09,f.points.material.blending=Bi,n.add(f.points);const m=Math.max(4.2,u*1.9+1.2),g=h*1.6+1.8;return{scene:n,camera:i,update:A=>{i.aspect=s.aspect,i.updateProjectionMatrix();for(const v of d){const w=wt(A,v.at,v.at+.7),E=w<=0?1e-4:Su(w);v.cup.scale.setScalar(Math.max(1e-4,E)),v.cup.position.y=v.y+(1-Math.min(1,E))*-.4,v.cup.rotation.y=(A-v.at)*.7}f.update(A);const T=Yi(s,i,m,g,{hs:.9,vs:s.wide?.72:.55})*Gt(1.12,1,Qi(wt(A,0,3))),y=.25+Math.sin(A*.3)*.12;i.position.set(Math.sin(y)*T,g*.55+1.6,Math.cos(y)*T),i.lookAt(0,g*.32+.4,-(h-1))},still:2.4+l*.32,dispose:()=>t.dispose()}}function Kv(s,e){const t=ui(),{scene:n,camera:i}=di(s,e,{fogNear:70,fogFar:220});i.fov=40,hi(n,{rim:e.paint,rimStrength:1.6});const r=e.journey||[],o=r.length,a=Math.max(...r.map(K=>K.position)),c=Math.max(6,a+1),l=24,u=e.wide?Math.min(46,Math.max(16,(o-1)*5.5)):Math.min(26,Math.max(10,(o-1)*4.5)),h=o>1?u/(o-1):0,d=-u/2,f=K=>1.5+(c-K)/(c-1)*l,m=r.map((K,$)=>new R(d+$*h,f(K.position),0)),g=new Ga(m,!1,"centripetal"),p=.42,A=new Qe(t.add(new Dr(g,Math.max(160,o*24),p,12,!1)),t.add(new pt({color:e.paint,emissive:e.paint,emissiveIntensity:.35,metalness:.3,roughness:.35})));n.add(A);const T=t.add(new Rr(.62,20,14)),y=t.add(new pt({color:16777215,metalness:.1,roughness:.3})),v=t.add(new rn(Math.min(1.6,h*.55||1.6),1,1.6));v.translate(0,.5,0);const w=new Ns(v,t.add(new pt({color:e.paint,transparent:!0,opacity:.32,roughness:.5,depthWrite:!1})),o);t.add(w),m.forEach((K,$)=>{const le=new Qe(T,y);le.position.copy(K),n.add(le),w.setMatrixAt($,new Ne().compose(new R(K.x,0,0),new fn,new R(1,Math.max(.05,K.y-.62),1)))}),w.instanceMatrix.needsUpdate=!0,w.frustumCulled=!1,n.add(w);const E=t.add(new Ht({color:e.accent||16777215,transparent:!0,opacity:.28})),C=t.add(new rn(u+6,.08,.08)),P=[1,...[5,10,15,20,25,30,40,50,60,80].filter(K=>K<c)];for(const K of P){const $=new Qe(C,E);$.position.set(0,f(K),-1.6),n.add($);const le=Ss(t,`P${K}`,{height:1.5,bg:"rgba(0,0,0,0)"});le.sprite.position.set(d-4.6,f(K),-1.6),n.add(le.sprite)}const x=o>12?2:1;r.forEach((K,$)=>{if($%x&&$!==o-1)return;const le=Ss(t,`R${K.round}`,{height:1.2,bg:"rgba(0,0,0,0)"});le.sprite.position.set(m[$].x,-1.1,1),n.add(le.sprite)}),n.add(ci(t,ai(t,[[0,"rgba(255,255,255,0.12)"],[1,"rgba(255,255,255,0)"]]),u+30,24,{y:0}));const M=r.reduce((K,$,le)=>$.position<r[K].position?le:K,0),I=[...new Set([0,M,o-1])].map(K=>{const $=Ss(t,`P${r[K].position}`,{height:2.4});return $.sprite.position.copy(m[K]).add(new R(0,2.6,0)),n.add($.sprite),{i:K,sprite:$.sprite}}),F=ts(s,Cn(t,e.paint),t);F.scale.setScalar(.62),n.add(F);const z=new R(0,0,1),G=new Ne,j=[.6,6.8],B=new R(-.5,.25,.83).normalize(),J=new R(0,l/2+.5,0);return{scene:n,camera:i,update:K=>{i.aspect=s.aspect,i.updateProjectionMatrix();const $=si(wt(K,j[0],j[1])),le=g.getPointAt($),De=g.getTangentAt($).normalize(),Ve=new R().crossVectors(z,De).normalize();G.makeBasis(De,Ve,new R().crossVectors(De,Ve)),F.quaternion.setFromRotationMatrix(G),F.position.copy(le).addScaledVector(Ve,p);const Ye=$*(o-1);for(const Fe of I)Fe.sprite.visible=K>=j[1]||Ye>=Fe.i-.15;const ae=Yi(s,i,12,8,{hs:.9}),k=le.clone().addScaledVector(B,ae),X=le.clone().add(new R(s.wide?2.5:1,.4,0)),se=Yi(s,i,u+12,l+6,{hs:s.wide?1:.92,vs:s.wide?.92:s.vShare}),_e=J.clone().add(new R(Math.sin(-.28)*se,3,Math.cos(-.28)*se)),me=si(wt(K,j[1]-.5,j[1]+1.3));i.position.copy(k.lerp(_e,me)),i.lookAt(X.lerp(J,me))},still:8.8,dispose:()=>t.dispose()}}function Yv(s,e){const t=ui(),{scene:n,camera:i}=di(s,e,{fogNear:30,fogFar:90});i.fov=38,hi(n,{rim:e.paint,rimStrength:1.8});const r=[{place:1,x:0,h:2.3},{place:2,x:-4.1,h:1.6},{place:3,x:4.1,h:1.1}],o=t.add(new pt({color:15527666,roughness:.45,metalness:.05}));for(const f of r){const m=new Qe(t.add(new rn(3.9,f.h,3.6)),o);m.position.set(f.x,f.h/2,0),n.add(m);const g=document.createElement("canvas");g.width=g.height=128;const p=g.getContext("2d");p.fillStyle=f.place===1?"#d4a514":f.place===2?"#7b8494":"#b4652e",p.font="900 104px Archivo, Inter, system-ui, sans-serif",p.textAlign="center",p.textBaseline="middle",p.fillText(String(f.place),64,70);const A=t.add(new li(g)),T=new Qe(t.add(new Rn(Math.min(1.5,f.h*.9),Math.min(1.5,f.h*.9))),t.add(new Ht({map:A,transparent:!0})));T.position.set(f.x,f.h/2,1.81),n.add(T)}const a=r.find(f=>f.place===e.position)||r[0],c=r.filter(f=>f!==a).map(f=>$a(f.x,f.h,0,-.35,.68));n.add(Za(s,t,Cn(t,Ja),c));const l=ts(s,Cn(t,e.paint),t);l.scale.setScalar(.68),l.rotation.y=-.35,n.add(l),n.add(ci(t,ai(t,[[0,"rgba(255,255,255,0.12)"],[1,"rgba(255,255,255,0)"]]),40,40,{y:.005}));const u=ec(t,[e.paint,br,16777215,6087142],{count:280,area:18,top:14,from:1.5});n.add(u.points);const h=[.7,1.5];return{scene:n,camera:i,update:f=>{i.aspect=s.aspect,i.updateProjectionMatrix();const m=wt(f,h[0],h[1]),g=m<1?1-Su(m):0;l.position.set(a.x,a.h+Math.max(0,g)*7+(m<=0?7:0),0),l.visible=f>=h[0]-.05,u.update(f);const p=Yi(s,i,13.5,7,{hs:.92,vs:s.wide?.7:.5})*Gt(1.15,1,Qi(wt(f,0,5)));i.position.set(Math.sin(-.18)*p,3.2+p*.12,Math.cos(-.18)*p),i.lookAt(0,1.9,0)},still:4.5,dispose:()=>t.dispose()}}function qv(s,e){const t=ui(),{scene:n,camera:i}=di(s,e,{fogNear:70,fogFar:220});i.fov=44,hi(n,{rim:e.paint});const r=Math.max(1,e.position),o=Math.min(Math.max(r+3,Math.min(e.fieldSize||r,r+3)),40),a=8,c=C=>(C-1)*a,l=C=>C%2?-2.4:2.4,u=c(o)+30,h=12,d=document.createElement("canvas");d.width=168,d.height=Math.min(4096,Math.ceil(u*h));const f=d.height/u,m=d.getContext("2d");m.fillStyle="#23262d",m.fillRect(0,0,d.width,d.height),m.strokeStyle="rgba(255,255,255,0.85)",m.lineWidth=3;for(let C=1;C<=o;C++){const P=(l(C)+7)*h,x=(c(C)+10-3.2)*f;m.beginPath(),m.moveTo(P-1.4*h,x+2.4*f),m.lineTo(P-1.4*h,x),m.lineTo(P+1.4*h,x),m.lineTo(P+1.4*h,x+2.4*f),m.stroke()}m.fillStyle="rgba(255,255,255,0.9)",m.fillRect(0,0,3,d.height),m.fillRect(d.width-3,0,3,d.height);const g=t.add(new li(d));g.anisotropy=4;const p=new Qe(t.add(new Rn(14,u)),t.add(new pt({map:g,roughness:.9})));p.rotation.x=-Math.PI/2,p.position.set(0,0,u/2-10),n.add(p);const A=Math.PI/2,T=[];for(let C=1;C<=o;C++)C!==r&&T.push($a(l(C),0,c(C),A));n.add(Za(s,t,Cn(t,Ja),T));for(let C=1;C<=o;C++){const P=Ls(t);P.position.set(l(C),.015,c(C)),P.rotation.z=A,n.add(P)}const y=ts(s,Cn(t,e.paint),t);y.rotation.y=A,y.position.set(l(r),0,c(r)),n.add(y);const v=ci(t,ai(t,[[0,`${Ki(e.paint)}cc`],[1,`${Ki(e.paint)}00`]]),10,10,{y:.03,additive:!0});v.position.set(l(r),.03,c(r)),n.add(v);const w=[.5,5];return{scene:n,camera:i,update:C=>{i.aspect=s.aspect,i.updateProjectionMatrix();const P=si(wt(C,w[0],w[1])),x=Gt(c(1)-4,c(r),P),M=si(wt(C,w[1]-.6,w[1]+1.2)),I=new R(5,13,x-16),F=new R(l(r)-6,3.4,c(r)-10.5);i.position.copy(I.lerp(F,M)),i.lookAt(new R(Gt(0,l(r),M),Gt(0,.8,M),Gt(x+10,c(r),M)))},still:6.6,dispose:()=>t.dispose()}}const gs={intro:Bv,circuit:Hv,climb:Gv,trophies:Qv,journey:Kv,podium:Yv,grid:qv},$v=Object.keys(gs);function Jv(){var e,t;const s=(t=(e=document.fonts)==null?void 0:e.load)==null?void 0:t.call(e,"900 64px Archivo");return s?Promise.race([s.catch(()=>{}),new Promise(n=>setTimeout(n,800))]):Promise.resolve()}function e0(s,{still:e=!1}={}){let t;try{t=new Yg({canvas:s,antialias:!0,alpha:!0,powerPreference:"high-performance"})}catch{return null}t.outputColorSpace=bt,t.setClearColor(0,0),t.setPixelRatio(Math.min(1.5,window.devicePixelRatio||1));const n=new va(t),i=new qg,r=n.fromScene(i,.04).texture;i.dispose(),n.dispose();const o={aspect:1,w:1,h:1,env:r,template:null,maxAnisotropy:t.capabilities.getMaxAnisotropy()},a=A=>{o.wide=A,o.hShare=A?.55:1,o.vShare=A?.8:.6,o.shift=A?.21:0};a(!1);let c=null,l=null,u=0,h=0,d=!1,f=null;const m=A=>{A.preventDefault(),d=!0,f==null||f()};s.addEventListener("webglcontextlost",m);const g=Promise.all([Iv().then(A=>o.template=A).catch(()=>null),Xv().then(A=>o.trophy=A).catch(()=>null),Jv()]);function p(){if(!d){if(!c){t.clear();return}c.update(e?c.still:u),o.shift?c.camera.setViewOffset(o.w,o.h,-o.shift*o.w,0,o.w,o.h):c.camera.clearViewOffset(),t.render(c.scene,c.camera)}}return{ready:g,async setScene(A){const T=++h,y=A?JSON.stringify(A):null;y!==l&&(await g,!(T!==h||d)&&(c==null||c.dispose(),c=null,l=y,a(!!(A!=null&&A.wide)),o.marker=!!(A!=null&&A.marker),A&&gs[A.kind]&&(c=gs[A.kind](o,A)),p()))},render(A){u=A,p()},resize(A,T){d||!(A>0&&T>0)||(t.setSize(A,T,!1),o.aspect=A/T,o.w=A,o.h=T,p())},still(A,T,y,v){if(d||!A||!gs[A.kind])return null;const w=new Gn(y,v,{samples:4}),E=o.aspect,C=o.wide;o.aspect=y/v,a(!1),o.marker=!!A.marker;const P=gs[A.kind](o,{...A,wide:!1});try{P.update(T??P.still),t.setRenderTarget(w),t.setClearColor(0,0),t.clear(),t.render(P.scene,P.camera);const x=new Uint8Array(y*v*4);t.readRenderTargetPixels(w,0,0,y,v,x);const M=document.createElement("canvas");M.width=y,M.height=v;const I=M.getContext("2d"),F=I.createImageData(y,v);for(let z=0;z<v;z++)F.data.set(x.subarray((v-1-z)*y*4,(v-z)*y*4),z*y*4);return I.putImageData(F,0,0),M}catch{return null}finally{t.setRenderTarget(null),w.dispose(),P.dispose(),o.aspect=E,a(C),p()}},onLost(A){f=A},dispose(){h+=1,c==null||c.dispose(),c=null,s.removeEventListener("webglcontextlost",m),r.dispose(),t.dispose(),t.forceContextLoss()}}}export{$v as SCENE_KINDS,e0 as createWrappedStage};
