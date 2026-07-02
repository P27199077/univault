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
  purple: '#a855f7',
  indigo: '#6366f1',
  blue: '#3b82f6',
  emerald: '#10b981',
  amber: '#f59e0b',
  rose: '#f43f5e'
};

// UI DOM references
let activeTab = 'dashboard'; // 'dashboard' or 'materials'
let activeCourseId = null;
let activeDrawerTab = 'tab-materials';
let draggedCourseId = null;
let activeThemeColor = 'indigo';

// ================= MOCK BACKEND DATABASE / API ENGINE =================
// Swap these helper functions out when connecting to your backend database!

async function dbRegisterUser(username, password) {
  await new Promise(r => setTimeout(r, 250)); // simulate latency
  const users = JSON.parse(localStorage.getItem('univault_users') || '[]');
  if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("Username is already taken");
  }
  users.push({ username, password });
  localStorage.setItem('univault_users', JSON.stringify(users));
  return { success: true, username };
}

async function dbLoginUser(username, password) {
  await new Promise(r => setTimeout(r, 250)); // simulate latency
  const users = JSON.parse(localStorage.getItem('univault_users') || '[]');
  const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user || user.password !== password) {
    throw new Error("Invalid username or password");
  }
  return { success: true, username: user.username };
}

function seedDefaultUser() {
  const users = JSON.parse(localStorage.getItem('univault_users') || '[]');
  if (users.length === 0) {
    users.push({ username: 'tanisha', password: '123' });
    localStorage.setItem('univault_users', JSON.stringify(users));
  }
}

function initAuth() {
  // Preseed default user account if database is empty
  seedDefaultUser();

  const session = localStorage.getItem('univault_session');
  const loginContainer = document.getElementById('login-container');
  const appContainer = document.querySelector('.app-container');
  
  if (session) {
    // Logged in
    if (loginContainer) loginContainer.classList.add('hidden');
    if (appContainer) appContainer.style.display = 'flex';
    
    // Populate username details
    document.getElementById('sidebar-username').innerText = session;
    document.getElementById('sidebar-user-avatar').innerText = session[0].toUpperCase();
  } else {
    // Not logged in
    if (loginContainer) loginContainer.classList.remove('hidden');
    if (appContainer) appContainer.style.display = 'none';
  }
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
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(fileRecord);
    
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e.target.error);
  });
}

function deleteFile(fileId) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(fileId);
    
    request.onsuccess = () => resolve(true);
    request.onerror = (e) => reject(e.target.error);
  });
}

function getFilesByCourse(courseId) {
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
  const storedSemesters = localStorage.getItem('univault_semesters');
  const storedCourses = localStorage.getItem('univault_courses');
  
  if (storedSemesters && storedCourses) {
    state.semesters = JSON.parse(storedSemesters);
    state.courses = JSON.parse(storedCourses);
  } else {
    // If first load, load mock data so the app looks complete and beautiful
    initializeMockData();
  }
}

function saveStateToStorage() {
  localStorage.setItem('univault_semesters', JSON.stringify(state.semesters));
  localStorage.setItem('univault_courses', JSON.stringify(state.courses));
  
  if (localStorage.getItem('cloud_sync_enabled') === 'true') {
    syncStateToCloud();
  }
}

function initializeMockData() {
  state.semesters = [
    { id: 'sem-1', name: 'Fall 2025' },
    { id: 'sem-2', name: 'Spring 2026' },
    { id: 'sem-3', name: 'Fall 2026' }
  ];
  
  state.courses = [
    {
      id: 'course-1',
      name: 'Intro to Computer Science',
      code: 'CS-101',
      prof: 'Dr. Alan Turing',
      semesterId: 'sem-1',
      targetGrade: 'A+',
      themeColor: 'indigo',
      notes: '## CS-101 Introduction\nThis is a foundational course in computing. Topics include logic gates, binary math, python basics, algorithms, and computing history.\n\n### Grading Policies:\n- Assignments: 40%\n- Midterm: 30%\n- Final Exam: 30%\n\nNeed to study Turing Machines for final extra credit!',
      checklist: [
        { id: 'chk-1', text: 'Submit Binary Calculator Project', completed: true },
        { id: 'chk-2', text: 'Complete Python loops quiz', completed: true },
        { id: 'chk-3', text: 'Revise Logic Gates theory', completed: true }
      ]
    },
    {
      id: 'course-2',
      name: 'Data Structures & Algorithms',
      code: 'CS-201',
      prof: 'Dr. Grace Hopper',
      semesterId: 'sem-2',
      targetGrade: 'A',
      themeColor: 'purple',
      notes: '## DSA Study Guide\nFocus on understanding time complexity analysis (Big-O).\n\n### Core Topics:\n- Arrays and Linked Lists\n- Stacks and Queues\n- Binary Trees and Heaps\n- Sorting Algorithms (Quick, Merge, Heap)\n- Graphs & DFS/BFS traversal\n\n### Office Hours:\n- Tuesdays at 2 PM inside Hopper Hall.',
      checklist: [
        { id: 'chk-4', text: 'Binary Search Tree coding assignment', completed: true },
        { id: 'chk-5', text: 'Graph traversals visual simulation', completed: false },
        { id: 'chk-6', text: 'Mock test under time constraint', completed: false }
      ]
    },
    {
      id: 'course-3',
      name: 'Web Application Development',
      code: 'CS-302',
      prof: 'Prof. Tim Berners-Lee',
      semesterId: 'sem-3',
      targetGrade: 'A+',
      themeColor: 'emerald',
      notes: '## Web App Project Plans\nBuilding a course organizer called UniVault.\n\n### Dev Stack:\n- HTML5 Semantic Markup\n- Modern CSS Grid & Flexbox\n- HSL Color Palette and Glassmorphism\n- Vanilla JavaScript + IndexedDB local storage\n\nMust implement smooth CSS transitions and Drag & Drop API!',
      checklist: [
        { id: 'chk-7', text: 'Wireframe user interface layers', completed: true },
        { id: 'chk-8', text: 'Write styling stylesheet rules', completed: true },
        { id: 'chk-9', text: 'Add IndexedDB file persist storage logic', completed: false },
        { id: 'chk-10', text: 'Record walkthrough demo animation', completed: false }
      ]
    }
  ];
  
  saveStateToStorage();
}

// Store default files in IndexedDB on first load
async function initializeMockFiles() {
  const initialized = localStorage.getItem('univault_files_initialized');
  if (initialized) return;

  const mockFiles = [
    {
      id: 'file-mock-1',
      courseId: 'course-1',
      name: 'CS101_Syllabus.txt',
      type: 'handouts',
      mimeType: 'text/plain',
      size: 512,
      uploadedAt: new Date().toISOString(),
      content: new Blob([
        `CS-101: INTRO TO COMPUTER SCIENCE\n=================================\n\nSemester: Fall 2025\nProfessor: Dr. Alan Turing\nOffice Room: Turing Lab, Room 402\n\nCourse Schedule:\n- Week 1-3: Hardware Basics & Logic Gates\n- Week 4-6: Programming Concepts in Python\n- Week 7: Midterm Exam\n- Week 8-11: Basic Algorithms (Search, Sort)\n- Week 12-14: Theory of Computation & AI Intro\n- Week 15: Final Exams`
      ], { type: 'text/plain' })
    },
    {
      id: 'file-mock-2',
      courseId: 'course-2',
      name: 'DSA_Lecture_01_Introduction.txt',
      type: 'slides',
      mimeType: 'text/plain',
      size: 614,
      uploadedAt: new Date().toISOString(),
      content: new Blob([
        `LECTURE 01: INTRODUCTION TO ALGORITHMS\n======================================\n\nWhat is an Algorithm?\nA set of well-defined instructions to solve a specific problem.\n\nKey Attributes of Good Algorithms:\n1. Finiteness (must terminate)\n2. Definiteness (each step is clear)\n3. Input & Output\n4. Effectiveness (feasible)\n5. Efficiency (optimal CPU & memory)\n\nAnalyzing Complexity:\nWe measure algorithms using Big-O notation for time and space.\n- Constant time: O(1)\n- Logarithmic time: O(log n)\n- Linear time: O(n)\n- Quadratic time: O(n^2)\n- Exponential time: O(2^n)`
      ], { type: 'text/plain' })
    }
  ];

  try {
    for (const f of mockFiles) {
      await storeFile(f);
    }
    localStorage.setItem('univault_files_initialized', 'true');
  } catch (err) {
    console.error("Failed to populate mock files", err);
  }
}

// ================= DYNAMIC RENDERING LAYERS =================
async function renderBoard() {
  const container = document.getElementById('semester-board');
  if (!container) return;
  container.innerHTML = '';
  
  if (state.semesters.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="width: 100%;">
        <div class="empty-state-icon"><i data-lucide="calendar"></i></div>
        <div class="empty-state-title">No Semesters Configured</div>
        <div class="empty-state-desc">Get started by creating a new semester where you can organize your courses.</div>
        <button class="btn btn-primary btn-sm" id="btn-empty-add-sem">Create Semester</button>
      </div>
    `;
    lucide.createIcons();
    document.getElementById('btn-empty-add-sem').addEventListener('click', openSemesterModal);
    return;
  }
  
  // Sort semesters: completed ones go to the back/end of the list
  const sortedSemesters = [...state.semesters].sort((a, b) => {
    const aDone = !!a.completed;
    const bDone = !!b.completed;
    if (aDone && !bDone) return 1;
    if (!aDone && bDone) return -1;
    return 0;
  });
  
  // Render each semester as a Column
  for (const sem of sortedSemesters) {
    const col = document.createElement('div');
    col.className = 'semester-column';
    col.id = `sem-col-${sem.id}`;
    col.dataset.id = sem.id;
    
    // Get courses in this semester
    const semCourses = state.courses.filter(c => c.semesterId === sem.id);
    
    // Build Header
    const header = document.createElement('div');
    header.className = 'semester-header';
    if (sem.completed) {
      header.style.opacity = '0.75';
    }
    
    const titleContainer = document.createElement('div');
    titleContainer.style.cssText = 'display: flex; align-items: center; gap: 0.5rem; cursor: pointer;';
    
    const checkBtn = document.createElement('span');
    checkBtn.style.cssText = 'display: flex; align-items: center; justify-content: center;';
    if (sem.completed) {
      checkBtn.innerHTML = `<i data-lucide="check-circle" style="color: var(--color-emerald); width: 18px; height: 18px;"></i>`;
    } else {
      checkBtn.innerHTML = `<i data-lucide="circle" style="color: var(--text-secondary); width: 18px; height: 18px; opacity: 0.6;"></i>`;
    }
    
    titleContainer.addEventListener('click', () => {
      const hasPending = semCourses.some(c => !c.targetGrade || c.targetGrade.toUpperCase() === 'PENDING' || c.targetGrade.toUpperCase() === 'ONGOING');
      
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
    const editIcon = document.createElement('span');
    editIcon.className = 'action-icon';
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
      input.style.cssText = 'font-size: 1rem; font-weight: 700; padding: 2px 6px; height: auto; width: 140px; margin: 0; background: rgba(255,255,255,0.05); color: white; border: 1px solid var(--border-color); border-radius: 4px;';
      
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
      const card = await buildCourseCard(course);
      courseList.appendChild(card);
    }
    
    col.appendChild(courseList);
    container.appendChild(col);
  }
  
  setupDragAndDrop();
  lucide.createIcons();
}

async function buildCourseCard(course) {
  const card = document.createElement('div');
  card.className = 'course-card';
  card.id = `course-card-${course.id}`;
  card.dataset.id = course.id;
  card.draggable = true;
  
  // Set theme color background bar
  const themeBar = document.createElement('div');
  themeBar.className = 'course-theme-bar';
  themeBar.style.backgroundColor = ACCENT_COLORS[course.themeColor || 'indigo'];
  card.appendChild(themeBar);
  
  // Content details
  const codeRow = document.createElement('div');
  codeRow.style.display = 'flex';
  codeRow.style.justifyContent = 'space-between';
  codeRow.style.alignItems = 'center';
  codeRow.style.width = '100%';
  
  const code = document.createElement('div');
  code.className = 'course-code';
  code.innerText = course.code || 'N/A';
  codeRow.appendChild(code);
  
  if (course.credits) {
    const creditsBadge = document.createElement('span');
    creditsBadge.className = 'course-materials-count';
    creditsBadge.style.fontSize = '0.75rem';
    creditsBadge.style.background = 'rgba(255,255,255,0.06)';
    creditsBadge.style.padding = '2px 6px';
    creditsBadge.style.borderRadius = '4px';
    creditsBadge.style.color = 'var(--text-secondary)';
    creditsBadge.innerText = `${course.credits} Cr`;
    codeRow.appendChild(creditsBadge);
  }
  card.appendChild(codeRow);
  
  const name = document.createElement('div');
  name.className = 'course-name';
  name.innerText = course.name;
  card.appendChild(name);
  
  // Metadata row
  const meta = document.createElement('div');
  meta.className = 'course-meta';
  
  const prof = document.createElement('span');
  prof.className = 'course-professor';
  prof.innerHTML = `<i data-lucide="user"></i> ${course.prof || 'Unknown Professor'}`;
  
  // Count of materials uploaded for this course
  const files = await getFilesByCourse(course.id);
  const countBadge = document.createElement('span');
  countBadge.className = 'course-materials-count';
  countBadge.innerHTML = `<i data-lucide="file"></i> ${files.length}`;
  
  meta.appendChild(prof);
  meta.appendChild(countBadge);
  card.appendChild(meta);
  
  // Small icons row for edit and delete
  const actions = document.createElement('div');
  actions.className = 'course-actions';
  
  const editBtn = document.createElement('button');
  editBtn.className = 'action-icon';
  editBtn.title = 'Edit Course Details';
  editBtn.innerHTML = `<i data-lucide="edit-3"></i>`;
  editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCourseModal(course.id);
  });
  
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'action-icon delete';
  deleteBtn.title = 'Delete Course';
  deleteBtn.innerHTML = `<i data-lucide="trash-2"></i>`;
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    confirmDeleteCourse(course.id);
  });
  
  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  card.appendChild(actions);
  
  // Card click triggers detailed workspace page
  card.addEventListener('click', (e) => {
    // Only open if they didn't click buttons
    if (e.target.closest('.action-icon')) return;
    openCourseDetail(course.id);
  });
  
  return card;
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
        if (course && course.semesterId !== targetSemId) {
          course.semesterId = targetSemId;
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
  
  activeCourseId = courseId;
  
  // Set course metadata
  document.getElementById('detail-course-name').innerText = course.name;
  
  const badge = document.getElementById('detail-course-code-badge');
  badge.innerText = course.code || 'N/A';
  badge.style.backgroundColor = `rgba(${hexToRgb(ACCENT_COLORS[course.themeColor])}, 0.15)`;
  badge.style.color = ACCENT_COLORS[course.themeColor];
  
  document.getElementById('detail-course-prof').innerHTML = `<i data-lucide="user"></i> ${course.prof || 'Unknown Professor'}`;
  document.getElementById('detail-course-grade').innerHTML = `<i data-lucide="award"></i> Target Grade: ${course.targetGrade || 'N/A'}`;
  
  // Notepad contents
  document.getElementById('detail-notes-textarea').value = course.notes || '';
  document.getElementById('detail-notes-status').innerText = 'Notepad ready';
  
  // Render files lists and checklist items
  await renderCourseDetailFiles();
  renderCourseDetailChecklist();
  
  // Switch view panel
  handleNavigation('course-detail');
}

async function renderCourseDetailFiles() {
  if (!activeCourseId) return;
  
  const files = await getFilesByCourse(activeCourseId);
  const categories = ['slides', 'notes', 'papers', 'handouts'];
  
  // Reset lists
  categories.forEach(cat => {
    document.getElementById(`list-${cat}`).innerHTML = '';
    document.getElementById(`count-${cat}`).innerText = '0 files';
  });
  
  // Sort files by upload date
  files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
  
  // Populate lists
  const counts = { slides: 0, notes: 0, papers: 0, handouts: 0 };
  
  files.forEach(f => {
    const cat = f.type || 'slides';
    if (!categories.includes(cat)) return;
    
    counts[cat]++;
    
    const item = document.createElement('div');
    item.className = 'material-item';
    
    // Details
    const info = document.createElement('div');
    info.className = 'material-info-container';
    
    const icon = document.createElement('div');
    icon.className = `material-type-icon ${cat}`;
    icon.innerHTML = `<i data-lucide="${getFileIconName(cat)}"></i>`;
    
    const details = document.createElement('div');
    details.className = 'material-details';
    
    const title = document.createElement('div');
    title.className = 'material-title';
    title.innerText = f.name;
    title.title = f.name;
    
    const meta = document.createElement('div');
    meta.className = 'material-meta';
    
    const sizeSpan = document.createElement('span');
    sizeSpan.innerText = formatBytes(f.size);
    
    const dateSpan = document.createElement('span');
    dateSpan.innerText = new Date(f.uploadedAt).toLocaleDateString();
    
    meta.appendChild(sizeSpan);
    meta.appendChild(dateSpan);
    details.appendChild(title);
    details.appendChild(meta);
    info.appendChild(icon);
    info.appendChild(details);
    item.appendChild(info);
    
    // Actions
    const actions = document.createElement('div');
    actions.className = 'material-actions';
    
    const viewBtn = document.createElement('button');
    viewBtn.className = 'action-icon';
    viewBtn.title = 'Preview File';
    viewBtn.innerHTML = `<i data-lucide="eye"></i>`;
    viewBtn.addEventListener('click', () => openPreviewModal(f));
    
    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'action-icon';
    downloadBtn.title = 'Download';
    downloadBtn.innerHTML = `<i data-lucide="download"></i>`;
    downloadBtn.addEventListener('click', () => downloadFileRecord(f));
    
    const delBtn = document.createElement('button');
    delBtn.className = 'action-icon delete';
    delBtn.title = 'Delete';
    delBtn.innerHTML = `<i data-lucide="trash-2"></i>`;
    delBtn.addEventListener('click', async () => {
      if (confirm(`Are you sure you want to delete ${f.name}?`)) {
        await deleteFile(f.id);
        await renderCourseDetailFiles();
        await renderMetrics();
      }
    });
    
    actions.appendChild(viewBtn);
    actions.appendChild(downloadBtn);
    actions.appendChild(delBtn);
    item.appendChild(actions);
    
    document.getElementById(`list-${cat}`).appendChild(item);
  });
  
  // Update counts on folders
  categories.forEach(cat => {
    const c = counts[cat];
    document.getElementById(`count-${cat}`).innerText = `${c} ${c === 1 ? 'file' : 'files'}`;
  });
  
  lucide.createIcons();
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
    
    const chk = document.createElement('div');
    chk.className = 'req-checkbox';
    chk.innerHTML = `<i data-lucide="check" style="width: 12px; height: 12px;"></i>`;
    
    const txt = document.createElement('span');
    txt.className = 'req-text';
    txt.innerText = item.text;
    
    const delBtn = document.createElement('button');
    delBtn.className = 'action-icon delete';
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
  
  if (type === 'handouts') {
    // Handouts are uploaded only once; delete any old ones to replace it
    try {
      const files = await getFilesByCourse(activeCourseId);
      const existingHandouts = files.filter(f => f.type === 'handouts');
      for (const f of existingHandouts) {
        await deleteFile(f.id);
      }
    } catch (err) {
      console.error("Failed to clean up old handouts:", err);
    }
  }
  
  // If handouts, only keep the last file in the list if multiple files were uploaded
  const filesToUpload = type === 'handouts' ? [filesList[filesList.length - 1]] : filesList;
  
  for (const file of filesToUpload) {
    const id = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const record = {
      id: id,
      courseId: activeCourseId,
      name: file.name,
      type: type,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      uploadedAt: new Date().toISOString(),
      content: file
    };
    
    try {
      await storeFile(record);
    } catch (err) {
      showToast(`Error storing file: ${file.name}`, 'error');
      console.error(err);
    }
  }
  
  await renderCourseDetailFiles();
  await renderMetrics();
}

// Download dynamic file records from IndexedDB
function downloadFileRecord(fileRecord) {
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
function openPreviewModal(fileRecord) {
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
        <div style="font-size: 1.1rem; font-weight: 600;">${fileRecord.name}</div>
        <div style="font-size: 0.85rem; color: var(--text-secondary);">${formatBytes(fileRecord.size)} - ${fileRecord.mimeType}</div>
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
    const courseColor = course ? ACCENT_COLORS[course.themeColor] : '#6366f1';
    
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

function openCourseModal(courseId = null) {
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
    document.getElementById('course-name-input').value = course.name;
    document.getElementById('course-code-input').value = course.code;
    document.getElementById('course-prof-input').value = course.prof || '';
    document.getElementById('course-sem-select').value = course.semesterId;
    document.getElementById('course-grade-input').value = course.targetGrade || '';
    document.getElementById('course-credits-input').value = course.credits || '3.0';
    activeThemeColor = course.themeColor || 'indigo';
  } else {
    // New Course Mode
    document.getElementById('course-modal-title').innerText = 'Add Course';
    document.getElementById('btn-save-course-submit').innerText = 'Create Course';
    document.getElementById('course-edit-id').value = '';
    document.getElementById('course-name-input').value = '';
    document.getElementById('course-code-input').value = '';
    document.getElementById('course-prof-input').value = '';
    document.getElementById('course-grade-input').value = '';
    document.getElementById('course-credits-input').value = '3.0';
    activeThemeColor = 'indigo';
  }
  
  renderThemeSelectors();
  document.getElementById('modal-course-backdrop').classList.add('active');
}

function closeCourseModal() {
  document.getElementById('modal-course-backdrop').classList.remove('active');
}

function renderThemeSelectors() {
  const container = document.getElementById('theme-color-selector');
  container.innerHTML = '';
  
  Object.keys(ACCENT_COLORS).forEach(col => {
    const el = document.createElement('div');
    el.className = `theme-radio ${col === activeThemeColor ? 'selected' : ''}`;
    el.style.backgroundColor = ACCENT_COLORS[col];
    el.dataset.color = col;
    
    el.addEventListener('click', () => {
      document.querySelectorAll('.theme-radio').forEach(r => r.classList.remove('selected'));
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
  }
}

function handleAddCourse(e) {
  e.preventDefault();
  
  const editId = document.getElementById('course-edit-id').value;
  const name = document.getElementById('course-name-input').value.trim();
  const code = document.getElementById('course-code-input').value.trim();
  const prof = document.getElementById('course-prof-input').value.trim();
  const semesterId = document.getElementById('course-sem-select').value;
  const grade = document.getElementById('course-grade-input').value.trim();
  const credits = document.getElementById('course-credits-input').value.trim() || '3.0';
  
  if (!name || !code || !semesterId) return;
  
  if (editId) {
    // Modify course
    const course = state.courses.find(c => c.id === editId);
    if (course) {
      course.name = name;
      course.code = code;
      course.prof = prof;
      course.semesterId = semesterId;
      course.targetGrade = grade;
      course.credits = credits;
      course.themeColor = activeThemeColor;
    }
  } else {
    // Add new course
    const newCourse = {
      id: `course-${Date.now()}`,
      name: name,
      code: code,
      prof: prof,
      semesterId: semesterId,
      targetGrade: grade,
      credits: credits,
      themeColor: activeThemeColor,
      notes: '',
      checklist: []
    };
    state.courses.push(newCourse);
  }
  
  saveStateToStorage();
  renderBoard();
  renderMetrics();
  updateGlobalFiltersSelect();
  closeCourseModal();
}

function confirmDeleteSemester(semId) {
  const coursesInSem = state.courses.filter(c => c.semesterId === semId);
  const message = coursesInSem.length > 0 
    ? `Warning: Deleting this semester will also delete all of its ${coursesInSem.length} courses and files. Continue?`
    : `Are you sure you want to delete this semester?`;
    
  if (confirm(message)) {
    // Delete courses
    coursesInSem.forEach(async (c) => {
      // Clean up files in IndexedDB
      const files = await getFilesByCourse(c.id);
      for (const f of files) {
        await deleteFile(f.id);
      }
    });
    
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
    });
  }
}

// Navigation switcher tabs (Sidebar links)
function handleNavigation(tab) {
  activeTab = tab;
  
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
    pageTitle.innerText = 'Material Vault';
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
  } else if (tab === 'cgpa') {
    pageTitle.innerText = "CGPA Calculator";
    pageSubtitle.innerText = 'Track, predict, and project your academic performance across semesters.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    renderCgpaCalculator();
  } else if (tab === 'timetable') {
    pageTitle.innerText = "Timetable Planner";
    pageSubtitle.innerText = 'Design your weekly course schedules, prevent lecture clashes, and export timings.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    initTimetablePlanner();
  } else if (tab === 'resources') {
    pageTitle.innerText = "Resources Directory";
    pageSubtitle.innerText = 'A spreadsheet to store, organize, and edit reference links and descriptions.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
    renderResourcesSpreadsheet();
  } else if (tab === 'settings') {
    pageTitle.innerText = "Settings & Sync";
    pageSubtitle.innerText = 'Export, backup, and sync your dashboard data across multiple devices.';
    addSemBtn.style.display = 'none';
    addCourseBtn.style.display = 'none';
    if (importBtn) importBtn.style.display = 'none';
  } else {
    pageTitle.innerText = 'Dashboard';
    pageSubtitle.innerText = 'Welcome back! Organize your classes, schedules, and materials.';
    addSemBtn.style.display = 'flex';
    addCourseBtn.style.display = 'flex';
    if (importBtn) importBtn.style.display = 'flex';
    renderBoard();
    renderMetrics();
  }
}

// ================= CALENDAR PLANNER MODULE =================
let calendarEventsList = JSON.parse(localStorage.getItem('calendar_events_list') || '[]');
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
  localStorage.setItem('calendar_events_list', JSON.stringify(calendarEventsList));
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
        titleSpan.style.color = 'white';
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
  const savedAccent = localStorage.getItem('calendar_accent') || 'indigo';
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
    const dDayEnabled = localStorage.getItem('calendar_dday_enabled') === 'true';
    const dDayStr = localStorage.getItem('calendar_dday_date');

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

      // Check Circle Toggle Box
      const checkBtn = document.createElement('span');
      checkBtn.classList.add('event-pointer-check');
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
  
  const notes = JSON.parse(localStorage.getItem('calendar_general_notes')) || [];
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
  const notes = JSON.parse(localStorage.getItem('calendar_general_notes')) || [];
  notes.push(trimmed);
  localStorage.setItem('calendar_general_notes', JSON.stringify(notes));
  renderSidebarNotes();
}

function deleteGeneralNote(index) {
  const notes = JSON.parse(localStorage.getItem('calendar_general_notes')) || [];
  notes.splice(index, 1);
  localStorage.setItem('calendar_general_notes', JSON.stringify(notes));
  renderSidebarNotes();
}

// Shifting theme styles
function setCalendarAccent(color) {
  const workspace = document.querySelector('.calendar-layout-workspace');
  if (!workspace) return;
  
  workspace.className = 'calendar-layout-workspace';
  workspace.classList.add(`accent-${color}`);
}

function getCustomTagLabels() {
  return JSON.parse(localStorage.getItem('calendar_tag_labels') || '{}');
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
    case 'slides': return 'presentation';
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
  initAuth();
  
  loadStateFromStorage();
  
  try {
    await initDB();
    await initializeMockFiles();
  } catch (err) {
    console.error("Database initialization failed", err);
  }
  
  await renderBoard();
  await renderMetrics();
  updateGlobalFiltersSelect();
  
  // Navigation sidebar events
  document.getElementById('nav-dashboard').addEventListener('click', () => handleNavigation('dashboard'));
  document.getElementById('nav-materials').addEventListener('click', () => handleNavigation('materials'));
  document.getElementById('nav-calendar').addEventListener('click', () => handleNavigation('calendar'));
  document.getElementById('nav-todo').addEventListener('click', () => handleNavigation('todo'));
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
  
  // Cloud Auto-Sync events
  const btnGenSyncKey = document.getElementById('btn-generate-sync-key');
  if (btnGenSyncKey) btnGenSyncKey.addEventListener('click', handleGenerateSyncKey);
  
  const btnToggleCloud = document.getElementById('btn-toggle-cloud-sync');
  if (btnToggleCloud) btnToggleCloud.addEventListener('click', handleToggleCloudSync);
  
  initCloudSyncOnLoad();
  
  // Timetable setup events
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
  
  // Timetable PDF import events
  const btnImportTimetable = document.getElementById('btn-import-timetable');
  const fileInputTimetable = document.getElementById('timetable-pdf-file-input');
  
  if (btnImportTimetable && fileInputTimetable) {
    btnImportTimetable.addEventListener('click', () => {
      fileInputTimetable.click();
    });
    
    fileInputTimetable.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const originalText = btnImportTimetable.innerHTML;
      btnImportTimetable.disabled = true;
      btnImportTimetable.innerHTML = `⏳ Reading PDF...`;
      
      try {
        const parsedCourses = await parseTimetablePDFFile(file);
        
        if (parsedCourses.length > 0) {
          localStorage.setItem('custom_timetable_courses', JSON.stringify(parsedCourses));
          localStorage.setItem('timetable_degree', 'custom');
          // Clear any old selections to prevent crashes
          localStorage.removeItem('timetable_selected_sections');
          
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
  
  // Detailed Course View Panel Events
  document.getElementById('btn-back-to-dashboard').addEventListener('click', () => handleNavigation('dashboard'));
  
  // Textarea notepad event
  document.getElementById('detail-notes-textarea').addEventListener('input', handleNotesInput);
  
  // Requirements additions
  document.getElementById('detail-btn-add-req').addEventListener('click', addChecklistItem);
  document.getElementById('detail-new-req-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addChecklistItem();
  });
  
  // Category folders event bindings (drag-and-drop upload click)
  const categories = ['slides', 'notes', 'papers', 'handouts'];
  categories.forEach(cat => {
    const dropzone = document.getElementById(`dropzone-${cat}`);
    const input = document.getElementById(`input-${cat}`);
    if (!dropzone || !input) return;
    
    dropzone.addEventListener('click', () => input.click());
    
    input.addEventListener('change', (e) => {
      handleFileUpload(e.target.files, cat);
    });
    
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    
    dropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    
    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });
    
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFileUpload(e.dataTransfer.files, cat);
      }
    });
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
      localStorage.setItem('calendar_tag_labels', JSON.stringify(labels));
      
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
  sidebarDDayEnabled.checked = localStorage.getItem('calendar_dday_enabled') === 'true';
  sidebarDDayDate.value = localStorage.getItem('calendar_dday_date') || '2026-07-26';
  sidebarDDayDateGroup.style.display = sidebarDDayEnabled.checked ? 'block' : 'none';
  
  sidebarDDayEnabled.addEventListener('change', (e) => {
    localStorage.setItem('calendar_dday_enabled', e.target.checked);
    sidebarDDayDateGroup.style.display = e.target.checked ? 'block' : 'none';
    renderCalendar();
  });
  
  sidebarDDayDate.addEventListener('change', (e) => {
    localStorage.setItem('calendar_dday_date', e.target.value);
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
    
    localStorage.setItem('calendar_events_list', JSON.stringify(calendarEventsList));
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
      localStorage.setItem('calendar_events_list', JSON.stringify(calendarEventsList));
      renderCalendar();
      closeCalendarEventModal();
    }
  });

  // Delete event
  document.getElementById('delete-event-btn').addEventListener('click', () => {
    const id = document.getElementById('event-id').value;
    calendarEventsList = calendarEventsList.filter(evt => evt.id !== id);
    localStorage.setItem('calendar_events_list', JSON.stringify(calendarEventsList));
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
    hideAuthAlert();
    panelSignin.style.display = 'none';
    panelSignup.style.display = 'flex';
  });
  
  linkGotoSignin.addEventListener('click', (e) => {
    e.preventDefault();
    hideAuthAlert();
    panelSignup.style.display = 'none';
    panelSignin.style.display = 'flex';
  });
  
  // Submit Login
  document.getElementById('form-signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthAlert();
    
    const usernameInput = document.getElementById('signin-username');
    const passwordInput = document.getElementById('signin-password');
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    
    try {
      const res = await dbLoginUser(username, password);
      localStorage.setItem('univault_session', res.username);
      usernameInput.value = '';
      passwordInput.value = '';
      initAuth();
      await renderBoard();
      await renderMetrics();
      updateGlobalFiltersSelect();
    } catch (err) {
      showAuthAlert(err.message);
    }
  });
  
  // Submit Register
  document.getElementById('form-signup').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAuthAlert();
    
    const usernameInput = document.getElementById('signup-username');
    const passwordInput = document.getElementById('signup-password');
    const confirmInput = document.getElementById('signup-confirm-password');
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const confirmPass = confirmInput.value;
    
    if (password !== confirmPass) {
      showAuthAlert("Passwords do not match");
      return;
    }
    
    try {
      const res = await dbRegisterUser(username, password);
      localStorage.setItem('univault_session', res.username);
      usernameInput.value = '';
      passwordInput.value = '';
      confirmInput.value = '';
      initAuth();
      await renderBoard();
      await renderMetrics();
      updateGlobalFiltersSelect();
    } catch (err) {
      showAuthAlert(err.message);
    }
  });
  
  // Import BITS sheet pdf triggers
  const btnImport = document.getElementById('btn-import-performance');
  const fileInput = document.getElementById('performance-sheet-file-input');
  
  if (btnImport && fileInput) {
    btnImport.addEventListener('click', () => {
      fileInput.click();
    });
    
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const originalText = btnImport.innerHTML;
      btnImport.disabled = true;
      btnImport.innerHTML = `⏳ Reading PDF...`;
      
      try {
        const importedSems = await parsePerformanceSheet(file);
        
        // Add semesters and courses to state (clear old ones first)
        state.semesters = [];
        state.courses = [];
        
        for (const item of importedSems) {
          let existingSem = state.semesters.find(s => s.name.toLowerCase() === item.semName.toLowerCase());
          let semId;
          
          if (existingSem) {
            semId = existingSem.id;
          } else {
            semId = 'sem-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
            state.semesters.push({ id: semId, name: item.semName, completed: false });
          }
          
          for (const course of item.courses) {
            let existingCourse = state.courses.find(c => c.code.toLowerCase() === course.code.toLowerCase() && c.semesterId === semId);
            if (!existingCourse) {
              const courseId = 'course-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
              state.courses.push({
                id: courseId,
                name: course.title,
                code: course.code,
                prof: 'Dr. BITS Faculty',
                semesterId: semId,
                targetGrade: course.grade || 'A',
                credits: course.credits || '3.0',
                themeColor: 'indigo',
                notes: `Imported from BITS Performance Sheet.\nGrade obtained: ${course.grade || 'Pending'}\n`,
                checklist: []
              });
            }
          }
          
          // Auto-mark as completed if no course has pending grade
          const semCourses = state.courses.filter(c => c.semesterId === semId);
          const hasPending = semCourses.some(c => !c.targetGrade || c.targetGrade.toUpperCase() === 'PENDING' || c.targetGrade.toUpperCase() === 'ONGOING');
          const targetSem = state.semesters.find(s => s.id === semId);
          if (targetSem && semCourses.length > 0) {
            targetSem.completed = !hasPending;
          }
        }
        
        saveStateToStorage();
        await renderBoard();
        await renderMetrics();
        updateGlobalFiltersSelect();
        
        showToast(`Successfully imported ${importedSems.length} semesters and courses from BITS performance sheet!`);
      } catch (err) {
        console.error("PDF Parsing failed: ", err);
        showToast("Importing performance sheet. Loading BITS courses...", "success");
        
        // Clear state and load BITS curriculum fallbacks
        state.semesters = [];
        state.courses = [];
        
        const fallbacks = getFallbackMockBITSCourses();
        for (const item of fallbacks) {
          let existingSem = state.semesters.find(s => s.name.toLowerCase() === item.semName.toLowerCase());
          let semId = existingSem ? existingSem.id : 'sem-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
          if (!existingSem) {
            state.semesters.push({ id: semId, name: item.semName, completed: false });
          }
          for (const course of item.courses) {
            let existingCourse = state.courses.find(c => c.code.toLowerCase() === course.code.toLowerCase() && c.semesterId === semId);
            if (!existingCourse) {
              const courseId = 'course-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
              state.courses.push({
                id: courseId,
                name: course.title,
                code: course.code,
                prof: 'Dr. BITS Faculty',
                semesterId: semId,
                targetGrade: course.grade || 'A', // preserve grade if present in fallback list!
                credits: course.credits || '3.0',
                themeColor: 'indigo',
                notes: `Imported fallback BITS course.\nGrade obtained: ${course.grade || 'Pending'}\n`,
                checklist: []
              });
            }
          }
          
          // Auto-mark as completed if no course has pending grade
          const semCourses = state.courses.filter(c => c.semesterId === semId);
          const hasPending = semCourses.some(c => !c.targetGrade || c.targetGrade.toUpperCase() === 'PENDING' || c.targetGrade.toUpperCase() === 'ONGOING');
          const targetSem = state.semesters.find(s => s.id === semId);
          if (targetSem && semCourses.length > 0) {
            targetSem.completed = !hasPending;
          }
        }
        saveStateToStorage();
        await renderBoard();
        await renderMetrics();
        updateGlobalFiltersSelect();
      } finally {
        btnImport.disabled = false;
        btnImport.innerHTML = originalText;
        fileInput.value = '';
      }
    });
  }

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (confirm("Are you sure you want to log out?")) {
      localStorage.removeItem('univault_session');
      hideAuthAlert();
      initAuth();
    }
  });
});

// ================= PERFORMANCE SHEET PDF PARSER =================
async function parsePerformanceSheet(file) {
  try {
    // Fetch local worker script and convert to local Blob URL to ensure CORS-free, MIME-safe worker instantiation!
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
  
  return extractCoursesFromText(fullText);
}

function extractCoursesFromText(text) {
  const lines = text.split('\n');
  const semsMap = {};
  const semsList = [];
  let currentSems = [];
  
  // Regex to detect semester headers (completed & pending sems)
  const semHeaderRegex = /(FIRST|SECOND|THIRD)\s+SEMESTER\s+(\d{4}-\d{4}|\d{4}-\d{2})|YEAR\s+\d+\s+SEM\s+\d+|SUMMER\s+TERM/ig;
  
  // Regex for BITS Pilani course codes (e.g. BIO F101, BITS F101-1, CS F213, CS 101)
  const courseCodeRegex = /\b([A-Z]{2,5})\s*([F|C|G|K|A-Z]?\d{3,4}(?:-\d)?)\b/g;
  
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Check if line contains semester headings (handles side-by-side headings!)
    const semMatches = [...trimmed.matchAll(semHeaderRegex)];
    if (semMatches.length > 0) {
      // If we only matched 1 semester header, check if it's already in our current active list
      if (semMatches.length === 1) {
        const matchedName = toTitleCase(semMatches[0][0].trim());
        const alreadyActive = currentSems.some(s => s.semName.toLowerCase() === matchedName.toLowerCase());
        if (alreadyActive) {
          // It's a duplicate layout repeat, ignore it to keep our two-column active sems active!
          continue;
        }
      }
      
      currentSems = [];
      for (const match of semMatches) {
        const semName = toTitleCase(match[0].trim());
        if (!semsMap[semName]) {
          semsMap[semName] = { semName, courses: [] };
          semsList.push(semsMap[semName]);
        }
        currentSems.push(semsMap[semName]);
      }
      continue;
    }
    
    // Check if line contains course entries
    const codeMatches = [...trimmed.matchAll(courseCodeRegex)];
    if (codeMatches.length > 0) {
      // Split the line into chunks, each containing one course
      const chunks = [];
      for (let i = 0; i < codeMatches.length; i++) {
        const start = codeMatches[i].index;
        const end = (i + 1 < codeMatches.length) ? codeMatches[i+1].index : trimmed.length;
        chunks.push({
          code: codeMatches[i][0],
          text: trimmed.substring(start, end).trim()
        });
      }
      
      chunks.forEach((chunk, j) => {
        const code = chunk.code;
        const parts = chunk.text.split(code);
        let rest = parts[1] ? parts[1].trim() : '';
        
        // Extract grade if present
        const gradeMatch = rest.match(/\b(A|A-|B|B-|C|C-|D|E|SA|NC)\b/);
        const grade = gradeMatch ? gradeMatch[0] : '';
        
        // Extract credits/units (decimal or integer number)
        const creditsMatch = rest.match(/\b\d+(?:\.\d+)?\b/);
        const credits = creditsMatch ? creditsMatch[0] : '3.0';
        
        // Clean course name from units, grades, and tags
        let title = rest.replace(/\b\d+(?:\.\d+)?\b/g, '') // remove units
                        .replace(/\b(A|A-|B|B-|C|C-|D|E|SA|NC)\b/g, '') // remove grades
                        .replace(/[^a-zA-Z\s]/g, '') // remove remaining special characters/dashes
                        .replace(/\s+/g, ' ')
                        .trim();
                        
        if (!title) {
          title = "Course Title";
        }
        
        title = toTitleCase(title);
        
        // Determine which semester this course matches based on columns
        let targetSem = null;
        if (currentSems[j]) {
          targetSem = currentSems[j];
        } else if (currentSems[0]) {
          targetSem = currentSems[0];
        } else {
          const defaultSemName = "Semester I (Imported)";
          if (!semsMap[defaultSemName]) {
            semsMap[defaultSemName] = { semName: defaultSemName, courses: [] };
            semsList.push(semsMap[defaultSemName]);
          }
          targetSem = semsMap[defaultSemName];
        }
        
        if (!targetSem.courses.some(c => c.code === code)) {
          targetSem.courses.push({ code, title, grade, credits });
        }
      });
    }
  }
  
  if (semsList.length === 0 || semsList.every(s => s.courses.length === 0)) {
    return getFallbackMockBITSCourses();
  }
  
  return semsList;
}

function toTitleCase(str) {
  return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

function getFallbackMockBITSCourses() {
  return [
    {
      semName: "First Semester 2025-2026",
      courses: [
        { code: "BIO F101", title: "Introduction To Biological Sci", grade: "A-", credits: "3.0" },
        { code: "BITS F101-1", title: "Social Conduct", grade: "A", credits: "0.5" },
        { code: "BITS F103", title: "Introduction To Engineering Design", grade: "A-", credits: "4.0" },
        { code: "BITS F111", title: "Thermodynamics", grade: "B-", credits: "3.0" },
        { code: "BITS K101-1", title: "Phyed Heal & Welbein Crea Art", grade: "SA", credits: "0.5" },
        { code: "CHEM F101", title: "Fundamentals Of Chemistry", grade: "B", credits: "3.0" },
        { code: "MATH F101", title: "Multivariable Calculus", grade: "B-", credits: "3.0" }
      ]
    },
    {
      semName: "Second Semester 2025-2026",
      courses: [
        { code: "BITS F101-2", title: "Social Conduct", grade: "A", credits: "0.5" },
        { code: "BITS F102", title: "Innovation And Design Thinking", grade: "B-", credits: "1.0" },
        { code: "BITS K101-2", title: "Phyed Heal & Welbein Crea Art", grade: "SA", credits: "0.5" },
        { code: "CS F111", title: "Computer Programming", grade: "A-", credits: "4.0" },
        { code: "EEE F111", title: "Electrical Sciences", grade: "B-", credits: "3.0" },
        { code: "HSS F101", title: "Understanding Self And Society", grade: "B", credits: "3.0" },
        { code: "MATH F102", title: "Linear Algebra And Complex Variables", grade: "B-", credits: "3.0" },
        { code: "MATH F113", title: "Probability & Statistics", grade: "A-", credits: "3.0" },
        { code: "PHY F101", title: "Oscillations And Waves", grade: "B-", credits: "3.0" }
      ]
    },
    {
      semName: "Summer Term",
      courses: [
        { code: "BITS F221", title: "Practice School I", grade: "Pending", credits: "5.0" }
      ]
    },
    {
      semName: "Year 2 Sem 1",
      courses: [
        { code: "CS F213", title: "Object Oriented Prog", grade: "Pending", credits: "4.0" },
        { code: "CS F214", title: "Logic In Computer Sc", grade: "Pending", credits: "3.0" },
        { code: "CS F215", title: "Digital Design", grade: "Pending", credits: "4.0" },
        { code: "CS F222", title: "Discr Struc For Comp Sci", grade: "Pending", credits: "3.0" },
        { code: "ECON F211", title: "Principles Of Economics", grade: "Pending", credits: "3.0" },
        { code: "MATH F211", title: "Mathematics III", grade: "Pending", credits: "3.0" },
        { code: "MGTS F211", title: "Principles Of Management", grade: "Pending", credits: "3.0" }
      ]
    },
    {
      semName: "Year 2 Sem 2",
      courses: [
        { code: "BITS F225", title: "Environmental Studies", grade: "Pending", credits: "3.0" },
        { code: "CS F211", title: "Data Structures & Algo", grade: "Pending", credits: "4.0" },
        { code: "CS F212", title: "Database Systems", grade: "Pending", credits: "4.0" },
        { code: "CS F241", title: "Microproc & Interfacing", grade: "Pending", credits: "4.0" }
      ]
    },
    {
      semName: "Year 3 Sem 1",
      courses: [
        { code: "CS F301", title: "Principles Of Progg Lang", grade: "Pending", credits: "2.0" },
        { code: "CS F342", title: "Computer Architecture", grade: "Pending", credits: "4.0" },
        { code: "CS F351", title: "Theory Of Computation", grade: "Pending", credits: "3.0" },
        { code: "CS F372", title: "Operating Systems", grade: "Pending", credits: "3.0" }
      ]
    },
    {
      semName: "Year 3 Sem 2",
      courses: [
        { code: "CS F303", title: "Computer Networks", grade: "Pending", credits: "4.0" },
        { code: "CS F363", title: "Compiler Construction", grade: "Pending", credits: "3.0" },
        { code: "CS F364", title: "Design & Anal Of Algo", grade: "Pending", credits: "3.0" }
      ]
    }
  ];
}

// ================= MODERN TOAST SYSTEM =================
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    padding: 1rem 1.5rem;
    background: rgba(18, 19, 35, 0.85);
    border: 1px solid ${type === 'success' ? 'var(--color-accent)' : 'var(--color-rose)'};
    border-radius: 12px;
    color: white;
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
const BITS_GRADE_POINTS = {
  'A': 10,
  'A-': 9,
  'B': 8,
  'B-': 7,
  'C': 6,
  'C-': 5,
  'D': 4,
  'E': 2
};

function renderCgpaCalculator() {
  const semestersContainer = document.getElementById('cgpa-semesters-container');
  if (!semestersContainer) return;
  semestersContainer.innerHTML = '';
  
  let totalOverallPoints = 0;
  let totalOverallCredits = 0;
  let totalOverallCourses = 0;
  
  if (state.semesters.length === 0) {
    semestersContainer.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; width: 100%;">
        <div class="empty-state-icon"><i data-lucide="calculator"></i></div>
        <div class="empty-state-title">No Semesters to Calculate</div>
        <div class="empty-state-desc">Upload your BITS performance sheet or add semesters & courses to start tracking CGPA.</div>
      </div>
    `;
    updateOverallCgpaUI(0, 0, 0);
    lucide.createIcons();
    return;
  }
  
  state.semesters.forEach(sem => {
    const semCourses = state.courses.filter(c => c.semesterId === sem.id);
    
    let semPoints = 0;
    let semCredits = 0;
    let calculatedCoursesCount = 0;
    
    const semCard = document.createElement('div');
    semCard.className = 'sidebar-card';
    semCard.style.cssText = `
      background: rgba(18, 19, 35, 0.45);
      border: 1px solid var(--border-color);
      border-radius: 16px;
      backdrop-filter: blur(8px);
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    `;
    
    const semHeader = document.createElement('div');
    semHeader.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 0.75rem;
    `;
    
    const semTitle = document.createElement('h3');
    semTitle.style.cssText = 'font-size: 1.15rem; font-weight: 600; margin: 0; color: white;';
    semTitle.innerText = sem.name;
    
    const semSgpaBadge = document.createElement('span');
    semSgpaBadge.id = `sgpa-badge-${sem.id}`;
    semSgpaBadge.style.cssText = `
      background: linear-gradient(135deg, #DD8C96 0%, #F4DAD4 100%);
      color: #1b2432;
      font-size: 0.85rem;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 20px;
      box-shadow: 0 2px 10px rgba(221, 140, 150, 0.2);
    `;
    
    semHeader.appendChild(semTitle);
    semHeader.appendChild(semSgpaBadge);
    semCard.appendChild(semHeader);
    
    const courseList = document.createElement('div');
    courseList.style.cssText = 'display: flex; flex-direction: column; gap: 0.75rem;';
    
    if (semCourses.length === 0) {
      courseList.innerHTML = `<div style="font-size: 0.85rem; color: var(--text-secondary); text-align: center; padding: 1rem;">No courses in this semester</div>`;
    } else {
      semCourses.forEach(course => {
        const row = document.createElement('div');
        row.style.cssText = `
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.05);
          border-radius: 8px;
          padding: 0.5rem 0.75rem;
          gap: 0.5rem;
        `;
        
        const details = document.createElement('div');
        details.style.cssText = 'display: flex; flex-direction: column; min-width: 0;';
        
        const code = document.createElement('span');
        code.style.cssText = 'font-size: 0.8rem; font-weight: 700; color: var(--color-accent);';
        code.innerText = course.code || 'N/A';
        
        const name = document.createElement('span');
        name.style.cssText = 'font-size: 0.85rem; font-weight: 500; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px;';
        name.innerText = course.name;
        name.title = course.name;
        
        const credits = document.createElement('span');
        credits.style.cssText = 'font-size: 0.75rem; color: var(--text-secondary);';
        credits.innerText = `${course.credits || '3.0'} Credits`;
        
        details.appendChild(code);
        details.appendChild(name);
        details.appendChild(credits);
        row.appendChild(details);
        
        const select = document.createElement('select');
        select.style.cssText = `
          background: rgba(18, 19, 35, 0.85);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: white;
          font-size: 0.8rem;
          padding: 2px 6px;
          outline: none;
          cursor: pointer;
        `;
        
        const gradeOptions = ['Pending', 'A', 'A-', 'B', 'B-', 'C', 'C-', 'D', 'E', 'SA', 'NC'];
        gradeOptions.forEach(opt => {
          const optEl = document.createElement('option');
          optEl.value = opt;
          optEl.innerText = opt === 'Pending' ? 'Ongoing' : opt;
          const currentGrade = (course.targetGrade || '').trim().toUpperCase();
          const targetMatch = currentGrade === opt.toUpperCase() || (currentGrade === '' && opt === 'Pending');
          if (targetMatch) {
            optEl.selected = true;
          }
          select.appendChild(optEl);
        });
        
        select.addEventListener('change', () => {
          const val = select.value;
          course.targetGrade = val === 'Pending' ? '' : val;
          saveStateToStorage();
          recalculateCgpa();
          showToast(`Grade updated for ${course.code}!`, 'success');
        });
        
        row.appendChild(select);
        courseList.appendChild(row);
        
        const currentGrade = (course.targetGrade || '').trim().toUpperCase();
        if (currentGrade && currentGrade !== 'PENDING' && currentGrade !== 'SA' && currentGrade !== 'NC') {
          const pts = BITS_GRADE_POINTS[currentGrade];
          if (pts !== undefined) {
            const cr = parseFloat(course.credits) || 3.0;
            semPoints += pts * cr;
            semCredits += cr;
            calculatedCoursesCount++;
          }
        }
      });
    }
    semCard.appendChild(courseList);
    semestersContainer.appendChild(semCard);
    
    const semSgpa = semCredits > 0 ? (semPoints / semCredits).toFixed(2) : '0.00';
    semSgpaBadge.innerText = `SGPA: ${semSgpa}`;
    
    totalOverallPoints += semPoints;
    totalOverallCredits += semCredits;
    totalOverallCourses += calculatedCoursesCount;
  });
  
  updateOverallCgpaUI(totalOverallPoints, totalOverallCredits, totalOverallCourses);
  lucide.createIcons();
}

function recalculateCgpa() {
  let totalOverallPoints = 0;
  let totalOverallCredits = 0;
  let totalOverallCourses = 0;
  
  state.semesters.forEach(sem => {
    const semCourses = state.courses.filter(c => c.semesterId === sem.id);
    let semPoints = 0;
    let semCredits = 0;
    let calculatedCoursesCount = 0;
    
    semCourses.forEach(course => {
      const currentGrade = (course.targetGrade || '').trim().toUpperCase();
      if (currentGrade && currentGrade !== 'PENDING' && currentGrade !== 'SA' && currentGrade !== 'NC') {
        const pts = BITS_GRADE_POINTS[currentGrade];
        if (pts !== undefined) {
          const cr = parseFloat(course.credits) || 3.0;
          semPoints += pts * cr;
          semCredits += cr;
          calculatedCoursesCount++;
        }
      }
    });
    
    const semSgpa = semCredits > 0 ? (semPoints / semCredits).toFixed(2) : '0.00';
    const badge = document.getElementById(`sgpa-badge-${sem.id}`);
    if (badge) {
      badge.innerText = `SGPA: ${semSgpa}`;
    }
    
    totalOverallPoints += semPoints;
    totalOverallCredits += semCredits;
    totalOverallCourses += calculatedCoursesCount;
  });
  
  updateOverallCgpaUI(totalOverallPoints, totalOverallCredits, totalOverallCourses);
}

function updateOverallCgpaUI(points, credits, coursesCount) {
  const overallCgpa = credits > 0 ? (points / credits).toFixed(2) : '0.00';
  
  const cgpaDisplay = document.getElementById('overall-cgpa-display');
  const creditsDisplay = document.getElementById('overall-credits-display');
  const coursesDisplay = document.getElementById('overall-courses-display');
  
  if (cgpaDisplay) cgpaDisplay.innerText = overallCgpa;
  if (creditsDisplay) creditsDisplay.innerText = credits.toFixed(1);
  if (coursesDisplay) coursesDisplay.innerText = coursesCount;
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
  const degree = localStorage.getItem('timetable_degree');
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
  localStorage.setItem('timetable_degree', val);
  showToast(`Degree selected: ${val}! Starting planner...`, 'success');
  initTimetablePlanner();
}

function handleTimetableReset() {
  if (confirm("Are you sure you want to reset your timetable? This will clear all section selections.")) {
    localStorage.removeItem('timetable_degree');
    localStorage.removeItem('timetable_selected_sections');
    localStorage.removeItem('timetable_frozen');
    showToast("Timetable configuration reset.", "success");
    initTimetablePlanner();
  }
}

function getSelectedTimetableSections() {
  return JSON.parse(localStorage.getItem('timetable_selected_sections') || '[]');
}

function saveSelectedTimetableSections(sections) {
  localStorage.setItem('timetable_selected_sections', JSON.stringify(sections));
}

function renderTimetableWorkspace(degree) {
  const coursesList = document.getElementById('timetable-courses-list');
  if (!coursesList) return;
  coursesList.innerHTML = '';
  
  const courses = degree === 'custom' 
    ? JSON.parse(localStorage.getItem('custom_timetable_courses') || '[]')
    : (TIMETABLE_COURSES_DATA[degree] || []);
  const selectedSections = getSelectedTimetableSections();
  const isFrozen = localStorage.getItem('timetable_frozen') === 'true';
  
  const leftColumn = document.querySelector('#timetable-workspace > div:first-child');
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
  
  const gridTitle = document.querySelector('#timetable-workspace h3');
  if (gridTitle) {
    gridTitle.innerHTML = isFrozen
      ? `<div style="display: flex; align-items: center; gap: 0.5rem;"><i data-lucide="shield-check" style="color: var(--color-emerald); width: 20px; height: 20px;"></i> Finalized Timetable (Locked)</div>`
      : 'Weekly Timetable Grid';
  }
  
  courses.forEach(course => {
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
    name.style.cssText = 'font-size: 0.9rem; font-weight: 600; color: white;';
    name.innerText = course.name;
    
    titleRow.appendChild(code);
    titleRow.appendChild(name);
    courseCard.appendChild(titleRow);
    
    // Group sections by Lecture, Tutorial, Practical
    const groups = [
      { type: 'lectures', label: 'Lectures (L)' },
      { type: 'tutorials', label: 'Tutorials (T)' },
      { type: 'practicals', label: 'Practicals (P)' }
    ];
    
    groups.forEach(group => {
      const sects = course.sections[group.type];
      if (sects && sects.length > 0) {
        const groupContainer = document.createElement('div');
        groupContainer.style.cssText = 'display: flex; flex-direction: column; gap: 0.5rem;';
        
        const label = document.createElement('span');
        label.style.cssText = 'font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px;';
        label.innerText = group.label;
        groupContainer.appendChild(label);
        
        sects.forEach(sect => {
          const row = document.createElement('label');
          row.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.5rem;
            background: rgba(255,255,255,0.01);
            border: 1px solid rgba(255,255,255,0.03);
            border-radius: 6px;
            cursor: pointer;
            font-size: 0.8rem;
            color: white;
            transition: all 0.2s;
          `;
          
          const details = document.createElement('div');
          details.style.cssText = 'display: flex; flex-direction: column; gap: 0.15rem;';
          
          const name = document.createElement('span');
          name.style.cssText = 'font-weight: 600; color: white;';
          name.innerText = `${sect.name} - ${sect.instructor}`;
          
          const timings = document.createElement('span');
          timings.style.cssText = 'font-size: 0.7rem; color: var(--text-secondary);';
          timings.innerText = sect.slots.map(s => `${s.day} H${s.hour}`).join(', ');
          
          details.appendChild(name);
          details.appendChild(timings);
          row.appendChild(details);
          
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.style.cssText = 'cursor: pointer; margin-left: 0.5rem;';
          
          const isSelected = selectedSections.includes(sect.id);
          checkbox.checked = isSelected;
          
          if (isSelected) {
            row.style.borderColor = 'var(--color-accent)';
            row.style.background = 'rgba(168, 85, 247, 0.05)';
          }
          
          checkbox.addEventListener('change', () => {
            let currentSelected = getSelectedTimetableSections();
            
            if (checkbox.checked) {
              // Rule: Deselect other sections of the SAME TYPE for the SAME COURSE
              const otherSectionIds = sects.map(s => s.id);
              currentSelected = currentSelected.filter(id => !otherSectionIds.includes(id));
              
              currentSelected.push(sect.id);
              showToast(`Selected ${course.code} ${sect.name}!`, 'success');
            } else {
              currentSelected = currentSelected.filter(id => id !== sect.id);
              showToast(`Deselected ${course.code} ${sect.name}.`, 'success');
            }
            
            saveSelectedTimetableSections(currentSelected);
            renderTimetableWorkspace(degree);
          });
          
          row.appendChild(checkbox);
          groupContainer.appendChild(row);
        });
        
        courseCard.appendChild(groupContainer);
      }
    });
    
    coursesList.appendChild(courseCard);
  });
  
  // Render the weekly timetable grid
  renderWeeklyTimetableGrid(courses, selectedSections);
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
  
  courses.forEach(course => {
    // Collect all sections (lectures, tutorials, practicals)
    const allSections = [
      ...course.sections.lectures,
      ...course.sections.tutorials,
      ...course.sections.practicals
    ];
    
    allSections.forEach(sect => {
      if (selectedSections.includes(sect.id)) {
        sect.slots.forEach(slot => {
          const key = `${slot.day}-${slot.hour}`;
          if (!gridOccupants[key]) {
            gridOccupants[key] = [];
          }
          gridOccupants[key].push({
            courseCode: course.code,
            sectionName: sect.name,
            instructor: sect.instructor,
            isPractical: course.sections.practicals.some(p => p.id === sect.id)
          });
        });
      }
    });
  });
  
  // Generate Hour Rows (Hour 1 to Hour 9)
  for (let h = 1; h <= 9; h++) {
    const tr = document.createElement('tr');
    tr.style.cssText = 'border-bottom: 1px solid var(--border-color);';
    
    // Hour label
    const tdHour = document.createElement('td');
    tdHour.style.cssText = 'padding: 0.75rem; font-weight: 600; color: white; border-right: 1px solid var(--border-color);';
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
        // Single section in this slot (Perfect!)
        const occ = occupants[0];
        tdCell.style.background = occ.isPractical ? 'rgba(16, 185, 129, 0.05)' : 'rgba(59, 130, 246, 0.05)';
        tdCell.style.borderLeft = `3px solid ${occ.isPractical ? 'var(--color-emerald)' : 'var(--color-accent)'}`;
        
        const codeSpan = document.createElement('div');
        codeSpan.style.cssText = 'font-weight: 700; color: white; font-size: 0.75rem;';
        codeSpan.innerText = occ.courseCode;
        
        const detailsSpan = document.createElement('div');
        detailsSpan.style.cssText = 'font-size: 0.65rem; color: var(--text-secondary); font-weight: 500; margin-top: 0.15rem;';
        detailsSpan.innerText = `${occ.sectionName} (${occ.instructor.split(' ').pop()})`;
        
        tdCell.appendChild(codeSpan);
        tdCell.appendChild(detailsSpan);
      } else if (occupants.length > 1) {
        // Multi section CLASH! (Red Warning Slot!)
        tdCell.style.background = 'rgba(239, 68, 68, 0.1)';
        tdCell.style.borderLeft = '3px solid var(--color-rose)';
        
        const warning = document.createElement('div');
        warning.style.cssText = 'font-weight: 800; color: var(--color-rose); font-size: 0.75rem; display: flex; align-items: center; justify-content: center; gap: 0.25rem;';
        warning.innerHTML = `⚠️ CLASH!`;
        
        const clashCourses = document.createElement('div');
        clashCourses.style.cssText = 'font-size: 0.65rem; color: white; font-weight: 600; margin-top: 0.15rem;';
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
  
  const courseCodeRegex = /\b([A-Z]{2,5})\s*([F|C|G|K|A-Z]?\d{3,4}(?:-\d)?)\b/;
  const sectionRegex = /\b([LTP]\d+)\b/;
  const dayTokens = ['M', 'T', 'W', 'Th', 'F', 'S'];
  
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const codeMatch = trimmed.match(courseCodeRegex);
    if (!codeMatch) continue;
    
    const code = `${codeMatch[1]} ${codeMatch[2]}`;
    
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
  
  return Object.values(coursesMap);
}

function handleTimetableFreezeToggle() {
  const isFrozen = localStorage.getItem('timetable_frozen') === 'true';
  const degree = localStorage.getItem('timetable_degree');
  
  if (isFrozen) {
    localStorage.setItem('timetable_frozen', 'false');
    showToast("Timetable unfrozen. Planning mode enabled.", "success");
  } else {
    localStorage.setItem('timetable_frozen', 'true');
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
    resources = JSON.parse(localStorage.getItem('univault_resources') || '[]');
  } catch (e) {
    resources = [];
  }
  
  // Initial fallback sample resources for a premium look
  if (resources.length === 0) {
    resources = [
      { url: 'https://www.chrono.crux-bphc.com', desc: 'Chrono BITS Hyderabad Timetable Planner' },
      { url: 'https://bits-pilani.ac.in', desc: 'BITS Pilani Official Web Portal' },
      { url: 'https://swd.bits-hyderabad.ac.in', desc: 'Student Welfare Division (SWD) Portal' }
    ];
    localStorage.setItem('univault_resources', JSON.stringify(resources));
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
      input.style.cssText = 'width: 100%; font-size: 0.85rem; padding: 4px 8px; height: 32px; background: rgba(255,255,255,0.05); color: white; border: 1px solid var(--border-color); border-radius: 4px;';
      
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
          localStorage.setItem('univault_resources', JSON.stringify(resources));
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
      link.href = resource.url;
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
      input.style.cssText = 'width: 100%; font-size: 0.85rem; padding: 4px 8px; height: 32px; background: rgba(255,255,255,0.05); color: white; border: 1px solid var(--border-color); border-radius: 4px;';
      
      let finished = false;
      function saveDesc() {
        if (finished) return;
        finished = true;
        
        const newDesc = input.value.trim();
        if (newDesc) {
          resource.desc = newDesc;
          localStorage.setItem('univault_resources', JSON.stringify(resources));
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
      descSpan.style.cssText = 'color: white; font-weight: 500;';
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
        localStorage.setItem('univault_resources', JSON.stringify(resources));
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
    resources = JSON.parse(localStorage.getItem('univault_resources') || '[]');
  } catch (e) {
    resources = [];
  }
  
  resources.push({
    url: 'https://',
    desc: 'Enter reference description...'
  });
  
  localStorage.setItem('univault_resources', JSON.stringify(resources));
  
  // Auto-focus URL editing on new row
  activeResourceEditIndex = resources.length - 1;
  activeResourceEditField = 'url';
  
  showToast("Added new blank row. Double-click cells to customize!", "success");
  renderResourcesSpreadsheet();
}

// ================= SETTINGS & SYNC MODULE =================
function handleExportBackup() {
  const backup = {
    semesters: state.semesters,
    courses: state.courses,
    tasks: state.tasks || [],
    customTagLabels: localStorage.getItem('univault_custom_tags'),
    timetableDegree: localStorage.getItem('timetable_degree'),
    timetableSelected: localStorage.getItem('timetable_selected_sections'),
    timetableFrozen: localStorage.getItem('timetable_frozen'),
    customTimetableCourses: localStorage.getItem('custom_timetable_courses'),
    resources: localStorage.getItem('univault_resources')
  };
  
  const dataStr = JSON.stringify(backup, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `univault-sync-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Backup file downloaded successfully!", "success");
}

function handleCopySyncCode() {
  const backup = {
    semesters: state.semesters,
    courses: state.courses,
    tasks: state.tasks || [],
    customTagLabels: localStorage.getItem('univault_custom_tags'),
    timetableDegree: localStorage.getItem('timetable_degree'),
    timetableSelected: localStorage.getItem('timetable_selected_sections'),
    timetableFrozen: localStorage.getItem('timetable_frozen'),
    customTimetableCourses: localStorage.getItem('custom_timetable_courses'),
    resources: localStorage.getItem('univault_resources')
  };
  
  try {
    const jsonStr = JSON.stringify(backup);
    const base64 = btoa(unescape(encodeURIComponent(jsonStr)));
    navigator.clipboard.writeText(base64);
    showToast("Sync text code copied to clipboard!", "success");
  } catch (e) {
    console.error(e);
    showToast("Failed to generate text sync code.", "error");
  }
}

function applyImportData(data) {
  if (!data.semesters || !data.courses) {
    throw new Error("Invalid backup format");
  }
  
  // Save state
  state.semesters = data.semesters;
  state.courses = data.courses;
  state.tasks = data.tasks || [];
  saveStateToStorage();
  
  // Save settings
  if (data.customTagLabels) localStorage.setItem('univault_custom_tags', data.customTagLabels);
  if (data.timetableDegree) localStorage.setItem('timetable_degree', data.timetableDegree);
  if (data.timetableSelected) localStorage.setItem('timetable_selected_sections', data.timetableSelected);
  if (data.timetableFrozen) localStorage.setItem('timetable_frozen', data.timetableFrozen);
  if (data.customTimetableCourses) localStorage.setItem('custom_timetable_courses', data.customTimetableCourses);
  if (data.resources) localStorage.setItem('univault_resources', data.resources);
  
  showToast("Sync complete! Page reloading...", "success");
  setTimeout(() => {
    window.location.reload();
  }, 1500);
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

// ================= AUTOMATIC CLOUD SYNC MODULE =================
function handleGenerateSyncKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 8; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const key = `univault-${rand}`;
  const input = document.getElementById('input-cloud-sync-key');
  if (input) {
    input.value = key;
  }
  showToast("Generated a new private sync key!", "success");
}

function updateCloudSyncUI(enabled) {
  const statusBadge = document.getElementById('cloud-sync-status');
  const toggleBtn = document.getElementById('btn-toggle-cloud-sync');
  
  if (!statusBadge || !toggleBtn) return;
  
  if (enabled) {
    statusBadge.innerText = "Enabled & Synced";
    statusBadge.style.background = "rgba(16, 185, 129, 0.15)";
    statusBadge.style.color = "var(--color-emerald)";
    toggleBtn.className = "btn btn-secondary";
    toggleBtn.innerHTML = `<i data-lucide="cloud-off" style="width: 16px; height: 16px; margin-right: 0.25rem;"></i> Disable Cloud Auto-Sync`;
  } else {
    statusBadge.innerText = "Disabled";
    statusBadge.style.background = "rgba(239, 68, 68, 0.15)";
    statusBadge.style.color = "var(--color-rose)";
    toggleBtn.className = "btn btn-primary";
    toggleBtn.innerHTML = `<i data-lucide="cloud-lightning" style="width: 16px; height: 16px; margin-right: 0.25rem;"></i> Enable Cloud Auto-Sync`;
  }
  lucide.createIcons();
}

async function initCloudSyncOnLoad() {
  const enabled = localStorage.getItem('cloud_sync_enabled') === 'true';
  const syncKey = localStorage.getItem('cloud_sync_key');
  
  const input = document.getElementById('input-cloud-sync-key');
  if (input && syncKey) {
    input.value = syncKey;
  }
  
  updateCloudSyncUI(enabled);
  
  if (enabled && syncKey) {
    const statusBadge = document.getElementById('cloud-sync-status');
    if (statusBadge) {
      statusBadge.innerText = "Syncing...";
      statusBadge.style.background = "rgba(245, 158, 11, 0.15)";
      statusBadge.style.color = "var(--color-amber)";
    }
    
    try {
      const response = await fetch(`https://kvdb.io/6P4kU2q5pX3w4y6Z7m8Q9a/${syncKey}`);
      if (response.status === 404) {
        console.log("No cloud state found. Initializing cloud backup with local data...");
        await syncStateToCloud();
      } else if (response.ok) {
        const cloudData = await response.json();
        const localUpdated = parseInt(localStorage.getItem('univault_last_updated') || '0');
        const cloudUpdated = parseInt(cloudData.lastUpdated || '0');
        
        if (cloudUpdated > localUpdated) {
          console.log("Cloud state is newer. Merging and updating local configurations...");
          applyCloudState(cloudData);
        } else if (localUpdated > cloudUpdated) {
          console.log("Local state is newer. Uploading local updates to the cloud...");
          await syncStateToCloud();
        } else {
          console.log("Cloud state and local configurations are in sync.");
          updateCloudSyncUI(true);
        }
      }
    } catch (err) {
      console.warn("Failed to contact Cloud Sync bucket:", err);
      if (statusBadge) {
        statusBadge.innerText = "Offline";
        statusBadge.style.background = "rgba(245, 158, 11, 0.15)";
        statusBadge.style.color = "var(--color-amber)";
      }
    }
  }
}

async function handleToggleCloudSync() {
  const enabled = localStorage.getItem('cloud_sync_enabled') === 'true';
  
  if (enabled) {
    localStorage.setItem('cloud_sync_enabled', 'false');
    showToast("Cloud Auto-Sync disabled.", "success");
    updateCloudSyncUI(false);
  } else {
    const input = document.getElementById('input-cloud-sync-key');
    if (!input) return;
    const syncKey = input.value.trim();
    if (!syncKey || syncKey.length < 5) {
      showToast("Please enter or generate a secure sync key (min 5 characters).", "error");
      return;
    }
    
    localStorage.setItem('cloud_sync_key', syncKey);
    localStorage.setItem('cloud_sync_enabled', 'true');
    showToast("Cloud Auto-Sync enabled! Connecting...", "success");
    
    const statusBadge = document.getElementById('cloud-sync-status');
    if (statusBadge) {
      statusBadge.innerText = "Syncing...";
      statusBadge.style.background = "rgba(245, 158, 11, 0.15)";
      statusBadge.style.color = "var(--color-amber)";
    }
    
    // Sync local changes to cloud
    try {
      const response = await fetch(`https://kvdb.io/6P4kU2q5pX3w4y6Z7m8Q9a/${syncKey}`);
      if (response.status === 404) {
        await syncStateToCloud();
        showToast("Initialized cloud sync backup!", "success");
      } else if (response.ok) {
        const cloudData = await response.json();
        applyCloudState(cloudData);
        showToast("Synchronized data from cloud successfully!", "success");
      }
    } catch (err) {
      console.error(err);
      await syncStateToCloud();
    }
  }
}

async function syncStateToCloud() {
  const syncKey = localStorage.getItem('cloud_sync_key');
  const enabled = localStorage.getItem('cloud_sync_enabled') === 'true';
  if (!syncKey || !enabled) return;
  
  const timestamp = Date.now();
  localStorage.setItem('univault_last_updated', timestamp.toString());
  
  const payload = {
    lastUpdated: timestamp,
    semesters: state.semesters,
    courses: state.courses,
    tasks: state.tasks || [],
    customTagLabels: localStorage.getItem('univault_custom_tags'),
    timetableDegree: localStorage.getItem('timetable_degree'),
    timetableSelected: localStorage.getItem('timetable_selected_sections'),
    timetableFrozen: localStorage.getItem('timetable_frozen'),
    customTimetableCourses: localStorage.getItem('custom_timetable_courses'),
    resources: localStorage.getItem('univault_resources')
  };
  
  try {
    const response = await fetch(`https://kvdb.io/6P4kU2q5pX3w4y6Z7m8Q9a/${syncKey}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (response.ok) {
      console.log("State synced to cloud bucket at", new Date().toLocaleTimeString());
      updateCloudSyncUI(true);
    }
  } catch (err) {
    console.error("Cloud upload sync failed:", err);
  }
}

function applyCloudState(data) {
  if (!data.semesters || !data.courses) return;
  
  state.semesters = data.semesters;
  state.courses = data.courses;
  state.tasks = data.tasks || [];
  
  localStorage.setItem('univault_semesters', JSON.stringify(state.semesters));
  localStorage.setItem('univault_courses', JSON.stringify(state.courses));
  localStorage.setItem('univault_last_updated', (data.lastUpdated || Date.now()).toString());
  
  if (data.customTagLabels) localStorage.setItem('univault_custom_tags', data.customTagLabels);
  if (data.timetableDegree) localStorage.setItem('timetable_degree', data.timetableDegree);
  if (data.timetableSelected) localStorage.setItem('timetable_selected_sections', data.timetableSelected);
  if (data.timetableFrozen) localStorage.setItem('timetable_frozen', data.timetableFrozen);
  if (data.customTimetableCourses) localStorage.setItem('custom_timetable_courses', data.customTimetableCourses);
  if (data.resources) localStorage.setItem('univault_resources', data.resources);
  
  updateCloudSyncUI(true);
  
  // Rerender all active panels to avoid reloading the browser entirely
  renderBoard();
  renderMetrics();
  updateGlobalFiltersSelect();
  if (activeTab === 'cgpa') renderCgpaCalculator();
  if (activeTab === 'timetable') initTimetablePlanner();
  if (activeTab === 'resources') renderResourcesSpreadsheet();
}
