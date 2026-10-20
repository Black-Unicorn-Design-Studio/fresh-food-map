/**
 * Regenerates the Fresh Food Map icon set (assets/images/*): an "ffm"
 * monogram set in Fraunces Black, converted to vector paths with opentype.js
 * (no system font install needed) and rasterized with sharp.
 *
 * The two tools are not project dependencies — install them ad hoc:
 *   npm install --no-save opentype.js@1.3.4 sharp && node scripts/gen-icons.js
 */
const path = require('node:path');
const opentype = require('opentype.js');
const sharp = require('sharp');

const PROJECT = path.join(__dirname, '..');
const OUT = path.join(PROJECT, 'assets/images');
const FONT = path.join(
  PROJECT,
  'node_modules/@expo-google-fonts/fraunces/900Black/Fraunces_900Black.ttf'
);
/** The face the app's name is set in on screen — `Display.italic` in `theme.ts`. */
const FONT_ITALIC = path.join(
  PROJECT,
  'node_modules/@expo-google-fonts/fraunces/400Regular_Italic/Fraunces_400Regular_Italic.ttf'
);

// Brand tokens — keep in sync with src/constants/theme.ts.
const GREEN = '#2D5A27';
const CREAM = '#FAF6EF';
const MINT = '#E7F2E5';

// The sprout mark for the native map pin — the filter disc at pin size.
//
// THE ONE HAND-CARRIED COPY. src/constants/sprout.ts is the definition, and both the web map
// and the filter toggle import it; this file is plain JS run outside the app's module graph,
// so it cannot. Change the shape there and change it here, then rerun this script — a symbol
// layer takes a registered image and not a path, which is the whole reason a second copy
// exists at all.
const SPROUT = {
  stem: 'M12 21 V11',
  stemThickness: 2,
  leafLeft: 'M12 13 C7.2 13 4.5 9.8 4.5 5.5 C9.3 5.5 12 8.7 12 13 Z',
  leafRight: 'M12 10.5 C16.8 10.5 19.5 7.3 19.5 3 C14.7 3 12 6.2 12 10.5 Z',
};

const font = opentype.loadSync(FONT);
const fontItalic = opentype.loadSync(FONT_ITALIC);

/**
 * Any string as a centred path fragment, at a given width and baseline.
 *
 * `monogram` below is this with the string fixed and the box square; this exists because the
 * splash needs the app's actual name, and a name is not a monogram — it is wider than it is
 * tall, so it is placed by its own measured box rather than centred in the canvas.
 */
function words(face, str, targetWidth, centreX, baselineY, fill, letterSpacing = 0) {
  const size = 1000;
  const p = face.getPath(str, 0, 0, size, { letterSpacing });
  const b = p.getBoundingBox();
  const w = b.x2 - b.x1;
  const scale = targetWidth / w;
  const dx = centreX - (w * scale) / 2 - b.x1 * scale;
  return `<g transform="translate(${dx} ${baselineY}) scale(${scale})"><path d="${p.toPathData(3)}" fill="${fill}"/></g>`;
}

/** Centered "ffm" path SVG fragment for a given canvas + glyph width. */
function monogram(canvas, targetWidth, fill, letterSpacing = 0.02) {
  const size = 1000; // provisional font size; we scale from measured bounds
  const p = font.getPath('ffm', 0, 0, size, { letterSpacing });
  const b = p.getBoundingBox();
  const w = b.x2 - b.x1;
  const h = b.y2 - b.y1;
  const scale = targetWidth / w;
  const dx = (canvas - w * scale) / 2 - b.x1 * scale;
  const dy = (canvas - h * scale) / 2 - b.y1 * scale;
  const d = p.toPathData(3);
  return `<g transform="translate(${dx} ${dy}) scale(${scale})"><path d="${d}" fill="${fill}"/></g>`;
}

async function render(svg, file, resize) {
  let img = sharp(Buffer.from(svg));
  if (resize) img = img.resize(resize, resize);
  await img.png().toFile(path.join(OUT, file));
  console.log('wrote', file);
}

async function main() {
  // Main app icon: green field, cream crate-stamp keyline, cream ffm.
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
      <rect width="1024" height="1024" fill="${GREEN}"/>
      <rect x="56" y="56" width="912" height="912" rx="120" fill="none"
        stroke="${CREAM}" stroke-width="10" opacity="0.9"/>
      <rect x="84" y="84" width="856" height="856" rx="100" fill="none"
        stroke="${CREAM}" stroke-width="4" opacity="0.55"/>
      ${monogram(1024, 560, CREAM)}
    </svg>`,
    'icon.png'
  );

  // Android adaptive foreground: green ffm, transparent, inside the safe zone.
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
      ${monogram(1024, 460, GREEN)}
    </svg>`,
    'android-icon-foreground.png'
  );

  // Android adaptive background: flat mint.
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
      <rect width="1024" height="1024" fill="${MINT}"/>
    </svg>`,
    'android-icon-background.png'
  );

  // Android monochrome (themed icons): white ffm on transparent.
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
      ${monogram(1024, 460, '#FFFFFF')}
    </svg>`,
    'android-icon-monochrome.png'
  );

  // Splash icon: the filter disc — the sprout mark in cream on a green circle, transparent
  // outside it (the splash background colour lives in app.json).
  //
  // It was the `ffm` monogram in green on nothing, which is the app icon's mark without the
  // app icon's field, and read as a word rather than as a mark. The disc is the one shape a
  // reader meets on every screen: it opens the filters on both tabs, and the pin beneath it is
  // the same plant. Landing on it and then finding it in the corner of the map is continuity;
  // landing on lettering and then never seeing it again is not.
  //
  // Hand-carried from `src/constants/sprout.ts` along with the pin below — same reason, same
  // rule: change the shape there, change it here, rerun this script.
  //
  // The app's name sits under it, in **Fraunces Black** (`Display.black`) — the face the `ffm`
  // logo is set in, so the first screen and the plaque in the corner of the map are the same
  // lettering. A mark alone is only recognisable to somebody who already knows it; the first
  // screen of a first launch is precisely where that cannot be assumed.
  //
  // It was Fraunces Italic, on the grounds that italic was "the face the name is set in
  // everywhere it is written out" and the one the map's plaque wore. Both halves had expired:
  // the plaque became the `ffm` monogram in Black, which left this the only place the name was
  // still written out in italic — so the rule was describing a set of one, and that one was
  // the outlier rather than the pattern. Style guide §3 now reserves italic for season lines
  // alone.
  //
  // The canvas stops being square because a name is wider than it is tall. `imageWidth` in
  // app.json is the width this is drawn at, so it moved with the shape — 76 was sized for a
  // disc alone and would render the name at about five points.
  //
  // **The disc stays the size it was when it was alone on the screen**, and the number for
  // that is **58 pt, not 76**. Adding the name made the canvas wider, and `imageWidth` grew
  // with it — which scaled the disc up by the same factor and put a 140 pt green circle on the
  // launch screen. Drawing it to a fixed fraction of the canvas fixed the scaling but kept the
  // wrong target: 76 was `imageWidth` from the disc-alone era, read as though the disc had
  // filled that square edge to edge. It had not — it sat inside its own padding, and measured
  // 58. So 160 of 600, which at `imageWidth: 220` renders at 58.7.
  //
  // Measured off a launch, not computed: iOS caches a snapshot of the launch screen per
  // install, so the disc-alone splash kept appearing before this one on any device that had
  // the old build — two splash screens, the first at the size this one should have been. That
  // snapshot is what 58 was measured from. It clears on a delete-and-reinstall.
  //
  // Everything else is held: the sprout keeps its 0.6-of-the-disc proportion (a 24-unit box at
  // `scale(4)` is 96 across of 160, as 124.8 of 208 was), the top margin stays 26, the gap from
  // the disc to the name stays 96, and the canvas loses exactly the 48 the disc gave up.
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="332">
      <circle cx="300" cy="106" r="80" fill="${GREEN}"/>
      <g transform="translate(252 58) scale(4)" fill="none" stroke="${CREAM}"
         stroke-linecap="round">
        <path d="${SPROUT.stem}" stroke-width="${SPROUT.stemThickness}"/>
        <path d="M4.5 5.5 L12 13" stroke-width="2.5"/>
        <path d="M12 10.5 L19.5 3" stroke-width="2.5"/>
      </g>
      ${words(font, 'Fresh Food Map', 480, 300, 282, GREEN)}
    </svg>`,
    'splash-icon.png'
  );

  // Native map pin. A MapLibre `symbol` layer takes a registered image rather than a path, so
  // the mark the web map inlines as SVG has to be rasterised for iOS/Android. Drawn at 3x and
  // scaled down by `icon-size` in market-map.tsx.
  //
  // White disc, green sprout. Fixed colours, unlike the web pin, which recolours itself from
  // the active theme: a raster registered once cannot follow a scheme change.
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="84" height="84">
      <circle cx="42" cy="42" r="32" fill="#FFFFFF" stroke="rgba(0,0,0,0.12)" stroke-width="2"/>
      <g transform="translate(18 18) scale(2)" fill="none">
        <path d="${SPROUT.stem}" stroke="${GREEN}" stroke-width="${SPROUT.stemThickness}"
          stroke-linecap="round"/>
        <path d="${SPROUT.leafLeft}" fill="${GREEN}"/>
        <path d="${SPROUT.leafRight}" fill="${GREEN}"/>
      </g>
    </svg>`,
    'pin-sprout.png'
  );

  // Favicon: rounded green square, cream ffm.
  await render(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
      <rect width="128" height="128" rx="28" fill="${GREEN}"/>
      ${monogram(128, 76, CREAM)}
    </svg>`,
    'favicon.png',
    64
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
