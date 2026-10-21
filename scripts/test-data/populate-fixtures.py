"""Upload original synthetic fixtures and verify only CC-SAMPLE-5M-v1 accounts.

The private credentials JSON is supplied by the operator and must not be committed.
All requests use the public application key and each test account's own session.
"""
import argparse,base64,json,pathlib,urllib.request,urllib.error,urllib.parse
BASE='https://hgmvlklvobkqhyvjnzmx.supabase.co'
KEY='sb_publishable_4R6yLx9j1l6M3JMlyjRITA_vEsSBGBu'  # Public browser key.
BATCH='CC-SAMPLE-5M-v1'
FIXTURES=pathlib.Path(__file__).parent/'fixtures'

def request(path,method='GET',data=None,token=None,content_type='application/json'):
    # urllib uses the host's standard HTTPS proxy and keeps secrets out of argv/logs.
    headers={'apikey':KEY,'Content-Type':content_type}
    if token:headers['Authorization']='Bearer '+token
    if data is not None and not isinstance(data,bytes):data=json.dumps(data).encode()
    req=urllib.request.Request(BASE+path,data=data,headers=headers,method=method)
    try:
        with urllib.request.urlopen(req,timeout=25) as response:
            body=response.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as error:
        try:message=json.load(error).get('message') or str(error.code)
        except Exception:message=str(error.code)
        raise RuntimeError(f'{method} {path.split("?")[0]}: {message}') from None

def login(username,password):
    if not username.startswith('ccsample.'):raise ValueError('Synthetic accounts only.')
    return request('/auth/v1/token?grant_type=password','POST',{'email':username+'@example.test','password':password})

def logout(session):
    # Revoke this verification session without affecting other tester sessions.
    request('/auth/v1/logout?scope=local','POST',{},session['access_token'])

def verify(password):
    rows=[]
    for username in ['ccsample.p01','ccsample.p02','ccsample.medical','ccsample.dental','ccsample.staff']:
        session=login(username,password)
        try:
            profile=request('/rest/v1/users?auth_user_id=eq.'+session['user']['id']+'&select=user_id,username,role,status',token=session['access_token'])
            if len(profile)!=1 or profile[0]['username']!=username:raise RuntimeError('Auth/profile mismatch')
            rows.append(profile[0])
        finally:logout(session)
    return rows

def review(password):
    rows=[]
    for username in ['ccsample.p29','ccsample.p30']:
        session=login(username,password)
        try:
            objects={}
            for kind in ['selfie','id-front','id-back']:
                filename=f'{BATCH}-{kind}.png';path=session['user']['id']+'/'+filename
                request('/storage/v1/object/campuscare-verification/'+path,'POST',(FIXTURES/filename).read_bytes(),session['access_token'],'image/png')
                objects[kind]=path
            rows.append({'username':username,'authId':session['user']['id'],'objects':objects})
        finally:logout(session)
    return rows

def attachments(password,recipient_id):
    session=login('ccsample.staff',password);rows=[]
    try:
        recipient=request(f'/rest/v1/users?user_id=eq.{recipient_id}&select=username,email',token=session['access_token'])
        if len(recipient)!=1 or recipient[0]['username']!='ccsample.p01' or recipient[0]['email'].strip():raise RuntimeError('Prepare sample-only email suppression first.')
        # All recipients and files are fictional. Nothing is sent to a real person.
        for kind,mime,filename in [('file','text/plain',BATCH+'-file.txt'),('image','image/png',BATCH+'-photo.png'),('audio','audio/wav',BATCH+'-audio.wav'),('link',None,None)]:
            payload={'action':'send','to_user_id':recipient_id,'body':BATCH+' — '+('Sample link: https://example.com/' if kind=='link' else kind+' attachment fixture')}
            if filename:payload.update(attachment_name=filename,attachment_type=kind,attachment_data_url='data:'+mime+';base64,'+base64.b64encode((FIXTURES/filename).read_bytes()).decode())
            result=request('/functions/v1/message-actions','POST',payload,session['access_token'])
            if not result.get('ok'):raise RuntimeError(kind+' fixture failed')
            rows.append({'kind':kind,'ok':True})
    finally:logout(session)
    return rows

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode',choices=['verify','review','attachments'])
    parser.add_argument('--credentials',required=True,help='Private JSON file containing the temporary password')
    parser.add_argument('--output',required=True,help='Private manifest path; contains no session tokens')
    parser.add_argument('--recipient-id',type=int)
    args=parser.parse_args()
    password=json.loads(pathlib.Path(args.credentials).read_text())['password']
    result=verify(password) if args.mode=='verify' else review(password) if args.mode=='review' else attachments(password,args.recipient_id)
    # Manifests identify only this sample batch; credentials and tokens stay out.
    pathlib.Path(args.output).write_text(json.dumps(result,indent=2))
    pathlib.Path(args.output).chmod(0o600)
    print(f'PASS: {args.mode} — {len(result)} synthetic records verified')
