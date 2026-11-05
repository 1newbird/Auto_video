import fs from 'node:fs/promises';
import path from 'node:path';

export function isWithin(root,target) {
  const rel=path.relative(path.resolve(root),path.resolve(target));
  return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));
}

async function realLocation(file) {
  try{return await fs.realpath(file);}catch(error){
    if(error.code!=='ENOENT')throw error;
    const parent=path.dirname(file);
    if(parent===file)throw error;
    return path.join(await realLocation(parent),path.basename(file));
  }
}

export async function assertWithinOutput(output,target) {
  if(!isWithin(output,target)||!isWithin(await realLocation(output),await realLocation(target)))
    throw new Error(`Job must stay inside configured output directory: ${output}. Do not relocate/copy the job; change outputDir only when the user requests another destination.`);
}

export async function storageEnvironment(directory) {
  const out=path.resolve(directory),temp=path.join(out,'.tmp');
  const env={TEMP:temp,TMP:temp,TMPDIR:temp,PYTHONDONTWRITEBYTECODE:'1',
    NODE_COMPILE_CACHE:path.join(out,'.cache','node'),XDG_CACHE_HOME:path.join(out,'.cache','system'),
    LOCALAPPDATA:path.join(out,'.cache','local'),APPDATA:path.join(out,'.cache','roaming')};
  for(const value of new Set(Object.values(env).filter(v=>path.isAbsolute(v))))await fs.mkdir(value,{recursive:true});
  return env;
}
