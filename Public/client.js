const socket=io();
let state=null;
const $=s=>document.querySelector(s);
const money=n=>Number(n||0).toLocaleString("ru-RU")+" ₽";

function showRoom(r){
  state=r;
  $("#lobby").classList.add("hidden"); $("#room").classList.remove("hidden");
  $("#roomCode").textContent=r.code; $("#phase").textContent=r.phase==="finished"?"Игра окончена":r.phase==="playing"?"Игра идёт":"Ожидание игроков";
  if(r.phase==="lobby"){ $("#lobbyPanel").classList.remove("hidden"); $("#gamePanel").classList.add("hidden"); renderLobby(); }
  else { $("#lobbyPanel").classList.add("hidden"); $("#gamePanel").classList.remove("hidden"); renderGame(); }
}
function renderLobby(){
  $("#playersLobby").innerHTML=state.players.map((p,i)=>`<div class="player"><b class="p${p.color}">●</b> ${p.name} ${p.id===state.players[0].id?"👑":""}</div>`).join("");
  $("#start").style.display=socket.id===state.players[0]?.socketId?"block":"block";
}
function renderGame(){
  const me=state.players.find(p=>p.socketId===socket.id) || state.players.find(p=>p.name===$("#name").value);
  const current=state.players[state.turn];
  $("#status").innerHTML=state.phase==="finished"
    ? `<div class="winner">🏆 ${state.players.find(p=>p.id===state.winner)?.name||"Игрок"} победил!</div>`
    : `Ход: <b>${current?.name}</b> • ${current?.id===me?.id?"<span style='color:#ffd21a'>это ваш ход</span>":"ждём игрока"}`;
  $("#players").innerHTML=state.players.map(p=>`<div class="player ${p.id===current?.id?"active":""}"><b>${p.name}</b><br><span class="money">${money(p.money)}</span><br><small>🚗 ${p.cars.length} машин • долг ${money(p.debt)}</small></div>`).join("");
  const cells=state.board.map((c,i)=>{
    const toks=state.players.filter(p=>p.pos===i).map(p=>`<span class="token p${p.color}" title="${p.name}"></span>`).join("");
    return `<div class="cell"><span>${c}</span><div class="tokens">${toks}</div></div>`;
  }).join("");
  $("#board").innerHTML=cells;
  $("#log").innerHTML=state.log.slice().reverse().map(x=>`<div>${x}</div>`).join("");
  if(me){
    $("#garage").innerHTML=me.cars.length?me.cars.map(c=>`<div class="garageCard"><b>🚗 ${c.name}</b><br><small>${c.type} • ${c.repaired?"🔧 отремонтирована":"⚠️ требует ремонта"} • покупка ${money(c.price)}</small></div>`).join(""):"<span class='small'>Машин пока нет</span>";
  }
  const a=state.auction;
  $("#auction").innerHTML=a?`<div class="auctionBox"><b>🔨 Аукцион</b><p>${a.car?.name||"Гонка"}</p>${a.current?`Текущая ставка: <b>${money(a.current)}</b>`:"Ставок нет"}<div class="bid"><input id="bidAmount" type="number" placeholder="Ставка"><button onclick="bid()">Сделать ставку</button><button onclick="finishAuction()">Завершить</button></div></div>`:"<span class='small'>Нет активного аукциона</span>";
  $("#roll").disabled=!(current?.id===me?.id && !current.hasMoved);
}
function bid(){ socket.emit("bid",{amount:Number($("#bidAmount").value)}); }
function finishAuction(){ socket.emit("finishAuction"); }

$("#create").onclick=()=>socket.emit("createRoom",{name:$("#name").value,goal:Number($("#goal").value)});
$("#join").onclick=()=>socket.emit("joinRoom",{code:$("#code").value,name:$("#name").value});
$("#start").onclick=()=>socket.emit("startGame");
$("#roll").onclick=()=>socket.emit("roll");
$("#end").onclick=()=>socket.emit("endTurn");
document.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>socket.emit("action",{type:b.dataset.action}));
$("#copy").onclick=()=>navigator.clipboard?.writeText(state.code).then(()=>alert("Код скопирован: "+state.code));
socket.on("room",showRoom);
socket.on("errorMsg",msg=>alert(msg));
