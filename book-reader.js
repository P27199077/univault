import {animate} from './room.js';
import {courseCategory,COURSE_BROWNS} from './academics.js';
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const labels={slides:'Slides & presentations',notes:'Lecture notes',papers:'Papers & solutions',handouts:'Handouts & syllabus',notebook:'Your notepad',tasks:'Checklist & tasks'};

export class BookReader {
  constructor({getBlob,download,onEdit}) {
    this.getBlob=getBlob;this.download=download;this.onEdit=onEdit;this.generation=0;this.transition=0;this.url=null;this.section='slides';
    this.book=document.getElementById('course-book');
    this.leaf=document.createElement('div');this.leaf.className='book-page-turn-leaf';this.leaf.hidden=true;this.leaf.setAttribute('aria-hidden','true');this.book.querySelector('.book-right-page').append(this.leaf);
    this.tabs=[...document.querySelectorAll('[data-book-section]')];
    this.tabs.forEach((tab,i)=>{
      tab.addEventListener('click',()=>this.select(tab.dataset.bookSection));
      tab.addEventListener('keydown',event=>{
        let index=i;if(event.key==='ArrowDown'||event.key==='ArrowRight')index=(i+1)%this.tabs.length;
        else if(event.key==='ArrowUp'||event.key==='ArrowLeft')index=(i+this.tabs.length-1)%this.tabs.length;
        else if(event.key==='Home')index=0;else if(event.key==='End')index=this.tabs.length-1;else return;
        event.preventDefault();this.tabs[index].focus();this.select(this.tabs[index].dataset.bookSection);
      });
    });
    document.getElementById('book-preview-back').addEventListener('click',()=>this.select(this.section));
    document.getElementById('book-download-file').addEventListener('click',()=>{if(this.file)this.download(this.file);});
    document.getElementById('btn-book-edit').addEventListener('click',()=>{if(this.course)this.onEdit(this.course.id);});
  }
  open(course) {
    this.transition++;
    this.course=course;this.clearPreview();this.select('slides',false);
    this.book.style.setProperty('--book-cover-color',COURSE_BROWNS[courseCategory(course)]);
    document.getElementById('book-edition').textContent=`${courseCategory(course)} · ${course.isPlaceholder?'RESERVED VOLUME':'COURSE BOOK'}`;
    document.getElementById('book-cover-code').textContent=course.code || '';
    document.getElementById('book-cover-title').textContent=course.name;
    this.book.classList.add('is-opening');
    animate.killTweensOf(this.book);animate.killTweensOf(this.book.querySelector('.book-opening-cover'));
    if(reduced()){this.book.classList.remove('is-opening');return;}
    animate.fromTo(this.book,{opacity:.3},{opacity:1,duration:.65,ease:'power2.out',clearProps:'transform,opacity'});
    animate.fromTo(this.book.querySelector('.book-opening-cover'),{rotationY:0},{rotationY:-180,duration:.85,ease:'power2.inOut',onComplete:()=>this.book.classList.remove('is-opening')});
  }
  async flyFrom(spine,course) {
    if(reduced()||!spine)return;
    const rect=spine.getBoundingClientRect();const page=document.getElementById('main-content').getBoundingClientRect();
    const cover=document.createElement('div');cover.className='travelling-book';cover.setAttribute('aria-hidden','true');cover.style.backgroundColor=COURSE_BROWNS[courseCategory(course)];
    const code=document.createElement('small');code.textContent=course.code || courseCategory(course);const title=document.createElement('strong');title.textContent=course.name;cover.append(code,title);
    Object.assign(cover.style,{left:`${rect.left+rect.width/2-100}px`,top:`${rect.top}px`});document.body.append(cover);
    await new Promise(resolve=>animate.fromTo(cover,{rotationY:-77,transformPerspective:900},{x:page.left+page.width/2-(rect.left+rect.width/2),y:Math.max(90,innerHeight/2-145)-rect.top,rotationY:-12,scale:1.1,duration:.62,ease:'power2.inOut',onComplete:resolve}));
    cover.remove();
  }
  select(section,animated=true) {
    if(!labels[section])return;this.section=section;this.clearPreview();
    this.tabs.forEach((tab,i)=>{const active=tab.dataset.bookSection===section;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;if(active)document.getElementById('book-page-index').textContent=String(i+1).padStart(2,'0');});
    document.querySelectorAll('.book-content-panel').forEach(panel=>panel.hidden=panel.id!==`book-section-${section}`);
    document.getElementById('book-running-title').textContent=labels[section];
    if(animated&&!reduced()){
      animate.killTweensOf(this.leaf);this.leaf.hidden=false;
      animate.fromTo(this.leaf,{rotationY:0,opacity:.8},{rotationY:-165,opacity:0,duration:.35,ease:'power2.inOut',onComplete:()=>{this.leaf.hidden=true;}});
      animate.fromTo(document.getElementById('book-section-content'),{opacity:.35},{opacity:1,duration:.22,ease:'power1.out',clearProps:'opacity'});
    }
  }
  clearPreview() {
    this.generation++;this.file=null;
    if(this.url){URL.revokeObjectURL(this.url);this.url=null;}
    document.getElementById('book-preview-body').replaceChildren();
    document.getElementById('book-file-preview').hidden=true;document.getElementById('book-section-content').hidden=false;
  }
  async preview(file) {
    this.clearPreview();this.file=file;const generation=this.generation;
    document.getElementById('book-section-content').hidden=true;document.getElementById('book-file-preview').hidden=false;
    document.getElementById('book-preview-title').textContent=file.name;
    const body=document.getElementById('book-preview-body');body.textContent='Opening your document…';body.setAttribute('aria-busy','true');
    try {
      const blob=await this.getBlob(file);if(generation!==this.generation)return;
      body.replaceChildren();const mime=file.mimeType || blob.type || '';const ext=file.name.toLowerCase().split('.').at(-1);
      if(mime.startsWith('text/')||['txt','md','js','css','html','json','csv'].includes(ext)){
        const text=await blob.text();if(generation!==this.generation)return;const pre=document.createElement('pre');pre.textContent=text;body.append(pre);
      } else if(mime==='application/pdf'||ext==='pdf') {
        this.url=URL.createObjectURL(blob);const frame=document.createElement('iframe');frame.title=`${file.name} document preview`;frame.src=this.url;body.append(frame);
      } else if(mime.startsWith('image/')) {
        this.url=URL.createObjectURL(blob);const image=document.createElement('img');image.alt=file.name;image.src=this.url;body.append(image);
      } else if(mime.startsWith('audio/')||mime.startsWith('video/')) {
        this.url=URL.createObjectURL(blob);const media=document.createElement(mime.startsWith('audio/')?'audio':'video');media.controls=true;media.src=this.url;body.append(media);
      } else {body.textContent='This file is kept in your book. Download it to open it in its app.';}
    } catch(error){if(generation===this.generation)body.textContent='The document could not be opened. Reconnect and try again.';}
    finally {if(generation===this.generation)body.removeAttribute('aria-busy');}
  }
  async closeAnimated() {
    const transition=++this.transition;
    if(!reduced()) {
      this.book.classList.add('is-closing');
      await new Promise(resolve=>animate.fromTo(this.book.querySelector('.book-opening-cover'),{rotationY:-180},{rotationY:0,duration:.42,ease:'power2.inOut',onComplete:resolve,onInterrupt:resolve}));
      if(transition!==this.transition)return;
      this.book.classList.remove('is-closing');
    }
    this.close();
  }
  close() {this.transition++;animate.killTweensOf(this.leaf);this.leaf.hidden=true;this.clearPreview();this.book.classList.remove('is-opening','is-closing');animate.killTweensOf(this.book);animate.killTweensOf(this.book.querySelector('.book-opening-cover'));}
}
