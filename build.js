// Builds the single-file site from src/:
//   node build.js            -> index.html, sitemap.xml, favicon.svg, .nojekyll in this folder
//   node build.js <outDir>   -> the same files in <outDir>
// The converter, example-log generator and UI are inlined into index.html.
const fs = require('fs');
const path = require('path');
const SITE = 'https://dompka.github.io/bintomat/';
const REPO = 'https://github.com/DomPka/bintomat';
const TITLE = 'ArduPilot BIN to MAT Converter: DataFlash Logs to MATLAB';
const TODAY = new Date().toISOString().slice(0, 10);

const src = (f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8');
const OUT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith('--')) || __dirname);
const out = (f, s) => { const p = path.isAbsolute(f) ? f : path.join(OUT, f); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };
const page = src('page.html.tpl');
const [head, rest] = page.split('<!--BODY-->');
const scripts = ['converter.js', 'sample.js', 'app.js'].map((f) => {
  const code = src(f);
  if (/<\/script/i.test(code)) throw new Error(`${f} contains </script`);
  return `<script>\n${code.trim()}\n</script>`;
}).join('\n');
const body = rest.replace('<!--SCRIPTS-->', scripts);
if (process.argv.includes('--artifact')) out(path.join(__dirname, 'dist/artifact/index.html'), `${head.trim()}\n${body.trim()}\n`);

// ---- metadata for search engines and link previews ----
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const desc = head.match(/<meta name="description" content="([^"]+)"/)[1];
const faqHtml = body.match(/<section class="wrap doc" id="faq">([\s\S]*?)<\/section>/)[1];
const faq = [...faqHtml.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => ({ q: text(m[1]), a: text(m[2]) }));
if (faq.length < 4) throw new Error('FAQ not found');
const ld = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      '@id': `${SITE}#app`,
      name: 'BIN to MAT Converter',
      alternateName: ['BINorLOGtoMAT', 'ArduPilot BIN to MAT', 'DataFlash log to MATLAB converter'],
      url: SITE,
      description: desc,
      applicationCategory: 'UtilitiesApplication',
      applicationSubCategory: 'Flight log converter',
      operatingSystem: 'Any (runs in a web browser)',
      browserRequirements: 'Requires JavaScript',
      isAccessibleForFree: true,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      image: `${SITE}social-card.png`,
      screenshot: `${SITE}docs/screenshot.png`,
      inLanguage: 'en',
      keywords: 'ArduPilot, DataFlash, bin log, Mission Planner log, MATLAB, mat file, Pixhawk, ArduCopter, ArduPlane, UAV, drone flight log, log converter',
      featureList: [
        'Converts ArduPilot DataFlash .bin and Mission Planner text .log files to MATLAB .mat (v5)',
        'One MATLAB struct per message type, one field per column',
        'Runs locally in the browser, files are never uploaded',
        'Batch conversion and .zip download',
        'Choose message types, int64 or double integers, optional compression',
        'Quick-look plot of any numeric field',
      ],
      author: { '@type': 'Person', name: 'DomPka', url: 'https://github.com/DomPka' },
      sameAs: [REPO],
    },
    {
      '@type': 'FAQPage',
      mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    },
  ],
};
const seoHead = head
  .replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`)
  .trim();
const meta = `<link rel="canonical" href="${SITE}">
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<meta name="author" content="DomPka">
<meta name="theme-color" content="#edf1f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0c1215" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="BIN to MAT Converter">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${SITE}">
<meta property="og:image" content="${SITE}social-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="BIN to MAT: ArduPilot DataFlash logs to MATLAB .mat in the browser">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${TITLE}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${SITE}social-card.png">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="icon" href="favicon-96.png" sizes="96x96" type="image/png">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<script type="application/ld+json">
${JSON.stringify(ld, null, 2)}
</script>`;
const site = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
${seoHead}
${meta}
</head>
<body>
${body.trim()}
</body>
</html>
`;
out('index.html', site);
out('favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#12202a"/><path d="M6 21l5-7 4 5 5-10 4 7 3-3" fill="none" stroke="#78a8ff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`);
out('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`);
out('.nojekyll', '');
console.log('built', path.join(OUT, 'index.html'), fs.statSync(path.join(OUT, 'index.html')).size, 'bytes;', faq.length, 'FAQ entries');
