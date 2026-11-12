// Cloud persistence is kept separate from the dashboard so it can be tested without a browser.
export const WORKSPACE_KEYS = Object.freeze([
  'univault_semesters', 'univault_courses', 'univault_tasks', 'univault_custom_tags',
  'univault_resources', 'calendar_events_list', 'calendar_general_notes',
  'calendar_tag_labels', 'calendar_accent', 'calendar_dday_enabled', 'calendar_dday_date',
  'timetable_degree', 'timetable_selected_sections', 'timetable_frozen',
  'custom_timetable_courses', 'custom_timetable_exams'
]);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const BUCKET = 'course-materials';
const EMPTY_VALUES = {'univault_semesters':'[]','univault_courses':'[]','calendar_events_list':'[]'};

export function validateSnapshot(snapshot) {
  if (snapshot?.version !== 1 || !snapshot.values || typeof snapshot.values !== 'object' || Array.isArray(snapshot.values)) {
    throw new Error('This workspace backup has an unsupported format.');
  }
  const values = {};
  for (const key of WORKSPACE_KEYS) {
    const value = snapshot.values[key] ?? null;
    if (value !== null && typeof value !== 'string') throw new Error(`Invalid saved value: ${key}`);
    values[key] = value;
  }
  for (const key of ['univault_semesters','univault_courses','calendar_events_list','univault_resources','calendar_general_notes','timetable_selected_sections','custom_timetable_courses']) {
    if (values[key] !== null && !Array.isArray(JSON.parse(values[key]))) throw new Error(`Invalid list: ${key}`);
  }
  return {version:1,values};
}

export function createBackend({client = null, storage, onStatus = () => {}, delay = 600}) {
  let user = null;
  let scope = null;
  let ready = false;
  let revision = 0;
  let epoch = 0;
  let dirty = false;
  let conflict = false;
  let timer = null;
  let inFlight = null;
  let fileList = [];
  const pendingFiles = new Set();
  const cacheKey = key => scope ? `univault:${scope}:${key}` : key;
  const metaKey = name => `univault:${scope}:_${name}`;
  const status = (state, message) => onStatus({state, message, user, dirty});
  const snapshot = () => ({version:1, values:Object.fromEntries(WORKSPACE_KEYS.map(key => [key,storage.getItem(cacheKey(key))]))});
  const setSnapshot = data => {
    const clean = validateSnapshot(data);
    for (const key of WORKSPACE_KEYS) {
      if (clean.values[key] === null) storage.removeItem(cacheKey(key));
      else storage.setItem(cacheKey(key), clean.values[key]);
    }
  };
  const assertSignedIn = () => {
    if (!client || !user || !ready) throw new Error('Sign in before accessing cloud data.');
  };
  const markDirty = () => {
    if (!user || !ready) return;
    epoch++;
    dirty = true;
    storage.setItem(metaKey('dirty'),'true');
    status(conflict ? 'conflict' : 'pending', conflict ? 'Changes found on another device. Download a backup before reloading.' : 'Saving changes…');
    clearTimeout(timer);
    if (!conflict) {timer = setTimeout(() => {flush().catch(() => {});},delay); timer?.unref?.();}
  };
  const workspaceStorage = {
    getItem:key => storage.getItem(cacheKey(key)),
    setItem(key,value) {
      const before = storage.getItem(cacheKey(key));
      storage.setItem(cacheKey(key),String(value));
      if (WORKSPACE_KEYS.includes(key) && before !== String(value)) markDirty();
    },
    removeItem(key) {
      const existed = storage.getItem(cacheKey(key)) !== null;
      storage.removeItem(cacheKey(key));
      if (existed && WORKSPACE_KEYS.includes(key)) markDirty();
    }
  };
  const cacheFiles = () => storage.setItem(metaKey('files'),JSON.stringify(fileList));
  const mapFile = row => ({id:row.id,courseId:row.course_id,name:row.name,type:row.category,mimeType:row.mime_type,size:row.size,uploadedAt:row.uploaded_at,storagePath:row.storage_path});

  async function loadFiles() {
    const {data,error} = await client.from('materials').select('*').eq('owner_id',user.id).order('uploaded_at',{ascending:false});
    if (error) throw error;
    fileList = (data || []).map(mapFile);
    cacheFiles();
  }

  async function openWorkspace(nextUser) {
    clearTimeout(timer);
    ready = false;
    user = nextUser;
    scope = user.id;
    revision = Number(storage.getItem(metaKey('revision')) || 0);
    dirty = storage.getItem(metaKey('dirty')) === 'true';
    conflict = false;
    fileList = JSON.parse(storage.getItem(metaKey('files')) || '[]');
    status('loading','Opening your workspace…');
    try {
      const {data,error} = await client.from('workspaces').select('data,revision').eq('user_id',user.id).maybeSingle();
      if (error) throw error;
      const remoteRevision = data?.revision || 0;
      if (dirty && remoteRevision !== revision) {
        conflict = true;
      } else if (!dirty) {
        setSnapshot(data?.data || {version:1,values:EMPTY_VALUES});
        revision = remoteRevision;
        storage.setItem(metaKey('revision'),String(revision));
      }
      await loadFiles();
      ready = true;
      status(conflict ? 'conflict' : dirty ? 'pending' : 'saved', conflict ? 'Changes found on another device. Download a backup before reloading.' : dirty ? 'Your changes are waiting to sync.' : 'All changes saved');
      if (dirty && !conflict) {timer = setTimeout(() => {flush().catch(() => {});},delay); timer?.unref?.();}
    } catch (error) {
      // Only open an offline cache that was previously hydrated for this same account.
      if (storage.getItem(metaKey('revision')) !== null) {
        ready = true;
        status('offline','Offline. Your changes stay on this device until you reconnect.');
      } else {
        user = null;
        scope = null;
        throw new Error('Could not open your cloud workspace. Please check your connection and try again.',{cause:error});
      }
    }
  }

  async function initialize() {
    if (!client) {status('local','Saved on this device only'); return null;}
    const {data,error} = await client.auth.getSession();
    if (error) throw error;
    if (data.session?.user) await openWorkspace(data.session.user);
    else status('signed-out','Sign in to sync your workspace');
    return user;
  }

  async function signIn(email,password) {
    if (user) throw new Error('Sign out before switching accounts.');
    if (!client) throw new Error('Cloud accounts are not connected yet.');
    const {data,error} = await client.auth.signInWithPassword({email,password});
    if (error) throw error;
    await openWorkspace(data.user);
    return user;
  }

  async function signUp(email,password,redirectTo) {
    if (user) throw new Error('Sign out before creating another account.');
    if (!client) throw new Error('Cloud accounts are not connected yet.');
    const {data,error} = await client.auth.signUp({email,password,options:{emailRedirectTo:redirectTo}});
    if (error) throw error;
    if (data.session) await openWorkspace(data.user);
    return {user,needsConfirmation:!data.session};
  }

  async function flush() {
    clearTimeout(timer);
    if (!user || !ready || !dirty) return;
    if (conflict) throw new Error('Another device has saved changes. Download your backup, then reload the cloud version.');
    if (inFlight) return inFlight;
    inFlight = (async () => {
      while (dirty) {
        const version = epoch;
        const owner = user.id;
        const payload = validateSnapshot(snapshot());
        status('saving','Saving changes…');
        const {data,error} = await client.rpc('save_workspace',{payload,expected_revision:revision});
        if (error) {
          if (error.code === 'UV409') {
            conflict = true;
            status('conflict','Changes found on another device. Download a backup before reloading.');
          } else status('offline','Changes saved on this device. Reconnect and try syncing again.');
          throw error;
        }
        if (user?.id !== owner) throw new Error('Account changed while saving.');
        revision = Number(data);
        storage.setItem(metaKey('revision'),String(revision));
        dirty = version !== epoch;
        storage.setItem(metaKey('dirty'),String(dirty));
      }
      status('saved','All changes saved');
    })().finally(() => {inFlight = null;});
    return inFlight;
  }

  async function reloadCloud() {
    assertSignedIn();
    if (inFlight) await inFlight;
    const {data,error} = await client.from('workspaces').select('data,revision').eq('user_id',user.id).maybeSingle();
    if (error) throw error;
    // Keep the current copy available even if the user chooses the remote version.
    storage.setItem(metaKey('before-reload'),JSON.stringify(snapshot()));
    setSnapshot(data?.data || {version:1,values:EMPTY_VALUES});
    revision = data?.revision || 0;
    dirty = false;
    conflict = false;
    storage.setItem(metaKey('revision'),String(revision));
    storage.setItem(metaKey('dirty'),'false');
    await loadFiles();
    status('saved','All changes saved');
  }

  async function signOut() {
    if (!client || !user) return;
    await Promise.all([...pendingFiles]);
    await flush(); // Do not silently abandon unsaved changes when leaving an account.
    const {error} = await client.auth.signOut({scope:'local'});
    if (error) throw error;
    clearTimeout(timer);
    // Remove this account's cached content from a shared browser after a successful logout.
    for (const key of WORKSPACE_KEYS) storage.removeItem(cacheKey(key));
    for (const key of ['revision','dirty','files','before-reload']) storage.removeItem(metaKey(key));
    user = null;
    scope = null;
    ready = false;
    fileList = [];
    dirty = false;
    conflict = false;
    status('signed-out','Sign in to sync your workspace');
  }

  function legacySnapshot() {
    return {version:1,values:Object.fromEntries(WORKSPACE_KEYS.map(key => [key,storage.getItem(key)]))};
  }

  async function importLegacy(files = []) {
    assertSignedIn();
    const current = snapshot();
    const occupied = ['univault_courses','univault_semesters','calendar_events_list','univault_resources','calendar_general_notes','custom_timetable_courses'].some(key => JSON.parse(current.values[key] || '[]').length > 0);
    if (storage.getItem(metaKey('legacy-imported')) !== 'true') {
      if (occupied || fileList.length) throw new Error('Import into an empty account to avoid replacing existing work.');
      const legacy = validateSnapshot(legacySnapshot());
      setSnapshot(legacy);
      markDirty();
      await flush();
      storage.setItem(metaKey('legacy-imported'),'true');
    }
    // Import is repeatable; stable IDs prevent duplicated files after an interrupted upload.
    const failures = [];
    for (const file of files) {
      try {await storeFile(file);} catch (error) {failures.push(file.name);}
    }
    return {failedFiles:failures};
  }

  async function uploadFile(record) {
    assertSignedIn();
    if (!(record.content instanceof Blob)) throw new Error('No file content was supplied.');
    if (record.content.size > MAX_FILE_SIZE) throw new Error('Each file must be 50 MB or smaller.');
    if (!/^[a-zA-Z0-9_-]+$/.test(record.id)) throw new Error('Invalid file ID.');
    if (fileList.some(file => file.id === record.id)) return; // Successful previous import.
    await flush(); // Persist course ownership before attaching its materials.
    const courses = JSON.parse(workspaceStorage.getItem('univault_courses') || '[]');
    if (!courses.some(course => course.id === record.courseId)) throw new Error('Add the course before uploading files.');
    const owner = user.id;
    const path = `${owner}/${record.id}`;
    const {error:uploadError} = await client.storage.from(BUCKET).upload(path,record.content,{contentType:record.mimeType || 'application/octet-stream',upsert:true});
    if (uploadError) throw uploadError;
    const metadata = {id:record.id,owner_id:owner,course_id:record.courseId,name:record.name,category:record.type,mime_type:record.mimeType || 'application/octet-stream',size:record.content.size,uploaded_at:record.uploadedAt || new Date().toISOString(),storage_path:path};
    const {error} = await client.from('materials').upsert(metadata,{onConflict:'owner_id,id'});
    if (error) {
      await client.storage.from(BUCKET).remove([path]);
      throw error;
    }
    fileList = [mapFile(metadata),...fileList.filter(file => file.id !== record.id)];
    cacheFiles();
  }

  async function removeFile(id) {
    assertSignedIn();
    const file = fileList.find(item => item.id === id);
    if (!file) return;
    const {error:storageError} = await client.storage.from(BUCKET).remove([file.storagePath]);
    if (storageError) throw storageError;
    const {error} = await client.from('materials').delete().eq('owner_id',user.id).eq('id',id);
    if (error) throw error;
    fileList = fileList.filter(item => item.id !== id);
    cacheFiles();
  }

  function trackFileMutation(operation) {
    pendingFiles.add(operation);
    status('uploading','Updating private files…');
    return operation.finally(() => {
      pendingFiles.delete(operation);
      if (!pendingFiles.size && !dirty && !conflict) status('saved','All changes saved');
    });
  }
  const storeFile = record => trackFileMutation(uploadFile(record));
  const deleteFile = id => trackFileMutation(removeFile(id));

  async function downloadFile(record) {
    assertSignedIn();
    if (!record.storagePath?.startsWith(`${user.id}/`)) throw new Error('This file belongs to another account.');
    const {data,error} = await client.storage.from(BUCKET).download(record.storagePath);
    if (error) throw error;
    return data;
  }

  return {
    workspaceStorage, initialize, signIn, signUp, signOut, flush, reloadCloud,
    snapshot, legacySnapshot, importLegacy, storeFile, deleteFile, downloadFile,
    listFiles:courseId => fileList.filter(file => !courseId || file.courseId === courseId),
    get user() {return user;}, get configured() {return !!client;},
    get signedIn() {return !!user && ready;}, get hasPendingChanges() {return dirty || pendingFiles.size > 0;}
  };
}
