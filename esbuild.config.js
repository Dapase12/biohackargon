import { build } from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';

const entryPoints = [
  'argon-sleep.js',
  'argon-mbe.js',
  'argon-patch.js',
  'main-app.js'
];

async function buildAll() {
  // Create dist directory
  if (!existsSync('dist')) {
    mkdirSync('dist', { recursive: true });
  }

  // Build each entry point
  for (const entry of entryPoints) {
    const outFile = `dist/${entry}`;
    await build({
      entryPoints: [entry],
      bundle: true,
      outfile: outFile,
      format: 'esm',
      target: 'es2022',
      platform: 'browser',
      sourcemap: true,
      splitting: false,
      loader: { '.js': 'ts', '.ts': 'ts' }, // Treat .js and .ts files as TypeScript
      resolveExtensions: ['.ts', '.js'], // Resolve .ts imports
      external: ['@supabase/supabase-js'], // Keep Supabase as external (loaded from CDN via import map)
      define: {
        'process.env.NODE_ENV': '"production"'
      }
    });
    console.log(`Built ${outFile}`);
  }

  // Copy static assets to dist (except index.html which we'll process)
  const staticFiles = ['manifest.json', 'sw.js', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png', 'icon-180.png'];
  for (const file of staticFiles) {
    if (existsSync(file)) {
      copyFileSync(file, `dist/${file}`);
    }
  }

  // Process index.html: remove inline/module script tags, keep CDN scripts, add correct module script tags
  let indexHtml = await readFile('index.html', 'utf-8');

  // Remove ALL script tags
  indexHtml = indexHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');

  // Add CDN scripts back (Tailwind, Swiper, Lucide, ApexCharts, Supabase)
  const cdnScripts = `  <!-- Tailwind CSS -->
  <script src="https://cdn.tailwindcss.com"></script>
  <!-- Swiper.js (Física táctil deslizable tipo Whoop) -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.css" />
  <script src="https://cdn.jsdelivr.net/npm/swiper@11/swiper-bundle.min.js"></script>
  <!-- Lucide Vector Icons -->
  <script src="https://unpkg.com/lucide@0.460.0"></script>
  <!-- ApexCharts & Supabase -->
  <script src="https://cdn.jsdelivr.net/npm/apexcharts"></script>
  <!-- Supabase via CDN (import map handles module resolution) -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <!-- Import map for bare module specifiers -->
  <script type="importmap">
  {
    "imports": {
      "@supabase/supabase-js": "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
    }
  }
  </script>
`;

  // Add CDN scripts before </head>
  indexHtml = indexHtml.replace('</head>', cdnScripts + '</head>');

  // Add correct module script tags before </body>
  const moduleScripts = `  <script type="module" src="main-app.js"></script>
  <script type="module" src="argon-sleep.js"></script>
  <script type="module" src="argon-mbe.js"></script>
  <script type="module" src="argon-patch.js"></script>
`;

  indexHtml = indexHtml.replace('</body>', moduleScripts + '</body>');

  await writeFile('dist/index.html', indexHtml);
  console.log('Updated dist/index.html');
}

buildAll().catch(() => process.exit(1));