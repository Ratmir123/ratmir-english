'use client';

import { memo, useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type PointerEvent } from 'react';
import type { VoiceState, VoiceMeterStore } from './use-voice';
import { advanceSpring, createLensRenderer, eyePath, type Spring } from './voice-orb-renderer';
import styles from './voice-orb.module.css';

export type OrbEmotion = 'calm' | 'attentive' | 'curious' | 'friendly' | 'pleased' | 'supportive';
type VoiceOrbProps = { state: VoiceState; volume?: number; meterStore?: VoiceMeterStore; emotion?: OrbEmotion; statusDescription?: string };
const expressions: Record<VoiceState, OrbEmotion> = { idle:'calm',listening:'attentive',speaking:'friendly',transcribing:'curious',thinking:'curious',paused:'calm' };
const descriptions: Record<VoiceState,string>={idle:'Ждёт твоего ответа',listening:'Слушает тебя',speaking:'Говорит',transcribing:'Распознаёт запись',thinking:'Готовит ответ',paused:'Пауза'};
function subscribeVisibility(onChange:()=>void) { document.addEventListener('visibilitychange',onChange);return()=>document.removeEventListener('visibilitychange',onChange); }
function pageVisible(){return document.visibilityState==='visible';}
function serverVisible(){return true;}
function noMeter(){return()=>{};}
function silentMeter(){return 0;}
function subscribeReducedMotion(onChange:()=>void){const query=window.matchMedia('(prefers-reduced-motion: reduce)');query.addEventListener('change',onChange);return()=>query.removeEventListener('change',onChange);}
function reducedMotion(){return window.matchMedia('(prefers-reduced-motion: reduce)').matches;}
function serverMotion(){return false;}
const spring=(value=0):Spring=>({value,velocity:0});
// A smooth, brief expression between blinks; no random success signal or abrupt pose swap.
function expressionPulse(time:number,period:number,centre:number,radius:number){
  const distance=Math.abs(time%period-centre);
  return distance<radius?Math.pow((1+Math.cos(distance/radius*Math.PI))*.5,2):0;
}

export const VoiceOrb=memo(function VoiceOrb({state,volume=0,meterStore,emotion,statusDescription}:VoiceOrbProps){
  const visible=useSyncExternalStore(subscribeVisibility,pageVisible,serverVisible);
  const reduced=useSyncExternalStore(subscribeReducedMotion,reducedMotion,serverMotion);
  const measured=useSyncExternalStore(meterStore?.subscribe??noMeter,meterStore?.getSnapshot??silentMeter,silentMeter);
  const button=useRef<HTMLButtonElement>(null),canvas=useRef<HTMLCanvasElement>(null),body=useRef<HTMLDivElement>(null),face=useRef<HTMLDivElement>(null),shadow=useRef<HTMLDivElement>(null);
  const paths=useRef<(SVGPathElement|null)[]>([]),eyeElements=useRef<(SVGSVGElement|null)[]>([]);
  const bounds=useRef<DOMRect|null>(null);
  const [inView,setInView]=useState(true),[lensReady,setLensReady]=useState(false);
  const interaction=useRef({pressed:false,winkUntil:0,gazeX:0,gazeY:0,keyboard:false,reaction:0});
  const input=useRef({state,emotion:emotion??expressions[state],level:0,visible:true,reduced:false});
  const springs=useRef({energy:spring(),press:spring(),x:spring(),y:spring(),joy:[spring(),spring()],open:[spring(1),spring(1)],tilt:[spring(),spring()]});
  const live=state==='listening'||state==='speaking';
  const actualLevel=meterStore?measured:volume;
  input.current={state,emotion:emotion??expressions[state],level:live&&Number.isFinite(actualLevel)?Math.max(0,Math.min(1,actualLevel)):0,visible:visible&&inView,reduced};
  useEffect(()=>{
    if(!button.current||typeof IntersectionObserver==='undefined')return;
    const observer=new IntersectionObserver(([entry])=>setInView(entry.isIntersecting));observer.observe(button.current);return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(visible&&inView)return;
    interaction.current={...interaction.current,pressed:false,winkUntil:0,gazeX:0,gazeY:0,keyboard:false};bounds.current=null;
  },[visible,inView]);
  useEffect(()=>{
    const lens=canvas.current,container=body.current;if(!lens||!container)return;
    let renderer=createLensRenderer(lens),frame=0,last=0,phase=0,lastPaint=0;
    setLensReady(!!renderer);
    const size=()=>{
      const box=container.getBoundingClientRect();renderer?.resize(box.width,box.height);
      // Resizing clears a WebGL buffer, including when reduced motion has stopped the RAF.
      const value=input.current,s=springs.current;
      renderer?.draw(value.reduced||value.state==='paused'?0:phase,s.energy.value,s.x.value,s.y.value);
    };
    const observer=new ResizeObserver(size);observer.observe(container);size();
    function lost(event:Event){event.preventDefault();setLensReady(false);renderer?.dispose();renderer=null;}
    function restored(){renderer=createLensRenderer(lens!);setLensReady(!!renderer);size();}
    lens.addEventListener('webglcontextlost',lost);lens.addEventListener('webglcontextrestored',restored);
    function draw(now:number){
      frame=0;const value=input.current;
      if(!value.visible){last=0;return;}
      const dt=last?Math.min(.024,(now-last)/1000):1/60;last=now;
      const motion=!value.reduced&&value.state!=='paused';if(motion)phase+=dt;
      const gesture=interaction.current,s=springs.current;
      const keyboard=gesture.keyboard&&now<gesture.winkUntil+100;
      const move=(item:Spring,target:number,stiffness=190,damping=22)=>{if(value.reduced||keyboard){item.value=target;item.velocity=0;}else advanceSpring(item,target,dt,stiffness,damping);};
      move(s.energy,value.reduced?0:value.level,135,21);
      move(s.press,value.reduced?0:gesture.pressed?1:0,245,20);
      move(s.x,value.reduced?0:gesture.gazeX,145,19);move(s.y,value.reduced?0:gesture.gazeY,145,19);
      const wink=now<gesture.winkUntil;
      const blinkPhase=phase%6.7,blink=motion?1-Math.exp(-Math.pow((blinkPhase-6.43)/.075,2))*.90:1;
      const reaction=wink?gesture.reaction%3+1:0;
      const interested=motion?expressionPulse(phase,17.4,8.2,1.8):0;
      const curious=reaction===3?1:interested*(value.state==='listening'||value.state==='thinking'||value.state==='transcribing'?.9:.6);
      const spontaneousJoy=motion?expressionPulse(phase,value.state==='speaking'?8.6:13.1,value.state==='speaking'?2.4:4.4,1.1)*(value.state==='listening'?.18:.76):0;
      for(let i=0;i<2;i++){
        const mood=value.emotion;
        const open=(mood==='attentive'?1.10:mood==='curious'?(i===0?1.02:.64):mood==='supportive'?.78:1)+curious*(i===0?.16:-.24);
        const tilt=(mood==='curious'?(i===0?-9:10):mood==='supportive'?(i===0?-10:10):mood==='friendly'?(i===0?-4:4):0)+curious*(i===0?-13:12);
        const joy=reaction===2?1:reaction===1?(i===1?1:.18):mood==='pleased'?1:mood==='supportive'||value.state==='thinking'||value.state==='transcribing'?0:spontaneousJoy;
        move(s.joy[i],joy,205,23);move(s.open[i],open,205,23);move(s.tilt[i],tilt,205,23);
        paths.current[i]?.setAttribute('d',eyePath(s.open[i].value*blink,s.joy[i].value));
        eyeElements.current[i]?.style.setProperty('transform',`rotate(${s.tilt[i].value}deg)`);
      }
      const breath=motion?Math.sin(phase*1.45):0,sway=motion?Math.sin(phase*.91):0;
      const scaleX=1+breath*.018+s.energy.value*.055+s.press.value*.055;
      const scaleY=1-breath*.016+s.energy.value*.085-s.press.value*.09;
      const floating=breath*4-s.energy.value*3;
      container!.style.transform=`translate(${s.x.value*7}px,${floating+s.y.value*3}px) rotate(${sway*(value.state==='thinking'?4.5:1.6)+s.x.value*4}deg) scale(${scaleX},${scaleY})`;
      if(shadow.current){
        const height=Math.max(-1,Math.min(1,-floating/7));
        shadow.current.style.transform=`scale(${1+height*.07+s.press.value*.04},${1+height*.13-s.press.value*.04})`;
        shadow.current.style.opacity=String(1-height*.18+s.press.value*.08);
      }
      if(face.current)face.current.style.transform=`translate(${s.x.value*8+(value.state==='thinking'?sway*2:0)}px,${s.y.value*5}px)`;
      // Idle breathing is painted at 30Hz; voice and physical touch at up to 60Hz.
      if(now-lastPaint>=(value.state==='idle'&&!wink&&!gesture.pressed?32:15)||value.reduced){renderer?.draw(motion?phase:0,s.energy.value,s.x.value,s.y.value);lastPaint=now;}
      const unsettled=[s.energy,s.press,s.x,s.y,...s.joy,...s.open,...s.tilt].some(item=>Math.abs(item.velocity)>.01);
      if(motion||(!value.reduced&&unsettled)||wink)frame=requestAnimationFrame(draw);
    }
    const wake=()=>{if(!frame&&input.current.visible)frame=requestAnimationFrame(draw);};
    const timerSignals=['visibilitychange','pointermove','pointerdown','pointerup','click','focusout'];
    timerSignals.forEach(name=>document.addEventListener(name,wake));
    const onMotion=()=>{last=0;wake();};const query=window.matchMedia('(prefers-reduced-motion: reduce)');query.addEventListener('change',onMotion);
    const onWake=()=>wake();button.current?.addEventListener('orbwake',onWake);
    wake();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();renderer?.dispose();lens.removeEventListener('webglcontextlost',lost);lens.removeEventListener('webglcontextrestored',restored);timerSignals.forEach(name=>document.removeEventListener(name,wake));query.removeEventListener('change',onMotion);button.current?.removeEventListener('orbwake',onWake);};
  },[]);
  useEffect(()=>{button.current?.dispatchEvent(new Event('orbwake'));},[visible,inView,state,emotion,actualLevel,reduced]);
  function look(event:PointerEvent<HTMLButtonElement>){
    if(reduced||!visible||!inView||document.documentElement.dataset.input==='keyboard')return;
    if(event.pointerType==='touch'&&!interaction.current.pressed)return;
    const box=bounds.current;if(!box)return;
    interaction.current.gazeX=Math.max(-1,Math.min(1,(event.clientX-box.left)/box.width*2-1));
    interaction.current.gazeY=Math.max(-1,Math.min(1,(event.clientY-box.top)/box.height*2-1));
  }
  function release(){interaction.current.pressed=false;interaction.current.gazeX=0;interaction.current.gazeY=0;bounds.current=null;}
  function greet(event:MouseEvent<HTMLButtonElement>){interaction.current.reaction+=1;interaction.current.winkUntil=performance.now()+740;interaction.current.keyboard=event.detail===0;}
  return <button type="button" ref={button} className={`voice-orb ${styles.orb}`} data-state={state} data-emotion={emotion??expressions[state]} data-lens-ready={lensReady} data-page-hidden={!visible||!inView}
    aria-label={`Твой собеседник. ${statusDescription??descriptions[state]}. Коснись, чтобы поздороваться.`} title="Коснись, чтобы поздороваться"
    onClick={greet} onPointerEnter={event=>{bounds.current=event.currentTarget.getBoundingClientRect();look(event);}}
    onPointerMove={look} onPointerDown={event=>{if(event.isPrimary&&event.button===0){bounds.current=event.currentTarget.getBoundingClientRect();interaction.current.keyboard=false;interaction.current.pressed=true;look(event);}}}
    onPointerUp={()=>{interaction.current.pressed=false;}} onPointerCancel={release} onPointerLeave={release} onBlur={release}>
      <div ref={shadow} className={styles.shadow} aria-hidden="true"/>
      <div ref={body} className={`orb-body ${styles.body}`} aria-hidden="true">
        <div className={styles.fallback}/>
        <canvas ref={canvas} className={styles.lens}/>
        <div className={styles.face} ref={face}><div className={styles.eyes}>
          {[0,1].map(index=><svg key={index} ref={value=>{eyeElements.current[index]=value;}} className={styles.eye} viewBox="0 0 20 32" focusable="false"><path ref={value=>{paths.current[index]=value;}} d={eyePath(1,emotion==='pleased'?1:0)} fill="#fdfeff"/></svg>)}
        </div></div>
      </div>
    </button>;
});
