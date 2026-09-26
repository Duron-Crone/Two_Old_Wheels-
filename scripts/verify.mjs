#!/usr/bin/env node
/**
 * Recette automatisée, contre un serveur qui applique `public/.htaccess` :
 * Apache en local (`npm run recette`) ou le site en ligne.
 *
 *   node scripts/verify.mjs [--base http://localhost:4321]
 *   node scripts/verify.mjs --base https://www.twooldwheels.fr
 *
 * Le contrôle des empreintes CSP est le plus important : il attrape le cas où
 * un style ou un script inline arriverait sans hash, ce qui casserait la page
 * en production sans qu'aucun build ne le signale.
 */
import { createHash } from 'node:crypto';
import { request } from 'node:http';

const i = process.argv.indexOf('--base');
const BASE = (i !== -1 ? process.argv[i + 1] : process.env.BASE || 'http://localhost:4321').replace(/\/$/, '');
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE + '/');

const PAGES = ['/', '/reparation', '/vente', '/galerie-photos', '/contact', '/mentions-legales'];
// Aucune adresse e-mail ne doit être lisible dans ce qui est servi : elle
// n'apparaît qu'après un clic du visiteur, cf. components/ui/EmailProtege.astro.
const ADRESSE_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const REDIRECTS = [
  // Anciennes adresses du site Joomla.
  ['/contacts', '/contact'],
  ['/contacts/', '/contact'],
  ['/politique-de-protection-des-donnees', '/mentions-legales'],
  ['/index.php', '/'],
  ['/index.php?option=com_content&view=article&id=3', '/'],
  ['/component/content/article/12', '/'],
  ['/feed', '/'],
  // Une seule forme d'URL par page.
  ['/contact/', '/contact'],
  ['/contact.html', '/contact'],
  ['/index.html', '/'],
  ['/admin', '/admin/'],
];

let passed = 0;
const failures = [];
const check = (cond, label) => (cond ? passed++ : failures.push(label));
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('base64');
const unescapeHtml = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

for (const path of PAGES) {
  const res = await fetch(BASE + path);
  const body = await res.text();
  check(res.ok, `${path}: réponse 200`);

  // --- SEO ---
  check((body.match(/<h1/g) || []).length === 1, `${path}: un seul h1`);
  const title = body.match(/<title>(.*?)<\/title>/s)?.[1] ?? '';
  check(title.length > 10 && title.length <= 65, `${path}: longueur du title (${title.length})`);
  const desc = body.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? '';
  check(desc.length >= 70 && desc.length <= 165, `${path}: longueur de la description (${desc.length})`);
  const noindex = body.includes('noindex');
  check(!/rel="canonical" href="[^"]*\.html"/.test(body), `${path}: canonique sans .html`);
  check(!/href="\/[^"]*\.html"/.test(body), `${path}: liens internes sans .html`);
  check(/rel="canonical"/.test(body) !== noindex, `${path}: canonique cohérente avec noindex`);
  // Sans JavaScript, les blocs à apparition resteraient à opacity 0 : la feuille
  // de repli les affiche. Sans elle, la page s'ouvre vide sous l'en-tête.
  check(body.includes('<noscript><link rel="stylesheet" href="/sans-javascript.css">'),
        `${path}: repli sans JavaScript`);
  for (const og of ['og:title', 'og:image:width', 'og:image:alt', 'og:locale']) {
    check(body.includes(`"${og}"`), `${path}: ${og}`);
  }
  for (const m of body.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)) {
    try {
      JSON.parse(m[1].replace(/\\u003c/g, '<'));
      passed++;
    } catch {
      failures.push(`${path}: JSON-LD invalide`);
    }
  }

  // --- CSP : rien ne doit passer sans empreinte ---
  const policy = unescapeHtml(body.match(/http-equiv="content-security-policy" content="([^"]+)"/)?.[1] ?? '');
  check(policy !== '', `${path}: CSP présente`);
  check(!policy.includes('unsafe-inline'), `${path}: CSP sans unsafe-inline`);
  check(!body.includes('style="'), `${path}: aucun attribut style inline`);
  let n = 0;
  for (const m of body.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>(.*?)<\/script>/gs)) {
    if (m[1].includes('ld+json')) continue;
    check(policy.includes(`'sha256-${sha256(m[2])}'`), `${path}: script inline #${++n} empreinté`);
  }
  n = 0;
  for (const m of body.matchAll(/<style[^>]*>(.*?)<\/style>/gs)) {
    check(policy.includes(`'sha256-${sha256(m[1])}'`), `${path}: style inline #${++n} empreinté`);
  }

  // --- en-têtes ---
  for (const h of ['content-security-policy', 'x-frame-options', 'x-content-type-options',
                   'referrer-policy', 'permissions-policy', 'cross-origin-opener-policy']) {
    check(res.headers.has(h), `${path}: en-tête ${h}`);
  }

  // --- images ---
  const imgs = body.match(/<img\b[^>]*>/g) ?? [];
  check(imgs.every((t) => /\balt(=|\s|>)/.test(t)), `${path}: alt sur les ${imgs.length} images`);
  check(imgs.every((t) => t.includes('width=') && t.includes('height=')), `${path}: dimensions déclarées`);

  // --- rédaction ---
  const text = body.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, ' ');
  check(!text.includes('—') && !text.includes('–'), `${path}: aucun cadratin`);
  check(!/scooter|mobylette|cyclomoteur/i.test(body), `${path}: aucune référence au scooter`);
  check(!/Formulaire de contact/.test(body), `${path}: pas de formulaire promis`);
  check(!/à compléter|a completer|lorem ipsum/i.test(text), `${path}: aucun texte provisoire`);
  check(!ADRESSE_EMAIL.test(body), `${path}: aucune adresse e-mail lisible dans la page`);

  // --- tout ce qui réagit au survol se clique ---
  for (const fig of body.match(/<figure[^>]*hover:[^>]*>[\s\S]*?<\/figure>/g) ?? []) {
    check(/<a\s|data-zoom/.test(fig), `${path}: carte survolable également cliquable`);
  }
  for (const art of body.match(/<article[^>]*class="[^"]*group[^"]*"[\s\S]*?<\/article>/g) ?? []) {
    check(/<a\s/.test(art), `${path}: carte de prestation cliquable`);
  }
  // Le déclencheur de zoom est un lien vers l'image : sans JavaScript il
  // l'ouvre quand même, plutôt que d'être un bouton mort.
  for (const a of body.match(/<a[^>]*data-zoom[^>]*>/g) ?? []) {
    check(a.includes('aria-label='), `${path}: déclencheur de zoom étiqueté`);
    check(/href="\/_astro\/[^"]+"/.test(a), `${path}: déclencheur de zoom pointant sur l'image`);
  }
}

// --- redirections ---
for (const [from, to] of REDIRECTS) {
  const res = await fetch(BASE + from, { redirect: 'manual' });
  const cible = new URL(res.headers.get('location') ?? '', BASE);
  check(res.status === 301 && cible.pathname === to && cible.search === '', `${from} redirige en 301 vers ${to}`);
}

// Pas de boucle entre le « / » final qu'Apache ajoute aux dossiers et la règle
// qui le retire aux pages : chaque forme aboutit en au plus deux sauts.
for (const path of ['/contact/', '/admin', '/_astro', '/contact.html']) {
  let url = BASE + path;
  let sauts = 0;
  let res = await fetch(url, { redirect: 'manual' });
  while (res.status === 301 && sauts < 5) {
    url = new URL(res.headers.get('location'), url).href;
    res = await fetch(url, { redirect: 'manual' });
    sauts++;
  }
  check(sauts <= 2 && res.status !== 301, `${path} : pas de boucle de redirection (${sauts} saut(s), ${res.status})`);
}

// --- HTTPS et www ---
// En local, Apache reçoit la requête avec le nom de domaine du site ; en ligne,
// la vraie adresse http:// est interrogée.
const redirectionAvecHote = (hote, chemin) =>
  new Promise((resolve, reject) => {
    const { hostname, port } = new URL(BASE);
    request({ hostname, port, path: chemin, headers: { host: hote } }, (r) => {
      r.resume();
      resolve({ status: r.statusCode, location: r.headers.location });
    }).on('error', reject).end();
  });
for (const hote of ['twooldwheels.fr', 'www.twooldwheels.fr']) {
  const r = LOCAL
    ? await redirectionAvecHote(hote, '/contact?source=test')
    : await fetch(`http://${hote}/contact?source=test`, { redirect: 'manual' }).then((x) => ({
        status: x.status,
        location: x.headers.get('location'),
      }));
  const visee = r.location ? new URL(r.location) : null;
  check(r.status === 301 && visee?.hostname === 'www.twooldwheels.fr' && visee.protocol === 'https:' &&
        visee.pathname === '/contact' && visee.search === '?source=test',
        `http://${hote} redirige vers https://www.twooldwheels.fr (${r.location})`);
}
if (!LOCAL) {
  const r = await fetch('https://twooldwheels.fr/contact', { redirect: 'manual' });
  const visee = r.headers.get('location') ? new URL(r.headers.get('location')) : null;
  check(r.status === 301 && visee?.hostname === 'www.twooldwheels.fr' && visee.pathname === '/contact',
        `https://twooldwheels.fr redirige vers www (${r.headers.get('location')})`);
}

// --- fichiers cachés (le .git déposé par OVH, le .htaccess) ---
for (const path of ['/.htaccess', '/.git/HEAD', '/.git/config']) {
  // 403 chez OVH, 404 en local : dans les deux cas rien n'est servi.
  const code = (await fetch(BASE + path, { redirect: 'manual' })).status;
  check(code === 404 || code === 403, `${path} : inaccessible (${code})`);
}

// --- cache et en-têtes par type de ressource ---
const accueil = await fetch(BASE + '/');
check(/max-age=0/.test(accueil.headers.get('cache-control') ?? ''), 'HTML : revalidé à chaque visite');
check(/max-age=\d{7,}/.test(accueil.headers.get('strict-transport-security') ?? ''), 'HSTS présent');
const feuille = (await accueil.clone().text()).match(/href="(\/_astro\/[^"]+\.css)"/)?.[1];
const asset = feuille ? await fetch(BASE + feuille) : null;
check(/immutable/.test(asset?.headers.get('cache-control') ?? ''), '/_astro : cache définitif');
const sansJs = await fetch(BASE + '/sans-javascript.css');
check(sansJs.ok && (sansJs.headers.get('content-type') ?? '').includes('text/css'), 'feuille de repli sans JavaScript servie');
const og = await fetch(BASE + '/og-default.jpg');
check(og.headers.get('cross-origin-resource-policy') === 'cross-origin', 'image de partage lisible par les réseaux sociaux');

// --- 404 ---
check((await fetch(BASE + '/url-inexistante')).status === 404, '404: vrai statut HTTP');

// --- ancres des prestations ---
const home = await (await fetch(BASE + '/')).text();
const rep = await (await fetch(BASE + '/reparation')).text();
for (const m of home.matchAll(/href="\/reparation#([a-z-]+)"/g)) {
  check(rep.includes(`id="${m[1]}"`), `ancre #${m[1]} présente sur /reparation`);
}

// --- transitions partagées ---
// Deux pièges silencieux : un nom en double sur une page annule la transition,
// et une clé `transition:persist` auto-générée change d'une page à l'autre,
// donc ne persiste rien. Aucun des deux ne fait échouer le build.
const vtNames = (body) => [...body.matchAll(/data-vt="([A-Za-z0-9_-]+)"/g)].map((m) => m[1]);
const persistKeys = (body) =>
  [...body.matchAll(/data-astro-transition-persist="([^"]*)"/g)].map((m) => m[1]).sort();

const pageBodies = {};
for (const path of PAGES) pageBodies[path] = await (await fetch(BASE + path)).text();

// Les règles `view-transition-name` sont générées depuis les contenus dans
// /transitions.css (cf. src/pages/transitions.css.ts). Un `data-vt` sans règle
// correspondante est un morphe silencieusement mort : le build ne dit rien.
const cssResponse = await fetch(BASE + '/transitions.css');
check(cssResponse.ok && cssResponse.headers.get('content-type')?.includes('text/css'), '/transitions.css servie en CSS');
check(pageBodies['/'].includes('href="/transitions.css"'), 'feuille des transitions liée dans les pages');
const css = await cssResponse.text();

for (const [path, body] of Object.entries(pageBodies)) {
  const found = vtNames(body);
  check(found.length === new Set(found).size, `${path}: noms de transition uniques`);
  for (const n of new Set(found)) {
    check(css.includes(`view-transition-name:${n}`), `${path}: règle CSS présente pour ${n}`);
  }
  check(!persistKeys(body).some((k) => k.startsWith('astro-')),
        `${path}: clés de persistance nommées explicitement`);
  check(persistKeys(body).includes('entete'), `${path}: en-tête persistant`);
}

// Chaque nom posé sur l'accueil doit exister sur au moins une autre page :
// sinon l'élément n'a nulle part où aller. Les contenus étant éditables, on ne
// présume plus de la page de destination.
// L'adresse e-mail est proposée derrière un bouton, jamais écrite dans la page.
check(pageBodies['/contact'].includes('data-email-protege'), 'contact : adresse e-mail derrière un bouton');

const homeNames = vtNames(pageBodies['/']);
for (const n of homeNames) {
  const ailleurs = PAGES.filter((p) => p !== '/').some((p) => vtNames(pageBodies[p]).includes(n));
  check(ailleurs, `${n}: présent aussi sur une autre page`);
}
check(homeNames.length >= 8, `accueil: ${homeNames.length} éléments morphent`);

// --- llms.txt généré depuis les contenus ---
const llms = await (await fetch(BASE + '/llms.txt')).text();
check(llms.startsWith('# Two Old Wheels') && llms.includes('## Prestations'), 'llms.txt généré');
check(!ADRESSE_EMAIL.test(llms), 'llms.txt : aucune adresse e-mail');

// --- sitemap et robots ---
const sitemap = await (await fetch(BASE + '/sitemap-0.xml')).text();
check((sitemap.match(/<url>/g) || []).length === 5, 'sitemap: 5 URL');
check(!sitemap.includes('/mentions-legales'), 'sitemap: pages noindex exclues');
check(!sitemap.includes('.html'), 'sitemap: adresses sans .html');
check((await (await fetch(BASE + '/robots.txt')).text()).includes('Sitemap:'), 'robots: sitemap déclaré');

console.log(`\n${passed} contrôles réussis`);
if (failures.length) {
  console.log(`${failures.length} ÉCHEC(S) :`);
  for (const f of failures) console.log('  !!', f);
  process.exit(1);
}
console.log('0 échec.\n');
