// Inject transport and the live client; preserve the existing endpoint/session/error contracts.
export function createOperationalService({getClient,request,baseUrl,publishableKey}){
async function backupAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await request(`${baseUrl}/functions/v1/backup-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Backup action failed.');
  return result;
}

async function settingsAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await request(`${baseUrl}/functions/v1/settings-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Settings action failed.');
  return result;
}

async function emailDeliveryAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await request(`${baseUrl}/functions/v1/email-dispatch`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Email delivery action failed.');
  return result;
}

async function auditAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await request(`${baseUrl}/functions/v1/audit-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Audit action failed.');
  return result;
}

async function privacyAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await request(`${baseUrl}/functions/v1/privacy-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Privacy action failed.');
  return result;
}

async function taskBadgeAction(){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired.');
  const response=await request(`${baseUrl}/functions/v1/task-badges`,{
    headers:{
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    }
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Unable to refresh task badges.');
  return result;
}

async function healthResourceAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await request(`${baseUrl}/functions/v1/health-resource-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Health Education action failed.');
  return result;
}

async function workflowAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await request(`${baseUrl}/functions/v1/workflow-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Workflow action failed.');
  return result;
}

async function fitnessAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await request(`${baseUrl}/functions/v1/fitness-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Fitness assessment action failed.');
  return result;
}

async function surveyAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');
  const response=await request(`${baseUrl}/functions/v1/survey-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Survey action failed.');
  return result;
}

async function messageAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your session has expired. Please log in again.');

  const response=await request(`${baseUrl}/functions/v1/message-actions`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });

  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Messaging action failed.');
  return result;
}

async function adminUserAction(payload){
  const {data:{session}}=await getClient().auth.getSession();
  if(!session)throw new Error('Your approval-review session has expired.');
  const response=await request(`${baseUrl}/functions/v1/admin-users`,{
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      apikey:publishableKey,
      Authorization:`Bearer ${session.access_token}`
    },
    body:JSON.stringify(payload)
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.ok)throw new Error(result.error||'Unable to update user.');
  return result;
}
return {backupAction,settingsAction,emailDeliveryAction,auditAction,privacyAction,taskBadgeAction,healthResourceAction,workflowAction,fitnessAction,surveyAction,messageAction,adminUserAction};
}
