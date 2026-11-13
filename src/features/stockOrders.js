// Purchase orders.
// Staff order stock before it runs out: they print the purchase order for the person or office that buys,
// mark it sent, and record the delivery (stock goes up). Purchasing is a staff task; there is no approval step.
import {printCtuDocument} from '../shared/ctu-letterhead.js';
import {state as appState} from '../app/state.js';
import {escapeHtml} from './issueReports.js';
import {fmtDate} from './inputValidation.js';
import {getUserById} from './documentScanner.js';
import {closeAllModals,openModal} from './modals.js';
import {showConfirmDialog,toast} from './theme.js';
import {campusDateFieldHtml} from './datePicker.js';
import {inventoryAction,inventoryDisplayId,inventoryRecords,getInventoryForecast,syncRealInventory} from './inventoryService.js';
import {bindAction} from '../dependencies.js';

const ORDER_WINDOW_DAYS=30;
const st=()=>appState.stockOrders;
const role=()=>appState.auth.currentUser?.role;
const client=()=>appState.supabaseClient.supabaseClient;
const manilaDate=ts=>ts?new Date(ts).toLocaleDateString('en-CA',{timeZone:'Asia/Manila'}):'';
const personName=dbUserId=>{const u=dbUserId?getUserById(100000+Number(dbUserId)):null;return u?`${u.role==='Doctor'?'Dr. ':''}${u.fname} ${u.lname}`:'Clinic team';};
const PO_BADGE={Prepared:'badge-warning',Sent:'badge-info',Received:'badge-success',Cancelled:'badge-gray'};
const PO_LABEL={Prepared:'Prepared',Sent:'Sent to purchasing',Received:'Received',Cancelled:'Cancelled'};

// Loading ------------------------------------------------------------------------------------------
export async function loadStockOrders(){
  const s=st();
  const r=role();
  if(!appState.auth.currentUser?._realSupabase){s.orders??=[];s.items??=[];return s;}
  const jobs=[
    r!=='Staff'?Promise.resolve({data:[]}):client().from('purchase_orders')
      .select('po_id,po_no,status,notes,needed_by,created_by,sent_by,sent_at,cancel_reason,cancelled_at,received_by,received_at,created_at,receive_note,purchase_order_items(po_item_id,item_id,quantity,received_quantity)')
      .order('created_at',{ascending:false}).limit(200),
    client().from('inventory_items').select('item_id,item_name,category,quantity,threshold,unit,expiry_date').eq('archived',false).order('item_name')
  ];
  const [po,items]=await Promise.all(jobs);
  for(const res of [po,items])if(res.error)throw res.error;
  s.orders=po.data||[];s.items=items.data||[];
  return s;
}
const itemById=id=>(st().items||[]).find(i=>Number(i.item_id)===Number(id));
const itemLabel=id=>{const i=itemById(id);return i?i.item_name:`Item #${id}`;};

// Items with a prepared or sent order are "on order", so staff are not reminded twice.
export function itemsOnOrder(){
  const ids=new Set();
  for(const po of st().orders||[])if(['Prepared','Sent'].includes(po.status))for(const l of po.purchase_order_items||[])ids.add(Number(l.item_id));
  return ids;
}
// Reason dialog (used when cancelling an order) --------------------------------------------------
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
    const row=d=>{
      const i=d.item,out=Number(i.qty)<=0,pct=Math.min(100,Math.round(i.qty/Math.max(i.threshold*2,1)*100));
      return `<tr>
        <td data-label="Item"><strong>${escapeHtml(i.name)}</strong><div class="text-muted">#${inventoryDisplayId(i)}</div></td>
        <td data-label="Category"><span class="badge badge-gray">${escapeHtml(i.category)}</span></td>
        <td data-label="Stock"><div class="inv-stock-line"><strong>${i.qty}</strong> ${escapeHtml(i.unit)} <span class="badge ${out||d.atLevel?'badge-danger':'badge-warning'}">${out?'Out of stock':d.atLevel?'Reorder':'Running low'}</span></div><div class="progress-bar" title="Reorder level ${i.threshold} ${escapeHtml(i.unit)}"><div class="progress-fill" style="width:${pct}%;background:${out||d.atLevel?'var(--danger)':'var(--warning)'}"></div></div><div class="text-muted">Reorder at ${i.threshold} ${escapeHtml(i.unit)}</div></td>
        <td data-label="Actions"><div class="td-actions"><button class="btn btn-xs btn-primary" ${bindAction('click',()=>openPurchaseOrderModal([{item_id:i.dbItemId,quantity:d.suggested}]))}>Order now</button></div></td>
      </tr>`;
    };
    box.innerHTML=due.length?`<div class="so-due" role="status"><div class="so-due-head"><i class="bi bi-cart-plus" aria-hidden="true"></i><strong>${due.length} item${due.length===1?'':'s'} should be ordered now</strong></div><div class="table-wrap"><table class="treat-table inv-table"><thead><tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Stock</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody>${due.map(row).join('')}</tbody></table></div></div>`:'';
    const tabCount=document.querySelector('#inv-tab-orders .badge');
    if(tabCount){tabCount.textContent=due.length;tabCount.hidden=!due.length;}
  }
  const el=document.getElementById('so-orders');if(!el)return;
  const rows=st().orders||[];
  if(!rows.length){el.innerHTML='<div class="empty-state"><p>No purchase orders yet.</p></div>';return;}
  el.innerHTML=ordersTableHtml(rows);
}
function ordersTableHtml(rows){
  return `<div class="table-wrap"><table class="treat-table"><thead><tr><th scope="col">Order</th><th scope="col">Items</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
  <tbody>${rows.map(po=>{
    const lines=po.purchase_order_items||[];
    return `<tr>
      <td data-label="Order"><strong>${escapeHtml(po.po_no||`PO #${po.po_id}`)}</strong><div class="text-muted">${fmtDate(manilaDate(po.created_at))} · ${escapeHtml(personName(po.created_by))}</div>${po.needed_by?`<div class="text-muted">Needed by ${fmtDate(po.needed_by)}</div>`:''}</td>
      <td data-label="Items">${lines.map(l=>`<div>${escapeHtml(itemLabel(l.item_id))} × ${l.quantity} ${escapeHtml(itemById(l.item_id)?.unit||'')}</div>`).join('')}${po.notes?`<div class="text-muted">${escapeHtml(po.notes)}</div>`:''}</td>
      <td data-label="Status"><span class="badge ${PO_BADGE[po.status]||'badge-gray'}">${escapeHtml(PO_LABEL[po.status]||po.status)}</span>${po.status==='Sent'&&po.sent_at?`<div class="text-muted">${fmtDate(manilaDate(po.sent_at))}</div>`:''}${po.status==='Cancelled'&&po.cancel_reason?`<div class="text-muted">${escapeHtml(po.cancel_reason)}</div>`:''}${po.status==='Received'?(()=>{const short=(po.purchase_order_items||[]).reduce((n,l)=>n+(l.received_quantity==null?0:Number(l.quantity)-Number(l.received_quantity)),0);return `<div class="text-muted">${po.received_at?fmtDate(manilaDate(po.received_at)):''}${short?` · <span class="text-danger">${short} short</span>`:''}</div>${po.receive_note?`<div class="text-muted">${escapeHtml(po.receive_note)}</div>`:''}`;})():''}</td>
      <td data-label="Actions"><div class="td-actions">
        <button class="btn btn-xs" ${bindAction('click',()=>printPurchaseOrder(po.po_id))}><i class="bi bi-printer" aria-hidden="true"></i> Print</button>
        ${po.status==='Prepared'?`<button class="btn btn-xs btn-info" ${bindAction('click',()=>orderStep(po,'send_po'))}>Mark as sent</button>`:''}
        ${['Prepared','Sent'].includes(po.status)?`<button class="btn btn-xs btn-success" ${bindAction('click',()=>receiveOrder(po))}>Record delivery</button><button class="btn btn-xs" ${bindAction('click',()=>orderStep(po,'cancel_po'))}>Cancel</button>`:''}
      </div></td>
    </tr>`;}).join('')}</tbody></table></div>`;
}

export function openPurchaseOrderModal(prefill=[]){
  const items=inventoryRecords().filter(i=>!i.archived);
  const s=st();s.draft=prefill.length?prefill.map(l=>({...l,name:l.name||inventoryRecords().find(i=>i.dbItemId===Number(l.item_id))?.name||''})):[{name:'',quantity:''}];
  openModal(`<div class="modal so-po-modal" role="dialog" aria-labelledby="so-po-title">
    <div class="modal-header"><h3 id="so-po-title">${prefill.length?'Re-order':'New purchase order'}</h3><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body"><div id="so-po-msg"></div>
      <div class="form-row">
        <div class="form-group"><label for="so-po-needed">Needed by</label>${campusDateFieldHtml('so-po-needed','','Needed by',appState.clinicInformation.TODAY)}</div>
      </div>
      <div id="so-po-lines"></div>
      ${prefill.length?'':`<button type="button" class="btn btn-sm" ${bindAction('click',()=>{st().draft.push({name:'',quantity:''});renderDraftLines();})}>+ Add another item</button>`}
      <div class="form-group"><label for="so-po-notes">Notes</label><textarea id="so-po-notes" rows="2" maxlength="800"></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Cancel</button><button class="btn btn-primary" id="so-po-send" ${bindAction('click',()=>submitPurchaseOrder())}>Prepare order</button></div>
  </div>`);
  renderDraftLines();
}
// Each line: type the medicine or supply. Items already in stock are suggested as you type and
// linked when the name matches; a new name asks for its unit and category and joins the stock list.
const UNITS=['tablet','capsule','bottle','box','pack','piece','vial','ampule','sachet','tube','cartridge','syringe','kit','jar','dose','cup','roll','pair'];
const CATEGORIES=['Medicine','Dental','Supplies','Equipment','Laboratory'];
const stockItems=()=>inventoryRecords().filter(i=>!i.archived);
const findItem=name=>{const key=String(name||'').trim().toLowerCase();return key?stockItems().find(i=>i.name.trim().toLowerCase()===key):null;};
function renderDraftLines(){
  const el=document.getElementById('so-po-lines');if(!el)return;
  const items=stockItems();
  el.innerHTML=`<datalist id="so-po-items">${items.map(i=>`<option value="${escapeHtml(i.name)}">${i.qty} ${escapeHtml(i.unit)} left</option>`).join('')}</datalist>`+st().draft.map((l,idx)=>{
    const match=findItem(l.name),isNew=Boolean(String(l.name||'').trim())&&!match;
    return `<div class="so-po-line-wrap"><div class="so-po-line">
      <input type="text" list="so-po-items" autocomplete="off" maxlength="120" aria-label="Medicine or supply ${idx+1}" placeholder="Type the medicine or supply" data-line="${idx}" data-field="name" value="${escapeHtml(l.name||'')}">
      <input type="number" min="1" step="1" inputmode="numeric" aria-label="Quantity ${idx+1}" placeholder="Qty" data-line="${idx}" data-field="quantity" value="${escapeHtml(String(l.quantity??''))}">
      <button type="button" class="btn btn-xs" aria-label="Remove item ${idx+1}" ${st().draft.length===1?'disabled':''} ${bindAction('click',()=>{st().draft.splice(idx,1);renderDraftLines();})}>✕</button>
    </div>
    <div class="so-po-line-meta" data-meta="${idx}">${match?`<span class="text-muted">In stock: ${match.qty} ${escapeHtml(match.unit)}</span>`
      :isNew?`<span class="badge badge-info">New item</span>
        <select aria-label="Unit for ${escapeHtml(l.name)}" data-line="${idx}" data-field="unit"><option value="">Unit</option>${UNITS.map(u=>`<option ${l.unit===u?'selected':''}>${u}</option>`).join('')}</select>
        <select aria-label="Category for ${escapeHtml(l.name)}" data-line="${idx}" data-field="category">${CATEGORIES.map(c=>`<option ${(l.category||'Medicine')===c?'selected':''}>${c}</option>`).join('')}</select>`:''}</div></div>`;}).join('');
  el.querySelectorAll('[data-line]').forEach(input=>{
    const line=st().draft[Number(input.dataset.line)];
    input.addEventListener(input.tagName==='SELECT'?'change':'input',()=>{line[input.dataset.field]=input.value;});
    // Re-check the name once typing settles, so the stock match or the new-item fields appear.
    if(input.dataset.field==='name')input.addEventListener('change',()=>{line.name=input.value;renderDraftLines();});
  });
}
async function submitPurchaseOrder(){
  const msg=document.getElementById('so-po-msg'),btn=document.getElementById('so-po-send');
  document.querySelectorAll('#so-po-lines [data-line]').forEach(input=>{st().draft[Number(input.dataset.line)][input.dataset.field]=input.value;});
  const fail=t=>{msg.innerHTML=`<div class="alert alert-danger show">${escapeHtml(t)}</div>`;};
  const draft=st().draft.filter(l=>String(l.name||'').trim()||l.quantity);
  if(!draft.length)return fail('Add at least one medicine or supply.');
  const lines=[];
  for(const l of draft){
    const name=String(l.name||'').trim().replace(/\s+/g,' '),quantity=Number(l.quantity);
    if(name.length<2)return fail('Type the name of each medicine or supply.');
    if(!Number.isInteger(quantity)||quantity<1)return fail(`Give a quantity of at least 1 for ${name}.`);
    const item=findItem(name);
    if(item)lines.push({item_id:item.dbItemId,quantity,key:'id:'+item.dbItemId});
    else{
      if(!l.unit)return fail(`Choose the unit for ${name} (for example tablet, box or bottle).`);
      lines.push({new_item:{name,unit:l.unit,category:l.category||'Medicine'},quantity,key:'new:'+name.toLowerCase()});
    }
  }
  if(new Set(lines.map(l=>l.key)).size!==lines.length)return fail('Each medicine can appear once per order.');
  btn.disabled=true;btn.textContent='Sending…';
  try{
    const res=await inventoryAction({action:'create_po',items:lines.map(({key,...l})=>l),needed_by:document.getElementById('so-po-needed').value||null,notes:document.getElementById('so-po-notes').value.trim()});
    closeAllModals();
    const added=res.new_items?.length?` ${res.new_items.length} new item${res.new_items.length===1?' was':'s were'} added to the stock list.`:'';
    toast(`${res.purchase_order?.po_no||'Purchase order'} is ready. Print it for the person who buys.${added}`,'success');
    await refreshInventoryAfterOrderChange();
    if(res.purchase_order?.po_id)printPurchaseOrder(res.purchase_order.po_id);
  }catch(e){fail(e?.message||'The order could not be sent.');btn.disabled=false;btn.textContent='Prepare order';}
}
// What arrived: amounts start at the ordered quantity, so a complete delivery is one click.
// Only the good quantity goes into stock; a shortfall needs a short note for purchasing.
function receiveOrder(po){
  const lines=po.purchase_order_items||[];
  openModal(`<div class="modal" role="dialog" aria-labelledby="so-rc-title">
    <div class="modal-header"><h3 id="so-rc-title">Record delivery · ${escapeHtml(po.po_no)}</h3><button class="close-btn" aria-label="Close" ${bindAction('click',()=>closeAllModals())}>✕</button></div>
    <div class="modal-body"><div id="so-rc-msg"></div>
      <div class="table-wrap"><table class="treat-table so-rc-table"><thead><tr><th scope="col">Item</th><th scope="col">Ordered</th><th scope="col">Received in good condition</th></tr></thead>
      <tbody>${lines.map(l=>{const it=itemById(l.item_id);return `<tr><td data-label="Item">${escapeHtml(itemLabel(l.item_id))}</td><td data-label="Ordered">${l.quantity} ${escapeHtml(it?.unit||'')}</td><td data-label="Received"><input type="number" class="so-rc-qty" data-item="${l.item_id}" data-ordered="${l.quantity}" min="0" max="${l.quantity}" step="1" inputmode="numeric" value="${l.quantity}" aria-label="Received ${escapeHtml(itemLabel(l.item_id))}"></td></tr>`;}).join('')}</tbody></table></div>
      <div class="form-group" id="so-rc-note-wrap" hidden><label for="so-rc-note">What was short or damaged? <span class="required">*</span></label><textarea id="so-rc-note" rows="2" maxlength="500" placeholder="e.g. 10 capsules damaged, returned to sender"></textarea></div>
    </div>
    <div class="modal-footer"><button class="btn" ${bindAction('click',()=>closeAllModals())}>Cancel</button><button class="btn btn-success" id="so-rc-save" ${bindAction('click',()=>saveDelivery(po))}>Save delivery</button></div>
  </div>`);
  const sync=()=>{const short=[...document.querySelectorAll('.so-rc-qty')].some(i=>Number(i.value)<Number(i.dataset.ordered));const w=document.getElementById('so-rc-note-wrap');if(w)w.hidden=!short;};
  document.querySelectorAll('.so-rc-qty').forEach(i=>i.addEventListener('input',sync));
}
async function saveDelivery(po){
  const msg=document.getElementById('so-rc-msg'),btn=document.getElementById('so-rc-save');
  const fail=t=>{msg.innerHTML=`<div class="alert alert-danger show">${escapeHtml(t)}</div>`;};
  const received=[...document.querySelectorAll('.so-rc-qty')].map(i=>({item_id:Number(i.dataset.item),quantity:Number(i.value),ordered:Number(i.dataset.ordered)}));
  if(received.some(r=>!Number.isInteger(r.quantity)||r.quantity<0||r.quantity>r.ordered))return fail('Each amount must be a whole number from 0 up to the amount ordered.');
  const short=received.reduce((n,r)=>n+r.ordered-r.quantity,0);
  const note=(document.getElementById('so-rc-note')?.value||'').trim();
  if(short>0&&note.length<3)return fail('Say what was short or damaged.');
  btn.disabled=true;
  try{
    await inventoryAction({action:'receive_po',po_id:po.po_id,received:received.map(({item_id,quantity})=>({item_id,quantity})),note});
    closeAllModals();
    toast(short?`${po.po_no} received, ${short} short or damaged. Stock was updated.`:`${po.po_no} received. Stock was updated.`,'success');
    await refreshInventoryAfterOrderChange();
  }catch(e){fail(e?.message||'The delivery could not be recorded.');btn.disabled=false;}
}
async function refreshInventoryAfterOrderChange(){
  await Promise.all([loadStockOrders(),syncRealInventory(false)]);
  if(appState.navigationRaceProtection.campusActivePageId==='inventory'){
    const {renderInventory}=await import('./inventory.js');await renderInventory();
  }
}

function orderStep(po,action){
  if(action==='cancel_po'){
    askReason({title:`Cancel ${po.po_no}`,label:'Why is it no longer needed?',confirm:'Cancel order',onSubmit:async reason=>{
      await inventoryAction({action,po_id:po.po_id,reason});toast(`${po.po_no} cancelled.`,'success');await refreshInventoryAfterOrderChange();
    }});
    return;
  }
  showConfirmDialog({title:`Mark ${escapeHtml(po.po_no)} as sent?`,message:'Use this once the printed order has been handed to the person or office that buys.',confirmLabel:'Mark as sent',onConfirm:async()=>{
    try{await inventoryAction({action,po_id:po.po_id});toast(`${po.po_no} marked as sent.`,'success');await refreshInventoryAfterOrderChange();}
    catch(e){toast(e?.message||'The order could not be updated.','error');}
  }});
}

// A one-page purchase order the purchasing office can act on; the browser's print dialog also saves it as PDF.
export function printPurchaseOrder(poId){
  const po=(st().orders||[]).find(p=>Number(p.po_id)===Number(poId));
  if(!po){toast('Purchase order not found. Refresh and try again.','error');return;}
  const lines=po.purchase_order_items||[];
  const rows=lines.map((l,i)=>{const it=itemById(l.item_id);
    return `<tr><td>${i+1}</td><td>${escapeHtml(it?.item_name||itemLabel(l.item_id))}</td><td>${escapeHtml(it?.category||'')}</td><td class="n">${l.quantity}</td><td>${escapeHtml(it?.unit||'')}</td></tr>`;}).join('');
  printCtuDocument({title:po.po_no||'Purchase order',css:`
    body{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:12px;margin:0}
    h1{font-size:20px;margin:0}h2{font-size:13px;margin:0 0 2px;font-weight:normal;color:#444}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0a7ea8;padding-bottom:10px;margin-bottom:14px}
    .meta{width:100%;border-collapse:collapse;margin-bottom:14px}.meta td{padding:3px 0;vertical-align:top}.meta td:first-child{width:120px;color:#555}
    table.items{width:100%;border-collapse:collapse}table.items th,table.items td{border:1px solid #bbb;padding:6px;text-align:left}table.items th{background:#eef5f9}
    .n{text-align:right}.sign{display:flex;gap:40px;margin-top:48px}.sign div{flex:1;border-top:1px solid #333;padding-top:4px;text-align:center}
    .note{margin-top:12px;white-space:pre-wrap}
  `,body:`
    <div class="head"><div><h1>Purchase Order</h1><h2>CTU Main Medical &amp; Dental Clinic</h2></div><div style="text-align:right"><strong style="font-size:15px">${escapeHtml(po.po_no||'')}</strong><div>Date: ${escapeHtml(fmtDate(manilaDate(po.created_at)))}</div></div></div>
    <table class="meta"><tr><td>Needed by</td><td>${po.needed_by?escapeHtml(fmtDate(po.needed_by)):'As soon as possible'}</td></tr>
      <tr><td>Prepared by</td><td>${escapeHtml(personName(po.created_by))}</td></tr></table>
    <table class="items"><thead><tr><th>#</th><th>Item</th><th>Category</th><th class="n">Qty</th><th>Unit</th></tr></thead>
      <tbody>${rows}</tbody></table>
    ${po.notes?`<div class="note"><strong>Notes:</strong> ${escapeHtml(po.notes)}</div>`:''}
    <div class="sign"><div>Prepared by</div><div>Noted by (Clinic head)</div><div>Received by (Purchasing)</div></div>
  `});
}

export function initializeFeature(){}
