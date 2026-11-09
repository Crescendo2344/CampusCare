// Medicine requests and purchase orders.
// Doctors ask the clinic's stock for medicine; staff release it (stock goes down) or decline it.
// Staff order stock before it runs out; an administrator approves; staff record the delivery (stock goes up).
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate} from './inputValidation.js';
import {getPatientById,getUserById} from './documentScanner.js';
import {closeAllModals,openModal} from './modals.js';
import {showConfirmDialog,toast} from './theme.js';
import {campusDateFieldHtml} from './datePicker.js';
import {inventoryAction,inventoryRecords,getInventoryForecast,syncRealInventory} from './inventoryService.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {bindAction} from '../dependencies.js';

const ORDER_WINDOW_DAYS=30;
const st=()=>appState.stockOrders;
const role=()=>appState.auth.currentUser?.role;
const client=()=>appState.supabaseClient.supabaseClient;
const manilaDate=ts=>ts?new Date(ts).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}):'';
const personName=dbUserId=>{const u=dbUserId?getUserById(100000+Number(dbUserId)):null;return u?`${u.role==='Doctor'?'Dr. ':''}${u.fname} ${u.lname}`:'Clinic team';};
const patientName=dbPatientId=>{const p=dbPatientId?getPatientById(200000+Number(dbPatientId)):null;return p?`${p.fname} ${p.lname}`:'';};
const REQUEST_BADGE={Pending:'badge-warning',Released:'badge-success',Declined:'badge-danger',Withdrawn:'badge-gray'};
const PO_BADGE={Submitted:'badge-warning',Approved:'badge-info',Rejected:'badge-danger',Received:'badge-success'};
const badge=(map,status)=>`<span class="badge ${map[status]||'badge-gray'}">${escapeHtml(status)}</span>`;

// Loading ------------------------------------------------------------------------------------------
export async function loadStockOrders(){
  const s=st();
  const r=role();
  if(!appState.auth.currentUser?._realSupabase){s.requests??=[];s.orders??=[];s.items??=[];return s;}
  const jobs=[
    r==='Administrator'?Promise.resolve({data:[]}):client().from('inventory_requests')
      .select('request_id,item_id,quantity,requested_by,patient_id,purpose,status,decided_by,decided_at,decline_reason,created_at')
      .order('created_at',{ascending:false}).limit(300),
    r==='Doctor'?Promise.resolve({data:[]}):client().from('purchase_orders')
      .select('po_id,po_no,status,supplier,notes,needed_by,created_by,decided_by,decided_at,reject_reason,received_by,received_at,created_at,purchase_order_items(po_item_id,item_id,quantity,unit_cost)')
      .order('created_at',{ascending:false}).limit(200),
    client().from('inventory_items').select('item_id,item_name,category,quantity,threshold,unit,expiry_date,supplier,unit_cost').eq('archived',false).order('item_name')
  ];
  const [req,po,items]=await Promise.all(jobs);
  for(const res of [req,po,items])if(res.error)throw res.error;
  s.requests=req.data||[];s.orders=po.data||[];s.items=items.data||[];
  return s;
}
const itemById=id=>(st().items||[]).find(i=>Number(i.item_id)===Number(id));
const itemLabel=id=>{const i=itemById(id);return i?i.item_name:`Item #${id}`;};

// Items with a submitted or approved order are "on order", so staff are not reminded twice.
export function itemsOnOrder(){
  const ids=new Set();
  for(const po of st().orders||[])if(['Submitted','Approved'].includes(po.status))for(const l of po.purchase_order_items||[])ids.add(Number(l.item_id));
  return ids;
}
export function pendingRequestCount(){return (st().requests||[]).filter(r=>r.status==='Pending').length;}

// Doctor: Medicine Requests page -------------------------------------------------------------------
export async function renderMedicineRequests(){
  const c=document.getElementById('app-content');if(!c)return;
  const token=captureCampusPageToken();
  showDatabaseSkeleton('table');
  try{await loadStockOrders();}
  catch(e){if(!isCampusPageCurrent('medicine-requests',token))return;c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Medicine requests could not be loaded.')}</div><button class="btn btn-sm" ${bindAction('click',()=>renderMedicineRequests())}>Retry</button>`;return;}
  if(!isCampusPageCurrent('medicine-requests',token))return;
  const me=appState.auth.currentUser;
  const mine=(st().requests||[]).filter(r=>Number(r.requested_by)===Number(me.dbUserId??(me.id-100000)));
  const patients=(appState.data.DB.patients||[]).filter(p=>p.dbPatientId&&!p.archivedAt).sort((a,b)=>`${a.lname} ${a.fname}`.localeCompare(`${b.lname} ${b.fname}`));
  const items=(st().items||[]).filter(i=>i.category!=='Equipment');
  c.innerHTML=`<div class="card mr-form-card">
      <div class="card-header"><h3>Request medicine</h3></div>
      <div id="mr-msg"></div>
      <div class="form-row">
        <div class="form-group full"><label for="mr-item">Medicine or supply <span class="required">*</span></label>
          <select id="mr-item"><option value="">Choose an item</option>${items.map(i=>`<option value="${i.item_id}" ${Number(i.quantity)<=0?'disabled':''}>${escapeHtml(i.item_name)} · ${Number(i.quantity)} ${escapeHtml(i.unit||'')} on hand</option>`).join('')}</select></div>
        <div class="form-group"><label for="mr-qty">Quantity <span class="required">*</span></label><input id="mr-qty" type="number" inputmode="numeric" min="1" step="1" value="1"></div>
        <div class="form-group"><label for="mr-for">For</label>
          <select id="mr-for"><option value="">Clinic room use</option>${patients.map(p=>`<option value="${p.dbPatientId}">${escapeHtml(`${p.lname}, ${p.fname}`)}</option>`).join('')}</select></div>
        <div class="form-group full"><label for="mr-purpose">What it is for <span class="required">*</span></label><input id="mr-purpose" maxlength="500" placeholder="e.g. Fever after tooth extraction, 3 days"></div>
      </div>
      <div class="form-actions"><button class="btn btn-primary" id="mr-send" ${bindAction('click',()=>sendMedicineRequest())}>Send request to staff</button></div>
    </div>
    <div class="card"><div class="card-header"><h3>My requests</h3></div>
      ${mine.length?`<div class="table-wrap"><table class="treat-table"><thead><tr><th scope="col">Requested</th><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">For</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${mine.map(r=>`<tr>
        <td data-label="Requested">${fmtDate(manilaDate(r.created_at))}</td>
        <td data-label="Item"><strong>${escapeHtml(itemLabel(r.item_id))}</strong>${r.purpose?`<div class="text-muted">${escapeHtml(r.purpose)}</div>`:''}</td>
        <td data-label="Quantity">${r.quantity} ${escapeHtml(itemById(r.item_id)?.unit||'')}</td>
        <td data-label="For">${escapeHtml(patientName(r.patient_id)||'Clinic room')}</td>
        <td data-label="Status">${badge(REQUEST_BADGE,r.status)}${r.status==='Declined'&&r.decline_reason?`<div class="text-muted">${escapeHtml(r.decline_reason)}</div>`:''}${r.decided_at&&r.status!=='Pending'?`<div class="text-muted">${fmtDate(manilaDate(r.decided_at))}</div>`:''}</td>
        <td data-label="Actions">${r.status==='Pending'?`<button class="btn btn-xs" ${bindAction('click',()=>withdrawRequest(r.request_id))}>Withdraw</button>`:''}</td>
      </tr>`).join('')}</tbody></table></div>`:'<div class="empty-state"><i class="bi bi-capsule" aria-hidden="true" style="font-size:1.6rem"></i><p>No medicine requests yet.</p></div>'}
    </div>`;
}

async function sendMedicineRequest(){
  const msg=document.getElementById('mr-msg'),btn=document.getElementById('mr-send');
  const itemId=Number(document.getElementById('mr-item').value||0),qty=Number(document.getElementById('mr-qty').value);
  const purpose=document.getElementById('mr-purpose').value.trim(),patientId=Number(document.getElementById('mr-for').value||0)||null;
  const fail=t=>{msg.innerHTML=`<div class="alert alert-danger show">${escapeHtml(t)}</div>`;};
  msg.innerHTML='';
  if(!itemId)return fail('Choose a medicine or supply.');
  if(!Number.isInteger(qty)||qty<1)return fail('Quantity must be at least 1.');
  const item=itemById(itemId);
  if(item&&qty>Number(item.quantity))return fail(`Only ${item.quantity} ${item.unit||''} on hand.`);
  if(purpose.length<3)return fail('Say what the medicine is for.');
  btn.disabled=true;btn.textContent='Sending…';
  try{
    await inventoryAction({action:'request_medicine',item_id:itemId,quantity:qty,patient_id:patientId,purpose});
    toast('Request sent. Staff will release it at the clinic.','success');
    await renderMedicineRequests();
  }catch(e){fail(e?.message||'The request could not be sent.');btn.disabled=false;btn.textContent='Send request to staff';}
}
async function withdrawRequest(id){
  try{await inventoryAction({action:'withdraw_request',request_id:id});toast('Request withdrawn.','success');await renderMedicineRequests();}
  catch(e){toast(e?.message||'The request could not be withdrawn.','error');}
}

// Reason dialog shared by decline and reject ---------------------------------------------------------
function askReason({title,label,confirm,danger=true,onSubmit}){
  openModal(`<div class="modal" role="dialog" aria-labelledby="so-reason-title">
    <div class="modal-header"><h3 id="so-reason-title">${escapeHtml(title)}</h3><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body"><div id="so-reason-msg"></div><div class="form-group"><label for="so-reason">${escapeHtml(label)} <span class="required">*</span></label><textarea id="so-reason" rows="3" maxlength="500"></textarea></div></div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Back</button><button class="btn ${danger?'btn-danger':'btn-primary'}" id="so-reason-go" ${bindAction('click',async()=>{
      const reason=document.getElementById('so-reason').value.trim(),go=document.getElementById('so-reason-go');
      if(reason.length<3){document.getElementById('so-reason-msg').innerHTML='<div class="alert alert-danger show">Give a short reason.</div>';return;}
      go.disabled=true;
      try{await onSubmit(reason);closeAllModals();}
      catch(e){document.getElementById('so-reason-msg').innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'That could not be saved.')}</div>`;go.disabled=false;}
    })}>${escapeHtml(confirm)}</button></div>
  </div>`);
}

// Staff: Requests tab inside Inventory -------------------------------------------------------------
export function requestsPanelHtml(){return '<div class="card"><div class="card-header"><h3>Medicine requests</h3><select id="so-req-filter" aria-label="Request status"><option value="Pending">Waiting for release</option><option value="">All requests</option></select></div><div id="so-requests"><p class="text-muted">Loading…</p></div></div>';}
export function renderRequestsTable(){
  const el=document.getElementById('so-requests');if(!el)return;
  const sel=document.getElementById('so-req-filter');if(sel&&!sel.dataset.bound){sel.dataset.bound='1';sel.addEventListener('change',renderRequestsTable);}
  const filter=sel?.value??'Pending';
  const rows=(st().requests||[]).filter(r=>!filter||r.status===filter)
    .sort((a,b)=>(a.status==='Pending'?0:1)-(b.status==='Pending'?0:1)||String(b.created_at).localeCompare(String(a.created_at)));
  if(!rows.length){el.innerHTML=`<div class="empty-state"><p>${filter?'No requests are waiting.':'No medicine requests yet.'}</p></div>`;return;}
  el.innerHTML=`<div class="table-wrap"><table class="treat-table"><thead><tr><th scope="col">Requested</th><th scope="col">Doctor</th><th scope="col">Item</th><th scope="col">Quantity</th><th scope="col">For</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
  <tbody>${rows.map(r=>{const it=itemById(r.item_id);const short=it&&Number(it.quantity)<Number(r.quantity);return `<tr>
    <td data-label="Requested">${fmtDate(manilaDate(r.created_at))}</td>
    <td data-label="Doctor">${escapeHtml(personName(r.requested_by))}</td>
    <td data-label="Item"><strong>${escapeHtml(itemLabel(r.item_id))}</strong>${r.purpose?`<div class="text-muted">${escapeHtml(r.purpose)}</div>`:''}</td>
    <td data-label="Quantity">${r.quantity} ${escapeHtml(it?.unit||'')}${r.status==='Pending'&&it?`<div class="text-muted ${short?'text-danger':''}">${it.quantity} on hand</div>`:''}</td>
    <td data-label="For">${escapeHtml(patientName(r.patient_id)||'Clinic room')}</td>
    <td data-label="Status">${badge(REQUEST_BADGE,r.status)}${r.status==='Declined'&&r.decline_reason?`<div class="text-muted">${escapeHtml(r.decline_reason)}</div>`:''}</td>
    <td data-label="Actions"><div class="td-actions">${r.status==='Pending'?`<button class="btn btn-xs btn-success" ${short?'disabled title="Not enough stock on hand"':''} ${bindAction('click',()=>releaseRequest(r.request_id))}>Release</button><button class="btn btn-xs" ${bindAction('click',()=>declineRequest(r.request_id))}>Decline</button>`:''}</div></td>
  </tr>`;}).join('')}</tbody></table></div>`;
}
async function releaseRequest(id){
  try{
    await inventoryAction({action:'release_request',request_id:id});
    toast('Released. The stock was deducted and the doctor was told.','success');
    await refreshInventoryAfterOrderChange();
  }catch(e){toast(e?.message||'The request could not be released.','error');}
}
function declineRequest(id){
  askReason({title:'Decline medicine request',label:'Reason the doctor will read',confirm:'Decline request',onSubmit:async reason=>{
    await inventoryAction({action:'decline_request',request_id:id,reason});
    toast('Request declined. The doctor was told why.','success');
    await refreshInventoryAfterOrderChange();
  }});
}

// Staff: Purchase orders tab inside Inventory -------------------------------------------------------
export function ordersPanelHtml(){return `<div class="card"><div class="card-header"><h3>Purchase orders</h3><button class="btn btn-primary btn-sm" ${bindAction('click',()=>openPurchaseOrderModal())}>+ New purchase order</button></div><div id="so-reorder"></div><div id="so-orders"><p class="text-muted">Loading…</p></div></div>`;}

// Items to order now: they run out within a month at the recent rate (or are at the reorder level)
// and nothing is on order yet. Ordering a month ahead leaves time for delivery.
export function itemsToOrder(){
  const onOrder=itemsOnOrder();
  return inventoryRecords().filter(i=>!i.archived&&i.category!=='Equipment'&&!onOrder.has(i.dbItemId)).map(i=>{
    const f=getInventoryForecast(i);
    const runsOut=f?.hasData&&Number.isFinite(f.daysRemaining)&&f.daysRemaining<=ORDER_WINDOW_DAYS;
    const atLevel=Number(i.qty)<=Number(i.threshold);
    if(!runsOut&&!atLevel)return null;
    const suggested=Math.max(Number(f?.reorderQty)||0,Number(i.threshold)*2-Number(i.qty),1);
    return {item:i,forecast:f,runsOut,atLevel,suggested:Math.ceil(suggested)};
  }).filter(Boolean).sort((a,b)=>(a.forecast?.daysRemaining??999)-(b.forecast?.daysRemaining??999));
}

export function renderOrdersTable(){
  const box=document.getElementById('so-reorder');
  if(box){
    const due=itemsToOrder();
    box.innerHTML=due.length?`<div class="so-due" role="status"><i class="bi bi-cart-plus" aria-hidden="true"></i><div><strong>${due.length} item${due.length===1?'':'s'} should be ordered now</strong><span>${due.slice(0,4).map(d=>escapeHtml(d.item.name)+(d.runsOut?` (about ${Math.max(0,Math.floor(d.forecast.daysRemaining))} days left)`:' (at reorder level)')).join(', ')}${due.length>4?'…':''}</span></div><button class="btn btn-sm btn-primary" ${bindAction('click',()=>openPurchaseOrderModal(due.map(d=>({item_id:d.item.dbItemId,quantity:d.suggested}))))}>Order these</button></div>`:'';
  }
  const el=document.getElementById('so-orders');if(!el)return;
  const rows=st().orders||[];
  if(!rows.length){el.innerHTML='<div class="empty-state"><p>No purchase orders yet.</p></div>';return;}
  el.innerHTML=ordersTableHtml(rows,{staff:true});
}
function ordersTableHtml(rows,{staff=false,admin=false}={}){
  return `<div class="table-wrap"><table class="treat-table"><thead><tr><th scope="col">Order</th><th scope="col">Items</th><th scope="col">Supplier</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
  <tbody>${rows.map(po=>{
    const lines=po.purchase_order_items||[];
    const total=lines.reduce((s,l)=>s+(Number(l.unit_cost)||0)*Number(l.quantity),0);
    return `<tr>
      <td data-label="Order"><strong>${escapeHtml(po.po_no||`PO #${po.po_id}`)}</strong><div class="text-muted">${fmtDate(manilaDate(po.created_at))} · ${escapeHtml(personName(po.created_by))}</div>${po.needed_by?`<div class="text-muted">Needed by ${fmtDate(po.needed_by)}</div>`:''}</td>
      <td data-label="Items">${lines.map(l=>`<div>${escapeHtml(itemLabel(l.item_id))} × ${l.quantity}${l.unit_cost!=null?` <span class="text-muted">@ ₱${Number(l.unit_cost).toFixed(2)}</span>`:''}</div>`).join('')}${total?`<div class="text-muted">Total ₱${total.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>`:''}${po.notes?`<div class="text-muted">${escapeHtml(po.notes)}</div>`:''}</td>
      <td data-label="Supplier">${escapeHtml(po.supplier||'—')}</td>
      <td data-label="Status">${badge(PO_BADGE,po.status)}${po.status==='Rejected'&&po.reject_reason?`<div class="text-muted">${escapeHtml(po.reject_reason)}</div>`:''}${po.status==='Received'&&po.received_at?`<div class="text-muted">${fmtDate(manilaDate(po.received_at))}</div>`:''}</td>
      <td data-label="Actions"><div class="td-actions">
        ${staff&&po.status==='Approved'?`<button class="btn btn-xs btn-success" ${bindAction('click',()=>receiveOrder(po))}>Record delivery</button>`:''}
        ${admin&&po.status==='Submitted'?`<button class="btn btn-xs btn-success" ${bindAction('click',()=>decideOrder(po,'approve_po'))}>Approve</button><button class="btn btn-xs" ${bindAction('click',()=>decideOrder(po,'reject_po'))}>Reject</button>`:''}
      </div></td>
    </tr>`;}).join('')}</tbody></table></div>`;
}

export function openPurchaseOrderModal(prefill=[]){
  const items=inventoryRecords().filter(i=>!i.archived);
  const s=st();s.draft=prefill.length?prefill.map(l=>({...l})):[{item_id:'',quantity:''}];
  const suppliers=[...new Set(items.map(i=>String(i.supplier||'').trim()).filter(Boolean))].sort();
  const firstSupplier=prefill.length?items.find(i=>i.dbItemId===Number(prefill[0].item_id))?.supplier||'':'';
  openModal(`<div class="modal so-po-modal" role="dialog" aria-labelledby="so-po-title">
    <div class="modal-header"><h3 id="so-po-title">New purchase order</h3><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body"><div id="so-po-msg"></div>
      <div class="form-row">
        <div class="form-group"><label for="so-po-supplier">Supplier</label><input id="so-po-supplier" maxlength="255" list="so-po-suppliers" value="${escapeHtml(firstSupplier)}"><datalist id="so-po-suppliers">${suppliers.map(v=>`<option value="${escapeHtml(v)}">`).join('')}</datalist></div>
        <div class="form-group"><label for="so-po-needed">Needed by</label>${campusDateFieldHtml('so-po-needed','','Needed by',appState.clinicInformation.TODAY)}</div>
      </div>
      <div id="so-po-lines"></div>
      <button type="button" class="btn btn-sm" ${bindAction('click',()=>{st().draft.push({item_id:'',quantity:''});renderDraftLines();})}>+ Add another item</button>
      <div class="form-group"><label for="so-po-notes">Notes</label><textarea id="so-po-notes" rows="2" maxlength="800"></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Cancel</button><button class="btn btn-primary" id="so-po-send" ${bindAction('click',()=>submitPurchaseOrder())}>Send for approval</button></div>
  </div>`);
  renderDraftLines();
}
function renderDraftLines(){
  const el=document.getElementById('so-po-lines');if(!el)return;
  const items=inventoryRecords().filter(i=>!i.archived);
  el.innerHTML=st().draft.map((l,idx)=>`<div class="so-po-line">
    <select aria-label="Item ${idx+1}" data-line="${idx}" data-field="item_id"><option value="">Choose an item</option>${items.map(i=>`<option value="${i.dbItemId}" ${Number(l.item_id)===i.dbItemId?'selected':''}>${escapeHtml(i.name)} · ${i.qty} ${escapeHtml(i.unit)} left</option>`).join('')}</select>
    <input type="number" min="1" step="1" inputmode="numeric" aria-label="Quantity ${idx+1}" placeholder="Qty" data-line="${idx}" data-field="quantity" value="${escapeHtml(String(l.quantity??''))}">
    <input type="number" min="0" step="0.01" inputmode="decimal" aria-label="Unit cost ${idx+1}" placeholder="₱ unit cost" data-line="${idx}" data-field="unit_cost" value="${escapeHtml(String(l.unit_cost??(items.find(i=>i.dbItemId===Number(l.item_id))?.unitCost||'')))}">
    <button type="button" class="btn btn-xs" aria-label="Remove item ${idx+1}" ${st().draft.length===1?'disabled':''} ${bindAction('click',()=>{st().draft.splice(idx,1);renderDraftLines();})}>✕</button>
  </div>`).join('');
  el.querySelectorAll('[data-line]').forEach(input=>input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{st().draft[Number(input.dataset.line)][input.dataset.field]=input.value;}));
}
async function submitPurchaseOrder(){
  const msg=document.getElementById('so-po-msg'),btn=document.getElementById('so-po-send');
  const lines=st().draft.map(l=>({item_id:Number(l.item_id),quantity:Number(l.quantity),unit_cost:l.unit_cost===''||l.unit_cost==null?(inventoryRecords().find(i=>i.dbItemId===Number(l.item_id))?.unitCost||null):Number(l.unit_cost)})).filter(l=>l.item_id||l.quantity);
  const fail=t=>{msg.innerHTML=`<div class="alert alert-danger show">${escapeHtml(t)}</div>`;};
  if(!lines.length)return fail('Add at least one item.');
  if(lines.some(l=>!l.item_id||!Number.isInteger(l.quantity)||l.quantity<1))return fail('Each line needs an item and a quantity of at least 1.');
  if(new Set(lines.map(l=>l.item_id)).size!==lines.length)return fail('Each item can appear once per order.');
  btn.disabled=true;btn.textContent='Sending…';
  try{
    const res=await inventoryAction({action:'create_po',items:lines,supplier:document.getElementById('so-po-supplier').value.trim(),needed_by:document.getElementById('so-po-needed').value||null,notes:document.getElementById('so-po-notes').value.trim()});
    closeAllModals();
    toast(`${res.purchase_order?.po_no||'Purchase order'} sent to the administrator for approval.`,'success');
    await refreshInventoryAfterOrderChange();
  }catch(e){fail(e?.message||'The order could not be sent.');btn.disabled=false;btn.textContent='Send for approval';}
}
function receiveOrder(po){
  showConfirmDialog({title:`Record delivery of ${escapeHtml(po.po_no)}?`,message:'Each item on the order is added to stock as received today.',confirmLabel:'Record delivery',onConfirm:async()=>{
    try{
      await inventoryAction({action:'receive_po',po_id:po.po_id});
      toast(`${po.po_no} received. Stock was updated.`,'success');
      await refreshInventoryAfterOrderChange();
    }catch(e){toast(e?.message||'The delivery could not be recorded.','error');}
  }});
}
async function refreshInventoryAfterOrderChange(){
  await Promise.all([loadStockOrders(),syncRealInventory(false)]);
  if(appState.navigationRaceProtection.campusActivePageId==='inventory'){
    const {renderInventory}=await import('./inventory.js');await renderInventory();
  }
}

// Administrator: Purchase Orders page --------------------------------------------------------------
export async function renderPurchaseOrderApprovals(){
  const c=document.getElementById('app-content');if(!c)return;
  const token=captureCampusPageToken();
  showDatabaseSkeleton('table');
  try{await loadStockOrders();}
  catch(e){if(!isCampusPageCurrent('purchase-orders',token))return;c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Purchase orders could not be loaded.')}</div><button class="btn btn-sm" ${bindAction('click',()=>renderPurchaseOrderApprovals())}>Retry</button>`;return;}
  if(!isCampusPageCurrent('purchase-orders',token))return;
  const waiting=(st().orders||[]).filter(p=>p.status==='Submitted'),rest=(st().orders||[]).filter(p=>p.status!=='Submitted');
  c.innerHTML=`<div class="card"><div class="card-header"><h3>Waiting for approval</h3><span class="badge ${waiting.length?'badge-warning':'badge-gray'}">${waiting.length}</span></div>
      ${waiting.length?ordersTableHtml(waiting,{admin:true}):'<div class="empty-state"><i class="bi bi-cart-check" aria-hidden="true" style="font-size:1.6rem"></i><p>No purchase orders are waiting.</p></div>'}</div>
    <div class="card"><div class="card-header"><h3>Order history</h3></div>${rest.length?ordersTableHtml(rest):'<div class="empty-state"><p>No decided orders yet.</p></div>'}</div>`;
}
async function decideOrder(po,action){
  if(action==='reject_po'){
    askReason({title:`Reject ${po.po_no}`,label:'Reason staff will read',confirm:'Reject order',onSubmit:async reason=>{
      await inventoryAction({action,po_id:po.po_id,reason});toast(`${po.po_no} rejected.`,'success');await renderPurchaseOrderApprovals();
    }});
    return;
  }
  try{await inventoryAction({action,po_id:po.po_id});toast(`${po.po_no} approved. Staff were told.`,'success');await renderPurchaseOrderApprovals();}
  catch(e){toast(e?.message||'The order could not be approved.','error');}
}

export function initializeFeature(){}
