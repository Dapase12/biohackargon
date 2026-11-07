# ARGON v6.0

> **PWA de biohacking cuantitativo** — HRV, sueño, nutrición y recuperación en una sola vista.  
> Motor de cálculo en servidor (Google Apps Script + Supabase), cliente ligero (HTML/JS vanilla + Tailwind).

[![Deploy to GitHub Pages](https://github.com/dapase12/biohackargon/actions/workflows/pages.yml/badge.svg)](https://github.com/dapase12/biohackargon/actions/workflows/pages.yml)
![License](https://img.shields.io/badge/license-MIT-blue.svg)
![PWA](https://img.shields.io/badge/PWA-ready-green.svg)
![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E.svg)
![Google Apps Script](https://img.shields.io/badge/Engine-GAS-4285F4.svg)

---

## 🎯 ¿Qué es ARGON?

**ARGON** es una Progressive Web App personal para tracking y análisis de biomarcadores de recuperación y rendimiento. Nace de la necesidad de un **motor de cálculo transparente, basado en evidencia y auditable** — no una "caja negra" como Whoop/Oura/Garmin.

### Filosofía

| Principio | Implementación |
|-----------|----------------|
| **Evidencia > opinión** | Cada fórmula cita fuente (autor/año); parámetros provisionales marcados explícitamente |
| **Transparencia total** | Código abierto, motor replicable localmente, sin vendor lock-in |
| **Individualización** | Baselines personales (14d), SWC = 0.5·SD, calibración mínima 7 días |
| **Cliente ligero** | El navegador solo renderiza; el cómputo pesado corre en servidor (GAS + Supabase) |
| **Privacidad first** | Datos en tu Supabase, claves solo en localStorage, RLS activable al final |

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                        GITHUB PAGES (PWA)                       │
│  index.html  │  argon-mbe.js  │  sw.js  │  manifest.json       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTPS / Supabase JS SDK
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                          SUPABASE                                │
│  • daily_raw_biometrics      • computed_daily_scores            │
│  • webhook_logs              • (RLS ready for multi-user)       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Webhook / 15 min cron
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GOOGLE APPS SCRIPT                           │
│  • Webhook Health Connect / Zepp                                │
│  • Motor de cálculo servidor (code.txt)                         │
│  • Coach IA (Gemini) sobre últimas 14 filas                     │
└─────────────────────────────────────────────────────────────────┘
```

### Stack

| Capa | Tecnología |
|------|------------|
| **Frontend** | HTML5 + Tailwind CDN + Vanilla JS (ES modules), Swiper, ApexCharts, Lucide Icons |
| **PWA** | Service Worker (sw.js), Web Manifest, íconos 180-512px, installable |
| **Backend DB** | Supabase (PostgreSQL) — tablas tipadas, índices, vistas materializadas |
| **Compute Engine** | Google Apps Script (V8 runtime) — webhook receptor, cálculo diario, coach |
| **Data Sources** | Zepp/Health Connect (webhook), entrada manual de comidas, peso, ejercicio |

---

## 📊 Funcionalidades Principales

### 1. **Recovery Score (Motor Servidor)**
- **HRV**: Media móvil 7d de lnRMSSD vs baseline 14d, zona muerta SWC = 0.5·SD (Buchheit 2014)
- **RHR**: Z-score vs baseline 14d, penaliza elevación
- **Sleep Architecture**: 4 pilares (horas vs necesidad, regularidad, eficiencia, % SWS+REM)
- **Modelo**: 3 pilares lineales (HRV 40%, RHR 20%, Sleep 40%) + penalty directo (SpO₂ <94% = -10, FR >20 = -5)
- **Calibración**: NULL hasta 7 días válidos de lnRMSSD

### 2. **MBE+ (Metabolic Budget Engine)**
- TMB (Mifflin-St Jeor) + TEF de dos pasos + NEAT (pasos) + ejercicio (Keytel 2005)
- TDEE dinámico, macros objetivo (2.35 g/kg proteína, 0.72 g/kg grasa)
- Déficit adaptativo según strain
- Balance neto en tiempo real

### 3. **Nutrición & Comidas**
- Log manual + webhook Zepp
- Cálculo Atwater exacto por comida
- Proteína/carbs/grasas por comida y día

### 4. **Entreno & Carga**
- ACWR (aguda 3d vs crónica 14d) con penalty en strain máx recomendado
- CV HRV 7d, tendencia 7d vs 14d
- Distribución de intensidad (Zepp HR zones)

### 5. **Coach IA (Gemini)**
- Contexto: últimas 14 filas computadas + perfil usuario
- Respuesta en español, accionable, cita fuentes

### 6. **QA & Auditoría**
- Modal de verificación App ↔ Supabase (peso, pasos, kcal, sueño)
- Seed local "Base 14d" solo si no hay Supabase
- Sync automático al volver a la app + cada 5 min

---

## 🚀 Inicio Rápido

### Prerrequisitos

- Cuenta **Supabase** (proyecto nuevo)
- Cuenta **Google** (para Apps Script)
- **GitHub** (para Pages + Actions)
- Dispositivo **Zepp/Health Connect** o entrada manual

### 1. Supabase — Esquema

```sql
-- Ejecuta en Supabase SQL Editor (ver sql/expand_computed_daily_scores.sql)
-- Crea: daily_raw_biometrics, computed_daily_scores, webhook_logs
-- Índices, vistas, funciones de mantenimiento
```

### 2. Google Apps Script — Motor

1. Nuevo proyecto en [script.google.com](https://script.google.com)
2. Copia **`code.txt`** completo al editor
3. Configura `SUPABASE_URL` y `SUPABASE_ANON_KEY` en *Propiedades de script*
4. Despliega → **Nueva implementación** → Tipo: **Aplicación web**  
   Ejecutar como: **Yo**, Acceso: **Cualquiera** → **Desplegar**
5. Copia la **URL del webhook** (termina en `/exec`)

### 3. Zepp / Health Connect — Webhook

- **Zepp**: App → Perfil → Servicios en la nube → Webhook → Pega URL
- **Health Connect**: Usa app intermedia (Tasker, MacroDroid) → POST JSON a URL

### 4. GitHub Pages — Frontend

```bash
git clone https://github.com/dapase12/biohackargon.git
cd biohackargon
# Edita index.html: busca SUPABASE_URL y SUPABASE_ANON_KEY (líneas ~50-60)
# Pon tus credenciales de Supabase (anon key pública, segura en cliente)
git add . && git commit -m "feat: configure Supabase keys" && git push
```

5. Settings → Pages → Source: **GitHub Actions** (workflow incluido)

### 5. PWA Install

- Abre `https://dapase12.github.io/biohackargon/` en móvil
- Menú navegador → **Instalar app** / **Añadir a pantalla de inicio**

---

## 📁 Estructura del Repo

```
biohackargon-main/
├── index.html              # PWA principal (UI + motor cliente legacy)
├── argon-mbe.js            # Panel MBE+ (carga dinámica desde menú ☰)
├── argon-patch.js          # Parches runtime (sync, comidas, seed, QA)
├── code.txt                # Motor servidor (Google Apps Script) — FUENTE DE VERDAD
├── parchear-code.html      # Herramienta idempotente para actualizar code.txt
├── simulate-recovery.js    # Simulador comparativo de algoritmos de recovery
├── sw.js                   # Service Worker (cache v3.4)
├── manifest.json           # PWA manifest
├── icons/                  # icon-180.png, 192.png, 512.png, 512-maskable.png
├── sql/
│   └── expand_computed_daily_scores.sql  # Esquema Supabase completo
├── .github/workflows/
│   └── pages.yml           # Deploy automático a GitHub Pages
├── CLAUDE.md               # Contexto para desarrollo asistido
└── README.md               # Este archivo
```

---

## 🔬 Algoritmo de Recuperación — Detalle Técnico

### Inputs (todos vs baseline personal 14d)

| Variable | Fuente | Ventana | Transformación |
|----------|--------|---------|----------------|
| `lnRMSSD` | Zepp/Health Connect | 7d rolling median | `ln(ms)` |
| `RHR` | Zepp (nocturno) | 14d media | `bpm` |
| `SleepArchScore` | Zepp (hipnograma) | Día | 4 pilares 0-100 |
| `SpO₂` | Zepp | Noche | `%` |
| `RespRate` | Zepp | Noche | `rpm` |

### Cálculo (Opción B — 3 Pilares Lineales)

```javascript
// Z-scores con SWC dead zone (HRV) / simple (RHR)
hrvZ = clamp(sign(diff7) * max(0, |diff7| - SWC) / SD, -3, 3)
rhrZ = clamp((rhrToday - meanRhr14) / sdRhr14, -3, 3)

// Pilares 0-100
hrvRecovery = 50 + hrvZ * 16.67      // z=±3 → 0-100
rhrRecovery = 50 - rhrZ * 16.67      // RHR bajo = bueno
sleepRecovery = sleepArchScore       // ya 0-100

// Penalty directo
penalty = (SpO2 < 94 ? 10 : 0) + (RR > 20 ? 5 : 0)

// Score final
recovery = 0.40*hrvRecovery + 0.20*rhrRecovery + 0.40*sleepRecovery - penalty
recovery = clamp(round(recovery), 1, 99)
```

### Umbrales

| Score | Estado | Strain Máx Recomendado |
|-------|--------|------------------------|
| ≥ 67 | 🟢 **OPTIMAL** | 14.5 + (score-67)·0.14 |
| 34–66 | 🟡 **MODERATE** | 10.0 + (score-34)·0.13 |
| < 34 | 🔴 **COMPROMISED** | 6.0 + score·0.10 |
| NULL | ⚪ **CALIBRATING** | 12.0 (neutro) |

> **ACWR penalty**: resta hasta 2.0 puntos al strain máx si aguda/crónica > 1.3

### Referencias

- **HRV & SWC**: Buchheit M. (2014) *Monitoring training status with HRV*. Sports Med.
- **lnRMSSD 7d vs baseline**: Plews DJ et al. (2017) *HRV guidelines*. J Strength Cond Res.
- **Sleep architecture**: Miller DJ et al. (2017) *Sleep composition and recovery*. Med Sci Sports Exerc.
- **RHR & recovery**: Zhang G et al. (2016) *RHR and mortality*. CMAJ.
- **ACWR**: Gabbett TJ (2016) *The training-injury prevention paradox*. Br J Sports Med.

---

## 🛠️ Desarrollo

### Validación Local

```bash
# Sintaxis JS
node --check argon-mbe.js
node --check simulate-recovery.js

# JSON manifest
node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"

# Simulador recovery
node simulate-recovery.js
```

### Actualizar Motor Servidor (code.txt)

1. Edita `code.txt` localmente
2. Abre `parchear-code.html` en navegador
3. Pega tu `code.txt` actual → **Generar parche** → Copia resultado
4. En Apps Script: borra todo → pega resultado → **Guardar + Desplegar nueva versión**

> `parchear-code.html` garantiza idempotencia: corrige imports, ordena funciones, elimina duplicados.

### Flujo de Commits

```bash
git add -A
git commit -m "tipo: descripción breve

Cuerpo explicativo si hace falta (qué y por qué, no cómo)."
git push
```

**Tipos**: `feat`, `fix`, `refactor`, `docs`, `chore`, `perf`, `test`, `ci`

---

## 📈 Roadmap

### v6.1 — Consolidación
- [ ] Cliente 100% thin (solo render, sin motor legacy)
- [ ] Pesos recovery calibrados 4-6 semanas vs escala subjetiva 1-10
- [ ] RLS + Supabase Auth para multiusuario

### v6.2 — Inteligencia
- [ ] Detección automática de patrones (overreaching, enfermedad, ciclo menstrual)
- [ ] Predicción recovery D+1 (regresión logística personalizada)
- [ ] Export/Import JSON completo (backup portable)

### v7.0 — Plataforma
- [ ] Onboarding guiado (perfil, baselines, metas)
- [ ] Compartir vista de solo lectura (coach/médico)
- [ ] API pública documentada

---

## ⚠️ Limitaciones Conocidas

| Área | Limitación | Mitigación |
|------|------------|------------|
| **Zepp webhook** | Puede enviar 1 muestra VFC/noche (log truncado) | SQL de auditoría pendiente |
| **Coach IA** | Solo ve últimas 14 filas (límite tokens) | Resumen semanal en roadmap |
| **Recálculo local** | Lento con >90 días (JS single-thread) | Web Worker en v6.1 |
| **Hidratación** | 35 ml/kg fijo, cota ±25% TDEE empírica | Configurable en v6.2 |
| **Siestas** | 100% deuda sueño; evaluar 75% | Parametrizable en v6.1 |

---

## 🔐 Seguridad & Privacidad

- **Sin secrets en repo**: `code.txt` usa `PropertiesService` en GAS; `index.html` usa anon key pública de Supabase (RLS ready)
- **RLS**: Tablas preparadas para `auth.uid()` — activar al migrar a multiusuario
- **Datos**: Tuyos, en tu proyecto Supabase. Este repo solo tiene código.
- **PWA**: Funciona offline (cache first), sync al reconectar

---

## 🤝 Contribuir

1. Fork → rama `feat/algo-mejora` o `fix/bug-x`
2. Cambios mínimos, tests en `simulate-recovery.js` si tocas motor
3. `node --check` en JS modificados
4. PR con descripción: **problema → solución → validación**

> Este es un proyecto personal abierto por transparencia. Issues/PRs bienvenidos pero priorizo mi roadmap.

---

## 📄 Licencia

**MIT License** — úsalo, modifícalo, aprende de él.  
Atribución apreciada: `ARGON v6.0 by @dapase12`

---

## 🙋 Autor

**dapase12** — Médico, biohacker cuantitativo, amante del código limpio.  
📍 Caracas, Venezuela (UTC-4) | 🇻🇪

> *"Lo que no se mide no se mejora. Lo que se mide mal empeora."* — Lord Kelvin (adaptado)

---

⭐ **¿Te sirve? Dale a la estrella y comparte.**  
🐛 **¿Bug?** Abre issue con logs y pasos para reproducir.  
💡 **¿Idea?** Discussion → "Ideas & Requests".