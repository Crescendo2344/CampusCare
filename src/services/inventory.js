// The API client, request function and public configuration are supplied by the adapter.
// This module returns raw records and never writes application state or renders a page.
export function createInventoryService({getClient,request,baseUrl,publishableKey,reportForecastError=()=>{}}){
  async function action(payload){
    const {data:{session}}=await getClient().auth.getSession();
    if(!session)throw new Error('Your session has expired. Please log in again.');

    const response=await request(`${baseUrl}/functions/v1/inventory-actions`,{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        apikey:publishableKey,
        Authorization:`Bearer ${session.access_token}`
      },
      body:JSON.stringify(payload)
    });

    const result=await response.json().catch(()=>({}));
    if(!response.ok||!result.ok)throw new Error(result.error||'Inventory action failed.');
    return result;
  }

  async function load(generateForecasts=false){
    if(generateForecasts){
      try{
        await action({action:'generate_forecasts'});
      }catch(err){
        // Forecast generation should never prevent the inventory itself from loading.
        reportForecastError(err);
      }
    }

    const client=getClient();
    const [itemsRes,txRes,forecastRes]=await Promise.all([
      client.from('inventory_items')
        .select('item_id,item_name,category,quantity,threshold,unit,expiry_date,supplier,unit_cost,photo_data,target_disbursement_date,archived,archived_at,archived_by,created_at,updated_at')
        .order('item_name',{ascending:true}),
      client.from('inventory_transactions')
        .select('transaction_id,item_id,transaction_type,quantity,transaction_date,notes,created_by')
        .order('transaction_date',{ascending:false}),
      client.from('inventory_forecasts')
        .select('forecast_id,item_id,forecast_month,predicted_usage,predicted_remaining_stock,predicted_stockout_date,recommended_reorder_qty,generated_at')
        .order('forecast_month',{ascending:true})
    ]);

    if(itemsRes.error)throw itemsRes.error;
    if(txRes.error)throw txRes.error;
    if(forecastRes.error)throw forecastRes.error;

    return {items:itemsRes.data||[],transactions:txRes.data||[],forecasts:forecastRes.data||[]};
  }
  return {action,load};
}
