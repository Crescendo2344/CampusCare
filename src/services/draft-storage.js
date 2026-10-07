// Storage and account lookup are injected; this module never reads window or app globals.
export function createDraftStorage(storage, getAccount){
  function key(kind){
    const account=getAccount();
    return `campuscare-v70-${account?._realSupabase?'real':'demo'}-${account?.dbUserId||account?.id}-${kind}`;
  }
  return {
    key,
    read(kind,fallback){
      try{return JSON.parse(storage.getItem(key(kind))||'null')||fallback;}
      catch(_){return fallback;}
    },
    // Let callers handle quota and disabled-storage failures in their own UI.
    write(kind,value){storage.setItem(key(kind),JSON.stringify(value));}
  };
}
