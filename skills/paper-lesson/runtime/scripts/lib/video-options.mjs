// Output pixels are independent of the 1080x1920 logical board coordinates.
export const resolutions={'1080p':[1080,1920],'1440p':[1440,2560],'4K':[2160,3840]};
export function videoOptions(quality='4K',fps=30) {
  const name=typeof quality==='string'&&quality.toLowerCase()==='4k'?'4K':quality;
  if(typeof name!=='string'||!Object.hasOwn(resolutions,name))throw new Error('清晰度必须为 1080p、1440p 或 4K');
  if(![30,60].includes(fps))throw new Error('帧率必须为数字 30 或 60');
  const [width,height]=resolutions[name];
  return {quality:name,width,height,fps};
}
