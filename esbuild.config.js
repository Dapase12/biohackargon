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
      alias: { '@': './src' }, // Resolve @/ path aliases
      external: ['@supabase/supabase-js'], // Keep Supabase as external (loaded from CDN via import map)
      define: {
        'process.env.NODE_ENV': '"production"'
      }
    });
    console.log(`Built ${outFile}`);
  }

  // Copy compiled CSS to dist
  if (existsSync('dist/output.css')) {
    copyFileSync('dist/output.css', 'dist/output.css');
    console.log('Copied output.css to dist');
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

  // Fix deprecated meta tag
  indexHtml = indexHtml.replace(
    'meta name="apple-mobile-web-app-capable"',
    'meta name="mobile-web-app-capable"'
  );

  // Remove ALL script tags
  indexHtml = indexHtml.replace(/<script[^>]*>[\s\S]*?<\/script>/g, '');

  // Add CDN scripts back (Swiper, Lucide, ApexCharts, Supabase) + local Tailwind CSS
  const cdnScripts = `  <!-- Tailwind CSS (compiled) -->
  <link rel="stylesheet" href="output.css" />
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

  // Early script for drawer functions (must be before any onclick handlers)
  const earlyScript = `  <!-- Early global functions for drawer (before modules load) -->
  <script>
    window.openDrawer = () => { document.body.classList.add('drawer-open'); };
    window.closeDrawer = () => document.body.classList.remove('drawer-open');
    window.toggleDial = (force) => {
      const dial = document.getElementById('speed-dial'); if (!dial) return;
      const open = typeof force === 'boolean' ? force : !dial.classList.contains('open');
      dial.classList.toggle('open', open); document.body.classList.toggle('dial-open', open);
    };
    // drawerGo: navega por el menú ☰ y cierra el drawer
    window.drawerGo = (action) => {
      window.closeDrawer();
      const run = () => {
        switch (action) {
          case 'log':     window.openModal?.('detail-modal'); break;
          case 'meal':    window.quickAddMeal?.(420, 30, 40, 15, 'Desayuno'); break;
          case 'water':   window.quickAddMeal?.(0, 0, 0, 0, '+250 ml agua'); break;
          case 'journal': window.openModal?.('journal-modal'); break;
          case 'sync':    window.syncFromSupabase?.(); break;
          case 'export':  window.exportData?.(); break;
          case 'demo':    window.seedCalibratedFeelfitHistory?.(true); break;
          case 'coach':   window.showCoach?.(); break;
          case 'profile':
          case 'settings': window.openModal?.('settings-modal'); break;
          case 'qa':      window.runQualityAuditModal?.(); break;
          case 'install': window.installPWA?.(); break;
          case 'about':   window.openModal?.('about-modal'); break;
        }
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(run, 100), { once: true });
      } else {
        setTimeout(run, 50);
      }
    };
    // saveSettings: called from settings modal button (inline onclick)
    window.saveSettings = () => {
      const url = document.getElementById('cfg-url')?.value?.trim() || '';
      const key = document.getElementById('cfg-key')?.value?.trim() || '';
      const userId = document.getElementById('cfg-user-id')?.value?.trim() || '';
      const targetW = document.getElementById('cfg-target-weight')?.value || '';
      const wakeTime = document.getElementById('cfg-wake-time')?.value || '';
      const startW = document.getElementById('cfg-start-weight')?.value;
      const goalDate = document.getElementById('cfg-goal-date')?.value;
      const gasUrl = document.getElementById('cfg-gas-url')?.value?.trim() || '';
      const webappUrl = document.getElementById('cfg-webapp-url')?.value?.trim() || '';
      if (url) localStorage.setItem('argon_sb_url', url);
      if (key) localStorage.setItem('argon_sb_key', key);
      if (userId) localStorage.setItem('argon_user_id', userId);
      if (targetW) localStorage.setItem('argon_target_w', targetW);
      if (wakeTime) localStorage.setItem('argon_wake_time', wakeTime);
      if (startW) localStorage.setItem('argon_start_w', startW);
      if (goalDate) localStorage.setItem('argon_goal_date', goalDate);
      if (gasUrl) localStorage.setItem('argon_gas_url', gasUrl);
      if (webappUrl) localStorage.setItem('ARGON_WEBAPP_URL', webappUrl);
      if (typeof window.updateCountdown === 'function') window.updateCountdown();
      if (typeof window.closeModal === 'function') window.closeModal('settings-modal');
      if (typeof window.initSupabaseFromStorage === 'function') window.initSupabaseFromStorage();
    };
  </script>
`;

  // Add correct module script tags before </body>
  const moduleScripts = earlyScript + `  <script type="module" src="main-app.js"></script>
  <script type="module" src="argon-sleep.js"></script>
  <script type="module" src="argon-mbe.js"></script>
  <script type="module" src="argon-patch.js"></script>
`;

  indexHtml = indexHtml.replace('</body>', moduleScripts + '</body>');

  await writeFile('dist/index.html', indexHtml);
  console.log('Updated dist/index.html');
}

buildAll().catch(() => process.exit(1));