// Browser and server share these registration rules so inline feedback matches what the endpoint enforces.
import {emailValidationError,normalizePhilippineMobile} from './contact-validation.js';

const letters=/[A-Za-zÀ-ÖØ-öø-ÿ]/g;
const word="[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['-][A-Za-zÀ-ÖØ-öø-ÿ]+)*\\.?";
const namePattern=new RegExp(`^${word}(?: ${word})*$`);
export const PERSON_TYPES=['Student','Teaching Personnel','Non-Teaching Personnel'];
export const SEX_OPTIONS=['Male','Female'];

export function nameValidationError(value,label='Name'){
  const name=String(value||'').trim();
  if(!name)return `Enter your ${label.toLowerCase()}.`;
  if(name.length>50)return `${label} must not exceed 50 characters.`;
  // Words of letters joined by single spaces, apostrophes or hyphens, e.g. "Ma. Clara", "O'Neil", "Dela Cruz-Reyes".
  if(!namePattern.test(name))return `${label} can only contain letters, single spaces, apostrophes, periods and hyphens.`;
  if((name.match(letters)||[]).length<2)return `${label} must contain at least 2 letters.`;
  if(/(.)\1{3,}/i.test(name))return `${label} looks incorrect. Check for repeated letters.`;
  return '';
}

export function usernameValidationError(value){
  const username=String(value||'').trim();
  if(!username)return 'Choose a username.';
  if(username.length<4||username.length>20)return 'Username must be 4–20 characters long.';
  if(!/^[A-Za-z0-9_.-]+$/.test(username))return 'Username can only contain letters, numbers, periods, underscores and hyphens.';
  if(!/^[A-Za-z0-9].*[A-Za-z0-9]$/.test(username))return 'Username must start and end with a letter or number.';
  if(/[_.-]{2,}/.test(username))return 'Username cannot contain two symbols in a row.';
  if(/^\d+$/.test(username))return 'Username must include at least one letter.';
  return '';
}

export function passwordValidationError(value,{username='',email=''}={}){
  const password=String(value||'');
  if(!password)return 'Create a password.';
  if(/\s/.test(password))return 'Password cannot contain spaces.';
  if(password.length<8)return 'Password must be at least 8 characters.';
  if(password.length>64)return 'Password must not exceed 64 characters.';
  if(!/[A-Z]/.test(password)||!/[a-z]/.test(password)||!/\d/.test(password))return 'Password must include an uppercase letter, a lowercase letter and a number.';
  const lower=password.toLowerCase(),local=String(email||'').split('@')[0].toLowerCase(),user=String(username||'').toLowerCase();
  if((user.length>=4&&lower.includes(user))||(local.length>=4&&lower.includes(local)))return 'Password must not contain your username or email.';
  return '';
}

export function confirmPasswordValidationError(password,confirmation){
  if(!confirmation)return 'Re-enter your password.';
  return password===confirmation?'':'Passwords do not match.';
}

export function contactValidationError(value){
  const contact=String(value||'').trim();
  if(!contact)return '';
  return normalizePhilippineMobile(contact)?'':'Use 09 followed by 9 digits, or +63 followed by 10 digits starting with 9.';
}

export function schoolIdValidationError(value,personType){
  const id=String(value||'').trim(),student=personType==='Student';
  if(!id)return student?'Enter your Student ID number.':'Enter your Employee ID number.';
  if(student&&!/^\d{7}$/.test(id))return 'Student ID must contain exactly 7 digits, for example 1350098.';
  if(!student&&!/^\d{5}$/.test(id))return 'Employee ID must contain exactly 5 digits, for example 14982.';
  if(/^(\d)\1+$/.test(id))return 'Enter the ID number printed on your card.';
  return '';
}

export function birthDateValidationError(value,today){
  const date=String(value||'');
  if(!date)return 'Select your date of birth.';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z')))return 'Select a valid date of birth.';
  if(date>today)return 'Date of birth cannot be in the future.';
  const age=Math.floor((Date.parse(today+'T00:00:00Z')-Date.parse(date+'T00:00:00Z'))/(365.25*24*60*60*1000));
  if(age<10)return 'You must be at least 10 years old to register.';
  if(age>100)return 'Check your date of birth. The year looks incorrect.';
  return '';
}

// Every field-level message keyed by the field it belongs to; an empty object means the details are valid.
export function registrationDetailErrors(details,today){
  const errors={
    first_name:nameValidationError(details.first_name,'First name'),
    last_name:nameValidationError(details.last_name,'Last name'),
    username:usernameValidationError(details.username),
    email:emailValidationError(details.email)||(String(details.email||'').trim()?'':'Enter your email address.'),
    contact_number:contactValidationError(details.contact_number),
    person_type:PERSON_TYPES.includes(details.person_type)?'':'Select whether you are a student or personnel.',
    college:String(details.college||'').trim()?'':'Select your college or department.',
    id_number:schoolIdValidationError(details.id_number,details.person_type),
    birth_date:birthDateValidationError(details.birth_date,today),
    sex:SEX_OPTIONS.includes(details.sex)?'':'Select your sex.'
  };
  if('password' in details)errors.password=passwordValidationError(details.password,details);
  return Object.fromEntries(Object.entries(errors).filter(([,message])=>message));
}
