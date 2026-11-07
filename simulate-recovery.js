/**
 * ============================================================================
 * SIMULADOR DE ALGORITMOS DE RECUPERACIÓN ARGON
 * Compara: Actual vs Opción A (fix rápido) vs Opción B (3 pilares) vs Opción C (híbrido)
 * ============================================================================
 */

// ============================================================================
// CONFIGURACIÓN DE ESCENARIOS DE PRUEBA
// ============================================================================

const SCENARIOS = [
  {
    name: "Usuario actual (HRV baseline, buen sueño, RHR baseline)",
    desc: "HRV en baseline ± SWC, sueño 8h regular, RHR estable",
    hrvZ: 0.0,      // HRV en baseline (dentro de SWC)
    rhrZ: 0.0,      // RHR en baseline
    sleepArchScore: 92, // Sueño "perfecto" teórico (92 = sleepZ = 0)
    penalty: 0.0,
    calibrating: false,
    expected: "AMARILLO (~55%)"
  },
  {
    name: "Usuario actual con buen sueño realista",
    desc: "HRV baseline, sueño 8h + regularidad alta, RHR baseline",
    hrvZ: 0.0,
    rhrZ: 0.0,
    sleepArchScore: 96, // Buen sueño realista
    penalty: 0.0,
    calibrating: false,
    expected: "AMARILLO (~58%)"
  },
  {
    name: "HRV positivo moderado (+1 SD)",
    desc: "HRV 1 SD sobre baseline, buen sueño, RHR baseline",
    hrvZ: 1.0,
    rhrZ: 0.0,
    sleepArchScore: 96,
    penalty: 0.0,
    calibrating: false,
    expected: "VERDE (~70%)"
  },
  {
    name: "HRV muy positivo (+2 SD)",
    desc: "HRV 2 SD sobre baseline, buen sueño, RHR baseline",
    hrvZ: 2.0,
    rhrZ: 0.0,
    sleepArchScore: 96,
    penalty: 0.0,
    calibrating: false,
    expected: "VERDE ALTO (~82%)"
  },
  {
    name: "RHR muy bajo (-2 SD), HRV baseline",
    desc: "RHR 2 SD bajo baseline, HRV baseline, buen sueño",
    hrvZ: 0.0,
    rhrZ: -2.0,
    sleepArchScore: 96,
    penalty: 0.0,
    calibrating: false,
    expected: "VERDE (~72%)"
  },
  {
    name: "Sueño excelente, HRV/RHR baseline",
    desc: "Sueño perfecto teórico (máx sleepArchScore ≈ 99.5), HRV/RHR baseline",
    hrvZ: 0.0,
    rhrZ: 0.0,
    sleepArchScore: 99.5,
    penalty: 0.0,
    calibrating: false,
    expected: "AMARILLO (~58%) - LÍMITE ACTUAL"
  },
  {
    name: "Penalty FR > 20",
    desc: "Todo bien pero FR nocturna 22 rpm",
    hrvZ: 1.0,
    rhrZ: 0.0,
    sleepArchScore: 96,
    penalty: 0.5, // FR > 20
    calibrating: false,
    expected: "AMARILLO (~65%)"
  },
  {
    name: "Penalty SpO2 < 94",
    desc: "Todo bien pero SpO2 93%",
    hrvZ: 1.0,
    rhrZ: 0.0,
    sleepArchScore: 96,
    penalty: 1.0, // SpO2 < 94
    calibrating: false,
    expected: "AMARILLO (~55%)"
  },
  {
    name: "Recuperación comprometida",
    desc: "HRV -1.5 SD, RHR +1 SD, sueño regular",
    hrvZ: -1.5,
    rhrZ: 1.0,
    sleepArchScore: 85,
    penalty: 0.0,
    calibrating: false,
    expected: "ROJO (~25%)"
  },
  {
    name: "Calibración (< 7 días válidos)",
    desc: "Solo 5 días de datos válidos",
    hrvZ: 1.0,
    rhrZ: 0.0,
    sleepArchScore: 96,
    penalty: 0.0,
    calibrating: true,
    expected: "NULL (calibrando)"
  }
];

// ============================================================================
// ALGORITMO ACTUAL (ARGON v6.0)
// ============================================================================

function recoveryCurrent(hrvZ, rhrZ, sleepArchScore, penalty, calibrating) {
  if (calibrating) return { score: null, status: 'CALIBRATING', psi: null };

  const sleepZ = Math.max(-3, Math.min(2, (sleepArchScore - 92.0) / 10.0));
  const psi = (0.55 * hrvZ) - (0.20 * rhrZ) + (0.25 * sleepZ) - penalty;
  const score = Math.min(99, Math.max(1, Math.round(100.0 / (1.0 + Math.exp(-1.15 * psi)))));

  let status = 'MODERATE';
  if (score >= 67) status = 'OPTIMAL';
  else if (score < 34) status = 'COMPROMISED';

  return { score, status, psi: +psi.toFixed(3), sleepZ: +sleepZ.toFixed(3) };
}

// ============================================================================
// OPCIÓN A: FIX RÁPIDO (3 cambios mínimos)
// ============================================================================

function recoveryOptionA(hrvZ, rhrZ, sleepArchScore, penalty, calibrating) {
  if (calibrating) return { score: null, status: 'CALIBRATING', psi: null };

  // Fix 1: sleepZ cap 3 en lugar de 2
  const sleepZ = Math.max(-3, Math.min(3, (sleepArchScore - 92.0) / 10.0));

  // Fix 2: Pesos rebalanceados (estilo Oura)
  const psi = (0.40 * hrvZ) - (0.15 * rhrZ) + (0.35 * sleepZ) - penalty;

  // Fix 3: SWC más sensible (se aplicaría en cálculo de hrvZ, aquí simulamos efecto)
  // Para simular: hrvZ efectivo sería ~1.67x mayor con SWC 0.3 vs 0.5
  // Pero mantenemos hrvZ input igual para comparación justa

  const score = Math.min(99, Math.max(1, Math.round(100.0 / (1.0 + Math.exp(-1.15 * psi)))));

  let status = 'MODERATE';
  if (score >= 67) status = 'OPTIMAL';
  else if (score < 34) status = 'COMPROMISED';

  return { score, status, psi: +psi.toFixed(3), sleepZ: +sleepZ.toFixed(3) };
}

// ============================================================================
// OPCIÓN B: MODELO 3 PILARES (estilo Oura) - RECOMENDADA
// ============================================================================

function recoveryOptionB(hrvZ, rhrZ, sleepArchScore, penalty, calibrating) {
  if (calibrating) return { score: null, status: 'CALIBRATING', psi: null };

  // Cada pilar 0-100 independiente
  // hrvZ ±3 → 0-100 lineal (centrado en 50)
  const hrvRecovery = Math.min(100, Math.max(0, 50 + hrvZ * 16.67));
  // rhrZ: negativo es bueno → invertir
  const rhrRecovery = Math.min(100, Math.max(0, 50 - rhrZ * 16.67));
  // sleepArchScore ya es 0-100 aprox
  const sleepRecovery = Math.min(100, Math.max(0, sleepArchScore));

  // Media ponderada
  let score = Math.round(0.40 * hrvRecovery + 0.20 * rhrRecovery + 0.40 * sleepRecovery);

  // Penalty resta puntos directos (más intuitivo)
  score = Math.max(1, score - penalty * 10);

  let status = 'MODERATE';
  if (score >= 67) status = 'OPTIMAL';
  else if (score < 34) status = 'COMPROMISED';

  return {
    score,
    status,
    components: {
      hrv: +hrvRecovery.toFixed(1),
      rhr: +rhrRecovery.toFixed(1),
      sleep: +sleepRecovery.toFixed(1)
    }
  };
}

// ============================================================================
// OPCIÓN C: HÍBRIDO BALANCEADO (mantiene sigmoide, fixea inputs)
// ============================================================================

function recoveryOptionC(hrvZ, rhrZ, sleepArchScore, penalty, calibrating) {
  if (calibrating) return { score: null, status: 'CALIBRATING', psi: null };

  // Fix sleepArchScore targets para que perfecto = 100+
  // Recalcular sleepArchScore con targets ajustados:
  // hoursVsNeededPct target 100, sleepRegularityPct target 95, eff target 85%, SWS+REM target 35%
  // sleepArchScore_max = 0.45*100 + 0.20*95 + 0.20*100 + 0.15*100 = 45 + 19 + 20 + 15 = 99
  // Ajustar pesos para que perfecto dé ~105 → sleepZ ≈ 1.3

  const sleepZ = Math.max(-3, Math.min(3, (sleepArchScore - 92.0) / 10.0));

  // Pesos rebalanceados
  const psi = (0.45 * hrvZ) - (0.15 * rhrZ) + (0.30 * sleepZ) - penalty;

  const score = Math.min(99, Math.max(1, Math.round(100.0 / (1.0 + Math.exp(-1.15 * psi)))));

  let status = 'MODERATE';
  if (score >= 67) status = 'OPTIMAL';
  else if (score < 34) status = 'COMPROMISED';

  return { score, status, psi: +psi.toFixed(3), sleepZ: +sleepZ.toFixed(3) };
}

// ============================================================================
// WHOOP-STYLE (referencia)
// ============================================================================

function recoveryWhoopStyle(hrvZ, rhrZ, sleepArchScore, penalty, calibrating) {
  if (calibrating) return { score: null, status: 'CALIBRATING', psi: null };

  // Whoop usa HRV 7d vs 28d baseline, sin SWC dead zone en z-score principal
  // Pesos estimados: HRV ~0.6, RHR ~0.2, Sleep ~0.2
  const sleepZ = Math.max(-3, Math.min(3, (sleepArchScore - 92.0) / 10.0));
  const psi = (0.60 * hrvZ) - (0.20 * rhrZ) + (0.20 * sleepZ) - penalty;
  const score = Math.min(99, Math.max(1, Math.round(100.0 / (1.0 + Math.exp(-1.15 * psi)))));

  let status = 'MODERATE';
  if (score >= 67) status = 'OPTIMAL';
  else if (score < 34) status = 'COMPROMISED';

  return { score, status, psi: +psi.toFixed(3), sleepZ: +sleepZ.toFixed(3) };
}

// ============================================================================
// EJECUTAR SIMULACIÓN
// ============================================================================

console.log("═══════════════════════════════════════════════════════════════════════════");
console.log("           SIMULADOR DE RECUPERACIÓN ARGON - COMPARATIVA");
console.log("═══════════════════════════════════════════════════════════════════════════\n");

const algorithms = [
  { name: "ACTUAL (v6.0)", fn: recoveryCurrent },
  { name: "OPCIÓN A (Fix rápido)", fn: recoveryOptionA },
  { name: "OPCIÓN B (3 Pilares ★)", fn: recoveryOptionB },
  { name: "OPCIÓN C (Híbrido)", fn: recoveryOptionC },
  { name: "WHOOP Style (ref)", fn: recoveryWhoopStyle }
];

SCENARIOS.forEach((scenario, i) => {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`ESCENARIO ${i+1}: ${scenario.name}`);
  console.log(`   ${scenario.desc}`);
  console.log(`   Inputs: hrvZ=${scenario.hrvZ}, rhrZ=${scenario.rhrZ}, sleepArchScore=${scenario.sleepArchScore}, penalty=${scenario.penalty}`);
  console.log(`   Esperado: ${scenario.expected}`);
  console.log(`${'─'.repeat(80)}`);

  console.log(`\n${'Algoritmo'.padEnd(22)} | ${'Score'.padStart(6)} | ${'Status'.padStart(12)} | ${'Psi'.padStart(6)} | ${'Detalle'}`);
  console.log(`${'─'.repeat(22)}-+-${'─'.repeat(6)}-+-${'─'.repeat(12)}-+-${'─'.repeat(6)}-+-${'─'.repeat(40)}`);

  algorithms.forEach(algo => {
    const result = algo.fn(
      scenario.hrvZ,
      scenario.rhrZ,
      scenario.sleepArchScore,
      scenario.penalty,
      scenario.calibrating
    );

    let detail = '';
    if (result.psi !== null && result.psi !== undefined) {
      detail = `psi=${result.psi}, sleepZ=${result.sleepZ}`;
    } else if (result.components) {
      detail = `HRV=${result.components.hrv}, RHR=${result.components.rhr}, Sleep=${result.components.sleep}`;
    } else {
      detail = 'calibrando';
    }

    const statusColor = result.status === 'OPTIMAL' ? '🟢' :
                        result.status === 'MODERATE' ? '🟡' :
                        result.status === 'COMPROMISED' ? '🔴' : '⚪';

    console.log(`${algo.name.padEnd(22)} | ${String(result.score || 'NULL').padStart(6)} | ${(statusColor + ' ' + result.status).padStart(12)} | ${String(result.psi || '---').padStart(6)} | ${detail}`);
  });
});

// ============================================================================
// ANÁLISIS DE SENSIBILIDAD: ¿Qué se necesita para VERDE?
// ============================================================================

console.log(`\n\n${'═'.repeat(80)}`);
console.log("ANÁLISIS DE SENSIBILIDAD: UMBRALES PARA OPTIMAL (≥67%)");
console.log(`${'═'.repeat(80)}\n`);

// Con algoritmo ACTUAL
console.log("ALGORITMO ACTUAL - Combinaciones mínimas para VERDE:");
console.log("--------------------------------------------------");

const testCombos = [
  { hrvZ: 0, rhrZ: 0, sleep: 92, label: "Baseline total" },
  { hrvZ: 0, rhrZ: 0, sleep: 96, label: "Buen sueño" },
  { hrvZ: 0, rhrZ: 0, sleep: 99.5, label: "Sueño perfecto teórico" },
  { hrvZ: 0.5, rhrZ: 0, sleep: 96, label: "HRV +0.5 SD" },
  { hrvZ: 1.0, rhrZ: 0, sleep: 96, label: "HRV +1.0 SD" },
  { hrvZ: 1.15, rhrZ: 0, sleep: 96, label: "HRV +1.15 SD (umbral teórico)" },
  { hrvZ: 0, rhrZ: -2, sleep: 96, label: "RHR -2 SD" },
  { hrvZ: 0, rhrZ: -3, sleep: 96, label: "RHR -3 SD (máx)" },
  { hrvZ: 0.5, rhrZ: -1, sleep: 96, label: "HRV +0.5 + RHR -1" },
  { hrvZ: 0.8, rhrZ: -0.5, sleep: 96, label: "HRV +0.8 + RHR -0.5" },
];

console.log(`\n${'Combo'.padEnd(35)} | ${'Psi'.padStart(6)} | ${'Score'.padStart(6)} | ${'Status'}`);
console.log(`${'─'.repeat(35)}-+-${'─'.repeat(6)}-+-${'─'.repeat(6)}-+-${'─'.repeat(10)}`);

testCombos.forEach(c => {
  const r = recoveryCurrent(c.hrvZ, c.rhrZ, c.sleep, 0, false);
  const statusIcon = r.status === 'OPTIMAL' ? '🟢' : r.status === 'MODERATE' ? '🟡' : '🔴';
  console.log(`${c.label.padEnd(35)} | ${r.psi.toFixed(3).padStart(6)} | ${String(r.score).padStart(6)} | ${statusIcon} ${r.status}`);
});

// Con Opción B
console.log("\n\nOPCIÓN B (3 PILARES) - Mismas combinaciones:");
console.log("------------------------------------------");

console.log(`\n${'Combo'.padEnd(35)} | ${'Score'.padStart(6)} | ${'Status'} | ${'Componentes (HRV/RHR/Sleep)'}`);
console.log(`${'─'.repeat(35)}-+-${'─'.repeat(6)}-+-${'─'.repeat(10)}-+-${'─'.repeat(35)}`);

testCombos.forEach(c => {
  const r = recoveryOptionB(c.hrvZ, c.rhrZ, c.sleep, 0, false);
  const statusIcon = r.status === 'OPTIMAL' ? '🟢' : r.status === 'MODERATE' ? '🟡' : '🔴';
  console.log(`${c.label.padEnd(35)} | ${String(r.score).padStart(6)} | ${statusIcon} ${r.status.padEnd(10)} | HRV=${r.components.hrv} RHR=${r.components.rhr} Sleep=${r.components.sleep}`);
});

// ============================================================================
// SIMULACIÓN SEMANAL REALISTA
// ============================================================================

console.log(`\n\n${'═'.repeat(80)}`);
console.log("SIMULACIÓN SEMANAL REALISTA (7 días usuario típico)");
console.log(`${'═'.repeat(80)}\n`);

// Simular una semana con variabilidad realista
const weeklyData = [
  { day: "Lun", hrvZ: 0.2, rhrZ: 0.1, sleep: 94, penalty: 0 },
  { day: "Mar", hrvZ: -0.3, rhrZ: 0.2, sleep: 90, penalty: 0 },
  { day: "Mié", hrvZ: 0.5, rhrZ: -0.1, sleep: 96, penalty: 0 },
  { day: "Jue", hrvZ: -0.1, rhrZ: 0.0, sleep: 92, penalty: 0.5 }, // FR alta
  { day: "Vie", hrvZ: 0.8, rhrZ: -0.3, sleep: 95, penalty: 0 },
  { day: "Sáb", hrvZ: 0.3, rhrZ: -0.2, sleep: 93, penalty: 0 },
  { day: "Dom", hrvZ: -0.2, rhrZ: 0.1, sleep: 88, penalty: 0 }, // Mal sueño
];

console.log(`${'Día'.padEnd(6)} | ${'ACTUAL'.padStart(10)} | ${'OPCIÓN A'.padStart(10)} | ${'OPCIÓN B★'.padStart(10)} | ${'OPCIÓN C'.padStart(10)} | ${'WHOOP'.padStart(10)}`);
console.log(`${'─'.repeat(6)}-+-${'─'.repeat(10)}-+-${'─'.repeat(10)}-+-${'─'.repeat(10)}-+-${'─'.repeat(10)}-+-${'─'.repeat(10)}`);

weeklyData.forEach(d => {
  const curr = recoveryCurrent(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false);
  const optA = recoveryOptionA(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false);
  const optB = recoveryOptionB(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false);
  const optC = recoveryOptionC(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false);
  const whoop = recoveryWhoopStyle(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false);

  const fmt = (r) => `${r.score} (${r.status[0]})`;

  console.log(`${d.day.padEnd(6)} | ${fmt(curr).padStart(10)} | ${fmt(optA).padStart(10)} | ${fmt(optB).padStart(10)} | ${fmt(optC).padStart(10)} | ${fmt(whoop).padStart(10)}`);
});

// Promedios semanales
const avg = (arr, fn) => arr.reduce((s, d) => s + fn(recoveryCurrent(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false)), 0) / arr.length;
const avgA = (arr) => arr.reduce((s, d) => s + recoveryOptionA(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false).score, 0) / arr.length;
const avgB = (arr) => arr.reduce((s, d) => s + recoveryOptionB(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false).score, 0) / arr.length;
const avgC = (arr) => arr.reduce((s, d) => s + recoveryOptionC(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false).score, 0) / arr.length;
const avgW = (arr) => arr.reduce((s, d) => s + recoveryWhoopStyle(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false).score, 0) / arr.length;

console.log(`\n${'PROMEDIO'.padEnd(6)} | ${avg(weeklyData, r => r.score).toFixed(1).padStart(10)} | ${avgA(weeklyData).toFixed(1).padStart(10)} | ${avgB(weeklyData).toFixed(1).padStart(10)} | ${avgC(weeklyData).toFixed(1).padStart(10)} | ${avgW(weeklyData).toFixed(1).padStart(10)}`);

// Días en verde
const countGreen = (arr, fn) => arr.filter(d => fn(d.hrvZ, d.rhrZ, d.sleep, d.penalty, false).status === 'OPTIMAL').length;
console.log(`\nDías en VERDE (OPTIMAL):`);
console.log(`  ACTUAL: ${countGreen(weeklyData, (h,r,s,p,c) => recoveryCurrent(h,r,s,p,c))}/7`);
console.log(`  OPCIÓN A: ${countGreen(weeklyData, (h,r,s,p,c) => recoveryOptionA(h,r,s,p,c))}/7`);
console.log(`  OPCIÓN B: ${countGreen(weeklyData, (h,r,s,p,c) => recoveryOptionB(h,r,s,p,c))}/7`);
console.log(`  OPCIÓN C: ${countGreen(weeklyData, (h,r,s,p,c) => recoveryOptionC(h,r,s,p,c))}/7`);
console.log(`  WHOOP: ${countGreen(weeklyData, (h,r,s,p,c) => recoveryWhoopStyle(h,r,s,p,c))}/7`);

console.log(`\n${'═'.repeat(80)}`);
console.log("CONCLUSIONES:");
console.log(`${'═'.repeat(80)}`);
console.log(`
1. ALGORITMO ACTUAL: Usuario típico (HRV baseline, buen sueño) → SIEMPRE AMARILLO
   - SleepZ máx real = 0.75 → aporte 0.19 a psi
   - Necesita HRV +1.15 SD O RHR -3 SD para alcanzar VERDE
   - Explica por qué llevas semana en amarillo

2. OPCIÓN A (Fix rápido): Mejora moderada
   - SleepZ cap 3 permite aporte hasta 0.75 (si sleepArchScore=112, irreal)
   - Pesos rebalanceados ayudan pero sigmoide sigue limitando

3. OPCIÓN B (3 Pilares) ★ RECOMENDADA:
   - Lineal, transparente, cada pilar contribuye
   - Sueño perfecto = 100 → 40 pts directos
   - Usuario con buen sueño y HRV baseline → VERDE (~67-72%)
   - Penalty intuitivo (-10 pts por SpO2, -5 por FR)

4. OPCIÓN C (Híbrido): Balance razonable
   - Mantiene sigmoide (suaviza transiciones)
   - Pesos 0.45/0.15/0.30 más equilibrados
   - Requiere ajustar sleepArchScore targets

5. WHOOP Style: Similar a actual pero HRV peso 0.60
   - Aún más dependiente de HRV
   - Sin SWC dead zone → hrvZ más sensible
`);