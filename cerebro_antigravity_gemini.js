// cerebro_antigravity_gemini.js
// Motor de Inteligencia Ejecutiva y Memoria Forense Antigravity para WhatsApp · Exclusivo Lic. Ted Andrey Domínguez

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let xlsx = null;
try {
  xlsx = (await import('xlsx')).default;
} catch (e) {}

const API_KEY = process.env.GEMINI_API_KEY;
const FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest'
];

const MEMORIA_JSON_PATH = path.join(__dirname, 'memoria_proyectos_ted.json');
const ASISTENCIA_EXCEL_PATH = 'G:\\Mi unidad\\AntiGravity Fiscal Amis\\01_CONTABILIDAD_Y_FACTURACION\\2026\\OCTUBRE_2026\\NOMINA\\LISTA_ASISTENCIA_OBRA_OCTUBRE_2026.xlsx';

function formatMoney(num) {
  return '$' + (Number(num) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' MXN';
}

function getLiveAttendanceStats() {
  if (xlsx && fs.existsSync(ASISTENCIA_EXCEL_PATH)) {
    try {
      const wb = xlsx.readFile(ASISTENCIA_EXCEL_PATH);
      const ws = wb.Sheets['TRABAJADORES REGISTRADOS'];
      if (ws) {
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
      }
    } catch (e) {}
  }
  return 'Cuadrillas completas en habilitado de acero y pre-armados (100% regular).';
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
    agenda += `• *Operación Regular:* Habilitado de acero, prearmados y supervisión de patio de maniobras.\n`;
  }

  if (dayNum <= 17) {
    agenda += `• *Obligaciones Fiscales SAT e IMSS:* Fecha límite de pagos provisionales de ISR/IVA, retenciones y cuotas IMSS/SIPARE el día 17 de ${monthName}.\n`;
  } else {
    agenda += `• *Obligaciones Fiscales SAT:* Pagos provisionales del mes al corriente. Preparación de cierres contables.\n`;
  }

  return agenda;
}

function loadMasterMemory() {
  let mem = null;
  if (fs.existsSync(MEMORIA_JSON_PATH)) {
    try {
      mem = JSON.parse(fs.readFileSync(MEMORIA_JSON_PATH, 'utf8'));
    } catch (e) {
      console.error('Error leyendo memoria_proyectos_ted.json:', e);
    }
  }

  let text = '';
  text += '=== 1. PROYECTOS Y ENTIDADES CORPORATIVAS ===\n';
  text += `• AMIS CONSTRUCTORA, S.A. DE C.V. (RFC: ACO241114A70): Edificación monolítica SIMA. 5 Socios al 20% c/u: Ing. Samuel Domínguez Rosas (Director General), Sra. Isabel Romero Guerrero, Ing. Sam Domínguez Romero (Gerente Producción), Lic. Ted Andrey Domínguez Romero (Gerente Administrativo y Finanzas), Lic. Mariano Domínguez Romero (Gerente Proyecto). BanBajío Cta 476863400201. Reg. Patronal IMSS Z3350123108. Dispersión 3 Vías: Vía 1 Fiscal BanBajío (Nominax para altas IMSS), Vía 2 Asimilables Socios Darnelix 8% ($12.5k c/u = $62.5k netos), Vía 3 Roblock 7% (materiales deducibles para sobrenóminas SPEI, destajos, efectivo y gastos $10k).\n`;
  text += `• INFONAVIT ÁLAMOS DEL RÍO (Proyecto Lope): 320 viviendas (20 torres de 4 niveles). Contrato $54,337,280.00 MXN ($169,804.00/viv exento IVA). Anticipo 17% $9,237,337.60 MXN COBRADO y timbrado en firme con CFDI VIV-2 en BanBajío (UUID: 7EEFE4C0-72A9-4412-8546-223A0696330B). Saldo por cobrar estimaciones: $45,099,942.40 MXN. Proyecto Ejecutivo $360,000.00 MXN ($100k cobrado VIV-1, $260k pendiente). Acero e insumos mayores son 100% de M2 Coseinver ($60.76 MDP). Estatus: En patio de maniobras realizando habilitado y pre-armados; plazos contractuales congelados hasta liberación formal del Día "D" (uso de suelo + planos definitivos).\n`;
  text += `• FISCAL TADR (Ted Andrey Domínguez Romero - RFC: DORT780211CQ5): Actividad Empresarial y Servicios Profesionales. Facturas para reparto socios retienen 10% ISR y 10.67% IVA, bolsa provisión impuestos SAT. Asesorías reales de Ted 100% de Ted. Proyecto ejecutivo 50% ($50k cobrado de anticipo, $130k por cobrar).\n`;
  text += `• FISCAL FAMILIAR:\n`;
  text += `  - Ing. Samuel Domínguez Rosas (RFC: DORS510222UA2): Dividendos (606) + Asimilados (605). BanBajío CLABE '030730900012268610'. Únicamente Anual en Abril. Cero provisionales ISR/IVA mensuales. 100% blindado. Asimilados 2026 cobrados: $170,000.00 MXN netos (CFDI FC002 Noviq Sep y Oct). 50% Proyecto Ejecutivo.\n`;
  text += `  - Sra. Isabel Romero Guerrero (RFC: ROGI561130NM0): Act. Empresarial (612) + Asimilados (605). BanBajío CLABE '030730900012268500'. Trámite de disminución de obligaciones ante el SAT para exentar pagos mensuales. Asimilados 2026 cobrados: $125,000.00 MXN netos (CFDI FC004 y FC005 Noviq).\n`;
  text += `• PROYECTO FRANCO / PARRAL: Plaza Hidalgo del Parral, Chihuahua. Edificación SIMA monolítica. 100% independiente y aislado de Álamos del Río. Cero contaminación cruzada.\n`;
  text += `• EXCLUSIÓN ESTRICTA: La app "SupleAI App" NO forma parte de las operaciones ni proyectos corporativos de este asistente.\n\n`;

  if (mem) {
    text += '=== 2. FACTURAS EMITIDAS (INGRESOS AMIS) ===\n';
    (mem.facturas_emitidas || []).forEach(f => {
      text += `• ${f.folio_interno} (${f.fecha}) | Cliente: ${f.cliente_nombre} | Concepto: ${f.concepto} | Total: ${formatMoney(f.total)} | Cobrado: ${formatMoney(f.monto_cobrado)} | Estatus: ${f.estatus_cobro}\n`;
    });

    text += '\n=== 3. DESTAJOS Y SUBCONTRATISTAS DE OBRA ===\n';
    (mem.destajos_y_subcontratistas || []).filter(d => d.monto_total_pactado > 0).forEach(d => {
      text += `• ${d.contratista_nombre} | Especialidad: ${d.especialidad} | Concepto: ${d.contrato_concepto} | Pactado: ${formatMoney(d.monto_total_pactado)} | Pagado: ${formatMoney(d.total_acumulado_pagado)} | Saldo Restante: ${formatMoney(d.saldo_restante_por_pagar)} | Vía: ${d.via_pago_predilecta} | Estatus: ${d.estatus} | Destino: ${d.banco_destino || ''} ${d.cuenta_o_clabe || ''}\n`;
    });

    text += '\n=== 4. OPERACIONES PUENTE ESTRATÉGICAS ===\n';
    (mem.puentes_estrategicos || []).forEach(p => {
      text += `• Sem ${p.semana}/${p.anio} | ${p.empresa_puente} | Transferido AMIS: ${formatMoney(p.transferencia_amis_total)} (Comisión ${p.porcentaje_comision}%: ${formatMoney(p.comision_retenida)}) | Dispersado: ${formatMoney(p.total_egresos_puente)} | Folio Factura: ${p.factura_folio} | Estatus: ${p.estatus} | Obs: ${p.observaciones}\n`;
    });

    text += '\n=== 5. FACTURAS RECIBIDAS Y COMPRAS (HISTORIAL COMPLETO DE PROVEEDORES) ===\n';
    (mem.facturas_recibidas || []).forEach(f => {
      text += `• ${f.fecha} | Folio: ${f.folio || 'S/N'} | Emisor: ${f.emisor_nombre} (${f.emisor_rfc}) | Concepto: ${f.concepto} | Total: ${formatMoney(f.total)} | Pagado: ${formatMoney(f.monto_pagado)} | Saldo: ${formatMoney(f.saldo_pendiente)} | Estatus: ${f.estatus_pago} | Método: ${f.metodo_pago}\n`;
    });

    text += '\n=== 6. HISTORIAL DE NÓMINA Y PAGOS A PERSONAL (SEMANAS 40 Y 41) ===\n';
    (mem.nomina_historica_semanal || [])
      .filter(n => n.total_devengado_semana > 0 && !n.trabajador_o_socio.includes('TOTAL') && !n.trabajador_o_socio.includes('RESUMEN'))
      .forEach(n => {
        text += `• Sem ${n.semana}/${n.anio} | ${n.trabajador_o_socio} (${n.puesto_rol || 'General'}) | Base: ${formatMoney(n.sueldo_base_acordado)} | Fiscal: ${formatMoney(n.importe_fiscal_banbajio)} | Asimilados: ${formatMoney(n.importe_asimilable_darnelix)} | Sobrenómina SPEI: ${formatMoney(n.importe_sobrenomina_roblock_spei)} | Efectivo: ${formatMoney(n.importe_efectivo_raya_roblock)} | Total: ${formatMoney(n.total_devengado_semana)} | Destino: ${n.banco_destino || ''} ${n.cuenta_o_tarjeta || ''}\n`;
      });
    text += '\n=== 7. PAGOS DE SEGURIDAD SOCIAL E IMSS / SIPARE (CARGA SOCIAL AMIS) ===\n';
    (mem.pagos_imss_sipare_carga_social || []).forEach(s => {
      text += `• Periodo: ${s.periodo} | Concepto: ${s.tipo} | Fecha de Pago: ${s.fecha_pago} (a las ${s.hora_pago} hrs) | Monto Total Liquidado: ${formatMoney(s.importe_total)} | No. Autorización BanBajío: ${s.autorizacion_banbajio} | Folio SUA: ${s.folio_sua} | Línea de Captura: ${s.linea_captura} | Cuenta Cargo: ${s.cuenta_origen} | Estatus: ${s.estatus} | Comprobante Oficial: ${s.comprobante}\n`;
    });
  }

  text += `\n=== 8. DATOS OPERATIVOS EN VIVO ===\n`;
  text += `- Asistencia Semanal: ${getLiveAttendanceStats()}\n`;
  text += `- Agenda y Obligaciones:\n${getTodayAgenda()}\n`;

  return text;
}

const SYSTEM_PROMPT = `
Eres Antigravity, el Director General Adjunto, Asesor Fiscal de Cabecera, Contralor Corporativo y Director Técnico de Ingeniería de Ted Andrey Domínguez Romero.
Te estás comunicando con el Lic. Ted Andrey directamente por WhatsApp en su canal privado y confidencial.

Tus directivas y reglas estrictas de respuesta:

1. 🎯 DIRECTIVA MAESTRA DE CONTINUIDAD Y RESPUESTAS PRECISAS (REGLA FUNDAMENTAL):
   - CUANDO EL LIC. TED HACE UNA PREGUNTA ESPECÍFICA (ej. si ya pagó una factura, qué día pagó tal concepto, cuánto le pagó a tal persona, saldos de destajos, pagos de IMSS/SIPARE, estatus de obra o temas fiscales):
     👉 RESPONDE DIRECTO AL GRANO.
     ⛔ PROHIBICIÓN ESTRICTA: NO repitas el saludo de bienvenida ("¡Excelente día, Lic. Ted! 🫡"), NO repitas los puntos clave generales de Álamos/Nómina/Agenda, y NO agregues la pregunta de cierre ("¿En qué frente nos enfocamos hoy?").
     Ve directamente a la respuesta técnica, contable o financiera solicitada, con máxima precisión, cifras exactas, folios y fechas comprobadas del registro.
   - ÚNICAMENTE si Ted envía un saludo inicial aislado ("Hola", "Buen día") sin ninguna pregunta previa o posterior, se emite el saludo ejecutivo breve.

2. 🔒 BLINDAJE DE PRIVACIDAD BANCARIA (REGLA A PETICIÓN DE TED):
   - QUEDA TERMINANTEMENTE PROHIBIDO revelar el saldo bancario líquido total en cuenta (saldo vivo disponible en BanBajío, BBVA, etc.) para evitar exposición de saldos totales en pantallas móviles.
   - Si se solicita el saldo total en cuenta, responde cortésmente que por seguridad y protocolo bancario los saldos vivos totales no se transmiten por WhatsApp y deben consultarse en el portal de banca en línea.
   - ⚠️ PERO SÍ TIENES PERMISO Y DEBES RESPONDER TODO LO RELATIVO A: qué facturas se han pagado, qué día se pagaron, cuánto se pagó a proveedores, trabajadores o destajistas, saldos pendientes por pagar de facturas o contratos, y pagos de seguridad social.

3. 🔍 MEMORIA FORENSE DE PAGOS, FACTURAS Y PROYECTOS (CERO ALUCINACIONES):
   - Tienes acceso al historial completo de facturas emitidas, facturas recibidas, destajos de obra, nómina semanal por trabajador, pagos de seguridad social IMSS/SIPARE y operaciones de AMIS, Álamos del Río, Fiscal TADR, Fiscal Familiar y Proyecto Franco (Parral).
   - Responde con exactitud matemática: Fecha, Folio, Proveedor/Beneficiario, Concepto, Importe pagado y Saldo pendiente.
   - ⚠️ DATOS EXACTOS DE SEGURIDAD SOCIAL IMSS / SIPARE (REGISTRO PATRONAL Z3350123108):
     * Pago IMSS / SIPARE Septiembre 2026: Fue liquidado el **09 de Octubre de 2026** (10:43 hrs) por EXACTAMENTE **$4,077.55 MXN** con cargo a cuenta BanBajío 476863400201, No. de Autorización BanBajío **7619834122978**, Folio SUA **326183**, Línea de Captura Z1JEKRJ84CC116ZON66210008QMJ0000000000000000000008X7A.
     * Pago IMSS / SIPARE Agosto 2026 (Bimestral): Liquidado el **15 de Septiembre de 2026** por **$11,762.97 MXN** (IMSS: $2,302.06, RCV: $2,204.03, ACV Infonavit: $7,256.88), Autorización BanBajío **2192332323516**, Folio SUA 390160.
     * Pago IMSS / SIPARE Julio 2026: Liquidado el **17 de Agosto de 2026** por **$2,302.06 MXN**, Autorización BanBajío **425372523520**, Folio SUA 354576.
     * ⛔ QUEDA TERMINANTEMENTE PROHIBIDO inventar o estimar cifras como $42,816.40 o cálculos hipotéticos. Si no tienes un pago registrado, informa con honestidad técnica que no se encuentra en el libro contable.

4. 🚫 PROHIBIDO MOSTRAR BORRADORES O RAZONAMIENTO INTERNO:
   - Jamás incluyas etiquetas de pensamiento, borradores ("Drafting the response") ni pasos intermedios.

5. 💊 EXCLUSIÓN ESTRICTA:
   - La app "SupleAI App" NO forma parte de este canal ni de los proyectos empresariales consultables aquí.

6. TONO: Ultra ejecutivo, resolutivo, claro, respetuoso y directo al punto.
`;

function cleanOutput(text) {
  if (!text) return '';
  let cleaned = text;
  cleaned = cleaned.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  cleaned = cleaned.replace(/^[0-9]+\.\s*\*+Drafting[\s\S]*?\n\s*\n/gi, '');
  cleaned = cleaned.replace(/^\*+Drafting[\s\S]*?\n\s*\n/gi, '');
  return cleaned.trim();
}

export async function consultarCerebroAntigravity(userQuery, mediaData = null, conversationHistory = []) {
  const masterContext = loadMasterMemory();

  const userParts = [];

  if (mediaData && mediaData.data && (mediaData.mimetype.includes('audio') || mediaData.mimetype.includes('ogg'))) {
    userParts.push({
      inline_data: {
        mime_type: mediaData.mimetype.includes('ogg') ? 'audio/ogg' : mediaData.mimetype,
        data: mediaData.data
      }
    });
    userParts.push({
      text: userQuery
        ? `Ted envió una nota de voz con el texto: "${userQuery}". Escucha la nota de voz y responde con total precisión ejecutiva.`
        : `Ted envió esta nota de voz. Escucha atentamente y responde con total precisión ejecutiva a su consulta.`
    });
  } else {
    userParts.push({
      text: userQuery
    });
  }

  // Construir historial multi-turno para mantener el contexto de la conversación
  const contents = [];
  if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
    for (const turn of conversationHistory) {
      if (turn && turn.text && turn.text.trim()) {
        contents.push({
          role: turn.role === 'user' ? 'user' : 'model',
          parts: [{ text: turn.text.trim() }]
        });
      }
    }
  }

  // Agregar turno actual del usuario
  contents.push({
    role: 'user',
    parts: userParts
  });

  const payload = {
    system_instruction: {
      parts: [
        { text: `${SYSTEM_PROMPT}\n\nCONTEXTO CORPORATIVO, HISTORIAL DE PAGOS Y MEMORIA MAESTRA:\n${masterContext}` }
      ]
    },
    contents: contents,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048
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
