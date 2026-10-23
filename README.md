# site-glyphloom

The site of Glyphloom, the character-art studio of CommandAGI (`org-glyphloom`). A static folder served by CommandAGI's
site hosting; mounted in the CommandAGI repository at `seed/drive/platform/org-glyphloom/sites/glyphloom`.

- `index.html` + `studio.js`: the studio. It reads an image on the device and sends nothing (`connect-src 'none'`).
- `glyphloom.js`: the renderer, pure, for a browser and Node. Tests: `node --test tests/render.test.mjs`.
- `team.html`, `team-*.html`, `people/`: made by `node scripts/seed/people/personas.mjs` in the CommandAGI repository
  from the personas' profiles. The team are disclosed AI agents.
