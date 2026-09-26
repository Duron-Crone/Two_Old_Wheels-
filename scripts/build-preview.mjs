#!/usr/bin/env node
/**
 * Fabrique une copie de `dist/` à chemins relatifs, destinée à un aperçu
 * partageable (lien ou archive), pas à la production.
 *
 * Pourquoi une copie plutôt que `dist/` tel quel : le site est bâti sur des
 * chemins absolus (`/_astro/…`, `/contact`). Ouvert ailleurs qu'à la racine
 * d'un domaine, plus rien ne se résout. Et la CSP en <meta> (`default-src
 * 'self'`) bloquerait tout dans un contexte `file://`, où « self » n'existe
 * pas : la page s'afficherait nue.
 *
 * Ce que la copie change, et rien d'autre :
 *   - les pages restent à plat (`contact.html`, cf. build.format), et
 *     l'accueil devient `accueil.html` : `index.html` est souvent réservé
 *     par l'hébergeur de l'aperçu pour sa propre page d'entrée ;
 *   - `_astro/` devient `assets/` : certains hébergeurs d'aperçu réservent les
 *     chemins commençant par un tiret bas ;
 *   - tous les chemins absolus deviennent relatifs, dans le HTML et le CSS ;
 *   - la CSP en <meta> est retirée (l'hébergeur de l'aperçu a la sienne) ;
 *   - les pages passent en `noindex`, pour qu'un aperçu ne puisse jamais
 *     concurrencer le vrai site dans un index de moteur de recherche ;
 *   - `robots.txt`, les sitemaps et le `.htaccess` sont écartés :
 *     ils n'ont aucun sens hors du domaine de production.
 *
 * Usage : npm run build && node scripts/build-preview.mjs
 */
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'dist');
const OUT = join(ROOT, 'dist-preview');

// Les routes du site. L'ordre importe : les plus longues d'abord, sinon `/`
// remplacerait le début de `/contact`.
const ROUTES = ['/galerie-photos', '/mentions-legales', '/reparation', '/contact', '/vente'];

// `_astro` est renommé : un chemin commençant par un tiret bas est réservé
// chez certains hébergeurs d'aperçu.
const ASSETS = 'assets';

// L'accueil ne peut pas s'appeler `index.html` : ce nom est réservé par
// l'hébergeur de l'aperçu.
const HOME = 'accueil.html';

const EXCLUDE = new Set(['robots.txt', 'sitemap-index.xml', 'sitemap-0.xml', '.htaccess', 'llms.txt']);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// --- assets copiés tels quels ---
await cp(join(SRC, '_astro'), join(OUT, ASSETS), { recursive: true });
for (const f of await readdir(SRC, { withFileTypes: true })) {
  if (f.isDirectory() || EXCLUDE.has(f.name) || f.name.endsWith('.html')) continue;
  await cp(join(SRC, f.name), join(OUT, f.name));
}

function rewrite(html) {
  // Les routes deviennent des fichiers à plat, ancres comprises.
  for (const route of ROUTES) {
    html = html.replaceAll(`"${route}#`, `"${route.slice(1)}.html#`);
    html = html.replaceAll(`"${route}"`, `"${route.slice(1)}.html"`);
  }
  html = html.replaceAll('href="/"', `href="${HOME}"`);

  // Assets : on enlève simplement la barre de tête.
  html = html.replaceAll('="/_astro/', `="${ASSETS}/`);
  html = html.replaceAll(' /_astro/', ` ${ASSETS}/`); // entrées de srcset
  html = html.replaceAll('srcset="/_astro/', `srcset="${ASSETS}/`);
  for (const f of ['favicon.svg', 'apple-touch-icon.png', 'icon-512.png', 'og-default.jpg']) {
    html = html.replaceAll(`="/${f}"`, `="${f}"`);
  }

  // Ouvert depuis un fichier local, le navigateur refuse de charger les modules
  // ES (le site n'a qu'un script, et c'est un module). Sans lui, rien ne se
  // révèle au scroll : la page s'affiche avec ses couleurs et ses polices, mais
  // tous les blocs à apparition restent à `opacity: 0`, donc invisibles.
  // Ce script classique, lui, s'exécute, et affiche tout d'un coup.
  html = html.replace(
    '</body>',
    `<script>
  if (location.protocol === 'file:') {
    document.addEventListener('DOMContentLoaded', function () {
      var els = document.querySelectorAll('.reveal');
      for (var i = 0; i < els.length; i++) els[i].classList.add('is-in');
    });
  }
</script></body>`,
  );

  // Ce qui n'a pas de sens hors production.
  html = html.replace(/<meta http-equiv="content-security-policy"[^>]*>/i, '');
  html = html.replace(/<link rel="sitemap"[^>]*>/i, '');
  html = html.replace(/<meta name="robots" content="[^"]*">/i, '<meta name="robots" content="noindex, nofollow">');

  return html;
}

async function collectHtml(dir, base = '') {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name === '_astro') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collectHtml(full, join(base, e.name))));
    else if (e.name.endsWith('.html')) out.push({ full, base, name: e.name });
  }
  return out;
}

let count = 0;
for (const page of await collectHtml(SRC)) {
  // `contact/index.html` -> `contact.html`, `404.html` reste, et l'accueil
  // prend le nom défini par HOME.
  const target = page.base ? `${page.base}.html` : page.name === 'index.html' ? HOME : page.name;
  const dest = join(OUT, target);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, rewrite(await readFile(page.full, 'utf8')));
  count++;
}

// --- le CSS référence les polices en absolu ---
for (const f of await readdir(join(OUT, ASSETS))) {
  if (!f.endsWith('.css')) continue;
  const p = join(OUT, ASSETS, f);
  // La feuille vit dans `_astro/`, les polices aussi : une référence nue suffit.
  await writeFile(p, (await readFile(p, 'utf8')).replaceAll('url(/_astro/', 'url('));
}

console.log(`Aperçu écrit dans dist-preview/ : ${count} page(s), chemins relatifs, sans CSP ni indexation.`);
