import { createClient } from '@supabase/supabase-js';
import { recordCentralCommercialEvent, getCentralCommercialEvents, CommercialActionType } from '../../src/lib/commercialStore.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://wuerdwkcpurbtcwyqjep.supabase.co';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const VALID_ACTIONS: Set<CommercialActionType> = new Set([
  'click_crear_mi_tienda',
  'click_explorar_tiendas',
  'click_ver_tienda_catalogo',
  'click_solicitar_informacion',
  'intento_formulario_comercial',
  'validacion_formulario_fallida',
  'solicitud_comercial_valida',
  'apertura_whatsapp_comercial',
]);

function extractBearerToken(authorizationHeader: unknown): string | null {
  if (typeof authorizationHeader !== 'string') return null;
  const match = authorizationHeader.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

async function requireSuperadmin(req: any, res: any): Promise<boolean> {
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const configuredSuperadminUserId = process.env.SUPERADMIN_AUTH_USER_ID?.trim();

  if (
    !supabaseServiceRoleKey ||
    !configuredSuperadminUserId ||
    !UUID_PATTERN.test(configuredSuperadminUserId)
  ) {
    res.status(503).json({
      success: false,
      error: 'Las métricas comerciales no están disponibles por una configuración incompleta del servidor.',
    });
    return false;
  }

  const token = extractBearerToken(req.headers?.authorization || req.headers?.Authorization);
  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Se requiere una sesión administrativa válida.',
    });
    return false;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      res.status(401).json({
        success: false,
        error: 'La sesión administrativa no es válida o ha expirado.',
      });
      return false;
    }

    if (authData.user.id.toLowerCase() !== configuredSuperadminUserId.toLowerCase()) {
      res.status(403).json({
        success: false,
        error: 'El usuario autenticado no está autorizado para consultar eventos comerciales globales.',
      });
      return false;
    }

    return true;
  } catch {
    res.status(401).json({
      success: false,
      error: 'No fue posible validar la sesión administrativa.',
    });
    return false;
  }
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET: Consultar los eventos recientes auditables (restringido a usuarios autorizados)
  if (req.method === 'GET') {
    if (!(await requireSuperadmin(req, res))) return;

    const limit = parseInt(req.query?.limit, 10) || 50;
    const events = await getCentralCommercialEvents(limit);
    return res.status(200).json({
      success: true,
      total: events.length,
      events,
    });
  }

  // POST: Registrar un evento comercial centralizado
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({
          success: false,
          error: 'Cuerpo de solicitud inválido. Se requiere JSON válido.',
        });
      }
    }
    body = body || {};

    const { type, origin, metadata } = body;

    if (!type || !VALID_ACTIONS.has(type as CommercialActionType)) {
      return res.status(400).json({
        success: false,
        error: `Acción comercial inválida. Debe ser una de las acciones aprobadas.`,
      });
    }

    const clientIp =
      req.headers?.['x-forwarded-for']?.toString().split(',')[0] ||
      req.socket?.remoteAddress ||
      'unknown';

    const result = await recordCentralCommercialEvent(
      type as CommercialActionType,
      origin || 'desconocido',
      metadata,
      clientIp
    );

    if (result.duplicate) {
      return res.status(200).json({
        success: true,
        recorded: false,
        duplicate: true,
      });
    }

    if (!result.success) {
      return res.status(503).json({
        success: false,
        error: 'No se pudo registrar el evento comercial en almacenamiento persistente.',
      });
    }

    return res.status(200).json({
      success: true,
      recorded: true,
      duplicate: false,
      event: result.event,
    });
  }

  return res.status(405).json({
    success: false,
    error: 'Método no permitido. Utilice POST o GET.',
  });
}
