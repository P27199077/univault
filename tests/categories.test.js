import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCourseRecord,courseCategory,academicTotals,mergePerformanceSheet} from '../academics.js';

test('unlabeled courses default to CDC while existing elective labels remain available',()=>{
  assert.equal(courseCategory({name:'Existing course',themeColor:'blue'}),'CDC');
  for(const category of ['HuEL','DEL','OpEL'])assert.equal(courseCategory({electiveType:category}),category);
  assert.equal(courseCategory({courseCategory:'CDC',electiveType:'DEL'}),'CDC');
});

test('changing a book category preserves the course identity, notes, tasks and grade',()=>{
  const existing={id:'existing',semesterId:'s',name:'Existing',code:'DEMO 1',credits:4,grade:'B',notes:'Keep me',checklist:[{id:'task',text:'Read'}],electiveType:'DEL'};
  const changed=buildCourseRecord({mode:'course',category:'HuEL',semesterId:'s',name:existing.name,code:existing.code,credits:4},existing);
  assert.equal(changed.id,existing.id);assert.equal(changed.notes,'Keep me');assert.equal(changed.checklist[0].id,'task');
  assert.equal(courseCategory(changed),'HuEL');assert.equal(academicTotals([changed]).gpa,8);
  const core=buildCourseRecord({mode:'course',category:'CDC',semesterId:'s',name:existing.name,code:existing.code,credits:4},changed);
  assert.equal(courseCategory(core),'CDC');assert.equal(core.electiveType,null);
  assert.throws(()=>buildCourseRecord({mode:'course',category:'Other',semesterId:'s',name:'X',code:'X',credits:3}),/Choose CDC/);
});

test('chosen electives and transcript updates retain their binding category',()=>{
  const slot=buildCourseRecord({mode:'placeholder',electiveType:'OpEL',semesterId:'s',credits:3});
  const chosen=buildCourseRecord({mode:'course',semesterId:'s',name:'Chosen',code:'DEMO F101',credits:3},slot);
  assert.equal(courseCategory(chosen),'OpEL');assert.equal(chosen.id,slot.id);
  const report={semesters:[{semName:'My semester',key:'my semester',courses:[{code:'DEMO F101',title:'Chosen',credits:3,grade:'A'}]}]};
  const result=mergePerformanceSheet({semesters:[{id:'s',name:'My semester'}],courses:[chosen]},report);
  assert.equal(courseCategory(result.state.courses[0]),'OpEL');assert.equal(result.state.courses[0].grade,'A');
});
