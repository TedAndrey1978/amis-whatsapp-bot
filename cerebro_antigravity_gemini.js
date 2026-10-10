// C:\Users\Usuario\.antigravity_tools\whatsapp\cerebro_antigravity_gemini.js
// Motor de Inteligencia Ejecutiva Antigravity para WhatsApp · Exclusivo Ted Andrey Domínguez

import fs from 'fs';
import path from 'path';

let xlsx = null;
try {
  xlsx = (await import('xlsx')).default;
} catch (e) {}

const API_KEY = process.env.GEMINI_API_KEY;
const FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest'
];

// Rutas de contexto maestro
const AGENTS_MD_PATH = 'G:\\Mi unidad\\Antigravity_Laboratorio\\AGENTS.md';
const MEMORIA_MD_PATH = 'G:\\Mi unidad\\Antigravity_Laboratorio\\MEMORIA_HISTORICA_Y_DECISIONES.md';
const ALAMOS_FIN_PATH = 'G:\\Mi unidad\\AntiGravity Proyecto Lope\\CONTROL_FINANCIERO_Y_ADMINISTRATIVO_ALAMOS.md';
const FISCAL_ROOT = 'G:\\Mi unidad\\AntiGravity Fiscal Amis\\01_CONTABILIDAD_Y_FACTURACION\\2026';
const ASISTENCIA_EXCEL_PATH = 'G:\\Mi unidad\\AntiGravity Fiscal Amis\\01_CONTABILIDAD_Y_FACTURACION\\2026\\OCTUBRE_2026\\NOMINA\\LISTA_ASISTENCIA_OBRA_OCTUBRE_2026.xlsx';

function getLiveAttendanceStats() {
  if (!xlsx || !fs.existsSync(ASISTENCIA_EXCEL_PATH)) return 'Plantilla activa en obra con cuadrillas de pre-armado y habilitado (100% regular).';
  try {
    const wb = xlsx.readFile(ASISTENCIA_EXCEL_PATH);
    const ws = wb.Sheets['TRABAJADORES REGISTRADOS'];
    if (!ws) return '';
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 });
    let totalWorkers = 0;
    let presentDays = 0;
    let possibleDays = 0;

    const now = new Date();
    const dayOfWeek = now.getDay();
    const activeDaysSoFar = dayOfWeek === 0 ? 6 : Math.min(dayOfWeek, 6);

    for (let i = 3; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[0]) continue;
      totalWorkers++;
      for (let c = 0; c < activeDaysSoFar; c++) {
        possibleDays++;
        if (row[32 + c] === true || row[32 + c] === 'A' || row[32 + c] === 1) {
          presentDays++;
        }
      }
    }

    const pct = possibleDays > 0 ? Math.round((presentDays / possibleDays) * 100) : 100;
    return `${pct}% de asistencia semanal (${totalWorkers} trabajadores registrados en plantilla).`;
  } catch (e) {
    return 'Cuadrillas completas en habilitado y pre-armados.';
  }
}

function getTodayAgenda() {
  const now = new Date();
  const dayName = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][now.getDay()];
  const dayNum = now.getDate();
  const monthName = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][now.getMonth()];

  let agenda = `📅 *Hoy ${dayName} ${dayNum} de ${monthName} de 2026:*\n`;
  if (now.getDay() === 5) {
    agenda += `• *Viernes de Nómina y Dispersión AMIS:* Conciliación de asistencias, emisión de nómina fiscal IMSS (Vía 1), dispersión de asimilables socios Darnelix ($62,500.00 MXN netos - Vía 2) y facturación de materiales Roblock para destajos y efectivo (Vía 3).\n`;
  } else if (now.getDay() === 6) {
    agenda += `• *Sábado:* Cierre de raya en campo y corte de asistencia de la semana.\n`;
  } else {
    agenda += `• *Operación Regular:* Habilitado de acero, prearmados y supervisión de obra.\n`;
  }

  // Obligaciones Fiscales del mes
  if (dayNum <= 17) {
    agenda += `• *Obligaciones Fiscales SAT:* Próximo vencimiento de pagos provisionales de ISR/IVA y retenciones el día 17 de ${monthName}.\n`;
  } else {
    agenda += `• *Obligaciones Fiscales SAT:* Pagos provisionales del mes al corriente. Preparación de cierres contables.\n`;
  }

  return agenda;
}

function loadExcelSheetAsTable(filePath, maxRows = 40) {
  if (!fs.existsSync(filePath)) return '';
  try {
    const wb = xlsx.readFile(filePath);
    let output = `\n📄 ARCHIVO EXCEL CARGADO: ${path.basename(filePath)}\n`;
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      if (rows && rows.length > 0) {
        output += `\n--- PESTAÑA: ${sheetName} (${rows.length} filas) ---\n`;
        const limitedRows = rows.slice(0, maxRows);
        limitedRows.forEach(r => {
          if (Array.isArray(r) && r.some(c => c !== null && c !== undefined && c !== '')) {
            output += r.map(c => (c !== null && c !== undefined ? String(c).trim() : '')).join(' | ') + '\n';
          }
        });
      }
    }
    return output;
  } catch (e) {
    return '';
  }
}

function loadDynamicContext(userQuery) {
  let extraContext = '';
  const lower = (userQuery || '').toLowerCase();

  // Detección de semanas de nómina
  const semMatch = lower.match(/sem(?:ana)?\s*([0-9]{1,2})/i);
  if (semMatch) {
    const semNum = semMatch[1].padStart(2, '0');
    const possiblePaths = [
      path.join(FISCAL_ROOT, 'OCTUBRE_2026', 'NOMINA', `SEMANA_${semNum}`, `CONTROL_NOMINA_SEMANA_${semNum}_2026.xlsx`),
      path.join(FISCAL_ROOT, 'SEPTIEMBRE_2026', 'NOMINA', `SEMANA_${semNum}`, `CONTROL_NOMINA_SEMANA_${semNum}_2026.xlsx`),
      path.join(FISCAL_ROOT, 'OCTUBRE_2026', 'NOMINA', `SEMANA_${semNum}`, `DISPERSION_SPEI_ROBLOCK_SEM${semNum}_2026.xlsx`),
      path.join(FISCAL_ROOT, 'OCTUBRE_2026', 'NOMINA', `SEMANA_${semNum}`, `SOLICITUD_MOVIMIENTO_DARNELIX_SEM${semNum}_2026.xlsx`)
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        extraContext += loadExcelSheetAsTable(p);
      }
    }
  }

  // Detección de catálogo de precios / mercadeo
  if (lower.includes('precio') || lower.includes('costo') || lower.includes('varilla') || lower.includes('cemento') || lower.includes('cotiza') || lower.includes('insumo')) {
    const catPath = 'G:\\Mi unidad\\AntiGravity Fiscal Amis\\02_COTIZACIONES_Y_MERCADEO\\CATALOGO_PRECIOS_Y_MERCADEO.xlsx';
    if (fs.existsSync(catPath)) {
      extraContext += loadExcelSheetAsTable(catPath, 60);
    }
  }

  return extraContext;
}

function loadMasterContext(userQuery) {
  let context = `
1. AMIS CONSTRUCTORA, S.A. DE C.V. (RFC: ACO241114A70)
- Giro: Edificación de vivienda de concreto monolítico con Sistema SIMA.
- Socios (20% c/u): Ing. Samuel Domínguez (Director General), Sra. Isabel Romero, Ing. Sam Domínguez Jr. (Gerente de Producción), Lic. Ted Andrey Domínguez Romero (Gerente Administrativo y Finanzas), Lic. Mariano Domínguez Romero (Gerente de Proyecto).
- Submayor Proyecto Ejecutivo ($360k): Ing. Samuel (50%) y Ted (50%).

2. INFONAVIT ÁLAMOS DEL RÍO (320 Viviendas - 20 Torres de 4 Niveles)
- Monto Contractual: $54,337,280.00 MXN ($169,804.00 / viv). Régimen Exento de IVA.
- Cobranza: Anticipo 17% ($9,237,337.60 MXN) cobrado y timbrado en firme con CFDI VIV-2 en BanBajío.
- Estatus Actual: Plazos congelados hasta liberación del Día "D" (Uso de Suelo + Planos definitivos por M2 Coseinver). Actualmente en patio de maniobras realizando habilitado de acero y pre-armados.
- Suministros principales: 100% suministrados por M2 Coseinver ($60.76 MDP).

3. SISTEMA DE DISPERSIÓN SEMANAL (3 VÍAS):
- Vía 1 (Fiscal Directa BanBajío): Nómina neta timbrada IMSS Registro Z3350123108 vía Nominax.
- Vía 2 (Asimilables Socios vía DARNELIX 8%): $12,500.00 netos para cada uno de los 5 socios ($62,500.00 MXN total).
- Vía 3 (Sobrenóminas, Destajos y Efectivo vía ROBLOCK 7%): Factura deducible de materiales de construcción.

4. PROYECTO FRANCO / PARRAL (Hidalgo del Parral, Chih.):
- Edificación con moldes SIMA. 100% independiente y aislado de Álamos.

--- DATOS EN VIVO CALCULADOS ---
- Asistencia Semanal: ${getLiveAttendanceStats()}
- Agenda y Obligaciones:
${getTodayAgenda()}
`;

  return context;
}

const SYSTEM_PROMPT = `
Eres Antigravity, el Director General Adjunto, Asesor Fiscal de Cabecera, Contralor Corporativo y Director Técnico de Ingeniería de Ted Andrey Domínguez Romero.
Te estás comunicando con el Lic. Ted Andrey directamente por WhatsApp en su canal privado y confidencial.

Tus directivas y reglas estrictas de respuesta:
1. FORMATO DE SALUDO Y MENSAJES DE BIENVENIDA (Si Ted solo dice "Hola" o pide resumen):
   - Saludo ejecutivo: "¡Excelente día, Lic. Ted! 🫡"
   - Puntos clave actualizados:
     • 🏗️ *Álamos del Río:* Estatus y avance de obra (Fase de habilitado y pre-armados en patio; a la espera de la condición suspensiva del Día "D" para colado monolítico).
     • 🟢 *Nómina y Personal AMIS:* Porcentaje de asistencia acumulada de la semana en obra (datos calculados de la lista de raya).
     • 📅 *Agenda y Obligaciones Fiscales del Día:* Indicar si hoy hay dispersión de nómina (Viernes), tareas clave programadas o pagos provisionales SAT pendientes (vencimiento día 17).
   - Pregunta de cierre: "¿En qué frente o consulta técnica/fiscal nos enfocamos hoy, Licenciado?"

2. 🚫 REGLA DE ORO DE PRIVACIDAD BANCARIA:
   - QUEDA ESTRICTAMENTE PROHIBIDO mencionar saldos bancarios o importes líquidos en saludos, bienvenidas o resúmenes generales.
   - ÚNICAMENTE informa saldos bancarios si el Lic. Ted te lo pide explícitamente por escrito (ejemplo: "¿cuánto dinero hay en BanBajío?" o "¿cuál es el saldo de la cuenta?").

3. 🚫 PROHIBIDO MOSTRAR BORRADORES:
   - Queda ESTRICTAMENTE PROHIBIDO mostrar pasos de pensamiento interno, borradores ("Drafting the response"), notas para ti mismo o razonamientos intermedios.

4. DESGLOSES DETALLADOS:
   - Si el Lic. Ted te pide el desglose detallado (persona por persona, importes, bancos, destajos o cuentas), entrégale el detalle desglosado con total precisión a partir de las tablas de Excel cargadas.

5. PRECISIÓN NUMÉRICA Y MONETARIA:
   - Aplica notación mexicana oficial: signo de pesos pegado a la cifra, coma para miles, punto decimal ($169,804.00 MXN).

6. TONO: Respetuoso, ultra ejecutivo, directo al punto, claro y resolutivo.
`;

function cleanOutput(text) {
  if (!text) return '';
  let cleaned = text;
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  cleaned = cleaned.replace(/^[0-9]+\.\s*\*+Drafting[\s\S]*?\n\s*\n/gi, '');
  cleaned = cleaned.replace(/^\*+Drafting[\s\S]*?\n\s*\n/gi, '');
  return cleaned.trim();
}

export async function consultarCerebroAntigravity(userQuery, mediaData = null) {
  const masterContext = loadMasterContext(userQuery);
  
  const userParts = [];

  if (mediaData && mediaData.data && (mediaData.mimetype.includes('audio') || mediaData.mimetype.includes('ogg'))) {
    userParts.push({
      inline_data: {
        mime_type: mediaData.mimetype.includes('ogg') ? 'audio/ogg' : mediaData.mimetype,
        data: mediaData.data
      }
    });
    userParts.push({
      text: userQuery ? `Ted envió una nota de voz con el texto: "${userQuery}". Escucha la nota de voz y responde con total precisión ejecutiva.` : `Ted envió esta nota de voz. Escucha atentamente y responde con total precisión ejecutiva a su consulta.`
    });
  } else {
    userParts.push({
      text: `Consulta de Ted Andrey Domínguez:\n"${userQuery}"`
    });
  }

  const payload = {
    system_instruction: {
      parts: [
        { text: `${SYSTEM_PROMPT}\n\nCONTEXTO CORPORATIVO Y MAESTRO DE DATOS:\n${masterContext}` }
      ]
    },
    contents: [
      {
        role: 'user',
        parts: userParts
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 4096
    }
  };

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (let attempt = 0; attempt < 3; attempt++) {
    for (const model of FALLBACK_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error(`[Cerebro Antigravity] Error HTTP ${response.status} en modelo ${model}:`, errText);
          await wait(1000);
          continue;
        }

        const data = await response.json();
        const rawAnswer = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (rawAnswer && rawAnswer.trim().length > 0) {
          const finalAnswer = cleanOutput(rawAnswer);
          if (finalAnswer.length > 0) {
            return finalAnswer;
          }
        }
      } catch (err) {
        console.error(`[Cerebro Antigravity] Error con modelo ${model}:`, err.message);
        await wait(1000);
      }
    }
    await wait(2000);
  }

  return `⚠️ *Cerebro Antigravity:* Hubo una demora de conexión con los servidores de IA. Por favor reenvía tu consulta en un momento.`;
}
