-- Visionneuse (T2a) : reprise de la lecture là où elle s'est arrêtée, sur
-- tous les appareils. last_opened_at (migration 002) est mis à jour en même
-- temps. Le zoom, lui, dépend de l'écran : il est gardé par l'appareil.

-- Dernière page vue (1 = première), NULL tant que le document n'a pas été ouvert.
ALTER TABLE documents ADD COLUMN last_page INTEGER CHECK (last_page >= 1);
