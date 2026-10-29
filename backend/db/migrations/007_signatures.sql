-- Signatures manuscrites (T6a) : des tampons image comme les autres
-- (tracées, saisies ou importées, toujours réencodées en PNG par le
-- serveur), rangées à part dans l'interface. `kind` les distingue ; les
-- tampons d'avant restent des tampons.
ALTER TABLE stamps ADD COLUMN kind TEXT NOT NULL DEFAULT 'stamp'
	CHECK (kind IN ('stamp', 'signature'));
