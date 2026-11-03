"""Portable Git/static packaging fallback. Credentials are read without echo."""
import getpass
import json
import os
from pathlib import Path
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parent
os.chdir(ROOT)
print('Ready for Sites credential JSON (input hidden).',flush=True)
credential=json.loads(getpass.getpass(''))
token=credential.get('token','')
remote=credential['remote_url']
branch=credential['branch']
env=os.environ.copy()
env['GIT_TERMINAL_PROMPT']='0'
for k in list(env):
    if k.startswith('GIT_TRACE') or k=='GIT_CURL_VERBOSE': del env[k]
auth=[]
if credential.get('auth_mode')=='http_extra_header':
    env['SITES_GIT_AUTHORIZATION']='Authorization: Bearer '+token
    auth=['-c','credential.helper=','-c','http.extraHeader=','-c','http.followRedirects=false',f'--config-env=http.{remote}.extraHeader=SITES_GIT_AUTHORIZATION']

def git(args,network=False,check=True):
    p=subprocess.run(['git']+(auth if network else [])+args,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace')
    if check and p.returncode:
        message=p.stderr.replace(token,'[redacted]') if token else p.stderr
        raise RuntimeError(message)
    return p

if not (ROOT/'.git').exists():git(['init','--initial-branch',branch,'.'])
assert Path(git(['rev-parse','--show-toplevel']).stdout.strip()).resolve()==ROOT
assert git(['ls-remote','--get-url',remote]).stdout.strip()==remote
assert not git(['config','--get-regexp',r'^url\..*\.pushinsteadof$'],check=False).stdout.strip(), 'Resolve Git URL rewrites before publishing.'
ref='refs/heads/'+branch
advertised=git(['ls-remote','--heads',remote,ref],network=True).stdout.strip()
if advertised:
    git(['fetch','--no-tags',remote,ref],network=True)
    assert git(['merge-base','--is-ancestor','FETCH_HEAD','HEAD'],check=False).returncode==0, 'Remote history exists; reconcile before publishing.'
git(['add','--all','--','.'])
if git(['diff','--cached','--quiet'],check=False).returncode:
    git(['-c','user.name=Sites','-c','user.email=sites@users.noreply.openai.com','commit','-m','Publish FUP production portal'])
head=git(['rev-parse','HEAD']).stdout.strip()
assert not git(['status','--porcelain']).stdout.strip()
git(['push',remote,head+':'+ref],network=True)
assert git(['ls-remote','--heads',remote,ref],network=True).stdout.split()[0]==head
archive=ROOT.parent/'fup-publish.tar.gz'
with tarfile.open(archive,'w:gz') as tar:
    tar.add(ROOT/'.openai/hosting.json',arcname='.openai/hosting.json')
    for file in sorted((ROOT/'dist').rglob('*')):
        if file.is_file():tar.add(file,arcname=file.relative_to(ROOT).as_posix())
assert not git(['status','--porcelain']).stdout.strip()
print(json.dumps({'project_id':json.loads((ROOT/'.openai/hosting.json').read_text())['project_id'],'commit_sha':head,'archive':str(archive)}),flush=True)
