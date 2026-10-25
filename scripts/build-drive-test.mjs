// Profil TEST uniquement ; aucune connexion ni donnée personnelle.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GoogleDriveSession } from '../src/services/google-drive-session.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RACE = 'https://rc-drive-test-ipoower.pages.dev', VAULT = 'https://cv-drive-test-ipoower.pages.dev';
const sha = process.env.BUILD_SHA || '';
if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error('BUILD_SHA exact obligatoire.');
const text = process.env.GOOGLE_DRIVE_CONFIG || '';
if (Buffer.byteLength(text) > 2048) throw new Error('Configuration trop volumineuse.');
let cfg = null;
try { if (text) cfg = GoogleDriveSession.config(JSON.parse(text), VAULT); } catch { throw new Error('Configuration publique TEST invalide.'); }
if (cfg && (cfg.raceOrigin !== RACE || cfg.vaultOrigin !== VAULT)) throw new Error('Origines TEST exactes requises.');
const base = fs.mkdtempSync(path.join(ROOT, '.drive-test-profile-')), site = path.join(base, 'site');
try { execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], { cwd: ROOT, env: { ...process.env, VAULT_OUT: site, BUILD_SHA: sha, VAULT_DEDICATED_BUILD: '1', GOOGLE_DRIVE_CONFIG: text }, stdio: 'pipe', timeout: 120000 }); }
catch { throw new Error('Build TEST refusé ; aucune sortie brute affichée.'); }
const p = name => path.join(site, name);
let html = fs.readFileSync(p('index.html'), 'utf8');
html = html.replace('<head>', '<head><link rel="stylesheet" href="drive-test.css">').replace('<body>', '<body><aside id="drive-test-notice" role="note"><strong>TEST — DONNÉES FICTIVES UNIQUEMENT</strong> · Google personnel interdit · <a href="' + RACE + '/" rel="noopener noreferrer">Race Control TEST</a></aside>');
fs.writeFileSync(p('index.html'), html);
fs.writeFileSync(p('drive-test.css'), '#drive-test-notice{display:block;padding:12px;background:#49380b;color:#fff;font:14px/1.5 system-ui}#drive-test-notice a{color:#fff;text-decoration:underline}');
const manifest = JSON.parse(fs.readFileSync(p('manifest.webmanifest'), 'utf8'));
manifest.name = 'Control Vault — Drive TEST'; manifest.short_name = 'CV TEST';
fs.writeFileSync(p('manifest.webmanifest'), JSON.stringify(manifest));
const version = JSON.parse(fs.readFileSync(p('version.json'), 'utf8'));
fs.writeFileSync(p('version.json'), JSON.stringify({ ...version, environment: 'isolated-test', fixtureOnly: true, googleEnabled: !!cfg }));
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
function files(dir, prefix = '') { return fs.readdirSync(path.join(dir, prefix), { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e => { const n = prefix + e.name; if (e.isDirectory()) return files(dir, n + '/'); if (!e.isFile()) throw new Error('Fichier non régulier.'); return [n]; }); }
const contents = Object.fromEntries(files(site).map(n => [n, digest(fs.readFileSync(p(n)))]));
fs.writeFileSync(p('fixture-manifest.json'), JSON.stringify({ environment: 'isolated-test', fixtureOnly: true, sourceSha: sha, raceOrigin: RACE, vaultOrigin: VAULT, googleEnabled: !!cfg, files: contents }, null, 2));
console.log(JSON.stringify({ site, sourceSha: sha, googleEnabled: !!cfg, files: Object.keys(contents).length }));
