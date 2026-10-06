(() => {
  "use strict";

  const pads = [...document.querySelectorAll(".pad")];
  const statusEl = document.getElementById("status");
  const selectedName = document.getElementById("selectedName");
  const readout = document.getElementById("readout");
  const mainWave = document.getElementById("mainWave");
  const waveTouch = document.getElementById("waveTouch");
  const micButton = document.getElementById("micButton");
  const deleteModeButton = document.getElementById("deleteMode");
  const resetEditButton = document.getElementById("resetEdit");

  let audioCtx = null;
  let micStream = null;
  let mediaRecorder = null;
  let chunks = [];
  let recordingPad = -1;
  let selectedPad = 0;
  let deleteMode = false;
  let pointerStates = new Map();

  const data = Array.from({length:4}, () => ({
    blob: null,
    buffer: null,
    waveform: null,
    source: null,
    gain: null,
    playing: false,
    editPitch: 0
  }));

  function setStatus(t){ statusEl.textContent = t; }

  async function ensureAudio(){
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === "suspended") await audioCtx.resume();
  }

  async function activateMic(){
    try{
      await ensureAudio();
      if(!navigator.mediaDevices?.getUserMedia) throw new Error("Micrófono no disponible");
      micStream = await navigator.mediaDevices.getUserMedia({audio:true});
      micButton.classList.add("active");
      micButton.textContent = "● MICRÓFONO ACTIVO";
      setStatus("MICRÓFONO LISTO · tocá un pad vacío");
    }catch(err){
      setStatus("NO SE PUDO ACTIVAR EL MICRÓFONO · revisá el permiso del navegador");
    }
  }

  function drawWave(canvas, samples, active=false){
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "#0b0b0a";
    ctx.fillRect(0,0,w,h);
    if(!samples || !samples.length) return;

    ctx.strokeStyle = active ? "#ffe16b" : "#f5c400";
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    const step = Math.max(1, Math.floor(samples.length / w));
    for(let x=0;x<w;x++){
      const start = x*step;
      const end = Math.min(samples.length, start+step);
      let peak = 0;
      for(let i=start;i<end;i++) peak = Math.max(peak, Math.abs(samples[i]));
      const y = h/2 - peak*(h*.43);
      if(x===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();

    ctx.strokeStyle = "#ffffff18";
    ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.stroke();
  }

  function makeWaveform(buffer, count=1800){
    const ch = buffer.getChannelData(0);
    const out = new Float32Array(Math.min(count, ch.length));
    const block = ch.length/out.length;
    for(let i=0;i<out.length;i++){
      const start=Math.floor(i*block), end=Math.min(ch.length,Math.floor((i+1)*block));
      let peak=0;
      for(let j=start;j<end;j++) peak=Math.max(peak,Math.abs(ch[j]));
      out[i]=peak;
    }
    return out;
  }

  function redrawAll(){
    data.forEach((d,i)=>{
      const label = pads[i].querySelector(".pad-label");
      label.textContent = d.buffer ? `${d.buffer.duration.toFixed(2)}s` : "EMPTY";
      drawWave(pads[i].querySelector(".mini-wave"), d.waveform, i===selectedPad);
    });
    const d=data[selectedPad];
    selectedName.textContent = `PAD ${String(selectedPad+1).padStart(2,"0")} · ${d.buffer ? d.buffer.duration.toFixed(2)+" SEC" : "SIN AUDIO"}`;
    readout.textContent = `PITCH ${d.editPitch >= 0 ? "+" : ""}${d.editPitch} · SPEED 1.00×`;
    drawWave(mainWave,d.waveform,true);
  }

  async function startRecording(i){
    if(recordingPad !== -1 || data[i].buffer) return;
    if(!micStream) { await activateMic(); if(!micStream) return; }
    chunks=[];
    mediaRecorder = new MediaRecorder(micStream);
    recordingPad=i;
    pads[i].classList.add("recording");
    setStatus(`GRABANDO PAD ${String(i+1).padStart(2,"0")} · soltá para terminar`);
    mediaRecorder.ondataavailable=e=>{ if(e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop=async()=>{
      try{
        const blob=new Blob(chunks,{type:mediaRecorder.mimeType || "audio/webm"});
        const arr=await blob.arrayBuffer();
        await ensureAudio();
        const buffer=await audioCtx.decodeAudioData(arr);
        data[i].blob=blob;
        data[i].buffer=buffer;
        data[i].waveform=makeWaveform(buffer);
        data[i].editPitch=0;
        selectedPad=i;
        redrawAll();
        setStatus(`PAD ${String(i+1).padStart(2,"0")} GRABADO · tocá para reproducir`);
      }catch(e){
        setStatus("NO SE PUDO LEER LA GRABACIÓN");
      }
      pads[i].classList.remove("recording");
      recordingPad=-1;
    };
    mediaRecorder.start();
  }

  function stopRecording(){
    if(mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  }

  function stopSource(i){
    const d=data[i];
    if(d.source){
      try{d.source.stop()}catch(e){}
      d.source=null;
    }
    if(d.gain){ try{d.gain.disconnect()}catch(e){} d.gain=null; }
    d.playing=false;
    pads[i].classList.remove("playing");
  }

  async function playPad(i, hold=true, tempPitch=0, tempSpeed=1){
    const d=data[i];
    if(!d.buffer) return;
    await ensureAudio();
    stopSource(i);

    const source=audioCtx.createBufferSource();
    const gain=audioCtx.createGain();
    const semitones=d.editPitch + tempPitch;
    source.buffer=d.buffer;
    source.playbackRate.value=Math.max(.25, Math.min(4, tempSpeed));
    source.detune.value=semitones*100;
    source.loop=hold;
    gain.gain.setValueAtTime(0,audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(1,audioCtx.currentTime+.012);
    source.connect(gain).connect(audioCtx.destination);
    source.start();
    d.source=source; d.gain=gain; d.playing=true;
    pads[i].classList.add("playing");
    source.onended=()=>{
      if(d.source===source){d.source=null;d.playing=false;pads[i].classList.remove("playing");}
    };
  }

  function releasePad(i){
    const d=data[i];
    if(!d.source || !d.gain) return;
    const now=audioCtx.currentTime;
    d.gain.gain.cancelScheduledValues(now);
    d.gain.gain.setValueAtTime(Math.max(.001,d.gain.gain.value),now);
    d.gain.gain.linearRampToValueAtTime(.0001,now+.5);
    try{d.source.stop(now+.51)}catch(e){}
  }

  function deletePad(i){
    stopSource(i);
    data[i]={blob:null,buffer:null,waveform:null,source:null,gain:null,playing:false,editPitch:0};
    selectedPad=i;
    redrawAll();
    setStatus(`PAD ${String(i+1).padStart(2,"0")} BORRADO`);
    deleteMode=false;
    deleteModeButton.classList.remove("active");
  }

  pads.forEach((pad,i)=>{
    pad.addEventListener("pointerdown", async e=>{
      e.preventDefault();
      pad.setPointerCapture(e.pointerId);
      selectedPad=i;
      redrawAll();

      if(deleteMode){ deletePad(i); return; }

      const d=data[i];
      if(!d.buffer){
        pointerStates.set(e.pointerId,{i,startX:e.clientX,startY:e.clientY,moved:false,mode:"record"});
        await startRecording(i);
      }else{
        pointerStates.set(e.pointerId,{i,startX:e.clientX,startY:e.clientY,moved:false,mode:"play",pitch:0,speed:1});
        await playPad(i,true,0,1);
      }
    });

    pad.addEventListener("pointermove", e=>{
      const s=pointerStates.get(e.pointerId);
      if(!s || s.mode!=="play") return;
      const dx=e.clientX-s.startX, dy=e.clientY-s.startY;
      const threshold=28;
      if(Math.hypot(dx,dy)<threshold) return;
      s.moved=true;

      const pitch=Math.max(-12,Math.min(12,Math.round(-dy/22)));
      const speed=Math.max(.5,Math.min(2,1+dx/260));
      s.pitch=pitch; s.speed=speed;
      readout.textContent=`PITCH ${pitch>=0?"+":""}${pitch} · SPEED ${speed.toFixed(2)}×`;
      playPad(s.i,true,pitch,speed);
    });

    pad.addEventListener("pointerup", e=>{
      const s=pointerStates.get(e.pointerId);
      if(s?.mode==="record") stopRecording();
      else if(s?.mode==="play") releasePad(i);
      pointerStates.delete(e.pointerId);
    });
    pad.addEventListener("pointercancel", e=>{
      const s=pointerStates.get(e.pointerId);
      if(s?.mode==="record") stopRecording();
      else releasePad(i);
      pointerStates.delete(e.pointerId);
    });
  });

  waveTouch.addEventListener("pointerdown",e=>{
    if(!data[selectedPad].buffer) return;
    waveTouch.setPointerCapture(e.pointerId);
    pointerStates.set(e.pointerId,{startX:e.clientX,startY:e.clientY,lastX:e.clientX,lastY:e.clientY});
  });

  waveTouch.addEventListener("pointermove",e=>{
    const s=pointerStates.get(e.pointerId);
    const d=data[selectedPad];
    if(!s || !d.buffer) return;
    const dx=e.clientX-s.startX, dy=e.clientY-s.startY;
    const threshold=30;
    if(Math.hypot(dx,dy)<threshold) return;

    if(Math.abs(dy)>=Math.abs(dx)){
      d.editPitch=Math.max(-24,Math.min(24,Math.round(-dy/25)));
      readout.textContent=`PITCH ${d.editPitch>=0?"+":""}${d.editPitch} · SPEED 1.00×`;
    }else{
      // Scratch: map horizontal position to a moving point in the buffer.
      const ratio=Math.max(0,Math.min(1,(e.clientX-waveTouch.getBoundingClientRect().left)/waveTouch.clientWidth));
      const when=ratio*d.buffer.duration;
      const source=d.source;
      if(!source){
        ensureAudio().then(()=>{
          if(!data[selectedPad].buffer) return;
          const src=audioCtx.createBufferSource();
          const gain=audioCtx.createGain();
          src.buffer=d.buffer;
          src.detune.value=d.editPitch*100;
          gain.gain.value=.75;
          src.connect(gain).connect(audioCtx.destination);
          src.start(0,Math.max(0,Math.min(d.buffer.duration-.01,when)));
          d.source=src; d.gain=gain; d.playing=true;
          src.onended=()=>{if(d.source===src){d.source=null;d.playing=false;}};
        });
      }else{
        try{source.playbackRate.value=Math.max(.25,Math.min(4,1+dx/80));}catch(e){}
      }
      setStatus(dx>=0 ? "SCRATCH →" : "SCRATCH ←");
    }
    s.lastX=e.clientX;s.lastY=e.clientY;
  });

  function endWave(e){
    const s=pointerStates.get(e.pointerId);
    if(s){
      if(data[selectedPad].source && !data[selectedPad].playing) data[selectedPad].source=null;
      pointerStates.delete(e.pointerId);
    }
  }
  waveTouch.addEventListener("pointerup",endWave);
  waveTouch.addEventListener("pointercancel",endWave);

  deleteModeButton.addEventListener("click",()=>{
    deleteMode=!deleteMode;
    deleteModeButton.classList.toggle("active",deleteMode);
    setStatus(deleteMode ? "MODO BORRAR · tocá el pad que querés eliminar" : "MODO BORRAR CANCELADO");
  });

  resetEditButton.addEventListener("click",()=>{
    data[selectedPad].editPitch=0;
    redrawAll();
    setStatus("PITCH PERMANENTE RESTAURADO");
  });

  micButton.addEventListener("click",activateMic);

  redrawAll();
})();