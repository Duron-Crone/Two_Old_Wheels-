#!/usr/bin/env node
/**
 * Contrôle de l'administration (public/admin/config.yml), sans GitHub ni
 * navigateur.
 *
 * 1. La configuration est validée contre le schéma JSON livré avec Sveltia CMS.
 * 2. Chaque fichier de contenu est confronté, champ par champ, à sa rubrique :
 *    - une clé présente dans le fichier mais absente de la configuration serait
 *      effacée au premier enregistrement depuis l'administration ;
 *    - un champ obligatoire absent ferait échouer le build ;
 *    - une photo doit exister dans le dossier des médias ;
 *    - une valeur de liste de choix doit faire partie des options.
 * 3. Les valeurs à renseigner avant la mise en ligne (`A_RENSEIGNER`) sont
 *    signalées. Avec --production, elles font échouer le contrôle.
 *
 * Option --ordonner : réécrit les fichiers de contenu dans l'ordre des champs
 * de la configuration, pour que le premier enregistrement depuis
 * l'administration ne produise pas un changement de pure forme.
 *
 *   node scripts/check-cms.mjs [--production] [--ordonner]
 */
import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, stringify } from 'yaml';
import Ajv from 'ajv';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const production = process.argv.includes('--production');
const ordonner = process.argv.includes('--ordonner');

const erreurs = [];
const alertes = [];
let controles = 0;
const ok = (cond, message, liste = erreurs) => { controles++; if (!cond) liste.push(message); };

const configTexte = await readFile(join(ROOT, 'public/admin/config.yml'), 'utf8');
const config = parse(configTexte);

// --- 1. Schéma officiel --------------------------------------------------------
const schema = JSON.parse(await readFile(join(ROOT, 'node_modules/@sveltia/cms/schema/sveltia-cms.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
// Formats décrits par le schéma mais sans intérêt ici : déclarés pour éviter
// qu'Ajv ne les signale à chaque lancement.
ajv.addFormat('regex', true);
ajv.addFormat('uri', true);
const valider = ajv.compile(schema);
const valide = valider(config);
ok(valide, 'configuration non conforme au schéma Sveltia :\n' +
  (valider.errors ?? []).slice(0, 8).map((e) => `     ${e.instancePath || '/'} ${e.message}`).join('\n'));

// --- 2. Contenus -------------------------------------------------------------------
const mediaFolder = config.media_folder.replace(/^\//, '');
const publicFolder = config.public_folder;

function comparer(champs, donnees, chemin) {
  const declares = new Set(champs.map((c) => c.name));
  for (const cle of Object.keys(donnees ?? {})) {
    ok(declares.has(cle), `${chemin}.${cle} : présent dans le fichier mais absent de config.yml (serait effacé à l'enregistrement)`);
  }
  for (const champ of champs) verifierChamp(champ, donnees?.[champ.name], `${chemin}.${champ.name}`);
}

const photos = [];
function verifierChamp(champ, valeur, chemin) {
  const requis = champ.required !== false;
  const absent = valeur === undefined || valeur === null || valeur === '';
  const widget = champ.widget ?? 'string';

  if (absent) {
    // Une liste vide est légitime (plus de motos en vente, pas d'horaires).
    if (widget === 'list') return;
    ok(!requis, `${chemin} : champ obligatoire vide ou absent`);
    return;
  }

  switch (widget) {
    case 'object':
      ok(typeof valeur === 'object' && !Array.isArray(valeur), `${chemin} : un objet est attendu`);
      comparer(champ.fields, valeur, chemin);
      break;
    case 'list':
      ok(Array.isArray(valeur), `${chemin} : une liste est attendue`);
      if (champ.min !== undefined) ok(valeur.length >= champ.min, `${chemin} : au moins ${champ.min} élément(s)`);
      if (champ.max !== undefined) ok(valeur.length <= champ.max, `${chemin} : au plus ${champ.max} élément(s)`);
      valeur.forEach((item, i) => {
        if (champ.fields) comparer(champ.fields, item, `${chemin}[${i}]`);
        else if (champ.field) verifierChamp(champ.field, item, `${chemin}[${i}]`);
      });
      break;
    case 'image':
      ok(typeof valeur === 'string' && valeur.startsWith(publicFolder + '/'), `${chemin} : chemin de photo hors de ${publicFolder}`);
      photos.push({ chemin, fichier: join(ROOT, mediaFolder, valeur.slice(publicFolder.length + 1)) });
      break;
    case 'select': {
      const options = champ.options.map((o) => (typeof o === 'object' ? o.value : o));
      const valeurs = champ.multiple ? valeur : [valeur];
      ok(Array.isArray(valeurs), `${chemin} : une liste de choix est attendue`);
      for (const v of valeurs) ok(options.includes(v), `${chemin} : « ${v} » ne fait pas partie des choix proposés`);
      break;
    }
    case 'boolean':
      ok(typeof valeur === 'boolean', `${chemin} : vrai ou faux attendu`);
      break;
    default: {
      ok(typeof valeur === 'string', `${chemin} : texte attendu`);
      if (typeof valeur !== 'string') break;
      if (champ.pattern) ok(new RegExp(champ.pattern[0]).test(valeur), `${chemin} : « ${valeur} » refusé par le formulaire (${champ.pattern[1]})`);
      if (champ.maxlength) ok(valeur.length <= champ.maxlength, `${chemin} : ${valeur.length} caractères, le formulaire en autorise ${champ.maxlength}`, alertes);
      if (champ.minlength) ok(valeur.length >= champ.minlength, `${chemin} : ${valeur.length} caractères, le formulaire en demande ${champ.minlength}`, alertes);
    }
  }
}

/** Recopie les données dans l'ordre des champs, sans rien perdre. */
function reordonner(champs, donnees) {
  if (Array.isArray(donnees)) return donnees;
  const out = {};
  for (const champ of champs) {
    if (!(champ.name in (donnees ?? {}))) continue;
    const v = donnees[champ.name];
    if (champ.widget === 'object') out[champ.name] = reordonner(champ.fields, v);
    else if (champ.widget === 'list' && champ.fields) out[champ.name] = v.map((item) => reordonner(champ.fields, item));
    else out[champ.name] = v;
  }
  for (const [k, v] of Object.entries(donnees ?? {})) if (!(k in out)) out[k] = v;
  return out;
}

const fichiers = (config.singletons ?? []).filter((s) => s.file);
for (const rubrique of fichiers) {
  const chemin = join(ROOT, rubrique.file);
  let donnees;
  try {
    donnees = parse(await readFile(chemin, 'utf8'));
  } catch (e) {
    ok(false, `${rubrique.file} : illisible (${e.message})`);
    continue;
  }
  comparer(rubrique.fields, donnees, rubrique.file);
  if (ordonner) await writeFile(chemin, stringify(reordonner(rubrique.fields, donnees), { lineWidth: 0 }));
}

// Toutes les collections Astro doivent avoir leur rubrique, et inversement.
const configAstro = await readFile(join(ROOT, 'src/content.config.ts'), 'utf8');
const fichiersAstro = [...configAstro.matchAll(/fichier\('([^']+)'\)/g)].map((m) => `src/content/${m[1]}.yml`);
for (const f of fichiersAstro) ok(fichiers.some((r) => r.file === f), `${f} : collection Astro sans rubrique dans l'administration`);
for (const r of fichiers) ok(fichiersAstro.includes(r.file), `${r.file} : rubrique sans collection Astro`);

for (const { chemin, fichier } of photos) {
  try { await access(fichier); controles++; } catch { erreurs.push(`${chemin} : photo introuvable (${fichier.replace(ROOT, '')})`); }
}

// --- 3. Valeurs à renseigner --------------------------------------------------------
const aRenseigner = configTexte.split('\n').filter((l) => /A_RENSEIGNER/.test(l) && !/^\s*#/.test(l));
for (const l of aRenseigner) (production ? erreurs : alertes).push(`config.yml : à renseigner avant la mise en ligne -> ${l.trim()}`);

console.log(`${controles} contrôles, ${fichiers.length} rubriques, ${photos.length} photos référencées`);
if (ordonner) console.log('Fichiers de contenu réécrits dans l\'ordre de la configuration.');
for (const a of alertes) console.log(`  alerte  ${a}`);
for (const e of erreurs) console.log(`  ERREUR  ${e}`);
console.log(erreurs.length ? `\n${erreurs.length} erreur(s)` : '\nAucune erreur.');
process.exit(erreurs.length ? 1 : 0);
