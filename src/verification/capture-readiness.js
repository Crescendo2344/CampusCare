// Smooth noisy camera checks without letting an old good frame remain usable indefinitely.
export function createCaptureReadiness({settleMs=250,graceMs=2200,messageMs=650}={}){
  let firstGood=null,lastGood=null,pending='',pendingSince=0,shown=null;
  return {
    update(result,now){
      if(result.ready){
        firstGood??=now;
        if(now-firstGood>=settleMs)lastGood=now;
        pending='';shown=result;
      }else{
        if(lastGood===null||now-lastGood>graceMs)firstGood=null;
        if(pending!==result.code){pending=result.code;pendingSince=now;}
        if(!shown||now-pendingSince>=messageMs)shown=result;
      }
      const ready=lastGood!==null&&now-lastGood<=graceMs;
      return {ready,feedback:ready?{code:'ready',message:'Ready to capture — keep your face and ID visible'}:shown,
        progress:ready?1:result.ready?Math.min(1,(now-firstGood)/settleMs):0};
    },
    canCapture(now){return lastGood!==null&&now-lastGood<=graceMs;}
  };
}
