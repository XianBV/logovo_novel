import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { handleAccountLinkAction, linkCodeHash, linkSessionHash } from './account-links.js';
import { accountPasswordMatches } from './account-auth.js';
import { handleDirectMutation, handleDirectQuery } from './server.js';

const token = crypto.randomUUID();
const user = { user_id: 12, telegram_id: '1234567', username: 'Reader', role: 'reader', email: null };
function fixture(changes={}) {
  const requests=[], sent=[];
  const session={ created_at:new Date().toISOString(), expires_at:new Date(Date.now()+3600000).toISOString(),users:{...user} };
  const options={env:{ACCOUNT_LINKING_ENABLED:'true'}, accountEmailConfig:{configured:true,provider:'resend',siteUrl:new URL('https://site.example/'),codeSecret:'synthetic-code-secret-of-at-least-32-characters'},
    publicSessionUser: u=>({user_id:u.user_id,email:u.email,role:u.role}),
    sendAccountEmail: async mail=>sent.push(mail),
    dbRequest: async (table,query,request={})=>{
      requests.push({table,query,body:request.body,method:request.method});
      if(table==='sessions')return query.token===`eq.${token}`?[session]:[];
      if(table==='rpc/auth_take_login_attempt')return true;
      if(table==='rpc/auth_begin_email_link')return {success:true};
      if(table==='rpc/auth_finish_email_link')return {success:true,user:{...user,email:'new@example.test'}};
      if(table==='account_email_links')return [];
      throw new Error('Unexpected database request');
    },...changes};
  return {requests,sent,session,options};
}
const data={session_token:token,email:'NEW@example.test',password:'NewPassword8!',user_id:999};
test('привязка выключена до миграции и не делает запросов к базе',async()=>{
  const h=fixture({env:{}}); const r=await handleAccountLinkAction('beginEmailLink',data,h.options);
  assert.equal(r.code,'LINKING_NOT_CONFIGURED');assert.equal(h.requests.length,0);
});
test('привязка требует существующий недавний сеанс',async()=>{
  for(const change of ['missing','expired','old','banned']){
    const h=fixture(); if(change==='expired')h.session.expires_at=new Date(0).toISOString();
    if(change==='old')h.session.created_at=new Date(Date.now()-1000000).toISOString();
    if(change==='banned')h.session.users.is_banned=true;
    const r=await handleAccountLinkAction('beginEmailLink',{...data,session_token:change==='missing'?'wrong':token},h.options);
    assert.equal(r.code,'REAUTH_REQUIRED');assert.equal(h.sent.length,0);
  }
});
test('почта добавляется к текущему Telegram-аккаунту; клиентский user_id игнорируется',async()=>{
  const h=fixture(); const r=await handleDirectMutation('beginEmailLink',data,h.options);
  assert.equal(r.success,true);assert.equal(h.sent.length,1);assert.match(h.sent[0].code,/^\d{6}$/);
  const issued=h.requests.find(x=>x.table==='rpc/auth_begin_email_link').body;
  assert.equal(issued.p_user_id,12);assert.equal(issued.p_email,'new@example.test');
  assert.equal(issued.p_session_hash,linkSessionHash(token));assert.equal(issued.p_session_token,token);
  assert.equal(issued.p_code_hash,linkCodeHash(r.confirmation_id,h.sent[0].code,h.options.accountEmailConfig.codeSecret));
  assert.notEqual(issued.p_password_hash,data.password);assert.equal(await accountPasswordMatches(data.password,issued.p_password_hash),true);
  for(const secret of [data.password,issued.p_password_hash,h.sent[0].code,issued.p_code_hash])assert.ok(!JSON.stringify(r).includes(secret));
  assert.equal(h.session.users.email,null);
});
test('нельзя заменить почту существующего аккаунта через добавление новой',async()=>{
  const h=fixture();h.session.users.email='old@example.test';
  assert.equal((await handleAccountLinkAction('beginEmailLink',data,h.options)).success,false);
  assert.equal(h.sent.length,0);assert.equal(h.requests.length,1);
});
test('занятый адрес, кулдаун и лимит попыток не отправляют письма',async()=>{
  for(const reason of ['IDENTITY_IN_USE','COOLDOWN','RATE']){
    const h=fixture();const db=h.options.dbRequest;
    h.options.dbRequest=(table,q,o)=>table==='rpc/auth_take_login_attempt'&&reason==='RATE'?false:table==='rpc/auth_begin_email_link'?{code:reason,retry_after:120}:db(table,q,o);
    const r=await handleAccountLinkAction('beginEmailLink',data,h.options);assert.equal(r.success,false);assert.equal(h.sent.length,0);
    if(reason==='COOLDOWN')assert.equal(r.retry_after,120);
  }
});
test('сбой доставки отзывает запрос и не подключает почту',async()=>{
  const h=fixture({sendAccountEmail:async()=>{throw new Error('Synthetic failure');}});
  assert.equal((await handleAccountLinkAction('beginEmailLink',data,h.options)).success,false);
  assert.ok(h.requests.some(x=>x.table==='account_email_links'&&x.method==='PATCH'&&x.body.consumed_at));
  assert.ok(!h.requests.some(x=>x.table==='rpc/auth_finish_email_link'));
});
test('код подтверждения проверяется в контексте текущего сеанса, в ответе нет нового сеанса',async()=>{
  const h=fixture(),id=crypto.randomUUID(); const r=await handleDirectMutation('confirmEmailLink',{session_token:token,confirmation_id:id,code:'123456'},h.options);
  assert.equal(r.success,true);assert.equal(r.user.user_id,12);assert.equal(r.session_token,undefined);
  const body=h.requests.at(-1).body;assert.equal(body.p_session_hash,linkSessionHash(token));assert.equal(body.p_user_id,12);
  assert.equal(body.p_code_hash,linkCodeHash(id,'123456',h.options.accountEmailConfig.codeSecret));
});
test('ошибки базы не раскрывают параметры, коды и хеши',async()=>{
  const h=fixture({dbRequest:async()=>{throw new Error('private-db-values-password-code');}});
  const r=await handleAccountLinkAction('beginEmailLink',data,h.options);
  assert.equal(r.success,false);assert.ok(!JSON.stringify(r).includes('private-db-values'));
});
test('сведения о способах входа не содержат Telegram ID или секретов',async()=>{
  const h=fixture(); const r=await handleDirectMutation('getAccountConnections',{session_token:token},h.options);
  assert.deepEqual(r,{success:true,email:null,email_verified:false,telegram_connected:true,linking_enabled:true});
});
const uiSource=await readFile(new URL('./js/account-links.js',import.meta.url),'utf8');
test('завершение привязки Telegram сохраняет пользователя, не заменяя токен сеанса',async()=>{
  const storage=new Map([['session_token','keep-existing-session']]),requests=[],timers=[],ctx=vm.createContext({
    window:{location:{reload(){}}}, STATE:{currentUser:{user_id:12}},localStorage:{setItem:(k,v)=>storage.set(k,v)},
    apiPostRequest:async(action,data)=>{requests.push({action,data});return {success:true,user:{user_id:12,email:'old@example.test',role:'owner',features:['admin_panel']},message:'Connected'};},
    document:{getElementById(){return null;}},clearCache(){},updateUserDisplay(){},showToast(){},setTimeout:fn=>timers.push(fn)
  });
  vm.runInContext(uiSource,ctx);
  assert.equal(await ctx.completeAccountTelegramLink({code:'synthetic'}),true);
  assert.equal(requests[0].action,'linkTelegram');assert.equal(storage.get('session_token'),'keep-existing-session');
  assert.equal(JSON.parse(storage.get('currentUser')).user_id,12);assert.equal(timers.length,1);
});
