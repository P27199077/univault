import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePerformancePages,mergePerformanceSheet,academicTotals,courseGrade,GRADE_POINTS} from '../academics.js';

// Invented records exercise the PDF's column layout; no student's transcript is bundled.
const cell=(str,x,y)=>({str,x,y});
function samplePages() {
  return [{width:600,items:[
    cell('Performance Sheet',230,760),cell('CGPA: 9.33',400,735),
    cell('FIRST SEMESTER 2030-2031',100,700),cell('SECOND SEMESTER 2030-2031',395,700),
    cell('Course No.',20,680),cell('Course No.',310,680),
    // Deliberately column-major, matching PDF text drawing order.
    cell('TEST F101',20,660),cell('TEST F102',20,640),
    cell('DESIGN 2',75,660),cell('PRACTICAL',75,640),
    cell('4.0',220,660),cell('0.5',220,640),cell('A-',245,660),cell('SA',245,640),
    cell('TEST F201',310,660),cell('STUDIES',365,660),cell('2.0',510,660),cell('A',535,660),
    cell('Pending Courses (To be eligible for graduation)',20,600),
    cell('Year 2 Sem 1',110,580),cell('Year 2 Sem 2',370,580),
    cell('Year 2 Sem 1',110,570),
    cell('Course No.',20,550),cell('Course No.',270,550),
    cell('TEST F301',20,530),cell('FUTURE LEFT',75,530),cell('3.0',235,530),
    cell('TEST F401',270,530),cell('FUTURE RIGHT',325,530),cell('5.0',485,530)
  ]}];
}

test('reconstructs unequal side-by-side tables, minus grades, half credits, and repeated headings',()=>{
  const report=parsePerformancePages(samplePages());
  assert.equal(report.semesters.length,4);
  assert.deepEqual(report.semesters.map(s=>s.courses.length),[2,1,1,1]);
  assert.equal(report.semesters[0].courses[0].grade,'A-');
  assert.equal(report.semesters[0].courses[0].title,'DESIGN 2');
  assert.equal(report.semesters[0].courses[1].credits,.5);
  assert.equal(report.semesters[3].courses[0].code,'TEST F401');
  assert.equal(report.semesters[2].key,'academic:2031:1');
  assert.equal(report.reportedCgpa,9.33);
});

test('invalid sheets fail rather than inventing records or silently guessing grades',()=>{
  assert.throws(()=>parsePerformancePages([{width:600,items:[cell('Not a transcript',20,700)]}]),/performance-sheet/);
  assert.throws(()=>parsePerformancePages([{width:600,items:[cell('Performance Sheet',20,700)]}]),/No course table/);
  const pages=samplePages();pages[0].items.find(x=>x.str==='A-').str='Z';
  assert.throws(()=>parsePerformancePages(pages),/could not be read/);
});

test('credit weighting uses actual letter grades; pending, special reports, and zero credits are excluded',()=>{
  assert.deepEqual(GRADE_POINTS,{'A':10,'A-':9,'B':8,'B-':7,'C':6,'C-':5,'D':4,'E':2});
  const summary=academicTotals([
    {credits:4,grade:'A−'},{credits:2,grade:'A'},{credits:.5,grade:'SA'},
    {credits:8,grade:''},{credits:3,grade:'RRA'},{credits:0,grade:'A'},
    {credits:1,grade:'E'}
  ]);
  assert.equal(summary.points,58);assert.equal(summary.gradedCredits,7);
  assert.equal(summary.gpa,58/7);assert.equal(summary.totalCredits,18.5);
  assert.equal(academicTotals([{credits:4,grade:''}]).gpa,null);
  assert.equal(courseGrade({grade:'',targetGrade:'A'}),'');
});

test('imports recorded grades by default, preserves existing records and is idempotent',()=>{
  const report=parsePerformancePages(samplePages());
  const current={semesters:[{id:'other-sem',name:'My custom semester'}],courses:[{id:'other-course',semesterId:'other-sem',code:'OTHER F100',name:'Existing',credits:3,notes:'Keep me'}],tasks:[{id:'task'}]};
  const result=mergePerformanceSheet(current,report);
  assert.equal(result.counts.added,3);assert.equal(result.state.semesters.length,3);
  assert.equal(current.courses.length,1);assert.equal(result.state.courses[0].notes,'Keep me');
  result.state.courses[1].notes='My notes';result.state.courses[1].checklist=[{id:'check',text:'Read'}];
  const again=mergePerformanceSheet(result.state,report);
  assert.equal(again.counts.added,0);assert.equal(again.counts.unchanged,3);
  assert.equal(again.state.courses[1].id,result.state.courses[1].id);
  assert.equal(again.state.courses[1].notes,'My notes');assert.equal(again.state.courses[1].checklist[0].id,'check');
  assert.equal(again.state.tasks[0].id,'task');
});

test('future courses are opt-in and their later completed semester updates the same IDs',()=>{
  const report=parsePerformancePages(samplePages());
  const first=mergePerformanceSheet({semesters:[],courses:[]},report,{includePending:true});
  assert.equal(first.state.courses.length,5);
  const pending=first.state.courses.find(c=>c.code==='TEST F301');
  const update={startYear:2030,semesters:[{semName:'First Semester 2031-2032',key:'academic:2031:1',courses:[{code:'TEST F301',title:'FUTURE LEFT',credits:3,grade:'B-'}]}]};
  const next=mergePerformanceSheet(first.state,update);
  assert.equal(next.counts.added,0);assert.equal(next.counts.updated,1);
  assert.equal(next.state.courses.find(c=>c.code==='TEST F301').id,pending.id);
  assert.equal(next.state.courses.find(c=>c.code==='TEST F301').grade,'B-');
  const reimport=mergePerformanceSheet(next.state,report,{includePending:true});
  assert.equal(reimport.state.courses.find(c=>c.code==='TEST F301').grade,'B-');
});

test('invalid merge does not mutate existing records, and saved legacy grades remain readable',()=>{
  const current={semesters:[{id:'sem',name:'First Semester 2030-2031'}],courses:[{id:'course',semesterId:'sem',code:'TEST F101',name:'My Course',credits:4,targetGrade:'B',notes:'Notes'}]};
  const before=structuredClone(current);const report=parsePerformancePages(samplePages());
  report.semesters[0].courses[0].credits=NaN;
  assert.throws(()=>mergePerformanceSheet(current,report),/invalid course/);
  assert.deepEqual(current,before);
  assert.equal(academicTotals(current.courses).gpa,8);
});

test('pending courses and elective placeholders never inflate earned credits or GPA',()=>{
  const totals=academicTotals([
    {credits:4,grade:'A'},{credits:.5,grade:'SA'},
    {credits:3,grade:''},{credits:2,grade:'',isPlaceholder:true,electiveType:'HuEL'},
    {credits:3,grade:'A',isPlaceholder:true,electiveType:'DEL'}
  ]);
  assert.equal(totals.earnedCredits,4.5);assert.equal(totals.completedCourses,2);
  assert.equal(totals.plannedCredits,8);assert.equal(totals.placeholderCount,2);
  assert.equal(totals.gradedCredits,4);assert.equal(totals.gpa,10);
  assert.equal(academicTotals([{credits:3,grade:'E'}]).earnedCredits,0);
  assert.equal(academicTotals([{credits:3,grade:'E'}]).gpa,2);
});

test('elective slots need only category, semester and credits; choosing a course keeps its workspace',async()=>{
  const {buildCourseRecord}=await import('../academics.js');
  const input={mode:'placeholder',electiveType:'DEL',semesterId:'current',credits:'3'};
  const first=buildCourseRecord(input);
  const second=buildCourseRecord(input,null,[first]);
  assert.equal(first.name,'DEL 1');assert.equal(second.name,'DEL 2');
  assert.equal(first.grade,'');assert.equal(first.isPlaceholder,true);
  first.notes='Keep these notes';first.checklist=[{id:'task',text:'Choose an elective'}];
  const resolved=buildCourseRecord({mode:'course',name:'Chosen elective',code:'TEST F999',semesterId:'current',credits:'3'},first,[first,second]);
  assert.equal(resolved.id,first.id);assert.equal(resolved.notes,'Keep these notes');
  assert.equal(resolved.checklist[0].id,'task');assert.equal(resolved.isPlaceholder,false);
  assert.equal(academicTotals([resolved]).earnedCredits,0);
  assert.equal(academicTotals([{...resolved,grade:'B'}]).earnedCredits,3);
  assert.throws(()=>buildCourseRecord({...input,credits:''}),/valid credits/);
  assert.throws(()=>buildCourseRecord({...input,electiveType:'Invalid'}),/Choose DEL/);
  assert.throws(()=>buildCourseRecord(input,{...resolved,grade:'A'}),/recorded grade/);
});

test('midsem estimates are temporary, semester-scoped, and never borrow or overwrite final grades',async()=>{
  const {estimateSemester}=await import('../academics.js');
  const courses=[{id:'one',semesterId:'current',credits:4,grade:'A'}, {id:'two',semesterId:'current',credits:2,grade:''}, {id:'slot',semesterId:'current',credits:3,isPlaceholder:true,grade:''}];
  const before=structuredClone(courses);
  assert.equal(estimateSemester(courses).gpa,null);
  const estimate=estimateSemester(courses,{one:'B-',two:'A',slot:'A'});
  assert.equal(estimate.gpa,8);assert.equal(estimate.gradedCredits,6);assert.equal(estimate.eligibleCourses,2);
  assert.deepEqual(courses,before);assert.equal(academicTotals(courses).gpa,10);
  assert.equal(academicTotals(courses).earnedCredits,4);
  assert.equal(estimateSemester(courses,{two:'B'}).gpa,8);
});
