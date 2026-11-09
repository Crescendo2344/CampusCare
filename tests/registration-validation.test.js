// Registration field rules are shared by inline browser errors and the registration endpoint.
import test from 'node:test';
import assert from 'node:assert/strict';
import {nameValidationError,usernameValidationError,passwordValidationError,confirmPasswordValidationError,schoolIdValidationError,birthDateValidationError,registrationDetailErrors} from '../supabase/functions/_shared/registration-validation.js';
import {authRedirect,campusCareAppUrl} from '../supabase/functions/_shared/app-url.js';
test('names accept common Filipino and international forms and reject symbols, digits and padding',()=>{
  for(const name of ['Ma. Clara','O\'Neil','Dela Cruz-Reyes','José','Jr.','Ana Mae'])assert.equal(nameValidationError(name,'First name'),'',name);
  for(const name of ['','a','J0hn','Anne--Marie','Anne  Marie','.Anne','<script>','Aaaaaron','x'.repeat(51)])assert(nameValidationError(name,'First name'),name);
});
test('usernames are 4–20 safe characters that start and end with a letter or number',()=>{
  for(const username of ['fixture.student','good_user1','ab-cd'])assert.equal(usernameValidationError(username),'',username);
  for(const username of ['','abc','_abc','abc.','abc..d','12345','with space','a'.repeat(21)])assert(usernameValidationError(username),username);
});
test('passwords need mixed case and a number and must not reuse the username or email',()=>{
  assert.equal(passwordValidationError('Clinic-only-Pass1!',{username:'fixture.student',email:'fixture@example.test'}),'');
  assert.match(passwordValidationError('Fixture-only-password1!',{email:'fixture@example.test'}),/username or email/);
  for(const password of ['','short1A','alllowercase1','ALLUPPERCASE1','NoNumbersHere','Has Space1'])assert(passwordValidationError(password),password);
  assert.equal(confirmPasswordValidationError('Abcdefg1','Abcdefg1'),'');
  assert.equal(confirmPasswordValidationError('Abcdefg1','Abcdefg2'),'Passwords do not match.');
  assert.equal(confirmPasswordValidationError('Abcdefg1',''),'Re-enter your password.');
});
test('ID numbers and birth dates follow the person type and a realistic age range',()=>{
  assert.equal(schoolIdValidationError('1350098','Student'),'');
  assert.equal(schoolIdValidationError('14982','Teaching Personnel'),'');
  for(const [id,type] of [['135009','Student'],['14982','Student'],['1350098','Teaching Personnel'],['1111111','Student'],['','Student']])assert(schoolIdValidationError(id,type),id);
  assert.equal(birthDateValidationError('2004-05-06','2026-10-23'),'');
  for(const date of ['','2030-01-01','2020-01-01','1900-01-01','not-a-date'])assert(birthDateValidationError(date,'2026-10-23'),date);
});
test('registration details report each invalid field by name',()=>{
  const valid={first_name:'Ana',last_name:'Reyes',username:'ana.reyes',email:'ana@gmail.com',contact_number:'09171234567',person_type:'Student',college:'COE',id_number:'1350098',birth_date:'2004-05-06',sex:'Female'};
  assert.deepEqual(registrationDetailErrors(valid,'2026-10-23'),{});
  assert.deepEqual(Object.keys(registrationDetailErrors({...valid,first_name:'4na',sex:'Other',contact_number:'123'},'2026-10-23')).sort(),['contact_number','first_name','sex']);
});
test('auth emails return to an HTTPS CampusCare origin',()=>{
  assert.equal(authRedirect('confirmed'),'https://campuscare-brown-two.vercel.app/?auth=confirmed');
  assert.equal(campusCareAppUrl(()=>'https://clinic.example.edu/some/path'),'https://clinic.example.edu/');
  assert.equal(campusCareAppUrl(()=>'http://localhost:3000'),'https://campuscare-brown-two.vercel.app/');
  assert.equal(campusCareAppUrl(()=>'not a url'),'https://campuscare-brown-two.vercel.app/');
});
