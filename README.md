# Portfolio Website

A responsive portfolio website with a dark theme, left-side navigation, fixed per-page GIF-to-colored-ASCII backgrounds, and editable placeholder content. Built with plain HTML, CSS, and JavaScript; there is no build step or package installation.

## Run it

Open `index.html` in a browser. The site works as a standalone static website with no local server required.

## Pages

- `index.html` is the home page. The top-left wordmark links here.
- `projects.html` has a Projects landing hero followed by five sticky, viewport-height case studies. Each case study has title, photo, aims, methods, and technologies placeholders; the photo wells are ready to replace with project images. The photos shift subtly with scroll, and the Projects submenu links to each section.
- `about.html` has an About me title and biography followed by Experience, Education, Certifications, and Interests. Experience lists five roles with logo and short-description placeholders; Education has three entries with logo, level, and subject/grade placeholders.
- `contact.html` contains the Contact section.

## Customize

- Replace the “Insert info here” text and placeholder email in the relevant page.
- Replace project placeholders and photo wells in `projects.html`; keep the five `project-N` IDs to preserve submenu jump links.
- Adjust colors, type, and layout in `styles.css`. JetBrains Mono loads from Google Fonts; local monospace fallbacks keep the layout readable offline.
- Each page sets its desktop background in `<body data-ascii-gif="...">`. The Home page also supports an optional `data-ascii-gif-mobile` path; it is blank until a separate mobile asset is provided. The current GIF is bundled at `assets/black-hole.gif`. Visitors do not upload anything.
- GIF frames are sampled into colored ASCII, mirrored horizontally, and fitted without cropping. `script.js` uses `ImageDecoder` to advance at encoded frame delays; with reduced motion enabled, it displays one frame.
- The project submenu and footer year are also handled in `script.js`.
- Project preview panels are composed from HTML and CSS, so no image assets need replacing.
