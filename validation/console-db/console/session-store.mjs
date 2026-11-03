import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';

// Opaque browser IDs; credentials stay encrypted on a private server volume.
export function createSessionStore(env){
 const memory=new Map(),directory=env.CONSOLE_SESSION_DIR;
 const secret=env.CONSOLE_SESSION_KEY;
 if((directory||secret)&&(!directory||!isAbsolute(directory)||!/^[a-f0-9]{64}$/i.test(secret||'')))
   throw new Error('CONSOLE_SESSION_CONFIGURATION_REQUIRED');
 const key=secret?Buffer.from(secret,'hex'):null;
 const valid=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
 const file=id=>join(directory,id+'.session');
 return {
  async set(id,session){
   if(!valid(id))throw new Error('INVALID_SESSION_ID');
   if(!directory||!['scoped','owner'].includes(session.mode)){memory.set(id,session);return;}
   await mkdir(directory,{recursive:true,mode:0o700});
   const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
   cipher.setAAD(Buffer.from(id));
   const encrypted=Buffer.concat([cipher.update(JSON.stringify(session)),cipher.final()]);
   const bytes=Buffer.concat([iv,cipher.getAuthTag(),encrypted]);
   const temporary=file(id)+'.'+randomBytes(8).toString('hex')+'.tmp';
   try{await writeFile(temporary,bytes,{mode:0o600,flag:'wx'});await rename(temporary,file(id));}
   finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  },
  async get(id){
   if(!valid(id))return null;
   let session=memory.get(id);
   if(!session&&directory){
    let bytes;
    try{bytes=await readFile(file(id));}catch(e){if(e.code==='ENOENT')return null;throw new Error('SESSION_STORAGE_UNAVAILABLE');}
    try{
     if(bytes.length<29||bytes.length>16384)return null;
     const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,12));
     decipher.setAAD(Buffer.from(id));decipher.setAuthTag(bytes.subarray(12,28));
     session=JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
     if(!['scoped','owner'].includes(session.mode)||!Array.isArray(session.permissions)||typeof session.credential!=='string')return null;
    }catch{return null;}
   }
   if(!session)return null;
   if(!Number.isFinite(session.exp)||session.exp<=Date.now()){await this.delete(id);return null;}
   return session;
  },
  async delete(id){
   if(!valid(id))return;
   memory.delete(id);
   if(directory)await unlink(file(id)).catch(e=>{if(e.code!=='ENOENT')throw new Error('SESSION_STORAGE_UNAVAILABLE');});
  }
 };
}
