#!/usr/bin/env node
/**
 * Test de l'administration (/admin) dans un vrai navigateur, sans GitHub.
 *
 * 1. En-têtes : la page d'administration a sa propre CSP (conversion des photos,
 *    API GitHub) et reste hors des moteurs de recherche, pendant que les pages
 *    publiques restent verrouillées.
 * 2. Configuration réelle : Sveltia démarre en français et propose seulement la
 *    connexion par jeton GitHub, sans erreur ni violation de CSP.
 * 3. Backend de test (configuration interceptée, `test-repo`) : les dix
 *    rubriques s'ouvrent, et l'envoi d'une photo de téléphone de 4032 × 3024
 *    produit un WebP d'au plus 2048 px, rangé dans /src/assets/photos. C'est la
 *    chaîne la plus fragile : l'encodeur WebAssembly est chargé depuis unpkg et
 *    dépend de la CSP de /admin.
 *
 * Prérequis : `npm run serve:prod` dans un autre terminal, ou en une commande :
 *   node scripts/apache.mjs -- node scripts/audit-admin.mjs
 */
import puppeteer from 'puppeteer';
import sharp from 'sharp';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.BASE || 'http://localhost:4321';
const results = [];
const ok = (c, l) => results.push({ c, l });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- 1. En-têtes ------------------------------------------------------------------
const admin = await fetch(BASE + '/admin');
const publique = await fetch(BASE + '/');
ok(admin.ok, '/admin répond');
ok((admin.headers.get('content-security-policy') ?? '').includes("'wasm-unsafe-eval'"), '/admin : CSP propre, compatible avec la conversion des photos');
ok((admin.headers.get('x-robots-tag') ?? '').includes('noindex'), '/admin : exclue des moteurs de recherche');
ok(publique.headers.get('cross-origin-opener-policy') === 'same-origin', 'pages publiques : COOP toujours verrouillé');
for (const f of ['/admin/config.yml', '/admin/cms/sveltia-cms.js', '/admin/cms/chunks/react-dom.js']) {
  ok((await fetch(BASE + f)).ok, `${f} servi`);
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=fr-FR'] });

async function ouvrir({ test }) {
  const page = await browser.newPage();
  const incidents = [];
  page.on('console', (m) => m.type() === 'error' && incidents.push(m.text().slice(0, 160)));
  page.on('pageerror', (e) => incidents.push('pageerror: ' + String(e).slice(0, 160)));
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' });
    Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr'] });
    document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP bloque ${e.violatedDirective} : ${e.blockedURI}`));
  });
  if (test) {
    const reelle = await (await fetch(BASE + '/admin/config.yml')).text();
    const configTest = reelle.replace(/^backend:\n(?:  .*\n|\s*#.*\n)*/m, 'backend:\n  name: test-repo\n');
    await page.setRequestInterception(true);
    page.on('request', (r) => (r.url().includes('/admin/config.yml')
      ? r.respond({ status: 200, contentType: 'text/yaml', body: configTest })
      : r.continue()));
  }
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle2', timeout: 60000 });
  await wait(1500);
  return { page, incidents };
}
// Sveltia entoure les valeurs insérées dans ses libellés de caractères
// invisibles d'isolation bidirectionnelle (U+2066 à U+2069) : « Ajouter ⁨moto⁩ ».
// Sans les retirer, aucune recherche de texte ne correspond.
// Sveltia redirige vers ses propres routes juste après le chargement : une
// évaluation lancée à ce moment-là perd son cadre. On réessaie dans ce cas précis.
async function reessayer(action) {
  for (let essai = 0; essai < 5; essai++) {
    try {
      return await action();
    } catch (e) {
      if (!/detached|Execution context was destroyed|navigation/i.test(String(e))) throw e;
      await wait(700);
    }
  }
  return action();
}
const cliquer = (page, texte) => reessayer(() => cliquerUneFois(page, texte));
const cliquerUneFois = (page, texte) =>
  page.evaluate((cible) => {
    const norm = (v) => (v ?? '').replace(/[\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim();
    const trouves = [...document.querySelectorAll('body *')].filter((e) => norm(e.innerText) === cible);
    // L'élément le plus profond : c'est lui qui porte le libellé, le clic remonte.
    const el = trouves.find((e) => ![...e.children].some((c) => trouves.includes(c)));
    if (!el) return false;
    (el.closest('button, [role="button"], [role="row"], [role="option"], [role="link"], a') ?? el).click();
    return true;
  }, texte);
const texteDe = (page) =>
  reessayer(() => page.evaluate(() => document.body.innerText.replace(/[\u2066-\u2069]/g, '').replace(/\s+/g, ' ')));

// --- 2. Configuration réelle --------------------------------------------------------
{
  const { page, incidents } = await ouvrir({ test: false });
  const t = await texteDe(page);
  ok(t.includes('Two Old Wheels, administration'), 'écran de connexion au nom du site');
  ok(t.includes('Se connecter avec un jeton'), 'connexion par jeton proposée, interface en français');
  ok(!/Se connecter avec GitHub/.test(t), 'pas de bouton OAuth, qui demanderait un serveur de connexion');
  ok(incidents.length === 0, `aucune erreur au démarrage${incidents.length ? ' -> ' + incidents[0] : ''}`);
  await page.close();
}

// --- 3. Backend de test ------------------------------------------------------------------
{
  const { page, incidents } = await ouvrir({ test: true });
  ok(await cliquer(page, 'Travailler avec un dépôt de test'), 'entrée dans l\'administration (dépôt de test)');
  await wait(2500);

  const rubriques = ['Motos à vendre', 'Galerie photos', 'Prestations', 'Questions fréquentes', "Page d'accueil",
    'Page Réparation', 'Page Vente', 'Page Galerie', 'Page Contact', 'Coordonnées et horaires'];
  const menu = await texteDe(page);
  ok(rubriques.every((r) => menu.includes(r)), 'les dix rubriques sont listées');

  // Chaque rubrique s'ouvre sur son formulaire.
  const repere = {
    'Motos à vendre': 'Ajouter', 'Galerie photos': 'Ajouter', Prestations: 'Ajouter', 'Questions fréquentes': 'Ajouter',
    "Page d'accueil": 'En haut de page', 'Page Réparation': 'Grand titre', 'Page Vente': 'Encarts sous les motos',
    'Page Galerie': 'Grand titre', 'Page Contact': 'Bloc Téléphone et adresse', 'Coordonnées et horaires': "Horaires d'ouverture",
  };
  for (const rubrique of rubriques) {
    await page.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
    await wait(1200);
    await cliquer(page, rubrique);
    await wait(1500);
    ok((await texteDe(page)).includes(repere[rubrique]), `« ${rubrique} » s'ouvre sur son formulaire`);
  }

  // Envoi d'une photo de téléphone dans Motos à vendre.
  const dossier = await mkdtemp(join(tmpdir(), 'audit-admin-'));
  const photo = join(dossier, 'Photo telephone IMG_4521.jpg');
  await sharp({ create: { width: 4032, height: 3024, channels: 3, background: { r: 180, g: 90, b: 40 } } })
    .jpeg({ quality: 92 }).toFile(photo);

  await page.goto(BASE + '/admin', { waitUntil: 'networkidle2' });
  await wait(1200);
  await cliquer(page, 'Motos à vendre');
  await wait(1500);
  ok(await cliquer(page, 'Ajouter moto'), 'bouton « Ajouter moto » trouvé');
  await wait(1200);
  // Le champ d'envoi de la fiche moto qui vient d'être ajoutée, pas celui de la
  // bibliothèque de médias.
  const [champ] = await page.$$('input[type=file][accept*="image"]');
  ok(Boolean(champ), 'champ d\'envoi de photo présent');
  if (champ) {
    await champ.uploadFile(photo);
    let chemin = null;
    for (let i = 0; i < 30 && !chemin; i++) {
      await wait(500);
      chemin = (await texteDe(page)).match(/\/src\/assets\/photos\/[\w-]+\.\w+/)?.[0] ?? null;
    }
    ok(chemin?.endsWith('.webp'), `photo convertie en WebP (${chemin})`);
    ok(chemin === '/src/assets/photos/photo-telephone-img_4521.webp', 'nom de fichier nettoyé, rangée dans /src/assets/photos');
    const largeur = await page.evaluate(() => Math.max(0, ...[...document.images].filter((i) => i.src.startsWith('blob:')).map((i) => i.naturalWidth)));
    ok(largeur > 0 && largeur <= 2048, `photo réduite avant l'envoi : ${largeur} px de large au lieu de 4032`);
  }
  await rm(dossier, { recursive: true, force: true });
  ok(incidents.length === 0, `aucune erreur ni violation de CSP${incidents.length ? ' -> ' + incidents[0] : ''}`);
  await page.close();
}

await browser.close();
for (const r of results) console.log(`  ${r.c ? 'ok   ' : 'ÉCHEC'} ${r.l}`);
const failed = results.filter((r) => !r.c).length;
console.log(`\n${results.length - failed}/${results.length} réussis`);
process.exit(failed ? 1 : 0);
