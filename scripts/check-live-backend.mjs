import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import {createBackend} from '../backend.js';
const fixtures=JSON.parse(await readFile(process.env.UNIVAULT_TEST_FIXTURES || '/private/tmp/univault-backend-fixtures.json','utf8'));
const config=await readFile(new URL('../backend-config.js',import.meta.url),'utf8');
const url=config.match(/supabaseUrl:\s*'([^']+)'/)[1];
const key=config.match(/supabasePublishableKey:\s*'([^']+)'/)[1];
const client=() => createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const a=client(),b=client(),anon=client();
class MemoryStorage {
  values=new Map();
  getItem(key) {return this.values.get(key) ?? null;}
  setItem(key,value) {this.values.set(key,String(value));}
  removeItem(key) {this.values.delete(key);}
}
const makeBackend=client=>createBackend({client,storage:new MemoryStorage(),delay:600000});
for (const [sdk,user] of [[a,fixtures[0]],[b,fixtures[1]]]) {
  const {data,error}=await sdk.auth.signInWithPassword({email:user.email,password:user.password});
  assert.ifError(error);assert.equal(data.user.id,user.id);
}
console.log('PASS: real Supabase email/password sign-in for two temporary accounts');
const first=makeBackend(a),second=makeBackend(b);
await first.initialize();await second.initialize();
first.workspaceStorage.setItem('univault_semesters','[{"id":"test-sem","name":"Backend check"}]');
first.workspaceStorage.setItem('univault_courses','[{"id":"test-course","semesterId":"test-sem","name":"Backend verification","code":"TEST 101","prof":"Test fixture","themeColor":"emerald","notes":"Saved in Supabase","checklist":[{"id":"test-task","text":"Verify saved notes","completed":false}]}]');
first.workspaceStorage.setItem('calendar_events_list','[{"id":"test-event","title":"Backend check","tag":"blue","startDate":"2026-11-11","endDate":"2026-11-11","repeat":"none","completedDates":[]}]');
first.workspaceStorage.setItem('custom_timetable_exams','{"test-course":{"date":"2026-12-01"}}');
await first.flush();
assert.equal(second.workspaceStorage.getItem('univault_courses'),'[]');
const otherRead=await b.from('workspaces').select('*').eq('user_id',fixtures[0].id);
assert.ifError(otherRead.error);assert.deepEqual(otherRead.data,[]);
const anonymousRead=await anon.from('workspaces').select('*');
assert(anonymousRead.error || anonymousRead.data.length===0);
const anonymousWrite=await anon.rpc('save_workspace',{payload:{version:1,values:{}},expected_revision:0});
assert(anonymousWrite.error);
const stolenWrite=await b.from('workspaces').upsert({user_id:fixtures[0].id,data:{version:1,values:{}},revision:1});
assert(stolenWrite.error);
console.log('PASS: anonymous access and reading/writing another account’s workspace are blocked');
const file={id:'integration-file',courseId:'test-course',name:'verification.txt',type:'notes',mimeType:'text/plain',content:new Blob(['Private course material'])};
await first.storeFile(file);
const record=first.listFiles()[0];
assert.equal(await (await first.downloadFile(record)).text(),'Private course material');
const otherFile=await b.storage.from('course-materials').download(record.storagePath);assert(otherFile.error);
const anonymousFile=await anon.storage.from('course-materials').download(record.storagePath);assert(anonymousFile.error);
const otherUpload=await b.storage.from('course-materials').upload(`${fixtures[0].id}/forbidden`,new Blob(['blocked']));assert(otherUpload.error);
const otherMetadata=await b.from('materials').select('*').eq('owner_id',fixtures[0].id);assert.deepEqual(otherMetadata.data,[]);
console.log('PASS: private upload/download succeeds; another account and anonymous downloads are blocked');
const otherDevice=makeBackend(a);await otherDevice.initialize();
assert.match(otherDevice.workspaceStorage.getItem('calendar_events_list'),/Backend check/);
assert.match(otherDevice.workspaceStorage.getItem('custom_timetable_exams'),/2026-12-01/);
assert.equal(await (await otherDevice.downloadFile(otherDevice.listFiles()[0])).text(),'Private course material');
first.workspaceStorage.setItem('calendar_general_notes','["Laptop change"]');await first.flush();
otherDevice.workspaceStorage.setItem('calendar_general_notes','["Phone change"]');
await assert.rejects(otherDevice.flush(),error=>error.code==='UV409');
assert.equal(otherDevice.workspaceStorage.getItem('calendar_general_notes'),'["Phone change"]');
await otherDevice.reloadCloud();
assert.equal(otherDevice.workspaceStorage.getItem('calendar_general_notes'),'["Laptop change"]');
console.log('PASS: another device restores courses, calendar, exams, files; concurrent writes are protected');
await first.deleteFile('integration-file');
const deleted=await a.storage.from('course-materials').download(record.storagePath);assert(deleted.error);
await first.storeFile({...file,id:'browser-preview-file',content:new Blob(['This private note was uploaded through the real Supabase backend.'])});
console.log('PASS: deleting a material removes its stored file; a temporary note is ready for browser verification');
await a.auth.signOut({scope:'local'});await b.auth.signOut({scope:'local'});
