import test from 'node:test';
import assert from 'node:assert/strict';
import {createBackend,WORKSPACE_KEYS,validateSnapshot} from '../backend.js';

class MemoryStorage {
  values = new Map();
  getItem(key) {return this.values.get(key) ?? null;}
  setItem(key,value) {this.values.set(key,String(value));}
  removeItem(key) {this.values.delete(key);}
}
function fixture(userId='alice',shared=new Map(),storage=new MemoryStorage()) {
  let sessionUser = {id:userId,email:`${userId}@example.invalid`};
  const files = new Map();
  const blobs = new Map();
  let rpcError = null;
  let gate = null;
  let confirmation = false;
  const client = {
    auth: {
      getSession:async () => ({data:{session:sessionUser ? {user:sessionUser} : null}}),
      signInWithPassword:async ({email}) => ({data:{user:sessionUser={id:email.split('@')[0],email}}}),
      signUp:async () => ({data:{user:{id:'new'},session:confirmation ? null : {user:{id:'new'}}}}),
      signOut:async () => {sessionUser=null; return {};}
    },
    from(table) {
      const filters = {};
      let operation='select';
      let row;
      const run = () => {
        if (table === 'workspaces') return {data:shared.get(filters.user_id) || null};
        if (operation === 'upsert') {files.set(row.id,row); return {data:row};}
        if (operation === 'delete') {files.delete(filters.id); return {};}
        return {data:[...files.values()].filter(file => !filters.owner_id || file.owner_id === filters.owner_id)};
      };
      const query = {
        select:() => query, eq:(key,value) => {filters[key]=value; return query;},
        maybeSingle:async () => run(), order:() => query,
        upsert:data => {operation='upsert';row=data;return query;},
        delete:() => {operation='delete';return query;},
        then:(resolve,reject) => Promise.resolve(run()).then(resolve,reject)
      };
      return query;
    },
    async rpc(name,{payload,expected_revision}) {
      if (gate) {const waiting=gate;gate=null;await waiting;}
      if (rpcError) return {error:rpcError};
      const current = shared.get(sessionUser.id);
      if ((current?.revision || 0) !== expected_revision) return {error:{code:'UV409'}};
      const revision = expected_revision + 1;
      shared.set(sessionUser.id,{data:structuredClone(payload),revision});
      return {data:revision};
    },
    storage:{from:() => ({
      upload:async (path,blob) => {blobs.set(path,blob);return {};},
      remove:async paths => {paths.forEach(path=>blobs.delete(path));return {};},
      download:async path => ({data:blobs.get(path)})
    })}
  };
  const events=[];
  const backend = createBackend({client,storage,delay:600000,onStatus:event=>events.push(event)});
  return {backend,client,storage,shared,files,blobs,events,setRpcError:value=>rpcError=value,setGate:value=>gate=value,setConfirmation:value=>confirmation=value,setSignedOut:()=>sessionUser=null};
}

test('new accounts start empty and do not silently adopt the browser workspace',async () => {
  const f=fixture();f.storage.setItem('univault_courses','[{"id":"private-legacy"}]');
  await f.backend.initialize();
  assert.deepEqual(JSON.parse(f.backend.workspaceStorage.getItem('univault_courses')),[]);
  assert.equal(f.storage.getItem('univault_courses'),'[{"id":"private-legacy"}]');
});

test('each account has separate local course, calendar, exam and note storage',async () => {
  const storage=new MemoryStorage();
  const a=fixture('alice',new Map(),storage),b=fixture('bob',new Map(),storage);
  await a.backend.initialize();await b.backend.initialize();
  for (const key of WORKSPACE_KEYS) a.backend.workspaceStorage.setItem(key,'[]');
  a.backend.workspaceStorage.setItem('calendar_events_list','[{"title":"Alice exam"}]');
  a.backend.workspaceStorage.setItem('custom_timetable_exams','{"CS":{"date":"2026-12-01"}}');
  await a.backend.flush();
  assert.equal(b.backend.workspaceStorage.getItem('calendar_events_list'),'[]');
  assert.equal(b.backend.workspaceStorage.getItem('custom_timetable_exams'),null);
  assert.match(a.shared.get('alice').data.values.calendar_events_list,/Alice exam/);
  assert.match(a.shared.get('alice').data.values.custom_timetable_exams,/2026-12-01/);
});

test('passwords and auth session values never enter cloud workspace backups',() => {
  const f=fixture();
  f.storage.setItem('univault_users','password-in-old-prototype');
  f.storage.setItem('univault-auth','private-session');
  assert.doesNotMatch(JSON.stringify(f.backend.legacySnapshot()),/password-in|private-session/);
  assert.equal(validateSnapshot({version:1,values:{password:'secret'}}).values.password,undefined);
});

test('a failed save keeps a durable pending copy and can be retried after reloading',async () => {
  const f=fixture();await f.backend.initialize();
  f.backend.workspaceStorage.setItem('univault_courses','[{"id":"saved-later"}]');
  f.setRpcError({message:'offline'});
  await assert.rejects(f.backend.flush());
  assert.equal(f.backend.hasPendingChanges,true);
  const reopened=fixture('alice',f.shared,f.storage);
  await reopened.backend.initialize();await reopened.backend.flush();
  assert.match(reopened.shared.get('alice').data.values.univault_courses,/saved-later/);
});

test('edits made during an in-flight save are saved in a subsequent revision',async () => {
  const f=fixture();await f.backend.initialize();
  let release;f.setGate(new Promise(resolve=>release=resolve));
  f.backend.workspaceStorage.setItem('calendar_general_notes','["first"]');
  const saving=f.backend.flush();
  f.backend.workspaceStorage.setItem('calendar_general_notes','["second"]');
  release();await saving;
  assert.equal(f.shared.get('alice').data.values.calendar_general_notes,'["second"]');
  assert.equal(f.shared.get('alice').revision,2);
});

test('concurrent devices cannot silently overwrite one another',async () => {
  const shared=new Map();const a=fixture('alice',shared),b=fixture('alice',shared);
  await a.backend.initialize();await b.backend.initialize();
  a.backend.workspaceStorage.setItem('calendar_general_notes','["from laptop"]');
  await a.backend.flush();
  b.backend.workspaceStorage.setItem('calendar_general_notes','["from phone"]');
  await assert.rejects(b.backend.flush());
  assert.equal(b.backend.workspaceStorage.getItem('calendar_general_notes'),'["from phone"]');
  assert.equal(shared.get('alice').data.values.calendar_general_notes,'["from laptop"]');
  assert.equal(b.events.at(-1).state,'conflict');
  await b.backend.reloadCloud();
  assert.equal(b.backend.workspaceStorage.getItem('calendar_general_notes'),'["from laptop"]');
  assert.match(b.storage.getItem('univault:alice:_before-reload'),/from phone/);
});

test('email confirmation does not grant a signed-in application session',async () => {
  const f=fixture();f.setSignedOut();f.setConfirmation(true);
  await f.backend.initialize();
  const result=await f.backend.signUp('new@example.invalid','random-password','http://localhost:3000');
  assert.equal(result.needsConfirmation,true);assert.equal(f.backend.signedIn,false);
});

test('logout refuses to abandon failed saves and clears synced account cache only',async () => {
  const f=fixture();f.storage.setItem('univault_courses','["legacy stays"]');
  await f.backend.initialize();
  f.backend.workspaceStorage.setItem('calendar_general_notes','["unsaved"]');
  f.setRpcError({message:'offline'});await assert.rejects(f.backend.signOut());
  assert.equal(f.backend.signedIn,true);
  f.setRpcError(null);await f.backend.signOut();
  assert.equal(f.backend.signedIn,false);
  assert.equal(f.storage.getItem('univault:alice:calendar_general_notes'),null);
  assert.equal(f.storage.getItem('univault_courses'),'["legacy stays"]');
});

test('files are private to the account and can be downloaded, then deleted',async () => {
  const f=fixture();await f.backend.initialize();
  f.backend.workspaceStorage.setItem('univault_courses','[{"id":"CS-1"}]');
  await f.backend.storeFile({id:'file-1',courseId:'CS-1',name:'lecture.txt',type:'notes',mimeType:'text/plain',content:new Blob(['lecture'])});
  const record=f.backend.listFiles()[0];assert.equal(record.storagePath,'alice/file-1');
  assert.equal(await (await f.backend.downloadFile(record)).text(),'lecture');
  await assert.rejects(f.backend.downloadFile({...record,storagePath:'bob/file-1'}));
  await f.backend.deleteFile('file-1');
  assert.equal(f.backend.listFiles().length,0);assert.equal(f.blobs.size,0);
});

test('migration preserves original data and retries only missing files',async () => {
  const f=fixture();f.storage.setItem('univault_courses','[{"id":"CS-1"}]');
  f.storage.setItem('calendar_events_list','[{"title":"legacy calendar"}]');
  await f.backend.initialize();
  const record={id:'file-1',courseId:'CS-1',name:'legacy.txt',type:'notes',mimeType:'text/plain',content:new Blob(['legacy'])};
  let first=true;const upload=f.client.storage.from;
  f.client.storage.from=() => ({...upload(),upload:async (...args)=>{if (first) {first=false;return {error:new Error('offline')};}return upload().upload(...args);}});
  assert.deepEqual((await f.backend.importLegacy([record])).failedFiles,['legacy.txt']);
  assert.deepEqual((await f.backend.importLegacy([record])).failedFiles,[]);
  assert.equal(f.backend.listFiles().length,1);
  assert.equal(f.storage.getItem('calendar_events_list'),'[{"title":"legacy calendar"}]');
});
