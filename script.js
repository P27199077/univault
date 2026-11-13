import {courseCategory, COURSE_BROWNS, GRADE_POINTS, GRADE_OPTIONS, buildCourseRecord, estimateSemester, courseGrade, normalizeGrade, academicTotals, parsePerformancePages, mergePerformanceSheet} from './academics.js';
import {BookReader} from './book-reader.js';
import {StudyRoom} from './room.js';
import {createBackend, WORKSPACE_KEYS, validateSnapshot} from './backend.js';

const config = window.UNIVAULT_CONFIG || {};
const authReturnUrl = new URL(window.location.href);
const authReturnHash = new URLSearchParams(authReturnUrl.hash.slice(1));
const authReturnError = authReturnUrl.searchParams.get('error') || authReturnHash.get('error');
const backendClient = config.supabaseUrl && config.supabasePublishableKey && window.supabase
  ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {auth:{storageKey:'univault-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}})
  : null;
let lastCloudStatus = {state:'local',message:'Saved on this device only'};
const backend = createBackend({client:backendClient,storage:window.localStorage,onStatus:updateBackendStatus});
const workspaceStorage = backend.workspaceStorage;
let authInitialized = false;
let authRequestPending = false;
// Temporary midsem estimates are deliberately absent from workspace storage and backups.
let midsemDraft = {semesterId:null,grades:{}};

// UniVault Database and State Management Script

// ================= CONSTANTS & STATE =================
const DB_NAME = 'UniVaultDB';
const DB_VERSION = 1;
const STORE_NAME = 'materials';

let db = null;
let state = {
  semesters: [],
  courses: []
};

// Colors palette for courses
const ACCENT_COLORS = {
  purple: '#926042',
  indigo: '#777849',
  blue: '#607b80',
  emerald: '#687044',
  amber: '#ab752a',
  rose: '#a74e3c'
};

// UI DOM references
let activeTab = 'dashboard'; // 'dashboard' or 'materials'
let activeCourseId = null;
let activeDrawerTab = 'tab-materials';
let draggedCourseId = null;
let activeThemeColor = 'indigo';
let studyRoom=null;
let bookReader=null;
let bookInFlight=false;
let navigationRevision=0;

// ================= ACCOUNT SESSION =================
async function initAuth() {
  if (!authInitialized) {
    try {await backend.initialize(); authInitialized = true;}
    catch (error) {showAuthAlert(error.message);}
  }
  const guest = sessionStorage.getItem('univault-guest') === 'true';
  const signedIn = backend.signedIn || guest;
  document.getElementById('login-container').classList.toggle('hidden', signedIn);
  document.querySelector('.app-container').style.display = signedIn ? 'flex' : 'none';
  document.getElementById('cloud-unconfigured').hidden = backend.configured;
  document.getElementById('form-signin').hidden = !backend.configured;
  document.querySelectorAll('.google-auth-option').forEach(option => {option.hidden = !backend.configured;});
  document.querySelector('#panel-signin .auth-switch').hidden = !backend.configured;
  const name = backend.user?.email || 'On this device';
  document.getElementById('sidebar-username').textContent = name;
  document.getElementById('sidebar-user-avatar').textContent = backend.user ? name[0].toUpperCase() : 'U';
  document.querySelector('.user-role').textContent = backend.signedIn ? 'Personal account' : 'Local workspace';
  updateBackendStatus(lastCloudStatus);
  if (authReturnError) {
    showAuthAlert(authReturnError === 'access_denied'
      ? 'Google sign-in was cancelled or access was declined. Try again, or sign in with email.'
      : 'Sign-in could not be completed. Please try again or use email.');
    for (const key of ['error','error_code','error_description']) {
      authReturnUrl.searchParams.delete(key);
      authReturnHash.delete(key);
    }
    authReturnUrl.hash = authReturnHash.toString();
    window.history.replaceState(null,'',authReturnUrl.pathname + authReturnUrl.search + authReturnUrl.hash);
  }
}

function setAuthBusy(busy) {
  authRequestPending = busy;
  const login = document.getElementById('login-container');
  login.setAttribute('aria-busy',String(busy));
  login.querySelectorAll('button').forEach(button => {button.disabled = busy;});
}

function showAuthAlert(text, isSuccess = false) {
  const alertBanner = document.getElementById('auth-alert-banner');
  const alertText = document.getElementById('auth-alert-text');
  if (!alertBanner || !alertText) return;
  
  alertText.innerText = text;
  alertBanner.style.display = 'block';
  if (isSuccess) {
    alertBanner.classList.add('success');
  } else {
    alertBanner.classList.remove('success');
  }
}

function hideAuthAlert() {
  const alertBanner = document.getElementById('auth-alert-banner');
  if (alertBanner) alertBanner.style.display = 'none';
}

// ================= INDEXEDDB ENGINE =================
function initDB() {
  return new Promise((resolve, reject) => {
    if (backend.signedIn) {resolve(); return;}
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('courseId', 'courseId', { unique: false });
      }
    };
    
    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };
    
    request.onerror = (event) => {
      console.error("IndexedDB error:", event.target.error);
      reject(event.target.error);
    };
  });
}

function storeFile(fileRecord) {
  if (backend.signedIn) return backend.storeFile(fileRecord);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(fileRecord);
    
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e.target.error);
  });
}

function deleteFile(fileId) {
  if (backend.signedIn) return backend.deleteFile(fileId);
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(fileId);
    
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e.target.error);
  });
}

function getFilesByCourse(courseId) {
  if (backend.signedIn) return Promise.resolve(backend.listFiles(courseId));
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('courseId');
    const request = index.getAll(courseId);
    
    request.onsuccess = (e) => resolve(e.target.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

function getAllFiles() {
  if (backend.signedIn) return Promise.resolve(backend.listFiles());
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    
    request.onsuccess = (e) => resolve(e.target.result || []);
    request.onerror = (e) => reject(e.target.error);
  });
}

// ================= STATE MANAGEMENT =================
function loadStateFromStorage() {
  const storedSemesters = workspaceStorage.getItem('univault_semesters');
  const storedCourses = workspaceStorage.getItem('univault_courses');
  state.tasks = JSON.parse(workspaceStorage.getItem('univault_tasks') || '[]');
  
  if (storedSemesters && storedCourses) {
    state.semesters = JSON.parse(storedSemesters);
    state.courses = JSON.parse(storedCourses).map(course=>({...course,courseCategory:courseCategory(course)}));
  } else {
    state.semesters = [];
    state.courses = [];
  }
}

function saveStateToStorage() {
  workspaceStorage.setItem('univault_semesters', JSON.stringify(state.semesters));
  workspaceStorage.setItem('univault_courses', JSON.stringify(state.courses));
  
  workspaceStorage.setItem('univault_tasks',JSON.stringify(state.tasks || []));
}

async function renderBoard() {
  const container = document.getElementById('semester-board');
  if (!container) return;
  studyRoom?.update(state.semesters,state.courses);
  container.innerHTML = '';
  renderDashboardOverview();
  syncDashboardSemesterFilter();
  
  if (state.semesters.length === 0) {
    document.getElementById('board-result-count').textContent = '0';
    document.getElementById('dashboard-search-status').textContent = '0 courses found';
    container.innerHTML = `
      <div class="empty-state" style="width: 100%;">
        <div class="empty-state-icon"><i data-lucide="calendar"></i></div>
        <div class="empty-state-title">Your shelf is waiting</div>
        <div class="empty-state-desc">Add your first semester and give your courses a home. You can also bring past records in from Grades & CGPA.</div>
        <button class="btn btn-primary btn-sm" id="btn-empty-add-sem">Create Semester</button>
      </div>
    `;
    lucide.createIcons();
    document.getElementById('btn-empty-add-sem').addEventListener('click', openSemesterModal);
    return;
  }
  
  // Keep the numbered terms chronological, with PS-1 after Year 2 Sem 2.
  // Active semester shelves stay at eye level; finished shelves settle below them.
  const semesterOrder = semester => {
    const name = String(semester.name || '').trim();
    const numbered = name.match(/(?:year\s*)?(\d+)\s*[- ]?\s*(?:sem(?:ester)?\s*)?(\d+)/i);
    if (numbered) return Number(numbered[1]) * 10 + Number(numbered[2]);
    if (/\bps\s*[- ]?1\b|summer\s*term/i.test(name)) return 25;
    return null;
  };
  const sortBySemesterOrder = semesters => semesters
    .map((semester,index)=>({semester,index,order:semesterOrder(semester)}))
    .sort((a,b)=>a.order!==null && b.order!==null ? a.order-b.order : a.order!==null ? -1 : b.order!==null ? 1 : a.index-b.index)
    .map(entry=>entry.semester);
  const sortedSemesters=[
    ...sortBySemesterOrder(state.semesters.filter(semester=>!semester.completed)),
    ...sortBySemesterOrder(state.semesters.filter(semester=>semester.completed)),
  ];

  // Each semester is a shelf; course records render as clickable books.
  for (const sem of sortedSemesters) {
    const col = document.createElement('div');
    col.className = 'semester-column';
    col.id = `sem-col-${sem.id}`;
    col.dataset.id = sem.id;
    col.classList.toggle('semester-finished',!!sem.completed);
    const currentSemester=state.semesters.find(semester=>!semester.completed && state.courses.some(course=>course.semesterId===semester.id && !course.isPlaceholder));
    col.classList.toggle('semester-current',!sem.completed && sem.id===currentSemester?.id);
    
    // Get courses in this semester
    const semCourses = state.courses.filter(c => c.semesterId === sem.id).sort((a,b)=>(Number(a.shelfOrder)||0)-(Number(b.shelfOrder)||0));
    
    // Build Header
    const header = document.createElement('div');
    header.className = 'semester-header';
    if (sem.completed) {
      header.style.opacity = '0.75';
    }
    
    const titleContainer = document.createElement('div');
    titleContainer.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; cursor: pointer;';
    
    const checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'semester-complete';
    checkBtn.setAttribute('aria-label', `${sem.completed ? 'Mark ongoing' : 'Mark complete'}: ${sem.name}`);
    checkBtn.setAttribute('aria-pressed', String(!!sem.completed));
    checkBtn.title = sem.completed ? 'Mark semester ongoing' : 'Mark semester complete';
    checkBtn.style.cssText = 'display: flex; align-items: center; justify-content: center;';
    if (sem.completed) {
      checkBtn.innerHTML = `<i data-lucide="check-circle" style="color: var(--color-emerald); width: 18px; height: 18px;"></i>`;
    } else {
      checkBtn.innerHTML = `<i data-lucide="circle" style="color: var(--text-secondary); width: 18px; height: 18px; opacity: 0.6;"></i>`;
    }
    
    checkBtn.addEventListener('click', () => {
      const hasPending = semCourses.some(c => !courseGrade(c));
      
      if (!sem.completed) {
        if (semCourses.length === 0) {
          showToast("Cannot complete semester: add at least one course first!", "error");
          return;
        }
        if (hasPending) {
          showToast("Cannot complete semester: enter grades for all courses first!", "error");
          return;
        }
        sem.completed = true;
        showToast(`Congratulations! Marked ${sem.name} as Completed!`, "success");
      } else {
        sem.completed = false;
        showToast(`Marked ${sem.name} as Ongoing.`, "success");
      }
      saveStateToStorage();
      renderBoard();
      if (activeTab === 'cgpa') {
        renderCgpaCalculator();
      }
    });
    
    const title = document.createElement('div');
    title.className = 'semester-title';
    title.innerText = sem.name;
    if (sem.completed) {
      title.style.textDecoration = 'line-through';
      title.style.color = 'var(--text-secondary)';
    }
    
    // Create hover edit icon for renaming
    const editIcon = document.createElement('button');
    editIcon.type = 'button';
    editIcon.className = 'action-icon semester-rename';
    editIcon.setAttribute('aria-label', `Rename ${sem.name}`);
    editIcon.hidden = !!sem.completed;
    editIcon.style.cssText = 'opacity: 0; margin-left: 0.25rem; font-size: 0.75rem; cursor: pointer; transition: opacity 0.2s;';
    editIcon.innerHTML = `<i data-lucide="edit-3" style="width: 12px; height: 12px;"></i>`;
    
    titleContainer.addEventListener('mouseenter', () => {
      if (!sem.completed) editIcon.style.opacity = '0.6';
    });
    titleContainer.addEventListener('mouseleave', () => {
      editIcon.style.opacity = '0';
    });
    
    function startRename() {
      if (sem.completed) return;
      
      const input = document.createElement('input');
      input.type = 'text';
      input.value = sem.name;
      input.className = 'form-control';
      input.style.cssText = 'font-size: 1rem; font-weight: 700; padding: 2px 6px; height: auto; width: 140px; margin: 0; background: rgba(255,255,255,0.05); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;';
      
      titleContainer.replaceChild(input, title);
      editIcon.style.display = 'none';
      input.focus();
      input.select();
      
      let finished = false;
      function finishRename() {
        if (finished) return;
        finished = true;
        
        const newName = input.value.trim();
        if (newName && newName !== sem.name) {
          sem.name = newName;
          saveStateToStorage();
          showToast(`Semester renamed to "${newName}"`, 'success');
        }
        renderBoard();
      }
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finishRename();
        if (e.key === 'Escape') {
          finished = true;
          renderBoard();
        }
      });
      
      input.addEventListener('blur', finishRename);
    }
    
    editIcon.addEventListener('click', (e) => {
      e.stopPropagation();
      startRename();
    });
    
    title.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startRename();
    });
    
    titleContainer.appendChild(checkBtn);
    titleContainer.appendChild(title);
    titleContainer.appendChild(editIcon);
    
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.alignItems = 'center';
    controls.style.gap = '0.5rem';
    
    const count = document.createElement('span');
    count.className = 'semester-stats';
    count.innerText = `${semCourses.length} ${semCourses.length === 1 ? 'course' : 'courses'}`;
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-icon delete';
    deleteBtn.title = 'Delete Semester';
    deleteBtn.innerHTML = `<i data-lucide="trash-2"></i>`;
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteSemester(sem.id);
    });
    
    controls.appendChild(count);
    controls.appendChild(deleteBtn);
    header.appendChild(titleContainer);
    header.appendChild(controls);
    col.appendChild(header);
    
    // Build Courses List Area
    const courseList = document.createElement('div');
    courseList.className = 'course-list';
    courseList.id = `course-list-${sem.id}`;
    courseList.dataset.semId = sem.id;
    
    for (const course of semCourses) {
      const pose = readShelfPoses()[course.id] || 'upright';
      const card = await buildCourseCard(course,{worn:!!sem.completed || col.classList.contains('semester-current'),pose});
      courseList.appendChild(card);
    }
    
    col.appendChild(courseList);
    container.appendChild(col);
  }
  
  setupDragAndDrop();
  applyDashboardFilters();
  lucide.createIcons();
}

function readShelfPoses() {
  try { return JSON.parse(localStorage.getItem('univault_shelf_poses') || '{}'); }
  catch { return {}; }
}

function writeShelfPose(courseId,pose) {
  const poses=readShelfPoses();poses[courseId]=pose;
  try { localStorage.setItem('univault_shelf_poses',JSON.stringify(poses)); }
  catch { showToast('Could not save this book position on this device.','error'); }
}

async function buildCourseCard(course,{worn=false,pose='upright'}={}) {
  const card=document.createElement('div');card.className='course-card spine-volume'+(course.isPlaceholder?' elective-placeholder':'')+(worn?' spine-worn':'')+(pose==='horizontal'?' spine-laid':'')+(pose==='slanted'?' spine-slanted':'');
  card.id=`course-card-${course.id}`;card.dataset.id=course.id;card.draggable=true;card.setAttribute('role','group');card.setAttribute('aria-label',course.name);
  const credits=Math.max(1,Math.min(8,Number(course.credits)||1));
  const sizeSeed=String(course.id||course.code||course.name||'book').split('').reduce((seed,char)=>(seed*31+char.charCodeAt(0))>>>0,7);
  const bookWidth=Math.round(48+credits*4+(sizeSeed%3));
  const bookHeight=190+(sizeSeed%42);
  card.style.setProperty('--book-width',`${bookWidth}px`);
  card.style.setProperty('--book-height',`${bookHeight}px`);
  card.style.setProperty('--book-color',COURSE_BROWNS[courseCategory(course)]);
  const open=document.createElement('button');open.type='button';open.className='spine-open';open.setAttribute('aria-label',`Open ${course.name}`);open.title=`${course.name} · ${course.code} · ${courseCategory(course)}`;
  const category=document.createElement('span');category.className='spine-category';category.textContent=courseCategory(course);
  const title=document.createElement('span');title.className='spine-title';title.textContent=course.name;
  const code=document.createElement('span');code.className='spine-code';code.textContent=course.code || '';
  open.append(category,title,code);open.addEventListener('click',()=>openBookFromShelf(course.id,card));card.append(open);
  const actions=document.createElement('div');actions.className='spine-actions';
  const poseNames={upright:'upright',slanted:'slanted',horizontal:'horizontal'};
  const nextPose={upright:'slanted',slanted:'horizontal',horizontal:'upright'};
  const poseButton=document.createElement('button');poseButton.type='button';poseButton.className='action-icon';poseButton.setAttribute('aria-label',`Change ${course.name} book position, currently ${poseNames[pose]||'upright'}`);poseButton.title=`Current: ${poseNames[pose]||'upright'} · click for ${nextPose[pose]||'slanted'}`;poseButton.innerHTML='<i data-lucide="rotate-cw"></i>';
  poseButton.addEventListener('click',event=>{event.stopPropagation();const next=nextPose[pose]||'slanted';if(next==='horizontal'){const horizontalCount=state.courses.filter(item=>item.semesterId===course.semesterId && readShelfPoses()[item.id]==='horizontal').length;if(horizontalCount>=2){showToast('Keep no more than two books lying flat on a shelf.','info');return;}}writeShelfPose(course.id,next);renderBoard();});actions.append(poseButton);
  for(const [label,icon,action] of [['Edit '+course.name,'pencil',()=>openCourseModal(course.id)],['Delete '+course.name,'trash-2',()=>confirmDeleteCourse(course.id)]]) {
    const button=document.createElement('button');button.type='button';button.className='action-icon';button.setAttribute('aria-label',label);button.title=label;button.innerHTML=`<i data-lucide="${icon}"></i>`;button.addEventListener('click',event=>{event.stopPropagation();action();});actions.append(button);
  }
  card.append(actions);return card;
}

async function openBookFromShelf(id,spine) {
  if(bookInFlight)return;const course=state.courses.find(c=>c.id===id);if(!course)return;bookInFlight=true;
  const revision=navigationRevision;
  try {await bookReader?.flyFrom(spine,course);if(revision!==navigationRevision || activeTab!=='dashboard')return;await openCourseDetail(id);}
  finally {bookInFlight=false;}
}

async function renderMetrics() {
  document.getElementById('stat-semesters').innerText = state.semesters.length;
  document.getElementById('stat-courses').innerText = state.courses.length;
  
  // Calculate total files
  const files = await getAllFiles();
  document.getElementById('stat-materials').innerText = files.length;
  
  // Calculate checklist completion %
  let totalTasks = 0;
  let completedTasks = 0;
  state.courses.forEach(c => {
    if (c.checklist) {
      totalTasks += c.checklist.length;
      completedTasks += c.checklist.filter(item => item.completed).length;
    }
  });
  
  const percentText = totalTasks === 0 ? '0%' : `${Math.round((completedTasks / totalTasks) * 100)}%`;
  document.getElementById('stat-checklist').innerText = percentText;
}

// ================= DRAG AND DROP API IMPLEMENTATION =================
function setupDragAndDrop() {
  const cards = document.querySelectorAll('.course-card');
  const columns = document.querySelectorAll('.semester-column');
  
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      draggedCourseId = card.dataset.id;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedCourseId);
    });
    
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      draggedCourseId = null;
      columns.forEach(col => col.classList.remove('dragover'));
    });
  });
  
  columns.forEach(col => {
    col.addEventListener('dragenter', (e) => {
      e.preventDefault();
      col.classList.add('dragover');
    });
    
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('dragover');
    });
    
    col.addEventListener('dragleave', () => {
      col.classList.remove('dragover');
    });
    
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('dragover');
      
      const courseId = e.dataTransfer.getData('text/plain') || draggedCourseId;
      const targetSemId = col.dataset.id;
      
      if (courseId && targetSemId) {
        const course = state.courses.find(c => c.id === courseId);
        const draggedCard=document.querySelector(`.course-card[data-id="${courseId}"]`);
        const targetCard=e.target.closest('.course-card');
        const targetList=col.querySelector('.course-list');
        if (course && draggedCard && targetList) {
          if(targetCard && targetCard!==draggedCard && targetCard.parentElement===targetList){
            const after=e.clientX>targetCard.getBoundingClientRect().left+targetCard.getBoundingClientRect().width/2;
            targetList.insertBefore(draggedCard,after?targetCard.nextSibling:targetCard);
          }else targetList.appendChild(draggedCard);
          document.querySelectorAll('.semester-column').forEach(semesterColumn=>{
            semesterColumn.querySelectorAll('.course-card').forEach((card,index)=>{
              const item=state.courses.find(entry=>entry.id===card.dataset.id);
              if(item){item.semesterId=semesterColumn.dataset.id;item.shelfOrder=index;}
            });
          });
          saveStateToStorage();
          await renderBoard();
          await renderMetrics();
        }
      }
    });
  });
}

// ================= COURSE DETAIL PAGE VIEW MANAGEMENT =================
async function openCourseDetail(courseId) {
  const course = state.courses.find(c => c.id === courseId);
  if (!course) return;
  
  persistPendingNotes();
  activeCourseId = courseId;
  if(document.getElementById('room-stage').dataset.view!=='shelf')setStudyView('shelf',false);
  
  // Set course metadata
  document.getElementById('detail-course-name').innerText = course.name;
  
  const badge = document.getElementById('detail-course-code-badge');
  badge.innerText = course.code || 'N/A';
  badge.style.backgroundColor = `rgba(${hexToRgb(COURSE_BROWNS[courseCategory(course)])}, 0.15)`;
  badge.style.color = COURSE_BROWNS[courseCategory(course)];
  
  document.getElementById('detail-course-credits').textContent = `${Number(course.credits) || 0} ${course.isPlaceholder || !courseGrade(course) ? 'planned credits' : 'credits'}`;
  document.getElementById('detail-course-grade').textContent = course.isPlaceholder ? `${course.electiveType} elective · course not chosen yet` : `Grade: ${courseGrade(course) || 'Pending'}`;
  document.getElementById('btn-choose-elective').hidden = !course.isPlaceholder;
  
  // Notepad contents
  document.getElementById('detail-notes-textarea').value = course.notes || '';
  document.getElementById('detail-notes-status').innerText = 'Notepad ready';
  
  // Render files lists and checklist items
  await renderCourseDetailFiles();
  if (activeCourseId !== courseId) return;
  renderCourseDetailChecklist();
  
  // Switch view panel
  handleNavigation('course-detail');
  bookReader?.open(course);
}

async function renderCourseDetailFiles() {
  if (!activeCourseId) return;
  const courseId = activeCourseId;
  const files = await getFilesByCourse(courseId);
  if (activeCourseId !== courseId) return;
  const course = state.courses.find(c => c.id === courseId);
  bookReader?.setFiles(course, files);
}

function renderCourseDetailChecklist() {
  const container = document.getElementById('detail-req-list');
  container.innerHTML = '';
  
  if (!activeCourseId) return;
  const course = state.courses.find(c => c.id === activeCourseId);
  if (!course) return;
  
  if (!course.checklist || course.checklist.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 2rem 0; width: 100%;">
        No items in the course checklist yet. Add one above!
      </div>
    `;
    return;
  }
  
  course.checklist.forEach(item => {
    const el = document.createElement('div');
    el.className = `req-item ${item.completed ? 'completed' : ''}`;
    
    const chk = document.createElement('button');
    chk.type = 'button';
    chk.setAttribute('aria-label', item.text);
    chk.setAttribute('aria-pressed', String(!!item.completed));
    chk.className = 'req-checkbox';
    chk.innerHTML = `<i data-lucide="check" style="width: 12px; height: 12px;"></i>`;
    
    const txt = document.createElement('span');
    txt.className = 'req-text';
    txt.innerText = item.text;
    
    const delBtn = document.createElement('button');
    delBtn.className = 'action-icon delete';
    delBtn.setAttribute('aria-label', `Delete task: ${item.text}`);
    delBtn.style.marginLeft = 'auto';
    delBtn.innerHTML = `<i data-lucide="trash-2"></i>`;
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteChecklistItem(item.id);
    });
    
    el.appendChild(chk);
    el.appendChild(txt);
    el.appendChild(delBtn);
    
    el.addEventListener('click', () => {
      toggleChecklistItem(item.id);
    });
    
    container.appendChild(el);
  });
  
  lucide.createIcons();
}

function addChecklistItem() {
  const input = document.getElementById('detail-new-req-input');
  const text = input.value.trim();
  if (!text || !activeCourseId) return;
  
  const course = state.courses.find(c => c.id === activeCourseId);
  if (!course) return;
  
  if (!course.checklist) course.checklist = [];
  
  course.checklist.push({
    id: `chk-${Date.now()}`,
    text: text,
    completed: false
  });
  
  saveStateToStorage();
  input.value = '';
  renderCourseDetailChecklist();
  renderMetrics();
}

function toggleChecklistItem(itemId) {
  if (!activeCourseId) return;
  const course = state.courses.find(c => c.id === activeCourseId);
  if (!course) return;
  
  const item = course.checklist.find(i => i.id === itemId);
  if (item) {
    item.completed = !item.completed;
    saveStateToStorage();
    renderCourseDetailChecklist();
    renderMetrics();
  }
}

function deleteChecklistItem(itemId) {
  if (!activeCourseId) return;
  const course = state.courses.find(c => c.id === activeCourseId);
  if (!course) return;
  
  course.checklist = course.checklist.filter(i => i.id !== itemId);
  saveStateToStorage();
  renderCourseDetailChecklist();
  renderMetrics();
}

let notesSaveTimeout = null;
function handleNotesInput() {
  const status = document.getElementById('detail-notes-status');
  status.innerText = 'Typing...';
  
  clearTimeout(notesSaveTimeout);
  notesSaveTimeout = setTimeout(() => {
    if (!activeCourseId) return;
    const course = state.courses.find(c => c.id === activeCourseId);
    if (course) {
      course.notes = document.getElementById('detail-notes-textarea').value;
      saveStateToStorage();
      status.innerText = 'Notes saved automatically';
    }
  }, 1000);
}

// ================= MATERIAL UPLOAD CONTROLLERS =================
async function handleFileUpload(filesList, type) {
  if (!activeCourseId || filesList.length === 0) return;
  const courseId = activeCourseId;
  const filesToUpload = Array.from(filesList);
  let uploaded = 0;
  for (const file of filesToUpload) {
    const record = {id:`file-${crypto.randomUUID()}`,courseId,name:file.name,type,mimeType:file.type || 'application/octet-stream',size:file.size,uploadedAt:new Date().toISOString(),content:file};
    try {
      await storeFile(record);
      uploaded++;
    } catch (error) {showToast(`Could not upload ${file.name}: ${error.message || 'Please try again.'}`,'error');}
  }
  if (activeCourseId === courseId) await renderCourseDetailFiles();
  await renderMetrics();
  if (uploaded) showToast(`${uploaded} ${uploaded === 1 ? 'file saved' : 'files saved'}${backend.signedIn ? ' to your private vault' : ' on this device'}.`);
}

// Download dynamic file records from IndexedDB
async function downloadFileRecord(fileRecord) {
  try {
    if (!fileRecord.content) fileRecord = {...fileRecord,content:await backend.downloadFile(fileRecord)};
  } catch (error) {showToast('Could not download this file. Please reconnect and try again.','error'); return;}
  const url = URL.createObjectURL(fileRecord.content);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileRecord.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

let activePreviewUrl = null;

// Preview Modal popup handler
async function openPreviewModal(fileRecord) {
  try {
    if (!fileRecord.content) fileRecord = {...fileRecord,content:await backend.downloadFile(fileRecord)};
  } catch (error) {showToast('Could not load this file. Please reconnect and try again.','error'); return;}
  if (activePreviewUrl) {
    URL.revokeObjectURL(activePreviewUrl);
    activePreviewUrl = null;
  }
  
  document.getElementById('preview-file-title').innerText = `Preview: ${fileRecord.name}`;
  const container = document.getElementById('preview-container');
  container.className = 'preview-content';
  container.innerHTML = '';
  
  const fileType = fileRecord.mimeType;
  
  // Set up download button reference
  const downloadBtn = document.getElementById('btn-download-preview-file');
  // Recreate node to strip past event listeners
  const newBtn = downloadBtn.cloneNode(true);
  downloadBtn.parentNode.replaceChild(newBtn, downloadBtn);
  newBtn.addEventListener('click', () => downloadFileRecord(fileRecord));
  
  if (fileType.startsWith('image/')) {
    activePreviewUrl = URL.createObjectURL(fileRecord.content);
    const img = document.createElement('img');
    img.src = activePreviewUrl;
    container.appendChild(img);
  } else if (fileType === 'application/pdf' || fileRecord.name.toLowerCase().endsWith('.pdf')) {
    activePreviewUrl = URL.createObjectURL(fileRecord.content);
    const iframe = document.createElement('iframe');
    iframe.src = activePreviewUrl;
    container.appendChild(iframe);
  } else if (fileType.startsWith('audio/')) {
    activePreviewUrl = URL.createObjectURL(fileRecord.content);
    const audio = document.createElement('audio');
    audio.src = activePreviewUrl;
    audio.controls = true;
    audio.style.width = '80%';
    container.appendChild(audio);
  } else if (fileType.startsWith('video/')) {
    activePreviewUrl = URL.createObjectURL(fileRecord.content);
    const video = document.createElement('video');
    video.src = activePreviewUrl;
    video.controls = true;
    video.style.width = '100%';
    video.style.height = '100%';
    container.appendChild(video);
  } else if (fileType === 'text/plain' || fileRecord.name.endsWith('.txt') || fileRecord.name.endsWith('.js') || fileRecord.name.endsWith('.css') || fileRecord.name.endsWith('.html') || fileRecord.name.endsWith('.json')) {
    container.classList.add('text-file');
    const reader = new FileReader();
    reader.onload = (e) => {
      container.innerText = e.target.result;
    };
    reader.readAsText(fileRecord.content);
  } else {
    // Other binary files placeholder
    container.innerHTML = `
      <div class="preview-placeholder">
        <div class="preview-placeholder-icon">
          <i data-lucide="${getFileIconName(fileRecord.type)}"></i>
        </div>
        <div style="font-size: 1.1rem; font-weight: 600;">${escapeHtml(fileRecord.name)}</div>
        <div style="font-size: 0.85rem; color: var(--text-secondary);">${formatBytes(fileRecord.size)} - ${escapeHtml(fileRecord.mimeType)}</div>
        <div style="margin-top: 1rem; color: var(--text-muted); font-size: 0.85rem;">
          Previews are not supported for this file format in-browser. Please download to view.
        </div>
      </div>
    `;
    lucide.createIcons();
  }
  
  document.getElementById('modal-preview-backdrop').classList.add('active');
}

function closePreviewModal() {
  document.getElementById('modal-preview-backdrop').classList.remove('active');
  document.getElementById('preview-container').innerHTML = '';
  if (activePreviewUrl) {
    URL.revokeObjectURL(activePreviewUrl);
    activePreviewUrl = null;
  }
}

// ================= GLOBAL MATERIAL VAULT CONTROLLERS =================
async function renderMaterialsVault() {
  const grid = document.getElementById('global-materials-grid');
  if (!grid) return;
  grid.innerHTML = '';
  
  const filterType = document.querySelector('.filter-btn.active').dataset.type;
  const filterCourseId = document.getElementById('filter-course-select').value;
  const searchVal = document.getElementById('search-materials-input').value.toLowerCase().trim();
  
  let files = await getAllFiles();
  
  // Apply Course filter
  if (filterCourseId !== 'all') {
    files = files.filter(f => f.courseId === filterCourseId);
  }
  
  // Apply Material Type filter
  if (filterType !== 'all') {
    files = files.filter(f => f.type === filterType);
  }
  
  // Apply Search Query filter
  if (searchVal) {
    files = files.filter(f => f.name.toLowerCase().includes(searchVal));
  }
  
  if (files.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <div class="empty-state-icon"><i data-lucide="search-code"></i></div>
        <div class="empty-state-title">No Materials Found</div>
        <div class="empty-state-desc">Try matching a different keyword or upload materials inside a course detailed panel.</div>
      </div>
    `;
    lucide.createIcons();
    return;
  }
  
  files.sort((a,b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  
  files.forEach(f => {
    const course = state.courses.find(c => c.id === f.courseId);
    const courseName = course ? course.name : 'Unknown Course';
    const courseCode = course ? course.code : 'N/A';
    const courseColor = course ? ACCENT_COLORS[course.themeColor] : '#777849';
    
    const card = document.createElement('div');
    card.className = 'material-card-unified';
    
    const header = document.createElement('div');
    header.className = 'material-card-header';
    
    const badge = document.createElement('span');
    badge.className = 'material-card-course-badge';
    badge.innerText = courseCode;
    badge.style.backgroundColor = `rgba(${hexToRgb(courseColor)}, 0.15)`;
    badge.style.color = courseColor;
    
    const actions = document.createElement('div');
    actions.className = 'material-actions';
    
    const viewBtn = document.createElement('button');
    viewBtn.className = 'action-icon';
    viewBtn.innerHTML = `<i data-lucide="eye"></i>`;
    viewBtn.addEventListener('click', () => openPreviewModal(f));
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'action-icon';
    downloadBtn.innerHTML = `<i data-lucide="download"></i>`;
    downloadBtn.addEventListener('click', () => downloadFileRecord(f));
    
    actions.appendChild(viewBtn);
    actions.appendChild(downloadBtn);
    header.appendChild(badge);
    header.appendChild(actions);
    card.appendChild(header);
    
    const title = document.createElement('div');
    title.className = 'material-card-title';
    title.innerText = f.name;
    card.appendChild(title);
    
    const footer = document.createElement('div');
    footer.className = 'material-card-footer';
    
    const date = document.createElement('span');
    date.innerText = new Date(f.uploadedAt).toLocaleDateString();
    
    const size = document.createElement('span');
    size.innerText = formatBytes(f.size);
    
    footer.appendChild(date);
    footer.appendChild(size);
    card.appendChild(footer);
    
    grid.appendChild(card);
  });
  
  lucide.createIcons();
}

function updateGlobalFiltersSelect() {
  const select = document.getElementById('filter-course-select');
  if (!select) return;
  select.innerHTML = '<option value="all">All Courses</option>';
  
  state.courses.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.innerText = `${c.code} - ${c.name}`;
    select.appendChild(opt);
  });
}

// ================= MODAL DIALOG CONTROLLERS =================
function openSemesterModal() {
  document.getElementById('sem-name-input').value = '';
  document.getElementById('modal-semester-backdrop').classList.add('active');
}

function closeSemesterModal() {
  document.getElementById('modal-semester-backdrop').classList.remove('active');
}

function openCourseModal(courseId = null, chooseElective = false) {
  // Populate Semesters select in course modal
  const semSelect = document.getElementById('course-sem-select');
  semSelect.innerHTML = '';
  state.semesters.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.innerText = s.name;
    semSelect.appendChild(opt);
  });
  
  if (courseId) {
    // Edit Mode
    const course = state.courses.find(c => c.id === courseId);
    if (!course) return;
    
    document.getElementById('course-modal-title').innerText = 'Edit Course';
    document.getElementById('btn-save-course-submit').innerText = 'Save Changes';
    document.getElementById('course-edit-id').value = course.id;
    document.getElementById('course-name-input').value = course.isPlaceholder ? '' : course.name;
    document.getElementById('course-code-input').value = course.isPlaceholder ? '' : course.code;
    document.getElementById('course-type-select').value = course.isPlaceholder && !chooseElective ? 'placeholder' : 'course';
    document.getElementById('course-elective-type').value = course.electiveType || 'DEL';
    document.getElementById('course-category-select').value=courseCategory(course);
    document.querySelector('#course-type-select [value="placeholder"]').disabled = !!courseGrade(course);
    document.getElementById('course-sem-select').value = course.semesterId;
    document.getElementById('course-credits-input').value = course.credits ?? '';
    activeThemeColor = course.themeColor || 'indigo';
  } else {
    // New Course Mode
    document.getElementById('course-modal-title').innerText = 'Add Course';
    document.getElementById('btn-save-course-submit').innerText = 'Create Course';
    document.getElementById('course-edit-id').value = '';
    document.getElementById('course-type-select').value = 'course';
    document.getElementById('course-elective-type').value = 'DEL';
    document.getElementById('course-category-select').value='CDC';
    document.querySelector('#course-type-select [value="placeholder"]').disabled = false;
    document.getElementById('course-name-input').value = '';
    document.getElementById('course-code-input').value = '';
    document.getElementById('course-credits-input').value = '';
    document.getElementById('course-sem-select').value = state.semesters.find(semester=>semester.id===midsemDraft.semesterId)?.id || state.semesters.find(semester=>!semester.completed)?.id || state.semesters[0]?.id || '';
    activeThemeColor = 'indigo';
  }
  
  updateCourseFormMode();
  renderThemeSelectors();
  document.getElementById('modal-course-backdrop').classList.add('active');
}

function updateCourseFormMode() {
  const placeholder=document.getElementById('course-type-select').value==='placeholder';
  document.getElementById('course-placeholder-fields').hidden=!placeholder;
  document.getElementById('course-category-field').hidden=placeholder;
  if(placeholder)document.getElementById('course-category-select').value=document.getElementById('course-elective-type').value;
  for (const field of ['name','code']) {
    document.getElementById(`course-${field}-field`).hidden=placeholder;
    const input=document.getElementById(`course-${field}-input`);input.required=!placeholder;input.disabled=placeholder;
  }
  document.getElementById('course-elective-type').disabled=!placeholder;
  document.getElementById('course-credits-input').min=placeholder?'0.5':'0';
  const editing=!!document.getElementById('course-edit-id').value;
  document.getElementById('course-modal-title').textContent=placeholder ? (editing?'Edit elective placeholder':'Add elective placeholder') : (editing?'Edit course':'Add course');
  document.getElementById('btn-save-course-submit').textContent=editing ? 'Save changes' : placeholder ? 'Add placeholder' : 'Create Course';
}

function closeCourseModal() {
  document.getElementById('modal-course-backdrop').classList.remove('active');
}

function renderThemeSelectors() {
  const container = document.getElementById('theme-color-selector');
  container.innerHTML = '';
  
  Object.keys(ACCENT_COLORS).forEach(col => {
    const el = document.createElement('button');
    el.type = 'button';
    const colourName = {purple:'Clay', indigo:'Olive', blue:'Slate', emerald:'Moss', amber:'Ochre', rose:'Terracotta'}[col];
    el.setAttribute('aria-label', `${colourName} course colour`);
    el.setAttribute('aria-pressed', String(col === activeThemeColor));
    el.className = `theme-radio ${col === activeThemeColor ? 'selected' : ''}`;
    el.style.backgroundColor = ACCENT_COLORS[col];
    el.dataset.color = col;
    
    el.addEventListener('click', () => {
      document.querySelectorAll('.theme-radio').forEach(r => { r.classList.remove('selected'); r.setAttribute('aria-pressed', 'false'); });
      el.setAttribute('aria-pressed', 'true');
      el.classList.add('selected');
      activeThemeColor = col;
      document.getElementById('course-theme-input').value = col;
    });
    
    container.appendChild(el);
  });
}

// ================= HANDLERS AND EVENT ACTIONS =================
function handleAddSemester(e) {
  e.preventDefault();
  const nameInput = document.getElementById('sem-name-input');
  const name = nameInput.value.trim();
  
  if (name) {
    const newSem = {
      id: `sem-${Date.now()}`,
      name: name
    };
    state.semesters.push(newSem);
    saveStateToStorage();
    renderBoard();
    renderMetrics();
    updateGlobalFiltersSelect();
    closeSemesterModal();
    if (activeTab==='cgpa') renderCgpaCalculator();
  }
}

async function handleAddCourse(e) {
  e.preventDefault();
  const editId=document.getElementById('course-edit-id').value;
  const index=state.courses.findIndex(course=>course.id===editId);
  const existing=index>=0 ? state.courses[index] : null;
  try {
    persistPendingNotes();
    const record=buildCourseRecord({
      mode:document.getElementById('course-type-select').value,
      category:document.getElementById('course-category-select').value,
      electiveType:document.getElementById('course-elective-type').value,
      name:document.getElementById('course-name-input').value,
      code:document.getElementById('course-code-input').value,
      semesterId:document.getElementById('course-sem-select').value,
      credits:document.getElementById('course-credits-input').value,
      themeColor:activeThemeColor
    },existing,state.courses);
    if (index>=0) state.courses[index]=record;else state.courses.push(record);
    for (const semester of state.semesters) {
      if (![existing?.semesterId,record.semesterId].includes(semester.id)) continue;
      const courses=state.courses.filter(course=>course.semesterId===semester.id);
      semester.completed=courses.length>0 && courses.every(course=>!!courseGrade(course));
    }
    saveStateToStorage();closeCourseModal();
    await renderBoard();await renderMetrics();updateGlobalFiltersSelect();
    if (activeTab==='cgpa') renderCgpaCalculator();
    if (activeTab==='course-detail' && activeCourseId===record.id) await openCourseDetail(record.id);
    showToast(record.isPlaceholder ? 'Elective placeholder saved. Credits are planned only.' : 'Course saved.');
  } catch (error) {showToast(error.message,'error');}
}

async function confirmDeleteSemester(semId) {
  const coursesInSem = state.courses.filter(c => c.semesterId === semId);
  const message = coursesInSem.length > 0 
    ? `Warning: Deleting this semester will also delete all of its ${coursesInSem.length} courses and files. Continue?`
    : `Are you sure you want to delete this semester?`;
    
  if (confirm(message)) {
    try {
      for (const course of coursesInSem) {
        for (const file of await getFilesByCourse(course.id)) await deleteFile(file.id);
      }
    } catch (error) {showToast('Could not remove all files. The semester has been kept so you can try again.','error'); return;}

    state.courses = state.courses.filter(c => c.semesterId !== semId);
    state.semesters = state.semesters.filter(s => s.id !== semId);
    
    saveStateToStorage();
    renderBoard();
    renderMetrics();
    updateGlobalFiltersSelect();
  }
}

function confirmDeleteCourse(courseId) {
  const course = state.courses.find(c => c.id === courseId);
  if (!course) return;
  
  if (confirm(`Are you sure you want to delete course "${course.name}"? This deletes all notes and uploaded files.`)) {
    getFilesByCourse(courseId).then(async (files) => {
      for (const f of files) {
        await deleteFile(f.id);
      }
      
      state.courses = state.courses.filter(c => c.id !== courseId);
      saveStateToStorage();
      renderBoard();
      renderMetrics();
      updateGlobalFiltersSelect();
    }).catch(() => showToast('Could not delete the course. Please reconnect and try again.','error'));
  }
}

// Navigation switcher tabs (Sidebar links)
function handleNavigation(tab) {
  navigationRevision++;
  if(activeTab==='course-detail' && tab!=='course-detail'){persistPendingNotes();bookReader?.close();}
  activeTab = tab;
  document.body.classList.toggle('in-study-room',tab==='dashboard');
  document.body.classList.toggle('in-course-book',tab==='course-detail');
  closeWorkspaceNavigation();
  window.scrollTo({top: 0, behavior: 'instant'});
  document.getElementById('main-content').focus({preventScroll: true});
  document.getElementById('current-location').textContent = ({dashboard:'My study', materials:'My materials', calendar:'Calendar', todo:'Today’s tasks', attendance:'Attendance', cgpa:'Grades & CGPA', timetable:'Timetable', resources:'Useful links', settings:'Settings & backup', 'course-detail':'Course workspace'})[tab] || 'My study';
  document.getElementById('page-eyebrow').hidden = tab !== 'dashboard';
  document.querySelectorAll('.nav-item button').forEach(button => {
    if (button.id === `nav-${tab}` || (tab === 'course-detail' && button.id === 'nav-dashboard')) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  
  // Hide main header on course detail view
  const mainHeader = document.querySelector('.main-content > header');
  if (tab === 'course-detail') {
    if (mainHeader) mainHeader.style.display = 'none';
  } else {
    if (mainHeader) mainHeader.style.display = 'flex';
  }
  
  document.querySelectorAll('.nav-item').forEach(li => {
    if (li.id === `nav-${tab}-li`) {
      li.classList.add('active');
    } else {
      li.classList.remove('active');
    }
  });
  
  document.querySelectorAll('.view-panel').forEach(panel => {
    if (panel.id === `view-${tab}`) {
      panel.classList.add('active');
    } else {
      panel.classList.remove('active');
    }
  });
  
  const addSemBtn = document.getElementById('btn-add-semester');
  const addCourseBtn = document.getElementById('btn-add-course');
  const importBtn = document.getElementById('btn-import-performance');
  const pageTitle = document.getElementById('page-title');
  const pageSubtitle = document.getElementById('page-subtitle');
  
  if (!addSemBtn || !addCourseBtn) return; // safeguard
  
  if (tab === 'materials') {
    pageTitle.innerText = 'My materials';
    pageSubtitle.innerText = 'Access all course documents, files, and lectures in one place.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    renderMaterialsVault();
  } else if (tab === 'calendar') {
    pageTitle.innerText = 'Calendar';
    pageSubtitle.innerText = 'Manage your notes, dates, and study schedules.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    generateDays();
    renderCalendar();
  } else if (tab === 'todo') {
    pageTitle.innerText = "Today's Tasks";
    pageSubtitle.innerText = 'Manage your check-off list and day schedules.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    renderCalendar();
  } else if (tab === 'attendance') {
    pageTitle.innerText = 'Attendance';
    pageSubtitle.innerText = 'Attendance tracking and college Excel imports, saved here for later.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
  } else if (tab === 'cgpa') {
    pageTitle.innerText = 'Grades & CGPA';
    pageSubtitle.innerText = 'Your recorded grades, semester SGPA, and cumulative CGPA.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    renderCgpaCalculator();
  } else if (tab === 'timetable') {
    pageTitle.innerText = "Timetable";
    pageSubtitle.innerText = 'Design your weekly course schedules, prevent lecture clashes, and export timings.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    initTimetablePlanner();
  } else if (tab === 'resources') {
    pageTitle.innerText = "Useful links";
    pageSubtitle.innerText = 'A spreadsheet to store, organize, and edit reference links and descriptions.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    renderResourcesSpreadsheet();
  } else if (tab === 'settings') {
    pageTitle.innerText = "Settings & backup";
    pageSubtitle.innerText = 'Export, backup, and sync your dashboard data across multiple devices.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
  } else {
    pageTitle.innerText = 'Welcome to your study.';
    pageSubtitle.innerText = 'A place for everything you’re learning. And a little room to breathe.';
    addSemBtn.style.display = 'flex';
    addCourseBtn.style.display = 'flex';
    if (importBtn) importBtn.style.display = 'flex';
    renderBoard();
    renderMetrics();
  }
}

// ================= CALENDAR PLANNER MODULE =================
let calendarEventsList = JSON.parse(workspaceStorage.getItem('calendar_events_list') || '[]');
let calendarDays = [];

// Track active month and year state (default to current date)
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-indexed (Jan=0, Dec=11)

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June", 
  "July", "August", "September", "October", "November", "December"
];

// Helper to format Date object as YYYY-MM-DD local string
function formatDateString(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Helper to verify if a date is today
function checkIsToday(day, monthIndex, year) {
  const today = new Date();
  return today.getDate() === day && today.getMonth() === monthIndex && today.getFullYear() === year;
}

// Helper to generate dynamic days range for the selected month (6 rows standard grid = 42 cells)
function generateDays() {
  calendarDays = []; // reset
  
  // First day of selected month
  const firstDay = new Date(currentYear, currentMonth, 1);
  // Last day of selected month
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  
  // Start on Monday. Let's check what weekday the 1st day falls on:
  let startOffset = firstDay.getDay(); // 0 is Sunday, 1 is Monday...
  // Map Sun=6, Mon=0, Tue=1, Wed=2, Thu=3, Fri=4, Sat=5
  startOffset = startOffset === 0 ? 6 : startOffset - 1;
  
  // Leading inactive days from previous month
  const prevMonthLast = new Date(currentYear, currentMonth, 0);
  const prevLastDate = prevMonthLast.getDate();
  for (let i = startOffset - 1; i >= 0; i--) {
    const date = new Date(currentYear, currentMonth - 1, prevLastDate - i);
    calendarDays.push({
      dayNumber: date.getDate(),
      monthName: date.toLocaleDateString('en-US', { month: 'long' }),
      year: date.getFullYear(),
      dateString: formatDateString(date),
      isActive: false,
      isToday: false
    });
  }
  
  // Active days of the month
  const totalDays = lastDay.getDate();
  for (let i = 1; i <= totalDays; i++) {
    const date = new Date(currentYear, currentMonth, i);
    calendarDays.push({
      dayNumber: i,
      monthName: MONTH_NAMES[currentMonth],
      year: currentYear,
      dateString: formatDateString(date),
      isActive: true,
      isToday: checkIsToday(i, currentMonth, currentYear)
    });
  }
  
  // Trailing inactive days from next month to pad exactly to 42 cells
  const remaining = 42 - calendarDays.length;
  for (let i = 1; i <= remaining; i++) {
    const date = new Date(currentYear, currentMonth + 1, i);
    calendarDays.push({
      dayNumber: i,
      monthName: date.toLocaleDateString('en-US', { month: 'long' }),
      year: date.getFullYear(),
      dateString: formatDateString(date),
      isActive: false,
      isToday: false
    });
  }
}

// 12-hour AM/PM time formatter
function formatTime12(timeStr) {
  if (!timeStr) return '';
  const [hours, minutes] = timeStr.split(':');
  const h = parseInt(hours);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const formattedH = h % 12 || 12;
  return `${formattedH}:${minutes} ${ampm}`;
}

// Toggle task completed state for a date
function toggleTaskCompleted(eventId, dateString) {
  calendarEventsList = calendarEventsList.map(evt => {
    if (evt.id === eventId) {
      if (!evt.completedDates) evt.completedDates = [];
      if (evt.completedDates.includes(dateString)) {
        evt.completedDates = evt.completedDates.filter(d => d !== dateString);
      } else {
        evt.completedDates.push(dateString);
      }
    }
    return evt;
  });
  workspaceStorage.setItem('calendar_events_list', JSON.stringify(calendarEventsList));
  renderCalendar();
}

// Render Sidebar & Page Checklist Widgets
function renderTodayChecklists(todayStr) {
  const pendingList = document.getElementById('today-pending-list');
  const doneList = document.getElementById('today-done-list');
  const pagePendingList = document.getElementById('todo-page-pending-list');
  const pageDoneList = document.getElementById('todo-page-done-list');
  
  if (pendingList) pendingList.innerHTML = '';
  if (doneList) doneList.innerHTML = '';
  if (pagePendingList) pagePendingList.innerHTML = '';
  if (pageDoneList) pageDoneList.innerHTML = '';
  
  // Filter events scheduled for today
  const todayEvents = calendarEventsList.filter(evt => {
    if (todayStr < evt.startDate || todayStr > evt.endDate) return false;
    if (evt.exdates && evt.exdates.includes(todayStr)) return false;
    
    const cellDate = new Date(todayStr + 'T00:00:00');
    const start = new Date(evt.startDate + 'T00:00:00');
    
    if (!evt.repeat || evt.repeat === 'none') return true;
    if (evt.repeat === 'daily') return true;
    if (evt.repeat === 'weekly') return cellDate.getDay() === start.getDay();
    if (evt.repeat === 'yearly') return cellDate.getMonth() === start.getMonth() && cellDate.getDate() === start.getDate();
    return false;
  });
  
  const pendingToday = todayEvents.filter(evt => !evt.completedDates || !evt.completedDates.includes(todayStr));
  const doneToday = todayEvents.filter(evt => evt.completedDates && evt.completedDates.includes(todayStr));
  
  // Render Sidebar
  if (pendingList && doneList) {
    if (pendingToday.length === 0) {
      pendingList.innerHTML = '<li style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; padding: 0.25rem 0;">No tasks for today</li>';
    } else {
      pendingToday.forEach(evt => {
        const li = document.createElement('li');
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = false;
        checkbox.addEventListener('change', () => {
          toggleTaskCompleted(evt.id, todayStr);
        });
        li.appendChild(checkbox);
        
        const dot = document.createElement('span');
        dot.classList.add('pointer-dot', `dot-${evt.tag}`);
        dot.style.width = '8px';
        dot.style.height = '8px';
        li.appendChild(dot);
        
        const textSpan = document.createElement('span');
        textSpan.textContent = evt.title;
        textSpan.style.cursor = 'pointer';
        textSpan.addEventListener('click', () => {
          const todayDay = { dateString: todayStr };
          openCalendarEventModal(todayDay, evt);
        });
        li.appendChild(textSpan);
        
        pendingList.appendChild(li);
      });
    }
    
    if (doneToday.length === 0) {
      doneList.innerHTML = '<li style="font-size: 0.8rem; color: var(--text-muted); font-style: italic; padding: 0.25rem 0;">No completed tasks</li>';
    } else {
      doneToday.forEach(evt => {
        const li = document.createElement('li');
        li.style.opacity = '0.5';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.addEventListener('change', () => {
          toggleTaskCompleted(evt.id, todayStr);
        });
        li.appendChild(checkbox);
        
        const textSpan = document.createElement('span');
        textSpan.textContent = evt.title;
        textSpan.style.textDecoration = 'line-through';
        textSpan.style.cursor = 'pointer';
        textSpan.addEventListener('click', () => {
          const todayDay = { dateString: todayStr };
          openCalendarEventModal(todayDay, evt);
        });
        li.appendChild(textSpan);
        
        doneList.appendChild(li);
      });
    }
  }
  
  // Render Full Page Tab Checklists
  if (pagePendingList && pageDoneList) {
    if (pendingToday.length === 0) {
      pagePendingList.innerHTML = '<li style="font-size: 0.95rem; color: var(--text-secondary); font-style: italic; padding: 1.5rem 0; text-align: center;">No pending tasks for today! Keep it up.</li>';
    } else {
      pendingToday.forEach(evt => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.justifyContent = 'space-between';
        li.style.padding = '0.8rem 1rem';
        li.style.background = 'rgba(255,255,255,0.02)';
        li.style.border = '1px solid var(--border-color)';
        li.style.borderRadius = '10px';
        li.style.transition = 'var(--transition-fast)';
        
        // Hover highlight
        li.addEventListener('mouseenter', () => {
          li.style.borderColor = 'var(--color-accent)';
          li.style.background = 'rgba(var(--color-accent-rgb), 0.04)';
        });
        li.addEventListener('mouseleave', () => {
          li.style.borderColor = 'var(--border-color)';
          li.style.background = 'rgba(255,255,255,0.02)';
        });
        
        const leftDiv = document.createElement('div');
        leftDiv.style.display = 'flex';
        leftDiv.style.alignItems = 'center';
        leftDiv.style.gap = '0.75rem';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = false;
        checkbox.style.width = '18px';
        checkbox.style.height = '18px';
        checkbox.style.cursor = 'pointer';
        checkbox.addEventListener('change', () => {
          toggleTaskCompleted(evt.id, todayStr);
        });
        leftDiv.appendChild(checkbox);
        
        const dot = document.createElement('span');
        dot.classList.add('pointer-dot', `dot-${evt.tag}`);
        dot.style.width = '10px';
        dot.style.height = '10px';
        leftDiv.appendChild(dot);
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = evt.title;
        titleSpan.style.fontWeight = '500';
        titleSpan.style.fontSize = '0.95rem';
        titleSpan.style.color = 'var(--text-primary)';
        leftDiv.appendChild(titleSpan);
        
        li.appendChild(leftDiv);
        
        // Right side info (time/date)
        const rightDiv = document.createElement('div');
        rightDiv.style.display = 'flex';
        rightDiv.style.alignItems = 'center';
        rightDiv.style.gap = '0.75rem';
        
        if (evt.time) {
          const timeBadge = document.createElement('span');
          timeBadge.style.fontSize = '0.8rem';
          timeBadge.style.color = 'var(--color-accent)';
          timeBadge.style.background = 'rgba(var(--color-accent-rgb), 0.1)';
          timeBadge.style.padding = '0.2rem 0.5rem';
          timeBadge.style.borderRadius = '4px';
          timeBadge.textContent = formatTime12(evt.time);
          rightDiv.appendChild(timeBadge);
        }
        
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-secondary btn-sm';
        editBtn.style.padding = '0.3rem 0.6rem';
        editBtn.style.fontSize = '0.75rem';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => {
          const todayDay = { dateString: todayStr };
          openCalendarEventModal(todayDay, evt);
        });
        rightDiv.appendChild(editBtn);
        
        li.appendChild(rightDiv);
        pagePendingList.appendChild(li);
      });
    }
    
    if (doneToday.length === 0) {
      pageDoneList.innerHTML = '<li style="font-size: 0.9rem; color: var(--text-muted); font-style: italic; padding: 1.5rem 0; text-align: center;">No completed tasks yet.</li>';
    } else {
      doneToday.forEach(evt => {
        const li = document.createElement('li');
        li.style.display = 'flex';
        li.style.alignItems = 'center';
        li.style.justifyContent = 'space-between';
        li.style.padding = '0.6rem 1rem';
        li.style.background = 'rgba(255,255,255,0.01)';
        li.style.border = '1px solid var(--border-color)';
        li.style.borderRadius = '10px';
        li.style.opacity = '0.6';
        
        const leftDiv = document.createElement('div');
        leftDiv.style.display = 'flex';
        leftDiv.style.alignItems = 'center';
        leftDiv.style.gap = '0.75rem';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.style.width = '16px';
        checkbox.style.height = '16px';
        checkbox.style.cursor = 'pointer';
        checkbox.addEventListener('change', () => {
          toggleTaskCompleted(evt.id, todayStr);
        });
        leftDiv.appendChild(checkbox);
        
        const titleSpan = document.createElement('span');
        titleSpan.textContent = evt.title;
        titleSpan.style.textDecoration = 'line-through';
        titleSpan.style.fontSize = '0.9rem';
        titleSpan.style.color = 'var(--text-secondary)';
        leftDiv.appendChild(titleSpan);
        
        li.appendChild(leftDiv);
        
        const editBtn = document.createElement('button');
        editBtn.className = 'btn btn-secondary btn-sm';
        editBtn.style.padding = '0.2rem 0.5rem';
        editBtn.style.fontSize = '0.7rem';
        editBtn.textContent = 'Edit';
        editBtn.addEventListener('click', () => {
          const todayDay = { dateString: todayStr };
          openCalendarEventModal(todayDay, evt);
        });
        li.appendChild(editBtn);
        
        pageDoneList.appendChild(li);
      });
    }
  }
}

// Render Calendar Grid Layout and Sidebar components
function renderCalendar() {
  const calendarGrid = document.getElementById('calendar-grid');
  const totalEventsCount = document.getElementById('total-events-count');
  if (!calendarGrid || !totalEventsCount) return;
  
  calendarGrid.innerHTML = '';
  let totalCount = 0;

  // Set Title header
  document.getElementById('calendar-title').textContent = `${MONTH_NAMES[currentMonth]} ${currentYear}`;

  // Update footer info range
  document.getElementById('footer-start-display').textContent = `Starts: ${MONTH_NAMES[currentMonth]} 1, ${currentYear}`;
  document.getElementById('footer-end-display').textContent = `Ends: ${MONTH_NAMES[currentMonth]} ${calendarDays.filter(d => d.isActive).length}, ${currentYear}`;

  // Apply accent theme from localStorage
  const savedAccent = workspaceStorage.getItem('calendar_accent') || 'indigo';
  setCalendarAccent(savedAccent);
  renderSidebarTagLabels();

  calendarDays.forEach(day => {
    const dayCell = document.createElement('div');
    dayCell.classList.add('calendar-day-cell');
    
    if (!day.isActive) dayCell.classList.add('inactive');
    if (day.isToday) dayCell.classList.add('today');

    // Cell Header (Number & D-Day Countdown)
    const cellHeader = document.createElement('div');
    cellHeader.classList.add('day-cell-header');

    const numLabel = document.createElement('span');
    numLabel.classList.add('day-number-label');

    const isFirstActiveDay = day.isActive && !calendarDays.slice(0, calendarDays.indexOf(day)).some(d => d.isActive);
    const isFirstOfMonth = day.dayNumber === 1;

    if (isFirstActiveDay || isFirstOfMonth) {
      numLabel.textContent = `${day.monthName.substring(0, 3)} ${day.dayNumber}`;
    } else {
      numLabel.textContent = day.dayNumber;
    }
    cellHeader.appendChild(numLabel);

    // Optional D-Day Countdown
    const dDayEnabled = workspaceStorage.getItem('calendar_dday_enabled') === 'true';
    const dDayStr = workspaceStorage.getItem('calendar_dday_date');

    if (day.isActive && dDayEnabled && dDayStr) {
      const currentDate = new Date(day.dateString + 'T00:00:00');
      const dDayDate = new Date(dDayStr + 'T00:00:00');
      const diffTime = dDayDate - currentDate;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      const countdownLabel = document.createElement('span');
      countdownLabel.classList.add('days-to-go-label');

      if (diffDays > 0) {
        countdownLabel.textContent = `${diffDays}d to go`;
        cellHeader.appendChild(countdownLabel);
      } else if (diffDays === 0) {
        countdownLabel.textContent = 'D-Day';
        countdownLabel.classList.add('d-day');
        cellHeader.appendChild(countdownLabel);
      }
    }
    dayCell.appendChild(cellHeader);

    // Day events list column
    const eventsListContainer = document.createElement('div');
    eventsListContainer.classList.add('day-events-list');

    // Filter events: check dates, repeat patterns, exclusions, and checklist completions
    const dayEvents = calendarEventsList.filter(evt => {
      // Must fall in range
      if (day.dateString < evt.startDate || day.dateString > evt.endDate) return false;
      
      // Excluded instance dates
      if (evt.exdates && evt.exdates.includes(day.dateString)) return false;
      
      // Completed checklist instance dates (checked tasks disappear!)
      if (evt.completedDates && evt.completedDates.includes(day.dateString)) return false;
      
      const cellDate = new Date(day.dateString + 'T00:00:00');
      const start = new Date(evt.startDate + 'T00:00:00');
      
      if (!evt.repeat || evt.repeat === 'none') return true;
      if (evt.repeat === 'daily') return true;
      if (evt.repeat === 'weekly') return cellDate.getDay() === start.getDay();
      if (evt.repeat === 'yearly') return cellDate.getMonth() === start.getMonth() && cellDate.getDate() === start.getDate();
      return false;
    });

    dayEvents.forEach(event => {
      totalCount++;

      const pointer = document.createElement('div');
      pointer.classList.add('event-pointer');
      
      const labels = getCustomTagLabels();
      const tagLabel = labels[event.tag] || (event.tag.charAt(0).toUpperCase() + event.tag.slice(1));
      pointer.title = `${event.title} [${tagLabel}]${event.desc ? '\n' + event.desc : ''}`;

      // Each calendar event has its own accessible completion control.
      const checkBtn = document.createElement('button');
      checkBtn.type = 'button';
      checkBtn.className = 'event-pointer-check';
      checkBtn.setAttribute('aria-label', `Complete ${event.title}`);
      checkBtn.style.borderColor = `var(--color-${event.tag === 'warm' ? 'amber' : event.tag})`;
      checkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTaskCompleted(event.id, day.dateString);
      });
      pointer.appendChild(checkBtn);

      const contentSpan = document.createElement('span');
      contentSpan.classList.add('pointer-content');

      if (event.time) {
        const timeSpan = document.createElement('span');
        timeSpan.classList.add('pointer-time');
        timeSpan.textContent = formatTime12(event.time) + ' ';
        contentSpan.appendChild(timeSpan);
      }

      const titleSpan = document.createElement('span');
      titleSpan.classList.add('pointer-title');
      titleSpan.textContent = event.title;
      contentSpan.appendChild(titleSpan);

      pointer.appendChild(contentSpan);

      pointer.addEventListener('click', (e) => {
        e.stopPropagation();
        openCalendarEventModal(day, event);
      });

      eventsListContainer.appendChild(pointer);
    });

    dayCell.appendChild(eventsListContainer);

    dayCell.addEventListener('click', () => {
      openCalendarEventModal(day);
    });

    calendarGrid.appendChild(dayCell);
  });

  // Render Sidebar General Notes List
  renderSidebarNotes();

  // Render Today's tasks checklists
  renderTodayChecklists(formatDateString(new Date()));

  // Update total counts
  totalEventsCount.textContent = totalCount;
}

function renderSidebarNotes() {
  const list = document.getElementById('sidebar-notes-list');
  if (!list) return;
  list.innerHTML = '';
  
  const notes = JSON.parse(workspaceStorage.getItem('calendar_general_notes')) || [];
  notes.forEach((note, index) => {
    const li = document.createElement('li');
    li.classList.add('note-item');
    
    const textSpan = document.createElement('span');
    textSpan.classList.add('note-text');
    textSpan.textContent = note;
    li.appendChild(textSpan);
    
    const deleteBtn = document.createElement('button');
    deleteBtn.classList.add('note-delete-btn');
    deleteBtn.innerHTML = '&times;';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteGeneralNote(index);
    });
    li.appendChild(deleteBtn);
    
    list.appendChild(li);
  });
}

function addGeneralNote(text) {
  const trimmed = text.trim();
  if (!trimmed) return;
  const notes = JSON.parse(workspaceStorage.getItem('calendar_general_notes')) || [];
  notes.push(trimmed);
  workspaceStorage.setItem('calendar_general_notes', JSON.stringify(notes));
  renderSidebarNotes();
}

function deleteGeneralNote(index) {
  const notes = JSON.parse(workspaceStorage.getItem('calendar_general_notes')) || [];
  notes.splice(index, 1);
  workspaceStorage.setItem('calendar_general_notes', JSON.stringify(notes));
  renderSidebarNotes();
}

// Shifting theme styles
function setCalendarAccent(color) {
  workspaceStorage.setItem('calendar_accent',color);
  const workspace = document.querySelector('.calendar-layout-workspace');
  if (!workspace) return;
  
  workspace.className = 'calendar-layout-workspace';
  workspace.classList.add(`accent-${color}`);
}

function getCustomTagLabels() {
  return JSON.parse(workspaceStorage.getItem('calendar_tag_labels') || '{}');
}

function renderSidebarTagLabels() {
  const labels = getCustomTagLabels();
  const inputs = document.querySelectorAll('.tag-label-input');
  inputs.forEach(input => {
    const col = input.getAttribute('data-color');
    input.value = labels[col] || '';
  });
}

function renderModalTagSelector(selectedTag = 'blue') {
  const container = document.getElementById('modal-tag-selector');
  if (!container) return;
  container.innerHTML = '';
  
  const labels = getCustomTagLabels();
  const colors = ['blue', 'purple', 'warm', 'green', 'rose'];
  
  colors.forEach(col => {
    const labelText = labels[col] || (col.charAt(0).toUpperCase() + col.slice(1));
    
    const labelEl = document.createElement('label');
    labelEl.style.display = 'flex';
    labelEl.style.alignItems = 'center';
    labelEl.style.gap = '0.5rem';
    labelEl.style.padding = '0.5rem 0.75rem';
    labelEl.style.background = 'rgba(255,255,255,0.02)';
    labelEl.style.border = '1px solid var(--border-color)';
    labelEl.style.borderRadius = '8px';
    labelEl.style.cursor = 'pointer';
    labelEl.style.transition = 'var(--transition-fast)';
    labelEl.style.fontSize = '0.85rem';
    
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'event-tag';
    radio.value = col;
    if (col === selectedTag) {
      radio.checked = true;
      labelEl.style.borderColor = 'var(--color-accent)';
      labelEl.style.background = 'rgba(var(--color-accent-rgb), 0.08)';
    }
    
    radio.addEventListener('change', () => {
      document.querySelectorAll('#modal-tag-selector label').forEach(lbl => {
        lbl.style.borderColor = 'var(--border-color)';
        lbl.style.background = 'rgba(255,255,255,0.02)';
      });
      labelEl.style.borderColor = 'var(--color-accent)';
      labelEl.style.background = 'rgba(var(--color-accent-rgb), 0.08)';
    });
    
    labelEl.appendChild(radio);
    
    const dot = document.createElement('span');
    dot.classList.add('pointer-dot', `dot-${col}`);
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    labelEl.appendChild(dot);
    
    const text = document.createElement('span');
    text.textContent = labelText;
    labelEl.appendChild(text);
    
    container.appendChild(labelEl);
  });
}

// Modal open/close controls
function openCalendarEventModal(day, eventToEdit = null) {
  const modal = document.getElementById('event-modal');
  if (!modal) return;
  
  modal.classList.add('active');
  
  const startInput = document.getElementById('event-start-date');
  const endInput = document.getElementById('event-end-date');
  const deleteBtn = document.getElementById('delete-event-btn');
  const deleteInstanceBtn = document.getElementById('delete-instance-btn');
  const repeatSelect = document.getElementById('event-repeat');
  
  // Track active clicked date
  document.getElementById('event-clicked-date').value = day.dateString;

  if (eventToEdit) {
    document.getElementById('modal-title').textContent = "Edit Event / Task";
    document.getElementById('event-id').value = eventToEdit.id;
    document.getElementById('event-title').value = eventToEdit.title;
    document.getElementById('event-desc').value = eventToEdit.desc || '';
    document.getElementById('event-time').value = eventToEdit.time || '';
    startInput.value = eventToEdit.startDate;
    endInput.value = eventToEdit.endDate;
    if (repeatSelect) repeatSelect.value = eventToEdit.repeat || 'none';
    
    renderModalTagSelector(eventToEdit.tag);

    // Show single day delete option for repeating series
    const isRepeating = eventToEdit.repeat && eventToEdit.repeat !== 'none';
    if (isRepeating) {
      deleteInstanceBtn.style.display = 'block';
      deleteBtn.textContent = "Delete Series";
    } else {
      deleteInstanceBtn.style.display = 'none';
      deleteBtn.textContent = "Delete Task";
    }
    deleteBtn.style.display = 'block';
  } else {
    document.getElementById('modal-title').textContent = "Add Event / Task";
    document.getElementById('event-id').value = '';
    document.getElementById('event-form').reset();
    
    startInput.value = day.dateString;
    endInput.value = day.dateString;
    if (repeatSelect) repeatSelect.value = 'none';
    renderModalTagSelector('blue');
    
    deleteBtn.style.display = 'none';
    deleteInstanceBtn.style.display = 'none';
  }
  document.getElementById('event-title').focus();
}

function closeCalendarEventModal() {
  const modal = document.getElementById('event-modal');
  if (modal) modal.classList.remove('active');
}

function changeMonth(offset) {
  currentMonth += offset;
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  } else if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
  generateDays();
  renderCalendar();
}

// ================= HELPERS =================
function hexToRgb(hex) {
  if (!hex) return '99, 102, 241';
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function getFileIconName(type) {
  switch (type) {
    case 'slides': case 'tutorials': return 'presentation';
    case 'notes': return 'file-edit';
    case 'papers': return 'scroll';
    case 'handouts': return 'info';
    default: return 'file';
  }
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// ================= APP INITIALIZATION =================
window.addEventListener('DOMContentLoaded', async () => {
  // Check auth session
  await initAuth();
  
  loadStateFromStorage();
  calendarEventsList = JSON.parse(workspaceStorage.getItem('calendar_events_list') || '[]');
  
  try {
    await initDB();
    // Existing browser files are preserved for explicit migration into an account.
  } catch (err) {
    console.error("Database initialization failed", err);
  }
  
  await renderBoard();
  await renderMetrics();
  initializeWorkspaceInterface();
  initializeStudyRoom();
  updateGlobalFiltersSelect();
  
  // Navigation sidebar events
  document.getElementById('nav-dashboard').addEventListener('click', () => handleNavigation('dashboard'));
  document.getElementById('nav-materials').addEventListener('click', () => handleNavigation('materials'));
  document.getElementById('nav-calendar').addEventListener('click', () => handleNavigation('calendar'));
  document.getElementById('nav-todo').addEventListener('click', () => handleNavigation('todo'));
  document.getElementById('nav-attendance').addEventListener('click', () => handleNavigation('attendance'));
  document.getElementById('nav-cgpa').addEventListener('click', () => handleNavigation('cgpa'));
  document.getElementById('nav-timetable').addEventListener('click', () => handleNavigation('timetable'));
  document.getElementById('nav-resources').addEventListener('click', () => handleNavigation('resources'));
  document.getElementById('nav-settings').addEventListener('click', () => handleNavigation('settings'));
  
  // Resources setup events
  const btnAddResource = document.getElementById('btn-add-resource');
  if (btnAddResource) {
    btnAddResource.addEventListener('click', handleAddResourceRow);
  }
  
  // Settings & Sync events
  const btnExport = document.getElementById('btn-export-backup');
  if (btnExport) btnExport.addEventListener('click', handleExportBackup);
  
  const btnCopyCode = document.getElementById('btn-copy-sync-code');
  if (btnCopyCode) btnCopyCode.addEventListener('click', handleCopySyncCode);
  
  const btnTriggerImport = document.getElementById('btn-trigger-import');
  const inputImportFile = document.getElementById('input-import-file');
  if (btnTriggerImport && inputImportFile) {
    btnTriggerImport.addEventListener('click', () => inputImportFile.click());
    inputImportFile.addEventListener('change', handleImportFileChange);
  }
  
  const btnSubmitSync = document.getElementById('btn-submit-sync-code');
  if (btnSubmitSync) btnSubmitSync.addEventListener('click', handleImportSyncCode);
  
  document.getElementById('btn-sync-now').addEventListener('click', async () => {
    try {
      persistPendingNotes();
      await backend.flush();
      await backend.reloadCloud();
      await refreshWorkspaceViews();
    } catch (error) {showToast(error.message || 'Could not sync. Your local changes are safe.','error');}
  });
  document.getElementById('btn-reload-cloud').addEventListener('click', async () => {
    if (!confirm('Load the cloud version? Download a backup first if you want to keep changes made on this device.')) return;
    try {await backend.reloadCloud(); await refreshWorkspaceViews();}
    catch (error) {showToast('Could not load the cloud version. Please try again.','error');}
  });
  document.getElementById('btn-migrate-local').addEventListener('click', importBrowserWorkspace);
  document.getElementById('btn-retry-file-import').addEventListener('click', importBrowserWorkspace);
  document.getElementById('btn-continue-local').addEventListener('click', () => {
    if (authRequestPending) return;
    sessionStorage.setItem('univault-guest','true');
    window.location.reload();
  });
  window.addEventListener('online', () => {if (backend.signedIn) backend.flush().catch(() => {});});
  window.addEventListener('beforeunload', event => {
    persistPendingNotes();
    if (backend.hasPendingChanges) {event.preventDefault(); event.returnValue = '';}
  });
  if (backendClient) backendClient.auth.onAuthStateChange(event => {
    // Schedule outside the SDK callback to avoid locking the auth client.
    if (event === 'SIGNED_OUT' && backend.user) setTimeout(() => window.location.reload(),0);
  });

  // Timetable setup & action events
  const btnSubmitDegree = document.getElementById('btn-submit-timetable-degree');
  if (btnSubmitDegree) {
    btnSubmitDegree.addEventListener('click', handleTimetableDegreeSubmit);
  }
  
  const btnResetTimetable = document.getElementById('btn-reset-timetable');
  if (btnResetTimetable) {
    btnResetTimetable.addEventListener('click', handleTimetableReset);
  }
  
  const btnFreezeTimetable = document.getElementById('btn-freeze-timetable');
  if (btnFreezeTimetable) {
    btnFreezeTimetable.addEventListener('click', handleTimetableFreezeToggle);
  }

  // Course live search listener
  const searchInput = document.getElementById('timetable-course-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const degree = workspaceStorage.getItem('timetable_degree');
      if (degree) renderTimetableWorkspace(degree);
    });
  }

  // Export iCal (.ics) listener
  const btnExportICS = document.getElementById('btn-export-ics');
  if (btnExportICS) {
    btnExportICS.addEventListener('click', exportTimetableToICS);
  }

  // Print / Save Image listener
  const btnExportPNG = document.getElementById('btn-export-png');
  if (btnExportPNG) {
    btnExportPNG.addEventListener('click', () => {
      window.print();
    });
  }

  // Custom Course Modal handlers
  const btnAddCustom = document.getElementById('btn-add-custom-course');
  const modalAddCourse = document.getElementById('modal-add-course-backdrop');
  const btnCloseAddCourse = document.getElementById('btn-close-add-course');
  const btnCancelAddCourse = document.getElementById('btn-cancel-add-course');
  const formAddCourse = document.getElementById('form-add-custom-course');

  if (btnAddCustom && modalAddCourse) {
    btnAddCustom.addEventListener('click', () => {
      modalAddCourse.classList.add('active');
    });
  }
  if (btnCloseAddCourse && modalAddCourse) {
    btnCloseAddCourse.addEventListener('click', () => {
      modalAddCourse.classList.remove('active');
    });
  }
  if (btnCancelAddCourse && modalAddCourse) {
    btnCancelAddCourse.addEventListener('click', () => {
      modalAddCourse.classList.remove('active');
    });
  }
  if (formAddCourse) {
    formAddCourse.addEventListener('submit', handleAddCustomCourseSubmit);
  }
  
  // Timetable PDF import events
  const btnImportTimetable = document.getElementById('btn-import-timetable');
  const btnImportHeader = document.getElementById('btn-import-pdf-header');
  const fileInputTimetable = document.getElementById('timetable-pdf-file-input');
  
  if (fileInputTimetable) {
    if (btnImportTimetable) {
      btnImportTimetable.addEventListener('click', () => fileInputTimetable.click());
    }
    if (btnImportHeader) {
      btnImportHeader.addEventListener('click', () => fileInputTimetable.click());
    }
    
    fileInputTimetable.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const originalText = btnImportTimetable.innerHTML;
      btnImportTimetable.disabled = true;
      btnImportTimetable.innerHTML = `⏳ Reading PDF...`;
      
      try {
        const parsedCourses = await parseTimetablePDFFile(file);
        
        if (parsedCourses.length > 0) {
          workspaceStorage.setItem('custom_timetable_courses', JSON.stringify(parsedCourses));
          workspaceStorage.setItem('timetable_degree', 'custom');
          // Clear any old selections to prevent crashes
          workspaceStorage.removeItem('timetable_selected_sections');
          
          initTimetablePlanner();
          showToast(`Successfully imported ${parsedCourses.length} custom courses from BITS Timetable!`, 'success');
        } else {
          showToast("Could not find any courses in BITS Timetable format.", "error");
        }
      } catch (err) {
        console.error("Timetable PDF Parsing failed:", err);
        showToast("Failed to parse Timetable PDF. Ensure it is a BITS PDF format.", "error");
      } finally {
        btnImportTimetable.disabled = false;
        btnImportTimetable.innerHTML = originalText;
        fileInputTimetable.value = '';
      }
    });
  }
  
  // Today's Tasks full page Add Task button
  document.getElementById('btn-todo-page-add').addEventListener('click', () => {
    const today = new Date();
    const todayDay = {
      dateString: formatDateString(today)
    };
    openCalendarEventModal(todayDay);
  });
  
  // Top Buttons
  document.getElementById('btn-add-semester').addEventListener('click', openSemesterModal);
  document.getElementById('btn-add-course').addEventListener('click', () => openCourseModal());
  
  // Clear All Dashboard Button
  const btnClearAll = document.getElementById('btn-clear-all-dashboard');
  if (btnClearAll) {
    btnClearAll.addEventListener('click', () => {
      if (confirm("Are you sure you want to clear all semesters and courses? This will delete all of them permanently!")) {
        state.semesters = [];
        state.courses = [];
        saveStateToStorage();
        renderBoard();
        renderMetrics();
        updateGlobalFiltersSelect();
        showToast("Cleared all semesters and courses!", "success");
      }
    });
  }
  
  // Add Semester Modal
  document.getElementById('modal-semester-close').addEventListener('click', closeSemesterModal);
  document.getElementById('btn-cancel-semester').addEventListener('click', closeSemesterModal);
  document.getElementById('form-add-semester').addEventListener('submit', handleAddSemester);
  
  // Add Course Modal
  document.getElementById('modal-course-close').addEventListener('click', closeCourseModal);
  document.getElementById('btn-cancel-course').addEventListener('click', closeCourseModal);
  document.getElementById('form-add-course').addEventListener('submit', handleAddCourse);
  document.getElementById('course-type-select').addEventListener('change', updateCourseFormMode);
  document.getElementById('course-elective-type').addEventListener('change', updateCourseFormMode);
  document.getElementById('btn-add-elective').addEventListener('click',()=>{
    if (!state.semesters.length) {showToast('Add a semester first, then add elective placeholders.');openSemesterModal();return;}
    openCourseModal();document.getElementById('course-type-select').value='placeholder';updateCourseFormMode();
  });
  document.getElementById('btn-choose-elective').addEventListener('click',()=>openCourseModal(activeCourseId,true));
  document.getElementById('midsem-semester').addEventListener('change',event=>{midsemDraft={semesterId:event.target.value,grades:{}};renderMidsemEstimate();});
  document.getElementById('midsem-reset').addEventListener('click',()=>{midsemDraft.grades={};renderMidsemEstimate();});
  
  // Detailed Course View Panel Events
  document.getElementById('btn-back-to-dashboard').addEventListener('click', async () => {const revision=navigationRevision;await bookReader?.closeAnimated();if(revision===navigationRevision)handleNavigation('dashboard');});
  
  // Textarea notepad event
  document.getElementById('detail-notes-textarea').addEventListener('input', handleNotesInput);
  
  // Requirements additions
  document.getElementById('detail-btn-add-req').addEventListener('click', addChecklistItem);
  document.getElementById('detail-new-req-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addChecklistItem();
  });
  
  // Preview Modal events
  document.getElementById('modal-preview-close').addEventListener('click', closePreviewModal);
  document.getElementById('btn-close-preview').addEventListener('click', closePreviewModal);
  
  // Global Materials filters
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMaterialsVault();
    });
  });
  
  document.getElementById('filter-course-select').addEventListener('change', renderMaterialsVault);
  document.getElementById('search-materials-input').addEventListener('input', renderMaterialsVault);
  
  // ================= CALENDAR MODULE EVENT BINDINGS =================
  // Month Switchers
  document.getElementById('btn-prev-month').addEventListener('click', () => changeMonth(-1));
  document.getElementById('btn-next-month').addEventListener('click', () => changeMonth(1));
  // Sidebar + Add New Task Button
  document.getElementById('btn-sidebar-add-task').addEventListener('click', () => {
    const today = new Date();
    const todayDay = {
      dateString: formatDateString(today)
    };
    openCalendarEventModal(todayDay);
  });


  // Sidebar Tag Label inputs live update
  document.querySelectorAll('.tag-label-input').forEach(input => {
    input.addEventListener('input', (e) => {
      const col = e.target.getAttribute('data-color');
      const val = e.target.value;
      
      const labels = getCustomTagLabels();
      labels[col] = val;
      workspaceStorage.setItem('calendar_tag_labels', JSON.stringify(labels));
      
      // Re-render calendar while preserving input field focus
      const activeColor = document.activeElement ? document.activeElement.getAttribute('data-color') : null;
      renderCalendar();
      if (activeColor) {
        const inputToFocus = document.querySelector(`.tag-label-input[data-color="${activeColor}"]`);
        if (inputToFocus) {
          inputToFocus.focus();
          // Restore text cursor to end of input
          const len = inputToFocus.value.length;
          inputToFocus.setSelectionRange(len, len);
        }
      }
    });
  });

  // Optional D-Day Countdown inputs in sidebar
  const sidebarDDayEnabled = document.getElementById('sidebar-dday-enabled');
  const sidebarDDayDate = document.getElementById('sidebar-dday-date');
  const sidebarDDayDateGroup = document.getElementById('sidebar-dday-date-group');
  
  // Set initial settings values in inputs
  sidebarDDayEnabled.checked = workspaceStorage.getItem('calendar_dday_enabled') === 'true';
  sidebarDDayDate.value = workspaceStorage.getItem('calendar_dday_date') || '2026-07-26';
  sidebarDDayDateGroup.style.display = sidebarDDayEnabled.checked ? 'block' : 'none';
  
  sidebarDDayEnabled.addEventListener('change', (e) => {
    workspaceStorage.setItem('calendar_dday_enabled', e.target.checked);
    sidebarDDayDateGroup.style.display = e.target.checked ? 'block' : 'none';
    renderCalendar();
  });
  
  sidebarDDayDate.addEventListener('change', (e) => {
    workspaceStorage.setItem('calendar_dday_date', e.target.value);
    renderCalendar();
  });

  // Sidebar Notes Addition
  const addNoteInput = document.getElementById('new-note-input');
  const addNoteBtn = document.getElementById('btn-add-sidebar-note');
  
  const submitSidebarNote = () => {
    addGeneralNote(addNoteInput.value);
    addNoteInput.value = '';
  };
  
  addNoteBtn.addEventListener('click', submitSidebarNote);
  addNoteInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitSidebarNote();
  });

  // Event modal actions (close/backdrop click)
  document.getElementById('close-modal-btn').addEventListener('click', closeCalendarEventModal);
  const eventModalBack = document.getElementById('event-modal');
  eventModalBack.addEventListener('click', (e) => {
    if (e.target === eventModalBack) closeCalendarEventModal();
  });

  // Submit Event (Multi-Day and Single-Day range tasks)
  document.getElementById('event-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const id = document.getElementById('event-id').value;
    const title = document.getElementById('event-title').value.trim();
    const desc = document.getElementById('event-desc').value.trim();
    const startDate = document.getElementById('event-start-date').value;
    const endDate = document.getElementById('event-end-date').value;
    const time = document.getElementById('event-time').value;
    const tagEl = document.querySelector('input[name="event-tag"]:checked');
    const tag = tagEl ? tagEl.value : 'blue';
    const repeat = document.getElementById('event-repeat').value;
    
    if (!title || !startDate || !endDate) return;
    
    if (endDate < startDate) {
      showToast("End Date cannot be before Start Date.", "error");
      return;
    }
    
    if (id) {
      // Edit
      calendarEventsList = calendarEventsList.map(evt => {
        if (evt.id === id) {
          return { id, title, desc, startDate, endDate, time, tag, repeat };
        }
        return evt;
      });
    } else {
      // Add
      calendarEventsList.push({
        id: `evt-${Date.now()}`,
        title,
        desc,
        startDate,
        endDate,
        time,
        tag,
        repeat
      });
    }
    
    workspaceStorage.setItem('calendar_events_list', JSON.stringify(calendarEventsList));
    renderCalendar();
    closeCalendarEventModal();
  });

  // Delete specific instance only (Delete This Day)
  document.getElementById('delete-instance-btn').addEventListener('click', () => {
    const id = document.getElementById('event-id').value;
    const clickedDate = document.getElementById('event-clicked-date').value;
    
    if (id && clickedDate) {
      calendarEventsList = calendarEventsList.map(evt => {
        if (evt.id === id) {
          if (!evt.exdates) evt.exdates = [];
          if (!evt.exdates.includes(clickedDate)) {
            evt.exdates.push(clickedDate);
          }
        }
        return evt;
      });
      workspaceStorage.setItem('calendar_events_list', JSON.stringify(calendarEventsList));
      renderCalendar();
      closeCalendarEventModal();
    }
  });

  // Delete event
  document.getElementById('delete-event-btn').addEventListener('click', () => {
    const id = document.getElementById('event-id').value;
    calendarEventsList = calendarEventsList.filter(evt => evt.id !== id);
    workspaceStorage.setItem('calendar_events_list', JSON.stringify(calendarEventsList));
    renderCalendar();
    closeCalendarEventModal();
  });
  
  // ================= AUTH SYSTEM EVENT BINDINGS =================
  const linkGotoSignup = document.getElementById('link-goto-signup');
  const linkGotoSignin = document.getElementById('link-goto-signin');
  const panelSignin = document.getElementById('panel-signin');
  const panelSignup = document.getElementById('panel-signup');
  
  linkGotoSignup.addEventListener('click', (e) => {
    e.preventDefault();
    if (authRequestPending) return;
    hideAuthAlert();
    panelSignin.style.display = 'none';
    panelSignup.style.display = 'flex';
    requestAnimationFrame(() => {document.getElementById('login-container').scrollTop = 0;});
  });
  
  linkGotoSignin.addEventListener('click', (e) => {
    e.preventDefault();
    if (authRequestPending) return;
    hideAuthAlert();
    panelSignup.style.display = 'none';
    panelSignin.style.display = 'flex';
    requestAnimationFrame(() => {document.getElementById('login-container').scrollTop = 0;});
  });
  
  // Account passwords go directly to Supabase Auth and are never stored by the app.
  document.querySelectorAll('.btn-google').forEach(button => {
    button.addEventListener('click', async () => {
      if (authRequestPending) return;
      hideAuthAlert();
      setAuthBusy(true);
      const label = button.querySelector('span');
      label.textContent = 'Connecting to Google…';
      try {
        // The SDK builds an OAuth URL even for a disabled provider. Check first so users stay on this page.
        const response = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
          headers:{apikey:config.supabasePublishableKey}, signal:AbortSignal.timeout(10000)
        });
        if (!response.ok) throw new Error('Could not connect to sign-in. Please check your connection and try again.');
        const settings = await response.json();
        if (!settings.external?.google) throw new Error('Google sign-in is not available yet. Please sign in with email for now.');
        const url = await backend.signInWithGoogle(new URL('.',window.location.href).href);
        sessionStorage.removeItem('univault-guest');
        window.location.assign(url);
      } catch (error) {
        showAuthAlert(error instanceof TypeError || error.name === 'TimeoutError'
          ? 'Could not connect to Google sign-in. Please check your connection and try again.' : error.message);
        setAuthBusy(false);
        label.textContent = 'Continue with Google';
      }
    });
  });
  document.getElementById('form-signin').addEventListener('submit', async event => {
    event.preventDefault();
    if (authRequestPending) return;
    hideAuthAlert();
    const form = event.currentTarget;
    setAuthBusy(true);
    try {
      await backend.signIn(document.getElementById('signin-username').value.trim(),document.getElementById('signin-password').value);
      sessionStorage.removeItem('univault-guest');
      form.reset();
      window.location.reload();
    } catch (error) {showAuthAlert(error.message);}
    finally {setAuthBusy(false);}
  });
  document.getElementById('form-signup').addEventListener('submit', async event => {
    event.preventDefault();
    if (authRequestPending) return;
    hideAuthAlert();
    const form = event.currentTarget;
    const password = document.getElementById('signup-password').value;
    if (password !== document.getElementById('signup-confirm-password').value) {showAuthAlert('Passwords do not match.'); return;}
    setAuthBusy(true);
    try {
      const result = await backend.signUp(document.getElementById('signup-username').value.trim(),password,new URL('.',window.location.href).href);
      form.reset();
      if (result.needsConfirmation) {
        panelSignup.style.display = 'none';
        panelSignin.style.display = 'flex';
        requestAnimationFrame(() => {document.getElementById('login-container').scrollTop = 0;});
        showAuthAlert('Check your email to confirm your account, then return here to sign in.',true);
      } else {
        sessionStorage.removeItem('univault-guest');
        window.location.reload();
      }
    } catch (error) {showAuthAlert(error.message);}
    finally {setAuthBusy(false);}
  });

  const fileInput = document.getElementById('performance-sheet-file-input');
  const performanceButtons = ['btn-import-performance','btn-import-grades'].map(id=>document.getElementById(id));
  performanceButtons.forEach(button=>button.addEventListener('click',()=>{fileInput.value='';fileInput.click();}));
  document.getElementById('performance-preview-close').addEventListener('click',closePerformancePreview);
  document.getElementById('performance-preview-cancel').addEventListener('click',closePerformancePreview);
  document.getElementById('performance-include-pending').addEventListener('change',renderPerformancePreview);
  document.getElementById('performance-preview-confirm').addEventListener('click',confirmPerformanceImport);
  document.getElementById('modal-performance-backdrop').addEventListener('keydown',event=>{
    if (event.key==='Escape') {event.preventDefault();closePerformancePreview();}
    if (event.key==='Tab') {
      const controls=Array.from(event.currentTarget.querySelectorAll('button:not(:disabled),input:not(:disabled)'));
      const first=controls[0],last=controls.at(-1);
      if (event.shiftKey && (document.activeElement===first || document.activeElement.id==='performance-preview-title')) {event.preventDefault();last.focus();}
      else if (!event.shiftKey && document.activeElement===last) {event.preventDefault();first.focus();}
    }
  });
  fileInput.addEventListener('change',async event=>{
    const file=event.target.files[0];
    if (!file) return;
    performanceReturnFocus=document.activeElement;
    performanceButtons.forEach(button=>{button.disabled=true;});
    document.getElementById('performance-import-status').textContent='Reading your PDF…';
    try {
      pendingPerformanceReport=await readPerformancePdf(file);
      document.getElementById('performance-import-status').textContent='Ready to review. No records have been saved yet.';
      document.getElementById('performance-include-pending').checked=false;
      renderPerformancePreview();
      document.getElementById('modal-performance-backdrop').classList.add('active');
      document.getElementById('performance-preview-title').focus();
    } catch (error) {
      pendingPerformanceReport=null;
      document.getElementById('performance-import-status').textContent=error.message || 'Could not read this PDF. Your workspace has not changed.';
      showToast(error.message || 'Could not read this performance sheet. Your records are unchanged.','error');
    } finally {
      performanceButtons.forEach(button=>{button.disabled=false;});fileInput.value='';
    }
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
      persistPendingNotes();
      if (backend.signedIn) await backend.signOut();
      sessionStorage.removeItem('univault-guest');
      window.location.reload();
    } catch (error) {showToast('Your changes have not synced yet. Reconnect and sync before signing out.','error');}
  });
  setAuthBusy(false);

});

// ================= PERFORMANCE SHEET IMPORT =================
let pendingPerformanceReport=null;
let performanceReturnFocus=null;
async function readPerformancePdf(file) {
  if (!/\.pdf$/i.test(file.name) && file.type!=='application/pdf') throw new Error('Choose a PDF performance sheet.');
  if (file.size>10*1024*1024) throw new Error('Choose a performance PDF smaller than 10 MB.');
  pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('pdf.worker.min.js',import.meta.url).href;
  const loading=pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false});
  try {
    const pdf=await loading.promise;
    if (pdf.numPages>30) throw new Error('Choose a performance sheet with 30 pages or fewer.');
    const pages=[];
    for (let i=1;i<=pdf.numPages;i++) {
      const page=await pdf.getPage(i),text=await page.getTextContent();
      pages.push({width:page.view[2]-page.view[0],items:text.items.filter(item=>item.str).map(item=>({str:item.str,x:item.transform[4]-page.view[0],y:item.transform[5]}))});
    }
    return parsePerformancePages(pages);
  } finally {await loading.destroy();}
}

function closePerformancePreview({saved=false}={}) {
  document.getElementById('performance-import-status').textContent=saved ? '' : 'Import cancelled. Your academic records are unchanged.';
  document.getElementById('modal-performance-backdrop').classList.remove('active');
  pendingPerformanceReport=null;
  performanceReturnFocus?.focus();
}

function renderPerformancePreview() {
  if (!pendingPerformanceReport) return;
  const includePending=document.getElementById('performance-include-pending').checked;
  const semesters=pendingPerformanceReport.semesters.map(semester=>({...semester,courses:semester.courses.filter(course=>includePending || normalizeGrade(course.grade))})).filter(semester=>semester.courses.length);
  const totals=academicTotals(semesters.flatMap(semester=>semester.courses));
  const merged=mergePerformanceSheet(state,pendingPerformanceReport,{includePending});
  document.getElementById('performance-preview-summary').textContent=`${semesters.length} semesters · ${totals.courseCount} courses · ${totals.earnedCredits} earned credits · ${totals.plannedCredits} planned credits · Calculated CGPA ${totals.gpa===null?'—':totals.gpa.toFixed(2)}`;
  document.getElementById('performance-preview-changes').textContent=`${merged.counts.added} new · ${merged.counts.updated} updated · ${merged.counts.unchanged} unchanged. Existing notes, files, tasks, and other courses stay in place.`;
  const reported=pendingPerformanceReport.reportedCgpa;
  const warning=document.getElementById('performance-preview-warning');
  warning.hidden=reported===null || totals.gpa===null || Math.abs(reported-Number(totals.gpa.toFixed(2)))<.011;
  warning.textContent=`The sheet reports CGPA ${reported?.toFixed(2)}, while the imported grades calculate to ${totals.gpa?.toFixed(2)}. Check the preview before saving; repeated-course rules may need a manual correction.`;
  const container=document.getElementById('performance-preview-records');container.replaceChildren();
  semesters.forEach(semester=>{
    const section=document.createElement('section');
    const title=document.createElement('h3');title.textContent=semester.semName;section.appendChild(title);
    const stats=academicTotals(semester.courses);
    const caption=document.createElement('p');caption.className='academic-caption';caption.textContent=`${stats.courseCount} courses · ${stats.earnedCredits} earned credits · ${stats.plannedCredits} planned credits · SGPA ${stats.gpa===null?'—':stats.gpa.toFixed(2)}`;section.appendChild(caption);
    const table=document.createElement('table');table.className='performance-table';
    table.innerHTML='<thead><tr><th scope="col">Course</th><th scope="col">Credits</th><th scope="col">Grade</th></tr></thead>';
    const body=document.createElement('tbody');
    semester.courses.forEach(course=>{
      const row=document.createElement('tr');
      for (const value of [`${course.code} · ${course.title}`,course.credits,course.grade || 'Pending']) {const cell=document.createElement('td');cell.textContent=value;row.appendChild(cell);}
      body.appendChild(row);
    });
    table.appendChild(body);section.appendChild(table);container.appendChild(section);
  });
  document.getElementById('performance-preview-confirm').disabled=!totals.courseCount;
}

async function confirmPerformanceImport() {
  if (!pendingPerformanceReport) return;
  const button=document.getElementById('performance-preview-confirm');button.disabled=true;
  try {
    persistPendingNotes();
    const result=mergePerformanceSheet(state,pendingPerformanceReport,{includePending:document.getElementById('performance-include-pending').checked});
    const previous=state;
    state=result.state;
    try {saveStateToStorage();}
    catch (error) {state=previous;try {saveStateToStorage();} catch {} throw error;}
    closePerformancePreview({saved:true});
    await renderBoard();await renderMetrics();updateGlobalFiltersSelect();
    if (activeTab==='cgpa') renderCgpaCalculator();
    const message=`Performance sheet saved: ${result.counts.added} added, ${result.counts.updated} updated, ${result.counts.unchanged} unchanged.`;
    document.getElementById('performance-import-status').textContent=message;showToast(message);
  } catch (error) {
    showToast('Could not save the import. Please try again.','error');
  } finally {button.disabled=false;}
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g,txt=>txt.charAt(0).toUpperCase()+txt.slice(1).toLowerCase());
}

// ================= MODERN TOAST SYSTEM =================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    padding: 1rem 1.5rem;
    background: var(--bg-card);
    border: 1px solid ${type === 'success' ? 'var(--color-accent)' : 'var(--color-rose)'};
    border-radius: 12px;
    color: var(--text-primary);
    font-size: 0.9rem;
    font-weight: 500;
    backdrop-filter: blur(12px);
    box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
    display: flex;
    align-items: center;
    gap: 0.75rem;
    transform: translateY(100px);
    opacity: 0;
    transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    pointer-events: auto;
  `;
  
  const icon = document.createElement('span');
  icon.textContent = type === 'success' ? '⚡' : '⚠️';
  toast.appendChild(icon);
  
  const text = document.createElement('span');
  text.textContent = message;
  toast.appendChild(text);
  
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';
  }, 50);
  
  setTimeout(() => {
    toast.style.transform = 'translateY(-20px)';
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 400);
  }, 2000);
}

// ================= CGPA CALCULATOR MODULE =================
function renderCgpaCalculator() {
  const container=document.getElementById('cgpa-semesters-container');
  if (!container) return;
  container.replaceChildren();
  const overall=academicTotals(state.courses);
  document.getElementById('overall-cgpa-display').textContent=overall.gpa===null?'—':overall.gpa.toFixed(2);
  document.getElementById('overall-credits-display').textContent=overall.earnedCredits.toFixed(1);
  document.getElementById('overall-courses-display').textContent=overall.completedCourses;
  document.getElementById('overall-gpa-credits-display').textContent=overall.gradedCredits.toFixed(1);
  document.getElementById('overall-planned-credits-display').textContent=overall.plannedCredits.toFixed(1);
  renderMidsemEstimate();
  if (!state.semesters.length) {
    container.innerHTML='<div class="empty-state"><div class="empty-state-title">Your academic record starts here</div><div class="empty-state-desc">Upload your performance sheet above to save past grades, or add your own courses. Nothing is preloaded.</div></div>';
    return;
  }
  state.semesters.forEach(semester=>{
    const courses=state.courses.filter(course=>course.semesterId===semester.id),totals=academicTotals(courses);
    const card=document.createElement('section');card.className='academic-semester';
    const header=document.createElement('div');header.className='academic-semester-header';
    const title=document.createElement('h3');title.textContent=semester.name;
    const badge=document.createElement('span');badge.className='academic-sgpa';badge.textContent=`SGPA ${totals.gpa===null?'—':totals.gpa.toFixed(2)}`;
    header.append(title,badge);card.appendChild(header);
    const meta=document.createElement('p');meta.className='academic-caption';meta.textContent=`${totals.courseCount} course slots · ${totals.earnedCredits} earned credits · ${totals.plannedCredits} planned credits`;card.appendChild(meta);
    if (!courses.length) {const empty=document.createElement('p');empty.textContent='No courses in this semester yet.';card.appendChild(empty);}
    courses.forEach(course=>{
      const row=document.createElement('div');row.className='academic-course';
      const details=document.createElement('div');details.className='academic-course-info';
      const code=document.createElement('strong');code.textContent=course.code;
      const name=document.createElement('span');name.textContent=course.name;
      const credits=document.createElement('small');credits.textContent=`${Number(course.credits) || 0} credits`;
      details.append(code,name,credits);
      if (course.isPlaceholder) {
        row.classList.add('academic-placeholder');code.textContent=`${course.electiveType} placeholder`;
        credits.textContent=`${Number(course.credits) || 0} planned credits`;
        const choose=document.createElement('button');choose.className='btn btn-secondary btn-sm';choose.textContent='Choose course';choose.setAttribute('aria-label',`Choose course for ${course.name}, ${semester.name}`);choose.addEventListener('click',()=>openCourseModal(course.id,true));
        row.append(details,choose);card.appendChild(row);return;
      }
      const select=document.createElement('select');select.className='form-control academic-grade';select.setAttribute('aria-label',`Recorded final grade for ${course.code}, ${semester.name}`);
      const options=[...GRADE_OPTIONS];const current=courseGrade(course);if (current && !options.includes(current)) options.push(current);
      options.forEach(grade=>select.add(new Option(grade || 'Pending',grade,false,grade===current)));
      select.addEventListener('change',()=>{
        course.grade=normalizeGrade(select.value);delete course.targetGrade;
        semester.completed=courses.length>0 && courses.every(item=>!!courseGrade(item));
        saveStateToStorage();renderCgpaCalculator();
        showToast(`Recorded grade saved for ${course.code}.`);
      });
      row.append(details,select);card.appendChild(row);
    });
    container.appendChild(card);
  });
}

// This calculator intentionally never calls workspaceStorage or saveStateToStorage.
function renderMidsemEstimate() {
  const selector=document.getElementById('midsem-semester');
  const ongoing=state.semesters.filter(semester=>!semester.completed);
  const selected=ongoing.find(semester=>semester.id===midsemDraft.semesterId) || ongoing.find(semester=>state.courses.some(course=>course.semesterId===semester.id && !course.isPlaceholder)) || ongoing[0];
  if (selected?.id!==midsemDraft.semesterId) midsemDraft={semesterId:selected?.id || null,grades:{}};
  selector.replaceChildren();ongoing.forEach(semester=>selector.add(new Option(semester.name,semester.id)));
  selector.disabled=!selected;if(selected) selector.value=selected.id;
  const rows=document.getElementById('midsem-course-rows');rows.replaceChildren();
  const courses=state.courses.filter(course=>course.semesterId===selected?.id && !course.isPlaceholder);
  const empty=document.getElementById('midsem-empty-message');
  empty.textContent=!selected ? 'Add your current semester and courses to try a midsem estimate.' : !courses.length ? 'Choose the actual courses for this semester first. Elective placeholders are excluded from this estimate.' : 'Enter your current estimated letter grades below. Only filled grades enter this estimate.';
  courses.forEach(course=>{
    const row=document.createElement('div');row.className='academic-course';
    const label=document.createElement('label');label.className='academic-course-info';label.htmlFor=`midsem-grade-${course.id}`;
    const name=document.createElement('strong');name.textContent=`${course.code} · ${course.name}`;
    const credits=document.createElement('small');credits.textContent=`${Number(course.credits) || 0} credits`;label.append(name,credits);
    const grade=document.createElement('select');grade.className='form-control academic-grade';grade.id=label.htmlFor;
    grade.setAttribute('aria-label',`Temporary midsem grade for ${course.code}`);
    grade.add(new Option('No estimate',''));Object.keys(GRADE_POINTS).forEach(value=>grade.add(new Option(value,value)));
    grade.value=midsemDraft.grades[course.id] || '';
    grade.addEventListener('change',()=>{midsemDraft.grades[course.id]=grade.value;updateMidsemResult(courses);});
    row.append(label,grade);rows.appendChild(row);
  });
  document.getElementById('midsem-reset').disabled=!courses.length;
  updateMidsemResult(courses);
}

function updateMidsemResult(courses) {
  const estimate=estimateSemester(courses,midsemDraft.grades);
  document.getElementById('midsem-sgpa').textContent=`Estimated SGPA ${estimate.gpa===null?'—':estimate.gpa.toFixed(2)}`;
  document.getElementById('midsem-coverage').textContent=`${estimate.gradedCourses} of ${estimate.eligibleCourses} selected courses · ${estimate.gradedCredits} estimated credits. Temporary values only; nothing is saved.`;
}

// ================= BITS CHRONO TIMETABLE PLANNER MODULE =================
const TIMETABLE_COURSES_DATA = {
  'A7': [
    {
      code: 'CS F211',
      name: 'Data Structures & Algorithms',
      sections: {
        lectures: [
          { id: 'cs211-l1', name: 'L1', instructor: 'Dr. A. Sen', slots: [{ day: 'M', hour: 2 }, { day: 'W', hour: 2 }, { day: 'F', hour: 2 }] },
          { id: 'cs211-l2', name: 'L2', instructor: 'Dr. P. Gupta', slots: [{ day: 'T', hour: 3 }, { day: 'Th', hour: 3 }] }
        ],
        tutorials: [
          { id: 'cs211-t1', name: 'T1', instructor: 'Dr. A. Sen', slots: [{ day: 'Th', hour: 5 }] },
          { id: 'cs211-t2', name: 'T2', instructor: 'Dr. P. Gupta', slots: [{ day: 'S', hour: 1 }] }
        ],
        practicals: []
      }
    },
    {
      code: 'CS F212',
      name: 'Database Systems',
      sections: {
        lectures: [
          { id: 'cs212-l1', name: 'L1', instructor: 'Dr. K. Rao', slots: [{ day: 'M', hour: 4 }, { day: 'W', hour: 4 }, { day: 'F', hour: 4 }] },
          { id: 'cs212-l2', name: 'L2', instructor: 'Dr. J. Reddy', slots: [{ day: 'T', hour: 4 }, { day: 'Th', hour: 4 }] }
        ],
        tutorials: [],
        practicals: [
          { id: 'cs212-p1', name: 'P1', instructor: 'Lab Assistant', slots: [{ day: 'M', hour: 7 }, { day: 'M', hour: 8 }] },
          { id: 'cs212-p2', name: 'P2', instructor: 'Lab Assistant', slots: [{ day: 'W', hour: 7 }, { day: 'W', hour: 8 }] }
        ]
      }
    },
    {
      code: 'CS F213',
      name: 'Object Oriented Programming',
      sections: {
        lectures: [
          { id: 'cs213-l1', name: 'L1', instructor: 'Dr. Y. Prasad', slots: [{ day: 'M', hour: 3 }, { day: 'W', hour: 3 }, { day: 'F', hour: 3 }] }
        ],
        tutorials: [],
        practicals: [
          { id: 'cs213-p1', name: 'P1', instructor: 'Lab Assistant', slots: [{ day: 'T', hour: 7 }, { day: 'T', hour: 8 }] },
          { id: 'cs213-p2', name: 'P2', instructor: 'Lab Assistant', slots: [{ day: 'Th', hour: 7 }, { day: 'Th', hour: 8 }] }
        ]
      }
    },
    {
      code: 'CS F215',
      name: 'Digital Design',
      sections: {
        lectures: [
          { id: 'cs215-l1', name: 'L1', instructor: 'Dr. B. Das', slots: [{ day: 'M', hour: 1 }, { day: 'W', hour: 1 }, { day: 'F', hour: 1 }] }
        ],
        tutorials: [
          { id: 'cs215-t1', name: 'T1', instructor: 'Dr. B. Das', slots: [{ day: 'T', hour: 1 }] }
        ],
        practicals: [
          { id: 'cs215-p1', name: 'P1', instructor: 'Lab Assistant', slots: [{ day: 'F', hour: 7 }, { day: 'F', hour: 8 }] }
        ]
      }
    },
    {
      code: 'MATH F211',
      name: 'Mathematics III',
      sections: {
        lectures: [
          { id: 'math211-l1', name: 'L1', instructor: 'Dr. S. Kumar', slots: [{ day: 'M', hour: 5 }, { day: 'W', hour: 5 }, { day: 'F', hour: 5 }] }
        ],
        tutorials: [
          { id: 'math211-t1', name: 'T1', instructor: 'Dr. S. Kumar', slots: [{ day: 'S', hour: 2 }] }
        ],
        practicals: []
      }
    }
  ],
  'A3': [
    {
      code: 'EEE F211',
      name: 'Electrical Machines',
      sections: {
        lectures: [
          { id: 'eee211-l1', name: 'L1', instructor: 'Dr. M. Roy', slots: [{ day: 'M', hour: 2 }, { day: 'W', hour: 2 }, { day: 'F', hour: 2 }] }
        ],
        tutorials: [
          { id: 'eee211-t1', name: 'T1', instructor: 'Dr. M. Roy', slots: [{ day: 'Th', hour: 2 }] }
        ],
        practicals: [
          { id: 'eee211-p1', name: 'P1', instructor: 'Lab Assistant', slots: [{ day: 'M', hour: 7 }, { day: 'M', hour: 8 }] }
        ]
      }
    },
    {
      code: 'EEE F212',
      name: 'Control Systems',
      sections: {
        lectures: [
          { id: 'eee212-l1', name: 'L1', instructor: 'Dr. R. Singh', slots: [{ day: 'M', hour: 3 }, { day: 'W', hour: 3 }, { day: 'F', hour: 3 }] }
        ],
        tutorials: [],
        practicals: [
          { id: 'eee212-p1', name: 'P1', instructor: 'Lab Assistant', slots: [{ day: 'T', hour: 7 }, { day: 'T', hour: 8 }] }
        ]
      }
    },
    {
      code: 'EEE F214',
      name: 'Electronic Devices',
      sections: {
        lectures: [
          { id: 'eee214-l1', name: 'L1', instructor: 'Dr. V. Rao', slots: [{ day: 'M', hour: 4 }, { day: 'W', hour: 4 }, { day: 'F', hour: 4 }] }
        ],
        tutorials: [
          { id: 'eee214-t1', name: 'T1', instructor: 'Dr. V. Rao', slots: [{ day: 'Th', hour: 4 }] }
        ],
        practicals: []
      }
    },
    {
      code: 'MATH F211',
      name: 'Mathematics III',
      sections: {
        lectures: [
          { id: 'math211-l1', name: 'L1', instructor: 'Dr. S. Kumar', slots: [{ day: 'M', hour: 5 }, { day: 'W', hour: 5 }, { day: 'F', hour: 5 }] }
        ],
        tutorials: [
          { id: 'math211-t1', name: 'T1', instructor: 'Dr. S. Kumar', slots: [{ day: 'S', hour: 2 }] }
        ],
        practicals: []
      }
    }
  ]
};

function initTimetablePlanner() {
  const degree = workspaceStorage.getItem('timetable_degree');
  const setupContainer = document.getElementById('timetable-setup-container');
  const workspace = document.getElementById('timetable-workspace');
  const headerActions = document.getElementById('timetable-header-actions');
  
  if (!setupContainer || !workspace) return;
  
  if (degree) {
    setupContainer.style.display = 'none';
    workspace.style.display = 'flex';
    if (headerActions) headerActions.style.display = 'flex';
    
    // Set select dropdown value (fallback to A7 if custom PDF loaded)
    const select = document.getElementById('timetable-degree-select');
    if (select) {
      select.value = degree === 'custom' ? 'A7' : degree;
    }
    
    renderTimetableWorkspace(degree);
  } else {
    setupContainer.style.display = 'flex';
    workspace.style.display = 'none';
    if (headerActions) headerActions.style.display = 'none';
  }
}

function handleTimetableDegreeSubmit() {
  const select = document.getElementById('timetable-degree-select');
  if (!select) return;
  
  const val = select.value;
  workspaceStorage.setItem('timetable_degree', val);
  showToast(`Degree selected: ${val}! Starting planner...`, 'success');
  initTimetablePlanner();
}

function handleTimetableReset() {
  if (confirm("Are you sure you want to reset your timetable? This will clear all section selections.")) {
    workspaceStorage.removeItem('timetable_degree');
    workspaceStorage.removeItem('timetable_selected_sections');
    workspaceStorage.removeItem('timetable_frozen');
    showToast("Timetable configuration reset.", "success");
    initTimetablePlanner();
  }
}

function getSelectedTimetableSections() {
  return JSON.parse(workspaceStorage.getItem('timetable_selected_sections') || '[]');
}

function saveSelectedTimetableSections(sections) {
  workspaceStorage.setItem('timetable_selected_sections', JSON.stringify(sections));
}

function renderTimetableWorkspace(degree) {
  const coursesList = document.getElementById('timetable-courses-list');
  if (!coursesList) return;
  coursesList.innerHTML = '';
  
  const courses = degree === 'custom' 
    ? JSON.parse(workspaceStorage.getItem('custom_timetable_courses') || '[]')
    : (TIMETABLE_COURSES_DATA[degree] || []);
  const selectedSections = getSelectedTimetableSections();
  const isFrozen = workspaceStorage.getItem('timetable_frozen') === 'true';
  
  const searchQuery = (document.getElementById('timetable-course-search')?.value || '').toLowerCase().trim();

  const leftColumn = document.querySelector('#timetable-workspace > div > div:first-child');
  const freezeBtn = document.getElementById('btn-freeze-timetable');
  
  if (isFrozen) {
    if (leftColumn) leftColumn.style.display = 'none';
    if (freezeBtn) {
      freezeBtn.className = 'btn btn-secondary';
      freezeBtn.innerHTML = `<i data-lucide="unlock" style="width: 16px; height: 16px; margin-right: 0.25rem;"></i> Unfreeze Timetable`;
    }
  } else {
    if (leftColumn) leftColumn.style.display = 'block';
    if (freezeBtn) {
      freezeBtn.className = 'btn btn-primary';
      freezeBtn.innerHTML = `<i data-lucide="lock" style="width: 16px; height: 16px; margin-right: 0.25rem;"></i> Freeze Timetable`;
    }
  }
  
  const gridTitle = document.getElementById('timetable-grid-title');
  if (gridTitle) {
    gridTitle.innerHTML = isFrozen
      ? `<div style="display: flex; align-items: center; gap: 0.5rem;"><i data-lucide="shield-check" style="color: var(--color-emerald); width: 20px; height: 20px;"></i> Finalized Timetable (Locked)</div>`
      : 'Weekly Timetable Grid';
  }

  // Filter courses based on search input
  const filteredCourses = courses.filter(c => 
    !searchQuery || 
    c.code.toLowerCase().includes(searchQuery) || 
    c.name.toLowerCase().includes(searchQuery)
  );

  if (filteredCourses.length === 0) {
    coursesList.innerHTML = `<div style="padding: 1.5rem; text-align: center; color: var(--text-secondary); font-size: 0.85rem;">No matching courses found.</div>`;
  }
  
  filteredCourses.forEach(course => {
    const courseCard = document.createElement('div');
    courseCard.style.cssText = `
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    `;
    
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display: flex; flex-direction: column; gap: 0.25rem;';
    
    const code = document.createElement('span');
    code.style.cssText = 'font-size: 0.85rem; font-weight: 700; color: var(--color-accent);';
    code.innerText = course.code;
    
    const name = document.createElement('span');
    name.style.cssText = 'font-size: 0.9rem; font-weight: 600; color: var(--text-primary);';
    name.innerText = course.name;
  name.title = course.name;
    
    titleRow.appendChild(code);
    titleRow.appendChild(name);
    courseCard.appendChild(titleRow);
    
    // Group sections by Lecture, Tutorial, Practical
    const groups = [
      { type: 'lectures', label: 'Lectures (L)' },
      { type: 'tutorials', label: 'Tutorials (T)' },
      { type: 'practicals', label: 'Practicals (P)' }
    ];
    
    groups.forEach(grp => {
      const sects = course.sections[grp.type] || [];
      if (sects.length > 0) {
        const groupContainer = document.createElement('div');
        groupContainer.style.cssText = 'display: flex; flex-direction: column; gap: 0.35rem;';
        
        const grpLabel = document.createElement('div');
        grpLabel.style.cssText = 'font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.15rem;';
        grpLabel.innerText = grp.label;
        groupContainer.appendChild(grpLabel);
        
        const optionsRow = document.createElement('div');
        optionsRow.style.cssText = 'display: flex; flex-wrap: wrap; gap: 0.35rem;';
        
        sects.forEach(sect => {
          const isSelected = selectedSections.includes(sect.id);
          const pill = document.createElement('button');
          pill.type = 'button';
          
          let badgeColor = 'var(--color-accent)';
          if (grp.type === 'tutorials') badgeColor = 'var(--color-amber)';
          if (grp.type === 'practicals') badgeColor = 'var(--color-emerald)';

          pill.style.cssText = `
            font-size: 0.75rem;
            padding: 0.35rem 0.6rem;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid ${isSelected ? badgeColor : 'rgba(255, 255, 255, 0.1)'};
            background: ${isSelected ? badgeColor : 'rgba(255, 255, 255, 0.03)'};
            color: ${isSelected ? '#ffffff' : 'var(--text-secondary)'};
            font-weight: ${isSelected ? '700' : '500'};
          `;
          
          const timeDesc = sect.slots.map(s => `${s.day}${s.hour}`).join(' ');
          pill.innerText = `${sect.name} (${timeDesc})`;
          pill.title = `Instructor: ${sect.instructor}`;
          
          if (!isFrozen) {
            pill.addEventListener('click', () => {
              let updated = [...selectedSections];
              if (isSelected) {
                updated = updated.filter(id => id !== sect.id);
              } else {
                // Deselect other sections of same type for this course
                const otherSectIds = sects.map(s => s.id);
                updated = updated.filter(id => !otherSectIds.includes(id));
                updated.push(sect.id);
              }
              saveSelectedTimetableSections(updated);
              renderTimetableWorkspace(degree);
            });
          }
          
          optionsRow.appendChild(pill);
        });
        
        groupContainer.appendChild(optionsRow);
        courseCard.appendChild(groupContainer);
      }
    });
    
    coursesList.appendChild(courseCard);
  });
  
  // Render weekly grid, compute stats, & render exam schedule
  renderWeeklyTimetableGrid(courses, selectedSections);
  renderExamScheduleList();
}

function renderWeeklyTimetableGrid(courses, selectedSections) {
  const tbody = document.getElementById('timetable-grid-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const days = ['M', 'T', 'W', 'Th', 'F', 'S'];
  const hourTimings = [
    '8:00 - 8:50 AM',
    '9:00 - 9:50 AM',
    '10:00 - 10:50 AM',
    '11:00 - 11:50 AM',
    '12:00 - 12:50 PM',
    '1:00 - 1:50 PM',
    '2:00 - 2:50 PM',
    '3:00 - 3:50 PM',
    '4:00 - 4:50 PM'
  ];
  
  // Build lookup index: Day + Hour -> list of occupying sections
  const gridOccupants = {};
  let totalHoursCount = 0;
  let clashCount = 0;
  const activeDays = new Set();

  courses.forEach(course => {
    const allSections = [
      ...(course.sections.lectures || []),
      ...(course.sections.tutorials || []),
      ...(course.sections.practicals || [])
    ];
    
    allSections.forEach(sect => {
      if (selectedSections.includes(sect.id)) {
        const isTutorial = (course.sections.tutorials || []).some(t => t.id === sect.id);
        const isPractical = (course.sections.practicals || []).some(p => p.id === sect.id);
        const secType = isPractical ? 'practical' : (isTutorial ? 'tutorial' : 'lecture');

        sect.slots.forEach(slot => {
          totalHoursCount++;
          activeDays.add(slot.day);
          const key = `${slot.day}-${slot.hour}`;
          if (!gridOccupants[key]) {
            gridOccupants[key] = [];
          }
          gridOccupants[key].push({
            courseCode: course.code,
            sectionName: sect.name,
            instructor: sect.instructor,
            type: secType
          });
        });
      }
    });
  });

  // Calculate clashes count
  Object.values(gridOccupants).forEach(occList => {
    if (occList.length > 1) {
      clashCount += (occList.length - 1);
    }
  });

  // Update Stats Bar UI
  updateTimetableStats(totalHoursCount, clashCount, activeDays);
  
  // Generate Hour Rows (Hour 1 to Hour 9)
  for (let h = 1; h <= 9; h++) {
    const tr = document.createElement('tr');
    tr.style.cssText = 'border-bottom: 1px solid var(--border-color);';
    
    // Hour label
    const tdHour = document.createElement('td');
    tdHour.style.cssText = 'padding: 0.75rem; font-weight: 600; color: var(--text-primary); border-right: 1px solid var(--border-color);';
    tdHour.innerHTML = `<div style="font-size: 0.85rem;">Hour ${h}</div><div style="font-size: 0.65rem; color: var(--text-secondary); font-weight: normal; margin-top: 0.15rem;">${hourTimings[h-1]}</div>`;
    tr.appendChild(tdHour);
    
    // Day cells
    days.forEach(day => {
      const tdCell = document.createElement('td');
      tdCell.style.cssText = 'padding: 0.5rem; text-align: center; border-right: 1px solid var(--border-color); width: 100px; height: 50px; position: relative;';
      if (day === 'S') {
        tdCell.style.borderRight = 'none';
      }
      
      const key = `${day}-${h}`;
      const occupants = gridOccupants[key] || [];
      
      if (occupants.length === 1) {
        // Single section in this slot
        const occ = occupants[0];
        let bg = 'rgba(59, 130, 246, 0.08)';
        let border = 'var(--color-accent)';
        
        if (occ.type === 'tutorial') {
          bg = 'rgba(245, 158, 11, 0.08)';
          border = '#f59e0b';
        } else if (occ.type === 'practical') {
          bg = 'rgba(16, 185, 129, 0.08)';
          border = 'var(--color-emerald)';
        }

        tdCell.style.background = bg;
        tdCell.style.borderLeft = `3px solid ${border}`;
        
        const codeSpan = document.createElement('div');
        codeSpan.style.cssText = 'font-weight: 700; color: var(--text-primary); font-size: 0.75rem;';
        codeSpan.innerText = occ.courseCode;
        
        const detailsSpan = document.createElement('div');
        detailsSpan.style.cssText = 'font-size: 0.65rem; color: var(--text-secondary); font-weight: 500; margin-top: 0.15rem;';
        const lastName = occ.instructor ? occ.instructor.split(' ').pop() : '';
        detailsSpan.innerText = `${occ.sectionName}${lastName ? ' (' + lastName + ')' : ''}`;
        
        tdCell.appendChild(codeSpan);
        tdCell.appendChild(detailsSpan);
      } else if (occupants.length > 1) {
        // Multi section CLASH!
        tdCell.style.background = 'rgba(239, 68, 68, 0.15)';
        tdCell.style.borderLeft = '3px solid var(--color-rose)';
        
        const warning = document.createElement('div');
        warning.style.cssText = 'font-weight: 800; color: var(--color-rose); font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 0.25rem;';
        warning.innerHTML = `⚠️ CLASH!`;
        
        const clashCourses = document.createElement('div');
        clashCourses.style.cssText = 'font-size: 0.65rem; color: var(--text-primary); font-weight: 600; margin-top: 0.15rem;';
        clashCourses.innerText = occupants.map(o => o.courseCode).join(' vs ');
        
        tdCell.appendChild(warning);
        tdCell.appendChild(clashCourses);
      }
      
      tr.appendChild(tdCell);
    });
    
    tbody.appendChild(tr);
  }
  lucide.createIcons();
}

function updateTimetableStats(hours, clashes, activeDays) {
  const hoursEl = document.getElementById('stat-total-hours');
  const clashesEl = document.getElementById('stat-clashes-count');
  const iconBox = document.getElementById('stat-clash-icon-box');
  const freeDaysEl = document.getElementById('stat-free-days');

  if (hoursEl) hoursEl.innerText = `${hours} Hours`;

  if (clashesEl && iconBox) {
    if (clashes > 0) {
      clashesEl.innerText = `${clashes} Clash${clashes > 1 ? 'es' : ''}`;
      clashesEl.style.color = 'var(--color-rose)';
      iconBox.style.background = 'rgba(239, 68, 68, 0.15)';
      iconBox.style.color = 'var(--color-rose)';
      iconBox.innerHTML = `<i data-lucide="alert-triangle"></i>`;
    } else {
      clashesEl.innerText = `0 Clashes`;
      clashesEl.style.color = 'var(--color-emerald)';
      iconBox.style.background = 'rgba(16, 185, 129, 0.15)';
      iconBox.style.color = 'var(--color-emerald)';
      iconBox.innerHTML = `<i data-lucide="shield-check"></i>`;
    }
  }

  if (freeDaysEl) {
    const allDays = ['M', 'T', 'W', 'Th', 'F', 'S'];
    const free = allDays.filter(d => !activeDays.has(d));
    const dayNames = { M: 'Mon', T: 'Tue', W: 'Wed', Th: 'Thu', F: 'Fri', S: 'Sat' };
    
    if (free.length === 0) {
      freeDaysEl.innerText = 'None';
    } else {
      freeDaysEl.innerText = free.map(d => dayNames[d]).join(', ');
    }
  }
}

function handleAddCustomCourseSubmit(e) {
  e.preventDefault();
  const code = document.getElementById('custom-course-code').value.trim();
  const title = document.getElementById('custom-course-title').value.trim();
  const secName = document.getElementById('custom-section-name').value.trim();
  const instructor = document.getElementById('custom-section-instructor').value.trim() || 'Staff';

  const dayBoxes = Array.from(document.querySelectorAll('input[name="custom-days"]:checked')).map(cb => cb.value);
  const hourBoxes = Array.from(document.querySelectorAll('input[name="custom-hours"]:checked')).map(cb => parseInt(cb.value));

  if (dayBoxes.length === 0 || hourBoxes.length === 0) {
    showToast("Please select at least one day and one hour slot.", "error");
    return;
  }

  const slots = [];
  dayBoxes.forEach(day => {
    hourBoxes.forEach(hour => {
      slots.push({ day, hour });
    });
  });

  const secId = `custom-${Date.now()}`;
  const isPractical = secName.toUpperCase().startsWith('P');
  const isTutorial = secName.toUpperCase().startsWith('T');

  const newCourse = {
    code: code,
    name: title,
    sections: {
      lectures: isPractical || isTutorial ? [] : [{ id: secId, name: secName, instructor, slots }],
      tutorials: isTutorial ? [{ id: secId, name: secName, instructor, slots }] : [],
      practicals: isPractical ? [{ id: secId, name: secName, instructor, slots }] : []
    }
  };

  const degree = workspaceStorage.getItem('timetable_degree') || 'custom';
  let customList = JSON.parse(workspaceStorage.getItem('custom_timetable_courses') || '[]');
  
  if (degree !== 'custom') {
    if (!TIMETABLE_COURSES_DATA[degree]) TIMETABLE_COURSES_DATA[degree] = [];
    TIMETABLE_COURSES_DATA[degree].push(newCourse);
  } else {
    customList.push(newCourse);
    workspaceStorage.setItem('custom_timetable_courses', JSON.stringify(customList));
  }

  const selected = getSelectedTimetableSections();
  selected.push(secId);
  saveSelectedTimetableSections(selected);

  document.getElementById('modal-add-course-backdrop')?.classList.remove('active');
  const formAdd = document.getElementById('form-add-custom-course');
  if (formAdd) formAdd.reset();
  
  showToast(`Added ${code} (${secName}) to timetable!`, 'success');
  renderTimetableWorkspace(degree);
}

function exportTimetableToICS() {
  const degree = workspaceStorage.getItem('timetable_degree') || 'A7';
  const courses = degree === 'custom'
    ? JSON.parse(workspaceStorage.getItem('custom_timetable_courses') || '[]')
    : (TIMETABLE_COURSES_DATA[degree] || []);
  const selectedSections = getSelectedTimetableSections();

  if (selectedSections.length === 0) {
    showToast("No sections selected to export!", "error");
    return;
  }

  let icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Univault//Timetable Planner//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH"
  ];

  const hourToTime = {
    1: "080000", 2: "090000", 3: "100000", 4: "110000", 5: "120000",
    6: "130000", 7: "140000", 8: "150000", 9: "160000"
  };
  const hourToEndTime = {
    1: "085000", 2: "095000", 3: "105000", 4: "115000", 5: "125000",
    6: "135000", 7: "145000", 8: "155000", 9: "165000"
  };
  const dayToICal = { M: "MO", T: "TU", W: "WE", Th: "TH", F: "FR", S: "SA" };

  courses.forEach(c => {
    const allSections = [
      ...(c.sections.lectures || []),
      ...(c.sections.tutorials || []),
      ...(c.sections.practicals || [])
    ];
    allSections.forEach(s => {
      if (selectedSections.includes(s.id)) {
        s.slots.forEach(slot => {
          const startTime = hourToTime[slot.hour] || "080000";
          const endTime = hourToEndTime[slot.hour] || "085000";
          const dayByDay = dayToICal[slot.day] || "MO";

          icsContent.push("BEGIN:VEVENT");
          icsContent.push(`SUMMARY:${c.code} - ${s.name}`);
          icsContent.push(`DESCRIPTION:${c.name} | Instructor: ${s.instructor}`);
          icsContent.push(`RRULE:FREQ=WEEKLY;BYDAY=${dayByDay}`);
          icsContent.push(`DTSTART:20260801T${startTime}`);
          icsContent.push(`DTEND:20260801T${endTime}`);
          icsContent.push("END:VEVENT");
        });
      }
    });
  });

  icsContent.push("END:VCALENDAR");

  const blob = new Blob([icsContent.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `BITS_Timetable_${degree}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast("Exported timetable to BITS_Timetable.ics!", "success");
}

async function parseTimetablePDFFile(file) {
  try {
    const workerResponse = await fetch('pdf.worker.min.js');
    const workerText = await workerResponse.text();
    const workerBlob = new Blob([workerText], { type: 'application/javascript' });
    pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
  } catch (workerErr) {
    console.warn("Failed to create blob worker, falling back to direct URL reference:", workerErr);
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js';
  }
  
  const arrayBuffer = await file.arrayBuffer();
  const typedArray = new Uint8Array(arrayBuffer);
  const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map(item => item.str).join(' ');
    fullText += pageText + '\n';
  }
  
  return parseTimetablePDF(fullText);
}

function parseTimetablePDF(text) {
  const lines = text.split('\n');
  const coursesMap = {};
  const examMap = [];
  
  const courseCodeRegex = /\b([A-Z]{2,5})\s*([F|C|G|K|A-Z]?\d{3,4}(?:-\d)?)\b/;
  const sectionRegex = /\b([LTP]\d+)\b/;
  const dayTokens = ['M', 'T', 'W', 'Th', 'F', 'S'];
  const dateRegex = /\b(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)\b/;
  
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const codeMatch = trimmed.match(courseCodeRegex);
    if (!codeMatch) continue;
    
    const code = `${codeMatch[1]} ${codeMatch[2]}`;
    
    // Check if line contains Exam Info (Midsem / Compre)
    const dateMatch = trimmed.match(dateRegex);
    if (dateMatch || trimmed.toLowerCase().includes('midsem') || trimmed.toLowerCase().includes('compre') || trimmed.includes('FN') || trimmed.includes('AN')) {
      const type = trimmed.toLowerCase().includes('midsem') ? 'Midsem' : (trimmed.toLowerCase().includes('compre') ? 'Compre' : 'Exam');
      const timeSlot = trimmed.includes('FN') ? 'Forenoon (9:30 AM)' : (trimmed.includes('AN') ? 'Afternoon (2:00 PM)' : 'Scheduled');
      const examDate = dateMatch ? dateMatch[1] : 'TBA';
      
      if (!examMap.some(e => e.code === code && e.type === type)) {
        examMap.push({
          code,
          type,
          date: examDate,
          time: timeSlot
        });
      }
    }

    const secMatch = trimmed.match(sectionRegex);
    if (!secMatch) continue;
    const secName = secMatch[1];
    
    const parts = trimmed.split(codeMatch[0]);
    const rightSide = parts[1] ? parts[1].trim() : '';
    
    const subParts = rightSide.split(secName);
    const titleText = subParts[0] ? subParts[0].trim() : '';
    const detailsText = subParts[1] ? subParts[1].trim() : '';
    
    let title = titleText.replace(/\b\d+(?:\.\d+)?\b/g, '')
                         .replace(/[^a-zA-Z\s]/g, '')
                         .replace(/\s+/g, ' ')
                         .trim();
    if (!title) title = "Course Title";
    title = toTitleCase(title);
    
    const words = detailsText.split(/\s+/);
    const parsedDays = [];
    const parsedHours = [];
    const instructorWords = [];
    
    words.forEach(word => {
      if (dayTokens.includes(word) || word === 'Th') {
        parsedDays.push(word);
      } else if (/^\d+$/.test(word)) {
        parsedHours.push(parseInt(word));
      } else {
        if (word && !/^[0-9A-Z\-\/]+$/.test(word)) {
          instructorWords.push(word);
        }
      }
    });
    
    let instructor = instructorWords.join(' ').trim();
    if (!instructor || instructor.length < 3) instructor = "BITS Faculty";
    instructor = toTitleCase(instructor);
    
    const slots = [];
    parsedDays.forEach(d => {
      parsedHours.forEach(h => {
        slots.push({ day: d, hour: h });
      });
    });
    
    if (slots.length === 0) continue;
    
    if (!coursesMap[code]) {
      coursesMap[code] = {
        code,
        name: title,
        sections: {
          lectures: [],
          tutorials: [],
          practicals: []
        }
      };
    }
    
    let secGroup = 'lectures';
    if (secName.startsWith('T')) secGroup = 'tutorials';
    if (secName.startsWith('P')) secGroup = 'practicals';
    
    const sectId = `${code.replace(/\s+/g, '').toLowerCase()}-${secName.toLowerCase()}`;
    
    if (!coursesMap[code].sections[secGroup].some(s => s.id === sectId)) {
      coursesMap[code].sections[secGroup].push({
        id: sectId,
        name: secName,
        instructor,
        slots
      });
    }
  }
  
  if (examMap.length > 0) {
    workspaceStorage.setItem('custom_timetable_exams', JSON.stringify(examMap));
  }
  
  return Object.values(coursesMap);
}

function renderExamScheduleList() {
  const container = document.getElementById('timetable-exam-list');
  if (!container) return;
  
  const exams = JSON.parse(workspaceStorage.getItem('custom_timetable_exams') || '[]');
  const selectedSections = getSelectedTimetableSections();

  if (exams.length === 0) {
    container.innerHTML = `
      <div style="font-size: 0.85rem; color: var(--text-secondary); text-align: center; padding: 1rem;">
        Upload your BITS Timetable PDF to view Midsem & Compre exam dates for your enrolled courses.
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  exams.forEach(exam => {
    const card = document.createElement('div');
    card.style.cssText = `
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      padding: 0.75rem 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    `;

    const isMidsem = exam.type === 'Midsem';

    card.innerHTML = `
      <div style="display: flex; align-items: center; gap: 0.75rem;">
        <span style="font-size: 0.7rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 6px; background: ${isMidsem ? 'rgba(59, 130, 246, 0.15)' : 'rgba(168, 85, 247, 0.15)'}; color: ${isMidsem ? '#60a5fa' : '#c084fc'}; border: 1px solid ${isMidsem ? 'rgba(59, 130, 246, 0.3)' : 'rgba(168, 85, 247, 0.3)'};">
          ${escapeHtml(exam.type)}
        </span>
        <div>
          <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary);">${escapeHtml(exam.code)}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(exam.time)}</div>
        </div>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--color-accent);">${escapeHtml(exam.date)}</div>
      </div>
    `;

    container.appendChild(card);
  });
}

function handleTimetableFreezeToggle() {
  const isFrozen = workspaceStorage.getItem('timetable_frozen') === 'true';
  const degree = workspaceStorage.getItem('timetable_degree');
  
  if (isFrozen) {
    workspaceStorage.setItem('timetable_frozen', 'false');
    showToast("Timetable unfrozen. Planning mode enabled.", "success");
  } else {
    workspaceStorage.setItem('timetable_frozen', 'true');
    showToast("Timetable frozen! Selections locked.", "success");
  }
  
  if (degree) {
    renderTimetableWorkspace(degree);
  }
  lucide.createIcons();
}

// ================= RESOURCES DIRECTORY SPREADSHEET MODULE =================
let activeResourceEditIndex = -1;
let activeResourceEditField = ''; // 'url' or 'desc'

function renderResourcesSpreadsheet() {
  const tbody = document.getElementById('resources-spreadsheet-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  let resources = [];
  try {
    resources = JSON.parse(workspaceStorage.getItem('univault_resources') || '[]');
  } catch (e) {
    resources = [];
  }
  
  resources.forEach((resource, index) => {
    const tr = document.createElement('tr');
    tr.style.cssText = 'border-bottom: 1px solid var(--border-color); font-size: 0.85rem; height: 48px;';
    
    // Index Cell
    const tdIndex = document.createElement('td');
    tdIndex.style.cssText = 'padding: 0.75rem 1rem; text-align: center; color: var(--text-secondary); border-right: 1px solid var(--border-color); font-weight: 600;';
    tdIndex.innerText = index + 1;
    tr.appendChild(tdIndex);
    
    // URL Link Cell
    const tdUrl = document.createElement('td');
    tdUrl.style.cssText = 'padding: 0.75rem 1rem; border-right: 1px solid var(--border-color); position: relative;';
    
    if (activeResourceEditIndex === index && activeResourceEditField === 'url') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = resource.url;
      input.className = 'form-control';
      input.style.cssText = 'width: 100%; font-size: 0.85rem; padding: 4px 8px; height: 32px; background: rgba(255,255,255,0.05); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;';
      
      let finished = false;
      function saveUrl() {
        if (finished) return;
        finished = true;
        
        let newUrl = input.value.trim();
        if (newUrl) {
          // Auto-prepend https:// if missing protocol
          if (!/^https?:\/\//i.test(newUrl)) {
            newUrl = 'https://' + newUrl;
          }
          resource.url = newUrl;
          workspaceStorage.setItem('univault_resources', JSON.stringify(resources));
        }
        activeResourceEditIndex = -1;
        activeResourceEditField = '';
        renderResourcesSpreadsheet();
      }
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveUrl();
        if (e.key === 'Escape') {
          finished = true;
          activeResourceEditIndex = -1;
          activeResourceEditField = '';
          renderResourcesSpreadsheet();
        }
      });
      input.addEventListener('blur', saveUrl);
      tdUrl.appendChild(input);
      
      // Auto focus
      setTimeout(() => {
        input.focus();
        input.select();
      }, 50);
    } else {
      const container = document.createElement('div');
      container.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;';
      
      const link = document.createElement('a');
      link.href = /^https?:\/\//i.test(resource.url) ? resource.url : '#';
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      link.style.cssText = `
        color: var(--color-purple);
        font-weight: 600;
        text-decoration: none;
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        background: rgba(221, 140, 150, 0.1);
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 0.75rem;
        border: 1px solid rgba(221, 140, 150, 0.2);
        transition: all 0.2s;
      `;
      link.innerHTML = `Visit Link <i data-lucide="external-link" style="width: 12px; height: 12px;"></i>`;
      link.addEventListener('mouseenter', () => {
        link.style.background = 'rgba(221, 140, 150, 0.2)';
      });
      link.addEventListener('mouseleave', () => {
        link.style.background = 'rgba(221, 140, 150, 0.1)';
      });
      container.appendChild(link);
      
      const editIcon = document.createElement('span');
      editIcon.style.cssText = 'opacity: 0; cursor: pointer; transition: opacity 0.2s; color: var(--text-secondary);';
      editIcon.innerHTML = `<i data-lucide="edit-2" style="width: 12px; height: 12px;"></i>`;
      container.appendChild(editIcon);
      
      tr.addEventListener('mouseenter', () => { editIcon.style.opacity = '0.7'; });
      tr.addEventListener('mouseleave', () => { editIcon.style.opacity = '0'; });
      
      tdUrl.addEventListener('dblclick', () => {
        activeResourceEditIndex = index;
        activeResourceEditField = 'url';
        renderResourcesSpreadsheet();
      });
      
      editIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        activeResourceEditIndex = index;
        activeResourceEditField = 'url';
        renderResourcesSpreadsheet();
      });
      
      tdUrl.appendChild(container);
    }
    tr.appendChild(tdUrl);
    
    // Description Cell
    const tdDesc = document.createElement('td');
    tdDesc.style.cssText = 'padding: 0.75rem 1rem; border-right: 1px solid var(--border-color); position: relative;';
    
    if (activeResourceEditIndex === index && activeResourceEditField === 'desc') {
      const input = document.createElement('input');
      input.type = 'text';
      input.value = resource.desc;
      input.className = 'form-control';
      input.style.cssText = 'width: 100%; font-size: 0.85rem; padding: 4px 8px; height: 32px; background: rgba(255,255,255,0.05); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 4px;';
      
      let finished = false;
      function saveDesc() {
        if (finished) return;
        finished = true;
        
        const newDesc = input.value.trim();
        if (newDesc) {
          resource.desc = newDesc;
          workspaceStorage.setItem('univault_resources', JSON.stringify(resources));
        }
        activeResourceEditIndex = -1;
        activeResourceEditField = '';
        renderResourcesSpreadsheet();
      }
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') saveDesc();
        if (e.key === 'Escape') {
          finished = true;
          activeResourceEditIndex = -1;
          activeResourceEditField = '';
          renderResourcesSpreadsheet();
        }
      });
      input.addEventListener('blur', saveDesc);
      tdDesc.appendChild(input);
      
      setTimeout(() => {
        input.focus();
        input.select();
      }, 50);
    } else {
      const container = document.createElement('div');
      container.style.cssText = 'display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;';
      
      const descSpan = document.createElement('span');
      descSpan.style.cssText = 'color: var(--text-primary); font-weight: 500;';
      descSpan.innerText = resource.desc;
      container.appendChild(descSpan);
      
      const editIcon = document.createElement('span');
      editIcon.style.cssText = 'opacity: 0; cursor: pointer; transition: opacity 0.2s; color: var(--text-secondary);';
      editIcon.innerHTML = `<i data-lucide="edit-2" style="width: 12px; height: 12px;"></i>`;
      container.appendChild(editIcon);
      
      tr.addEventListener('mouseenter', () => { editIcon.style.opacity = '0.7'; });
      tr.addEventListener('mouseleave', () => { editIcon.style.opacity = '0'; });
      
      tdDesc.addEventListener('dblclick', () => {
        activeResourceEditIndex = index;
        activeResourceEditField = 'desc';
        renderResourcesSpreadsheet();
      });
      
      editIcon.addEventListener('click', (e) => {
        e.stopPropagation();
        activeResourceEditIndex = index;
        activeResourceEditField = 'desc';
        renderResourcesSpreadsheet();
      });
      
      tdDesc.appendChild(container);
    }
    tr.appendChild(tdDesc);
    
    // Actions Cell (Delete Row)
    const tdActions = document.createElement('td');
    tdActions.style.cssText = 'padding: 0.75rem 1rem; text-align: center;';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'action-icon delete';
    deleteBtn.title = 'Delete Row';
    deleteBtn.innerHTML = `<i data-lucide="trash-2" style="width: 16px; height: 16px;"></i>`;
    
    deleteBtn.addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete row ${index + 1}?`)) {
        resources.splice(index, 1);
        workspaceStorage.setItem('univault_resources', JSON.stringify(resources));
        showToast("Row deleted successfully.", "success");
        renderResourcesSpreadsheet();
      }
    });
    
    tdActions.appendChild(deleteBtn);
    tr.appendChild(tdActions);
    
    tbody.appendChild(tr);
  });
  
  lucide.createIcons();
}

function handleAddResourceRow() {
  let resources = [];
  try {
    resources = JSON.parse(workspaceStorage.getItem('univault_resources') || '[]');
  } catch (e) {
    resources = [];
  }
  
  resources.push({
    url: 'https://',
    desc: 'Enter reference description...'
  });
  
  workspaceStorage.setItem('univault_resources', JSON.stringify(resources));
  
  // Auto-focus URL editing on new row
  activeResourceEditIndex = resources.length - 1;
  activeResourceEditField = 'url';
  
  showToast("Added new blank row. Double-click cells to customize!", "success");
  renderResourcesSpreadsheet();
}

// ================= SETTINGS & SYNC MODULE =================
function handleExportBackup() {
  persistPendingNotes();
  const data = backend.snapshot();
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `univault-workspace-${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
  showToast('Workspace backup downloaded. Uploaded files remain in your material vault.');
}

async function handleCopySyncCode() {
  try {
    persistPendingNotes();
    const data = JSON.stringify(backend.snapshot());
    await navigator.clipboard.writeText(btoa(unescape(encodeURIComponent(data))));
    showToast('Workspace backup code copied.');
  } catch (error) {showToast('Could not copy. Download a backup file instead.','error');}
}

function applyImportData(data) {
  let snapshot;
  if (data.version === 1) snapshot = validateSnapshot(data);
  else {
    if (!Array.isArray(data.semesters) || !Array.isArray(data.courses)) throw new Error('Invalid backup format.');
    const values = backend.snapshot().values;
    values.univault_semesters = JSON.stringify(data.semesters);
    values.univault_courses = JSON.stringify(data.courses);
    const legacyFields = {customTagLabels:'univault_custom_tags',timetableDegree:'timetable_degree',timetableSelected:'timetable_selected_sections',timetableFrozen:'timetable_frozen',customTimetableCourses:'custom_timetable_courses',resources:'univault_resources'};
    for (const [field,key] of Object.entries(legacyFields)) if (typeof data[field] === 'string') values[key] = data[field];
    snapshot = validateSnapshot({version:1,values});
  }
  if (!confirm('Replace this workspace with the imported backup? Uploaded files will stay in your material vault.')) return;
  for (const key of WORKSPACE_KEYS) {
    if (snapshot.values[key] === null) workspaceStorage.removeItem(key);
    else workspaceStorage.setItem(key,snapshot.values[key]);
  }
  refreshWorkspaceViews().catch(() => showToast('Please reload to view the imported workspace.','error'));
  showToast('Backup restored.');
}

function handleImportFileChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      applyImportData(data);
    } catch (err) {
      console.error(err);
      showToast("Failed to parse file: Ensure it is a valid UniVault backup.", "error");
    }
  };
  reader.readAsText(file);
}

function handleImportSyncCode() {
  const input = document.getElementById('text-sync-code-input');
  if (!input) return;
  
  const code = input.value.trim();
  if (!code) {
    showToast("Please paste a valid sync code first.", "error");
    return;
  }
  
  try {
    const decodedStr = decodeURIComponent(escape(atob(code)));
    const data = JSON.parse(decodedStr);
    applyImportData(data);
  } catch (err) {
    console.error(err);
    showToast("Invalid sync code pattern. Please check and try again.", "error");
  }
}

// ================= CLOUD WORKSPACE CONTROLS =================
function updateBackendStatus(next) {
  lastCloudStatus = next;
  const local = !backend?.signedIn;
  const message = local ? 'Saved on this device only' : next.message;
  const status = document.getElementById('backend-status');
  if (status) {status.textContent = message; status.dataset.state = local ? 'local' : next.state;}
  const settingsStatus = document.getElementById('cloud-sync-status');
  if (settingsStatus) settingsStatus.textContent = message;
  const account = document.getElementById('backend-account');
  if (account) account.textContent = backend?.user?.email || 'Local workspace';
  const syncButton = document.getElementById('btn-sync-now');
  if (syncButton) syncButton.disabled = local || ['loading','saving'].includes(next.state);
  const reloadButton = document.getElementById('btn-reload-cloud');
  if (reloadButton) reloadButton.hidden = next.state !== 'conflict';
  const migration = document.getElementById('browser-migration-card');
  if (migration) {
    const legacy = backend?.legacySnapshot();
    const hasData = legacy && WORKSPACE_KEYS.some(key => legacy.values[key] !== null && !['[]','{}',''].includes(legacy.values[key]));
    migration.hidden = local || !hasData;
  }
  const storageLabel = document.querySelector('.version-info');
  if (storageLabel) storageLabel.lastChild.textContent = local ? ' Saved on this device' : ' Private cloud workspace';
}

function persistPendingNotes() {
  if (!activeCourseId || !notesSaveTimeout) return;
  clearTimeout(notesSaveTimeout);
  notesSaveTimeout = null;
  const course = state.courses.find(item => item.id === activeCourseId);
  if (course) {course.notes = document.getElementById('detail-notes-textarea').value; saveStateToStorage();}
}

async function refreshWorkspaceViews() {
  loadStateFromStorage();
  calendarEventsList = JSON.parse(workspaceStorage.getItem('calendar_events_list') || '[]');
  await renderBoard();
  await renderMetrics();
  updateGlobalFiltersSelect();
  if (activeTab === 'calendar' || activeTab === 'todo') {generateDays(); renderCalendar();}
  if (activeTab === 'materials') await renderMaterialsVault();
  if (activeTab === 'cgpa') renderCgpaCalculator();
  if (activeTab === 'timetable') initTimetablePlanner();
  if (activeTab === 'resources') renderResourcesSpreadsheet();
  if (activeTab === 'course-detail' && activeCourseId) {
    if (state.courses.some(course => course.id === activeCourseId)) await openCourseDetail(activeCourseId);
    else handleNavigation('dashboard');
  }
}

async function readLegacyFiles() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open(DB_NAME,DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {database.close(); resolve([]); return;}
      const transaction = database.transaction(STORE_NAME,'readonly');
      const files = transaction.objectStore(STORE_NAME).getAll();
      files.onsuccess = () => {database.close(); resolve(files.result || []);};
      files.onerror = () => {database.close(); reject(files.error);};
    };
  });
}

async function importBrowserWorkspace() {
  const buttons = ['btn-migrate-local','btn-retry-file-import'].map(id => document.getElementById(id));
  buttons.forEach(button => button.disabled = true);
  try {
    const {failedFiles} = await backend.importLegacy(await readLegacyFiles());
    await refreshWorkspaceViews();
    document.getElementById('btn-retry-file-import').hidden = failedFiles.length === 0;
    document.getElementById('migration-result').textContent = failedFiles.length ? `${failedFiles.length} files could not upload. Your originals are still saved in this browser. Retry when connected.` : 'Your browser workspace is now in your account. The original local copy is unchanged.';
    showToast(failedFiles.length ? 'Imported your workspace. Some files still need to upload.' : 'Workspace and files imported.','success');
  } catch (error) {showToast(error.message,'error');}
  finally {buttons.forEach(button => button.disabled = false);}
}

// ================= WORKSPACE INTERFACE =================
function closeWorkspaceNavigation() {
  document.body.classList.remove('navigation-open');
  const toggle = document.getElementById('menu-toggle');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  const scrim = document.getElementById('sidebar-scrim');
  if (scrim) scrim.hidden = true;
  const sidebar = document.getElementById('app-sidebar');
  if (sidebar) sidebar.inert = window.matchMedia('(max-width: 700px)').matches;
}

function setStudyView(mode,animated=true) {
  const stage=document.getElementById('room-stage');const fromRoom=stage.dataset.view==='room';stage.dataset.view=mode;
  if(mode==='shelf' && fromRoom)document.getElementById('shelf-workspace').scrollTo({top:0,left:0});
  document.getElementById('shelf-workspace').hidden=mode!=='shelf';
  document.getElementById('room-hotspots').hidden=mode!=='room';
  const navToolbar=document.getElementById('room-nav-toolbar');if(navToolbar)navToolbar.hidden=mode!=='room';
  const navHint=document.getElementById('room-nav-hint');if(navHint)navHint.hidden=mode!=='room';
  document.getElementById('btn-return-room').hidden=mode!=='shelf';
  document.getElementById('room-instruction').textContent=mode==='shelf'?'Your semesters, bound together.':'Pick a spot. Make yourself at home.';
  studyRoom?.pose(mode,animated);
  if(mode==='shelf')document.getElementById('course-shelf-heading').focus({preventScroll:true});
  else document.getElementById('btn-open-bookshelf').focus({preventScroll:true});
}
function initializeStudyRoom() {
  bookReader=new BookReader({getBlob:async file=>file.content || await backend.downloadFile(file),download:downloadFileRecord,onEdit:openCourseModal,
    onChange: course => {persistPendingNotes();saveStateToStorage();},
    onUpload:handleFileUpload,
    onDelete:async file => {if(confirm(`Delete ${file.name}?`)){await deleteFile(file.id);await renderCourseDetailFiles();await renderMetrics();}}
  });
  try {studyRoom=new StudyRoom(document.getElementById('room-canvas-wrap'),document.getElementById('room-stage'),{onShelf:()=>setStudyView('shelf'),onNavigate:handleNavigation});studyRoom.update(state.semesters,state.courses);}
  catch(error){document.getElementById('room-stage').classList.add('room-unavailable');console.warn('Room rendering is unavailable; the accessible bookshelf remains available.');}
  document.body.classList.add('in-study-room');
}

function initializeWorkspaceInterface() {
  const date = new Date();
  const dateElement = document.getElementById('workspace-date');
  dateElement.dateTime = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  dateElement.textContent = date.toLocaleDateString(undefined, {weekday:'short', day:'numeric', month:'short', year:'numeric'});
  document.getElementById('nav-dashboard').setAttribute('aria-current', 'page');
  document.querySelectorAll('.nav-item button').forEach(button => button.title = button.textContent.trim());
  document.getElementById('dashboard-search').addEventListener('input', applyDashboardFilters);
  document.getElementById('dashboard-semester-filter').addEventListener('change', applyDashboardFilters);
  document.getElementById('btn-open-bookshelf').addEventListener('click',()=>setStudyView('shelf'));
  document.getElementById('btn-return-room').addEventListener('click',()=>setStudyView('room'));
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => studyRoom?.zoomBy(-2.4));
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => studyRoom?.zoomBy(2.4));
  document.getElementById('btn-focus-table')?.addEventListener('click', () => studyRoom?.focusTable());
  document.getElementById('btn-reset-view')?.addEventListener('click', () => studyRoom?.resetView());
  try { lucide?.createIcons(); } catch {}
  document.getElementById('btn-room-journal').addEventListener('click',()=>{
    const panel=document.getElementById('room-journal');panel.hidden=!panel.hidden;
    document.getElementById('btn-room-journal').setAttribute('aria-expanded',String(!panel.hidden));
  });
  document.querySelectorAll('[data-study-view]').forEach(button => {
    button.addEventListener('click', () => handleNavigation(button.dataset.studyView));
  });
  document.getElementById('menu-toggle').addEventListener('click', () => {
    const open = document.body.classList.toggle('navigation-open');
    document.getElementById('menu-toggle').setAttribute('aria-expanded', String(open));
    document.getElementById('sidebar-scrim').hidden = !open;
    document.getElementById('app-sidebar').inert = !open;
    if (open) document.getElementById('sidebar-close').focus();
  });
  const closeMenu = () => { closeWorkspaceNavigation(); document.getElementById('menu-toggle').focus(); };
  document.getElementById('sidebar-scrim').addEventListener('click', closeMenu);
  document.getElementById('sidebar-close').addEventListener('click', closeMenu);
  const mobileQuery = window.matchMedia('(max-width: 700px)');
  const updateNavigation = () => {
    document.getElementById('app-sidebar').inert = mobileQuery.matches && !document.body.classList.contains('navigation-open');
    if (!mobileQuery.matches) closeWorkspaceNavigation();
  };
  mobileQuery.addEventListener('change', updateNavigation);
  updateNavigation();
  initializeDialogAccessibility();
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && document.body.classList.contains('navigation-open')) {
      closeWorkspaceNavigation();
      document.getElementById('menu-toggle').focus();
    }
    if (event.key === 'Escape') document.querySelector('.dashboard-tools').open = false;
    if (event.key === 'Tab' && document.body.classList.contains('navigation-open')) {
      containKeyboardFocus(event, document.getElementById('app-sidebar'));
    }
  });
  document.addEventListener('click', event => {
    const tools = document.querySelector('.dashboard-tools');
    if (!tools.contains(event.target) || event.target.closest('.dashboard-tools-menu button')) tools.open = false;
  });
  // Give existing icon-only buttons accessible names without changing their actions.
  document.querySelectorAll('button[title]').forEach(button => {
    if (!button.getAttribute('aria-label')) button.setAttribute('aria-label', button.title);
  });
  document.querySelectorAll('.folder-dropzone').forEach(zone => {
    zone.tabIndex = 0;
    zone.setAttribute('role', 'button');
    zone.setAttribute('aria-label', zone.querySelector('.dropzone-txt').textContent);
    zone.addEventListener('keydown', event => {
      if (event.target === zone && (event.key === 'Enter' || event.key === ' ')) {event.preventDefault(); zone.click();}
    });
  });
  document.getElementById('detail-new-req-input').setAttribute('aria-label', 'New course task');
  document.getElementById('detail-notes-textarea').setAttribute('aria-label', 'Course notes');
  document.getElementById('btn-prev-month').setAttribute('aria-label', 'Previous month');
  document.getElementById('btn-next-month').setAttribute('aria-label', 'Next month');
  document.querySelectorAll('.modal-close').forEach(button => button.setAttribute('aria-label', 'Close dialog'));
}

function syncDashboardSemesterFilter() {
  const select = document.getElementById('dashboard-semester-filter');
  if (!select) return;
  const selected = select.value;
  select.replaceChildren(new Option('All semesters', 'all'));
  state.semesters.forEach(semester => select.add(new Option(semester.name, semester.id)));
  select.value = state.semesters.some(semester => semester.id === selected) ? selected : 'all';
}

function applyDashboardFilters() {
  const input = document.getElementById('dashboard-search');
  if (!input) return;
  const query = input.value.trim().toLocaleLowerCase();
  const semesterId = document.getElementById('dashboard-semester-filter').value;
  let visibleCourses = 0;
  document.querySelectorAll('#semester-board .semester-column').forEach(column => {
    let matches = 0;
    column.querySelectorAll('.course-card').forEach(card => {
      const course = state.courses.find(item => item.id === card.dataset.id);
      const match = !!course && [course.name, course.code].join(' ').toLocaleLowerCase().includes(query);
      card.hidden = !match;
      if (match) matches++;
    });
    column.hidden = (semesterId !== 'all' && column.dataset.id !== semesterId) || (!!query && matches === 0);
    if (!column.hidden) visibleCourses += matches;
  });
  document.getElementById('board-result-count').textContent = visibleCourses;
  document.getElementById('dashboard-search-status').textContent = `${visibleCourses} ${visibleCourses === 1 ? 'course' : 'courses'} found`;
  let empty = document.getElementById('dashboard-no-results');
  const noResults = state.semesters.length > 0 && !Array.from(document.querySelectorAll('#semester-board .semester-column')).some(column => !column.hidden);
  if (noResults && !empty) {
    empty = document.createElement('div');
    empty.id = 'dashboard-no-results';
    empty.className = 'empty-state';
    const heading = document.createElement('h3');
    heading.textContent = 'No matching courses';
    const description = document.createElement('p');
    description.textContent = 'Try a different name, course code, or semester.';
    const reset = document.createElement('button');
    reset.className = 'btn btn-secondary';
    reset.textContent = 'Clear filters';
    reset.addEventListener('click', () => {
      input.value = '';
      document.getElementById('dashboard-semester-filter').value = 'all';
      applyDashboardFilters();
      input.focus();
    });
    empty.append(heading, description, reset);
    document.getElementById('semester-board').append(empty);
  }
  if (empty) empty.hidden = !noResults;
}

function renderDashboardOverview() {
  const list = document.getElementById('focus-task-list');
  if (!list) return;
  list.replaceChildren();
  const tasks = state.courses.flatMap(course => (course.checklist || []).map(task => ({course, task})));
  const pending = tasks.filter(item => !item.task.completed);
  const completed = tasks.length - pending.length;
  const progress = tasks.length ? Math.round(completed / tasks.length * 100) : 0;
  document.getElementById('focus-count').textContent = `${pending.length} left`;
  document.getElementById('focus-progress-label').textContent = `${completed} of ${tasks.length} tasks complete`;
  document.getElementById('focus-progress-value').textContent = `${progress}%`;
  document.getElementById('focus-progress-bar').style.width = `${progress}%`;
  if (!pending.length) {
    const message = document.createElement('p');
    message.className = 'focus-empty';
    message.textContent = tasks.length ? 'All caught up. A little breathing room, earned.' : 'Add tasks inside a course. Your next steps will appear here.';
    list.append(message);
  }
  pending.slice(0, 2).forEach(({course, task}) => {
    const button = document.createElement('button');
    button.className = 'focus-task';
    const icon = document.createElement('span');
    icon.className = 'focus-task-icon';
    icon.innerHTML = '<i data-lucide="arrow-up-right"></i>';
    const text = document.createElement('span');
    const label = document.createElement('strong');
    label.textContent = task.text;
    const code = document.createElement('small');
    code.textContent = course.code || course.name;
    text.append(label, code);
    button.append(icon, text);
    button.addEventListener('click', () => openCourseDetail(course.id));
    list.append(button);
  });
}


function containKeyboardFocus(event, container) {
  const items = Array.from(container.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]'))
    .filter(element => !element.disabled && element.getClientRects().length > 0 && element.type !== 'hidden');
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last.focus();}
  else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first.focus();}
}

function initializeDialogAccessibility() {
  const app = document.querySelector('.app-container');
  document.querySelectorAll('.modal-backdrop').forEach((backdrop, index) => {
    const dialog = backdrop.querySelector('.modal');
    const title = backdrop.querySelector('.modal-title');
    if (!dialog) return;
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    if (title) {
      title.id ||= `workspace-dialog-title-${index}`;
      dialog.setAttribute('aria-labelledby', title.id);
    }
    let returnFocus = null;
    new MutationObserver(() => {
      if (backdrop.classList.contains('active')) {
        returnFocus = document.activeElement;
        app.inert = true;
        document.body.classList.add('dialog-open');
        const target = dialog.querySelector('input:not([type="hidden"]), textarea, select') || dialog.querySelector('button');
        if (target) target.focus();
      } else {
        app.inert = false;
        document.body.classList.remove('dialog-open');
        if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({preventScroll: true});
      }
    }).observe(backdrop, {attributes:true, attributeFilter:['class']});
    backdrop.addEventListener('keydown', event => {
      if (event.key === 'Tab') containKeyboardFocus(event, dialog);
      if (event.key === 'Escape') {event.preventDefault(); backdrop.querySelector('.modal-close')?.click();}
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}
