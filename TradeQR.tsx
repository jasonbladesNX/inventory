import React,{useMemo} from 'react';
import QRCode from './vendor/qr/index';
import QRErrorCorrectLevel from './vendor/qr/QRErrorCorrectLevel';
export default function TradeQR({url}:{url:string}){
 const cells=useMemo(()=>{try{const qr=new QRCode(0,QRErrorCorrectLevel.M);qr.addData(url);qr.make();const n=qr.getModuleCount();return Array.from({length:n},(_,r)=>Array.from({length:n},(_,c)=>!!qr.isDark(r,c)))}catch{return null}},[url]);
 if(!cells)return <p role="alert">This invitation is too long to encode as a QR code. Use Copy link instead.</p>;
 const quiet=4,n=cells.length;return <svg role="img" aria-label="Scannable QR trade invitation" viewBox={`0 0 ${n+quiet*2} ${n+quiet*2}`} className="trade-qr" shapeRendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff"/>{cells.map((row,r)=>row.map((dark,c)=>dark?<rect key={`${r}-${c}`} x={c+quiet} y={r+quiet} width="1" height="1" fill="#111"/>:null))}</svg>;
}
