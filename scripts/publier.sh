#!/bin/sh
# Publie le contenu de dist/ sur la branche `deploy`, que l'hébergement OVH suit.
#
#   sh scripts/publier.sh <adresse-du-depot> <message>
#
# Lancé par GitHub Actions (.github/workflows/publication.yml), après la recette.
#
# L'historique de `deploy` reste linéaire : OVH met à jour le dossier du site
# par un `git pull`, qui refuserait une branche réécrite. Chaque publication
# repart donc du dernier état publié et n'enregistre que la différence.
set -eu

DEPOT="$1"
MESSAGE="$2"
RACINE="$(cd "$(dirname "$0")/.." && pwd)"
PUBLICATION="$(mktemp -d)"
trap 'rm -rf "$PUBLICATION"' EXIT

git -C "$PUBLICATION" init -q -b deploy
git -C "$PUBLICATION" remote add origin "$DEPOT"
if git -C "$PUBLICATION" fetch -q --depth=1 origin deploy 2>/dev/null; then
  # HEAD pointe sur la dernière publication, l'index reste vide : le commit
  # contiendra exactement dist/, suppressions comprises.
  git -C "$PUBLICATION" reset -q --soft FETCH_HEAD
else
  echo "Première publication : création de la branche deploy."
fi

cp -a "$RACINE/dist/." "$PUBLICATION/"
git -C "$PUBLICATION" add -A
if git -C "$PUBLICATION" rev-parse -q --verify HEAD >/dev/null && git -C "$PUBLICATION" diff --cached --quiet; then
  echo "Site identique à la version en ligne : rien à publier."
  exit 0
fi

git -C "$PUBLICATION" -c user.name="github-actions[bot]" \
  -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
  commit -q -m "$MESSAGE"
git -C "$PUBLICATION" push -q origin deploy
echo "Publié sur la branche deploy : $(git -C "$PUBLICATION" rev-parse --short HEAD)"
