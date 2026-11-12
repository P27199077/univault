import {animate} from './room.js';
import {courseCategory,COURSE_BROWNS} from './academics.js';
import {bookSections,sectionFiles,moveItem} from './book-sections.js';
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;


export class BookReader {
  constructor({getBlob,download,onEdit,onChange=()=>{},onUpload=()=>{},onDelete=()=>{}}) {
    this.onChange=onChange;this.onUpload=onUpload;this.onDelete=onDelete;this.files=[];
    this.getBlob=getBlob;this.download=download;this.onEdit=onEdit;this.generation=0;this.transition=0;this.url=null;this.section='slides';
    this.book=document.getElementById('course-book');
    this.leaf=document.createElement('div');this.leaf.className='book-page-turn-leaf';this.leaf.hidden=true;this.leaf.setAttribute('aria-hidden','true');this.book.querySelector('.book-right-page').append(this.leaf);
    this.tabs=[];
    document.getElementById('book-add-section').addEventListener('submit',event=>{
      event.preventDefault();const input=document.getElementById('book-new-section');const name=input.value.trim();if(!name||!this.course)return;
      const section={id:`page-${crypto.randomUUID()}`,name};
      this.course.bookSections=[...(this.course.bookSections||[]),section];this.onChange(this.course);input.value='';this.renderSections();this.select(section.id);
    });
    document.getElementById('book-prev-file').addEventListener('click',()=>this.stepFile(-1));
    document.getElementById('book-next-file').addEventListener('click',()=>this.stepFile(1));
    document.getElementById('book-file-select').addEventListener('change',event=>{const file=this.files.find(f=>f.id===event.target.value);if(file)this.preview(file);});
    document.getElementById('book-preview-back').addEventListener('click',()=>this.select(this.section,true,false));
    document.getElementById('book-download-file').addEventListener('click',()=>{if(this.file)this.download(this.file);});
    document.getElementById('btn-book-edit').addEventListener('click',()=>{if(this.course)this.onEdit(this.course.id);});
  }
  open(course) {
    this.transition++;
    this.course=course;this.renderSections();this.clearPreview();this.select(bookSections(course)[0].id,false);
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
  setFiles(course,files) {
    this.course=course;this.files=files;this.renderSections();
    if(this.file){const updated=files.find(f=>f.id===this.file.id);if(updated)this.preview(updated);else this.select(this.section,false);}
  }
  renderSections() {
    if(!this.course)return;
    const sections=bookSections(this.course),tabs=document.querySelector('.book-section-tabs'),organizer=document.getElementById('book-section-order');
    tabs.replaceChildren();organizer.replaceChildren();
    document.querySelector('.folders-column').replaceChildren();
    sections.forEach((section,index)=>{
      const tab=document.createElement('button');tab.type='button';tab.role='tab';tab.id=`book-tab-${section.id}`;tab.dataset.bookSection=section.id;tab.setAttribute('aria-controls',`book-section-${section.id}`);
      tab.append(document.createTextNode(String(index+1).padStart(2,'0')+' '));const text=document.createElement('span');text.textContent=section.name;tab.append(text);
      const active=section.id===this.section;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;
      tab.addEventListener('click',()=>this.select(section.id));
      tab.addEventListener('keydown',event=>{let next=index;if(['ArrowRight','ArrowDown'].includes(event.key))next=(index+1)%sections.length;else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(index+sections.length-1)%sections.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=sections.length-1;else return;event.preventDefault();this.tabs[next].focus();this.select(sections[next].id);});tabs.append(tab);
      const row=document.createElement('div');row.className='book-order-row';const name=document.createElement('span');name.textContent=section.name;row.append(name);
      [-1,1].forEach(delta=>{const button=document.createElement('button');button.type='button';button.textContent=delta<0?'↑':'↓';button.setAttribute('aria-label',`Move ${section.name} ${delta<0?'up':'down'}`);button.disabled=index+delta<0||index+delta>=sections.length;button.addEventListener('click',()=>{this.course.bookSectionOrder=moveItem(sections.map(s=>s.id),section.id,delta);this.onChange(this.course);this.renderSections();this.select(this.section,false,false);document.getElementById('book-section-order').querySelectorAll('button')[(index+delta)*2+(delta<0?0:1)]?.focus();});row.append(button);});organizer.append(row);
      if(['notebook','tasks'].includes(section.id))return;
      const panel=document.createElement('div');panel.className='folder-card book-content-panel';panel.id=`book-section-${section.id}`;panel.role='tabpanel';panel.setAttribute('aria-labelledby',tab.id);panel.hidden=!active;
      const heading=document.createElement('h3');heading.textContent=section.name;panel.append(heading);
      const files=sectionFiles(this.files,this.course,section.id);const count=document.createElement('p');count.textContent=`${files.length} ${files.length===1?'file':'files'} · Open a file to read through this section.`;panel.append(count);
      const upload=document.createElement('label');upload.className='book-upload';upload.textContent='＋ Add files';const input=document.createElement('input');input.type='file';input.multiple=true;input.setAttribute('aria-label',`Add files to ${section.name}`);input.addEventListener('change',()=>{this.onUpload(Array.from(input.files),section.id);input.value='';});upload.append(input);panel.append(upload);
      const list=document.createElement('div');list.className='book-document-list';
      if(!files.length){const empty=document.createElement('p');empty.textContent='No files yet. Add handouts, PDFs, images or slides to keep them here.';list.append(empty);}
      files.forEach((file,i)=>{
        const item=document.createElement('div');item.className='book-document-row';const open=document.createElement('button');open.type='button';open.className='book-document-name';open.textContent=`${String(i+1).padStart(2,'0')}  ${file.name}`;open.addEventListener('click',()=>this.preview(file));item.append(open);
        [-1,1].forEach(delta=>{const move=document.createElement('button');move.type='button';move.textContent=delta<0?'↑':'↓';move.setAttribute('aria-label',`Move ${file.name} ${delta<0?'up':'down'}`);move.disabled=i+delta<0||i+delta>=files.length;move.addEventListener('click',()=>{this.course.bookFileOrder={...this.course.bookFileOrder,[section.id]:moveItem(files.map(f=>f.id),file.id,delta)};this.onChange(this.course);this.renderSections();});item.append(move);});
        const remove=document.createElement('button');remove.type='button';remove.textContent='×';remove.setAttribute('aria-label',`Delete ${file.name}`);remove.addEventListener('click',()=>this.onDelete(file));item.append(remove);list.append(item);
      });panel.append(list);document.querySelector('.folders-column').append(panel);
    });this.tabs=[...tabs.children];
  }
  stepFile(delta){const files=sectionFiles(this.files,this.course,this.section);const index=files.findIndex(f=>f.id===this.file?.id);if(files[index+delta])this.preview(files[index+delta]);}
  select(section,animated=true,autoPreview=true) {
    const entry=bookSections(this.course).find(s=>s.id===section);if(!entry)return;this.section=section;this.clearPreview();
    this.tabs.forEach((tab,i)=>{const active=tab.dataset.bookSection===section;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;if(active)document.getElementById('book-page-index').textContent=String(i+1).padStart(2,'0');});
    document.querySelectorAll('.book-content-panel').forEach(panel=>panel.hidden=panel.id!==`book-section-${section}`);
    document.getElementById('book-running-title').textContent=entry.name;
    if(autoPreview){const files=sectionFiles(this.files,this.course,section);if(files.length===1)this.preview(files[0]);}
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
    const queue=sectionFiles(this.files,this.course,this.section),index=queue.findIndex(f=>f.id===file.id);
    const picker=document.getElementById('book-file-select');picker.replaceChildren();queue.forEach(f=>{const option=document.createElement('option');option.value=f.id;option.textContent=f.name;picker.append(option);});picker.value=file.id;
    document.getElementById('book-prev-file').disabled=index<=0;document.getElementById('book-next-file').disabled=index<0||index>=queue.length-1;
    document.getElementById('book-file-position').textContent=`Document ${index+1} of ${queue.length}`;
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
