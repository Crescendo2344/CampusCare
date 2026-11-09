import {csvColumn,csvDate,csvMoney,templateCsv} from '../shared/csv.js';
// Stock and expiry status for clinic supplies, following common medical-stock practice:
// out of stock vs. at/below the reorder level, and expiry flagged ahead of time (first-expiry, first-out).
const DAY=864e5;
export const EXPIRY_WARNING_DAYS=90;

export function stockState(item){
  const qty=Number(item.qty??item.quantity??0),level=Number(item.threshold??0);
  if(qty<=0)return 'out';
  if(qty<=level)return 'low';
  if(qty<=level*1.5)return 'medium';
  return 'ok';
}

export function expiryState(item,today){
  if(!item.expiryDate)return {state:'',days:null};
  const days=Math.round((Date.parse(item.expiryDate+'T12:00:00Z')-Date.parse(today+'T12:00:00Z'))/DAY);
  if(days<0)return {state:'expired',days};
  if(days<=EXPIRY_WARNING_DAYS)return {state:'soon',days};
  return {state:'ok',days};
}

export function inventorySummary(items,today){
  const active=items.filter(i=>!i.archived);
  const count=fn=>active.filter(fn).length;
  return {
    items:active.length,
    out:count(i=>stockState(i)==='out'),
    low:count(i=>stockState(i)==='low'),
    expired:count(i=>expiryState(i,today).state==='expired'),
    expiringSoon:count(i=>expiryState(i,today).state==='soon'),
    value:active.reduce((sum,i)=>sum+Math.max(0,Number(i.qty)||0)*Math.max(0,Number(i.unitCost)||0),0)
  };
}

export function inventoryCsv(items,today){
  return templateCsv([
    csvColumn('','Item No.',i=>i.displayId??i.id),
    csvColumn('Item','Name',i=>i.name),
    csvColumn('Item','Category',i=>i.category),
    csvColumn('Item','Supplier',i=>i.supplier||''),
    csvColumn('Stock','On Hand',i=>i.qty),
    csvColumn('Stock','Unit',i=>i.unit),
    csvColumn('Stock','Reorder Level',i=>i.threshold),
    csvColumn('Stock','Status',i=>({out:'Out of stock',low:'Low',medium:'Medium',ok:'OK'}[stockState(i)])),
    csvColumn('Cost','Unit Cost (PHP)',i=>csvMoney(i.unitCost||0)),
    csvColumn('Cost','Stock Value (PHP)',i=>csvMoney(Number(i.qty||0)*Number(i.unitCost||0))),
    csvColumn('Expiry','Date',i=>csvDate(i.expiryDate)),
    csvColumn('Expiry','Status',i=>{const exp=expiryState(i,today);return {expired:'Expired',soon:`Expires in ${exp.days} days`,ok:'OK','':''}[exp.state];})
  ],items);
}
