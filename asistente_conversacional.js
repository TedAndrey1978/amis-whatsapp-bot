// C:\Users\Usuario\.antigravity_tools\whatsapp\asistente_conversacional.js
// Asistente Virtual Operativo AMIS CONSTRUCTORA · Con Módulo Ejecutivo Antigravity

import { consultarCerebroAntigravity } from './cerebro_antigravity_gemini.js';

const KNOWLEDGE_BASE = {
  fiscal: {
    razon_social: "AMIS CONSTRUCTORA, S.A. DE C.V.",
    rfc: "ACO241114A70",
    regimen: "601 - General de Ley Personas Morales",
    uso_cfdi: "G03 (Gastos en general) o G01 (Adquisición de mercancías)",
    instrucciones: "Solicita tu factura con estos datos y súbela aquí mismo seleccionando la opción 1️⃣ del menú (o adjuntando el archivo PDF/XML)."
  },
  sima_tecnico: {
    sistema: "Obra Gris Monolítica con Sistema de Moldes SIMA.",
    rotacion: "El ciclo óptimo de rotación del molde es de 24 horas.",
    buenas_practicas: "Aplicar desmoldante uniforme, vibrado adecuado para evitar oquedades y curado continuo con agua/membrana."
  },
  cortes_operativos: {
    horario_obra: "Lunes a Viernes de 8:30 AM a 5:30 PM, y Sábados de 8:30 AM a 1:30 PM.",
    corte_asistencia: "Revisión y conciliación de asistencia para la nómina semanal."
  }
};

// Palabras o temas terminantemente prohibidos para personal operativo (Saldos, contratos, precios, utilidades)
const FORBIDDEN_PATTERNS = [
  /saldo/i,
  /cuenta\s*bancaria/i,
  /cuentas/i,
  /banco/i,
  /baj[ií]o/i,
  /transferencia/i,
  /movimiento\s*financiero/i,
  /contrato\s*de\s*obra/i,
  /monto\s*contractual/i,
  /millon/i,
  /mdp/i,
  /utilidad/i,
  /ganancia/i,
  /reparto/i,
  /darnelix/i,
  /roblock/i,
  /comisi[oó]n/i,
  /precio\s*unitario/i,
  /cu[aá]nto\s*vale/i,
  /cu[aá]nto\s*cuesta\s*la\s*casa/i,
  /cu[aá]nto\s*nos\s*pagan/i,
  /sueldo\s*de/i,
  /n[oó]mina\s*de\s*los\s*socios/i,
  /organigrama/i,
  /estructura\s*interna/i,
  /socios/i
];

export async function generateConversationalReply(userText, authUser, mediaData = null) {
  const text = (userText || '').trim();
  const lower = text.toLowerCase();

  // -------------------------------------------------------------
  // 👑 REGLA DE ACCESO TOTAL Y EXCLUSIVO PARA EL LIC. TED ANDREY
  // -------------------------------------------------------------
  const isTed = authUser && (
    (authUser.name && authUser.name.toLowerCase().includes('ted')) ||
    ['6676921223', '6672921223'].some(p => 
      (authUser.phone && authUser.phone.includes(p)) || 
      (authUser.lid && authUser.lid.includes(p))
    )
  );

  if (isTed) {
    const isGreeting = /^(hola|buenos\s*d[ií]as|buenas\s*tardes|buenas\s*noches|qu[eé]\s*hay|saludos|inicio|menu|men[uú])$/i.test(lower);
    if (isGreeting) {
      const now = new Date();
      const dayName = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][now.getDay()];
      const dayNum = now.getDate();
      const monthName = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][now.getMonth()];
      
      return (
        `¡Excelente día, Lic. Ted! 🫡\n\n` +
        `🏗️ *Álamos del Río:* Fase de arranque en patio de maniobras (habilitado y pre-armados; esperando liberación del Día "D" por M2 Coseinver para colado monolítico).\n` +
        `🟢 *Nómina y Personal AMIS:* Cuadrillas activas en habilitado de acero y pre-armados.\n` +
        `📅 *Hoy ${dayName} ${dayNum} de ${monthName} de 2026:*\n` +
        `• Conciliación de asistencias y dispersión de nómina AMIS.\n` +
        `• Obligaciones fiscales SAT: Próximo vencimiento de pagos provisionales el 17 de ${monthName}.\n\n` +
        `¿En qué frente o consulta técnica/fiscal nos enfocamos hoy, Licenciado?`
      );
    }
    // Si es consulta libre, conectamos con el Cerebro Antigravity
    return await consultarCerebroAntigravity(text, mediaData);
  }

  // -------------------------------------------------------------
  // 🔒 CANDADO ESTRICTO DE CONFIDENCIALIDAD PARA PERSONAL DE CAMPO
  // -------------------------------------------------------------
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(lower)) {
      return (
        `🛡️ *Información Restringida / Control Interno*\n\n` +
        `Por políticas estrictas de confidencialidad y control corporativo de AMIS Constructora, este tema no se consulta por este canal.\n\n` +
        `👤 *Para cualquier duda administrativa o autorización, por favor comunícate directamente con el Lic. Ted Andrey Domínguez (Gerente Administrativo).*`
      );
    }
  }

  // 2. Consulta de Datos Fiscales / RFC / Facturas
  if (lower.includes('rfc') || lower.includes('factura') || lower.includes('razon social') || lower.includes('razón social') || lower.includes('datos fiscales') || lower.includes('comprobante fiscal') || lower.includes('regimen') || lower.includes('régimen') || lower.includes('cfdi')) {
    return (
      `🏛️ *DATOS FISCALES PARA SOLICITAR FACTURA EN COMPRAS · AMIS CONSTRUCTORA*\n\n` +
      `• *Razón Social:* ${KNOWLEDGE_BASE.fiscal.razon_social}\n` +
      `• *RFC:* \`${KNOWLEDGE_BASE.fiscal.rfc}\`\n` +
      `• *Régimen Fiscal:* ${KNOWLEDGE_BASE.fiscal.regimen}\n` +
      `• *Uso de CFDI:* ${KNOWLEDGE_BASE.fiscal.uso_cfdi}\n` +
      `• *Código Postal:* Culiacán, Sin.\n\n` +
      `📲 ${KNOWLEDGE_BASE.fiscal.instrucciones}\n\n` +
      `_Escribe *menu* para ver las opciones disponibles._`
    );
  }

  // 3. Dudas sobre Materiales o Requisiciones
  if (lower.includes('material') || lower.includes('cemento') || lower.includes('varilla') || lower.includes('herramienta') || lower.includes('pedir') || lower.includes('solicitar') || lower.includes('requisicion') || lower.includes('requisición')) {
    return (
      `📦 *CÓMO SOLICITAR MATERIALES O HERRAMIENTA*\n\n` +
      `Para registrar un pedido de obra:\n` +
      `1. Escribe el número *2* o envía tu solicitud con los insumos que requieres.\n` +
      `2. Indica cantidades, especificación y para qué torre u obra es (ej: _'20 bultos de cemento y 10 varillas 3/8 para Álamos Torre 3'_).\n` +
      `3. El sistema generará tu folio \`#MAT-\` y enviará la solicitud a Dirección para su revisión.\n\n` +
      `_Escribe *menu* para ver el menú principal._`
    );
  }

  // 4. Dudas sobre Reportes de Personal / Asistencia / Faltas / Nuevos Ingresos
  if (lower.includes('asistencia') || lower.includes('falta') || lower.includes('alta') || lower.includes('ingreso') || lower.includes('personal') || lower.includes('trabajador') || lower.includes('cuadrilla') || lower.includes('raya')) {
    const isAuthorized = authUser && ['GERENTE_ADMINISTRATIVO', 'ENCARGADO_PREARMADOS', 'ENCARGADO_MANTENIMIENTO_OBRA'].includes(authUser.role);
    if (isAuthorized) {
      return (
        `👷‍♂️ *CONTROL DE PERSONAL (ASISTENCIAS, FALTAS Y ALTAS)*\n\n` +
        `Para registrar novedades de personal en obra:\n` +
        `Escribe el número *3* para ingresar al menú de personal y elige:\n` +
        `1️⃣ *Lista de Asistencia Diaria:* Foto de lista de raya firmada o conteo de presentes.\n` +
        `2️⃣ *Reportar Falta o Baja:* Nombre del trabajador, puesto y motivo.\n` +
        `3️⃣ *Registrar Nuevo Ingreso / Alta:* Nombre completo, puesto y fecha de ingreso.\n\n` +
        `📊 La información se archivará con folio \`#ASIS-\` y se vinculará directamente a la nómina semanal.\n\n` +
        `_Escribe *menu* para ver todas tus opciones._`
      );
    } else {
      return (
        `⛔ *Módulo Restringido*\n\n` +
        `El registro de asistencias, faltas y altas de personal en campo está asignado exclusivamente a los supervisores autorizados (Bladimir, Emilio y Ted).\n\n` +
        `_Escribe *menu* para ver tus opciones disponibles._`
      );
    }
  }

  if (lower.includes('sima') || lower.includes('molde') || lower.includes('colado') || lower.includes('monolitico') || lower.includes('monolítico') || lower.includes('desmoldante') || lower.includes('fraguado')) {
    return (
      `🏗️ *SISTEMA CONSTRUCTIVO SIMA · INFORMACIÓN TÉCNICA*\n\n` +
      `• *Tecnología:* ${KNOWLEDGE_BASE.sima_tecnico.sistema}\n` +
      `• *Rotación:* ${KNOWLEDGE_BASE.sima_tecnico.rotacion}\n` +
      `• *Recomendaciones:* ${KNOWLEDGE_BASE.sima_tecnico.buenas_practicas}\n\n` +
      `_Escribe *menu* para volver._`
    );
  }

  // 5. Dudas sobre Horarios y Cortes
  if (lower.includes('horario') || lower.includes('hora') || lower.includes('corte') || lower.includes('sabado') || lower.includes('sábado') || lower.includes('domingo')) {
    return (
      `⏰ *HORARIOS OFICIALES DE ATENCIÓN Y CORTE*\n\n` +
      `• *Lunes a Viernes:* 8:30 AM a 5:30 PM\n` +
      `• *Sábados:* 8:30 AM a 1:30 PM\n` +
      `• *Domingos:* Sin labores (descanso).\n\n` +
      `📊 Las solicitudes y comprobantes se procesan y resguardan en tiempo real en los buzones de Google Drive.\n\n` +
      `_Escribe *menu* para ver tus opciones._`
    );
  }

  // 6. Saludo o Pregunta General No Clasificada para Colaboradores
  const senderName = authUser ? authUser.name : 'Colaborador';
  const hasAttendance = authUser && ['GERENTE_ADMINISTRATIVO', 'ENCARGADO_PREARMADOS', 'ENCARGADO_MANTENIMIENTO_OBRA'].includes(authUser.role);

  return (
    `🤖 *Asistente Virtual AMIS*\n\n` +
    `Hola ${senderName}. Recibí tu mensaje: _"${text.slice(0, 80)}"_.\n\n` +
    `¿En qué puedo orientarte hoy?\n` +
    `1️⃣ *Subir tickets o facturas de gasto*\n` +
    `2️⃣ *Solicitar materiales o herramienta*\n` +
    (hasAttendance ? `3️⃣ *Reportar asistencias, faltas o nuevos ingresos*\n` : '') +
    `🏛️ *Consultar RFC y datos fiscales:* escribe *RFC*\n\n` +
    `👉 _Responde con el número (1️⃣, 2️⃣ o 3️⃣), o escribe *menu* para ver el menú completo._`
  );
}
