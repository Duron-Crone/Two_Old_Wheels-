#!/usr/bin/env node
/**
 * Photographie le contenu rendu de chaque page, à partir de dist/ : textes
 * visibles, données des balises <title> et <meta description>, liens, et pour
 * chaque image son texte alternatif et son fichier source (sans l'empreinte
 * ajoutée par Astro). Sert de filet quand on restructure les contenus : deux
 * instantanés identiques garantissent que le visiteur voit le même site.
 *
 *   node scripts/snapshot-contenu.mjs > avant.json
 *   node scripts/snapshot-contenu.mjs > apres.json
 *   node scripts/snapshot-contenu.mjs --compare avant.json apres.json
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const PAGES = ['index.html', 'reparation.html', 'vente.html', 'galerie-photos.html', 'contact.html', 'mentions-legales.html', '404.html'];

const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
// `partie-cycle-bobber.1C54bXe__Zi3R6P.webp` -> `partie-cycle-bobber`
const sourceName = (url) => url.split('/').pop().split('.')[0];

async function snapshot() {
  const out = {};
  for (const f of PAGES) {
    const html = await readFile(join(DIST, f), 'utf8');
    const body = html.slice(html.indexOf('<body'));
    const text = decode(
      body.replace(/<(script|style|template)\b[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' '),
    ).replace(/\s+/g, ' ').trim();
    out[f] = {
      title: decode(html.match(/<title>(.*?)<\/title>/s)[1]),
      description: decode(html.match(/<meta name="description" content="([^"]*)"/)?.[1] ?? ''),
      texte: text,
      images: [...body.matchAll(/<img\b[^>]*>/g)].map((m) => {
        const t = m[0];
        return `${sourceName(t.match(/\ssrc="([^"]+)"/)?.[1] ?? '')} | ${decode(t.match(/\salt="([^"]*)"/)?.[1] ?? '')}`;
      }),
      liens: [...body.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)].map((m) => (m[1].startsWith('/_astro/') ? `zoom:${sourceName(m[1])}` : decode(m[1]))),
      jsonld: [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1].replace(/\\u003c/g, '<'))),
    };
  }
  return out;
}

const args = process.argv.slice(2);
if (args[0] === '--compare') {
  const [a, b] = await Promise.all(args.slice(1).map(async (p) => JSON.parse(await readFile(p, 'utf8'))));
  let diffs = 0;
  for (const page of Object.keys(a)) {
    for (const key of ['title', 'description', 'texte', 'images', 'liens', 'jsonld']) {
      const va = JSON.stringify(a[page][key]);
      const vb = JSON.stringify(b[page]?.[key]);
      if (va === vb) continue;
      diffs++;
      console.log(`\n!! ${page} :: ${key}`);
      if (key === 'texte') {
        const wa = a[page][key].split(' '), wb = (b[page]?.[key] ?? '').split(' ');
        let i = 0; while (i < wa.length && wa[i] === wb[i]) i++;
        console.log('   avant :', wa.slice(Math.max(0, i - 8), i + 12).join(' '));
        console.log('   après :', wb.slice(Math.max(0, i - 8), i + 12).join(' '));
      } else {
        console.log('   avant :', va.slice(0, 400));
        console.log('   après :', (vb ?? 'absent').slice(0, 400));
      }
    }
  }
  console.log(diffs ? `\n${diffs} différence(s)` : 'Contenu identique sur toutes les pages.');
  process.exit(diffs ? 1 : 0);
} else {
  process.stdout.write(JSON.stringify(await snapshot(), null, 1));
}
