#!/usr/bin/env node
/**
 * Sondes de sécurité contre le serveur, sur les cas limites que la recette ne
 * couvre pas : traversée de répertoire, encodages, fichiers cachés, listage,
 * méthodes HTTP, en-tête Host inattendu, redirection ouverte, injection
 * d'en-tête, types MIME.
 *
 * À lancer contre un serveur qui applique public/.htaccess :
 *   node scripts/apache.mjs -- node scripts/audit-securite.mjs
 *   node scripts/audit-securite.mjs --base https://www.twooldwheels.fr
 *
 * Le fichier .git n'existe qu'en production, déposé par l'intégration Git
 * d'OVH : le test le simule en créant un leurre dans dist/, puis le retire.
 */
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const i = process.argv.indexOf('--base');
const BASE = (i !== -1 ? process.argv[i + 1] : process.env.BASE || 'http://localhost:4321').replace(/\/$/, '');
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE + '/');
const DIST = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');

const resultats = [];
const ok = (c, l) => resultats.push({ c, l });

// Leurres : ce qu'un dépôt git ou un fichier d'environnement oublié donnerait.
const leurres = [];
if (LOCAL && existsSync(DIST)) {
  mkdirSync(join(DIST, '.git'), { recursive: true });
  writeFileSync(join(DIST, '.git/config'), '[remote "origin"]\n');
  writeFileSync(join(DIST, '.env'), 'JETON=secret\n');
  leurres.push(join(DIST, '.git'), join(DIST, '.env'));
}

const statut = async (chemin, options = {}) => {
  const r = await fetch(BASE + chemin, { redirect: 'manual', ...options });
  return { code: r.status, location: r.headers.get('location'), type: r.headers.get('content-type') ?? '' };
};

try {
  // --- Rien du dépôt ni du serveur ne doit être lisible ---------------------
  for (const chemin of [
    '/.git/config', '/.env', '/.htaccess', '/admin/.htaccess', '/_astro/.htaccess', '/.htpasswd',
    '/%2e%2e/%2e%2e/etc/passwd', '/..%2fetc/passwd', '/%2ehtaccess', '/admin/%2e%2e/.htaccess',
  ]) {
    const { code } = await statut(chemin);
    // 404 en local, 403 chez OVH, et 400 quand leur serveur rejette d'emblée
    // une adresse malformée : dans tous les cas, rien n'est servi.
    ok(code >= 400, `${chemin} : inaccessible (${code})`);
  }

  // --- Pas de listage de répertoire ----------------------------------------
  for (const chemin of ['/_astro/', '/admin/cms/']) {
    const { code } = await statut(chemin);
    ok(code !== 200, `${chemin} : pas de listage (${code})`);
  }

  // --- Méthodes d'écriture refusées ----------------------------------------
  for (const methode of ['PUT', 'DELETE', 'PATCH']) {
    const { code } = await statut('/contact', { method: methode });
    ok(code >= 400, `${methode} refusé (${code})`);
  }

  // --- Aucune redirection ouverte, aucune injection d'en-tête --------------
  const evil = await statut('//evil.example');
  ok(evil.code !== 301 || !(evil.location ?? '').includes('evil.example'), 'pas de redirection ouverte via //');
  const injection = await statut('/contact%0d%0aSet-Cookie:x=1');
  ok(injection.code === 404, `pas d'injection d'en-tête par l'URL (${injection.code})`);
  const joomla = await statut('/index.php?redirect=//evil.example');
  const cible = new URL(joomla.location ?? '', BASE);
  ok(joomla.code === 301 && cible.pathname === '/' && cible.search === '',
     `paramètres purgés sur les anciennes adresses (${joomla.location})`);

  // --- Types MIME : rien ne doit pouvoir être pris pour du HTML ------------
  for (const [chemin, attendu] of [
    ['/admin/config.yml', 'yaml'],
    ['/robots.txt', 'text/plain'],
    ['/sitemap-0.xml', 'xml'],
    ['/transitions.css', 'text/css'],
    ['/sans-javascript.css', 'text/css'],
  ]) {
    const { type } = await statut(chemin);
    ok(type.includes(attendu), `${chemin} : type ${type || 'absent'}`);
  }

  // --- Les en-têtes de sécurité tiennent aussi sur les 301 et les 404 ------
  for (const chemin of ['/inexistant', '/contacts']) {
    const r = await fetch(BASE + chemin, { redirect: 'manual' });
    for (const entete of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy']) {
      ok(r.headers.has(entete), `${chemin} (${r.status}) : ${entete}`);
    }
  }

  // --- L'administration n'expose ni source ni carte de code ----------------
  for (const chemin of ['/admin/cms/sveltia-cms.js.map', '/admin/cms/sveltia-cms.mjs']) {
    const { code } = await statut(chemin);
    ok(code === 404, `${chemin} : absent (${code})`);
  }
  const config = await (await fetch(BASE + '/admin/config.yml')).text();
  ok(!/(ghp_|github_pat_|client_secret|password:)/i.test(config), "config.yml : aucun secret");
} finally {
  for (const chemin of leurres) rmSync(chemin, { recursive: true, force: true });
}

for (const r of resultats) console.log(`  ${r.c ? 'ok   ' : 'ÉCHEC'} ${r.l}`);
const echecs = resultats.filter((r) => !r.c).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} réussis`);
process.exit(echecs ? 1 : 0);
