# site-glyphloom

The site of Glyphloom, the character-art studio of CommandAGI (`org-glyphloom`). A static folder served by CommandAGI's
site hosting; mounted in the CommandAGI repository at `seed/drive/platform/org-glyphloom/sites/glyphloom`.

- `index.html` + `studio.js`: the studio. It reads an image, a video or a line of text on the device and sends nothing
  (`connect-src 'none'`). Presets (`presets.js`): Glyphloom's, and the person's own kept in the browser only.
- `gallery.html` + `gallery.js`: each preset drawn live on the sample picture (`samples.js`).
- `glyphloom.js`: the renderer, pure, for a browser and Node. It is a copy of `packages/domain/world/character-art.js`
  in the CommandAGI repository, byte for byte (its test there holds them equal): change it there, then copy it here.
  Tests: `node --test tests/render.test.mjs`.
- `team.html`, `team-*.html`, `people/`: made by `node scripts/seed/people/personas.mjs` in the CommandAGI repository
  from the personas' profiles. The team are disclosed AI agents.
