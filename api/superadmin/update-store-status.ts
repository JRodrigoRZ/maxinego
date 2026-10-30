import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://wuerdwkcpurbtcwyqjep.supabase.co';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_STATUSES = ['activo', 'prueba', 'inactivo', 'suspendido'] as const;
type StoreStatus = (typeof ALLOWED_STATUSES)[number];

function extractBearerToken(authorizationHeader: unknown): string | null {
  if (typeof authorizationHeader !== 'string') return null;
  const match = authorizationHeader.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

function getSafeErrorDetails(error: any): Record<string, string | number> {
  const details: Record<string, string | number> = {};
  if (typeof error?.name === 'string') details.name = error.name;
  if (typeof error?.code === 'string' || typeof error?.code === 'number') details.code = error.code;
  if (typeof error?.status === 'string' || typeof error?.status === 'number') details.status = error.status;
  return Object.keys(details).length > 0 ? details : { name: 'unknown_error' };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido. Se requiere POST.' });
  }

  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  const configuredSuperadminUserId = process.env.SUPERADMIN_AUTH_USER_ID?.trim();

  if (
    !supabaseServiceRoleKey ||
    !configuredSuperadminUserId ||
    !UUID_PATTERN.test(configuredSuperadminUserId)
  ) {
    return res.status(503).json({
      success: false,
      error: 'La operación administrativa no está disponible por una configuración incompleta del servidor.'
    });
  }

  const token = extractBearerToken(req.headers?.authorization || req.headers?.Authorization);
  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Se requiere una sesión administrativa válida.'
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const { data: authData, error: authError } = await supabase.auth.getUser(token);
    if (authError || !authData?.user) {
      return res.status(401).json({
        success: false,
        error: 'La sesión administrativa no es válida o ha expirado.'
      });
    }

    if (authData.user.id.toLowerCase() !== configuredSuperadminUserId.toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: 'El usuario autenticado no está autorizado para cambiar el estado de comercios.'
      });
    }

    // 4. Parsear y validar el cuerpo de la petición
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }
    body = body || {};

    const storeId = body.storeId;
    const newStatus = body.newStatus as StoreStatus;

    if (!storeId || typeof storeId !== 'string' || !storeId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'El identificador del comercio (storeId) es obligatorio.'
      });
    }

    const cleanStoreId = storeId.trim();

    // 5. Validar que newStatus sea estrictamente uno de los permitidos
    if (!newStatus || !ALLOWED_STATUSES.includes(newStatus)) {
      return res.status(400).json({
        success: false,
        error: `Estado inválido: "${newStatus}". Los estados permitidos son exclusivamente: ${ALLOWED_STATUSES.join(', ')}.`
      });
    }

    // 6. Verificar que la tienda existe en public.stores
    const { data: existingStore, error: findError } = await supabase
      .from('stores')
      .select('id, name, slug, status')
      .eq('id', cleanStoreId)
      .maybeSingle();

    if (findError) {
      console.error('[MAXINEGO API] Error al consultar comercio para actualizar estado', {
        operation: 'find_store_for_status_update',
        ...getSafeErrorDetails(findError)
      });
      return res.status(500).json({
        success: false,
        error: 'No fue posible consultar el comercio solicitado.'
      });
    }

    if (!existingStore) {
      return res.status(404).json({
        success: false,
        error: `Comercio con id "${cleanStoreId}" no encontrado en public.stores.`
      });
    }

    // 7. Ejecutar ÚNICAMENTE la actualización de status y updated_at
    const now = new Date().toISOString();
    const { data: updatedStore, error: updateError } = await supabase
      .from('stores')
      .update({
        status: newStatus,
        updated_at: now
      })
      .eq('id', cleanStoreId)
      .select('id, name, slug, status, updated_at')
      .single();

    if (updateError || !updatedStore) {
      console.error('[MAXINEGO API] Error al actualizar el estado del comercio', {
        operation: 'update_store_status',
        ...getSafeErrorDetails(updateError)
      });
      return res.status(500).json({
        success: false,
        error: 'No fue posible actualizar el estado del comercio.'
      });
    }

    // 8. Devolver éxito confirmado
    return res.status(200).json({
      success: true,
      store: updatedStore,
      previousStatus: existingStore.status,
      newStatus: updatedStore.status
    });
  } catch (err: any) {
    console.error('[MAXINEGO API] Error inesperado al actualizar estado de comercio', {
      operation: 'update_store_status',
      ...getSafeErrorDetails(err)
    });
    return res.status(500).json({
      success: false,
      error: 'Ocurrió un error interno al actualizar el estado del comercio.'
    });
  }
}
