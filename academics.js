// Academic records come only from user input or an explicitly confirmed PDF import.
export const GRADE_POINTS = Object.freeze({'A':10,'A-':9,'B':8,'B-':7,'C':6,'C-':5,'D':4,'E':2});
export const GRADE_OPTIONS = Object.freeze(['','A','A-','B','B-','C','C-','D','E','SA','NC','RA','RRA','W','I','EXCELLENT','GOOD','FAIR','POOR']);
export const normalizeGrade = value => {
  const grade = String(value ?? '').trim().toUpperCase().replace(/[−–—]/g,'-');
  return ['PENDING','ONGOING','REGISTERED','N/A','-'].includes(grade) ? '' : grade;
};
export const courseGrade = course => course.isPlaceholder ? '' : normalizeGrade(course.grade ?? course.targetGrade);
export const ELECTIVE_TYPES = Object.freeze(['DEL','HuEL','OpEL']);

export function buildCourseRecord(input, existing=null, courses=[]) {
  const isPlaceholder=input.mode==='placeholder';
  const credits=Number(input.credits);
  if (!input.semesterId || (input.credits==='' || input.credits==null) || !Number.isFinite(credits) || credits<0 || credits>50 || (isPlaceholder && credits===0)) {
    throw new Error('Choose a semester and enter valid credits (up to 50). Elective placeholders need credits greater than zero.');
  }
  if (isPlaceholder && existing && courseGrade(existing)) throw new Error('This course already has a recorded grade. Keep it as a selected course.');
  let name=String(input.name || '').trim(),code=String(input.code || '').trim();
  if (isPlaceholder) {
    if (!ELECTIVE_TYPES.includes(input.electiveType)) throw new Error('Choose DEL, HuEL, or OpEL.');
    code=input.electiveType;
    if (existing?.isPlaceholder && existing.electiveType===code && existing.semesterId===input.semesterId) name=existing.name;
    else {
      let number=1;
      while (courses.some(course=>course.id!==existing?.id && course.semesterId===input.semesterId && course.name===`${code} ${number}`)) number++;
      name=`${code} ${number}`;
    }
  } else if (!name || !code) throw new Error('Enter the selected course name and code.');
  const course={notes:'',checklist:[],...existing,id:existing?.id || `course-${crypto.randomUUID()}`,name,code,semesterId:input.semesterId,credits,isPlaceholder,
    electiveType:isPlaceholder ? input.electiveType : existing?.electiveType || null,
    grade:isPlaceholder ? '' : courseGrade(existing || {}),themeColor:input.themeColor || 'indigo'};
  delete course.targetGrade;
  return course;
}
const clean = text => String(text).replace(/\s+/g,' ').trim();
const codeKey = text => clean(text).toUpperCase().replace(/\s/g,'');
const nameKey = text => clean(text).toLowerCase();
const semesterPattern = /(?:(FIRST|SECOND|THIRD)\s+SEMESTER\s+(\d{4})\s*-\s*(\d{2,4})|YEAR\s+(\d+)\s+SEM(?:ESTER)?\s+(\d+)|SUMMER\s+TERM(?:\s+(\d{4})(?:\s*-\s*\d{2,4})?)?)/i;
const coursePattern = /^([A-Z]{2,8})\s*([A-Z]\d{3,4}(?:-\d+)?)\s+(.+)$/;

export function semesterKey(name, startYear = null) {
  const match = clean(name).match(semesterPattern);
  if (!match) return nameKey(name);
  if (match[1]) return `academic:${match[2]}:${{FIRST:1,SECOND:2,THIRD:3}[match[1].toUpperCase()]}`;
  if (match[4] && startYear) return `academic:${startYear + Number(match[4]) - 1}:${match[5]}`;
  if (/SUMMER/i.test(match[0]) && (match[6] || startYear)) return `academic:${match[6] || startYear}:summer`;
  return nameKey(match[0]);
}

// PDF text is drawn column by column. Rebuild rows from coordinates before reading cells.
export function parsePerformancePages(pages) {
  const allText = pages.flatMap(page => page.items.map(item => item.str)).join(' ');
  if (!/performance\s+sheet/i.test(allText)) throw new Error('Choose a BITS performance-sheet PDF with selectable text. Scanned images are not supported yet.');
  const years = [...allText.matchAll(/(?:FIRST|SECOND|THIRD)\s+SEMESTER\s+(\d{4})/ig)].map(match=>Number(match[1]));
  const startYear = years.length ? Math.min(...years) : Number(allText.match(/Academic Year\s+(\d{4})/i)?.[1]) || null;
  const semesters = [];
  const byKey = new Map();
  const active = [null,null];
  let invalidRows = 0;
  for (const page of pages) {
    let divider = page.width / 2;
    const rows = [];
    const items = page.items.filter(item => clean(item.str) && Number.isFinite(item.x) && Number.isFinite(item.y)).sort((a,b)=>b.y-a.y || a.x-b.x);
    for (const item of items) {
      let row = rows.at(-1);
      if (!row || Math.abs(row.y-item.y)>2) {row={y:item.y,items:[]};rows.push(row);}
      row.items.push(item);
    }
    for (const row of rows) {
      row.items.sort((a,b)=>a.x-b.x);
      const headers = row.items.filter(item => /^Course No\.?$/i.test(clean(item.str)));
      if (headers.length) {divider = headers.length>1 ? headers[1].x-1 : Infinity;continue;}
      // Semester headings can precede a narrower two-column table, or repeat in just one column.
      const headingGroups = [row.items.filter(item=>item.x<page.width*.43),row.items.filter(item=>item.x>=page.width*.43)];
      let isHeading = false;
      for (let col=0;col<2;col++) {
        const heading = clean(headingGroups[col].map(item=>item.str).join(' ')).match(semesterPattern);
        if (!heading) continue;
        isHeading = true;
        const semName = heading[0].replace(/\b\w+/g,word=>word[0].toUpperCase()+word.slice(1).toLowerCase());
        const key = semesterKey(semName,startYear);
        if (!byKey.has(key)) {const semester={semName,key,courses:[]};byKey.set(key,semester);semesters.push(semester);}
        active[col] = byKey.get(key);
      }
      if (isHeading) continue;
      for (let col=0;col<2;col++) {
        const text = clean(row.items.filter(item => col===0 ? item.x<divider : item.x>=divider).map(item=>item.str).join(' '));
        const match = text.match(coursePattern);
        if (!match) continue;
        const tail = match[3].match(/^(.+)\s+(\d+(?:\.\d+)?)(?:\s+(A-|B-|C-|A|B|C|D|E|SA|NC|RRA|RA|W|I|EXCELLENT|GOOD|FAIR|POOR))?(?:\s+(?:DEL|HEL|EL|CDC))?$/);
        const semester = active[col];
        if (!tail || !semester) {invalidRows++;continue;}
        const credits = Number(tail[2]);
        if (!Number.isFinite(credits) || credits<0 || credits>50) {invalidRows++;continue;}
        const course={code:`${match[1]} ${match[2]}`,title:clean(tail[1]),credits,grade:normalizeGrade(tail[3])};
        const duplicate = semester.courses.find(existing=>codeKey(existing.code)===codeKey(course.code));
        if (duplicate && (duplicate.grade!==course.grade || duplicate.credits!==course.credits)) throw new Error('This sheet contains conflicting entries for a course. Please check the PDF.');
        if (!duplicate) semester.courses.push(course);
      }
    }
  }
  if (invalidRows) throw new Error('Some course rows could not be read reliably. Your workspace has not changed. Please use the original downloaded performance PDF.');
  const result = semesters.filter(semester=>semester.courses.length);
  if (!result.length) throw new Error('No course table was found. Choose the original BITS performance PDF; no sample records will be added.');
  const reportedCgpa = Number(allText.match(/CGPA\s*:?\s*(\d+(?:\.\d+)?)/i)?.[1]);
  return {semesters:result,startYear,reportedCgpa:Number.isFinite(reportedCgpa)?reportedCgpa:null};
}

export function mergePerformanceSheet(current, report, {includePending=false,id=()=>crypto.randomUUID()}={}) {
  const semesters = current.semesters.map(semester=>({...semester}));
  const courses = current.courses.map(course=>({...course}));
  const counts={added:0,updated:0,unchanged:0};
  for (const imported of report.semesters) {
    const selected=imported.courses.filter(course=>includePending || normalizeGrade(course.grade));
    if (!selected.length) continue;
    let semester=semesters.find(sem=>(sem.importKey || semesterKey(sem.name,report.startYear))===imported.key);
    if (!semester) {semester={id:`sem-${id()}`,name:imported.semName,importKey:imported.key,completed:false};semesters.push(semester);}
    else semester.importKey=imported.key;
    for (const incoming of selected) {
      if (!incoming.code || !incoming.title || !Number.isFinite(incoming.credits) || incoming.credits<0) throw new Error('The sheet contains an invalid course. No records were saved.');
      const existing=courses.find(course=>course.semesterId===semester.id && codeKey(course.code)===codeKey(incoming.code));
      if (existing) {
        const grade=normalizeGrade(incoming.grade) || courseGrade(existing);
        const changed=existing.name!==incoming.title || Number(existing.credits)!==incoming.credits || courseGrade(existing)!==grade;
        Object.assign(existing,{name:incoming.title,credits:incoming.credits,grade});
        delete existing.targetGrade;
        counts[changed?'updated':'unchanged']++;
      } else {
        courses.push({id:`course-${id()}`,name:incoming.title,code:incoming.code,semesterId:semester.id,grade:normalizeGrade(incoming.grade),credits:incoming.credits,themeColor:'indigo',notes:'',checklist:[]});
        counts.added++;
      }
    }
    const semCourses=courses.filter(course=>course.semesterId===semester.id);
    semester.completed=semCourses.length>0 && semCourses.every(course=>!!courseGrade(course));
  }
  return {state:{...current,semesters,courses},counts};
}

export function academicTotals(courses) {
  const totals={courseCount:courses.length,totalCredits:0,earnedCredits:0,completedCourses:0,plannedCredits:0,placeholderCount:0,recordedCount:0,gradedCredits:0,gradedCourses:0,points:0,gpa:null};
  for (const course of courses) {
    const credits=Number(course.credits);
    const grade=courseGrade(course);
    if (Number.isFinite(credits) && credits>=0) {
      totals.totalCredits+=credits;
      if (!grade) totals.plannedCredits+=credits;
      const passed=(Object.hasOwn(GRADE_POINTS,grade) && grade!=='E') || ['SA','EXCELLENT','GOOD','FAIR'].includes(grade);
      if (passed) {totals.earnedCredits+=credits;totals.completedCourses++;}
    }
    if (course.isPlaceholder) totals.placeholderCount++;
    if (grade) totals.recordedCount++;
    if (Object.hasOwn(GRADE_POINTS,grade) && Number.isFinite(credits) && credits>0) {
      totals.points+=GRADE_POINTS[grade]*credits;totals.gradedCredits+=credits;totals.gradedCourses++;
    }
  }
  if (totals.gradedCredits>0) totals.gpa=totals.points/totals.gradedCredits;
  return totals;
}

// Estimates use supplied temporary grades only; saved records are never changed or used as defaults.
export function estimateSemester(courses, temporaryGrades={}) {
  const selected=courses.filter(course=>!course.isPlaceholder);
  const totals=academicTotals(selected.map(course=>({...course,grade:Object.hasOwn(temporaryGrades,course.id) ? normalizeGrade(temporaryGrades[course.id]) : ''})));
  return {gpa:totals.gpa,gradedCredits:totals.gradedCredits,gradedCourses:totals.gradedCourses,eligibleCourses:selected.length};
}
