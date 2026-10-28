// inventory: imported feature APIs; state belongs to explicit application namespaces.
import {state as appState} from '../app/state.js';
import {captureCampusPageToken,isCampusPageCurrent} from './navigationRaceProtection.js';
import {showDatabaseSkeleton} from './loadingSkeletons.js';
import {getInventoryForecast,itemAvatarHtml,inventoryDisplayId,inventoryForecastBadge,inventoryRecords,inventoryTransactionRecords,mountInventoryForecastAi,predictiveInventorySummaryHtml,syncRealInventory} from './inventoryService.js';
import {escapeHtml} from './issueReports.js';
import {getUserById} from './documentScanner.js';
import * as stockData from '../domain/inventory-status.js';
import {archiveInv,openDisbursementModal,openInvModal,openUpdateQtyModal,restoreInv} from './inventoryForms.js';
import {showFilePreview} from './modals.js';
import {fmtDate} from './inputValidation.js';
import {bindAction} from '../dependencies.js';
import {csvFileName,downloadCsv} from '../shared/csv.js';
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

  const canEdit=appState.auth.currentUser.role==='Staff'||appState.auth.currentUser.role==='Administrator';
  const today=appState.clinicInformation.TODAY;
  const sum=stockData.inventorySummary(inventoryRecords(),today);
  const ui=appState.inventoryList??={};ui.txLimit=20;
  const stat=(label,value,tone='',filter='')=>`<button type="button" class="approval-stat inv-stat ${tone}" ${filter?bindAction('click',()=>{switchInventoryView('items');const el=document.getElementById('inv-stock');if(el){el.value=filter;renderInvTable();}}):'disabled'}><span>${label}</span><strong>${value}</strong></button>`;
  ui.view??='items';
  const views=[['items','Items','bi-box-seam'],['movements','Stock movements','bi-arrow-left-right'],['forecast','Forecast & reorder','bi-graph-up-arrow']];

  c.innerHTML=`
    <div class="approval-summary inv-summary">
      ${stat('Active items',sum.items)}
      ${stat('Out of stock',sum.out,sum.out?'danger':'','out')}
      ${stat('At or below reorder level',sum.low,sum.low?'warn':'','low')}
      ${stat(`Expiring within ${stockData.EXPIRY_WARNING_DAYS} days`,sum.expiringSoon,sum.expiringSoon?'warn':'','soon')}
      ${stat('Expired',sum.expired,sum.expired?'danger':'','expired')}
      ${stat('Stock value',`₱${sum.value.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2})}`)}
    </div>
    <div class="report-tabs inv-tabs" role="tablist" aria-label="Inventory views">${views.map(([id,label,icon])=>`<button type="button" role="tab" id="inv-tab-${id}" data-inv-view="${id}" aria-controls="inv-panel-${id}" aria-selected="${ui.view===id}" tabindex="${ui.view===id?0:-1}" ${bindAction('click',()=>switchInventoryView(id))}><i class="bi ${icon}" aria-hidden="true"></i>${label}</button>`).join('')}</div>
    <section id="inv-panel-items" role="tabpanel" aria-labelledby="inv-tab-items" ${ui.view==='items'?'':'hidden'}>
    <div class="card">
      <div class="card-header">
        <h3>Items</h3>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap">
          <button class="btn btn-sm" ${bindAction('click',()=>exportInventoryCsv())}><i class="bi bi-download" aria-hidden="true"></i> Export CSV</button>
          ${canEdit?`<button class="btn btn-success btn-sm" ${bindAction('click',()=>openDisbursementModal())}><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> Disburse Items</button>
          <button class="btn btn-primary btn-sm" ${bindAction('click',()=>openInvModal())}>+ Add Item</button>`:''}
        </div>
      </div>
      <div class="toolbar inv-toolbar" style="margin-bottom:.75rem">
        <input type="search" placeholder="Search item, supplier or item #" aria-label="Search inventory" id="inv-search" ${bindAction('input',()=>renderInvTable())}>
        <select id="inv-cat" aria-label="Category" ${bindAction('change',()=>renderInvTable())}>
          <option value="">All categories</option>
          <option>Medicine</option><option>Dental</option><option>Supplies</option><option>Equipment</option><option>Laboratory</option>
        </select>
        <select id="inv-stock" aria-label="Stock and expiry" ${bindAction('change',()=>renderInvTable())}>
          <option value="">Any stock or expiry</option>
          <option value="out">Out of stock</option>
          <option value="low">At or below reorder level</option>
          <option value="soon">Expiring within ${stockData.EXPIRY_WARNING_DAYS} days</option>
          <option value="expired">Expired</option>
          <option value="ok">Sufficient stock</option>
        </select>
        <select id="inv-sort" aria-label="Sort" ${bindAction('change',()=>renderInvTable())}>
          <option value="attention">Needs attention first</option>
          <option value="name">Name A–Z</option>
          <option value="expiry">Expiry, soonest first</option>
          <option value="qty">Quantity, lowest first</option>
        </select>
        <select id="inv-status" aria-label="Record status" ${bindAction('change',()=>renderInvTable())}>
          <option value="active">Active items</option>
          ${appState.auth.currentUser.role==='Administrator'?'<option value="archived">Archived items</option><option value="all">All items</option>':''}
        </select>
      </div>
      <p class="patient-filter-summary" id="inv-summary-line" role="status" aria-live="polite"></p>
      <div id="inv-table"></div>
    </div>
    </section>
    <section id="inv-panel-movements" role="tabpanel" aria-labelledby="inv-tab-movements" ${ui.view==='movements'?'':'hidden'}>
    <div class="card">
      <div class="card-header"><h3>Stock movements</h3>
        <div class="toolbar" style="margin:0">
          <input type="search" placeholder="Search item or note" aria-label="Search stock movements" id="tx-search" ${bindAction('input',()=>{ui.txLimit=20;renderDisbTable();})}>
          <select id="tx-type" aria-label="Movement type" ${bindAction('change',()=>{ui.txLimit=20;renderDisbTable();})}><option value="">All types</option><option>Stock In</option><option>Disbursement</option><option>Adjustment</option><option>Expired</option></select>
        </div>
      </div>
      <div id="disb-table"></div>
    </div>
    </section>
    <section id="inv-panel-forecast" role="tabpanel" aria-labelledby="inv-tab-forecast" ${ui.view==='forecast'?'':'hidden'}>${predictiveInventorySummaryHtml()}</section>`;

  // Arrow keys move between the tabs, as on Reports & Analytics.
  c.querySelector('.inv-tabs').addEventListener('keydown',event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const tabs=[...c.querySelectorAll('[data-inv-view]')],index=tabs.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
    event.preventDefault();tabs[next].click();tabs[next].focus();
  });
  renderInvTable();
  renderDisbTable();
  mountInventoryForecastAi();
}

export function switchInventoryView(view){
  const ui=appState.inventoryList??={};ui.view=view;
  for(const tab of document.querySelectorAll('[data-inv-view]')){
    const selected=tab.dataset.invView===view;
    tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
    const panel=document.getElementById('inv-panel-'+tab.dataset.invView);if(panel)panel.hidden=!selected;
  }
}

function filteredItems(){
  const value=id=>document.getElementById(id)?.value||'';
  const q=value('inv-search').trim().toLowerCase(),cat=value('inv-cat'),stock=value('inv-stock'),status=value('inv-status')||'active',sort=value('inv-sort')||'attention';
  const today=appState.clinicInformation.TODAY;
  const rank=i=>{const st=stockData.stockState(i),ex=stockData.expiryState(i,today).state;return ex==='expired'||st==='out'?0:st==='low'?1:ex==='soon'?2:st==='medium'?3:4;};
  return inventoryRecords().filter(i=>{
    const st=stockData.stockState(i),ex=stockData.expiryState(i,today).state;
    const mQ=!q||`${i.name} ${i.supplier||''} #${inventoryDisplayId(i)}`.toLowerCase().includes(q);
    const mS=!stock||(stock==='soon'||stock==='expired'?ex===stock:stock==='ok'?st==='ok'||st==='medium':st===stock);
    const mA=status==='all'||(status==='archived'?i.archived:!i.archived);
    return mQ&&(!cat||i.category===cat)&&mS&&mA;
  }).sort((a,b)=>sort==='name'?String(a.name).localeCompare(String(b.name))
    :sort==='expiry'?String(a.expiryDate||'9999').localeCompare(String(b.expiryDate||'9999'))
    :sort==='qty'?Number(a.qty)-Number(b.qty)
    :rank(a)-rank(b)||String(a.name).localeCompare(String(b.name)));
}

export function exportInventoryCsv(){
  const rows=filteredItems().map(i=>({...i,displayId:inventoryDisplayId(i)}));
  downloadCsv(csvFileName('inventory',appState.clinicInformation.TODAY),stockData.inventoryCsv(rows,appState.clinicInformation.TODAY));
}

export {itemAvatarHtml};

export function renderInvTable(){
  const el=document.getElementById('inv-table');
  if(!el)return;
  const items=filteredItems(),today=appState.clinicInformation.TODAY;
  const canEdit=appState.auth.currentUser.role==='Staff'||appState.auth.currentUser.role==='Administrator';
  const line=document.getElementById('inv-summary-line');
  if(line)line.textContent=`${items.length} item${items.length===1?'':'s'}`;
  if(!items.length){
    el.innerHTML='<div class="empty-state"><i class="bi bi-box-seam" aria-hidden="true" style="font-size:1.6rem"></i><p>No inventory items match these filters.</p></div>';
    return;
  }
  const stockBadge={out:['badge-danger','Out of stock'],low:['badge-danger','Reorder'],medium:['badge-warning','Medium'],ok:['badge-success','Sufficient']};
  el.innerHTML=`<div class="table-wrap"><table class="treat-table inv-table">
    <thead><tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Stock</th><th scope="col">Expiry</th><th scope="col">Forecast</th><th scope="col">Unit cost</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${items.map(i=>{
      const st=stockData.stockState(i),exp=stockData.expiryState(i,today);
      const pct=Math.min(100,Math.round(i.qty/Math.max(i.threshold*2,1)*100));
      const daysToDisb=i.disbursementDate?Math.ceil((new Date(i.disbursementDate+'T12:00:00')-new Date(today+'T12:00:00'))/86400000):'';
      const f=getInventoryForecast(i);
      const [cls,label]=stockBadge[st];
      return `<tr class="${i.archived?'archived':''}">
        <td data-label="Item"><div class="pt-identity">${itemAvatarHtml(i,34)}<div><strong>${escapeHtml(i.name)}</strong>${i.archived?' <span class="badge badge-gray">Archived</span>':''}<div class="text-muted">#${inventoryDisplayId(i)}${i.supplier?' · '+escapeHtml(i.supplier):''}</div>${i.disbursementDate?`<div class="text-muted">Disburse by ${fmtDate(i.disbursementDate)}${daysToDisb!==''&&daysToDisb>=0&&daysToDisb<=7?` <span class="tr-due today">in ${daysToDisb}d</span>`:''}</div>`:''}</div></div></td>
        <td data-label="Category"><span class="badge badge-gray">${escapeHtml(i.category)}</span></td>
        <td data-label="Stock"><div class="inv-stock-line"><strong>${i.qty}</strong> ${escapeHtml(i.unit)} <span class="badge ${cls}">${label}</span></div><div class="progress-bar" title="Reorder level ${i.threshold} ${escapeHtml(i.unit)}"><div class="progress-fill" style="width:${pct}%;background:${st==='out'||st==='low'?'var(--danger)':st==='medium'?'var(--warning)':'var(--success)'}"></div></div><div class="text-muted">Reorder at ${i.threshold} ${escapeHtml(i.unit)}</div></td>
        <td data-label="Expiry">${i.expiryDate?`${fmtDate(i.expiryDate)}${exp.state==='expired'?'<span class="tr-due overdue">Expired</span>':exp.state==='soon'?`<span class="tr-due today">${exp.days}d left</span>`:''}`:'<span class="text-muted">—</span>'}</td>
        <td data-label="Forecast">${inventoryForecastBadge(f)}${f.hasData?`<div class="text-muted">${f.daysRemaining}d remaining · reorder ${f.reorderQty} ${escapeHtml(i.unit)}</div>`:'<div class="text-muted">Needs disbursement history</div>'}</td>
        <td data-label="Unit cost">₱${Number(i.unitCost||0).toFixed(2)}</td>
        <td data-label="Actions"><div class="td-actions">
          ${canEdit&&!i.archived?`<button class="btn btn-xs btn-info" ${bindAction('click',()=>openUpdateQtyModal(i.id))}>Adjust stock</button>
            <button class="btn btn-xs" ${bindAction('click',()=>openInvModal(i.id))}>Edit</button>`:''}
          ${appState.auth.currentUser.role==='Administrator'&&!i.archived?`<button class="btn btn-xs btn-warning" ${bindAction('click',()=>archiveInv(i.id))}>Archive</button>`:''}
          ${appState.auth.currentUser.role==='Administrator'&&i.archived?`<button class="btn btn-xs btn-success" ${bindAction('click',()=>restoreInv(i.id))}>Restore</button>`:''}
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

export function renderDisbTable(){
  const el=document.getElementById('disb-table');
  if(!el)return;
  const ui=appState.inventoryList??={};ui.txLimit??=20;
  const q=(document.getElementById('tx-search')?.value||'').trim().toLowerCase(),type=document.getElementById('tx-type')?.value||'';
  const items=inventoryRecords();
  const all=inventoryTransactionRecords()
    .filter(d=>{const it=items.find(i=>i.id===d.itemId);return (!type||d.type===type)&&(!q||`${it?.name||''} ${d.notes||''}`.toLowerCase().includes(q));})
    .sort((a,b)=>String(b.dateTime||b.date).localeCompare(String(a.dateTime||a.date)));
  if(!all.length){
    el.innerHTML='<div class="empty-state"><p>No stock movements match.</p></div>';
    return;
  }
  const rows=all.slice(0,ui.txLimit);
  const badge=t=>{
    const cls=t==='Disbursement'?'badge-info':t==='Stock In'?'badge-success':t==='Expired'?'badge-danger':'badge-warning';
    return `<span class="badge ${cls}">${escapeHtml(t)}</span>`;
  };
  el.innerHTML=`<div class="table-wrap"><table class="treat-table">
    <thead><tr><th scope="col">Date</th><th scope="col">Item</th><th scope="col">Type</th><th scope="col">Quantity</th><th scope="col">Recorded by</th><th scope="col">Notes</th></tr></thead>
    <tbody>${rows.map(d=>{
      const it=items.find(i=>i.id===d.itemId);
      const u=getUserById(d.userId);
      const sign=d.type==='Stock In'?'+':d.type==='Disbursement'||d.type==='Expired'?'−':'';
      return `<tr>
        <td data-label="Date">${fmtDate(d.date)}</td>
        <td data-label="Item">${it?`<div class="item-cell">${itemAvatarHtml(it,28)}<span>${escapeHtml(it.name)}</span></div>`:'Unknown item'}</td>
        <td data-label="Type">${badge(d.type)}</td>
        <td data-label="Quantity"><strong>${sign}${d.qty}</strong> ${it?escapeHtml(it.unit):''}</td>
        <td data-label="Recorded by">${u?escapeHtml(u.fname+' '+u.lname):'System'}</td>
        <td data-label="Notes">${escapeHtml(d.notes||'—')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>${all.length>rows.length?`<div class="pt-pager"><span>Showing ${rows.length} of ${all.length}</span><div><button class="btn btn-xs" ${bindAction('click',()=>{ui.txLimit+=20;renderDisbTable();})}>Show more</button></div></div>`:''}`;
}

// Run side effects only after every feature's function exports are available.
export function initializeFeature(){

}
