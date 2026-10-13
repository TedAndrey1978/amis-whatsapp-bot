// asistente_conversacional.js
// Asistente Virtual Operativo AMIS CONSTRUCTORA · Con Módulo Ejecutivo Antigravity

import { consultarCerebroAntigravity, consultarCerebroProyectoFranco } from './cerebro_antigravity_gemini.js';

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

function isPureGreeting(text) {
  const trimmed = (text || '').trim();
  const lower = trimmed.toLowerCase();
  if (/[?¿]/.test(lower)) return false;

  const queryKeywords = [
    'pague', 'pagué', 'pagamos', 'pago', 'pagar', 'factura', 'cuanto', 'cuánto',
    'que', 'qué', 'cuando', 'cuándo', 'quien', 'quién', 'como', 'cómo',
    'donde', 'dónde', 'estatus', 'avance', 'saldo', 'destajo', 'nomina', 'nómina',
    'imss', 'sat', 'alamos', 'álamos', 'parral', 'costo', 'proveedor', 'roblock',
    'darnelix', 'jessica', 'otoniel', 'moises', 'aza', 'gasto', 'comprobante'
  ];
  if (queryKeywords.some(k => lower.includes(k))) return false;

  const pureGreetingRegex = /^(hola|hols|holi|holas|buen\s*d[ií]a|buenos\s*d[ií]as|buenas\s*tardes|buenas\s*noches|qu[eé]\s*hay|saludos|hey|qu[eé]\s*onda|buenas)(\s+(buenas|tardes|d[ií]as|noches|amigo|lic|licenciado|mariano|ted|samuel))?$/i;
  return pureGreetingRegex.test(lower) || (trimmed.length <= 30 && /^(hola|buen\s*d[ií]a|buenos\s*d[ií]as|buenas\s*tardes|buenas\s*noches|saludos|hey)/i.test(lower));
}

export async function generateConversationalReply(userText, authUser, mediaData = null, sessionState = null) {
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

  const isMariano = authUser && (
    (authUser.name && authUser.name.toLowerCase().includes('mariano')) ||
    ['6672526550'].some(p => 
      (authUser.phone && authUser.phone.includes(p)) || 
      (authUser.lid && authUser.lid.includes(p))
    )
  );

  if (isTed || isMariano) {
    const isGreeting = isPureGreeting(text);
    const now = Date.now();
    const lastGreeting = sessionState?.lastGreetingTime || 0;
    const hasRecentGreeting = (now - lastGreeting) < (3 * 3600 * 1000);
    const formalName = isTed ? 'Lic. Ted' : (isMariano ? 'Lic. Mariano' : (authUser?.name || 'Licenciado'));

    if (isGreeting && !hasRecentGreeting) {
      let greetingReply = '';
      if (isTed) {
        greetingReply = (
          `¡Excelente día, Lic. Ted! 🫡\n\n` +
          `Resumen ejecutivo al momento:\n` +
          `• 🏗️ *Álamos del Río:* Habilitado y pre-armados en patio; en espera de la condición suspensiva del Día "D" para colado monolítico.\n` +
          `• 🟢 *Personal AMIS:* Cuadrillas activas al 100% en habilitado de acero.\n` +
          `• ⚖️ *Control Fiscal:* Blindaje tributario al día.\n\n` +
          `¿En qué tema estratégico requieres apoyo o información hoy?`
        );
      } else {
        greetingReply = (
          `¡Excelente día, Lic. Mariano! 🫡\n\n` +
          `Resumen operativo al momento:\n` +
          `• 🏗️ *Álamos del Río:* Cuadrillas en patio avanzando en armado de acero y preparación de moldes SIMA.\n` +
          `• 📋 *Requisiciones:* Insumos y destajos en flujo normal con visto bueno administrativo.\n\n` +
          `¿En qué frente o coordinación de obra te apoyo hoy?`
        );
      }

      if (sessionState) {
        sessionState.lastGreetingTime = now;
        if (!sessionState.history) sessionState.history = [];
        sessionState.history.push({ role: 'user', text });
        sessionState.history.push({ role: 'model', text: greetingReply });
      }

      return greetingReply;
    }

    if (isMariano) {
      const blockedTopicsMariano = [/saldo/i, /cuenta\s*bancaria/i, /baj[ií]o/i, /darnelix/i, /roblock/i, /utilidad/i, /ganancia/i, /reparto/i];
      for (const pattern of blockedTopicsMariano) {
        if (pattern.test(lower)) {
          return (
            `🛡️ *Información Restringida / Control Administrativo*\n\n` +
            `Por políticas internas de control corporativo de AMIS Constructora, este tema financiero se consulta directamente con el Lic. Ted Andrey Domínguez (Gerente Administrativo).`
          );
        }
      }
    }

    const history = sessionState?.history || [];
    const reply = await consultarCerebroAntigravity(text, mediaData, history, authUser);

    if (sessionState) {
      if (!sessionState.history) sessionState.history = [];
      sessionState.history.push({ role: 'user', text });
      sessionState.history.push({ role: 'model', text: reply });
      if (sessionState.history.length > 12) {
        sessionState.history = sessionState.history.slice(-12);
      }
    }

    return reply;
  }

  // -------------------------------------------------------------
  // 🏛️ PERFIL EXCLUSIVO: ING. SAMUEL DOMÍNGUEZ (DIRECTOR GENERAL)
  // Permitido: 1. Gastos | 2. Consultas Proyecto Franco | 3. RFC
  // PROHIBICIÓN: Solicitar materiales por bot, Álamos y Tesorería
  // -------------------------------------------------------------
  const isSamuel = authUser && (
    (authUser.role === 'DIRECTOR_GENERAL') ||
    (authUser.name && authUser.name.toLowerCase().includes('samuel')) ||
    ['6672230733'].some(p => 
      (authUser.phone && authUser.phone.includes(p)) || 
      (authUser.lid && authUser.lid.includes(p))
    )
  );

  if (isSamuel) {
    // A. Solicitud de RFC o Datos Fiscales
    if (lower.includes('rfc') || lower.includes('factura') || lower.includes('razon social') || lower.includes('razón social') || lower.includes('datos fiscales') || lower.includes('cfdi')) {
      return (
        `🏛️ *DATOS FISCALES PARA FACTURACIÓN · AMIS CONSTRUCTORA*\n\n` +
        `• *Razón Social:* ${KNOWLEDGE_BASE.fiscal.razon_social}\n` +
        `• *RFC:* \`${KNOWLEDGE_BASE.fiscal.rfc}\`\n` +
        `• *Régimen Fiscal:* ${KNOWLEDGE_BASE.fiscal.regimen}\n` +
        `• *Uso de CFDI:* ${KNOWLEDGE_BASE.fiscal.uso_cfdi}\n` +
        `• *Código Postal:* Culiacán, Sin.\n\n` +
        `_Escriba *menu* para ver las opciones disponibles._`
      );
    }

    // B. Prohibición estricta de solicitar materiales por el bot
    if (lower.includes('material') || lower.includes('herramienta') || lower.includes('requisicion') || lower.includes('requisición') || lower.includes('pedir') || lower.includes('solicitar') || lower.includes('cemento') || lower.includes('varilla') || lower.includes('bulto') || lower.includes('insumo') || lower.includes('equipo')) {
      return (
        `📦 *Requisiciones de Materiales y Herramienta en Obra*\n\n` +
        `Estimado Ing. Samuel:\n` +
        `El levantamiento y solicitud de insumos, materiales y herramienta de campo se coordina directamente a través del Encargado de Pre-Armados (Ing. Emilio Peñuelas) y Mantenimiento de Obra (Bladimir Beltrán), con visto bueno de Gerencia Administrativa (Lic. Ted Andrey).\n\n` +
        `👤 _Para cualquier consulta técnica sobre especificaciones de insumos o cubicaciones de Proyecto Franco (Parral), con gusto puedo orientarle._`
      );
    }

    // C. Saludo Simple o Bienvenida: UN SOLO MENSAJE LIMPIO
    const isGreeting = ['hola', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches', 'saludos', 'que tal', 'qué tal'].some(g => lower.startsWith(g) || lower === g);
    if (isGreeting || lower === '') {
      return (
        `🤖 *Asistente Virtual AMIS · Dirección General*\n\n` +
        `Hola Ing. Samuel. Gusto en saludarle.\n\n` +
        `¿En qué puedo orientarle hoy?\n` +
        `1️⃣ *Subir ticket o factura de gasto*\n` +
        `2️⃣ *Consultar Proyecto Franco / Parral* (Planos, prototipo Sierra Bonita, volumetrías y moldes SIMA)\n` +
        `🏛️ *Consultar RFC y datos fiscales:* escriba *RFC*\n\n` +
        `👉 _Puede responder con el número (1️⃣ o 2️⃣), escribir su duda técnica sobre Parral o escribir RFC._`
      );
    }

    // D. Candado y Bloqueo Perimetral Estricto (Álamos del Río, Tesorería AMIS, Cuentas Personales Ted)
    const isBlockedTopic = [
      /alamos/i, /álamos/i, /lope/i, /coseinver/i, /viv-2/i,
      /saldo/i, /cuenta\s*bancaria/i, /cuentas/i, /banco/i, /baj[ií]o/i,
      /transferencia/i, /utilidad/i, /ganancia/i, /reparto/i,
      /darnelix/i, /roblock/i, /comisi[oó]n/i, /honorarios/i
    ].some(pat => pat.test(lower));

    if (isBlockedTopic) {
      return (
        `🛡️ *Alcance Operativo de Consulta*\n\n` +
        `Estimado Ing. Samuel:\n` +
        `Mi alcance operativo en este canal de asistencia virtual está configurado exclusivamente para la coordinación técnica, ingeniería, planos y costos del *Proyecto Franco / Parral (Chihuahua)*.\n\n` +
        `Para asuntos relativos a la tesorería corporativa general de AMIS, Álamos del Río o acuerdos administrativos, le solicito coordinarse directamente con la Gerencia Administrativa (Lic. Ted Andrey Domínguez).`
      );
    }

    // E. Consultas Técnicas Directas de Proyecto Franco (Parral)
    if (lower.includes('muro') || lower.includes('espesor') || lower.includes('sierra bonita') || lower.includes('prototipo')) {
      return (
        `📐 *PROYECTO FRANCO (PARRAL) · PROTOTIPO SIERRA BONITA*\n\n` +
        `Estimado Ing. Samuel:\n` +
        `• *Espesor de Muros:* Ajustado a **12 cm** de concreto monolítico.\n` +
        `• *Dimensiones de Lote Tipo:* **14.04 m** de frente por **15.00 m** de fondo.\n` +
        `• *Sistema Constructivo:* Moldes monolíticos SIMA con ciclo de rotación diario de **24 horas**.\n` +
        `• *Centro de Costos AMIS:* \`PRY-02-FRANCO\`.\n\n` +
        `_¿Desea consultar algún detalle sobre cubicaciones o planos?_`
      );
    }

    if (lower.includes('lote') || lower.includes('dimension') || lower.includes('dimensión') || lower.includes('medida') || lower.includes('terreno')) {
      return (
        `📐 *PROYECTO FRANCO (PARRAL) · DIMENSIONES DE LOTE*\n\n` +
        `Estimado Ing. Samuel:\n` +
        `• *Lote Tipo:* **14.04 m de frente x 15.00 m de fondo**.\n` +
        `• *Prototipo:* Sierra Bonita con muros monolíticos de 12 cm de espesor.\n` +
        `• *Ubicación:* Hidalgo del Parral, Chihuahua.\n\n` +
        `_A sus órdenes para cualquier consulta adicional._`
      );
    }

    if (lower.includes('suministro') || lower.includes('alcance')) {
      return (
        `📋 *MATRIZ DE SUMINISTROS Y ALCANCES · PROYECTO FRANCO*\n\n` +
        `Estimado Ing. Samuel:\n` +
        `• *Suministros del Desarrollador (Franco):* Concreto premezclado, acero de refuerzo, malla electrosoldada y tuberías ahogadas en muros.\n` +
        `• *Alcance de AMIS / SIMA:* Mano de obra calificada (habilitado, armado, encofrado, colado, desencofrado), equipo de vibrado/bombeo y tecnología de moldes monolíticos SIMA.\n\n` +
        `_Escriba su consulta técnica o *menu* para volver._`
      );
    }

    if (lower.includes('sima') || lower.includes('molde') || lower.includes('rotacion') || lower.includes('rotación') || lower.includes('ciclo') || lower.includes('colado')) {
      return (
        `🏗️ *SISTEMA SIMA · PROYECTO FRANCO (PARRAL)*\n\n` +
        `Estimado Ing. Samuel:\n` +
        `• *Tecnología:* Moldes monolíticos SIMA para colado simultáneo de muros y losa.\n` +
        `• *Ciclo de Rotación:* **24 horas** (desencofrado matutino, armado a mediodía, encofrado vespertino y colado).\n` +
        `• *Espesor de Muros:* 12 cm en Prototipo Sierra Bonita.\n\n` +
        `_A sus órdenes para cualquier otra consulta técnica._`
      );
    }

    // F. Consultas Libres Adicionales a través del Cerebro de Proyecto Franco
    return await consultarCerebroProyectoFranco(text, mediaData);
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
