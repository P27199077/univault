import test from 'node:test';
import assert from 'node:assert/strict';
import {bookSections,moveItem,sectionFiles} from '../book-sections.js';
test('contents preserve custom order, deduplicate and include new built-in sections',()=>{
 const course={bookSections:[{id:'page-lab',name:'Lab work'},{id:'slides',name:'invalid override'},{id:'page-lab',name:'duplicate'}],bookSectionOrder:['page-lab','slides','slides','missing']};
 const sections=bookSections(course);
 assert.deepEqual(sections.slice(0,2).map(s=>s.id),['page-lab','slides']);
 assert.equal(sections.find(s=>s.id==='slides').name,'Lecture slides');
 assert.ok(sections.some(s=>s.id==='tutorials'));assert.equal(new Set(sections.map(s=>s.id)).size,sections.length);
 assert.deepEqual(bookSections(JSON.parse(JSON.stringify(course))),sections);
});
test('moving a page keeps every section and leaves boundaries unchanged',()=>{
 const ids=['slides','notes','handouts'];assert.deepEqual(moveItem(ids,'handouts',-1),['slides','handouts','notes']);assert.deepEqual(ids,['slides','notes','handouts']);assert.deepEqual(moveItem(ids,'slides',-1),ids);
});
test('file sequence respects saved order, appends new files and ignores removed files',()=>{
 const files=[{id:'b',type:'slides',name:'Lecture 2',uploadedAt:'2026-01-02'},{id:'a',type:'slides',name:'Lecture 1',uploadedAt:'2026-01-01'},{id:'c',type:'slides',name:'Lecture 3',uploadedAt:'2026-01-03'},{id:'d',type:'tutorials',name:'Tutorial 1'}];
 assert.deepEqual(sectionFiles(files,{},'slides').map(f=>f.id),['a','b','c']);
 assert.deepEqual(sectionFiles(files,{bookFileOrder:{slides:['b','removed','a']}},'slides').map(f=>f.id),['b','a','c']);assert.equal(files[0].id,'b');
});
