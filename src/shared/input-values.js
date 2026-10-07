// Value sanitization is separate from DOM updates and cursor handling.
// Keep existing character and length policies during the architecture migration.
export function sanitizeValue(value,type){
  let v=value;
  switch(type){
    case 'name':
      v=v.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ\s'.-]/g,'').replace(/\s{2,}/g,' ').slice(0,50);
      break;
    case 'username':
      v=v.replace(/[^A-Za-z0-9_.-]/g,'').slice(0,20);
      break;
    case 'email':
      v=v.replace(/\s/g,'').toLowerCase().replace(/[^a-z0-9@._+-]/g,'').slice(0,150);
      break;
    case 'phone':
      v=v.replace(/\D/g,'').slice(0,11);
      break;
    case 'password':
      v=v.replace(/\s/g,'').slice(0,64);
      break;
    case 'idno':
      v=v.replace(/[^A-Za-z0-9-]/g,'').slice(0,20);
      break;
    case 'identifier':
      v=v.replace(/\s/g,'').replace(/[^A-Za-z0-9@._-]/g,'').slice(0,60);
      break;
    case 'code':
      v=v.replace(/\D/g,'').slice(0,6);
      break;
    case 'text':
      v=v.replace(/[<>]/g,'').slice(0,200);
      break;
  }
  return v;
}
