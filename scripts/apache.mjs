#!/usr/bin/env node
/**
 * Recette sur un vrai Apache, le serveur de l'hébergement OVH.
 *
 * Le site de production dépend de `public/.htaccess` : en-têtes de sécurité,
 * redirections de l'ancien site, forme des URL. Une erreur dans ce fichier
 * donne une erreur 500 sur tout le site, et aucun serveur Node ne l'imite
 * fidèlement. On lance donc Apache lui-même, sur `dist/`, avec les mêmes
 * autorisations qu'un hébergement mutualisé (.htaccess pris en compte).
 *
 * Apache n'a pas besoin d'être installé : au premier lancement, le script
 * télécharge les paquets Ubuntu 24.04 (Apache 2.4 et ses bibliothèques), vérifie
 * leur empreinte SHA-256 et les décompresse dans `.apache/`. Rien n'est installé
 * sur le système, aucun droit administrateur n'est demandé.
 *
 *   node scripts/apache.mjs                      sert dist/ jusqu'à Ctrl+C
 *   node scripts/apache.mjs -- <commande...>     lance la commande contre Apache,
 *                                                puis l'arrête (code de sortie
 *                                                de la commande)
 *
 * Variables d'environnement :
 *   PORT                 port d'écoute (4321 par défaut)
 *   APACHE_BIN           Apache déjà installé, à utiliser à la place du
 *   APACHE_MODULES       téléchargement (hors Linux x86-64 notamment)
 *   APACHE_MIME_TYPES
 */
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');
const CACHE = join(ROOT, '.apache');
const PORT = Number(process.env.PORT || 4321);
// Un dossier de travail par port : plusieurs recettes peuvent tourner en même temps
// sans se disputer le fichier de configuration, le pid et les verrous d'Apache.
const RUN = join(CACHE, `recette-${PORT}`);

// Versions publiées avec Ubuntu 24.04 (poche « release ») : elles restent sur
// l'archive pendant tout le support de la version, puis sur old-releases.
const MIROIRS = ['https://archive.ubuntu.com/ubuntu/pool/main/', 'https://old-releases.ubuntu.com/ubuntu/pool/main/'];
const PAQUETS = [
  ['a/apache2/apache2-bin_2.4.58-1ubuntu8_amd64.deb', 'd5fd0b8dc83d577904fcb5c7abe5e81f8a4ee3dc654d6f0cbb3df9307b18585c'],
  ['a/apr/libapr1t64_1.7.2-3.1build2_amd64.deb', '1d22ef36b1d1579bd1c3493b7792802de3c7a0639b9010b7756ccced19e8dd1e'],
  ['a/apr-util/libaprutil1t64_1.6.3-1.1ubuntu7_amd64.deb', 'd4510328b81de66ddc742b7d9f80bc4232f2e18f0e2441478bf24b7c6a7bb6fe'],
  ['libx/libxcrypt/libcrypt1_4.4.36-4build1_amd64.deb', '9474785cd6f398512bf8c305c3901dbb111569dccb6f5832002373c0a8ac5832'],
  ['m/media-types/media-types_10.1.0_all.deb', '31bfb7eec55ab6d34a50ba995150e1498d4cb897714085d8025e330d3b529747'],
];

const MODULES = ['mpm_event', 'authz_core', 'dir', 'mime', 'rewrite', 'headers', 'filter', 'deflate'];

/** Extrait `data.tar.*` d'un paquet .deb (archive `ar`) et le décompresse. */
function extraireDeb(contenu, destination) {
  let pos = 8; // signature « !<arch>\n »
  while (pos < contenu.length) {
    const nom = contenu.toString('latin1', pos, pos + 16).trim().replace(/\/$/, '');
    const taille = Number(contenu.toString('latin1', pos + 48, pos + 58).trim());
    const debut = pos + 60;
    if (nom.startsWith('data.tar')) {
      const archive = join(CACHE, nom);
      writeFileSync(archive, contenu.subarray(debut, debut + taille));
      execFileSync('tar', ['-xf', archive, '-C', destination]);
      rmSync(archive);
      return;
    }
    pos = debut + taille + (taille % 2);
  }
  throw new Error('paquet sans data.tar');
}

async function telecharger([chemin, empreinte]) {
  for (const miroir of MIROIRS) {
    const reponse = await fetch(miroir + chemin).catch(() => null);
    if (!reponse?.ok) continue;
    const contenu = Buffer.from(await reponse.arrayBuffer());
    const calculee = createHash('sha256').update(contenu).digest('hex');
    if (calculee !== empreinte) throw new Error(`empreinte inattendue pour ${chemin}`);
    return contenu;
  }
  throw new Error(`téléchargement impossible : ${chemin}`);
}

async function localiserApache() {
  if (process.env.APACHE_BIN) {
    return {
      bin: process.env.APACHE_BIN,
      modules: process.env.APACHE_MODULES ?? '/usr/lib/apache2/modules',
      mimeTypes: process.env.APACHE_MIME_TYPES ?? '/etc/mime.types',
      env: process.env,
    };
  }
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new Error('téléchargement prévu pour Linux x86-64 : renseigner APACHE_BIN, APACHE_MODULES et APACHE_MIME_TYPES');
  }

  const temoin = join(CACHE, 'paquets.txt');
  const attendu = PAQUETS.map(([, empreinte]) => empreinte).join('\n');
  if (!existsSync(temoin) || readFileSync(temoin, 'utf8') !== attendu) {
    console.log('Premier lancement : téléchargement d\'Apache (environ 2 Mo)...');
    rmSync(CACHE, { recursive: true, force: true });
    mkdirSync(CACHE, { recursive: true });
    for (const paquet of PAQUETS) extraireDeb(await telecharger(paquet), CACHE);
    writeFileSync(temoin, attendu);
  }

  return {
    bin: join(CACHE, 'usr/sbin/apache2'),
    modules: join(CACHE, 'usr/lib/apache2/modules'),
    mimeTypes: join(CACHE, 'etc/mime.types'),
    env: { ...process.env, LD_LIBRARY_PATH: join(CACHE, 'usr/lib/x86_64-linux-gnu') },
  };
}

function configuration({ modules, mimeTypes }, journaux) {
  return `ServerRoot "${RUN}"
ServerName localhost
Listen 127.0.0.1:${PORT}
PidFile "${RUN}/httpd.pid"
Mutex "file:${RUN}" default
${MODULES.map((m) => `LoadModule ${m}_module "${modules}/mod_${m}.so"`).join('\n')}

StartServers 1
ThreadsPerChild 25
MaxRequestWorkers 25

TypesConfig "${mimeTypes}"
ErrorLog "${journaux.erreurs}"
LogLevel warn
LogFormat "%>s %r" recette
CustomLog "${journaux.acces}" recette

DocumentRoot "${DIST}"
<Directory />
  AllowOverride None
  Require all denied
</Directory>
<Directory "${DIST}">
  AllowOverride All
  Require all granted
</Directory>
`;
}

const separateur = process.argv.indexOf('--');
const commande = separateur === -1 ? [] : process.argv.slice(separateur + 1);
const interactif = commande.length === 0;

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ est vide : lancer `npm run build` d\'abord.');
  process.exit(1);
}

// Un serveur oublié sur le port (npm run dev, une recette précédente) répondrait
// à la place d'Apache : la recette testerait alors autre chose.
const adresse = `http://localhost:${PORT}`;
if (await fetch(adresse + '/', { redirect: 'manual' }).then(() => true, () => false)) {
  console.error(`Le port ${PORT} est déjà utilisé : arrêter l'autre serveur ou choisir PORT=...`);
  process.exit(1);
}

const apache = await localiserApache();
mkdirSync(RUN, { recursive: true });
const journaux = interactif
  ? { erreurs: '/dev/stderr', acces: '/dev/stdout' }
  : { erreurs: join(RUN, 'erreurs.log'), acces: join(RUN, 'acces.log') };
for (const f of Object.values(journaux)) if (!f.startsWith('/dev/')) rmSync(f, { force: true });
writeFileSync(join(RUN, 'httpd.conf'), configuration(apache, journaux));

const serveur = spawn(apache.bin, ['-f', join(RUN, 'httpd.conf'), '-D', 'FOREGROUND'], {
  env: apache.env,
  stdio: 'inherit',
});
let arrete = false;
serveur.on('exit', (code) => {
  if (!arrete) {
    console.error(`Apache s'est arrêté (code ${code}).`);
    process.exit(1);
  }
});

// Attend qu'Apache réponde avant de lancer quoi que ce soit.
for (let essai = 0; ; essai++) {
  if (await fetch(adresse + '/', { redirect: 'manual' }).then(() => true, () => false)) break;
  if (essai > 100) {
    console.error('Apache ne répond pas.');
    serveur.kill();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 100));
}

const arreter = () => {
  arrete = true;
  serveur.kill('SIGTERM');
};

if (interactif) {
  console.log(`\n  Recette Two Old Wheels sur Apache  ->  ${adresse}`);
  console.log('  public/.htaccess appliqué comme chez OVH. Ctrl+C pour arrêter.\n');
  process.on('SIGINT', arreter);
  process.on('SIGTERM', arreter);
} else {
  const execution = spawn(commande[0], commande.slice(1), { stdio: 'inherit', env: { ...process.env, BASE: adresse } });
  const code = await new Promise((r) => execution.on('exit', (c) => r(c ?? 1)));
  arreter();

  // Une directive refusée dans un .htaccess ne fait pas tomber Apache : elle
  // donne une 500 sur les pages concernées et une ligne dans le journal.
  const erreurs = existsSync(journaux.erreurs) ? readFileSync(journaux.erreurs, 'utf8') : '';
  const problemes = erreurs.split('\n').filter((l) => /\[core:alert\]|\.htaccess:/.test(l));
  if (problemes.length) {
    console.error('\nJournal d\'erreurs Apache :');
    for (const l of problemes) console.error('  !!', l);
    process.exit(1);
  }
  process.exit(code);
}
