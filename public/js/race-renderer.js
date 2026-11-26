'use strict';
// Shared by the local preview and the multiplayer client so every stage uses the same visuals.
window.createRaceRenderer = function createRaceRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const art = {};
  const sprites = new Image();
  const runners = new Image();
  const obstacles = new Image();
  const facades = new Image();
  const architecture = new Image();
  const trafficArt = new Image();
  const skyArt = new Image();
  let levelSpread = 1;
  let renderClock = 0;
  const roadTiles = {};
  const obstacleSprites = {
    'scrap-crate': [0, 130], glass: [1, 136], pipe: [2, 134], car: [3, 166],
    cargo: [4, 140], 'cargo-wall': [5, 152], debris: [6, 138], 'satellite-hull': [7, 168]
  };
  // Atlas pivots sit at the centre of each prop's physical footprint, not the
  // bottom of its transparent cell. The pipe, for example, stands on its left flange.
  const groundProps = {
    'scrap-crate': { pivot: [.50,.80], footprint: [[-.30,0],[0,-.48],[.31,0],[0,.42]] },
    glass: { pivot: [.50,.82], footprint: [[-.34,-.28],[-.36,-.12],[.35,.32],[.37,.16]] },
    pipe: { pivot: [.25,.82], footprint: [[-.20,-.12],[-.12,-.30],[.14,-.30],[.22,-.06],[.14,.20],[-.13,.20]] },
    car: { pivot: [.50,.69], footprint: [[-.43,-.36],[.04,-.54],[.46,.72],[.08,.49]] },
    cargo: { pivot: [.50,.77], footprint: [[-.32,-.05],[-.04,-.49],[.32,.02],[.04,.44]] },
    'cargo-wall': { pivot: [.50,.76], footprint: [[-.39,-.55],[-.41,-.20],[.36,.60],[.41,.25]] }
  };
  const colors = ['#65eff1', '#ff79d2'];
  const flightLevels = [
    { name: 'LOW', color: '#65dcff' },
    { name: 'MID', color: '#ffd17e' },
    { name: 'HIGH', color: '#c4a2ff' }
  ];
  const ALTITUDE_SPACING = 160;
  const RIVAL_VIEW = 12;
  let track, state, playerId, lastTime = 0, animate = true, snapshotAt = 0;
  const visualSpeeds = new Map();
  let docking = null;
  const DOCK_APPROACH = 8;
  const DOCK_DURATION = 2200;
  const redraw = () => render(lastTime);
  sprites.addEventListener('load', redraw);
  sprites.src = '/assets/racers.png';
  runners.addEventListener('load', redraw);
  runners.src = '/assets/racers-forward.png';
  obstacles.addEventListener('load', redraw);
  obstacles.src = '/assets/obstacles.png';
  facades.addEventListener('load', redraw);
  facades.src = '/assets/city-facades.png';
  architecture.addEventListener('load', redraw);
  architecture.src = '/assets/spaceport-architecture.png';
  trafficArt.addEventListener('load', redraw);
  trafficArt.src = '/assets/atmosphere-traffic.png';
  skyArt.addEventListener('load', redraw);
  skyArt.src = '/assets/atmosphere.png';
  function seatOf(player) { return player.seat ?? state.players.indexOf(player); }
  function point(lateral, distance, altitude = 0) {
    const scale = 14 / (14 + Math.max(-3, distance));
    // The ascent plane is the eventual MID corridor. LOW/HIGH unfold around
    // it, so the player's ship and four steering lanes never jump vertically.
    if (altitude !== 0 || levelSpread !== 1) altitude = 1 + (altitude - 1) * levelSpread;
    return [550 + lateral * 190 * scale, 180 + 395 * scale - altitude * ALTITUDE_SPACING * scale, scale];
  }
  function polygon(points, color) {
    ctx.beginPath(); points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath(); ctx.fillStyle = color; ctx.fill();
  }
  function line(from, to, z, color, altitude = 0) {
    polygon([point(from, z, altitude), point(to, z, altitude), point(to, z + .12, altitude), point(from, z + .12, altitude)], color);
  }
  function textAt(text, x, y, size = 15, color = '#e5f2ff') {
    ctx.font = `600 ${size}px Consolas, monospace`; ctx.textAlign = 'center'; ctx.fillStyle = color;
    ctx.shadowColor = '#07101c'; ctx.shadowBlur = 7; ctx.fillText(text, x, y); ctx.shadowBlur = 0;
  }
  const VIEW = 45;
  const STREET_VIEW = 160;
  const STREET_NEAR = -2.4;
  function glowLine(points, color, width = 2, glow = 10) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.shadowColor = color; ctx.shadowBlur = glow; ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke(); ctx.restore();
  }
  function gradient(x, y, x2, y2, stops) {
    const result = ctx.createLinearGradient(x, y, x2, y2);
    stops.forEach(([at, color]) => result.addColorStop(at, color)); return result;
  }
  function courseDistance(segment, me) { return (segment.progress?.[0] || 0) + me.distance; }
  function streetPalette(stage) {
    return stage === 'downtown'
      ? { ground:'#80959f', walk:'#b6c5ca', seam:'#8299a4', curb:'#e1e8e6', wall:'#b3c6cf', roof:'#d4dedf', shade:'#203e5545', light:'#8ae4ee', fog:'#a5c3d1' }
      : stage === 'spaceport'
        ? { ground:'#243340', walk:'#82959e', seam:'#344a58', curb:'#d9e3e6', wall:'#d5dce0', roof:'#f0f1ed', shade:'#0b1d3545', light:'#b5f0ff', fog:'#667f94' }
        : { ground:'#31342f', walk:'#565248', seam:'#2c302c', curb:'#7b7664', wall:'#3c4848', roof:'#655746', shade:'#0a151c80', light:'#efbd79', fog:'#416569' };
  }
  function groundQuad(x1, x2, near, far, color, height = 0) {
    polygon([point(x1,near,height),point(x2,near,height),point(x2,far,height),point(x1,far,height)],color);
  }
  function streetGround(segment, me) {
    const p=streetPalette(segment.stage), half=segment.laneCount/2, world=courseDistance(segment,me);
    // A full-width ground plane replaces the painted foreground. Sidewalks,
    // alleys and the playable road share one vanishing point and world scale.
    ctx.fillStyle=gradient(0,180,0,260,[[0,p.fog],[1,p.ground]]);ctx.fillRect(0,180,1100,470);
    for(const side of [-1,1]){
      groundQuad(side*half,side*9,STREET_NEAR,STREET_VIEW,p.walk);
      groundQuad(side*(half+.08),side*(half+.95),STREET_NEAR,STREET_VIEW,p.walk,.035);
      for(let row=Math.floor((world+STREET_NEAR)/2)*2;row<world+STREET_VIEW;row+=2){
        const z=row-world;
        groundQuad(side*(half+.08),side*(half+1.05),z,z+.025,p.seam,.037);
      }
      for(const offset of [.12,.55,1.02])
        groundQuad(side*(half+offset),side*(half+offset+.018),STREET_NEAR,STREET_VIEW,p.seam,.038);
      // Every block has a side street reaching the roadway, not a void beside a bridge.
      for(let block=Math.floor(world/18)-1;segment.stage!=='spaceport' && block*18<world+STREET_VIEW;block++){
        const z=block*18+(side===1?8:0)-world;
        if(z+3<STREET_NEAR)continue;
        groundQuad(side*(half+.08),side*9,Math.max(STREET_NEAR,z),z+3,p.ground,.04);
        for(let n=0;n<4;n++)groundQuad(side*(half+.18+n*.16),side*(half+.27+n*.16),Math.max(STREET_NEAR,z+.5),z+2.5,segment.stage==='downtown'?'#d6e2df':'#a5966b66',.045);
      }
    }
  }
  function streetBlocks(segment, me) {
    const world=courseDistance(segment,me), half=segment.laneCount/2, blocks=[];
    for(const side of [-1,1])for(let index=Math.floor(world/18)-1;index*18<world+STREET_VIEW;index++){
      const hash=((Math.imul(index+97,1103515245) ^ (side*7919))>>>0);
      const hangar=segment.stage==='spaceport';
      const z=index*18+(side===1?8:0)+3-world, length=hangar?18:13+(hash%3)*.45;
      if(z+length<STREET_NEAR || z>STREET_VIEW)continue;
      blocks.push({side,z,length,x:side*(half+1.07+(hash%3)*.12),width:2.8+(hash%4)*.35,
        height:hangar?4.8:(segment.stage==='downtown'?4.8:2.8)+(hash%5)*.38,
        cell:(hash%4)+(segment.stage==='downtown'?4:0),index});
    }
    return blocks.sort((a,b)=>(b.z+b.length)-(a.z+a.length));
  }
  function streetShadows(segment, blocks) {
    const p=streetPalette(segment.stage), half=segment.laneCount/2;
    for(const b of blocks){
      const near=Math.max(STREET_NEAR,b.z),far=b.z+b.length;
      // Building bases and short diagonal shadows join the architecture to the street.
      polygon([point(b.x,near),point(b.x,far),point(b.x-b.side*.85,far-1.6),point(b.x-b.side*.85,near-1.6)],p.shade);
      groundQuad(b.x-b.side*.12,b.x+b.side*.2,near,far,'#07141e66');
      if(b.side===-1)polygon([point(-half,near),point(-half,far),point(-half+.32,far-2),point(-half+.32,near-2)],p.shade);
    }
  }
  function streetOverpass(z, segment) {
    const half=segment.laneCount/2,city=segment.stage==='downtown',p=streetPalette(segment.stage);
    const left=-half-1.05,right=half+1.05,bottom=3.65,top=city?4.12:3.82;
    // This structure clears the camera before its near-plane removal. Its
    // columns are outside all playable lanes; it is scenery, not a new hazard.
    for(const x of [left,right]){
      polygon([point(x-.06,z),point(x+.06,z),point(x+.06,z,top),point(x-.06,z,top)],p.seam);
      glowLine([point(x,z),point(x,z,top)],p.curb,2,0);
    }
    polygon([point(left,z,bottom),point(right,z,bottom),point(right,z+1.8,bottom),point(left,z+1.8,bottom)],p.seam);
    polygon([point(left,z,top),point(right,z,top),point(right,z+1.8,top),point(left,z+1.8,top)],p.roof);
    polygon([point(left,z,bottom),point(right,z,bottom),point(right,z,top),point(left,z,top)],city?'#577b88':'#675644');
    if(city){
      for(let x=left+.1;x<right-.1;x+=.35){
        polygon([point(x,z,bottom+.07),point(x+.29,z,bottom+.07),point(x+.29,z,top-.06),point(x,z,top-.06)],'#a9d0d6');
        glowLine([point(x+.03,z,bottom+.12),point(x+.25,z,top-.1)],'#dce9e7',1,0);
      }
    }else{
      glowLine([point(left,z,top-.04),point(right,z,top-.04)],'#b09b77',2,0);
      for(let x=left+.2;x<right;x+=.5)glowLine([point(x,z,bottom),point(x,z,top)],'#352e28',2,0);
    }
    glowLine([point(left,z,bottom),point(right,z,bottom)],p.light,1.5,3);
  }
  function facadeFace(b, stage) {
    const near=Math.max(STREET_NEAR,b.z),far=b.z+b.length,p=streetPalette(stage);
    const corners=[point(b.x,near),point(b.x,far),point(b.x,far,b.height),point(b.x,near,b.height)];
    polygon(corners,p.wall);
    const atlas=stage==='spaceport'?architecture:facades;
    if(!atlas.complete || !atlas.naturalWidth)return;
    const sw=atlas.naturalWidth/4,sh=atlas.naturalHeight/2;
    const cellX=(b.cell%4)*sw,cellY=Math.floor(b.cell/4)*sh;
    const left=Math.max(0,Math.floor(Math.min(corners[0][0],corners[1][0])));
    const right=Math.min(1100,Math.ceil(Math.max(corners[0][0],corners[1][0])));
    ctx.imageSmoothingEnabled=false;
    // Perspective-correct vertical strips on a wall parallel to the street.
    // Texture u comes from world depth, so doors don't slide on their buildings.
    for(let x=left;x<right;x+=2){
      const scale=(x+1-550)/(b.x*190);
      if(scale<=0)continue;
      const depth=14/scale-14, u=Math.max(0,Math.min(.998,(depth-b.z)/b.length));
      const nextScale=(x+(b.side>0?3:-1)-550)/(b.x*190);
      const sample=Math.min(sw*(1-u),Math.max(1,Math.abs(14/nextScale-14-depth)*sw/b.length));
      const top=180+(395-b.height*ALTITUDE_SPACING)*scale;
      ctx.drawImage(atlas,cellX+u*sw,cellY,sample,sh,x,top,Math.min(2,right-x),b.height*ALTITUDE_SPACING*scale);
    }
    polygon(corners,b.side===1?'#081c292b':'#07131d10');
  }
  function streetBuilding(b, segment) {
    const p=streetPalette(segment.stage), outer=b.x+b.side*b.width;
    const atlas=segment.stage==='spaceport'?architecture:facades;
    const near=Math.max(STREET_NEAR,b.z),far=b.z+b.length;
    ctx.save();ctx.globalAlpha=Math.min(1,(STREET_VIEW-b.z)/24);
    // Roof and end wall give each block actual volume; the street-facing facade
    // recedes in perspective instead of enlarging a flat cutout.
    polygon([point(b.x,near,b.height),point(outer,near,b.height),point(outer,far,b.height),point(b.x,far,b.height)],p.roof);
    facadeFace(b,segment.stage);
    if(b.z>=STREET_NEAR){
      const a=point(b.x,b.z),c=point(outer,b.z,b.height), width=Math.abs(c[0]-a[0]),height=a[1]-c[1];
      const left=Math.min(a[0],c[0]);
      if(atlas.complete && atlas.naturalWidth){
        const sw=atlas.naturalWidth/4,sh=atlas.naturalHeight/2;
        ctx.drawImage(atlas,(b.cell%4)*sw,Math.floor(b.cell/4)*sh,sw,sh,left,c[1],width,height);
      }else{ctx.fillStyle=p.wall;ctx.fillRect(left,c[1],width,height);}
      ctx.fillStyle=p.shade;ctx.fillRect(left,c[1],width,height);
    }
    glowLine([point(b.x,near,b.height),point(b.x,far,b.height)],p.roof,1.5,0);
    glowLine([point(b.x,near,.08),point(b.x,far,.08)],p.curb,2,0);
    if(b.z>55){
      ctx.globalAlpha*=Math.min(.8,(b.z-55)/110);
      polygon([point(b.x,near),point(b.x,far),point(b.x,far,b.height),point(b.x,near,b.height)],p.fog);
      if(b.z>=STREET_NEAR)polygon([point(b.x,b.z),point(outer,b.z),point(outer,b.z,b.height),point(b.x,b.z,b.height)],p.fog);
      ctx.globalAlpha=Math.min(1,(STREET_VIEW-b.z)/24);
    }
    // A projecting sign travels with each block and strengthens the sense of passing shops.
    const signZ=b.z+2.4;
    if(signZ>STREET_NEAR && signZ<65){
      const [x,y,s]=point(b.x-b.side*.16,signZ,1.3);
      ctx.fillStyle=p.shade;ctx.fillRect(x-23*s,y-60*s,46*s,66*s);
      ctx.fillStyle=segment.stage==='slums'?'#18292c':'#e3edeb';ctx.fillRect(x-20*s,y-60*s,40*s,60*s);
      ctx.fillStyle=p.light;ctx.fillRect(x-18*s,y-58*s,3*s,56*s);
      ctx.fillStyle=segment.stage==='slums'?p.light:'#33576c';ctx.font=`bold ${12*s}px Consolas, monospace`;ctx.textAlign='center';
      const label=segment.stage==='downtown'?['M','E','T','R','O']:segment.stage==='spaceport'?['B','A','Y']:['S','H','O','P'];
      label.forEach((letter,i)=>ctx.fillText(letter,x+2*s,y-(46-i*10)*s));
    }
    ctx.restore();
  }
  function streetLamp(side, z, segment) {
    const half=segment.laneCount/2,p=streetPalette(segment.stage),x=side*(half+.48);
    const base=point(x,z,.04),top=point(x,z,1.85),tip=point(x-side*.25,z,1.85);
    groundQuad(x-.13,x+.13,z-.25,z+.25,'#15242d66',.04);
    glowLine([base,top,tip],segment.stage==='downtown'?'#6a8796':'#504b3d',Math.max(1,5*base[2]),0);
    glowLine([top,tip],p.light,Math.max(1,4*base[2]),5);
    // Pavement light remains on the ground and does not obscure hazards.
    groundQuad(x-.18,x+.18,z-.5,z+.5,p.light+'16',.05);
    if(segment.stage==='slums'){
      const wire=[];
      for(let n=0;n<=12;n++){const t=n/12;wire.push(point(-half-1.1+(half*2+2.2)*t,z,2.65-Math.sin(t*Math.PI)*.34));}
      if(side===-1)glowLine(wire,'#15282b',Math.max(1,2*base[2]),0);
    }
  }
  function streetPlanter(side,z,segment) {
    const x=side*(segment.laneCount/2+.72),[sx,sy,s]=point(x,z,.04);
    ctx.save();ctx.translate(sx,sy);ctx.scale(s,s);ctx.imageSmoothingEnabled=false;
    ctx.fillStyle='#1b303a55';ctx.fillRect(-36,-2,76,9);
    polygon([[-31,-27],[22,-31],[34,-20],[-21,-16]],'#d2dcd9');
    polygon([[-31,-27],[-21,-16],[-21,2],[-31,-9]],'#718c98');
    polygon([[-21,-16],[34,-20],[34,-2],[-21,2]],'#a8b9be');
    ctx.fillStyle='#254e48';ctx.fillRect(-27,-44,54,19);
    for(let n=0;n<38;n++){
      ctx.fillStyle=['#31594b','#42745a','#689367','#8ba97c'][n%4];
      ctx.fillRect(-28+(n*13)%51,-38-(n*7)%23,5+n%4,5);
    }
    ctx.restore();
  }
  function streetscape(segment, me, blocks) {
    const world=courseDistance(segment,me),items=blocks.map(block=>({z:block.z,block}));
    for(let row=Math.floor(world/72)*72+38;row<world+STREET_VIEW;row+=72){
      const z=row-world;if(z>=STREET_NEAR && segment.stage!=='spaceport')items.push({z,overpass:true});
    }
    for(let row=Math.floor((world+STREET_NEAR)/12)*12;row<world+100;row+=12){
      const z=row-world;
      if(z<STREET_NEAR)continue;
      for(const side of [-1,1]){
        if(segment.stage!=='spaceport')items.push({z,side});
        if(segment.stage==='downtown')items.push({z:z+4,side,planter:true});
      }
    }
    items.sort((a,b)=>b.z-a.z);
    for(const item of items){
      if(item.block)streetBuilding(item.block,segment);
      else if(item.overpass)streetOverpass(item.z,segment);
      else if(item.planter)streetPlanter(item.side,item.z,segment);
      else streetLamp(item.side,item.z,segment);
    }
  }
  function hangarCeiling(segment, me) {
    const half=segment.laneCount/2+1.1,world=courseDistance(segment,me);
    ctx.fillStyle=gradient(0,0,0,230,[[0,'#344958'],[1,'#91a5b5']]);ctx.fillRect(0,0,1100,230);
    polygon([point(-half,STREET_NEAR,4.8),point(half,STREET_NEAR,4.8),point(half,STREET_VIEW,4.8),point(-half,STREET_VIEW,4.8)],'#617582');
    for(const x of [-half,-1.6,0,1.6,half])
      glowLine([point(x,STREET_NEAR,4.78),point(x,STREET_VIEW,4.78)],x===0?'#203342':'#ccdae1',x===0?5:2,0);
    for(let row=Math.floor(world/10)*10;row<world+STREET_VIEW;row+=10){
      const z=row-world;if(z<STREET_NEAR)continue;
      glowLine([point(-half,z,4.7),point(half,z,4.7)],'#2b3f50',Math.max(1,12*point(0,z)[2]),0);
      for(const side of [-1,1])glowLine([point(side*.6,z,4.65),point(side*2.5,z,4.65)],'#e4faff',Math.max(1,6*point(0,z)[2]),4);
    }
  }
  function roadTile(stage) {
    if(roadTiles[stage])return roadTiles[stage];
    const tile=document.createElement('canvas');tile.width=512;tile.height=1024;
    const surface=tile.getContext('2d');
    const city=stage==='downtown', steel=stage==='spaceport';
    const palette=city?['#42545c','#485b62','#3d5058','#50616a']:
      steel?['#2c414e','#304652','#293d49','#354b57']:['#443831','#4b3e33','#39332e','#514135'];
    let seed=city?2903:steel?7019:1427;
    const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return (seed>>>0)/4294967296;};
    const rect=(x,y,w,h,color)=>{surface.fillStyle=color;surface.fillRect(Math.round(x),Math.round(y),w,h);};
    const path=(points,color,width=2)=>{
      surface.strokeStyle=color;surface.lineWidth=width;surface.beginPath();
      points.forEach(([x,y],i)=>i?surface.lineTo(x,y):surface.moveTo(x,y));surface.stroke();
    };
    if(city){
      // Large ceramic-composite slabs: clean ivory faces, recessed graphite
      // joints and small cyan service inlays. Keep wear out of this material.
      rect(0,0,512,1024,'#a2b6c1');
      const whites=['#e5ecec','#edf1ed','#dae5e8','#e8eeeb'];
      for(let y=0;y<1024;y+=256)for(let x=0;x<512;x+=128){
        rect(x+2,y+2,124,252,'#bacbd2');
        rect(x+4,y+4,120,248,whites[Math.floor(random()*whites.length)]);
        rect(x+4,y+4,120,2,'#ffffff');
        rect(x+4,y+250,120,2,'#c5d2d8');
        // Narrow L-shaped inlays and flush access ports, clear of lane centres.
        path([[x+12,y+52],[x+12,y+18],[x+34,y+18]],'#7f9ba9',3);
        path([[x+12,y+48],[x+12,y+18],[x+30,y+18]],'#55c7d7',1);
        rect(x+100,y+218,14,18,'#a3b8c3');
        rect(x+102,y+220,10,14,'#d3dfe3');
        rect(x+104,y+222,6,2,'#3cabc2');
        for(let i=0;i<3;i++)rect(x+20+i*5,y+232,2,5,'#97afba');
      }
      // Sparse fine flecks preserve the pixel surface without dirtying it.
      for(let n=0;n<1800;n++)rect(Math.floor(random()*256)*2,Math.floor(random()*512)*2,2,2,'#708e9d0c');
      for(const x of [5,503]){
        rect(x,0,4,1024,'#5a7889');
        for(let y=0;y<1024;y+=64)rect(x+1,y+8,2,40,'#65d8e3');
      }
      roadTiles[stage]=tile;return tile;
    }
    // Generate a restrained, seeded pixel material once per district. Texture
    // coordinates belong to the course, so grit and repairs never swim/flicker.
    rect(0,0,512,1024,palette[0]);
    for(let y=0;y<1024;y+=8)for(let x=0;x<512;x+=8)
      rect(x,y,8,8,palette[Math.floor(random()*palette.length)]);
    if(city || steel){
      const panelHeight=steel?256:128;
      for(let y=0;y<1024;y+=panelHeight)for(let x=0;x<512;x+=128){
        rect(x+3,y+3,122,panelHeight-6,palette[Math.floor(random()*palette.length)]);
        rect(x,y,2,panelHeight,steel?'#142733':'#283b43');
        rect(x,y,128,3,steel?'#142733':'#283b43');
        rect(x+3,y+3,120,1,steel?'#586d76':'#72828a');
        if(steel){
          for(const xx of [x+10,x+116])for(const yy of [y+10,y+panelHeight-12]){
            rect(xx,yy,4,4,'#122733');rect(xx,yy,2,2,'#7a8990');
          }
          for(let yy=y+28;yy<y+panelHeight-20;yy+=24)for(let xx=x+24;xx<x+110;xx+=24){
            rect(xx,yy,7,2,'#455b67');rect(xx+3,yy-2,6,2,'#455b67');
            rect(xx,yy+2,6,1,'#1c303c');
          }
        }
      }
    }else{
      // Old asphalt with oxidised repair plates and crumbling tar seams.
      for(let n=0;n<15;n++){
        const x=24+random()*330,y=24+random()*880,w=44+Math.floor(random()*72),h=30+Math.floor(random()*72);
        rect(x,y,w,h,'#211f1c');rect(x+3,y+3,w-6,h-6,n%2?'#654634':'#302e29');
        for(let i=0;i<18;i++)rect(x+random()*w,y+(i%2?h:0),3+random()*7,2,'#b1794266');
        if(n%2){
          for(const xx of [x+6,x+w-9])for(const yy of [y+6,y+h-7])rect(xx,yy,3,3,'#211d18');
          for(let i=0;i<12;i++)rect(x+4+random()*(w-12),y+4+random()*(h-10),4+random()*10,2,'#ab602e70');
        }
      }
      // Rust blooms spread from old hardware into the fractured pavement.
      for(let n=0;n<34;n++){
        const x=random()*480,y=random()*980,w=12+random()*36,h=16+random()*58;
        rect(x,y,w,h,'#8c4a2645');rect(x+5,y+8,w*.6,h*.7,'#b86c3040');
        for(let i=0;i<8;i++)rect(x+random()*w,y+random()*h,4,4,'#c1833b55');
      }
    }
    // Small clusters, rather than smooth gradients, keep the foreground in
    // the same pixel-art language as the environment and obstacle sprites.
    for(let n=0;n<(steel?1600:17000);n++){
      const x=Math.floor(random()*256)*2,y=Math.floor(random()*512)*2;
      rect(x,y,2+Math.floor(random()*2)*2,2,steel?'#b8e1f00d':random()>.53?'#b9b7a52c':'#07151d3b');
    }
    if(!steel){
      for(let n=0;n<32;n++){
        let x=30+Math.floor(random()*220)*2,y=32+Math.floor(random()*410)*2;
        const points=[[x,y]];
        for(let i=0;i<7;i++){x+=Math.floor(random()*9-4)*2;y+=4+Math.floor(random()*4)*2;points.push([x,y]);}
        path(points,'#171814cc',3);path(points.map(([xx,yy])=>[xx+2,yy]),'#bc9a6945',1);
        path([points[2],[points[2][0]-12,points[2][1]+6],[points[2][0]-18,points[2][1]+18]],'#17181499',2);
      }
      for(let n=0;n<(city?5:12);n++){
        const x=24+random()*390,y=30+random()*920,w=24+random()*60;
        rect(x,y,w,10,'#0d242e66');rect(x+8,y-4,w-18,20,'#132a3366');
        rect(x+6,y+3,w-14,2,city?'#8bbcc53b':'#76a3a533');
      }
    }
    // Recessed service covers, drain slots and edge wear provide scale.
    for(const x of [8,480])for(let y=48;y<1024;y+=128){
      rect(x,y,24,62,'#101f29');rect(x+2,y+2,20,58,'#44525a');
      for(let slot=0;slot<7;slot++)rect(x+4,y+6+slot*7,16,4,'#111e28');
      rect(x+1,y,22,2,steel?'#b99b5a':'#aa6738');
      if(!steel){rect(x-3,y+8,3,48,'#a05a2f88');rect(x+5,y+62,16,18,'#8b492b66');}
    }
    for(let n=0;n<5;n++){
      const x=70+(n%3)*128,y=110+n*176;
      rect(x,y,42,56,'#142630');rect(x+2,y+2,38,52,steel?'#44535b':'#34454c');
      for(let yy=y+8;yy<y+50;yy+=8)rect(x+6,yy,30,2,'#142a34');
      rect(x+4,y+3,8,2,steel?'#bda26b':'#7c979b');
    }
    if(steel)for(const x of [38,470]){
      rect(x-3,0,10,1024,'#122733');
      for(let y=0;y<1024;y+=128){rect(x,y+12,4,84,'#d9f3f5');rect(x,y+99,4,7,'#66d7ec');}
    }
    roadTiles[stage]=tile;return tile;
  }
  function roadSurface(segment, me) {
    const tile=roadTile(segment.stage), top=point(0,STREET_VIEW)[1];
    const worldDistance=courseDistance(segment,me),half=segment.laneCount/2;
    ctx.save();
    polygon([[550,180],point(-half,STREET_VIEW),point(half,STREET_VIEW)],segment.stage==='downtown'?'#b8cdd4':'#344748');
    // Scanline projection follows exactly the road's perspective. Averaging
    // a wider source strip at the horizon avoids noisy, crawling distant grit.
    for(let y=Math.ceil(top);y<650;y+=2){
      const scale=(y+1-180)/395, depth=14/scale-14;
      const nextDepth=14/((y+3-180)/395)-14;
      const sy=((worldDistance+depth)*32%tile.height+tile.height)%tile.height;
      const sampleHeight=Math.min(tile.height-sy,Math.max(1,(depth-nextDepth)*32));
      const width=segment.laneCount*190*scale;
      ctx.imageSmoothingEnabled=scale<.65;
      ctx.drawImage(tile,0,sy,tile.width,sampleHeight,550-width/2,y,width,2);
    }
    polygon([point(-segment.laneCount/2,STREET_VIEW),point(segment.laneCount/2,STREET_VIEW),
      [550+segment.laneCount*190*.6,650],[550-segment.laneCount*190*.6,650]],
      gradient(0,top,0,650,segment.stage==='downtown'
        ? [[0,'#60849b66'],[.38,'#8ba7b51a'],[1,'#ffffff00']]
        : [[0,'#1d394c99'],[.38,'#14253335'],[1,'#07121c10']]));
    ctx.restore();
  }
  function groundContact(object, z, segment) {
    const prop=groundProps[object.visual];
    if(!prop)return;
    const lateral=object.lane-(segment.laneCount-1)/2;
    const footprint=(size,dx=0,dz=0)=>prop.footprint.map(([x,d])=>point(lateral+x*size+dx,z+d*size+dz));
    // Road-plane stains, a short cast shadow, then tight ambient occlusion.
    // All share the sprite's contact pivot, so props don't hover over an oval.
    polygon(footprint(1.22),segment.stage==='slums'?'#58473535':'#07121d2b');
    polygon(footprint(1.2,.10,-.12),'#02091145');
    polygon(footprint(1.05,.035,-.035),'#02080dc4');
    polygon(footprint(.82),'#02070ee8');
    if(object.visual==='car')polygon(footprint(.85),'#ffb34735');
  }
  function atmosphere(segment, me) {
    const ascent=segment.flightPhase==='atmosphere';
    const progress=ascent?me.distance/segment.length:1;
    const world=courseDistance(segment,me);
    ctx.save();ctx.globalAlpha=ascent?1:1-smooth(me.distance/segment.arrivalBlend);
    ctx.fillStyle=gradient(0,0,0,650,[[0,'#050d26'],[.48,'#102b55'],[1,'#477a9b']]);
    ctx.fillRect(0,0,1100,650);
    if(skyArt.complete && skyArt.naturalWidth){
      ctx.save();ctx.globalAlpha*=1-smooth((progress-.30)/.70);
      ctx.imageSmoothingEnabled=false;
      // Clouds and the distant city fall behind the climbing chase camera.
      ctx.drawImage(skyArt,0,-160+progress*180,1100,815);
      ctx.restore();
    }
    ctx.save();ctx.globalAlpha*=smooth((progress-.35)/.6);
    ctx.fillStyle='#cadfff';
    for(let i=0;i<95;i++){
      const x=(i*347+71)%1100,y=(i*i*41+19)%390;
      ctx.fillRect(x,y,i%11===0?3:1.5,i%11===0?3:1.5);
    }
    // Earth becomes a curved blue limb as the cloud layer thins out.
    const horizon=650-progress*140;
    for(const [offset,color] of [[-15,'#6bbce82b'],[-7,'#94dcf77a'],[0,'#acdff1'],[6,'#34668c']]){
      ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(550,horizon+720+offset,1450,720,0,0,Math.PI*2);ctx.fill();
    }
    for(let i=0;i<42;i++){
      const x=(i*173)%1180-40,y=horizon+25+(i*29)%160+(x-550)**2/5800;
      ctx.fillStyle=i%3?'#8ac1d63e':'#d1e5e959';
      ctx.fillRect(x,y,28+i%5*17,3+i%3*2);
    }
    ctx.restore();
    // Parallax vapour and slipstream traces travel down/out of the view. Keep
    // the central lanes clear, and fade all cloud traces before orbital entry.
    ctx.save();ctx.globalAlpha*=1-smooth((progress-.60)/.35);
    for(let i=0;i<30;i++){
      const z=((i*7.71-world)%40+40)%40, s=14/(14+z);
      const side=i%2?1:-1, x=550+side*(340+(i%5)*37)*s;
      const y=150+480*s;
      ctx.fillStyle=i%3?'#b1d3e322':'#ecfaff38';
      ctx.fillRect(Math.round(x/3)*3,Math.round(y/3)*3,(24+i%4*28)*s,3+5*s);
      if(i%4===0)glowLine([[x,y],[x+side*8*s,y+45*s]],'#b2edff55',1,0);
    }
    ctx.restore();ctx.restore();
  }
  function flightBriefing(segment,me) {
    const ascent=segment.flightPhase==='atmosphere', unfolding=ascent && levelSpread>0;
    const horizontal=seatOf(me)===0?'A/D':'Left/Right',vertical=seatOf(me)===0?'W/S':'Up/Down';
    const title=ascent?(unfolding?'ATMOSPHERIC BREAKTHROUGH':'ATMOSPHERIC ASCENT'):'ORBIT REACHED';
    const instruction=ascent?(unfolding?`LOW / MID / HIGH deploying · ${vertical} unlocks at orbit entry`:`${horizontal} steer · Avoid crossing traffic · Altitude locked`):`${vertical} altitude unlocked · ${horizontal} changes lanes`;
    ctx.fillStyle='#081a30e8';ctx.fillRect(255,22,590,65);
    glowLine([[255,22],[845,22]],ascent?'#87dfff':'#ffd17e',2,2);
    textAt(title,550,47,17,ascent?'#aceaff':'#ffe0a0');
    textAt(instruction,550,70,12,'#e4f2ff');
    if(ascent){
      ctx.fillStyle='#24445e';ctx.fillRect(255,88,590,3);
      ctx.fillStyle='#a4efff';ctx.fillRect(255,88,590*me.distance/segment.length,3);
      textAt(unfolding?`Enter on MID · Keep steering with ${horizontal}`:'LAUNCH VECTOR / FOUR-LANE CORRIDOR',550,578,12,'#bce5f1');
    }
  }
  function road(segment, me) {
    const half = segment.laneCount / 2;
    const world=courseDistance(segment,me);
    const accent = segment.stage === 'downtown' ? '#83e7ef' : segment.stage === 'slums' ? '#e5b26d' : '#a7a5ff';
    if (me.mode === 'flight') {
      for (let level = 0; level < 3; level++) {
        if(level!==1 && levelSpread===0)continue;
        ctx.save(); if(level!==1)ctx.globalAlpha*=levelSpread;
        const color=flightLevels[level].color, selected=level===me.altitude;
        if(selected){
          const lane=me.lane-(segment.laneCount-1)/2;
          polygon([point(lane-.48,0,level),point(lane+.48,0,level),point(lane+.48,VIEW,level),point(lane-.48,VIEW,level)],color+'12');
        }
        for(let boundary=-half;boundary<=half;boundary++)
          glowLine([point(boundary,0,level),point(boundary,VIEW,level)],color+(selected?'65':'30'),selected?1.5:1,2);
        for(let d=Math.ceil(me.distance/8)*8;d<me.distance+VIEW;d+=8)
          line(-half,half,d-me.distance,color+(selected?'40':'19'),level);
        ctx.restore();
      }
      return;
    }
    roadSurface(segment,me);
    // Longitudinal wear and reflected light stay locked to the road's perspective.
    for (let lane=0;lane<segment.laneCount;lane++) {
      const center=lane-(segment.laneCount-1)/2;
      if(segment.stage!=='downtown')for (const offset of [-.22,.22]) polygon([point(center+offset-.035,STREET_VIEW),point(center+offset+.035,STREET_VIEW),point(center+offset+.055,STREET_NEAR),point(center+offset-.055,STREET_NEAR)],'#060e172c');
      polygon([point(center-.25,STREET_VIEW),point(center+.25,STREET_VIEW),point(center+.35,STREET_NEAR),point(center-.35,STREET_NEAR)],
        gradient(0,300,0,650,[[0,'#96d5e519'],[.65,'#92cfdd09'],[1,'#92cfdd00']]));
    }
    for(let row=Math.floor(world/2)*2-2;row<world+STREET_VIEW;row+=2){
      const z=row-world;
      line(-half,half,z,'#a7c9df0b');
      if(row%6===0) for(let lane=1;lane<segment.laneCount;lane++) {
        const x=lane-half;
        polygon([point(x-.012,z),point(x+.012,z),point(x+.012,z+2),point(x-.012,z+2)],segment.stage==='downtown'?'#396a8299':'#d3e6ee85');
      }
    }
    const p=streetPalette(segment.stage);
    for(const side of [-1,1]) {
      // Low kerbs meet the pavement. Removing the raised continuous guardrails
      // is what makes the lanes read as a city street instead of an elevated track.
      polygon([point(side*half,STREET_NEAR),point(side*half,STREET_VIEW),point(side*half,STREET_VIEW,.035),point(side*half,STREET_NEAR,.035)],p.seam);
      groundQuad(side*half,side*(half+.09),STREET_NEAR,STREET_VIEW,p.curb,.035);
      for(let row=Math.floor(world/4)*4;row<world+STREET_VIEW;row+=4){
        const z=row-world;
        groundQuad(side*(half+.015),side*(half+.045),z,z+.45,accent,.038);
      }
    }
  }
  function drawObject(object, z, segment, time, me) {
    const altitude=segment.mode==='flight' ? object.altitude??1 : 0;
    const [x,y,scale]=point(object.lane-(segment.laneCount-1)/2,z,altitude);
    const grounded=segment.mode!=='flight' && object.type!=='coin';
    ctx.save();ctx.translate(x,y);ctx.scale(scale,scale);
    if(segment.mode!=='flight' && !grounded){
      ctx.fillStyle='#02081370';ctx.beginPath();ctx.ellipse(0,2,object.type==='coin'?20:46,8,0,0,Math.PI*2);ctx.fill();
    }
    const sprite=obstacleSprites[object.visual];
    if(object.motion){
      const direction=object.direction||1, size=188;
      ctx.save();ctx.scale(direction,1);
      if(trafficArt.complete && trafficArt.naturalWidth){
        const sw=trafficArt.naturalWidth/2,sh=trafficArt.naturalHeight/2,cell=object.sprite||0;
        ctx.imageSmoothingEnabled=false;
        ctx.drawImage(trafficArt,(cell%2)*sw,Math.floor(cell/2)*sh,sw,sh,-size/2,-size*.77,size,size);
      }
      ctx.restore();
      glowLine([[-64,-7],[64,-7]],'#ffcc82',2,3);
    }else if(object.type!=='coin' && sprite && obstacles.complete && obstacles.naturalWidth){
      const [cell,size]=sprite, sw=obstacles.naturalWidth/4, sh=obstacles.naturalHeight/2;
      ctx.imageSmoothingEnabled=false;
      const pivot=grounded?(groundProps[object.visual]?.pivot||[.5,.9]):[.5,.9];
      ctx.save();
      if(segment.mode==='flight')ctx.rotate(Math.sin(time/1100+object.distance)*.045);
      ctx.drawImage(obstacles,(cell%4)*sw,Math.floor(cell/4)*sh,sw,sh,-size*pivot[0],-size*pivot[1],size,size);
      ctx.restore();
    }else if(object.type==='coin'){
      const crystal=segment.stage==='spaceport', tone=crystal?'#9eebff':'#ffd473';
      const bob=Math.sin(time/380+object.distance)*4;
      ctx.translate(0,-34+bob);
      ctx.shadowColor=tone;ctx.shadowBlur=15;
      const spin=.3+.7*Math.abs(Math.cos(time/650+object.distance));ctx.scale(spin,1);
      if(crystal){
        polygon([[0,-30],[19,-4],[0,24],[-19,-4]],'#77badd');
        polygon([[0,-30],[0,24],[-19,-4]],'#dcfaff');
        polygon([[0,-30],[19,-4],[0,1]],'#a9e9ff');
        glowLine([[0,-30],[19,-4],[0,24],[-19,-4],[0,-30]],'#e9fdff',1.5,6);
      }else{
        ctx.fillStyle=gradient(-20,-24,20,24,[[0,'#fff4b5'],[.3,'#e4aa3d'],[.55,'#ffe7a0'],[1,'#8e5018']]);
        ctx.beginPath();ctx.ellipse(0,0,21,25,0,0,Math.PI*2);ctx.fill();
        ctx.shadowBlur=0;ctx.strokeStyle='#fff1b4';ctx.lineWidth=2;ctx.stroke();
        ctx.strokeStyle='#9e6829';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,0,15,19,0,0,Math.PI*2);ctx.stroke();
        polygon([[0,-12],[7,0],[0,12],[-7,0]],'#fff4bf');
        glowLine([[-10,-17],[-4,-20],[5,-19]],'#fffbe2',2,3);
      }
    }else if(object.visual==='car'){
      // Armored vehicle: glass cabin, body panels, tires and rear lights.
      ctx.fillStyle='#030810';ctx.fillRect(-49,-12,16,18);ctx.fillRect(33,-12,16,18);
      polygon([[-55,-8],[-55,-34],[-34,-66],[31,-66],[54,-34],[54,-8]],gradient(0,-66,0,0,[[0,'#e6edf0'],[.5,'#718997'],[1,'#263b4b']]));
      polygon([[-31,-59],[27,-59],[40,-36],[-43,-36]],gradient(0,-60,0,-35,[[0,'#6fbbd5'],[1,'#132c43']]));
      glowLine([[-25,-56],[23,-56]],'#c4f6ff',1,2);
      ctx.fillStyle='#132333';ctx.fillRect(-49,-27,98,14);
      glowLine([[-47,-26],[-28,-26]],'#ff626b',4,10);glowLine([[28,-26],[47,-26]],'#ff626b',4,10);
      ctx.fillStyle='#b4c2cb';ctx.fillRect(-11,-23,22,7);
      glowLine([[-48,-8],[48,-8]],'#6b8798',3,0);
    }else if(object.visual==='glass'){
      polygon([[-43,0],[-43,-76],[36,-76],[43,-68],[43,0]],gradient(-43,-70,43,0,[[0,'#d0fbff77'],[.4,'#7bd5ef25'],[1,'#337f9e88']]));
      polygon([[36,-76],[43,-68],[43,0],[36,-7]],'#4d91aa');
      glowLine([[-43,0],[-43,-76],[36,-76],[36,-7]],'#bff5ff',2,5);
      glowLine([[-31,-9],[-8,-38],[-17,-44],[21,-67]],'#e0ffff',1.5,2);
      polygon([[-35,-67],[-25,-67],[22,-12],[12,-12]],'#dcffff33');
      ctx.fillStyle='#243d4b';ctx.fillRect(-47,-4,94,7);
    }else if(object.visual==='debris'){
      ctx.rotate(Math.sin(time/700+object.distance)*.12);
      polygon([[-42,-18],[-27,-55],[7,-67],[40,-37],[29,-5],[-8,3]],'#405b72');
      polygon([[-27,-55],[7,-67],[40,-37],[0,-26]],'#9bafbc');
      polygon([[0,-26],[40,-37],[29,-5],[-8,3]],'#273f55');
      polygon([[-27,-55],[0,-26],[-8,3],[-42,-18]],'#68849a');
      glowLine([[-19,-12],[0,-26],[-4,-45]],'#94d5eb',2,4);
      for(const [a,b] of [[-19,-33],[14,-18],[7,-49]]){ctx.fillStyle='#172d3e';ctx.beginPath();ctx.ellipse(a,b,5,3,0,0,Math.PI*2);ctx.fill();}
    }else if(object.visual==='satellite-hull'){
      for(const side of [-1,1]){
        polygon([[side*25,-47],[side*77,-57],[side*77,-15],[side*25,-5]],'#163152');
        for(let col=0;col<4;col++)for(let row=0;row<3;row++){
          const left=side*(29+col*11);ctx.fillStyle=(col+row)%2?'#3473a1':'#265681';ctx.fillRect(left-(side<0?9:0),-43+row*10,9,8);
        }
      }
      polygon([[-23,-55],[10,-65],[26,-46],[26,-5],[-23,0]],gradient(0,-60,0,0,[[0,'#d8e3ed'],[.5,'#748a9c'],[1,'#394b60']]));
      glowLine([[-12,-27],[14,-27]],'#ffa76b',4,9);
      glowLine([[0,-60],[0,-81],[15,-88]],'#b7cfdf',2,0);
    }else if(object.visual==='pipe'){
      ctx.fillStyle=gradient(0,-38,0,0,[[0,'#b6aaa0'],[.2,'#706e6c'],[.48,'#bcb2a2'],[1,'#343d46']]);ctx.fillRect(-48,-36,96,32);
      for(const side of [-1,1]){ctx.fillStyle='#23313d';ctx.fillRect(side*35-5,-40,10,43);ctx.fillStyle='#c4a273';ctx.fillRect(side*35-3,-34,6,23);}
      glowLine([[-29,-30],[29,-30]],'#e7d0a2',1,0);
    }else{
      const solid=object.type==='barrier', cargo=segment.stage==='spaceport';
      const face=gradient(-40,-65,40,0,[[0,solid?'#6d8292':cargo?'#6b839c':'#a78660'],[1,solid?'#263c4d':cargo?'#283c58':'#493c32']]);
      polygon([[-43,-4],[-43,-58],[28,-58],[28,-4]],face);
      polygon([[-43,-58],[-28,-72],[43,-72],[28,-58]],solid?'#a0b4bf':'#c0b19a');
      polygon([[28,-58],[43,-72],[43,-18],[28,-4]],'#29394a');
      ctx.strokeStyle='#102131';ctx.lineWidth=3;ctx.strokeRect(-36,-51,57,40);
      for(const xx of [-32,17])for(const yy of [-48,-14]){ctx.fillStyle='#d2d5cc';ctx.beginPath();ctx.arc(xx,yy,2,0,Math.PI*2);ctx.fill();}
      if(solid){ctx.fillStyle='#e1b66a';ctx.fillRect(-41,-29,67,10);for(let xx=-40;xx<20;xx+=16)polygon([[xx,-29],[xx+7,-29],[xx+14,-19],[xx+7,-19]],'#172937');}
      else{glowLine([[-33,-42],[17,-17]],'#b8c9c6',3,0);glowLine([[-33,-17],[17,-42]],'#b8c9c6',3,0);glowLine([[-11,-61],[9,-61]],cargo?'#9ddcff':'#ffd291',2,5);}
    }
    ctx.restore();
    if(segment.mode==='flight' && object.type!=='coin'){
      const level=flightLevels[altitude], onCourse=altitude===me.altitude && Math.abs(object.lane-me.lane)<.48;
      ctx.save();
      ctx.globalAlpha=Math.min(1,(VIEW-z)/6);
      ctx.strokeStyle=level.color;ctx.lineWidth=onCourse?2:1;
      ctx.beginPath();ctx.ellipse(x,y,55*scale,10*scale,0,0,Math.PI*2);ctx.stroke();
      // Only nearby hazards need text; distant level rings keep the horizon
      // readable instead of stacking labels over one another.
      if(z<24){
        const label=object.motion ? (object.direction>0?'TRAFFIC →':'← TRAFFIC') : `${level.name} · L${object.lane+1}`;
        ctx.fillStyle=onCourse?'#3b2420ed':'#081323e8';ctx.fillRect(x-42,y+9,84,18);
        textAt(label,x,y+22,11,level.color);
        if(onCourse && z<22){
          glowLine([[x-38,y+8],[x+38,y+8]],'#fff1cf',2,3);
          textAt('ON COURSE',x,y+40,10,'#fff1cf');
        }
      }
      ctx.restore();
    }
  }
  function forwardDistance(fromId, distance, targetId, targetDistance) {
    let id=fromId, total=-distance;
    const visited=new Set();
    while(id && !visited.has(id)){
      if(id===targetId)return total+targetDistance;
      visited.add(id);const segment=track.segments[id];
      const next=segment.exits?.[0]?.[0];
      if(!next || segment.exits.some(exit=>exit[0]!==next))return null;
      const destination=track.segments[next];
      if(destination.stage!==segment.stage || destination.mode!==segment.mode)return null;
      total+=segment.length;id=next;
    }
    return null;
  }
  function rivalDistance(me, rival) {
    if(!rival || rival.mode!==me.mode)return null;
    const ahead=forwardDistance(me.segmentId,me.distance,rival.segmentId,rival.distance);
    if(ahead!==null)return ahead;
    const behind=forwardDistance(rival.segmentId,rival.distance,me.segmentId,me.distance);
    return behind===null?null:-behind;
  }
  function drawLaser(shot, me, segment) {
    const z=forwardDistance(me.segmentId,me.distance,shot.segmentId,shot.distance);
    if(z===null || z<0 || z>VIEW)return;
    const owner=state.players.find(p=>p.id===shot.playerId);
    const color=colors[owner?seatOf(owner):0];
    const lateral=shot.lane-(segment.laneCount-1)/2, altitude=me.mode==='flight'?shot.altitude:0;
    // Sprite-local barrel tips, shared with the muzzle flash below. Projecting
    // the offset with depth gives the bolt a natural angle toward the horizon.
    const [mx,my]=muzzleOffset(me.mode==='flight');
    const laserPoint=depth=>{
      const p=point(lateral,depth,altitude);
      p[0]+=mx*p[2];p[1]+=my*p[2];return p;
    };
    const head=laserPoint(z), tail=laserPoint(Math.max(0,z-.85));
    ctx.save();ctx.globalCompositeOperation='lighter';ctx.globalAlpha=Math.min(1,(VIEW-z)/5);
    glowLine([tail,head],color,Math.max(1,4*head[2]),8);
    glowLine([tail,head],'#f2feff',Math.max(.6,1.3*head[2]),3);
    ctx.restore();
  }
  function muzzleOffset(flight) { return flight ? [3,-135] : [21,-151]; }
  function smooth(value) { const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t); }
  function gateFor(segment) {
    if(segment.gate!==undefined)return segment.gate;
    // Rooms created before the gate art update still send the original map.
    // Recover presentation from that course's existing topology without changing
    // server data, lengths, collisions, or either player's position.
    if(track?.id!=='city-to-crystal-palace')return null;
    const destinationId=segment.exits?.[0]?.[0];
    const destination=track.segments[destinationId];
    if(destination && segment.exits.every(([id])=>id===destinationId)){
      if(segment.mode!=='flight' && destination.mode==='flight')
        return {style:'spaceport',kind:'launch',label:'ORBITAL LAUNCH',subtitle:'SHUTTLE BAY / READY'};
      if(destination.stage!==segment.stage)
        return {style:segment.stage,kind:'area',label:destination.stage==='downtown'?'DOWNTOWN':'SPACEPORT',subtitle:'SECTOR ACCESS'};
    }
    if(!segment.exits && segment.mode==='flight' && segment.progress?.[1]===track.finishProgress)
      return {style:'palace',kind:'dock',label:'CRYSTAL PALACE',subtitle:'ARRIVALS / DOCKING BAY'};
    return null;
  }
  function gateTheme(style) {
    return style==='slums'?{cell:0,body:'#3b3933',trim:'#aa7950',light:'#ffbc68',floor:'#353a35'}
      : style==='downtown'?{cell:1,body:'#dbe3e2',trim:'#8da6b1',light:'#a0f0f2',floor:'#8b9ca3'}
        : style==='palace'?{cell:3,body:'#e2dac4',trim:'#a48a4e',light:'#a5fff0',floor:'#4c5d64'}
          : {cell:2,body:'#d3dce1',trim:'#627d8e',light:'#d4faff',floor:'#3b5262'};
  }
  function gateOpening(segment, me) {
    const end=segment.progress?.[1]??Infinity;
    if(state.players.some(p=>p.progress>=end))return 1;
    const distances=state.players.filter(p=>p.segmentId===me.segmentId).map(p=>segment.length-p.distance);
    const nearest=Math.min(segment.length-me.distance,...distances);
    return smooth((24-nearest)/18);
  }
  function drawGate(segment, me) {
    const gate=gateFor(segment);if(!gate)return;
    const z=segment.length-me.distance;if(z>65)return;
    const theme=gateTheme(gate.style),dock=gate.kind==='dock';
    const width=segment.laneCount/2+.23,bottom=dock?-.3:0,top=dock?3.65:3.2;
    const outer=width+.7,height=top+.55;
    const shape=(w,lo,hi,cut)=>[
      point(-w,z,lo),point(w,z,lo),point(w,z,hi-cut),point(w-cut,z,hi),
      point(-w+cut,z,hi),point(-w,z,hi-cut)
    ];
    const frame=shape(outer,bottom-.12,height,.35),opening=shape(width,bottom,top,.2);
    const textured=architecture.complete && architecture.naturalWidth;
    const sw=textured?architecture.naturalWidth/4:0,sh=textured?architecture.naturalHeight/2:0;
    if(dock){
      // A broad station hull and a projecting landing apron make this a docking
      // hangar attached to the Palace, rather than a door floating in space.
      polygon([point(-outer-1.8,z+2,bottom-.5),point(outer+1.8,z+2,bottom-.5),point(outer+1.8,z+2,height-.2),point(outer+.8,z+2,height+.3),point(-outer-.8,z+2,height+.3),point(-outer-1.8,z+2,height-.2)],'#9faaa9');
      for(const side of [-1,1]){
        const a=point(side*outer,z+2,height),b=point(side*(outer+1.7),z+2,bottom-.4);
        const x=Math.min(a[0],b[0]),w=Math.abs(b[0]-a[0]),h=b[1]-a[1];
        if(textured)ctx.drawImage(architecture,0,0,sw,sh,x,a[1],w,h);
        ctx.fillStyle='#c6af6e38';ctx.fillRect(x,a[1],w,h);
        glowLine([point(side*(outer+.18),z+2,bottom-.4),point(side*(outer+.18),z+2,height)],'#dbc185',Math.max(1,7*a[2]),0);
      }
      polygon([point(-outer-1.8,z+2,bottom-.4),point(outer+1.8,z+2,bottom-.4),point(outer+.3,z-3,bottom-.4),point(-outer-.3,z-3,bottom-.4)],'#394d5c');
      for(const side of [-1,1])glowLine([point(side*(width+.2),z-3,bottom-.38),point(side*(width+.2),z+2,bottom-.38)],theme.light,3,5);
    }else{
      groundQuad(-outer-.2,outer+.2,z-1.2,z+1,'#030b1355');
      groundQuad(-outer-.1,outer+.1,z-.35,z+.3,theme.trim,.03);
    }
    // A solid framed airlock and a short, lit passage replace painted border lines.
    polygon(frame,theme.body);
    // Texture the jambs and lintel as machinery too, not just the moving leaves.
    if(textured){
      ctx.save();ctx.beginPath();frame.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.clip();
      for(const side of [-1,1]){
        const a=point(side*outer,z,height),b=point(side*width,z,bottom-.12);
        ctx.drawImage(architecture,theme.cell*sw,sh,sw*.18,sh,Math.min(a[0],b[0]),a[1],Math.abs(a[0]-b[0]),b[1]-a[1]);
      }
      const a=point(-outer,z,height),b=point(outer,z,top);
      ctx.drawImage(architecture,theme.cell*sw,sh,sw,sh*.13,a[0],a[1],b[0]-a[0],b[1]-a[1]);
      ctx.restore();
    }
    glowLine([...frame,frame[0]],theme.trim,Math.max(1,8*point(0,z)[2]),0);
    polygon(opening,'#040b15');
    const far=z+16;
    polygon([point(-width,z,bottom),point(width,z,bottom),point(width,far,bottom),point(-width,far,bottom)],theme.floor);
    for(const side of [-1,1]){
      polygon([point(side*width,z,bottom),point(side*width,far,bottom),point(side*width,far,top),point(side*width,z,top)],side===1?'#1b303c':'#29424b');
      if(textured){
        ctx.save();ctx.beginPath();opening.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.clip();
        facadeFace({x:side*width,z,length:16,height:top,cell:dock?2:0,side},'spaceport');
        polygon([point(side*width,z,bottom),point(side*width,far,bottom),point(side*width,far,top),point(side*width,z,top)],'#061421a6');
        ctx.restore();
      }
      glowLine([point(side*(width-.12),z,bottom+.06),point(side*(width-.12),far,bottom+.06)],theme.light,2,4);
      for(let depth=z+3;depth<far;depth+=4)
        glowLine([point(side*width,depth,bottom+.3),point(side*width,depth,top-.3)],theme.light,Math.max(1,2*point(0,depth)[2]),2);
    }
    polygon([point(-width,z,top),point(width,z,top),point(width,far,top),point(-width,far,top)],'#152735');
    // Sliding leaves are clipped to the opening while retracting into the jambs.
    const left=point(-width,z,top),right=point(width,z,bottom),s=left[2];
    const doorWidth=(right[0]-left[0])/2,doorHeight=right[1]-left[1],open=gateOpening(segment,me);
    ctx.save();ctx.beginPath();opening.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.clip();
    ctx.imageSmoothingEnabled=false;
    if(textured){
      ctx.drawImage(architecture,theme.cell*sw,sh,sw/2,sh,left[0]-doorWidth*open,left[1],doorWidth,doorHeight);
      ctx.drawImage(architecture,theme.cell*sw+sw/2,sh,sw/2,sh,left[0]+doorWidth+doorWidth*open,left[1],doorWidth,doorHeight);
    }else{
      ctx.fillStyle=theme.body;ctx.fillRect(left[0]-doorWidth*open,left[1],doorWidth,doorHeight);
      ctx.fillRect(left[0]+doorWidth+doorWidth*open,left[1],doorWidth,doorHeight);
    }
    ctx.restore();
    glowLine([...opening,opening[0]],theme.trim,Math.max(1,5*s),0);
    for(const side of [-1,1]){
      for(let h=bottom+.25;h<top;h+=.42){
        glowLine([point(side*(width+.18),z,h),point(side*(width+.18),z,h+.2)],open>.98?theme.light:'#efb76f',Math.max(1,6*s),3);
        const bolt=point(side*(outer-.16),z,h);ctx.fillStyle=theme.trim;ctx.fillRect(bolt[0]-2*s,bolt[1]-2*s,4*s,4*s);
      }
      polygon([point(side*(width+.3),z,bottom),point(side*(outer-.06),z,bottom),point(side*(outer-.06),z,bottom+.2),point(side*(width+.3),z,bottom+.2)],theme.trim);
    }
    const label=point(0,z,top+.28),small=point(0,z,top+.09);
    ctx.fillStyle='#122330';ctx.fillRect(label[0]-240*s,label[1]-22*s,480*s,37*s);
    textAt(gate.label,label[0],label[1]+5*s,Math.max(9,22*s),theme.light);
    if(z<35)textAt(open>.98?'CLEAR TO ENTER':gate.subtitle,small[0],small[1],Math.max(8,11*s),'#e3f3f6');
  }
  function transitionAlpha(segment, me) {
    // The server continues to advance both players normally. These reserved,
    // object-free portions of the existing road are only a local visual passage.
    const gate=gateFor(segment);
    if(gate && gate.kind!=='dock' && segment.exits){
      const left=segment.length-me.distance;
      if(left<1.6)return smooth((1.6-left)/1.3);
    }
    if(me.distance<3.6){
      const incoming=Object.values(track.segments).some(s=>{
        const entrance=gateFor(s);
        return entrance && entrance.kind!=='dock' && s.exits?.some(([id])=>id===me.segmentId);
      });
      if(incoming)return 1-smooth((me.distance-1.4)/2.2);
    }
    return 0;
  }
  function drawPlayer(player, z, segment, time, opacity = 1, cinematic = false) {
    const flight = player.mode === 'flight';
    const [x, y, scale] = point(player.lane - (segment.laneCount - 1) / 2, z, flight ? player.altitude : 0);
    const bob = !cinematic && animate && state.status !== 'ended' && player.finishTimeMs === null && player.connected && !player.stunRemainingMs ? Math.sin(time / (flight ? 220 : 75)) * (flight ? 3 : 4) : 0;
    ctx.save(); ctx.translate(x, y + bob); ctx.scale(scale, scale);
    ctx.globalAlpha = opacity * (!player.connected ? .45 : player.phaseRemainingMs ? .38 : player.recoveryRemainingMs ? .65 : 1);
    if (!flight) { ctx.fillStyle = '#02091588'; ctx.beginPath(); ctx.ellipse(0, -3, 33, 9, 0, 0, Math.PI * 2); ctx.fill(); }
    if(cinematic || segment.flightPhase==='atmosphere'){
      glowLine([[-25,-8],[-25,50]],colors[seatOf(player)],9,12);
      glowLine([[25,-8],[25,50]],colors[seatOf(player)],9,12);
    }
    const atlas = flight ? sprites : runners;
    if (atlas.complete && atlas.naturalWidth) {
      const sw = atlas.naturalWidth / 2, sh = atlas.naturalHeight / 2;
      const width = flight ? 160 : 145, height = flight ? 150 : 165;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(atlas, seatOf(player) === 0 ? 0 : sw, flight ? sh : 0, sw, sh, -width / 2, -height, width, height);
    }
    if (!cinematic && time-snapshotAt<55 && state.events?.some(event=>event.type==='shotFired' && event.playerId===player.id)) {
      const [mx,my]=muzzleOffset(flight);
      glowLine([[mx,my],[mx,my-4]],colors[seatOf(player)],3,9);
    }
    if (!cinematic && player.shield > 0) {
      ctx.strokeStyle = colors[seatOf(player)] + '88'; ctx.lineWidth = 2;
      const gauges = flight ? Math.ceil(player.shield / 100 * 3) : player.shield;
      for (let i = 0; i < gauges; i++) { ctx.beginPath(); ctx.ellipse(0, -75, flight ? 80 : 60, flight ? 70 : 90, 0, .2 + i * 2.1, 1.9 + i * 2.1); ctx.stroke(); }
    }
    if(!cinematic)textAt(player.id === playerId ? 'YOU' : 'RIVAL', 0, -177, 14, colors[seatOf(player)]);
    if (player.stunRemainingMs) textAt(flight ? 'REBOOT' : 'STUNNED', 0, -195, 12, '#ffc573');
    ctx.restore();
  }
  function render(time) {
    // At most one 50 ms server tick of visual extrapolation. Road, buildings,
    // hazards and the rival share this camera; the authoritative state is never changed.
    const players=state?.players.map((player,seat)=>{
      const segment=track?.segments[player.segmentId];
      const moving=animate && state.status==='running' && player.connected && !player.stunRemainingMs && player.finishTimeMs===null;
      const advance=moving?(visualSpeeds.get(player.id)||0)*Math.min(50,Math.max(0,time-snapshotAt)):0;
      return advance && segment ? {...player,seat:player.seat??seat,distance:Math.min(segment.length,player.distance+advance)}:player;
    });
    const local = players?.find(player => player.id === playerId);
    if (!local || !track?.segments[local.segmentId]) {
      docking=null;
      ctx.fillStyle = '#0b1523'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      return;
    }
    const rival = players.find(player => player.id !== playerId);
    const segment = track.segments[local.segmentId],flight=local.mode==='flight';
    const ascent=segment.flightPhase==='atmosphere';
    levelSpread=ascent?smooth((local.distance-(segment.length-segment.transitionLength))/segment.transitionLength):1;
    renderClock=state.elapsedMs+(animate && state.status==='running'?Math.min(50,Math.max(0,time-snapshotAt)):0);
    const dockApproach=flight && gateFor(segment)?.kind==='dock' && local.distance>segment.length-DOCK_APPROACH;
    // Stop the chase camera just outside the final hangar. The shuttle continues
    // forward into the bay, then accelerates away after its server-recorded finish.
    const me=dockApproach?{...local,seat:seatOf(local),distance:segment.length-DOCK_APPROACH}:local;
    if(dockApproach && local.finishTimeMs!==null){
      if(!docking || docking.playerId!==local.id || docking.finishTimeMs!==local.finishTimeMs)
        docking={playerId:local.id,finishTimeMs:local.finishTimeMs,startedAt:time-Math.min(DOCK_DURATION,Math.max(0,state.elapsedMs-local.finishTimeMs))};
    }else docking=null;
    ctx.globalAlpha=1;
    ctx.fillStyle = '#0b1523'; ctx.fillRect(0, 0, 1100, 650);
    const backdrop = art[segment.stage];
    if (backdrop?.complete && backdrop.naturalWidth) {
      if (flight) ctx.drawImage(backdrop, backdrop.naturalWidth * .19, backdrop.naturalHeight * .05,
        backdrop.naturalWidth * .62, backdrop.naturalHeight * .73, 0, 0, 1100, 650);
      // Original paintings remain the distant skyline only. All nearby ground
      // and architecture below this horizon now belong to the moving world.
      else ctx.drawImage(backdrop,backdrop.naturalWidth*.25,backdrop.naturalHeight*.04,backdrop.naturalWidth*.5,backdrop.naturalHeight*.4,0,0,1100,230);
    }
    const fade = ctx.createLinearGradient(0, 100, 0, 650); fade.addColorStop(0, '#08101c10'); fade.addColorStop(1, flight ? '#050c1d44' : '#08101cb8');
    ctx.fillStyle = fade; ctx.fillRect(0, 0, 1100, 650);
    if(ascent || (segment.arrivalBlend && me.distance<segment.arrivalBlend))atmosphere(segment,me);
    if(!flight && segment.stage==='spaceport')hangarCeiling(segment,me);
    const blocks=flight?[]:streetBlocks(segment,me);
    if(!flight)streetGround(segment,me);
    if(!docking)road(segment, me);
    if(!flight){
      streetShadows(segment,blocks);
      streetscape(segment,me,blocks);
    }
    drawGate(segment,me);
    if (flight && !dockApproach) { for (let level = 0; level < 3; level++) {
      if(level!==1 && levelSpread<.15)continue;
      ctx.save();if(level!==1)ctx.globalAlpha*=levelSpread;
      const [x,y]=point(-2.4,0,level), info=flightLevels[level];
      textAt(ascent && level===1?'ASCENT':info.name,x,y-25,14,info.color);
      if(me.altitude===level)textAt(ascent?'4 LANES':'YOUR LEVEL',x,y-6,10,'#fff2d8');
      ctx.restore();
    } }
    const removed = new Set(state.removedObjectIds);
    const visible = [];
    const addObjects=(section,offset)=>{
      for(const object of section.objects){
        const z=offset+object.distance-me.distance;
        if(z<0 || z>=VIEW || removed.has(object.id))continue;
        const pose=object.motion?window.RaceMotion.trafficPose(object,renderClock,section.laneCount):null;
        visible.push({object:pose?{...object,...pose}:object,z,segment:section});
      }
    };
    addObjects(segment,0);
    // Show the original orbital encounters ahead through the unfolding grid.
    // This gives lane-dodge warning before altitude controls unlock at entry.
    if(flight && segment.exits){
      const next=track.segments[segment.exits[0][0]];
      if(next?.mode==='flight' && next.stage===segment.stage)addObjects(next,segment.length);
    }
    const rivalZ=rivalDistance(local,rival);
    const rivalInRange=rivalZ!==null && Math.abs(rivalZ)<RIVAL_VIEW;
    const rivalOpacity=rivalInRange?Math.min(1,(RIVAL_VIEW-Math.abs(rivalZ))/3):0;
    if(rivalInRange && rivalZ>-2 && rival.finishTimeMs===null)visible.push({player:rival,z:rivalDistance(me,rival),opacity:rivalOpacity});
    if(!docking)visible.push({ player: local, z: local.distance-me.distance });
    visible.sort((a, b) => b.z - a.z);
    // Ground contact belongs under every entity, not on top of a neighbouring
    // sprite when dense rows overlap in the chase camera.
    if(!flight)for(const item of visible)
      if(item.object && item.object.type!=='coin')groundContact(item.object,item.z,segment);
    for (const item of visible) item.player ? drawPlayer(item.player, item.z, segment, time, item.opacity) : drawObject(item.object, item.z, item.segment, time, me);
    for (const shot of state.projectiles || []) drawLaser(shot, me, segment);
    if(docking){
      const t=Math.max(0,(time-docking.startedAt)/1600);
      if(t<1){
        const q=smooth(t),shuttle={...local,seat:seatOf(local),lane:local.lane+(1.5-local.lane)*q,altitude:local.altitude+(1-local.altitude)*q};
        drawPlayer(shuttle,DOCK_APPROACH+160*t*t,segment,time,1-smooth((t-.75)/.25),true);
      }else{
        textAt('DOCKING COMPLETE',550,575,23,'#a9f9ed');
        textAt(state.status==='ended'?'Race complete':'Waiting for the other runner',550,603,13,'#dbe9ec');
      }
    }
    // A nearby trailing rival is outside the chase camera. Give the leader a
    // rear marker, with the same absolute-distance fade/cutoff as the follower.
    if(local.finishTimeMs===null && rivalInRange && rivalZ<=-2){
      const [x]=point(rival.lane-(segment.laneCount-1)/2,0);
      ctx.save();ctx.globalAlpha=rivalOpacity;
      ctx.fillStyle='#081323e8';ctx.fillRect(x-108,600,216,32);
      textAt(`RIVAL BEHIND · ${Math.ceil(-rivalZ)} CELLS`,x,621,12,colors[seatOf(rival)]);
      ctx.restore();
    }
    if(ascent || (segment.arrivalBlend && local.distance<18))flightBriefing(segment,local);
    const blackout=transitionAlpha(segment,local);
    if(blackout>0){ctx.save();ctx.globalAlpha=blackout;ctx.fillStyle='#000000';ctx.fillRect(0,0,1100,650);ctx.restore();}
  }
  return {
    isDocking(time=lastTime) { return Boolean(docking && time-docking.startedAt<DOCK_DURATION); },
    draw(course, snapshot, localPlayerId, time = performance.now(), moving = true) {
      if(snapshot!==state){
        visualSpeeds.clear();
        const dt=snapshot?.elapsedMs-state?.elapsedMs;
        if(course===track && dt>0 && dt<=150)for(const player of snapshot.players){
          const previous=state.players.find(p=>p.id===player.id);
          if(!previous || previous.stage!==player.stage || previous.mode!==player.mode)continue;
          const delta=player.segmentId===previous.segmentId?player.distance-previous.distance
            : (track.segments[previous.segmentId]?.length||0)-previous.distance+player.distance;
          if(delta>=0 && delta/dt<=.025)visualSpeeds.set(player.id,delta/dt);
        }
        snapshotAt=time;
      }
      track=course;state=snapshot;playerId=localPlayerId;lastTime=time;animate=moving;
      for(const [stage,info] of Object.entries(track?.stages||{})){
        if(art[stage]?.getAttribute('src')===info.art)continue;
        const backdrop=new Image();art[stage]=backdrop;backdrop.addEventListener('load',redraw);backdrop.src=info.art;
      }
      render(time);
    }
  };
};
