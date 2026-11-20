TabSlice Drop-Ordner (scores/)
==============================

Lege beliebige Guitar-Pro-Dateien (.gp, .gp3, .gp4, .gp5, .gpx, .gp7, .gp8),
MusicXML (.xml, .musicxml, .mxl), Capella (.cap) oder alphaTex (.tex) in diesen Ordner.

Jede Datei wird automatisch erkannt und bekommt einen oeffentlichen UUID-Link:

  scores/mein-riff.gp5  ->  /slices/6f1c2f7e-8a4b-4c2d-9e10-3b5a7c9d1e2f

Die Zuordnung Dateiname -> UUID steht in data/slices/folder-ids.json und bleibt
stabil, solange diese Datei erhalten bleibt. Die Links erscheinen in der
Admin-Bibliothek unter /admin (Anmeldung mit ADMIN_PASSWORD).

Oeffentliche Links brauchen keine Anmeldung. Sie sind nicht erratbar, aber auch
nicht oeffentlich gelistet: Wer den Link kennt, kann den Slice abspielen.

Alternativ kannst du Dateien auch direkt im Browser ueber "Slice erstellen"
hochladen (nur als Admin).
