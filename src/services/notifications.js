// The service receives its client, HTTP transport and public configuration explicitly.
export function createNotificationService({getClient,request,baseUrl,publishableKey}){
  async function action(payload){
    const {data:{session}}=await getClient().auth.getSession();
    if(!session)throw new Error('Your session has expired. Please log in again.');

    const response=await request(`${baseUrl}/functions/v1/notification-center`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        apikey:publishableKey,
        Authorization:`Bearer ${session.access_token}`
      },
      body:JSON.stringify(payload)
    });

    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw new Error(result.error||'Notification action failed.');
    return result;
  }

  async function load(){
    const result=await action({action:"list"});
    return result.notifications||[];
  }
  return {action,load};
}
