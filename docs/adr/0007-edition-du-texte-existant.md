# ADR 0007 : édition du texte existant

- **Date** : 2026-10-28
- **Statut** : proposé (à valider par PdfEngineExpert et DocsExplorer au début de T4)

## Contexte

Modifier un texte déjà présent dans un PDF est la fonctionnalité la plus difficile : un PDF ne contient pas de paragraphes, seulement des glyphes positionnés, souvent dans des **polices sous-ensembles** (seuls les caractères utilisés sont embarqués) ou sans table de correspondance Unicode. Même Acrobat le fait imparfaitement. C'est pourtant une priorité de Grégory.

## Décision (proposée)

- Approche « **retirer puis réécrire** », réalisée dans le navigateur avec MuPDF.js :
  1. MuPDF fournit le texte structuré de la page (blocs, lignes, caractères avec police, taille, couleur et position) : l'utilisateur sélectionne une ligne ou un bloc ;
  2. un éditeur en place (HTML) reprend le texte et son style approximatif ;
  3. à la validation, le texte d'origine est **retiré du contenu** par une annotation de caviardage ciblée, appliquée sans toucher aux images ni aux dessins ;
  4. le nouveau texte est écrit dans le contenu de la page, à la même position, avec la police d'origine si elle est complète et réutilisable, sinon avec la police embarquée la plus proche (Noto / polices Base-14), avec un avertissement.
- Ajouter un texte neuf dans le contenu (pas en annotation) utilise la même écriture (étape 4).
- Les blocs multi-lignes sont recomposés (retour à la ligne automatique dans le rectangle d'origine), sans prétendre refaire la mise en page du reste de la page.

## Conséquences

- Résultat fidèle pour les documents « simples » (courriers, formulaires, factures) ; dégradé quand les polices sont des sous-ensembles ou que le texte est très mis en forme.
- Il faudra vérifier dans la doc MuPDF.js à jour : les options d'`applyRedactions` qui préservent images et graphismes, l'écriture de texte dans le contenu d'une page et l'embarquement de polices.
- Si l'approche se révèle insuffisante, alternatives : modifier directement les opérateurs du flux de contenu (plus fidèle, beaucoup plus complexe), ou se limiter à « masquer + texte libre ». Nouvel ADR dans ce cas.
