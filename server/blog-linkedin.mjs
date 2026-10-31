import { randomBytes, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { HttpError, readJson } from './http.mjs';

const jwks=createRemoteJWKSet(new URL('https://www.linkedin.com/oauth/openid/jwks'));
export function createLinkedIn({db,origin,now,author,save,upload}) {
  const clientId=process.env.LINKEDIN_CLIENT_ID,secret=process.env.LINKEDIN_CLIENT_SECRET;
  const available=Boolean(clientId&&secret),redirectUri=`${origin}/api/public/blogs/linkedin/callback`;
  const secure=origin.startsWith('https:'),correlationCookie=secure?'__Host-pixelware_linkedin':'pixelware_linkedin_dev';
  const correlation=(value,seconds)=>`${correlationCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure?'; Secure':''}`;
  async function adminRoute(req,res,url,current,send) {
    if(url.pathname!=='/api/admin/blogs/author/linkedin'||req.method!=='POST')return false;
    await readJson(req);if(!available)throw new HttpError(503,'LinkedIn connection is not configured on this server. You can still set your author name, photo, and LinkedIn link below.');
    const state=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex'),verifier=randomBytes(48).toString('base64url');
    db.prepare('DELETE FROM blog_oauth_states WHERE expires_at<=? OR session_hash=?').run(now(),current.token_hash);
    db.prepare('INSERT INTO blog_oauth_states VALUES (?,?,?,?,?)').run(state,current.token_hash,nonce,verifier,now()+10*60000);
    // The admin session remains SameSite=Strict. This short-lived, HttpOnly
    // correlation cookie alone accompanies LinkedIn's cross-site redirect.
    res.setHeader('Set-Cookie',correlation(verifier,600));
    const target=new URL('https://www.linkedin.com/oauth/v2/authorization');
    target.search=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirectUri,scope:'openid profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    send(res,200,{url:target.href});return true;
  }
  async function callback(req,res,url) {
    if(url.pathname!=='/api/public/blogs/linkedin/callback')return false;
    if(req.method!=='GET')throw new HttpError(405,'Method not allowed.');
    const state=url.searchParams.get('state')??'';
    const pending=/^[a-f0-9]{64}$/.test(state)&&db.prepare('SELECT * FROM blog_oauth_states WHERE state=? AND expires_at>?').get(state,now());
    const proof=(req.headers.cookie??'').split(';').map(item=>item.trim()).find(item=>item.startsWith(`${correlationCookie}=`))?.slice(correlationCookie.length+1);
    const activeSession=()=>pending&&db.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?').get(pending.session_hash,now());
    if(!available||!pending||proof!==pending.verifier||!activeSession())throw new HttpError(403,'This LinkedIn connection expired. Start again from the author settings.');
    db.prepare('DELETE FROM blog_oauth_states WHERE state=?').run(state);
    res.setHeader('Set-Cookie',correlation('',0));
    if(url.searchParams.has('error')){res.writeHead(303,{Location:'/admin?section=blogs&linkedin=cancelled'});res.end();return true;}
    const code=url.searchParams.get('code');if(!code||code.length>4096)throw new HttpError(400,'LinkedIn did not return an authorization code.');
    try {
      const response=await fetch('https://www.linkedin.com/oauth/v2/accessToken',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:redirectUri,client_id:clientId,client_secret:secret,code_verifier:pending.verifier}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Token exchange failed');const tokens=await response.json();
      const {payload}=await jwtVerify(tokens.id_token,jwks,{issuer:'https://www.linkedin.com',audience:clientId,algorithms:['RS256']});
      if(payload.nonce!==pending.nonce||typeof payload.sub!=='string')throw new Error('Invalid identity response');
      let identity=payload;
      if(!identity.name||!identity.picture){const profile=await fetch('https://api.linkedin.com/v2/userinfo',{headers:{Authorization:`Bearer ${tokens.access_token}`},signal:AbortSignal.timeout(10000)});if(profile.ok){const details=await profile.json();if(details.sub!==payload.sub)throw new Error('Identity mismatch');identity={...payload,...details};}}
      if(typeof identity.name!=='string'||!identity.name.trim())throw new Error('Name unavailable');
      const existing=author();let avatarId=existing.avatarId;
      try {
        const photo=new URL(identity.picture);
        if(photo.protocol==='https:'&&/^(?:[a-z0-9-]+\.)*licdn\.com$/.test(photo.hostname)&&!photo.username&&!photo.password){
          const image=await fetch(photo,{redirect:'error',signal:AbortSignal.timeout(10000)});
          if(image.ok&&Number(image.headers.get('content-length')??0)<=12*1024*1024){
            const request=Readable.fromWeb(image.body);request.headers={'content-type':image.headers.get('content-type')};request.url='/api/admin/blogs/author/media?name=LinkedIn%20photo';avatarId=(await upload(request,null)).id;
          }
        }
      } catch { /* A temporary photo failure should not prevent importing the author. */ }
      // Re-check the session after network I/O, including an intervening sign-out.
      if(!activeSession())throw new Error('Session ended');
      save({...existing,name:identity.name.trim().slice(0,100),linkedinId:payload.sub,avatarId});
      res.writeHead(303,{Location:'/admin?section=blogs&linkedin=connected'});res.end();return true;
    } catch {throw new HttpError(502,'LinkedIn could not be connected. Try again from the author settings.');}
  }
  return {available,adminRoute,callback};
}
