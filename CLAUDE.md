# ARGON v6.0 — PWA de biohacking (contexto permanente)

## Stack
- Frontend: HTML + Tailwind CDN + JS vanilla, Swiper, ApexCharts, Lucide. PWA (sw.js, manifest.json). Hosting: GitHub Pages.
- Backend: Supabase (tablas: daily_raw_biometrics, computed_daily_scores, webhook_logs) + Google Apps Script (Code.txt: webhook Health Connect/Zepp cada 15 min, motor de cálculo servidor, coach con Gemini).
- Archivos: index.html (UI + motor cliente), argon-mbe.js (panel MBE+ desde menú ☰), Code.txt (copia de Apps Script), parchear-code.html (parcheador idempotente de Code.txt).
- Config: config.template.js → copiar a config.js (gitignored) con perfil de usuario.

## Usuario (template - editar en config.js)
- Perfil configurable: birthDate, heightM, timezone, basalSleepNeedH, habitualWake, goalWeightKg, goalDate, dailyDeficitKcal, biologicalSex
- Zona horaria IANA (ej: America/Caracas, Europe/Madrid)
- Meta de recomposición corporal personalizable

## Reglas de trabajo (OBLIGATORIAS)
1. Español, directo, sin saludos ni resúmenes finales.
2. Medicina basada en la evidencia: cita fuente (autor/año) en cada fórmula; marca parámetros provisionales.
3. Modo quirúrgico: edita con diffs mínimos. Nunca reescribas archivos completos salvo petición explícita.
4. El usuario NO edita código a mano: entrega archivos ya parcheados en el repo; para Code.txt (se pega en Apps Script) entrega el archivo completo o actualiza parchear-code.html.
5. Valida sintaxis antes de dar por terminado: `node --check` en cada JS extraído de los HTML, y JSON.parse en manifest.json.
6. Tareas enumeradas en orden. Un commit por tarea con mensaje claro.
7. Manejo de null/NaN en toda fórmula; try/catch en toda llamada async a Supabase.
8. Nunca commitear claves. La anon key vive en localStorage del cliente. RLS de Supabase se activa AL FINAL, no antes.
9. Configuración personal en config.js (gitignored) — no hardcodear nada en el código.

## Estado (ya desplegado)
- Recuperación servidor: media móvil 7 d de lnRMSSD vs base 14 d, SWC = 0.5·SD con zona muerta, FR > 20 rpm penaliza, null en calibración (<7 días). Modelo 3 pilares lineales (HRV 40%, RHR 20%, Sleep 40%) + penalty directo.
- Siestas: episodios 10–240 min iniciados 08:00–20:00.
- Hipnograma: códigos 1=despierto, 4=ligero, 5=profundo, 6=REM.
- Entrenos Zepp: exercise trae solo type ("0"=Entrenamiento, único confirmado), steps, distance_meters, duration_seconds. kcal estimadas con Keytel 2005. Búfer FC minuto a minuto, 6 h, cobertura ≥60 %.
- VFC: clasificada por sesión de sueño (noche/siesta); VFC nocturna del día = mediana en sueño profundo → sin hipnograma, primeras 4 h → <5 muestras, toda la noche. Tope 600 muestras/noche.
- active_calories y distance de Zepp son agregados diarios.

## Pendiente (priorizado)
1. Confirmar si Zepp envía 1 o varias muestras de VFC por noche (desde 27-oct solo aparece una en el log; puede ser log truncado). SQL de muestras por hora.
2. Validar nombres de tipos de ejercicio con más entrenos reales.
3. Calibración kcal Zepp vs ARGON (esperar ≥3 días completos).
4. Siestas en deuda de sueño: hoy 100 %; evaluar 75 %.
5. Selector de fecha: tarjetas MBE+ muestran siempre el día más reciente.
6. Opción A: que el cliente deje de calcular y solo muestre lo del servidor (hoy hay dos motores que pueden divergir).
7. Validar pesos de recuperación 4–6 semanas vs escala subjetiva 1–10.
8. Confirmar hidratación 35 ml/kg y cota ±25 % del TDEE.
9. Riesgos: recálculo local lento con muchos días; el coach solo ve las últimas 14 filas.
10. Final: RLS + Supabase Auth opcional para multiusuario.

## Data Pipeline (para docs)
- Dispositivos: Amazfit Bip 6 (HRV, RHR, Sleep, SpO2, RR, Steps) + Balanza CS20M (Weight, Body Fat, Muscle, Water, Bone, Visceral)
- Zepp App → Google Health Connect → Health Connect Webhook (Tasker/MacroDroid) → Google Apps Script (code.txt) → Supabase
- Webhook payload: JSON con biometría cruda → GAS procesa y computa → upsert en daily_raw_biometrics + computed_daily_scores