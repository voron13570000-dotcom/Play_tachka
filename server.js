const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));

const rooms = new Map();

const CAR_TYPES = {
  vedro:  { name:"Вёдра", min:40000,  max:90000,  repairMin:30000,  repairMax:70000,  rent:50000, taxi:10000 },
  bitye:  { name:"Битые", min:60000,  max:500000, repairMin:20000, repairMax:700000, rent:50000, taxi:10000 },
  premium:{ name:"Премиум", min:200000, max:540000, repairMin:140000, repairMax:300000, rent:100000, taxi:20000 },
  retro:  { name:"Ретро", min:160000, max:560000, repairMin:300000, repairMax:800000, rent:100000, taxi:20000 }
};

const CELLS = [
  "Скупка","Вёдра","Таксовать","Битые","Автосервис","Прокат","Премиум","Гонка",
  "Ретро","Аукцион","Вёдра","Скупка","Прокат","Битые","Гонка","Автосервис",
  "Премиум","Таксовать","Ретро","Аукцион","Скупка","Вёдра","Прокат","Битые"
];

function id(){ return crypto.randomBytes(3).toString("hex").toUpperCase(); }
function rand(min,max){ return Math.floor(Math.random()*(max-min+1)); }
function makeCar(type){
  const t = CAR_TYPES[type];
  const base = rand(t.min,t.max);
  const repair = rand(t.repairMin,t.repairMax);
  const positive = type === "bitye" || type === "retro" ? Math.random() < .45 : Math.random() < .3;
  return {
    id: crypto.randomUUID(),
    type,
    name: `${t.name.slice(0,-1)} ${rand(101,999)}`,
    price: base,
    repairCost: repair,
    repaired: false,
    defect: Math.random() < .45,
    positive,
    owner: null,
    coOwner: null
  };
}
function makeDeck(){
  const deck=[];
  for(let i=0;i<18;i++) deck.push(makeCar("vedro"));
  for(let i=0;i<20;i++) deck.push(makeCar("bitye"));
  for(let i=0;i<30;i++) deck.push(makeCar("premium"));
  for(let i=0;i<15;i++) deck.push(makeCar("retro"));
  return deck.sort(()=>Math.random()-.5);
}
function publicRoom(room){
  return {
    code:room.code,
    goal:room.goal,
    host:room.host,
    phase:room.phase,
    turn:room.turn,
    players:room.players.map(p=>({...p, socketId:undefined})),
    board:CELLS,
    cars:room.cars.filter(c=>!c.owner && !c.coOwner).slice(0,18),
    auction:room.auction,
    log:room.log.slice(-30),
    winner:room.winner
  };
}
function log(room, text){ room.log.push(text); if(room.log.length>100) room.log.shift(); }
function getPlayer(room,socketId){ return room.players.find(p=>p.socketId===socketId); }
function getPlayerById(room,pid){ return room.players.find(p=>p.id===pid); }

function movementCost(n){
  return ({1:0,2:0,3:30000,4:60000,5:100000,6:300000,7:1000000})[n] ?? 1000000;
}

function checkWinner(room){
  const winner=room.players.find(p=>p.money>=room.goal && p.debt===0);
  if(winner){
    room.phase="finished"; room.winner=winner.id;
    log(room,`🏆 ${winner.name} первым достиг цели ${room.goal.toLocaleString("ru-RU")} ₽`);
  }
}

function nextTurn(room){
  if(room.phase!=="playing") return;
  room.turn=(room.turn+1)%room.players.length;
  room.players[room.turn].hasMoved=false;
  log(room,`Ход игрока ${room.players[room.turn].name}`);
}

function drawCar(room,type){
  const idx=room.cars.findIndex(c=>c.type===type && !c.owner && !c.coOwner);
  return idx>=0 ? room.cars.splice(idx,1)[0] : makeCar(type);
}

io.on("connection", socket=>{
  socket.on("createRoom", ({name,goal=3000000})=>{
    const code=id();
    const room={code,goal:Number(goal),host:socket.id,phase:"lobby",turn:0,players:[],cars:makeDeck(),auction:null,log:[],winner:null};
    room.players.push({id:crypto.randomUUID(),socketId:socket.id,name:(name||"Игрок").slice(0,20),money:150000,debt:0,pos:0,cars:[],tokens:3,color:0,hasMoved:false});
    rooms.set(code,room); socket.join(code);
    socket.emit("room",publicRoom(room));
  });

  socket.on("joinRoom", ({code,name})=>{
    const room=rooms.get(String(code||"").toUpperCase());
    if(!room) return socket.emit("errorMsg","Комната не найдена");
    if(room.phase!=="lobby") return socket.emit("errorMsg","Игра уже началась");
    if(room.players.length>=6) return socket.emit("errorMsg","В комнате уже 6 игроков");
    room.players.push({id:crypto.randomUUID(),socketId:socket.id,name:(name||"Игрок").slice(0,20),money:150000,debt:0,pos:0,cars:[],tokens:3,color:room.players.length,hasMoved:false});
    socket.join(room.code);
    io.to(room.code).emit("room",publicRoom(room));
  });

  socket.on("startGame", ()=>{
    const room=[...rooms.values()].find(r=>r.host===socket.id);
    if(!room || room.players.length<2) return socket.emit("errorMsg","Нужно минимум 2 игрока");
    room.phase="playing"; room.turn=0;
    log(room,"🚦 Игра началась. Стартовый капитал каждого игрока — 150 000 ₽.");
    io.to(room.code).emit("room",publicRoom(room));
  });

  socket.on("roll", ()=>{
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.socketId===socket.id));
    if(!room || room.phase!=="playing") return;
    const p=getPlayer(room,socket.id);
    if(room.players[room.turn]!==p || p.hasMoved) return socket.emit("errorMsg","Сейчас не ваш ход или вы уже бросали кубик");
    const die=rand(1,6);
    const cost=movementCost(die);
    if(p.money<cost) return socket.emit("errorMsg",`Не хватает денег на перемещение: ${cost.toLocaleString("ru-RU")} ₽`);
    p.money-=cost;
    p.pos=(p.pos+die)%CELLS.length;
    p.hasMoved=true;
    log(room,`🎲 ${p.name} выбросил ${die} и заплатил ${cost.toLocaleString("ru-RU")} ₽ за перемещение. Клетка: ${CELLS[p.pos]}`);
    io.to(room.code).emit("room",publicRoom(room));
  });

  socket.on("action", ({type})=>{
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.socketId===socket.id));
    if(!room || room.phase!=="playing") return;
    const p=getPlayer(room,socket.id);
    if(room.players[room.turn]!==p || !p.hasMoved) return socket.emit("errorMsg","Сначала переместитесь");
    const cell=CELLS[p.pos];

    if(type==="taxi"){
      const car=p.cars.find(c=>true);
      if(!car) return socket.emit("errorMsg","У вас нет машины для таксования");
      const die=rand(1,6), income=(car.type==="premium"||car.type==="retro"?20000:10000)*die;
      p.money+=income; log(room,`🚕 ${p.name} таксовал на машине и получил ${income.toLocaleString("ru-RU")} ₽.`);
    } else if(type==="rent"){
      if(!p.cars.length) return socket.emit("errorMsg","Нет машин для проката");
      const income=p.cars.filter(c=>c.repaired).reduce((s,c)=>s+CAR_TYPES[c.type].rent,0);
      if(!income) return socket.emit("errorMsg","В прокат можно сдавать только отремонтированные машины");
      p.money+=income; log(room,`🏨 ${p.name} получил ${income.toLocaleString("ru-RU")} ₽ за прокат.`);
    } else if(type==="buy"){
      const allowed={Вёдра:"vedro",Битые:"bitye",Премиум:"premium",Ретро:"retro"}[cell];
      if(!allowed) return socket.emit("errorMsg","На этой клетке нет покупки");
      const car=drawCar(room,allowed);
      if(p.money<car.price) return socket.emit("errorMsg","Недостаточно денег");
      p.money-=car.price; car.owner=p.id; p.cars.push(car);
      log(room,`🚗 ${p.name} купил ${car.name} (${car.type}) за ${car.price.toLocaleString("ru-RU")} ₽.`);
    } else if(type==="repair"){
      if(cell!=="Автосервис") return socket.emit("errorMsg","Ремонт доступен на Автосервисе");
      const damaged=p.cars.filter(c=>!c.repaired);
      if(!damaged.length) return socket.emit("errorMsg","Нет машин, требующих ремонта");
      const die=rand(1,6);
      damaged.forEach(c=>{
        const delta=Math.max(10000,Math.round(c.repairCost*(0.55+die/10)));
        c.repairCost=delta; c.repaired=true; c.defect=false;
        if(p.money<delta) { p.debt += delta-p.money; p.money=0; }
        else p.money-=delta;
      });
      log(room,`🔧 ${p.name} отремонтировал ${damaged.length} машин.`);
    } else if(type==="sell"){
      if(cell!=="Скупка") return socket.emit("errorMsg","Продажа доступна на Скупке");
      const repaired=p.cars.filter(c=>c.repaired);
      if(!repaired.length) return socket.emit("errorMsg","Продавать можно отремонтированные машины");
      const car=repaired[0]; const value=Math.max(car.price+car.repairCost, rand(220000,1500000));
      p.money+=value; p.cars=p.cars.filter(c=>c.id!==car.id);
      log(room,`💰 ${p.name} продал ${car.name} за ${value.toLocaleString("ru-RU")} ₽.`);
    } else if(type==="race"){
      if(cell!=="Гонка") return socket.emit("errorMsg","Гонку можно начать только на клетке Гонка");
      if(!p.cars.length) return socket.emit("errorMsg","Для гонки нужна машина");
      room.auction={kind:"race",host:p.id,bids:[]};
      log(room,`🏁 ${p.name} объявил гонку. Другие игроки могут присоединиться.`);
    } else if(type==="auction"){
      if(cell!=="Аукцион") return socket.emit("errorMsg","Аукцион доступен на клетке Аукцион");
      const car=drawCar(room,Math.random()<.35?"retro":Math.random()<.5?"premium":"bitye");
      room.auction={kind:"auction",host:p.id,car,bids:[],current:0};
      log(room,`🔨 ${p.name} объявил аукцион: ${car.name}, старт ${car.price.toLocaleString("ru-RU")} ₽.`);
    } else {
      return socket.emit("errorMsg","Действие недоступно");
    }

    checkWinner(room);
    if(room.phase==="playing") nextTurn(room);
    io.to(room.code).emit("room",publicRoom(room));
  });

  socket.on("bid", ({amount})=>{
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.socketId===socket.id));
    if(!room || !room.auction) return;
    const p=getPlayer(room,socket.id); const a=Number(amount);
    if(room.auction.kind!=="auction") return;
    const min=Math.max(room.auction.current+10000,room.auction.car.price);
    if(!Number.isFinite(a)||a<min||p.money<a) return socket.emit("errorMsg","Недопустимая ставка");
    room.auction.current=a; room.auction.bids.push({player:p.id,amount:a});
    log(room,`💸 ${p.name} предложил ${a.toLocaleString("ru-RU")} ₽.`);
    io.to(room.code).emit("room",publicRoom(room));
  });

  socket.on("finishAuction", ()=>{
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.socketId===socket.id));
    if(!room?.auction || room.auction.kind!=="auction") return;
    if(room.auction.bids.length===0){ room.auction=null; log(room,"Аукцион завершён без ставок."); }
    else {
      const b=room.auction.bids.at(-1), winner=getPlayerById(room,b.player);
      if(!winner || winner.money<b.amount) return;
      winner.money-=b.amount; room.auction.car.owner=winner.id; winner.cars.push(room.auction.car);
      log(room,`🏆 ${winner.name} выиграл аукцион за ${b.amount.toLocaleString("ru-RU")} ₽.`);
      room.auction=null;
    }
    io.to(room.code).emit("room",publicRoom(room));
  });

  socket.on("endTurn", ()=>{
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.socketId===socket.id));
    if(!room || room.phase!=="playing") return;
    const p=getPlayer(room,socket.id);
    if(room.players[room.turn]!==p || !p.hasMoved) return;
    nextTurn(room);
    io.to(room.code).emit("room",publicRoom(room));
  });

  socket.on("disconnect", ()=>{
    for(const room of rooms.values()){
      const p=room.players.find(x=>x.socketId===socket.id);
      if(p){ p.socketId=null; log(room,`⚠️ ${p.name} отключился.`); io.to(room.code).emit("room",publicRoom(room)); }
    }
  });
});

setInterval(()=>{ for(const [code,room] of rooms){ if(room.players.every(p=>!p.socketId) && room.phase==="lobby") rooms.delete(code); } },60000);

server.listen(process.env.PORT||3000, ()=>console.log("Tachka Online: http://localhost:"+(process.env.PORT||3000)));
