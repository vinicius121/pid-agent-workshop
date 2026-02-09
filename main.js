// main.js — UFO PID Workshop UI (clean version)
// ------------------------------------------------------------
// Design goals:
// - The animation loop NEVER calls the LLM.
// - LLM calls happen only when the user presses:
//     (1) "Suggest gains"  -> 1 model call
//     (2) "Auto-tune"      -> up to N model calls (N=3 by default)
// - The agent backend is served at http://127.0.0.1:9500
//
// Frontend loop calls /control frequently to advance the deterministic plant.
//
// Concepts for students:
// - Agent.instructions = "global rules" (SYSTEM)
// - user_prompt        = "this specific case" (USER)

const API = "http://127.0.0.1:9500";

// -----------------------------
// Small helpers
// -----------------------------
const el = (id) => document.getElementById(id);
const fmt = (x, n=2) => (Number.isFinite(x) ? x.toFixed(n) : "NaN");
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

async function postJSON(url, body){
  const res = await fetch(url, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify(body),
  });
  if(!res.ok){
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t}`);
  }
  return await res.json();
}

// -----------------------------
// UI elements
// -----------------------------
const world = el("world");
const wctx = world.getContext("2d");

const errPlot = el("errPlot");
const ectx = errPlot.getContext("2d");

const uPlot = el("uPlot");
const uctx = uPlot.getContext("2d");

const tuneStyle = el("tuneStyle");

const dtIn = el("dt");
const theta0In = el("theta0");

const playBtn = el("playBtn");
const resetBtn = el("resetBtn");

const kp = el("kp");
const ki = el("ki");
const kd = el("kd");
const kpVal = el("kpVal");
const kiVal = el("kiVal");
const kdVal = el("kdVal");

const suggestBtn = el("suggestBtn");
const kickBtn = el("kickBtn");
const zeroBtn = el("zeroBtn");

const pillMode = el("pillMode");
const pillTask = el("pillTask");
const pillState = el("pillState");
const metaBox = el("metaBox");

// -----------------------------
// Simulation state
// -----------------------------
let playing = false;

// State matches UFOState in ufo_sim.py
let state = {
  theta: 3.0,
  omega: 0.0,
  integ: 0.0,
  e_prev: 0.0,
  paused: true,
};

let thetaRef = 0.0; // target attitude (always 0 in this demo)
let lastU = 0.0;

// display stats
let simTime = 0.0;
let fuel = 0.0;

// history buffers for plots
let errBuf = [];
let uBuf = [];
const BUF_MAX = 220;

// -----------------------------
// UI wiring
// -----------------------------
function syncSliderText(){
  kpVal.textContent = fmt(Number(kp.value), 1);
  kiVal.textContent = fmt(Number(ki.value), 2);
  kdVal.textContent = fmt(Number(kd.value), 1);
}

[kp, ki, kd].forEach(inp => inp.addEventListener("input", syncSliderText));
syncSliderText();

pillTask.textContent = "System: UFO";
pillMode.textContent = `Mode: ${tuneStyle.value}`;
pillState.textContent = "e=0.00 u=0.0";

tuneStyle.addEventListener("change", () => {
  pillMode.textContent = `Mode: ${tuneStyle.value}`;
});

function setPlaying(on){
  playing = on;
  state.paused = !on;
  playBtn.textContent = on ? "Pause" : "Play";
}
setPlaying(false);

function resetSim(){
  state.theta = Number(theta0In.value);
  state.omega = 0.0;
  state.integ = 0.0;
  state.e_prev = 0.0;

  errBuf = [];
  uBuf = [];
  lastU = 0.0;

  simTime = 0.0;
  fuel = 0.0;

  pillState.textContent = "e=0.00 u=0.0";
  metaBox.textContent = "—";
}

playBtn.addEventListener("click", () => setPlaying(!playing));
resetBtn.addEventListener("click", () => { resetSim(); });

kickBtn.addEventListener("click", () => {
  // 20 degrees ≈ 0.349 rad
  state.theta = clamp(state.theta + (Math.PI / 9), -Math.PI, Math.PI);
});

zeroBtn.addEventListener("click", () => {
  state.theta = 0.0;
  state.omega = 0.0;
  state.integ = 0.0;
  state.e_prev = 0.0;
});

// -----------------------------
// Drag interaction
// - left/right sets theta
// - up/down sets omega
// -----------------------------
let dragging = false;

function pointerToCanvas(ev){
  const rect = world.getBoundingClientRect();
  const clientX = (ev.touches && ev.touches.length) ? ev.touches[0].clientX : ev.clientX;
  const clientY = (ev.touches && ev.touches.length) ? ev.touches[0].clientY : ev.clientY;
  const px = (clientX - rect.left) * (world.width / rect.width);
  const py = (clientY - rect.top) * (world.height / rect.height);
  return {px, py};
}

function applyDrag(ev){
  const {px, py} = pointerToCanvas(ev);
  const cx = world.width * 0.5;
  const cy = world.height * 0.55;

  const theta = ((px - cx) / (world.width * 0.45)) * Math.PI; // [-pi, pi] roughly
  const omega = -((py - cy) / (world.height * 0.35)) * 2.0;   // [-2, 2] roughly

  state.theta = clamp(theta, -Math.PI, Math.PI);
  state.omega = clamp(omega, -2.0, 2.0);
}

world.addEventListener("mousedown", (ev) => { dragging = true; applyDrag(ev); });
window.addEventListener("mousemove", (ev) => { if(dragging) applyDrag(ev); });
window.addEventListener("mouseup", () => { dragging = false; });

world.addEventListener("touchstart", (ev) => { dragging = true; applyDrag(ev); ev.preventDefault(); }, {passive:false});
world.addEventListener("touchmove", (ev) => { if(dragging) applyDrag(ev); ev.preventDefault(); }, {passive:false});
world.addEventListener("touchend", () => { dragging = false; });

// -----------------------------
// LLM buttons (the ONLY times we call the agent)
// -----------------------------
function buildTunePayload(){
  return {
    dt: Number(dtIn.value),
    theta0: Number(theta0In.value),
  };
}

suggestBtn.addEventListener("click", async () => {
  metaBox.textContent = "Calling /tune ...";
  try{
    const style = tuneStyle.value;
    const out = await postJSON(`${API}/tune?style=${encodeURIComponent(style)}`, buildTunePayload());
    kp.value = out.kp; ki.value = out.ki; kd.value = out.kd;
    syncSliderText();
    metaBox.textContent = JSON.stringify(out.meta, null, 2);
  }catch(e){
    metaBox.textContent = `Tune error: ${e}`;
  }
});


// -----------------------------
// Control loop (deterministic, frequent)
// -----------------------------
async function stepOnce(){
  const payload = {
    dt: Number(dtIn.value),
    theta_ref: thetaRef,
    kp: Number(kp.value),
    ki: Number(ki.value),
    kd: Number(kd.value),
    state,
  };

  const out = await postJSON(`${API}/control`, payload);

  state = out.state;
  const e = out.error;
  const u = out.u;
  lastU = u;

  // buffers for plots
  errBuf.push(e);
  if(errBuf.length > BUF_MAX) errBuf.shift();

  uBuf.push(u);
  if(uBuf.length > BUF_MAX) uBuf.shift();

  // time + fuel
  if(!state.paused){
    const dtv = Number(dtIn.value);
    simTime += dtv;
    fuel += Math.abs(u) * dtv;
  }

  pillState.textContent = `e=${fmt(e,2)} u=${fmt(u,2)}`;
}

let stepping = false;
setInterval(async () => {
  if(stepping) return;      // avoid overlap if network is slow
  stepping = true;
  try{
    await stepOnce();
  }catch(e){
    // keep UI alive even if backend momentarily unavailable
    pillState.textContent = "backend error";
  }finally{
    stepping = false;
  }
}, 50);

// -----------------------------
// Drawing
// -----------------------------
function draw(){
  drawWorld();
  drawErrorPlot();
  drawUPlot();
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

function drawWorld(){
  const W = world.width, H = world.height;
  wctx.clearRect(0,0,W,H);

  // background vignette
  const grad = wctx.createRadialGradient(W*0.5,H*0.2, 80, W*0.5,H*0.2, W*1.2);
  grad.addColorStop(0, "rgba(24,38,64,0.65)");
  grad.addColorStop(1, "rgba(8,12,20,0.0)");
  wctx.fillStyle = grad;
  wctx.fillRect(0,0,W,H);

  // grid
  wctx.globalAlpha = 0.55;
  wctx.strokeStyle = "rgba(120,150,220,0.22)";
  for(let x=0; x<=W; x+=56){
    wctx.beginPath(); wctx.moveTo(x,0); wctx.lineTo(x,H); wctx.stroke();
  }
  for(let y=0; y<=H; y+=56){
    wctx.beginPath(); wctx.moveTo(0,y); wctx.lineTo(W,y); wctx.stroke();
  }
  wctx.globalAlpha = 1.0;

  // axes cross
  const cx = W * 0.5;
  const cy = H * 0.55;
  wctx.strokeStyle = "rgba(230,238,252,0.18)";
  wctx.lineWidth = 1.2;
  wctx.beginPath(); wctx.moveTo(cx, 30); wctx.lineTo(cx, H-30); wctx.stroke();
  wctx.beginPath(); wctx.moveTo(40, cy); wctx.lineTo(W-40, cy); wctx.stroke();

  // UFO patch (MATLAB-style)
  drawUFO(wctx, cx, cy, state.theta, lastU);

  // HUD
  wctx.fillStyle = "rgba(230,238,252,0.86)";
  wctx.font = "13px ui-sans-serif, system-ui";
  wctx.fillText(
    `t=${fmt(simTime,1)}s  fuel=${fmt(fuel,1)}  |  θ=${fmt(state.theta,2)} rad  ω=${fmt(state.omega,2)} rad/s  dt=${fmt(Number(dtIn.value),3)}`,
    16, 22
  );
  wctx.fillStyle = "rgba(230,238,252,0.62)";
  wctx.font = "12px ui-sans-serif, system-ui";
  wctx.fillText("drag: θ (left/right), ω (up/down) • buttons: kick / zero", 16, 40);
}

function drawUFO(ctx, x, y, thetaRad, u){
  // MATLAB patch data (ufo_data + thrust), ported to JS
  const ufoData = [
    [0.54,0.12],[0.48,0.24],[0.42,0.31],[0.3,0.4],[0.18,0.45],[0.06,0.48],[-0.06,0.48],[-0.18,0.45],[-0.3,0.4],[-0.42,0.31],[-0.48,0.24],[-0.54,0.12],
    [0.54,0.12],[0.54,0.06],[0.6,0.06],[0.78,0.03],[0.91,0.01],[0.91,0.03],[1.01,0.03],[1.01,-0.01],[1.1,-0.03],[1.26,-0.12],[1.36,-0.18],[1.40,-0.21],[1.38,-0.24],[1.26,-0.27],[1.1,-0.3],[1.01,-0.32],[1.01,-0.34],[0.91,-0.34],[0.91,-0.32],[0.72,-0.34],[0.48,-0.35],
    [0.72,-0.6],[0.62,-0.6],[0.38,-0.35],[0.3,-0.35],[-0.3,-0.35],[-0.38,-0.35],[-0.62,-0.6],[-0.72,-0.6],[-0.48,-0.35],[-0.91,-0.32],[-0.91,-0.34],[-1.01,-0.34],[-1.01,-0.32],[-1.1,-0.3],[-1.26,-0.27],[-1.38,-0.24],[-1.40,-0.21],[-1.36,-0.18],[-1.26,-0.12],[-1.1,-0.03],[-1.01,-0.01],[-1.01,0.03],[-0.91,0.03],[-0.91,0.01],[-0.78,0.03],[-0.6,0.06],[-0.54,0.06],[0.54,0.06]
  ];

  const thrust = [
    [0.05,0],[-0.05,0],[-0.06,-0.1],[-0.05,-0.1],[-0.06,-0.2],[0,-0.25],[0.06,-0.2],[0.05,-0.1],[0.06,-0.1],[0.05,0]
  ];

  const S = 140;                  // overall scale
  const yOffset = -0.35 * S;       // lift the UFO up a bit
  const accel = clamp(u, -2.0, 2.0);
  const thrustOn = Math.abs(accel) > 0.15;
  const stable = (Math.abs(state.theta) < 0.011) && (Math.abs(state.omega) < 0.011);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(thetaRad);
  ctx.translate(0, yOffset);

  // shadow
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = "black";
  ctx.beginPath();
  ctx.ellipse(0, 1.05*S, 0.9*S, 0.12*S, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1.0;

  // body
  const bodyGrad = ctx.createLinearGradient(-1.2*S, -0.2*S, 1.2*S, 0.4*S);
  bodyGrad.addColorStop(0, "rgba(190,200,215,0.92)");
  bodyGrad.addColorStop(1, "rgba(120,132,155,0.92)");
  ctx.fillStyle = bodyGrad;

  ctx.beginPath();
  ctx.moveTo(ufoData[0][0]*S, -ufoData[0][1]*S);
  for(let i=1;i<ufoData.length;i++) ctx.lineTo(ufoData[i][0]*S, -ufoData[i][1]*S);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(240,248,255,0.35)";
  ctx.lineWidth = 2.4;
  ctx.stroke();

  // dome
  const domeGrad = ctx.createRadialGradient(-0.25*S, -0.12*S, 12, -0.25*S, -0.12*S, 0.55*S);
  domeGrad.addColorStop(0, "rgba(210,240,255,0.85)");
  domeGrad.addColorStop(1, "rgba(60,120,180,0.25)");
  ctx.fillStyle = domeGrad;
  ctx.beginPath();
  ctx.ellipse(0, -0.02*S, 0.38*S, 0.24*S, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fill();

  // windows
  ctx.fillStyle = "rgba(255,240,170,0.85)";
  for(let i=-2;i<=2;i++){
    ctx.beginPath();
    ctx.ellipse(i*0.26*S, -0.23*S, 0.06*S, 0.045*S, 0, 0, Math.PI*2);
    ctx.fill();
  }

  // thrusters (ported from MATLAB logic)
  if(thrustOn){
    let r_scaled = thrust.map(p => [p[0], p[1]]);
    let l_scaled = thrust.map(p => [p[0], p[1]]);

    if(accel > 0){
      r_scaled = thrust.map(p => [p[0] * accel * 0.5, p[1] * accel]);
      l_scaled = thrust.map(p => [p[0], p[1]]);
    } else if(accel < 0){
      r_scaled = thrust.map(p => [p[0], p[1]]);
      l_scaled = thrust.map(p => [p[0] * (-accel) * 0.5, p[1] * (-accel)]);
    }

    const rb = r_scaled.map(p => [p[0] + 0.96, p[1] - 0.34]);
    const lb = l_scaled.map(p => [p[0] - 0.96, p[1] - 0.34]);
    const rt = l_scaled.map(p => [p[0] + 0.96, (-p[1]) + 0.03]);
    const lt = r_scaled.map(p => [p[0] - 0.96, (-p[1]) + 0.03]);

    const col = accel > 0 ? "rgba(255,90,110,0.92)" : "rgba(80,220,255,0.92)";
    ctx.fillStyle = col;

    const drawPatch = (pts) => {
      ctx.beginPath();
      ctx.moveTo(pts[0][0]*S, -pts[0][1]*S);
      for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0]*S, -pts[i][1]*S);
      ctx.closePath();
      ctx.fill();
    };

    if(accel > 0.2){
      drawPatch(rb);
      drawPatch(lt);
    } else if(accel < -0.2){
      drawPatch(lb);
      drawPatch(rt);
    }
  }

  // tractor beam when stabilized
  if(stable){
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(255, 235, 90, 0.65)";
    ctx.beginPath();
    ctx.moveTo(0.10*S, 0.45*S);
    ctx.lineTo(0.80*S, 2.25*S);
    ctx.lineTo(-0.80*S, 2.25*S);
    ctx.lineTo(-0.10*S, 0.45*S);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawErrorPlot(){
  const W = errPlot.width, H = errPlot.height;
  ectx.clearRect(0,0,W,H);

  // axes
  ectx.strokeStyle = "rgba(120,150,220,0.25)";
  ectx.lineWidth = 1.5;
  ectx.beginPath();
  ectx.moveTo(42, 18);
  ectx.lineTo(42, H-28);
  ectx.lineTo(W-18, H-28);
  ectx.stroke();

  if(errBuf.length < 2) return;

  let minE = Infinity, maxE = -Infinity;
  for(const v of errBuf){ minE = Math.min(minE, v); maxE = Math.max(maxE, v); }
  minE = Math.min(minE, 0);
  maxE = Math.max(maxE, 0);
  const span = Math.max(1e-6, maxE - minE);

  // grid
  ectx.globalAlpha = 0.6;
  ectx.strokeStyle = "rgba(120,150,220,0.16)";
  for(let i=1;i<=3;i++){
    const y = 18 + i*(H-46)/4;
    ectx.beginPath(); ectx.moveTo(42,y); ectx.lineTo(W-18,y); ectx.stroke();
  }
  ectx.globalAlpha = 1.0;

  // zero line
  const y0 = (H-28) - ((0 - minE)/span)*(H-56);
  ectx.strokeStyle = "rgba(230,238,252,0.30)";
  ectx.lineWidth = 1.2;
  ectx.beginPath(); ectx.moveTo(42,y0); ectx.lineTo(W-18,y0); ectx.stroke();

  // curve
  ectx.strokeStyle = "rgba(100, 255, 140, 0.92)";
  ectx.lineWidth = 2.5;
  ectx.beginPath();
  for(let i=0;i<errBuf.length;i++){
    const x = 42 + (i/(BUF_MAX-1))*(W-68);
    const y = (H-28) - ((errBuf[i]-minE)/span)*(H-56);
    if(i===0) ectx.moveTo(x,y); else ectx.lineTo(x,y);
  }
  ectx.stroke();

  ectx.fillStyle = "rgba(230,238,252,0.74)";
  ectx.font = "12px ui-sans-serif, system-ui";
  ectx.fillText(`θ error (recent) | min ${fmt(minE,2)} max ${fmt(maxE,2)}`, 52, 34);
}

function drawUPlot(){
  const W = uPlot.width, H = uPlot.height;
  uctx.clearRect(0,0,W,H);

  // axes
  uctx.strokeStyle = "rgba(120,150,220,0.25)";
  uctx.lineWidth = 1.5;
  uctx.beginPath();
  uctx.moveTo(42, 18);
  uctx.lineTo(42, H-28);
  uctx.lineTo(W-18, H-28);
  uctx.stroke();

  if(uBuf.length < 2) return;

  let minU = Infinity, maxU = -Infinity;
  for(const v of uBuf){ minU = Math.min(minU, v); maxU = Math.max(maxU, v); }
  minU = Math.min(minU, 0);
  maxU = Math.max(maxU, 0);
  const span = Math.max(1e-6, maxU - minU);

  // grid
  uctx.globalAlpha = 0.6;
  uctx.strokeStyle = "rgba(120,150,220,0.16)";
  for(let i=1;i<=3;i++){
    const y = 18 + i*(H-46)/4;
    uctx.beginPath(); uctx.moveTo(42,y); uctx.lineTo(W-18,y); uctx.stroke();
  }
  uctx.globalAlpha = 1.0;

  // zero line
  const y0 = (H-28) - ((0 - minU)/span)*(H-56);
  uctx.strokeStyle = "rgba(230,238,252,0.30)";
  uctx.lineWidth = 1.2;
  uctx.beginPath(); uctx.moveTo(42,y0); uctx.lineTo(W-18,y0); uctx.stroke();

  // curve
  uctx.strokeStyle = "rgba(255,95,110,0.92)";
  uctx.lineWidth = 2.5;
  uctx.beginPath();
  for(let i=0;i<uBuf.length;i++){
    const x = 42 + (i/(BUF_MAX-1))*(W-68);
    const y = (H-28) - ((uBuf[i]-minU)/span)*(H-56);
    if(i===0) uctx.moveTo(x,y); else uctx.lineTo(x,y);
  }
  uctx.stroke();

  uctx.fillStyle = "rgba(230,238,252,0.74)";
  uctx.font = "12px ui-sans-serif, system-ui";
  uctx.fillText(`u (control) | min ${fmt(minU,2)} max ${fmt(maxU,2)}`, 52, 34);
}
