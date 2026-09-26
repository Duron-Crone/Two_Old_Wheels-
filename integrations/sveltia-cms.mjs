/**
 * Héberge Sveltia CMS sur le site, sous /admin/cms/.
 *
 * Au build, copie le script et ses morceaux chargés à la demande depuis
 * node_modules/@sveltia/cms/dist vers dist/admin/cms. En développement, sert
 * les mêmes fichiers à la volée : l'administration fonctionne aussi avec
 * `npm run dev`, ce qu'exige le mode « dépôt local » de Sveltia.
 *
 * Ni les cartes de sources (.map, 14 Mo) ni la version module (.mjs) ne sont
 * copiées ni servies.
 */
import { cp, readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
// Le paquet n'exporte pas son package.json : on part de son point d'entrée,
// qui se trouve lui-même dans dist/.
const SOURCE = dirname(require.resolve('@sveltia/cms'));
const PREFIXE = '/admin/cms/';

// Seule la version script classique est chargée par admin/index.html : la
// version module (.mjs) et les cartes de sources (.map) ne sont pas publiées.
const servable = (chemin) => !chemin.endsWith('.map') && !chemin.endsWith('.mjs');

export default function sveltiaCms() {
  return {
    name: 'sveltia-cms',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'sveltia-cms-dev',
                configureServer(server) {
                  server.middlewares.use(async (req, res, next) => {
                    const url = (req.url ?? '').split('?')[0];
                    if (!url.startsWith(PREFIXE)) return next();
                    const relatif = normalize(url.slice(PREFIXE.length));
                    const fichier = join(SOURCE, relatif);
                    if (!fichier.startsWith(SOURCE + sep) || !servable(fichier)) return next();
                    try {
                      if (!(await stat(fichier)).isFile()) return next();
                      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
                      res.end(await readFile(fichier));
                    } catch {
                      next();
                    }
                  });
                },
              },
            ],
          },
        });
      },
      'astro:build:done': async ({ dir, logger }) => {
        const destination = join(fileURLToPath(dir), 'admin', 'cms');
        await cp(SOURCE, destination, { recursive: true, filter: servable });
        logger.info(`Sveltia CMS copié dans ${destination}`);
      },
    },
  };
}
