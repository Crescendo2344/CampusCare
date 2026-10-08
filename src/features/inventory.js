// inventory: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {getInventoryForecast,inventoryDisplayId,inventoryForecastBadge,inventoryRecords,inventoryTransactionRecords,predictiveInventorySummaryHtml,syncRealInventory} from './inventoryService.js';
import {escapeHtml} from './issueReports.js';
import {getLowStock,getUserById} from './documentScanner.js';
import {archiveInv,openDisbursementModal,openInvModal,openUpdateQtyModal,restoreInv} from './inventoryForms.js';
import {showFilePreview} from './modals.js';
import {fmtDate} from './inputValidation.js';
import {bindAction} from '../dependencies.js';
// ================================================================
// INVENTORY
// ================================================================
export async function renderInventory(){
  const c=document.getElementById('app-content');
  if(!c)return;
  const pageToken=captureCampusPageToken();

  if(appState.auth.currentUser?._realSupabase){
    showDatabaseSkeleton('table');
    try{await syncRealInventory(true);}
    catch(e){
      if(!isCampusPageCurrent('inventory',pageToken))return;
      console.error('Inventory sync:',e);
      c.innerHTML=`<div class="alert alert-danger show">${escapeHtml(e?.message||'Unable to load inventory.')}</div>
        <button class="btn btn-sm" ${bindAction('click',(event,element)=>{renderInventory()})}>Retry</button>`;
      return;
    }
    if(!isCampusPageCurrent('inventory',pageToken))return;
  }

  const lowStock=getLowStock();
  const canEdit=appState.auth.currentUser.role==='Staff'||appState.auth.currentUser.role==='Administrator';

  c.innerHTML=`
    ${lowStock.length?`<div class="alert alert-danger show">⚠️ <strong>${lowStock.length} item(s)</strong> are at or below their stock threshold and need attention.</div>`:''}
    ${predictiveInventorySummaryHtml()}
    <div class="card">
      <div class="card-header">
        <h3>Inventory Management</h3>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          ${canEdit?`<button class="btn btn-success btn-sm" ${bindAction('click',(event,element)=>{openDisbursementModal()})}>📦 Disburse Items</button>
          <button class="btn btn-primary btn-sm" ${bindAction('click',(event,element)=>{openInvModal()})}>+ Add Item</button>`:''}
        </div>
      </div>
      <div class="toolbar" style="margin-bottom:.75rem">
        <input type="text" placeholder="Search inventory..." id="inv-search" ${bindAction('input',(event,element)=>{renderInvTable()})}>
        <select id="inv-cat" ${bindAction('change',(event,element)=>{renderInvTable()})}>
          <option value="">All Categories</option>
          <option>Medicine</option><option>Dental</option><option>Supplies</option><option>Equipment</option><option>Laboratory</option>
        </select>
        <select id="inv-stock" ${bindAction('change',(event,element)=>{renderInvTable()})}>
          <option value="">All Stock Levels</option>
          <option value="low">Low Stock</option>
          <option value="ok">Sufficient</option>
        </select>
        <select id="inv-status" ${bindAction('change',(event,element)=>{renderInvTable()})}>
          <option value="active">Active Items</option>
          ${appState.auth.currentUser.role==='Administrator'?'<option value="archived">Archived Items</option><option value="all">All Items</option>':''}
        </select>
      </div>
      <div id="inv-table"></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Inventory Transaction History</h3></div>
      <div id="disb-table"></div>
    </div>`;

  renderInvTable();
  renderDisbTable();
}

export function itemAvatarHtml(item,size=36){
  if(item.photo){
    return `<img src="${item.photo}" style="width:${size}px;height:${size}px;border-radius:9px;object-fit:cover;cursor:pointer;flex-shrink:0" ${bindAction('click',(event,element)=>{event.stopPropagation();showFilePreview((String(item.name)),(String(item.photo)))})} title="Click to view full size">`;
  }
  return `<div style="width:${size}px;height:${size}px;border-radius:9px;background:var(--overlay);border:1px solid var(--glass-border-soft);display:flex;align-items:center;justify-content:center;flex-shrink:0"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:${Math.round(size*0.5)}px;height:${Math.round(size*0.5)}px;color:var(--ink-muted)"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg></div>`;
}

export function renderInvTable(){
  const q=((document.getElementById('inv-search')||{}).value||'').toLowerCase();
  const cat=(document.getElementById('inv-cat')||{}).value||'';
  const stock=(document.getElementById('inv-stock')||{}).value||'';
  const status=(document.getElementById('inv-status')||{}).value||'active';

  let items=inventoryRecords().filter(i=>{
    const mQ=!q||`${i.name} ${i.supplier||''}`.toLowerCase().includes(q);
    const mC=!cat||i.category===cat;
    const mS=!stock||(stock==='low'?i.qty<=i.threshold:i.qty>i.threshold);
    const mA=status==='all'||(status==='archived'?i.archived:!i.archived);
    return mQ&&mC&&mS&&mA;
  });

  const el=document.getElementById('inv-table');
  if(!el)return;
  const canEdit=appState.auth.currentUser.role==='Staff'||appState.auth.currentUser.role==='Administrator';

  if(!items.length){
    el.innerHTML='<div class="empty-state"><p>No inventory items found.</p></div>';
    return;
  }

  el.innerHTML=`<div class="table-wrap"><table>
    <thead><tr><th>Photo</th><th>#</th><th>Item</th><th>Category</th><th>Qty</th><th>Threshold</th><th>Unit Cost</th><th>Expiry</th><th>Target Disbursement</th><th>Stock</th><th>Forecast</th><th>Actions</th></tr></thead>
    <tbody>${items.map(i=>{
      const pct=Math.min(100,Math.round(i.qty/Math.max(i.threshold*2,1)*100));
      const lvl=i.qty<=i.threshold?'Low':i.qty<=i.threshold*1.5?'Medium':'Good';
      const bdg=i.qty<=i.threshold?'badge-danger':i.qty<=i.threshold*1.5?'badge-warning':'badge-success';
      const daysToDisb=i.disbursementDate?Math.ceil((new Date(i.disbursementDate+'T12:00:00')-new Date(appState.clinicInformation.TODAY+'T12:00:00'))/86400000):'';
      const disbWarn=daysToDisb!==''&&daysToDisb<=7&&daysToDisb>=0;
      const f=getInventoryForecast(i);

      return `<tr ${i.archived?'style="opacity:.62"':i.qty<=i.threshold?'style="background:var(--warning-bg)"':''}>
        <td>${itemAvatarHtml(i,34)}</td>
        <td>#${inventoryDisplayId(i)}${i.archived?'<br><span class="badge badge-gray">Archived</span>':''}</td>
        <td><strong>${escapeHtml(i.name)}</strong><br><span class="text-muted">${escapeHtml(i.supplier||'')}</span></td>
        <td><span class="badge badge-gray">${escapeHtml(i.category)}</span></td>
        <td><strong>${i.qty}</strong> ${escapeHtml(i.unit)}</td>
        <td>${i.threshold} ${escapeHtml(i.unit)}</td>
        <td>₱${Number(i.unitCost||0).toFixed(2)}</td>
        <td class="${i.expiryDate&&i.expiryDate<=appState.clinicInformation.TODAY?'text-danger':''}">${i.expiryDate?fmtDate(i.expiryDate):'—'}</td>
        <td class="${disbWarn?'text-warning':''}">${i.disbursementDate?`<strong>${fmtDate(i.disbursementDate)}</strong>${disbWarn?` <span class="badge badge-warning">In ${daysToDisb}d</span>`:''}`:'—'}</td>
        <td><span class="badge ${bdg}">${lvl}</span><div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${i.qty<=i.threshold?'var(--danger)':i.qty<=i.threshold*1.5?'var(--warning)':'var(--success)'}"></div></div></td>
        <td>${inventoryForecastBadge(f)}${f.hasData?`<div class="text-muted" style="margin-top:.2rem">${f.daysRemaining}d remaining<br>Reorder ${f.reorderQty} ${escapeHtml(i.unit)}</div>`:`<div class="text-muted" style="margin-top:.2rem">Record disbursements to forecast</div>`}</td>
        <td><div class="td-actions">
          ${canEdit&&!i.archived?`<button class="btn btn-xs btn-info" ${bindAction('click',(event,element)=>{openUpdateQtyModal((i.id))})}>Update Qty</button>
            <button class="btn btn-xs" ${bindAction('click',(event,element)=>{openInvModal((i.id))})}>Edit</button>`:''}
          ${appState.auth.currentUser.role==='Administrator'&&!i.archived?`<button class="btn btn-xs btn-warning" ${bindAction('click',(event,element)=>{archiveInv((i.id))})}>Archive</button>`:''}
          ${appState.auth.currentUser.role==='Administrator'&&i.archived?`<button class="btn btn-xs btn-success" ${bindAction('click',(event,element)=>{restoreInv((i.id))})}>Restore</button>`:''}
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

export function renderDisbTable(){
  const el=document.getElementById('disb-table');
  if(!el)return;

  const rows=inventoryTransactionRecords().slice().sort((a,b)=>String(b.dateTime||b.date).localeCompare(String(a.dateTime||a.date)));
  if(!rows.length){
    el.innerHTML='<div class="empty-state"><p>No inventory transactions recorded.</p></div>';
    return;
  }

  const badge=t=>{
    const cls=t==='Disbursement'?'badge-info':t==='Stock In'?'badge-success':t==='Expired'?'badge-danger':'badge-warning';
    return `<span class="badge ${cls}">${escapeHtml(t)}</span>`;
  };

  el.innerHTML=`<div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Item</th><th>Type</th><th>Quantity</th><th>Recorded By</th><th>Notes</th></tr></thead>
    <tbody>${rows.map(d=>{
      const it=inventoryRecords().find(i=>i.id===d.itemId);
      const u=getUserById(d.userId);
      return `<tr>
        <td>${fmtDate(d.date)}</td>
        <td>${it?escapeHtml(it.name):'Unknown item'}</td>
        <td>${badge(d.type)}</td>
        <td>${d.qty} ${it?escapeHtml(it.unit):''}</td>
        <td>${u?escapeHtml(u.fname+' '+u.lname):'System / Staff'}</td>
        <td>${escapeHtml(d.notes||'—')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
