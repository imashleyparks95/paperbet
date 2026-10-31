import {readFileSync,writeFileSync,readdirSync,mkdirSync,rmSync,copyFileSync} from 'node:fs';
const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',webmanifest:'application/manifest+json',png:'image/png',svg:'image/svg+xml'};
const assets={};for(const name of readdirSync('public')){const a={type:types[name.split('.').at(-1)]||'application/octet-stream',body:readFileSync('public/'+name).toString('base64')};assets[name==='index.html'?'/':'/'+name]=a;}
const strip=s=>s.replace(/^import .*?;\n/gm,'').replace(/^export default .*?;\n/gm,'').replace(/^export /gm,'');
const source=['domain.js','espn.js','worker/d1-store.js','worker/index.js'].map(f=>strip(readFileSync(f,'utf8'))).join('\n').replace('const ASSETS = {};','const ASSETS = '+JSON.stringify(assets)+';')+'\nexport default {fetch:handle};\n';
rmSync('dist',{recursive:true,force:true});mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});writeFileSync('dist/server/index.js',source);copyFileSync('.openai/hosting.json','dist/.openai/hosting.json');console.log('Built self-contained PaperBet Worker with '+Object.keys(assets).length+' assets');
