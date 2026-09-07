(() => {
"use strict";

const STATES = Object.freeze({ MENU:"MENU", PLAYING:"PLAYING", PAUSED:"PAUSED", GAME_OVER:"GAME_OVER" });
const GRID = 28, CELL = 720 / GRID;
const SAVE_KEY = "neonSnakeSaveV2";
const todayKey = new Date().toISOString().slice(0,10);

const $ = id => document.getElementById(id);
const canvas = $("gameCanvas"), ctx = canvas.getContext("2d");
let state = STATES.MENU, raf = 0, lastStep = 0, shake = 0, toastTimer = 0;
let snake=[], food=null, direction={x:1,y:0}, queue=[], score=0, level=1, combo=1, comboTimer=0;
let runCoins=0, runXP=0, mode="classic", timeLeft=90, runStart=0, obstacles=[], powerUps=[], particles=[], replay=[];
let soundCtx=null;

const defaultSave = {
  highScore:0, coins:120, xp:0, playerLevel:1, totalScore:0, games:0, foods:0, deaths:0, bestCombo:1,
  totalDistance:0, streak:0, lastDaily:"", dailyDone:false, muted:false,
  skin:"classic", board:"grid", theme:"neon", trail:true, shake:true, music:false,
  skins:{classic:true, plasma:false, lava:false, ice:false, void:false},
  boards:{grid:true, circuit:false, matrix:false, stars:false},
  themes:{neon:true, amber:false, cyan:false, violet:false},
  achievements:[], missions:{food10:0, score1000:0, combo10:0, noWall:0},
  leaderboard:[]
};
let save = loadSave();

const skins = {
  classic:{head:"#7dffad",body:"#24e875",tail:"#0aa94e"},
  plasma:{head:"#e59cff",body:"#a85cff",tail:"#6729bd"},
  lava:{head:"#ffd28a",body:"#ff7048",tail:"#c92d24"},
  ice:{head:"#c5f7ff",body:"#42d7ff",tail:"#1687bd"},
  void:{head:"#d2d6ff",body:"#6974ff",tail:"#303aa7"}
};
const themes = {neon:["#39ff88","#42e8ff"],amber:["#ffb23e","#ff7048"],cyan:["#42e8ff","#6ffff0"],violet:["#b779ff","#ff69cf"]};

function loadSave(){
  try { return {...defaultSave,...JSON.parse(localStorage.getItem(SAVE_KEY)||"{}")}; }
  catch { return {...defaultSave}; }
}
function persist(){ localStorage.setItem(SAVE_KEY,JSON.stringify(save)); }
function seedDaily(){
  const day = Number(todayKey.replaceAll("-",""));
  return {
    title:["Food Rush","Perfect Run","Combo Hunter","Wall Runner"][day%4],
    description:["Eat 12 food before you crash.","Reach 300 score with no pause.","Build a combo of 8 or more.","Score 250 in No Walls mode."][day%4],
    reward:75 + (day%4)*25, type:day%4
  };
}
const daily=seedDaily();
$("dailyTitle").textContent=daily.title;
$("dailyDescription").textContent=daily.description;
$("dailyReward").textContent=daily.reward;

function showScreen(id){
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  $(id).classList.add("active");
}
function setOverlayVisible(id, visible){
  const el=$(id);
  if(!el) return;
  el.classList.toggle("hidden", !visible);
  el.style.display=visible ? "grid" : "none";
  el.setAttribute("aria-hidden", visible ? "false" : "true");
}

function hideGameOver(){ setOverlayVisible("gameOverOverlay", false); }
function hidePause(){ setOverlayVisible("pauseOverlay", false); }

function menu(){
  stopLoop();
  state=STATES.MENU;
  hideGameOver();
  hidePause();
  showScreen("menuScreen");
  closePanel();
  updateMenu();
}
function startGame(selectedMode="classic"){
  // Stop any previous animation and force both overlays closed before a new round.
  stopLoop();
  hideGameOver();
  hidePause();
  mode=selectedMode;
  state=STATES.PLAYING;
  showScreen("gameScreen");
  closePanel();

  score=0;level=1;combo=1;comboTimer=0;runCoins=0;runXP=0;queue=[];particles=[];powerUps=[];replay=[];
  direction={x:1,y:0}; obstacles=[]; timeLeft=mode==="time" ? 90 : 99999; runStart=performance.now();
  const c=Math.floor(GRID/2); snake=[{x:c,y:c},{x:c-1,y:c},{x:c-2,y:c},{x:c-3,y:c}];
  spawnFood();
  if(mode==="challenge" || mode==="hardcore") createObstacles(mode==="hardcore"?18:8);
  lastStep=performance.now();
  startLoop();
  updateHud();
  sfx("start");
}
function startDaily(){ startGame(["classic","classic","classic","noWalls"][daily.type]); dailyRun=true; }
let dailyRun=false;

function stopLoop(){ cancelAnimationFrame(raf); raf=0; }
function startLoop(){ if(!raf) raf=requestAnimationFrame(loop); }
function loop(now){
  raf=requestAnimationFrame(loop);
  if(state!==STATES.PLAYING) return;
  if(mode==="time"){ timeLeft=Math.max(0,90-(now-runStart)/1000); if(timeLeft<=0){endGame("TIME UP");return;} }
  if(comboTimer>0){comboTimer-=now-lastStep;if(comboTimer<=0){combo=1;updateHud();}}
  const interval=Math.max(54,150-(level-1)*12);
  if(now-lastStep>=interval){ lastStep=now; step(); }
  draw(now);
}
function step(){
  const next=queue.shift();
  if(next){direction=next;}
  const head={x:snake[0].x+direction.x,y:snake[0].y+direction.y};
  if(mode!=="noWalls" && (head.x<0||head.y<0||head.x>=GRID||head.y>=GRID)){endGame("WALL HIT");return;}
  if(mode==="noWalls"){head.x=(head.x+GRID)%GRID;head.y=(head.y+GRID)%GRID;}
  const bodyCheck=snake.slice(0, snake.length-(willEat(head)?0:1));
  if(bodyCheck.some(p=>p.x===head.x&&p.y===head.y)){endGame("SELF HIT");return;}
  if(obstacles.some(o=>o.x===head.x&&o.y===head.y)){endGame("OBSTACLE HIT");return;}
  snake.unshift(head); save.totalDistance++;
  let ate=false;
  if(food && head.x===food.x&&head.y===food.y){
    ate=true; eatFood();
  } else snake.pop();
  if(powerUps.length && powerUps[0].life--<=0) powerUps.shift();
  replay.push({snake:snake.map(p=>({...p})),food:food?{...food}:null}); if(replay.length>220)replay.shift();
  if(!ate && mode==="zen" && snake.length>5) snake.pop();
}
function willEat(head){return food && head.x===food.x&&head.y===food.y}
function eatFood(){
  const bonus=Math.min(5,combo);
  score += 10*bonus;
  combo=Math.min(12,combo+1); comboTimer=4000;
  runCoins += 2*bonus; runXP += 8*bonus; save.foods++;
  level=1+Math.floor(score/50);
  if(score>save.highScore){save.highScore=score; showToast("NEW HIGH SCORE!");}
  if(score%100===0){runCoins+=10;showToast("BONUS COINS +10");}
  if(score%50===0){showToast(`LEVEL ${level} — SPEED UP`);sfx("level");}
  if(Math.random()<.12) spawnPowerUp();
  spawnFood(); particles.push(...burst(food.x*CELL+CELL/2,food.y*CELL+CELL/2));
  save.missions.food10=Math.max(save.missions.food10,save.foods);
  save.missions.score1000=Math.max(save.missions.score1000,score);
  save.missions.combo10=Math.max(save.missions.combo10,combo);
  save.bestCombo=Math.max(save.bestCombo,combo);
  updateHud();sfx("eat");navigator.vibrate?.(18);
}
function spawnFood(){
  const special=Math.random()<.10;
  for(let i=0;i<500;i++){
    const p={x:Math.floor(Math.random()*GRID),y:Math.floor(Math.random()*GRID)};
    if(!snake.some(s=>s.x===p.x&&s.y===p.y)&&!obstacles.some(o=>o.x===p.x&&o.y===p.y)){food={...p,special};return;}
  }
}
function spawnPowerUp(){
  const types=["slow","double","magnet","shield"];
  powerUps=[{x:food?.x??2,y:food?.y??2,type:types[Math.floor(Math.random()*types.length)],life:120}];
}
function createObstacles(n){
  for(let i=0;i<n;i++){let p;do{p={x:Math.floor(Math.random()*GRID),y:Math.floor(Math.random()*GRID)}}while(snake.some(s=>s.x===p.x&&p.y===s.y));obstacles.push(p);}
}
function endGame(reason){
  state=STATES.GAME_OVER; stopLoop(); save.games++;save.deaths++;save.totalScore+=score;
  save.coins+=runCoins; save.xp+=runXP; awardAchievements();
  if(dailyRun && !save.dailyDone){ if(daily.type<3 ? score>=30*(daily.type+1) : mode==="noWalls"&&score>=250){save.dailyDone=true;save.coins+=daily.reward;showToast("DAILY COMPLETE!");} }
  save.leaderboard.push({score,mode,date:new Date().toLocaleDateString()});save.leaderboard.sort((a,b)=>b.score-a.score);save.leaderboard=save.leaderboard.slice(0,10);
  persist(); $("gameOverText").textContent=`${reason} • Score ${score} • +${runCoins} coins • +${runXP} XP`;
  setOverlayVisible("gameOverOverlay", true);hidePause();sfx("gameover");
}
function togglePause(){
  if(state===STATES.PLAYING){state=STATES.PAUSED;setOverlayVisible("pauseOverlay", true);stopLoop();}
  else if(state===STATES.PAUSED){state=STATES.PLAYING;hidePause();lastStep=performance.now();startLoop();}
}
function queueDirection(d){
  if(state!==STATES.PLAYING) return;
  const last=queue.length?queue[queue.length-1]:direction;
  if(last.x+d.x===0&&last.y+d.y===0)return;
  if(last.x===d.x&&last.y===d.y)return;
  if(queue.length<2)queue.push(d);
}
function keyHandler(e){
  const k=e.key.toLowerCase();
  const dirs={w:{x:0,y:-1},arrowup:{x:0,y:-1},s:{x:0,y:1},arrowdown:{x:0,y:1},a:{x:-1,y:0},arrowleft:{x:-1,y:0},d:{x:1,y:0},arrowright:{x:1,y:0}};
  if(dirs[k]||k===" "||k==="enter"||k==="escape")e.preventDefault();
  if(dirs[k]){queueDirection(dirs[k]);return;}
  if(k===" "){togglePause();return;}
  if(k==="enter"&&(state===STATES.MENU||state===STATES.GAME_OVER)){if(state===STATES.GAME_OVER)$("restartBtn").click();else startGame();return;}
  if(k==="escape"&&state!==STATES.MENU)menu();
}
window.addEventListener("keydown",keyHandler,{passive:false});

function draw(now){
  const t=themes[save.theme]||themes.neon, sk=skins[save.skin]||skins.classic;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.save();
  if(save.shake&&shake>0){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake*=.88;if(shake<.2)shake=0;}
  ctx.fillStyle="#060a0f";ctx.fillRect(0,0,720,720);
  drawBoard(t);
  obstacles.forEach(o=>{ctx.fillStyle="#222c38";ctx.shadowColor="#42e8ff";ctx.shadowBlur=8;roundRect(o.x*CELL+5,o.y*CELL+5,CELL-10,CELL-10,5);ctx.fill();ctx.shadowBlur=0;});
  if(food) drawFood(food,now,t);
  powerUps.forEach(p=>{ctx.fillStyle=t[1];ctx.shadowColor=t[1];ctx.shadowBlur=18;circle(p.x*CELL+CELL/2,p.y*CELL+CELL/2,CELL*.27);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle="#07100b";ctx.font="bold 10px system-ui";ctx.textAlign="center";ctx.fillText(p.type[0].toUpperCase(),p.x*CELL+CELL/2,p.y*CELL+CELL/2+4);});
  snake.forEach((p,i)=>{const q=snake.length-i;ctx.fillStyle=i===0?sk.head:(q>2?sk.body:sk.tail);ctx.shadowColor=sk.body;ctx.shadowBlur=i===0?16:7;roundRect(p.x*CELL+3,p.y*CELL+3,CELL-6,CELL-6,5);ctx.fill();ctx.shadowBlur=0;});
  if(save.trail&&snake[0]){ctx.globalAlpha=.12;ctx.fillStyle=t[0];ctx.beginPath();ctx.arc(snake[0].x*CELL+CELL/2,snake[0].y*CELL+CELL/2,CELL*.6,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;}
  particles.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.life-=.035;ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=t[0];circle(p.x,p.y,p.size);ctx.fill();ctx.globalAlpha=1;});particles=particles.filter(p=>p.life>0);
  ctx.restore();
}
function drawBoard(t){
  ctx.strokeStyle=save.board==="circuit"?"rgba(66,232,255,.12)":"rgba(255,255,255,.035)";ctx.lineWidth=1;
  for(let i=0;i<=GRID;i++){ctx.beginPath();ctx.moveTo(i*CELL,0);ctx.lineTo(i*CELL,720);ctx.stroke();ctx.beginPath();ctx.moveTo(0,i*CELL);ctx.lineTo(720,i*CELL);ctx.stroke();}
  if(save.board==="stars"){ctx.fillStyle=t[1];for(let i=0;i<70;i++){const x=(i*97)%720,y=(i*53)%720;ctx.fillRect(x,y,1,1);}}
}
function drawFood(f,now,t){
  const pulse=1+Math.sin(now/120)*.08, cx=f.x*CELL+CELL/2,cy=f.y*CELL+CELL/2;
  ctx.save();ctx.shadowColor=f.special?"#ff9b3e":"#ff4b3e";ctx.shadowBlur=22;ctx.fillStyle=f.special?"#ff9b3e":"#ff4b3e";circle(cx,cy,CELL*.24*pulse);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle="#fff2";circle(cx-3,cy-3,3);ctx.fill();ctx.restore();
}
function roundRect(x,y,w,h,r){ctx.beginPath();ctx.roundRect(x,y,w,h,r)}
function circle(x,y,r){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2)}
function burst(x,y){return Array.from({length:16},()=>({x,y,vx:(Math.random()-.5)*5,vy:(Math.random()-.5)*5,size:Math.random()*4+1,life:1}))}

function updateHud(){
  $("scoreValue").textContent=score;$("levelValue").textContent=level;$("comboValue").textContent="x"+combo;
  $("xpValue").textContent=runXP;$("coinValue").textContent=runCoins;
}
function updateMenu(){
  $("menuHighScore").textContent=save.highScore;$("menuPlayerLevel").textContent=save.playerLevel;
  $("menuCoins").textContent=save.coins;$("menuStreak").textContent=save.streak;
}
function addXP(n){save.xp+=n;while(save.xp>=save.playerLevel*100){save.xp-=save.playerLevel*100;save.playerLevel++;showToast("PLAYER LEVEL UP!");}persist();}
function awardAchievements(){
  const add=(id,name)=>{if(!save.achievements.includes(id)){save.achievements.push(id);showToast("ACHIEVEMENT: "+name);addXP(50);}};
  if(save.highScore>=100)add("score100","First Century");
  if(save.foods>=50)add("food50","Food Collector");
  if(save.bestCombo>=10)add("combo10","Combo Master");
  if(save.games>=10)add("games10","Arcade Regular");
  if(save.streak>=7)add("streak7","Seven Day Streak");
  if(score>=500)add("score500","Neon Runner");
}
function showToast(text){const t=$("toast");t.textContent=text;t.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove("show"),1800);}
function sfx(type){
  if(save.muted)return;
  try{
    soundCtx ||= new (window.AudioContext||window.webkitAudioContext)();
    const o=soundCtx.createOscillator(),g=soundCtx.createGain();o.connect(g);g.connect(soundCtx.destination);
    const f={eat:540,level:820,start:330,gameover:130}[type]||440;o.frequency.value=f;o.type=type==="gameover"?"sawtooth":"square";
    g.gain.setValueAtTime(.035,soundCtx.currentTime);g.gain.exponentialRampToValueAtTime(.001,soundCtx.currentTime+.12);o.start();o.stop(soundCtx.currentTime+.12);
  }catch{}
}

function openPanel(name){
  const content=panelContent(name);$("panelTitle").textContent=({shopPanel:"Shop",missionsPanel:"Missions & Achievements",statsPanel:"Statistics",leaderboardPanel:"Leaderboard",settingsPanel:"Settings",modesPanel:"Game Modes"})[name]||"Panel";
  $("panelContent").innerHTML=content;$("sidePanel").classList.add("open");$("panelBackdrop").classList.remove("hidden");
}
function panelContent(name){
  if(name==="modesPanel")return `<div class="panel-section"><h3>Choose your run</h3>
  ${[["classic","Classic","Walls on. Pure Snake."],["time","Time Attack","90 seconds. Score as much as possible."],["noWalls","No Walls","Wrap through the edges."],["hardcore","Hardcore","Fast and full of obstacles."],["zen","Zen","Relaxed run with no wall collision."],["challenge","Challenge","Obstacles + tighter rules."]].map(x=>`<div class="row"><div><b>${x[1]}</b><br><small>${x[2]}</small></div><button class="secondary small modeBtn" data-mode="${x[0]}">PLAY</button></div>`).join("")}</div>`;
  if(name==="shopPanel")return `<div class="panel-section"><h3>Skins</h3><div class="swatches">${Object.keys(skins).map(k=>`<button class="swatch ${save.skin===k?"active":""}" data-skin="${k}">${k.toUpperCase()}<br><span class="tag">${save.skins[k]?"OWNED":"100 COINS"}</span></button>`).join("")}</div></div>
  <div class="panel-section"><h3>Board Styles</h3><div class="swatches">${Object.keys(save.boards).map(k=>`<button class="swatch ${save.board===k?"active":""}" data-board="${k}">${k.toUpperCase()}<br><span class="tag">${save.boards[k]?"OWNED":"150 COINS"}</span></button>`).join("")}</div></div>
  <div class="panel-section"><h3>Themes</h3><div class="swatches">${Object.keys(themes).map(k=>`<button class="swatch ${save.theme===k?"active":""}" data-theme="${k}">${k.toUpperCase()}<br><span class="tag">${save.themes[k]?"OWNED":"120 COINS"}</span></button>`).join("")}</div></div>`;
  if(name==="missionsPanel")return `<div class="panel-section"><h3>Missions</h3>
    <div class="row"><span>Eat 10 food</span><b>${Math.min(10,save.foods)}/10</b></div>
    <div class="row"><span>Reach 1000 score</span><b>${Math.min(1000,save.missions.score1000)}/1000</b></div>
    <div class="row"><span>Build x10 combo</span><b>${Math.min(10,save.bestCombo)}/10</b></div>
    <div class="row"><span>Play 10 games</span><b>${Math.min(10,save.games)}/10</b></div></div>
    <div class="panel-section"><h3>Achievements</h3><p>${save.achievements.length?save.achievements.join(" • "):"No achievements yet. Keep playing!"}</p></div>`;
  if(name==="statsPanel")return `<div class="panel-section">
    ${[["High Score",save.highScore],["Player Level",save.playerLevel],["Games",save.games],["Food Eaten",save.foods],["Best Combo","x"+save.bestCombo],["Total Score",save.totalScore],["Coins",save.coins],["Daily Streak",save.streak]].map(x=>`<div class="row"><span>${x[0]}</span><b>${x[1]}</b></div>`).join("")}</div>`;
  if(name==="leaderboardPanel")return `<div class="panel-section"><h3>Local Top 10</h3>${save.leaderboard.length?save.leaderboard.map((x,i)=>`<div class="row"><span>#${i+1} • ${x.mode}</span><b>${x.score}</b></div>`).join(""):"<p>No runs recorded yet.</p>"}</div>`;
  if(name==="settingsPanel")return `<div class="panel-section">
    ${settingRow("Snake Trail","trail")} ${settingRow("Screen Shake","shake")} ${settingRow("Background Music","music")}
    <div class="row"><span>Sound Effects</span><button class="secondary small" id="panelMute">${save.muted?"OFF":"ON"}</button></div>
    <div class="row"><span>Save Data</span><div><button class="secondary small" id="exportBtn">EXPORT</button> <button class="secondary small" id="importBtn">IMPORT</button></div></div>
    <div class="row"><span>Reset progress</span><button class="secondary small" id="resetBtn">RESET</button></div></div>`;
  return "";
}
function settingRow(label,key){return `<div class="row"><span>${label}</span><button class="secondary small toggleBtn" data-setting="${key}">${save[key]?"ON":"OFF"}</button></div>`}
function closePanel(){$("sidePanel").classList.remove("open");$("panelBackdrop").classList.add("hidden")}
function buyOrEquip(kind,key,cost){
  const owned=save[kind+"s"]?.[key];
  if(!owned){if(save.coins<cost){showToast("NOT ENOUGH COINS");return;}save.coins-=cost;save[kind+"s"][key]=true;showToast("UNLOCKED "+key.toUpperCase());}
  save[kind==="skin"?"skin":kind==="board"?"board":"theme"]=key;persist();updateMenu();openPanel(kind==="skin"?"shopPanel":"shopPanel");
}
document.addEventListener("click",e=>{
  const open=e.target.closest("[data-open]");if(open){openPanel(open.dataset.open);return}
  const modeBtn=e.target.closest(".modeBtn");if(modeBtn){startGame(modeBtn.dataset.mode);return}
  const skin=e.target.closest("[data-skin]");if(skin){buyOrEquip("skin",skin.dataset.skin,100);return}
  const board=e.target.closest("[data-board]");if(board){buyOrEquip("board",board.dataset.board,150);return}
  const theme=e.target.closest("[data-theme]");if(theme){buyOrEquip("theme",theme.dataset.theme,120);return}
  const toggle=e.target.closest(".toggleBtn");if(toggle){save[toggle.dataset.setting]=!save[toggle.dataset.setting];persist();openPanel("settingsPanel");return}
});
$("startBtn").onclick=()=>startGame("classic");
$("dailyBtn").onclick=()=>showScreen("dailyScreen");
$("dailyStartBtn").onclick=()=>startDaily();
$("pauseBtn").onclick=togglePause;$("resumeBtn").onclick=togglePause;
$("restartBtn").onclick=(e)=>{e.preventDefault();e.stopPropagation();dailyRun=false;startGame(mode);};
$("menuBtn").onclick=menu;$("brandButton").onclick=menu;$("closePanel").onclick=closePanel;$("panelBackdrop").onclick=closePanel;
$("settingsBtn").onclick=()=>openPanel("settingsPanel");
$("muteBtn").onclick=()=>{save.muted=!save.muted;persist();$("muteBtn").textContent=save.muted?"🔇":"🔊";};
document.querySelectorAll(".backBtn").forEach(b=>b.onclick=menu);
document.querySelectorAll("[data-dir]").forEach(b=>b.addEventListener("pointerdown",()=>{const d={up:{x:0,y:-1},down:{x:0,y:1},left:{x:-1,y:0},right:{x:1,y:0}}[b.dataset.dir];queueDirection(d);navigator.vibrate?.(10)}));

$("panelContent").addEventListener("click",e=>{
  if(e.target.id==="panelMute"){save.muted=!save.muted;persist();openPanel("settingsPanel")}
  if(e.target.id==="resetBtn"&&confirm("Reset all local progress?")){localStorage.removeItem(SAVE_KEY);save=loadSave();openPanel("settingsPanel");updateMenu();showToast("PROGRESS RESET")}
  if(e.target.id==="exportBtn"){const blob=new Blob([JSON.stringify(save)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download="neon-snake-save.json";a.click();URL.revokeObjectURL(a.href);}
  if(e.target.id==="importBtn"){const inp=document.createElement("input");inp.type="file";inp.accept=".json,application/json";inp.onchange=()=>{const r=new FileReader();r.onload=()=>{try{save={...defaultSave,...JSON.parse(r.result)};persist();updateMenu();openPanel("settingsPanel");showToast("SAVE IMPORTED")}catch{showToast("INVALID SAVE")}};r.readAsText(inp.files[0])};inp.click();}
});

function updateDailyStreak(){
  if(save.lastDaily!==todayKey){save.streak=save.lastDaily?Math.min(365,save.streak+1):1;save.lastDaily=todayKey;save.dailyDone=false;persist();}
}
updateDailyStreak();updateMenu();$("muteBtn").textContent=save.muted?"🔇":"🔊";
draw(performance.now());
})();
