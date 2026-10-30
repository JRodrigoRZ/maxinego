import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://wuerdwkcpurbtcwyqjep.supabase.co';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function generateSecurePassword(): string {
  return `${randomBytes(24).toString('base64url')}Aa1!`;
}

function extractBearerToken(authorizationHeader: unknown): string | null {
  if (typeof authorizationHeader !== 'string') return null;
  const match = authorizationHeader.match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || null;
}

function isExistingAuthUserError(error: any): boolean {
  if (!error) return false;
  const normalizedMessage = typeof error.message === 'string' ? error.message.toLowerCase() : '';
  return (
    error.code === 'email_exists' ||
    error.code === 'user_already_exists' ||
    (error.status === 422 && (
      normalizedMessage.includes('already registered') ||
      normalizedMessage.includes('already exists') ||
      normalizedMessage.includes('already been registered')
    ))
  );
}

function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'comercio';
}

function getNextSlugCandidate(rawSlug: string, existingSlugs: Set<string>): string {
  const normalized = normalizeSlug(rawSlug);
  if (!existingSlugs.has(normalized)) {
    return normalized;
  }

  // Extraer raíz si ya terminaba en -N (ej: argentina-2 -> raíz argentina)
  const match = normalized.match(/^(.*?)-(\d+)$/);
  const root = match ? match[1] : normalized;
  let counter = match ? parseInt(match[2], 10) + 1 : 2;

  while (existingSlugs.has(`${root}-${counter}`)) {
    counter++;
  }
  return `${root}-${counter}`;
}

function isSlugUniqueViolation(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  const details = (error.details || '').toLowerCase();
  return (
    (error.code === '23505' &&
      (msg.includes('slug') || details.includes('slug') || msg.includes('stores_slug_key'))) ||
    msg.includes('stores_slug_key')
  );
}

type RollbackStepStatus = 'not_required' | 'succeeded' | 'failed' | 'skipped';
type RollbackStatus = 'not_required' | 'completed' | 'partial' | 'failed';

interface RollbackResult {
  status: RollbackStatus;
  storeDeletion: RollbackStepStatus;
  authUserDeletion: RollbackStepStatus;
}

function getSafeErrorDetails(error: any): Record<string, string | number> {
  const details: Record<string, string | number> = {};
  if (typeof error?.name === 'string') details.name = error.name;
  if (typeof error?.code === 'string' || typeof error?.code === 'number') details.code = error.code;
  if (typeof error?.status === 'string' || typeof error?.status === 'number') details.status = error.status;
  return Object.keys(details).length > 0 ? details : { name: 'unknown_error' };
}

function calculateRollbackStatus(result: Omit<RollbackResult, 'status'>): RollbackStatus {
  const requiredSteps = [result.storeDeletion, result.authUserDeletion]
    .filter((step) => step !== 'not_required');
  if (requiredSteps.length === 0) return 'not_required';

  const succeeded = requiredSteps.filter((step) => step === 'succeeded').length;
  if (succeeded === requiredSteps.length) return 'completed';
  if (succeeded > 0) return 'partial';
  return 'failed';
}

async function performRollback(
  supabase: any,
  createdStoreId: string | null,
  userId: string | undefined,
  isNewAuthUser: boolean
): Promise<RollbackResult> {
  const steps: Omit<RollbackResult, 'status'> = {
    storeDeletion: createdStoreId ? 'failed' : 'not_required',
    authUserDeletion: isNewAuthUser && userId ? 'failed' : 'not_required'
  };

  if (createdStoreId) {
    try {
      const { error: storeDeleteError } = await supabase
        .from('stores')
        .delete()
        .eq('id', createdStoreId);

      if (storeDeleteError) {
        console.error('[MAXINEGO API] Rollback incompleto', {
          operation: 'delete_new_store',
          resourceId: createdStoreId,
          ...getSafeErrorDetails(storeDeleteError)
        });
      } else {
        steps.storeDeletion = 'succeeded';
      }
    } catch (err) {
      console.error('[MAXINEGO API] Rollback incompleto', {
        operation: 'delete_new_store',
        resourceId: createdStoreId,
        ...getSafeErrorDetails(err)
      });
    }
  }

  if (isNewAuthUser && userId) {
    if (createdStoreId && steps.storeDeletion !== 'succeeded') {
      steps.authUserDeletion = 'skipped';
      console.error('[MAXINEGO API] Rollback incompleto', {
        operation: 'preserve_new_auth_user_after_store_delete_failure',
        resourceId: userId
      });
    } else {
      try {
        const { error: authUserDeleteError } = await supabase.auth.admin.deleteUser(userId);
        if (authUserDeleteError) {
          console.error('[MAXINEGO API] Rollback incompleto', {
            operation: 'delete_new_auth_user',
            resourceId: userId,
            ...getSafeErrorDetails(authUserDeleteError)
          });
        } else {
          steps.authUserDeletion = 'succeeded';
        }
      } catch (err) {
        console.error('[MAXINEGO API] Rollback incompleto', {
          operation: 'delete_new_auth_user',
          resourceId: userId,
          ...getSafeErrorDetails(err)
        });
      }
    }
  }

  return {
    ...steps,
    status: calculateRollbackStatus(steps)
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Método no permitido' });
  }

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

  let createdStoreId: string | null = null;
  let userId: string | undefined;
  let isNewAuthUser = false;

  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });

  try {
    const { data: authData, error: authValidationError } = await supabase.auth.getUser(token);
    if (authValidationError || !authData?.user) {
      return res.status(401).json({
        success: false,
        error: 'La sesión administrativa no es válida o ha expirado.'
      });
    }

    if (authData.user.id.toLowerCase() !== configuredSuperadminUserId.toLowerCase()) {
      return res.status(403).json({
        success: false,
        error: 'El usuario autenticado no está autorizado para crear comercios.'
      });
    }

    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        // mantener como objeto
      }
    }
    body = body || {};

    // Extracción de datos según el Payload real
    const targetEmail = body.ownerEmail || body.email || body.adminEmail || body.correo;
    const targetStoreName = body.name || body.storeName || 'Comercio';
    const rawSlugInput = (body.slug && typeof body.slug === 'string' && body.slug.trim())
      ? body.slug.trim()
      : targetStoreName;
    const targetOwnerName = body.ownerName || body.adminName || body.fullName || 'Administrador';
    const targetPhone = body.ownerPhone || body.phone || body.telefono || '';
    const targetStoreType = body.store_type || body.vertical || 'general';
    const targetPlanId = body.planId || body.plan || 'basic';
    const targetStatus = body.status || 'activo';

    if (typeof targetEmail !== 'string' || !targetEmail.trim()) {
      return res.status(400).json({ success: false, error: 'El correo electrónico es obligatorio' });
    }

    const cleanEmail = targetEmail.trim().toLowerCase();
    const cleanOwnerName = typeof targetOwnerName === 'string' ? targetOwnerName.trim() : 'Administrador';
    const tempPassword = generateSecurePassword();

    // 1. Crear exclusivamente un usuario nuevo en Supabase Auth.
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: cleanEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        full_name: cleanOwnerName,
        phone: targetPhone,
        role: 'admin'
      }
    });

    if (authError) {
      if (isExistingAuthUserError(authError)) {
        return res.status(409).json({
          success: false,
          error: 'El correo electrónico ya pertenece a una cuenta registrada.'
        });
      }

      return res.status(400).json({
        success: false,
        error: 'No se pudo crear la cuenta del administrador del comercio.'
      });
    }

    userId = authUser?.user?.id;
    isNewAuthUser = true;

    if (!userId) {
      return res.status(500).json({
        success: false,
        error: 'No se pudo obtener el identificador (user_id) del usuario en Supabase Auth.'
      });
    }

    // 2. Detectar dinámicamente las columnas reales de la tabla 'stores'
    const { data: sampleList } = await supabase.from('stores').select('*').limit(1);
    const existingColumns = sampleList && sampleList.length > 0 ? Object.keys(sampleList[0]) : [];

    // Consultar los slugs actuales para resolución inicial de colisiones
    const { data: allStoresList } = await supabase.from('stores').select('slug');
    const existingSlugs = new Set<string>((allStoresList || []).map((s: any) => s.slug).filter(Boolean));

    let candidateSlug = getNextSlugCandidate(rawSlugInput, existingSlugs);

    const candidateStoreData: Record<string, any> = {
      name: targetStoreName,
      slug: candidateSlug,
      status: targetStatus,
      store_type: targetStoreType,
      type: targetStoreType,
      vertical: targetStoreType,
      plan_id: targetPlanId,
      planId: targetPlanId,
      plan: targetPlanId,
      owner_id: userId,
      user_id: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    let insertedStore: any = null;
    let storeError: any = null;
    const MAX_SLUG_ATTEMPTS = 15;

    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt++) {
      candidateStoreData.slug = candidateSlug;

      const storeInsertPayload: Record<string, any> = {};
      if (existingColumns.length > 0) {
        for (const col of existingColumns) {
          if (col === 'id') continue; // El UUID lo genera Supabase
          if (candidateStoreData[col] !== undefined) {
            storeInsertPayload[col] = candidateStoreData[col];
          }
        }
      } else {
        storeInsertPayload.name = targetStoreName;
        storeInsertPayload.slug = candidateSlug;
        storeInsertPayload.status = targetStatus;
      }

      const { data: storeData, error: err } = await supabase
        .from('stores')
        .insert([storeInsertPayload])
        .select()
        .single();

      if (!err && storeData) {
        insertedStore = storeData;
        storeError = null;
        break; // Inserción exitosa
      }

      storeError = err;

      // Si ocurrió una colisión de slug (por concurrencia o simultaneidad), reintentar con el siguiente sufijo
      if (isSlugUniqueViolation(err)) {
        console.warn(
          `[CentralBo API] Colisión de slug detectada para "${candidateSlug}" en intento ${attempt}. Calculando siguiente candidato...`
        );
        existingSlugs.add(candidateSlug);
        candidateSlug = getNextSlugCandidate(candidateSlug, existingSlugs);
      } else {
        // Otro tipo de error: salir inmediatamente del bucle
        break;
      }
    }

    if (storeError || !insertedStore) {
      console.error('[MAXINEGO API] Fallo al crear comercio; iniciando rollback', {
        operation: 'create_store',
        ...getSafeErrorDetails(storeError)
      });
      const rollbackResult = await performRollback(supabase, createdStoreId, userId, isNewAuthUser);

      return res.status(500).json({
        success: false,
        error: 'No se pudo crear el comercio en el almacenamiento central.',
        rollback: rollbackResult.status
      });
    }

    createdStoreId = insertedStore.id;
    const finalAssignedSlug = insertedStore.slug;

    // 3. Vincular dueño en 'store_users' utilizando el contrato real de CentralBo
    const { data: storeUserData, error: storeUserError } = await supabase
      .from('store_users')
      .insert({
        tenant_id: createdStoreId,
        user_id: userId,
        role: 'admin',
        full_name: cleanOwnerName,
        email: cleanEmail,
        is_active: true
      })
      .select()
      .single();

    if (storeUserError || !storeUserData) {
      console.error('[MAXINEGO API] Fallo al asociar administrador; iniciando rollback', {
        operation: 'create_store_user',
        ...getSafeErrorDetails(storeUserError)
      });
      const rollbackResult = await performRollback(supabase, createdStoreId, userId, isNewAuthUser);

      return res.status(500).json({
        success: false,
        error: 'No se pudo asociar el administrador con el comercio.',
        rollback: rollbackResult.status
      });
    }

    // Estructuras de respuesta compatibles para el modal y frontend
    const resultStore = {
      ...(insertedStore || {}),
      id: createdStoreId,
      name: targetStoreName,
      storeName: targetStoreName,
      store_name: targetStoreName,
      slug: finalAssignedSlug,
      storeSlug: finalAssignedSlug,
      store_slug: finalAssignedSlug,
      status: targetStatus,
      store_type: targetStoreType,
      planId: targetPlanId,
      plan_id: targetPlanId,
      ownerName: cleanOwnerName,
      ownerEmail: cleanEmail,
      ownerPhone: targetPhone
    };

    const resultCredentials = {
      storeId: createdStoreId,
      storeName: targetStoreName,
      storeSlug: finalAssignedSlug,
      ownerName: cleanOwnerName,
      ownerEmail: cleanEmail,
      ownerPhone: targetPhone,
      initialPassword: tempPassword,
      createdAt: insertedStore.created_at || new Date().toISOString()
    };

    return res.status(200).json({
      success: true,
      message: 'Comercio y administrador creados con éxito',
      store: resultStore,
      credentials: resultCredentials
    });
  } catch (error: any) {
    console.error('[MAXINEGO API] Excepción no controlada en creación de comercio', {
      operation: 'create_store_owner',
      ...getSafeErrorDetails(error)
    });
    const rollbackResult = await performRollback(supabase, createdStoreId, userId, isNewAuthUser);
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor al crear el comercio.',
      rollback: rollbackResult.status
    });
  }
}
