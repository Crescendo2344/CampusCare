// displayNames: how people are named across CampusCare screens.
export function docName(user){
  if(!user)return '';
  return (user.role==='Doctor'?'Dr. ':'')+user.fname+' '+user.lname;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
