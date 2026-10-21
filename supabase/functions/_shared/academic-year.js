// A school year is derived from its semester dates, so it stays consistent without duplicate stored values.
export function academicYearFor(settings){const year=Number(String(settings.semesterStart||'').slice(0,4))||new Date().getFullYear();return `${year}-${year+1}`;}
export function validateAcademicYear(settings,schoolYear){
 const match=/^(\d{4})-(\d{4})$/.exec(schoolYear||'');if(!match||Number(match[2])!==Number(match[1])+1)return 'Choose a school year with consecutive years, such as 2026–2027.';
 const dates=[settings.semesterStart,settings.semesterEnd,settings.semester2Start,settings.semester2End];
 if(dates.some(date=>!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date))return 'Enter all four valid semester dates.';
 if(!(dates[0]<=dates[1]&&dates[1]<dates[2]&&dates[2]<=dates[3]))return 'Semesters must be chronological and must not overlap.';
 if(!dates[0].startsWith(match[1])||!dates[3].startsWith(match[2]))return 'Semester 1 must start in the first school year and Semester 2 must end in the following year.';
 return '';
}
