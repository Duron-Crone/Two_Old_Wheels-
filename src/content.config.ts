/**
 * Schémas des contenus éditables depuis l'administration (/admin).
 *
 * Chaque fichier de src/content/ est une collection à une seule entrée : c'est
 * le modèle de Sveltia CMS (un fichier = un formulaire), et c'est ce qui permet
 * de réordonner les listes par glisser-déposer.
 *
 * Principe de validation : un build qui échoue empêche la modification d'être
 * publiée, sans que Guillaume voie pourquoi depuis l'administration. On ne
 * rejette donc ici que ce qui casserait réellement le site (photo introuvable,
 * champ indispensable vide). Les limites de confort (longueur d'un titre pour
 * Google…) sont posées dans le formulaire (public/admin/config.yml), où elles
 * s'affichent au moment de la saisie.
 *
 * Toute modification ici doit être reportée dans public/admin/config.yml :
 * `npm run check:cms` vérifie que les deux restent alignés.
 */
import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const fichier = (nom: string) => glob({ pattern: `${nom}.yml`, base: './src/content' });

const texte = z.string().trim().min(1);
const texteLibre = z.string().trim().default('');
const referencement = z.object({ titre: texte, description: texte });

export const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;
const heure = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'heure attendue au format 09:00');

const reglages = defineCollection({
  loader: fichier('reglages'),
  schema: z.object({
    telephone: texte,
    email: z.union([z.string().trim().email(), z.literal('')]).default(''),
    horaires: z
      .array(z.object({ jours: z.array(z.enum(JOURS)).min(1), ouverture: heure, fermeture: heure }))
      .default([]),
    instagram: z.union([z.string().url(), z.literal('')]).default(''),
    facebook: z.union([z.string().url(), z.literal('')]).default(''),
    accroche: texte,
    presentation: texte,
  }),
});

const pageAccueil = defineCollection({
  loader: fichier('page-accueil'),
  schema: ({ image }) =>
    z.object({
      referencement,
      hero: z.object({ titre: texte, texte, photo: image(), photo_description: texte, legende: texteLibre }),
      atelier: z.object({
        titre: texte,
        paragraphes: z.array(texte).min(1),
        photo: image(),
        photo_description: texte,
        legende: texteLibre,
      }),
      prestations: z.object({ titre: texte }),
      vente: z.object({ titre: texte, texte, photo: image(), photo_description: texte, legende: texteLibre }),
      galerie: z.object({ titre: texte }),
      faq: z.object({ titre: texte }),
      appel: z.object({ titre: texte, texte }),
    }),
});

const pageReparation = defineCollection({
  loader: fichier('page-reparation'),
  schema: z.object({ referencement, titre: texte, texte, appel: z.object({ titre: texte, texte }) }),
});

const pageVente = defineCollection({
  loader: fichier('page-vente'),
  schema: z.object({
    referencement,
    titre: texte,
    texte,
    encarts: z.array(z.object({ titre: texte, texte })).default([]),
    appel: z.object({ titre: texte }),
  }),
});

const pageGalerie = defineCollection({
  loader: fichier('page-galerie'),
  schema: z.object({ referencement, titre: texte, texte }),
});

const pageContact = defineCollection({
  loader: fichier('page-contact'),
  schema: z.object({
    referencement,
    titre: texte,
    texte,
    telephone: z.object({ titre: texte, consigne: texteLibre }),
    reseaux: z.object({ titre: texte, texte }),
  }),
});

const prestations = defineCollection({
  loader: fichier('prestations'),
  schema: ({ image }) =>
    z.object({
      prestations: z.array(z.object({ titre: texte, texte, photo: image(), photo_description: texte })).default([]),
    }),
});

const galerie = defineCollection({
  loader: fichier('galerie'),
  schema: ({ image }) =>
    z.object({
      photos: z.array(z.object({ photo: image(), description: texte, categorie: texte })).default([]),
    }),
});

const motos = defineCollection({
  loader: fichier('motos'),
  schema: ({ image }) =>
    z.object({
      motos: z
        .array(
          z.object({
            titre: texteLibre,
            photo: image(),
            description: texte,
            prix: texteLibre,
            vendue: z.boolean().default(false),
          }),
        )
        .default([]),
    }),
});

const faq = defineCollection({
  loader: fichier('faq'),
  schema: z.object({ questions: z.array(z.object({ question: texte, reponse: texte })).default([]) }),
});

export const collections = {
  reglages,
  pageAccueil,
  pageReparation,
  pageVente,
  pageGalerie,
  pageContact,
  prestations,
  galerie,
  motos,
  faq,
};
