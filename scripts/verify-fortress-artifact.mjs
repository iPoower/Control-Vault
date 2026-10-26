import {readFileSync,readdirSync,lstatSync,appendFileSync} from 'node:fs';
import {resolve,relative,join} from 'node:path';
import {createHash} from 'node:crypto';
const check=(yes,why)=>{if(!yes)throw new Error('FORTRESS TEST: '+why)};
const root=resolve(process.cwd());
check(process.argv[2] && /^[0-9a-f]{40}$/.test(process.env.BUILD_SHA||''),'receipt and source SHA required');
const receipt=JSON.parse(readFileSync(process.argv[2],'utf8'));
check(typeof receipt.site==='string','site missing');
const site=resolve(receipt.site);
check(/^\.drive-test-profile-[^/]+\/site$/.test(relative(root,site).replaceAll('\\','/')),'unexpected site folder');
check(lstatSync(site).isDirectory() && !lstatSync(site).isSymbolicLink(),'site not directory');
const v=JSON.parse(readFileSync(join(site,'version.json'),'utf8'));
const m=JSON.parse(readFileSync(join(site,'fixture-manifest.json'),'utf8'));
const sha=process.env.BUILD_SHA;
check(receipt.sourceSha===sha && v.sha===sha && m.sourceSha===sha,'source SHA mismatch');
check(receipt.googleEnabled===Boolean(process.env.FORTRESS_TEST_GOOGLE_CONFIG),'configuration mismatch');
// The owner configured TEST OAuth: fail closed instead of certifying Google-off artifacts.
check(receipt.googleEnabled===true,'Google TEST config missing or disabled: refused');
check(v.googleEnabled===receipt.googleEnabled && m.googleEnabled===receipt.googleEnabled,'Google config mismatch');
for(const obj of [v,m])check(obj.environment==='isolated-test' && obj.fixtureOnly===true,'not synthetic TEST');
check(m.raceOrigin==='https://rc-drive-test-ipoower.pages.dev' && m.vaultOrigin==='https://cv-drive-test-ipoower.pages.dev','origin mismatch');
check(m.files && typeof m.files==='object' && !Array.isArray(m.files),'no manifest');
const files=[];
function walk(dir,prefix=''){for(const e of readdirSync(dir,{withFileTypes:true})){const n=prefix+e.name,full=join(dir,e.name),s=lstatSync(full);check(!s.isSymbolicLink(),'symlink: '+n);if(s.isDirectory())walk(full,n+'/');else{check(s.isFile(),'nonfile: '+n);files.push(n)}}}
walk(site);
const actual=files.filter(n=>n!=='fixture-manifest.json').sort();
check(JSON.stringify(actual)===JSON.stringify(Object.keys(m.files).sort()),'manifest entries differ');
for(const name of actual){check(createHash('sha256').update(readFileSync(join(site,name))).digest('hex')===m.files[name],'file SHA mismatch: '+name);check(!/(^|\/)(encrypted|private|personal|\.env|\.git|node_modules)(\/|$)/i.test(name),'private path: '+name)}
for(const name of ['index.html','drive-config.json','version.json'])check(actual.includes(name),'missing: '+name);
check(actual.length>=6,'implausibly small build');
check(typeof process.env.GITHUB_OUTPUT==='string','CI output missing');
appendFileSync(process.env.GITHUB_OUTPUT,'site_dir='+site+'\n');
console.log('FORTRESS TEST: verified '+actual.length+' synthetic files, origin, version and SHA-256.');
