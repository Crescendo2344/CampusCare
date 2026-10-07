// ── Inventory Modals ──
function openInvModal(id=null){
  const it=id?inventoryRecords().find(i=>i.id===Number(id)):null;
  if(it?.archived){
    toast('Restore this inventory item before editing it.','warning');
    return;
  }

  capturedInvPhotoDataUrl=null;
  openModal(`<div class="modal">
    <div class="modal-header"><h3>${it?'Edit':'Add'} Inventory Item</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body">
      <div id="invm-msg"></div>
      <div class="form-group full">
        <label>Item Photo</label>
        <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
          <div id="im-photo-wrap" style="width:60px;height:60px;border-radius:12px;background:var(--overlay);border:1px solid var(--glass-border-soft);display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0">
            ${it&&it.photo?`<img src="${it.photo}" style="width:100%;height:100%;object-fit:cover">`:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:26px;height:26px;color:var(--ink-muted)"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>`}
          </div>
          <button type="button" class="btn btn-sm" onclick="document.getElementById('im-photo-file').click()">Upload Photo</button>
          <button type="button" class="btn btn-sm btn-info" onclick="openCamera('invitem')"><i class="bi bi-camera" aria-hidden="true"></i> Use Camera</button>
          <input type="file" id="im-photo-file" accept="image/*" style="display:none" onchange="previewInvPhoto(this)">
        </div>
      </div>

      <div class="form-row">
        <div class="form-group full"><label>Item Name <span class="required">*</span></label><input id="im-name" maxlength="255" value="${it?escapeHtml(it.name):''}"></div>
        <div class="form-group"><label>Category</label>
          <select id="im-cat">${['Medicine','Dental','Supplies','Equipment','Laboratory'].map(c=>`<option ${it&&it.category===c?'selected':''}>${c}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Supplier</label><input id="im-supplier" maxlength="255" value="${it?escapeHtml(it.supplier||''):''}"></div>
        <div class="form-group"><label>Quantity <span class="required">*</span></label><input id="im-qty" type="number" value="${it?it.qty:''}" min="0" step="1"></div>
        <div class="form-group"><label>Threshold <span class="required">*</span></label><input id="im-thresh" type="number" value="${it?it.threshold:''}" min="0" step="1"></div>
        <div class="form-group"><label>Unit <span class="required">*</span></label><input id="im-unit" maxlength="80" value="${it?escapeHtml(it.unit||'pcs'):'pcs'}"></div>
        <div class="form-group"><label>Unit Cost (₱)</label><input id="im-cost" type="number" value="${it?it.unitCost||'':''}" min="0" step="0.01"></div>
        <div class="form-group"><label>Expiry Date</label>${campusDateFieldHtml('im-expiry',it?it.expiryDate||'':'','Expiry Date')}</div>
        <div class="form-group full"><label>Target Disbursement Date</label>
          ${campusDateFieldHtml('im-disb',it?it.disbursementDate||'':'','Target Disbursement Date')}
          <div class="form-note">Optional planning date for this inventory batch.</div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeAllModals()">Cancel</button>
      <button class="btn btn-primary" id="im-save-btn" onclick="saveInv(${id||'null'})">Save Item</button>
    </div>
  </div>`);
}

let capturedInvPhotoDataUrl=null;

function previewInvPhoto(input){
  const wrap=document.getElementById('im-photo-wrap');
  const file=input.files&&input.files[0];
  if(!wrap||!file)return;
  capturedInvPhotoDataUrl=null;

  const reader=new FileReader();
  reader.onload=e=>{
    wrap.innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;
  };
  reader.readAsDataURL(file);
}

async function saveInv(id){
  const name=document.getElementById('im-name').value.trim();
  const qty=parseInt(document.getElementById('im-qty').value,10);
  const thresh=parseInt(document.getElementById('im-thresh').value,10);
  const unit=document.getElementById('im-unit').value.trim();
  const msg=document.getElementById('invm-msg');
  const btn=document.getElementById('im-save-btn');
  hideAlert(msg);

  if(!name||!unit||Number.isNaN(qty)||Number.isNaN(thresh)){
    showAlert(msg,'Name, quantity, threshold, and unit are required.');
    return;
  }
  if(qty<0||thresh<0){
    showAlert(msg,'Quantity and threshold cannot be negative.');
    return;
  }

  let photo=null;
  const photoFile=document.getElementById('im-photo-file').files[0];

  if(capturedInvPhotoDataUrl){
    photo=capturedInvPhotoDataUrl;
  }else if(photoFile){
    photo=await resizeImageDataUrl(await readFileAsDataURL(photoFile),320,0.82);
  }else if(id){
    photo=inventoryRecords().find(i=>i.id===Number(id))?.photo||null;
  }

  const data={
    name,
    category:document.getElementById('im-cat').value,
    supplier:document.getElementById('im-supplier').value.trim(),
    qty,
    threshold:thresh,
    unit,
    unitCost:parseFloat(document.getElementById('im-cost').value)||0,
    expiryDate:document.getElementById('im-expiry').value,
    disbursementDate:document.getElementById('im-disb').value,
    photo
  };

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Saving…';}

  try{
    if(currentUser?._realSupabase){
      const existing=id?inventoryRecords().find(i=>i.id===Number(id)):null;
      await inventoryAction({
        action:existing?'update':'create',
        item_id:existing?.dbItemId||null,
        item_name:data.name,
        category:data.category,
        supplier:data.supplier,
        quantity:data.qty,
        threshold:data.threshold,
        unit:data.unit,
        unit_cost:data.unitCost,
        expiry_date:data.expiryDate||null,
        target_disbursement_date:data.disbursementDate||null,
        photo_data:data.photo||null
      });
      await syncRealInventory(false);
    }else if(id){
      const idx=DB.inventory.findIndex(i=>i.id===id);
      if(idx>=0){
        DB.inventory[idx]={...DB.inventory[idx],...data};
        auditLog('INVENTORY_ITEM_UPDATED',`Updated inventory item ${data.name}.`,'Inventory',id);
      }
      persistDB();
    }else{
      const newInvId=DB.nextInvId++;
      DB.inventory.push({id:newInvId,...data});
      auditLog('INVENTORY_ITEM_CREATED',`Added inventory item ${data.name}.`,'Inventory',newInvId);
      persistDB();
    }

    closeAllModals();
    toast(id?'Item updated.':'Item added.','success');
    await renderInventory();
  }catch(e){
    showAlert(msg,e?.message||'Unable to save inventory item.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=old||'Save Item';
    }
  }
}

function openUpdateQtyModal(id){
  const it=inventoryRecords().find(i=>i.id===Number(id));if(!it)return;
  if(it.archived){toast('Restore this item before updating quantity.','warning');return;}

  openModal(`<div class="modal modal-sm">
    <div class="modal-header"><h3>Update Quantity – ${escapeHtml(it.name)}</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body">
      <div id="uq-msg"></div>
      <div class="alert alert-info show" style="font-size:.8rem">Current: <strong>${it.qty} ${escapeHtml(it.unit)}</strong> · Threshold: ${it.threshold}</div>
      <div class="form-group"><label>New Quantity <span class="required">*</span></label><input type="number" id="uq-qty" value="${it.qty}" min="0" step="1"></div>
      <div class="form-group"><label>Reason for Update</label><input id="uq-reason" maxlength="500" placeholder="Restocked, physical count correction, damaged stock, etc."></div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeAllModals()">Cancel</button>
      <button class="btn btn-primary" id="uq-btn" onclick="updateQty(${id})">Update</button>
    </div>
  </div>`);
}

async function updateQty(id){
  const newQty=parseInt(document.getElementById('uq-qty').value,10);
  const reason=document.getElementById('uq-reason').value.trim();
  const msg=document.getElementById('uq-msg');
  const btn=document.getElementById('uq-btn');
  hideAlert(msg);

  if(Number.isNaN(newQty)||newQty<0){
    showAlert(msg,'Enter a valid non-negative quantity.');
    return;
  }

  const it=inventoryRecords().find(i=>i.id===Number(id));
  if(!it)return;

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Updating…';}

  try{
    if(it._realSupabase){
      await inventoryAction({
        action:'set_quantity',
        item_id:it.dbItemId,
        quantity:newQty,
        reason
      });
      await syncRealInventory(false);
    }else{
      it.qty=newQty;
      auditLog('INVENTORY_QUANTITY_UPDATED',`Updated ${it.name} to ${newQty} ${it.unit}.`,'Inventory',id);
      persistDB();
    }

    closeAllModals();
    toast(`${it.name} updated to ${newQty} ${it.unit}.`,'success');
    await renderInventory();
  }catch(e){
    showAlert(msg,e?.message||'Unable to update inventory quantity.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=old||'Update';
    }
  }
}

function archiveInv(id){
  const it=inventoryRecords().find(i=>i.id===Number(id));if(!it)return;

  showConfirmDialog({
    title:'Archive Inventory Item',
    message:`Archive <strong>${escapeHtml(it.name)}</strong>? The item and its transaction history will be preserved, but it will no longer appear in the active inventory list.`,
    confirmLabel:'Archive',
    danger:true,
    onConfirm:async()=>{
      try{
        if(it._realSupabase){
          await inventoryAction({action:'archive',item_id:it.dbItemId});
          await syncRealInventory(false);
        }else{
          it.archived=true;
          persistDB();
        }
        toast('Inventory item archived.','success');
        await renderInventory();
      }catch(e){toast(e?.message||'Unable to archive inventory item.','error');}
    }
  });
}

function restoreInv(id){
  const it=inventoryRecords().find(i=>i.id===Number(id));if(!it)return;

  showConfirmDialog({
    title:'Restore Inventory Item',
    message:`Restore <strong>${escapeHtml(it.name)}</strong> to the active inventory list?`,
    confirmLabel:'Restore',
    onConfirm:async()=>{
      try{
        if(it._realSupabase){
          await inventoryAction({action:'restore',item_id:it.dbItemId});
          await syncRealInventory(false);
        }else{
          it.archived=false;
          persistDB();
        }
        toast('Inventory item restored.','success');
        await renderInventory();
      }catch(e){toast(e?.message||'Unable to restore inventory item.','error');}
    }
  });
}

// Keep the old function name from stale buttons/bookmarks but use Archive.
function deleteInv(id){archiveInv(id);}

function openDisbursementModal(){
  const items=inventoryRecords().filter(i=>!i.archived);

  if(!items.length){
    toast('Add an active inventory item before recording a disbursement.','warning');
    return;
  }

  openModal(`<div class="modal">
    <div class="modal-header"><h3>Record Item Disbursement</h3><button class="close-btn" onclick="closeAllModals()">✕</button></div>
    <div class="modal-body">
      <div id="disb-msg"></div>
      <div class="form-group"><label>Item <span class="required">*</span></label>
        <select id="disb-item">${items.map(i=>`<option value="${i.id}">${escapeHtml(i.name)} (${i.qty} ${escapeHtml(i.unit)})</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Quantity to Disburse <span class="required">*</span></label><input type="number" id="disb-qty" min="1" step="1"></div>
      <div class="form-group"><label>Date</label>${campusDateFieldHtml('disb-date',TODAY,'Disbursement Date','',TODAY)}</div>
      <div class="form-group"><label>Notes</label><input id="disb-notes" maxlength="800" placeholder="e.g. Dispensed for clinic use / prescriptions"></div>
    </div>
    <div class="modal-footer">
      <button class="btn" onclick="closeAllModals()">Cancel</button>
      <button class="btn btn-success" id="disb-btn" onclick="saveDisbursement()">Record Disbursement</button>
    </div>
  </div>`);
}

async function saveDisbursement(){
  const itemId=parseInt(document.getElementById('disb-item').value,10);
  const qty=parseInt(document.getElementById('disb-qty').value,10);
  const date=document.getElementById('disb-date').value;
  const notes=document.getElementById('disb-notes').value.trim();
  const msg=document.getElementById('disb-msg');
  const btn=document.getElementById('disb-btn');
  const it=inventoryRecords().find(i=>i.id===itemId);

  hideAlert(msg);
  if(!it){showAlert(msg,'Item not found.');return;}
  if(!qty||qty<1){showAlert(msg,'Quantity must be at least 1.');return;}
  if(qty>it.qty){showAlert(msg,`Only ${it.qty} ${it.unit} available.`);return;}
  if(!date||date>TODAY){showAlert(msg,'Disbursement date cannot be in the future.');return;}

  const old=btn?.textContent;
  if(btn){btn.disabled=true;btn.textContent='Recording…';}

  try{
    if(it._realSupabase){
      await inventoryAction({
        action:'disburse',
        item_id:it.dbItemId,
        quantity:qty,
        transaction_date:date,
        notes
      });
      await syncRealInventory(false);
    }else{
      it.qty-=qty;
      auditLog('INVENTORY_DISBURSEMENT','Recorded inventory disbursement.','Inventory',itemId);
      DB.disbursements.push({id:DB.nextDisbId++,itemId,qty,date,notes,userId:currentUser.id});
      persistDB();
    }

    closeAllModals();
    toast(`Disbursed ${qty} ${it.unit} of ${it.name}.`,'success');
    await renderInventory();
  }catch(e){
    showAlert(msg,e?.message||'Unable to record disbursement.');
  }finally{
    if(btn&&document.body.contains(btn)){
      btn.disabled=false;
      btn.textContent=old||'Record Disbursement';
    }
  }
}
