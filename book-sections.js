export const DEFAULT_SECTIONS = [
  {id:'handouts',name:'Handouts & syllabus'},
  {id:'slides',name:'Lecture slides'},
  {id:'tutorials',name:'Tutorial slides'},
  {id:'notes',name:'Lecture notes'},
  {id:'papers',name:'Papers & solutions'},
  {id:'notebook',name:'Your notepad'},
  {id:'tasks',name:'Checklist & tasks'}
];
export function bookSections(course={}) {
  const custom=(Array.isArray(course.bookSections)?course.bookSections:[]).filter(s=>/^page-[a-z0-9-]{1,80}$/.test(s?.id)&&typeof s.name==='string'&&s.name.trim()).map(s=>({id:s.id,name:s.name.trim().slice(0,60)}));
  const all=[...DEFAULT_SECTIONS,...custom].filter((s,i,a)=>a.findIndex(t=>t.id===s.id)===i);
  const order=Array.isArray(course.bookSectionOrder)?course.bookSectionOrder:[];
  return [...order.map(id=>all.find(s=>s.id===id)).filter(Boolean),...all.filter(s=>!order.includes(s.id))].filter((s,i,a)=>a.findIndex(t=>t.id===s.id)===i);
}
export function moveItem(ids,id,delta) {
  const copy=[...ids],i=copy.indexOf(id),j=i+delta;
  if(i>=0&&j>=0&&j<copy.length)[copy[i],copy[j]]=[copy[j],copy[i]];
  return copy;
}
export function sectionFiles(files,course,section) {
  const order=Array.isArray(course?.bookFileOrder?.[section])?course.bookFileOrder[section]:[];
  return files.filter(f=>(f.type||'slides')===section).sort((a,b)=>{
    const ai=order.indexOf(a.id),bi=order.indexOf(b.id);
    if(ai!==bi&&(ai>=0||bi>=0))return (ai<0?Infinity:ai)-(bi<0?Infinity:bi);
    return String(a.uploadedAt||'').localeCompare(String(b.uploadedAt||''))||a.name.localeCompare(b.name,undefined,{numeric:true});
  });
}
