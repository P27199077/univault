import * as T from './vendor/study-engine.js';
import {COURSE_BROWNS,courseCategory} from './academics.js';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const animate = T.gsap;

// An original, procedural room. No remote models, tracking, or scene downloads.
export class StudyRoom {
  constructor(host, stage, {onShelf,onNavigate}={}) {
    this.host=host;this.stage=stage;this.mode='room';this.bookMeshes=[];this.materials=new Map();this.disposed=false;this.paperTextures=[];this.paperMaterials=[];
    this.scene=new T.Scene();this.scene.background=new T.Color('#e7d8bf');
    this.camera=new T.PerspectiveCamera(39,1,.1,80);
    this.renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.6));
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.22;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute('aria-hidden','true');host.append(this.renderer.domElement);
    this.look=new T.Vector3(0,2,-.5);
    this.scene.add(new T.HemisphereLight(0xfff1d9,0x897653,2.5));
    const sun=new T.DirectionalLight(0xffe1ad,4);sun.position.set(-4,8,6);sun.castShadow=true;
    sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-9;sun.shadow.camera.right=9;sun.shadow.camera.top=8;sun.shadow.camera.bottom=-7;sun.shadow.normalBias=.035;this.scene.add(sun);
    this.buildRoom();this.buildCabinet();
    this.ray=new T.Raycaster();this.pointer=new T.Vector2();
    this.targets=[this.cabinet,this.calendar,this.taskPad,this.journal];
    ['shelf','calendar','todo','cgpa'].forEach((action,i)=>this.targets[i].userData.roomAction=action);
    const objectHit=event=>{
      if(this.mode!=='room')return null;
      const rect=this.renderer.domElement.getBoundingClientRect();
      this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      this.ray.setFromCamera(this.pointer,this.camera);
      let object=this.ray.intersectObjects(this.targets,true)[0]?.object;
      while(object&&!object.userData.roomAction)object=object.parent;
      return object?.userData.roomAction || null;
    };
    this.pickShelf=event=>{const action=objectHit(event);if(action==='shelf')onShelf?.();else if(action)onNavigate?.(action);};
    this.hoverShelf=event=>{this.renderer.domElement.style.cursor=objectHit(event)?'pointer':'default';};
    this.renderer.domElement.addEventListener('pointerup',this.pickShelf);
    this.renderer.domElement.addEventListener('pointermove',this.hoverShelf);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(host);
    this.contextLost=event=>{event.preventDefault();stage.classList.add('room-unavailable');};
    this.renderer.domElement.addEventListener('webglcontextlost',this.contextLost);
    this.contextRestored=()=>{stage.classList.remove('room-unavailable');this.render();};
    this.renderer.domElement.addEventListener('webglcontextrestored',this.contextRestored);
    this.resize();
  }
  material(color,options={}) {
    const key=color+JSON.stringify(options);
    if(!this.materials.has(key))this.materials.set(key,new T.MeshStandardMaterial({color,roughness:.88,...options}));
    return this.materials.get(key);
  }
  mesh(geometry,color,x,y,z,parent=this.scene,options={}) {
    const mesh=new T.Mesh(geometry,this.material(color,options));mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  box(w,h,d,color,x,y,z,parent=this.scene) {return this.mesh(new T.BoxGeometry(w,h,d),color,x,y,z,parent);}
  cylinder(top,bottom,h,color,x,y,z,parent=this.scene) {return this.mesh(new T.CylinderGeometry(top,bottom,h,24),color,x,y,z,parent);}
  sphere(r,color,x,y,z,parent=this.scene) {return this.mesh(new T.SphereGeometry(r,24,16),color,x,y,z,parent);}
  buildRoom() {
    const wood='#90613e',dark='#5b3928';
    this.box(12,.2,8,'#bc9467',0,-.12,0);
    for(let i=0;i<25;i++)this.box(.46,.018,8,i%3===0?'#ad7f54':i%3===1?'#bc9265':'#c69e72',-5.76+i*.48,0,0);
    this.box(12,5.8,.18,'#eadcc5',0,2.85,-3.8);
    this.box(.18,5.8,8,'#e4d2b4',-6,2.85,0);
    this.box(12,.18,.12,'#9d7855',0,.16,-3.63);
    // Arched, sunlit window with a thick walnut frame.
    const arch=(w,h)=>{const s=new T.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(w/2,h-w/2);s.absarc(0,h-w/2,w/2,0,Math.PI,false);s.lineTo(-w/2,0);return s;};
    this.mesh(new T.ExtrudeGeometry(arch(2.9,4.0),{depth:.1,bevelEnabled:false}),dark,-3.65,.8,-3.66);
    this.mesh(new T.ShapeGeometry(arch(2.63,3.73)),'#d1d4a3',-3.65,.92,-3.53);
    const trees=[[-4.55,2.9,.43],[-3.9,3.65,.55],[-3.0,3.1,.62],[-4.4,4.1,.52],[-3.1,4.3,.4]];
    for(const [x,y,r] of trees){const leaf=this.sphere(r,'#8c9b69',x,y,-3.48);leaf.scale.z=.09;}
    this.box(.065,3.8,.07,wood,-3.65,2.75,-3.35);
    this.box(2.7,.065,.07,wood,-3.65,2.4,-3.32);this.box(2.7,.065,.07,wood,-3.65,3.45,-3.32);
    this.box(3.15,.16,.43,'#c6a47a',-3.65,.87,-3.4);
    // Woven geometric rug.
    this.box(4.7,.025,3.1,'#a65d3c',-1.65,.035,.75);
    for(let i=0;i<9;i++)this.box(.12,.006,2.9,'#c58e60',-3.7+i*.51,.052,.75);
    this.box(4.6,.007,.14,'#d4ad77',-1.65,.057,-.65);this.box(4.6,.007,.14,'#d4ad77',-1.65,.057,2.14);
    // Desk and tapered legs.
    this.box(3.8,.19,1.55,wood,-1.9,1.65,-.65);
    for(const x of [-3.48,-.33])for(const z of [-1.2,-.08]){const leg=this.cylinder(.08,.045,1.5,dark,x,.82,z);leg.rotation.z=x<-2?.035:-.035;}
    for(const y of [1.36,1.08]){this.box(.94,.23,1.2,'#9b6b44',-3.15,y,-.66);this.box(.3,.035,.055,'#c19a5d',-3.15,y,-.02);}
    // Olive mid-century chair.
    this.box(1.23,.2,1.04,'#77794c',-1.65,.92,.98);
    const back=this.box(1.28,1.07,.18,'#858658',-1.65,1.55,1.48);back.rotation.x=-.13;
    for(const x of [-2.12,-1.18])for(const z of [.6,1.36]){const leg=this.cylinder(.055,.035,.86,dark,x,.46,z);leg.rotation.z=x<-1.6?.1:-.1;}
    // Lamp, ceramic mug and open notebook.
    this.cylinder(.27,.28,.06,'#b48c43',-.65,1.79,-.87);this.cylinder(.035,.035,.77,'#bc9546',-.65,2.18,-.87);
    this.mesh(new T.SphereGeometry(.43,32,16,0,Math.PI*2,0,Math.PI/2),'#d1a143',-.65,2.57,-.87);
    const lamp=new T.PointLight(0xffcd76,4,4,2);lamp.position.set(-.65,2.35,-.87);this.scene.add(lamp);
    this.cylinder(.13,.115,.25,'#e5d4b5',-2.75,1.89,-.43);
    const handle=this.mesh(new T.TorusGeometry(.09,.024,10,20),'#e5d4b5',-2.58,1.9,-.43);handle.rotation.y=.5;
    // A task notepad at the front edge, and a separate closed grades journal on the desktop.
    this.taskPad=new T.Group();this.taskPad.position.set(-1.48,1.79,-.22);this.scene.add(this.taskPad);
    this.box(1.05,.045,.76,'#775034',0,0,0,this.taskPad);
    const pad=this.paperPlane(.98,.7,this.drawNotepad(),0,.027,0,this.taskPad);pad.rotation.x=-Math.PI/2;
    for(let i=0;i<6;i++){const ring=this.mesh(new T.TorusGeometry(.029,.009,8,12),'#8b7653',-.43,.044,-.28+i*.11,this.taskPad);ring.rotation.y=Math.PI/2;}
    this.journal=new T.Group();this.journal.position.set(-2.87,1.84,-1.0);this.journal.rotation.y=-.12;this.scene.add(this.journal);
    this.box(1.03,.15,.7,'#65412e',0,0,0,this.journal);
    this.box(.94,.07,.64,'#e2cfab',.015,0,0,this.journal);
    this.box(1.03,.025,.7,'#65412e',0,.07,0,this.journal);
    this.box(.07,.17,.71,'#4c3023',-.48,0,0,this.journal);
    const cover=this.paperPlane(.94,.63,this.drawJournal(),.025,.085,0,this.journal);cover.rotation.x=-Math.PI/2;
    // Framed abstract print.
    this.box(1.55,1.95,.09,dark,-.7,3.75,-3.64);this.box(1.39,1.79,.02,'#ddc49c',-.7,3.75,-3.57);
    const artSun=this.cylinder(.32,.32,.02,'#ba8d3a',-.4,4.17,-3.54);artSun.rotation.x=Math.PI/2;
    this.box(.57,.84,.025,'#9f5435',-.99,3.48,-3.53);this.box(.58,.46,.027,'#79804d',-.4,3.3,-3.52);
    this.plant(-4.65,.05,-1.4,1.0);this.plant(4.95,4.72,-3.15,.55);
    // A recognizable calendar on the large left wall, with the current month's dates.
    this.calendar=new T.Group();this.calendar.position.set(-5.86,3.45,-2.6);this.calendar.rotation.y=Math.PI/2;this.scene.add(this.calendar);
    this.box(1.85,2.23,.09,wood,0,0,0,this.calendar);
    this.paperPlane(1.68,2.06,this.drawCalendar(),0,0,.055,this.calendar);
    for(const x of [-.58,.58])this.sphere(.045,'#60452b',x,1.04,.085,this.calendar);
    this.labelAnchors=[
      {selector:'.room-object-shelf',point:new T.Vector3(3,3.6,-2.55),dx:0,dy:0},
      {selector:'.room-object-planner',point:new T.Vector3(-5.72,2.14,-2.6),dx:0,dy:10},
      {selector:'.room-object-notepad',point:new T.Vector3(-1.48,1.8,.3),dx:-55,dy:8},
      {selector:'.room-object-journal',point:new T.Vector3(-2.87,2.0,-1.0),dx:55,dy:-46}
    ];
  }
  paperPlane(w,h,canvas,x,y,z,parent) {
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;this.paperTextures.push(texture);
    const material=new T.MeshBasicMaterial({map:texture,toneMapped:false});this.paperMaterials.push(material);
    const plane=new T.Mesh(new T.PlaneGeometry(w,h),material);plane.position.set(x,y,z);parent.add(plane);return plane;
  }
  drawCalendar() {
    const canvas=document.createElement('canvas');canvas.width=630;canvas.height=780;const c=canvas.getContext('2d');
    c.fillStyle='#fbefd8';c.fillRect(0,0,630,780);c.fillStyle='#a36440';c.fillRect(0,0,630,145);
    const now=new Date(),year=now.getFullYear(),month=now.getMonth();
    c.textAlign='center';c.fillStyle='#fff1d4';c.font='bold 52px Georgia';c.fillText(now.toLocaleDateString('en',{month:'long'}),315,77);
    c.font='24px sans-serif';c.fillText(String(year),315,116);
    const days=['M','T','W','T','F','S','S'],left=35,cell=80,top=250;
    c.fillStyle='#8b6a46';c.font='bold 23px sans-serif';days.forEach((d,i)=>c.fillText(d,left+cell*(i+.5),208));
    c.strokeStyle='#d8c19a';c.lineWidth=2;
    for(let r=0;r<7;r++){c.beginPath();c.moveTo(left,top-25+r*77);c.lineTo(left+560,top-25+r*77);c.stroke();}
    const first=(new Date(year,month,1).getDay()+6)%7,count=new Date(year,month+1,0).getDate();
    for(let d=1;d<=count;d++){
      const slot=first+d-1,x=left+cell*(slot%7+.5),y=top+Math.floor(slot/7)*77+24;
      if(d===now.getDate()){c.fillStyle='#9b6740';c.beginPath();c.arc(x,y-10,27,0,Math.PI*2);c.fill();}
      c.fillStyle=d===now.getDate()?'#fff4dd':'#725334';c.font='29px Georgia';c.fillText(String(d),x,y);
    }
    c.fillStyle='#ab895d';c.font='18px sans-serif';c.fillText('ONE DAY AT A TIME',315,755);return canvas;
  }
  drawNotepad() {
    const canvas=document.createElement('canvas');canvas.width=600;canvas.height=440;const c=canvas.getContext('2d');
    c.fillStyle='#fff2d6';c.fillRect(0,0,600,440);c.fillStyle='#987245';c.font='bold 35px Georgia';c.fillText('TODAY',88,66);
    c.strokeStyle='#baa079';c.lineWidth=3;
    for(let i=0;i<4;i++){const y=115+i*76;c.strokeRect(75,y,23,23);c.beginPath();c.moveTo(127,y+17);c.lineTo(520-i%2*55,y+17);c.stroke();}
    c.strokeStyle='#d8c7a6';c.beginPath();c.moveTo(50,0);c.lineTo(50,440);c.stroke();return canvas;
  }
  drawJournal() {
    const canvas=document.createElement('canvas');canvas.width=600;canvas.height=440;const c=canvas.getContext('2d');
    c.fillStyle='#65412e';c.fillRect(0,0,600,440);c.strokeStyle='#c5a171';c.lineWidth=2;c.strokeRect(33,30,534,380);
    c.textAlign='center';c.fillStyle='#dfc08c';c.font='32px Georgia';c.fillText('GRADES',300,180);c.fillText('JOURNAL',300,228);
    c.font='17px sans-serif';c.fillText('THE UNIVAULT STUDY',300,320);return canvas;
  }
  placeLabels() {
    if(this.mode!=='room')return;
    const width=this.host.clientWidth,height=this.host.clientHeight,placed=[];
    for(const anchor of this.labelAnchors || []) {
      const button=this.stage.querySelector(anchor.selector);if(!button)continue;
      button.classList.add('room-object-anchored');if(!button.offsetWidth)continue;
      const point=anchor.point.clone().project(this.camera),w=button.offsetWidth,h=button.offsetHeight;
      const x=Math.max(w/2+12,Math.min(width-w/2-12,(point.x+1)*width/2+anchor.dx));
      let y=Math.max(123,Math.min(height-80-h,(1-point.y)*height/2+anchor.dy));
      for(const previous of placed) {
        const overlaps=x-w/2<previous.right+8 && x+w/2>previous.left-8 && y<previous.bottom+8 && y+h>previous.top-8;
        if(overlaps)y=anchor.dy<0 ? previous.top-h-8 : previous.bottom+8;
      }
      y=Math.max(123,Math.min(height-80-h,y));
      button.style.left=`${x}px`;button.style.top=`${y}px`;button.style.right='auto';
      placed.push({left:x-w/2,right:x+w/2,top:y,bottom:y+h});
    }
  }

  plant(x,y,z,scale) {
    const g=new T.Group();g.position.set(x,y,z);g.scale.setScalar(scale);this.scene.add(g);
    this.cylinder(.27,.18,.45,'#a66b46',0,.24,0,g);
    for(let i=0;i<9;i++){const a=i*2.4;const leaf=this.sphere(.26,i%2?'#7e8b4c':'#66783f',Math.cos(a)*.27,.67+(i%3)*.17,Math.sin(a)*.23,g);leaf.scale.set(.46,1.3,.26);leaf.rotation.z=Math.sin(a)*.8;}
  }
  buildCabinet() {
    const w='#795033',edge='#a1744a';
    this.cabinet=new T.Group();this.scene.add(this.cabinet);this.cabinet.position.set(3,0,-3.12);
    this.box(5.0,4.7,.13,'#64422c',0,2.53,-.25,this.cabinet);
    for(const x of [-2.5,2.5])this.box(.15,4.75,.8,w,x,2.54,0,this.cabinet);
    this.box(5.25,.16,.85,edge,0,4.94,0,this.cabinet);
    for(let row=0;row<5;row++)this.box(5.1,.13,.85,edge,0,.63+row*1.04,.02,this.cabinet);
    this.box(5.0,.38,.71,w,0,.34,0,this.cabinet);
    for(const x of [-2.2,2.2])this.cylinder(.075,.05,.24,'#543721',x,.11,.06,this.cabinet);
    this.volumes=new T.Group();this.cabinet.add(this.volumes);
  }
  update(semesters,courses) {
    this.volumes.traverse(obj=>{if(obj.isMesh){obj.geometry.dispose();if(obj.userData.ownedMaterial){obj.material.map?.dispose();obj.material.dispose();}}});
    this.volumes.clear();this.bookMeshes=[];
    // The full-room bookcase previews the first four real semesters. The close-up contains all levels.
    semesters.slice(0,4).forEach((sem,row)=>{
      const books=courses.filter(c=>c.semesterId===sem.id);const width=Math.min(.3,4.65/Math.max(books.length,1));
      books.forEach((course,i)=>{
        const h=.72+(i%3)*.035;const color=COURSE_BROWNS[courseCategory(course)];
        const book=this.box(width-.025,h,.57,color,-2.28+i*width+width/2,.71+(3-row)*1.04+h/2,.055,this.volumes);
        book.userData.courseId=course.id;this.bookMeshes.push(book);
        this.box(width-.04,.018,.54,'#e0cba5',book.position.x,book.position.y+h/2-.025,.06,this.volumes);
        for(const dy of [-h*.35,h*.35])this.box(width-.04,.018,.015,'#c8a46b',book.position.x,book.position.y+dy,.35,this.volumes);
      });
    });this.render();
  }
  resize() {
    if(this.disposed)return;const {width,height}=this.host.getBoundingClientRect();if(width<2||height<2)return;
    this.renderer.setSize(width,height,false);this.camera.aspect=width/height;this.camera.updateProjectionMatrix();this.pose(this.mode,false);
  }
  pose(mode,animated=true) {
    if(this.disposed)return;this.mode=mode;this.tween?.kill();
    const mobile=this.camera.aspect<.85;
    const pos=mode==='shelf' ? {x:3,y:2.7,z:mobile?9.6:5.3} : {x:mobile?10.2:9.1,y:mobile?8.5:6.6,z:mobile?17.8:12.7};
    const target=mode==='shelf'?{x:3,y:2.6,z:-3.0}:{x:0,y:2.0,z:-.55};
    if(mode==='room' && !mobile){const frame=Math.max(1,1.45/this.camera.aspect);for(const key of ['x','y','z'])pos[key]=target[key]+(pos[key]-target[key])*frame;}
    if(!animated||reduced()){this.camera.position.set(pos.x,pos.y,pos.z);this.look.set(target.x,target.y,target.z);this.render();return;}
    this.tween=T.gsap.timeline({onUpdate:()=>this.render()});
    this.tween.to(this.camera.position,{...pos,duration:1.05,ease:'power2.inOut'},0).to(this.look,{...target,duration:1.05,ease:'power2.inOut'},0);
  }
  render() {if(this.disposed||this.host.clientWidth<2)return;this.camera.lookAt(this.look);this.renderer.render(this.scene,this.camera);this.placeLabels();}
  dispose() {
    this.disposed=true;this.tween?.kill();this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerup',this.pickShelf);this.renderer.domElement.removeEventListener('pointermove',this.hoverShelf);
    this.scene.traverse(o=>{o.geometry?.dispose();});for(const texture of this.paperTextures)texture.dispose();for(const material of this.paperMaterials)material.dispose();for(const m of this.materials.values())m.dispose();this.renderer.dispose();this.renderer.domElement.remove();
  }
}
