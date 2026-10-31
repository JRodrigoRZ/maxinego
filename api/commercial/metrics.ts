import { createClient } from '@supabase/supabase-js';
import { getCentralCommercialMetrics } from '../../src/lib/commercialStore.js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://wuerdwkcpurbtcwyqjep.supabase.co';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
        error: 'El usuario autenticado no está autorizado para consultar métricas comerciales globales.',
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: 'Método no permitido. Solo se admite GET.',
    });
  }

  if (!(await requireSuperadmin(req, res))) return;

  const metrics = await getCentralCommercialMetrics();

  return res.status(200).json({
    success: true,
    fuente: 'central_maxinego_persistente',
    metricas: metrics,
    timestamp: new Date().toISOString(),
  });
}
