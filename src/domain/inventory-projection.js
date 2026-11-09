// Planning projection for a consumable over a chosen horizon (7 days to 1 year).
// Uses the stored monthly forecast where one exists, otherwise the item's recent daily usage rate.
export const FORECAST_PRESETS=[[7,'7 days'],[30,'30 days'],[90,'3 months'],[180,'6 months'],[365,'1 year']];
export const MIN_HORIZON=7,MAX_HORIZON=365,DEFAULT_HORIZON=90;

export function clampHorizon(days){
  const n=Math.round(Number(days));
  return Number.isFinite(n)&&n>0?Math.min(MAX_HORIZON,Math.max(MIN_HORIZON,n)):DEFAULT_HORIZON;
}

const addDays=(iso,n)=>{const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const daysInMonth=iso=>new Date(Date.UTC(Number(iso.slice(0,4)),Number(iso.slice(5,7)),0)).getUTCDate();
const monthLabel=iso=>new Date(iso+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'});
const dayLabel=iso=>new Date(iso+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});

// Up to a month (or weeklyUpTo days): weekly columns. Longer: calendar-month columns (the first and last may be partial).
export function projectionPeriods(start,days,weeklyUpTo=31){
  const end=addDays(start,days-1),periods=[];
  if(days<=weeklyUpTo){
    for(let from=start;from<=end;from=addDays(from,7)){
      const to=addDays(from,6)<end?addDays(from,6):end;
      periods.push({start:from,end:to,label:from===to?dayLabel(from):`${dayLabel(from)} – ${dayLabel(to)}`});
    }
    return periods;
  }
  for(let from=start;from<=end;){
    const monthEnd=from.slice(0,8)+String(daysInMonth(from)).padStart(2,'0');
    const to=monthEnd<end?monthEnd:end;
    const whole=from.endsWith('-01')&&to===monthEnd;
    periods.push({start:from,end:to,label:whole?monthLabel(from):`${dayLabel(from)} – ${dayLabel(to)}`});
    from=addDays(to,1);
  }
  return periods;
}

// monthlyUsage: {'YYYY-MM': units forecast for that whole month}.
export function projectItem({qty=0,threshold=0,start,days,dailyRate=0,monthlyUsage={}}){
  const horizon=clampHorizon(days),stock=Math.max(0,Number(qty)||0),floor=Math.max(0,Number(threshold)||0);
  const rateOn=date=>{const m=monthlyUsage[date.slice(0,7)];return m!=null?Number(m)/daysInMonth(date):Number(dailyRate)||0;};
  let used=0,stockoutDate='',reorderBy=stock<=floor?start:'';
  const periods=projectionPeriods(start,horizon).map(p=>{
    let use=0;
    for(let d=p.start;d<=p.end;d=addDays(d,1)){
      const today=rateOn(d);use+=today;used+=today;
      if(!reorderBy&&stock-used<=floor)reorderBy=d;
      if(!stockoutDate&&used>stock)stockoutDate=d;
    }
    return {...p,use:Math.round(use),stockAfter:Math.round(stock-used)};
  });
  const totalUse=Math.round(used);
  return {
    periods,totalUse,
    averageDaily:used/horizon,
    stockAtEnd:Math.round(stock-used),
    stockoutDate,
    reorderBy,
    reorderQty:Math.max(0,Math.ceil(used+floor-stock)),
    end:addDays(start,horizon-1)
  };
}
