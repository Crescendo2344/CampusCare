// Inventory record selection and backend-to-UI mapping have no browser dependencies.
export function inventoryRecords(db,account){
  if(account?._realSupabase)return (db.inventory||[]).filter(i=>i._realSupabase);
  return db.inventory||[];
}

export function inventoryTransactionRecords(db,account){
  if(account?._realSupabase)return (db.inventoryTransactions||[]).filter(t=>t._realSupabase);
  return (db.disbursements||[]).map(d=>({
    id:d.id,itemId:d.itemId,type:'Disbursement',qty:d.qty,date:d.date,
    dateTime:d.date,notes:d.notes||'',userId:d.userId,_realSupabase:false
  }));
}

export function inventoryForecastRecords(db,account){
  return account?._realSupabase?(db.inventoryForecasts||[]):[];
}

export function inventoryDisplayId(i){
  const id=Number(i?.dbItemId??i?.id??0);
  return String(id).padStart(6,'0');
}

export function realInventoryToUi(i){
  return {
    id:900000+Number(i.item_id),
    dbItemId:Number(i.item_id),
    name:i.item_name||'',
    category:i.category||'Supplies',
    qty:Number(i.quantity||0),
    threshold:Number(i.threshold||0),
    unit:i.unit||'pcs',
    expiryDate:i.expiry_date||'',
    supplier:i.supplier||'',
    unitCost:Number(i.unit_cost||0),
    disbursementDate:i.target_disbursement_date||'',
    photo:i.photo_data||'',
    archived:Boolean(i.archived),
    archivedAt:i.archived_at||'',
    archivedBy:i.archived_by?100000+Number(i.archived_by):null,
    createdAt:i.created_at||'',
    updatedAt:i.updated_at||'',
    _realSupabase:true
  };
}

export function realInventoryTransactionToUi(t){
  return {
    id:910000+Number(t.transaction_id),
    dbTransactionId:Number(t.transaction_id),
    itemId:900000+Number(t.item_id),
    dbItemId:Number(t.item_id),
    type:t.transaction_type||'Adjustment',
    qty:Number(t.quantity||0),
    date:String(t.transaction_date||'').slice(0,10),
    dateTime:t.transaction_date||'',
    notes:t.notes||'',
    userId:t.created_by?100000+Number(t.created_by):null,
    dbCreatedBy:t.created_by?Number(t.created_by):null,
    _realSupabase:true
  };
}

export function realInventoryForecastToUi(f){
  return {
    id:920000+Number(f.forecast_id),
    dbForecastId:Number(f.forecast_id),
    itemId:900000+Number(f.item_id),
    dbItemId:Number(f.item_id),
    forecastMonth:f.forecast_month||'',
    predictedUsage:Number(f.predicted_usage||0),
    predictedRemainingStock:f.predicted_remaining_stock==null?null:Number(f.predicted_remaining_stock),
    predictedStockoutDate:f.predicted_stockout_date||'',
    recommendedReorderQty:Number(f.recommended_reorder_qty||0),
    generatedAt:f.generated_at||'',
    _realSupabase:true
  };
}

// Assemble refreshed records without changing demo rows or the input snapshot.
export function mergeInventorySnapshot(db,{items,transactions,forecasts}){
  const inventory=[...(db.inventory||[]).filter(i=>!i._realSupabase),...items.map(realInventoryToUi)];

  const inventoryTransactions=transactions.map(realInventoryTransactionToUi);

  // Preserve the older UI abstraction for features that still expect
  // db.disbursements, but feed it only real Disbursement transactions.
  const disbursements=[...(db.disbursements||[]).filter(d=>!d._realSupabase),...inventoryTransactions
    .filter(t=>t.type==='Disbursement')
    .map(t=>({...t,_realSupabase:true}))];

  const inventoryForecasts=forecasts.map(realInventoryForecastToUi);
  return {inventory,inventoryTransactions,disbursements,inventoryForecasts};
}

