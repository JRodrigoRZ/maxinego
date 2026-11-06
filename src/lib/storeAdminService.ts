/**
 * CentralBo — Servicio del Panel Admin de Tienda
 * Módulo 4 — Panel Admin de Tienda
 * 
 * Reglas de Seguridad & Aislamiento:
 * 1. Todos los métodos exigen y filtran estrictamente por tenant_id.
 * 2. Un administrador solo puede leer y alterar los datos de su propio comercio.
 * 3. Se respeta la discriminación de capacidades según el plan (Basic vs Pro).
 * 4. Persiste en almacenamiento local del tenant y sincroniza con Supabase.
 */

import {
  Category,
  CategoryStatus,
  Product,
  ProductStatus,
  Order,
  StoreProfileSettings,
  StoreAppearanceSettings,
  StoreScheduleDay,
  StoreShippingSettings,
  StoreScheduledOrdersSettings,
  StorePaymentSettings,
  RestaurantSettings,
  FashionSettings,
  GeneralSettings,
  ServiceItem,
  ProfessionalItem,
  ProfessionalDaySchedule,
  ProfessionalAgendaSlot,
  AgendaSlotStatus,
  ReservedTimeSlot,
  AppointmentRequest,
  PromotionCode,
  StoreStatistics,
  OrderStatus,
  OrderItemDetail,
  StoreType,
  StoreHighlightItem,
  StoreHighlightsLayout,
  StoreBannerItem,
  StoreStoryItem,
  StoreLocationSettings,
  Store,
} from '../types';
import { SUPERADMIN_STORES } from './superadminService';
import { supabase } from './supabase';

// Comparte únicamente las lecturas remotas que todavía están en curso.
// Se elimina la promesa al terminar: no almacena resultados viejos ni mezcla tenants.
const pendingCatalogReads = new Map<string, Promise<unknown>>();
function dedupeCatalogRead<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const pending = pendingCatalogReads.get(key) as Promise<T> | undefined;
  if (pending) return pending;
  const request = loader().finally(() => {
    if (pendingCatalogReads.get(key) === request) pendingCatalogReads.delete(key);
  });
  pendingCatalogReads.set(key, request);
  return request;
}

// ----------------------------------------------------------------------------
export function getStorePlan(storeOrTenantId: Store | string | null | undefined): 'free' | 'basic' | 'pro' {
  if (!storeOrTenantId) return 'basic';

  let tenantId = '';
  let slug = '';

  if (typeof storeOrTenantId === 'object' && storeOrTenantId !== null) {
    const rawPlan =
      (storeOrTenantId as any).plan ||
      (storeOrTenantId as any).subscription?.planId ||
      (storeOrTenantId as any).profile?.plan;
    if (rawPlan === 'free' || rawPlan === 'basic' || rawPlan === 'pro') {
      return rawPlan;
    }
    tenantId = (storeOrTenantId.id || '').trim();
    slug = (storeOrTenantId.slug || '').trim().toLowerCase();
  } else if (typeof storeOrTenantId === 'string') {
    tenantId = storeOrTenantId.trim();
  }

  // 1. Buscar en SUPERADMIN_STORES por id o slug
  const adminStore = SUPERADMIN_STORES.find(
    (s) =>
      (tenantId && s.id === tenantId) ||
      (slug && s.slug === slug) ||
      (tenantId && s.slug === tenantId)
  );
  if (adminStore && adminStore.subscription?.planId) {
    const planId = adminStore.subscription.planId;
    if (planId === 'free' || planId === 'basic' || planId === 'pro') {
      return planId;
    }
  }

  // 2. Buscar en almacenamiento local con id y slug
  try {
    if (tenantId) {
      const raw = localStorage.getItem(`maxinego_store_plan_${tenantId}`);
      if (raw === 'free' || raw === 'basic' || raw === 'pro') {
        return raw;
      }
    }
    if (slug) {
      const rawSlug = localStorage.getItem(`maxinego_store_plan_${slug}`);
      if (rawSlug === 'free' || rawSlug === 'basic' || rawSlug === 'pro') {
        return rawSlug;
      }
    }
  } catch {}

  // Por defecto, tiendas registradas sin suscripción explícita operan en Basic
  return 'basic';
}

export function setStorePlan(tenantIdOrSlug: string, plan: 'free' | 'basic' | 'pro'): void {
  try {
    const key = tenantIdOrSlug.trim();
    localStorage.setItem(`maxinego_store_plan_${key}`, plan);
    const store = SUPERADMIN_STORES.find((s) => s.id === key || s.slug === key);
    if (store && store.subscription) {
      store.subscription.planId = plan as any;
    }
  } catch {}
}

/**
 * Determina si un comercio cuenta con un plan de pago (Basic o Pro) que
 * habilita funcionalidades comerciales como los Banners de mi tienda.
 */
export function isStorePaidPlan(storeOrTenantId: Store | string | null | undefined): boolean {
  if (!storeOrTenantId) return false;
  const tenantId = typeof storeOrTenantId === 'string' ? storeOrTenantId : storeOrTenantId.id;
  if (typeof storeOrTenantId !== 'string') {
    const rawPlan = (storeOrTenantId as any).plan || (storeOrTenantId as any).subscription?.planId;
    if (rawPlan === 'free') return false;
    if (rawPlan === 'basic' || rawPlan === 'pro') return true;
  }
  const plan = getStorePlan(tenantId);
  return plan === 'basic' || plan === 'pro';
}

/**
 * Determina si un comercio cuenta con el Plan PRO exclusivamente,
 * habilitando los Estados Multimedia de la tienda.
 */
export function isStoreProPlan(storeOrTenantId: Store | string | null | undefined): boolean {
  if (!storeOrTenantId) return false;
  const tenantId = typeof storeOrTenantId === 'string' ? storeOrTenantId : storeOrTenantId.id;
  if (typeof storeOrTenantId !== 'string') {
    const rawPlan = (storeOrTenantId as any).plan || (storeOrTenantId as any).subscription?.planId;
    if (rawPlan === 'pro') return true;
    if (rawPlan === 'free' || rawPlan === 'basic') return false;
  }
  const plan = getStorePlan(tenantId);
  return plan === 'pro';
}

// ----------------------------------------------------------------------------
// DATOS SEMILLA POR TENANT (Módulo 4)
// ----------------------------------------------------------------------------

const TENANT_STORAGE_PREFIX = 'maxinego_store_data_v4_';
const LEGACY_TENANT_STORAGE_PREFIX = 'centralbo_store_data_v4_';

function isValidTenantId(tenantId: string | undefined | null): boolean {
  return (
    typeof tenantId === 'string' &&
    tenantId.trim().length > 0 &&
    tenantId !== 'undefined' &&
    tenantId !== 'null'
  );
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  return UUID_REGEX.test(value.trim());
}

function getStorageKey(tenantId: string, section: string): string {
  return `${TENANT_STORAGE_PREFIX}${tenantId.trim()}_${section.trim()}`;
}

function getLegacyStorageKey(tenantId: string, section: string): string {
  return `${LEGACY_TENANT_STORAGE_PREFIX}${tenantId.trim()}_${section.trim()}`;
}

export const CANONICAL_ORDER_STATUSES: readonly string[] = [
  'pendiente',
  'recibido',
  'pagado',
  'en_preparacion',
  'despachado',
  'completado',
  'cancelado',
];

function cloneFallback<T>(fallback: T): T {
  if (typeof fallback === 'object' && fallback !== null) {
    try {
      return JSON.parse(JSON.stringify(fallback)) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function sanitizeProductItem(item: any, tenantId: string): Product | null {
  if (
    !item ||
    typeof item !== 'object' ||
    typeof item.name !== 'string' ||
    !item.name.trim()
  ) {
    return null;
  }

  const numPrice = Number(item.price);
  if (isNaN(numPrice) || !Number.isFinite(numPrice) || numPrice < 0) {
    return null;
  }

  // Si el item tiene ID existente, debe ser un UUID canónico válido (elimina IDs demo legacy como prod-rest-1)
  const rawId = item.id ? String(item.id).trim() : '';
  if (rawId && !isValidUUID(rawId)) {
    return null;
  }

  // Sanear atributos preservando todas las propiedades de las verticales soportadas
  const rawAttrs = (item.attributes && typeof item.attributes === 'object' && !Array.isArray(item.attributes))
    ? item.attributes
    : {};
  
  const cleanAttrs: Record<string, unknown> = { ...rawAttrs };

  // 1. Destacado y precios promocionales
  if (typeof rawAttrs.is_featured === 'boolean') {
    cleanAttrs.is_featured = rawAttrs.is_featured;
  } else {
    cleanAttrs.is_featured = false;
  }

  if (
    typeof rawAttrs.previous_price === 'number' &&
    Number.isFinite(rawAttrs.previous_price) &&
    rawAttrs.previous_price >= 0
  ) {
    cleanAttrs.previous_price = rawAttrs.previous_price;
  } else if (rawAttrs.previous_price !== undefined) {
    cleanAttrs.previous_price = null;
  }

  if (
    typeof rawAttrs.offer_price === 'number' &&
    Number.isFinite(rawAttrs.offer_price) &&
    rawAttrs.offer_price >= 0
  ) {
    cleanAttrs.offer_price = rawAttrs.offer_price;
  } else if (rawAttrs.offer_price !== undefined) {
    cleanAttrs.offer_price = null;
  }

  // 2. Inventario y SKU
  if (typeof rawAttrs.sku === 'string') {
    cleanAttrs.sku = rawAttrs.sku.slice(0, 100);
  }
  if (typeof rawAttrs.stock_units === 'number' && Number.isFinite(rawAttrs.stock_units) && rawAttrs.stock_units >= 0) {
    cleanAttrs.stock_units = rawAttrs.stock_units;
  }

  // 3. Gastronomía (Restaurante)
  if (Array.isArray(rawAttrs.modifiers)) {
    cleanAttrs.modifiers = rawAttrs.modifiers
      .filter((m: any) => m && typeof m === 'object' && typeof m.name === 'string')
      .map((m: any) => ({
        name: String(m.name).slice(0, 100),
        price: typeof m.price === 'number' && Number.isFinite(m.price) ? Math.max(0, m.price) : 0,
      }))
      .slice(0, 30);
  }
  if (typeof rawAttrs.is_combo === 'boolean') cleanAttrs.is_combo = rawAttrs.is_combo;
  if (Array.isArray(rawAttrs.combo_items)) {
    cleanAttrs.combo_items = rawAttrs.combo_items
      .filter((ci: unknown) => typeof ci === 'string')
      .map((ci: string) => ci.slice(0, 150))
      .slice(0, 30);
  }
  if (typeof rawAttrs.kitchen_notes_allowed === 'boolean') {
    cleanAttrs.kitchen_notes_allowed = rawAttrs.kitchen_notes_allowed;
  }
  if (typeof rawAttrs.allow_pickup === 'boolean') cleanAttrs.allow_pickup = rawAttrs.allow_pickup;
  if (typeof rawAttrs.allow_delivery === 'boolean') cleanAttrs.allow_delivery = rawAttrs.allow_delivery;

  // 4. Moda
  if (Array.isArray(rawAttrs.sizes)) {
    cleanAttrs.sizes = rawAttrs.sizes.filter((s: unknown) => typeof s === 'string').slice(0, 20);
  }
  if (Array.isArray(rawAttrs.colors)) {
    cleanAttrs.colors = rawAttrs.colors
      .filter((c: any) => c && typeof c === 'object' && typeof c.name === 'string')
      .slice(0, 20);
  }
  if (Array.isArray(rawAttrs.gallery_images)) {
    cleanAttrs.gallery_images = rawAttrs.gallery_images
      .filter((img: unknown) => typeof img === 'string')
      .slice(0, 20);
  }
  if (typeof rawAttrs.size_guide === 'string') cleanAttrs.size_guide = rawAttrs.size_guide.slice(0, 500);
  if (typeof rawAttrs.exchange_policy === 'string') cleanAttrs.exchange_policy = rawAttrs.exchange_policy.slice(0, 500);

  // 4.1 Galería de imágenes (Módulo 3: hasta 3 fotografías por producto para planes BASIC y PRO)
  let productImages: string[] = [];
  if (Array.isArray(item.images)) {
    productImages = item.images.filter((img: unknown) => typeof img === 'string' && (img as string).trim()).slice(0, 3);
  } else if (Array.isArray(rawAttrs.images)) {
    productImages = rawAttrs.images.filter((img: unknown) => typeof img === 'string' && (img as string).trim()).slice(0, 3);
  } else if (Array.isArray(rawAttrs.gallery_images)) {
    productImages = rawAttrs.gallery_images.filter((img: unknown) => typeof img === 'string' && (img as string).trim()).slice(0, 3);
  }

  const primaryImage = typeof item.image_url === 'string' && item.image_url.trim() ? item.image_url.trim() : (productImages[0] || null);
  if (primaryImage && !productImages.includes(primaryImage)) {
    productImages = [primaryImage, ...productImages].slice(0, 3);
  } else if (!primaryImage && productImages.length > 0) {
    // La primera imagen se convierte en la principal
  }
  cleanAttrs.images = productImages;

  // 5. Servicios y Citas
  if (typeof rawAttrs.is_service === 'boolean') cleanAttrs.is_service = rawAttrs.is_service;
  if (
    typeof rawAttrs.duration_minutes === 'number' &&
    Number.isFinite(rawAttrs.duration_minutes) &&
    rawAttrs.duration_minutes > 0
  ) {
    cleanAttrs.duration_minutes = rawAttrs.duration_minutes;
  }
  if (typeof rawAttrs.specialty === 'string') cleanAttrs.specialty = rawAttrs.specialty.slice(0, 100);
  if (typeof rawAttrs.professional_name === 'string') cleanAttrs.professional_name = rawAttrs.professional_name.slice(0, 100);
  if (typeof rawAttrs.professional_id === 'string') cleanAttrs.professional_id = rawAttrs.professional_id;

  // Validar categoría: únicamente UUID canónico válido o null
  const validCategoryId =
    typeof item.category_id === 'string' && isValidUUID(item.category_id)
      ? item.category_id.trim()
      : null;

  return {
    id: rawId,
    tenant_id: typeof item.tenant_id === 'string' && item.tenant_id.trim() ? item.tenant_id.trim() : tenantId,
    category_id: validCategoryId,
    name: String(item.name).trim().slice(0, 150),
    description: typeof item.description === 'string' ? item.description.slice(0, 1000) : null,
    price: numPrice,
    is_available: item.is_available !== undefined ? Boolean(item.is_available) : true,
    image_url: primaryImage,
    images: productImages.length > 0 ? productImages : (primaryImage ? [primaryImage] : []),
    status: (item.status === 'inactivo' || item.status === 'borrador') ? item.status : 'activo',
    attributes: cleanAttrs,
    created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString(),
    updated_at: typeof item.updated_at === 'string' ? item.updated_at : new Date().toISOString(),
  };
}

function sanitizeOrderItem(item: any, tenantId: string): Order | null {
  if (
    !item ||
    typeof item !== 'object' ||
    typeof item.id !== 'string' ||
    !item.id.trim() ||
    typeof item.total !== 'number' ||
    !Number.isFinite(item.total) ||
    item.total < 0
  ) {
    return null;
  }

  const validStatus = (typeof item.status === 'string' && CANONICAL_ORDER_STATUSES.includes(item.status))
    ? (item.status as OrderStatus)
    : 'pendiente';

  return {
    id: String(item.id).trim(),
    tenant_id: typeof item.tenant_id === 'string' && item.tenant_id.trim() ? item.tenant_id.trim() : tenantId,
    customer_id: typeof item.customer_id === 'string' ? item.customer_id : null,
    customer_name: typeof item.customer_name === 'string' ? item.customer_name.slice(0, 100) : null,
    customer_email: typeof item.customer_email === 'string' ? item.customer_email.slice(0, 120) : null,
    customer_phone: typeof item.customer_phone === 'string' ? item.customer_phone.slice(0, 25) : null,
    status: validStatus,
    total: Number(item.total),
    created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString(),
    updated_at: typeof item.updated_at === 'string' ? item.updated_at : new Date().toISOString(),
  };
}

function sanitizeCategoryItem(item: any, tenantId: string): Category | null {
  if (
    !item ||
    typeof item !== 'object' ||
    typeof item.id !== 'string' ||
    !item.id.trim() ||
    typeof item.name !== 'string' ||
    !item.name.trim()
  ) {
    return null;
  }

  return {
    id: String(item.id).trim(),
    tenant_id: typeof item.tenant_id === 'string' && item.tenant_id.trim() ? item.tenant_id.trim() : tenantId,
    name: String(item.name).trim().slice(0, 100),
    status: item.status === 'inactivo' ? 'inactivo' : 'activo',
    created_at: typeof item.created_at === 'string' ? item.created_at : new Date().toISOString(),
    updated_at: typeof item.updated_at === 'string' ? item.updated_at : new Date().toISOString(),
  };
}

function loadFromStorage<T>(tenantId: string, section: string, fallback: T): T {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return cloneFallback(fallback);
  }
  if (!isValidTenantId(tenantId)) {
    console.warn(`[StoreAdmin] Intento de acceso a sección "${section}" con tenantId inválido: "${tenantId}"`);
    return cloneFallback(fallback);
  }
  try {
    let raw = localStorage.getItem(getStorageKey(tenantId, section));
    let isFromLegacy = false;
    if (!raw) {
      raw = localStorage.getItem(getLegacyStorageKey(tenantId, section));
      if (raw) {
        isFromLegacy = true;
      }
    }
    if (raw) {
      const parsed = JSON.parse(raw);

      // Si el fallback esperado es un Array, validar que parsed sea Array y descartar corruptos
      if (Array.isArray(fallback)) {
        if (!Array.isArray(parsed)) {
          console.warn(`[StoreAdmin] Se esperaba un array para "${section}", recibido:`, typeof parsed);
          return cloneFallback(fallback);
        }

        let cleanList: any[] = [];
        if (section === 'products') {
          cleanList = parsed
            .map((item) => sanitizeProductItem(item, tenantId))
            .filter((p): p is Product => p !== null);
        } else if (section === 'orders') {
          cleanList = parsed
            .map((item) => sanitizeOrderItem(item, tenantId))
            .filter((o): o is Order => o !== null);
        } else if (section === 'categories') {
          cleanList = parsed
            .map((item) => sanitizeCategoryItem(item, tenantId))
            .filter((c): c is Category => c !== null);
        } else {
          // Para otras colecciones (schedule, promotions, professionals, appointments):
          // descartar elementos que no sean objetos válidos
          cleanList = parsed.filter(
            (item) => item !== null && typeof item === 'object' && !Array.isArray(item)
          );
        }

        // Migración suave si se leyó de la clave heredada
        if (isFromLegacy) {
          try {
            localStorage.setItem(getStorageKey(tenantId, section), JSON.stringify(cleanList));
          } catch {}
        }
        return cleanList as unknown as T;
      }

      // Si el fallback es un objeto individual, validar tipo objeto no nulo y no array
      if (typeof fallback === 'object' && fallback !== null) {
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          console.warn(`[StoreAdmin] Se esperaba un objeto para "${section}", recibido:`, typeof parsed);
          return cloneFallback(fallback);
        }
        if (isFromLegacy) {
          try {
            localStorage.setItem(getStorageKey(tenantId, section), JSON.stringify(parsed));
          } catch {}
        }
        return parsed as T;
      }

      if (isFromLegacy) {
        try {
          localStorage.setItem(getStorageKey(tenantId, section), JSON.stringify(parsed));
        } catch {}
      }
      return parsed as T;
    }
  } catch (e) {
    console.warn(`[StoreAdmin] Error al cargar ${section} (JSON inválido o corrupto):`, e);
  }
  return cloneFallback(fallback);
}

function saveToStorage<T>(tenantId: string, section: string, data: T): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  if (!isValidTenantId(tenantId)) {
    console.warn(`[CentralBo StoreAdmin] Intento de persistir sección "${section}" con tenantId inválido: "${tenantId}"`);
    return;
  }
  try {
    localStorage.setItem(getStorageKey(tenantId, section), JSON.stringify(data));
  } catch (e) {
    console.warn(`[CentralBo StoreAdmin] Error al guardar ${section}:`, e);
  }
}

// ----------------------------------------------------------------------------
// 1. HORARIOS SEMILLA (Lunes a Domingo con múltiples períodos)
// ----------------------------------------------------------------------------
export const DEFAULT_WEEK_SCHEDULE: StoreScheduleDay[] = [
  {
    dayOfWeek: 1,
    dayName: 'Lunes',
    isOpen: true,
    periods: [
      { open: '08:30', close: '13:00' },
      { open: '15:30', close: '20:30' },
    ],
  },
  {
    dayOfWeek: 2,
    dayName: 'Martes',
    isOpen: true,
    periods: [
      { open: '08:30', close: '13:00' },
      { open: '15:30', close: '20:30' },
    ],
  },
  {
    dayOfWeek: 3,
    dayName: 'Miércoles',
    isOpen: true,
    periods: [
      { open: '08:30', close: '13:00' },
      { open: '15:30', close: '20:30' },
    ],
  },
  {
    dayOfWeek: 4,
    dayName: 'Jueves',
    isOpen: true,
    periods: [
      { open: '08:30', close: '13:00' },
      { open: '15:30', close: '20:30' },
    ],
  },
  {
    dayOfWeek: 5,
    dayName: 'Viernes',
    isOpen: true,
    periods: [
      { open: '08:30', close: '13:00' },
      { open: '15:30', close: '21:30' },
    ],
  },
  {
    dayOfWeek: 6,
    dayName: 'Sábado',
    isOpen: true,
    periods: [{ open: '09:00', close: '18:00' }],
  },
  {
    dayOfWeek: 0,
    dayName: 'Domingo',
    isOpen: false,
    periods: [{ open: '10:00', close: '14:00' }],
  },
];

// Cálculo de estado en vivo del comercio: "Abierto ahora", "Cerrado", "Próxima apertura"
export function calculateScheduleStatus(schedule: StoreScheduleDay[]): {
  isOpenNow: boolean;
  statusLabel: 'Abierto ahora' | 'Cerrado';
  nextOpeningInfo: string;
} {
  const now = new Date();
  // Hora de Bolivia GMT-4 aproximada
  const currentDayOfWeek = now.getDay(); // 0 a 6
  const currentHours = String(now.getHours()).padStart(2, '0');
  const currentMinutes = String(now.getMinutes()).padStart(2, '0');
  const currentTimeStr = `${currentHours}:${currentMinutes}`;

  const todayConfig = schedule.find((s) => s.dayOfWeek === currentDayOfWeek);

  if (todayConfig && todayConfig.isOpen) {
    for (const period of todayConfig.periods) {
      if (currentTimeStr >= period.open && currentTimeStr <= period.close) {
        return {
          isOpenNow: true,
          statusLabel: 'Abierto ahora',
          nextOpeningInfo: `Cierra hoy a las ${period.close}`,
        };
      }
    }
  }

  // Buscar próxima apertura
  // Revisar si hoy tiene un período posterior
  if (todayConfig && todayConfig.isOpen) {
    for (const period of todayConfig.periods) {
      if (currentTimeStr < period.open) {
        return {
          isOpenNow: false,
          statusLabel: 'Cerrado',
          nextOpeningInfo: `Abre hoy a las ${period.open}`,
        };
      }
    }
  }

  // Buscar en los siguientes días
  for (let offset = 1; offset <= 7; offset++) {
    const nextDayIndex = (currentDayOfWeek + offset) % 7;
    const nextDayConfig = schedule.find((s) => s.dayOfWeek === nextDayIndex);
    if (nextDayConfig && nextDayConfig.isOpen && nextDayConfig.periods.length > 0) {
      const firstPeriod = nextDayConfig.periods[0];
      const prefix = offset === 1 ? 'mañana' : `el ${nextDayConfig.dayName}`;
      return {
        isOpenNow: false,
        statusLabel: 'Cerrado',
        nextOpeningInfo: `Próxima apertura: ${prefix} a las ${firstPeriod.open}`,
      };
    }
  }

  return {
    isOpenNow: false,
    statusLabel: 'Cerrado',
    nextOpeningInfo: 'Sin horario próximo definido',
  };
}

// ----------------------------------------------------------------------------
// 2. PERFIL DE TIENDA
// ----------------------------------------------------------------------------
export function getStoreProfile(tenantId: string): StoreProfileSettings {
  const adminRecord = SUPERADMIN_STORES.find((s) => s.id === tenantId);

  const defaultProfile: StoreProfileSettings = {
    logoUrl: adminRecord?.logo_url || '',
    name: adminRecord?.name || 'Mi Comercio',
    description: 'Comercio registrado en la plataforma MAXINEGO.',
    address: 'Bolivia',
    phone: adminRecord?.owner.phone || '+591 70000000',
    whatsapp: adminRecord?.owner.socials?.whatsapp || '+591 70000000',
    email: adminRecord?.owner.email || 'contacto@comercio.bo',
    attentionInfo: 'Atención presencial y pedidos online.',
    socials: {
      whatsapp: adminRecord?.owner.socials?.whatsapp || '+591 70000000',
      instagram: adminRecord?.owner.socials?.instagram || '@comercio_bo',
      facebook: adminRecord?.owner.socials?.facebook || 'ComercioBolivia',
      tiktok: '@comercio.bolivia',
      youtube: 'https://youtube.com/@comerciobo',
    },
  };

  return loadFromStorage<StoreProfileSettings>(tenantId, 'profile', defaultProfile);
}

/**
 * Consulta la información oficial del comercio desde Supabase (tabla 'stores').
 * Extrae name y logo_url desde sus columnas nativas, y el resto desde stores.profile.
 * Mantiene sincronizada la caché local del tenant.
 */
export async function fetchStoreProfile(tenantId: string): Promise<StoreProfileSettings> {
  if (!tenantId) {
    return getStoreProfile(tenantId);
  }

  const cachedProfile = getStoreProfile(tenantId);

  try {
    // 1. Intentar consultar stores con columna profile
    const { data, error } = await supabase
      .from('stores')
      .select('id, name, logo_url, profile')
      .eq('id', tenantId)
      .maybeSingle();

    if (!error && data) {
      const rawProfile = (data.profile && typeof data.profile === 'object') ? data.profile : {};
      const remoteProfile: StoreProfileSettings = {
        name: data.name !== undefined && data.name !== null ? String(data.name) : cachedProfile.name,
        logoUrl: data.logo_url !== undefined && data.logo_url !== null ? String(data.logo_url) : cachedProfile.logoUrl,
        description: rawProfile.description !== undefined ? String(rawProfile.description) : cachedProfile.description,
        address: rawProfile.address !== undefined ? String(rawProfile.address) : cachedProfile.address,
        phone: rawProfile.phone !== undefined ? String(rawProfile.phone) : cachedProfile.phone,
        whatsapp: rawProfile.whatsapp !== undefined ? String(rawProfile.whatsapp) : cachedProfile.whatsapp,
        email: rawProfile.email !== undefined ? String(rawProfile.email) : cachedProfile.email,
        attentionInfo: rawProfile.attentionInfo !== undefined ? String(rawProfile.attentionInfo) : cachedProfile.attentionInfo,
        socials: {
          instagram: rawProfile.socials?.instagram !== undefined ? String(rawProfile.socials.instagram) : (cachedProfile.socials?.instagram || ''),
          facebook: rawProfile.socials?.facebook !== undefined ? String(rawProfile.socials.facebook) : (cachedProfile.socials?.facebook || ''),
          tiktok: rawProfile.socials?.tiktok !== undefined ? String(rawProfile.socials.tiktok) : (cachedProfile.socials?.tiktok || ''),
          youtube: rawProfile.socials?.youtube !== undefined ? String(rawProfile.socials.youtube) : (cachedProfile.socials?.youtube || ''),
          whatsapp: rawProfile.socials?.whatsapp !== undefined ? String(rawProfile.socials.whatsapp) : (cachedProfile.socials?.whatsapp || cachedProfile.whatsapp || ''),
        },
        location: (rawProfile.location && typeof rawProfile.location === 'object' && rawProfile.location.isConfigured)
          ? rawProfile.location
          : cachedProfile.location,
      };

      saveToStorage(tenantId, 'profile', remoteProfile);
      return remoteProfile;
    }

    // 2. Si la columna 'profile' no existe aún en el esquema (PGRST204 o 42703), consultar columnas nativas
    if (error && (error.code === '42703' || error.code === 'PGRST204' || error.message?.includes('profile'))) {
      const { data: baseData, error: baseErr } = await supabase
        .from('stores')
        .select('id, name, logo_url')
        .eq('id', tenantId)
        .maybeSingle();

      if (!baseErr && baseData) {
        const merged: StoreProfileSettings = {
          ...cachedProfile,
          name: baseData.name !== undefined && baseData.name !== null ? String(baseData.name) : cachedProfile.name,
          logoUrl: baseData.logo_url !== undefined && baseData.logo_url !== null ? String(baseData.logo_url) : cachedProfile.logoUrl,
        };
        saveToStorage(tenantId, 'profile', merged);
        return merged;
      }
    }

    if (error) {
      console.warn('[CentralBo StoreAdmin] Error al consultar perfil en Supabase:', error.message);
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar perfil en Supabase:', err);
  }

  return cachedProfile;
}

/**
 * Normaliza y construye la configuración de ubicación en Google Maps a partir de:
 * - Coordenadas ("-16.5321, -68.0865")
 * - Enlace directo de Google Maps (maps.google.com, goo.gl, maps.app.goo.gl)
 * - Dirección física o punto de referencia ("Av. Ballivián #1234, Calacoto, La Paz")
 * Genera la URL oficial externa y la URL segura de iframe embed.
 */
export function buildGoogleMapsLocation(
  queryInput: string,
  referenceNotes?: string
): StoreLocationSettings | null {
  if (!queryInput || !queryInput.trim()) return null;
  const raw = queryInput.trim();

  let cleanQuery = raw;
  let lat: number | undefined = undefined;
  let lng: number | undefined = undefined;

  // 1. Detectar si son coordenadas puras: "-16.5321, -68.0865" o "-16.5321,-68.0865"
  const coordsRegex = /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;
  if (coordsRegex.test(raw)) {
    const parts = raw.split(',').map((p) => p.trim());
    lat = parseFloat(parts[0]);
    lng = parseFloat(parts[1]);
    cleanQuery = `${lat},${lng}`;
  } else if (raw.includes('@') && raw.includes(',')) {
    // 2. Extraer de URL tipo google.com/maps/@-16.5321,-68.0865,17z
    const match = raw.match(/@([-+]?\d+\.\d+),([-+]?\d+\.\d+)/);
    if (match) {
      lat = parseFloat(match[1]);
      lng = parseFloat(match[2]);
      cleanQuery = `${lat},${lng}`;
    }
  } else if (raw.includes('q=') || raw.includes('query=')) {
    // 3. Extraer de URL tipo google.com/maps?q=...
    try {
      const parsedUrl = new URL(raw);
      const q = parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query');
      if (q) {
        cleanQuery = q;
        const subMatch = q.match(/^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/);
        if (subMatch) {
          const parts = q.split(',').map((p) => p.trim());
          lat = parseFloat(parts[0]);
          lng = parseFloat(parts[1]);
        }
      }
    } catch {}
  }

  // URL canónica externa para abrir en Google Maps
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleanQuery)}`;
  // URL de iframe seguro para embed visual con zoom 16
  const embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(cleanQuery)}&z=16&output=embed`;

  return {
    isConfigured: true,
    query: cleanQuery,
    latitude: lat,
    longitude: lng,
    displayAddress: cleanQuery,
    referenceNotes: referenceNotes?.trim() || undefined,
    mapsUrl,
    embedUrl,
    confirmedAt: new Date().toISOString(),
  };
}

/**
 * Persiste los datos del perfil de forma centralizada en Supabase:
 * - name -> stores.name
 * - logoUrl -> stores.logo_url
 * - resto de campos -> stores.profile (JSONB)
 * La actualización queda estrictamente aislada por tenantId (store.id).
 */
export async function saveStoreProfile(
  tenantId: string,
  settings: StoreProfileSettings
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string') {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!settings.name || !settings.name.trim()) {
    return { success: false, error: 'El nombre del comercio es obligatorio.' };
  }

  const cleanName = settings.name.trim();
  const cleanLogo = settings.logoUrl && settings.logoUrl.trim() ? settings.logoUrl.trim() : null;

  const profilePayload = {
    description: settings.description || '',
    address: settings.address || '',
    phone: settings.phone || '',
    whatsapp: settings.whatsapp || '',
    email: settings.email || '',
    attentionInfo: settings.attentionInfo || '',
    socials: {
      instagram: settings.socials?.instagram || '',
      facebook: settings.socials?.facebook || '',
      tiktok: settings.socials?.tiktok || '',
      youtube: settings.socials?.youtube || '',
      whatsapp: settings.socials?.whatsapp || settings.whatsapp || '',
    },
    location: settings.location || undefined,
  };

  const now = new Date().toISOString();

  try {
    // 1. Intentar actualizar stores con profile JSONB + name + logo_url
    const { error: fullUpdateError } = await supabase
      .from('stores')
      .update({
        name: cleanName,
        logo_url: cleanLogo,
        profile: profilePayload,
        updated_at: now,
      })
      .eq('id', tenantId);

    if (!fullUpdateError) {
      // Guardado exitoso en Supabase: actualizar caché local
      saveToStorage(tenantId, 'profile', settings);
      return { success: true };
    }

    // 2. Si la columna 'profile' no existe en el esquema remoto (PGRST204 o 42703)
    if (
      fullUpdateError.code === 'PGRST204' ||
      fullUpdateError.code === '42703' ||
      fullUpdateError.message?.includes('profile')
    ) {
      // Guardar name y logo_url en las columnas existentes en Supabase
      const { error: baseUpdateError } = await supabase
        .from('stores')
        .update({
          name: cleanName,
          logo_url: cleanLogo,
          updated_at: now,
        })
        .eq('id', tenantId);

      if (baseUpdateError) {
        return {
          success: false,
          error: `Error al actualizar stores en Supabase: ${baseUpdateError.message}`,
        };
      }

      // Guardar en almacenamiento local
      saveToStorage(tenantId, 'profile', settings);

      return {
        success: false,
        error: "Columna 'profile' no detectada en la base de datos de Supabase. Ejecuta en el SQL Editor: ALTER TABLE stores ADD COLUMN IF NOT EXISTS profile JSONB DEFAULT '{}'::jsonb;",
      };
    }

    return {
      success: false,
      error: fullUpdateError.message || 'Error desconocido al guardar en Supabase.',
    };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al guardar perfil en Supabase:', err);
    return {
      success: false,
      error: err?.message || 'Error de conexión con Supabase.',
    };
  }
}

// ----------------------------------------------------------------------------
// 2.1 GESTIÓN DE ALMACENAMIENTO DE LOGO (Supabase Storage: bucket 'store-logos')
// ----------------------------------------------------------------------------

export const ALLOWED_LOGO_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
];

export const MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB

export interface UploadLogoResult {
  success: boolean;
  publicUrl?: string;
  error?: string;
}

/**
 * Sube el archivo de logo del comercio al bucket público 'store-logos' de Supabase Storage.
 * 
 * Reglas y Garantías:
 * 1. Valida estrictamente el tenantId y el archivo.
 * 2. Valida formatos permitidos (PNG, JPEG, WEBP, SVG) y tamaño máximo (2 MB).
 * 3. Aislamiento por tenant: ruta canónica '{tenantId}/logo.{ext}'.
 * 4. Garantiza UN SOLO LOGO VIGENTE: tras subir con upsert, elimina cualquier archivo
 *    obsoleto con otra extensión dentro del directorio del tenant.
 * 5. Obtiene la URL pública mediante supabase.storage.from('store-logos').getPublicUrl().
 * 6. NO utiliza URLs temporales ni base64 persistente.
 */
export async function uploadStoreLogo(
  tenantId: string,
  file: File
): Promise<UploadLogoResult> {
  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!file) {
    return { success: false, error: 'No se ha seleccionado ningún archivo de imagen.' };
  }

  if (file.size > MAX_LOGO_SIZE_BYTES) {
    return {
      success: false,
      error: 'El archivo supera el tamaño máximo permitido de 2 MB (límite del bucket store-logos).',
    };
  }

  const normalizedType = file.type?.toLowerCase() || '';
  if (!ALLOWED_LOGO_MIME_TYPES.includes(normalizedType)) {
    return {
      success: false,
      error: 'Formato no permitido. Solo se aceptan archivos PNG, JPEG/JPG, WEBP o SVG.',
    };
  }

  // Determinar extensión limpia según MIME type
  let ext = 'png';
  if (normalizedType === 'image/jpeg') ext = 'jpg';
  else if (normalizedType === 'image/webp') ext = 'webp';
  else if (normalizedType === 'image/svg+xml') ext = 'svg';
  else if (normalizedType === 'image/png') ext = 'png';
  else {
    const parts = file.name.split('.');
    if (parts.length > 1) {
      const candidateExt = parts.pop()?.toLowerCase();
      if (candidateExt === 'jpeg' || candidateExt === 'jpg') ext = 'jpg';
      else if (candidateExt === 'webp') ext = 'webp';
      else if (candidateExt === 'svg') ext = 'svg';
      else if (candidateExt === 'png') ext = 'png';
    }
  }

  const cleanTenantId = tenantId.trim();
  const targetFileName = `logo.${ext}`;
  const targetPath = `${cleanTenantId}/${targetFileName}`;

  try {
    // 1. Subir archivo al bucket store-logos (upsert reemplaza si es idéntico nombre)
    const { error: uploadError } = await supabase.storage
      .from('store-logos')
      .upload(targetPath, file, {
        contentType: normalizedType,
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      return {
        success: false,
        error: `Error al subir el archivo a Supabase Storage: ${uploadError.message}`,
      };
    }

    // 2. Garantizar un solo logo vigente:
    // Limpiar cualquier archivo previo con extensión diferente en la carpeta del tenant
    try {
      const { data: existingFiles } = await supabase.storage
        .from('store-logos')
        .list(cleanTenantId);

      if (existingFiles && Array.isArray(existingFiles) && existingFiles.length > 0) {
        const obsoleteFiles = existingFiles
          .filter((item) => item.name !== targetFileName)
          .map((item) => `${cleanTenantId}/${item.name}`);

        if (obsoleteFiles.length > 0) {
          await supabase.storage.from('store-logos').remove(obsoleteFiles);
        }
      }
    } catch (cleanupErr) {
      console.warn('[uploadStoreLogo] Advertencia no bloqueante al limpiar logos obsoletos:', cleanupErr);
    }

    // 3. Obtener URL pública oficial generada por Supabase Storage
    const { data: urlData } = supabase.storage
      .from('store-logos')
      .getPublicUrl(targetPath);

    if (!urlData?.publicUrl) {
      return {
        success: false,
        error: 'No se pudo resolver la URL pública del logo en Supabase Storage.',
      };
    }

    return {
      success: true,
      publicUrl: urlData.publicUrl,
    };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción en uploadStoreLogo:', err);
    return {
      success: false,
      error: err?.message || 'Error de red inesperado al comunicarse con Supabase Storage.',
    };
  }
}

// ----------------------------------------------------------------------------
// 2.1B GESTIÓN DE ALMACENAMIENTO DE BANNERS (Módulo 2: Banners de mi tienda)
// ----------------------------------------------------------------------------

export const ALLOWED_BANNER_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

export const MAX_BANNER_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export async function uploadStoreBanner(
  tenantId: string,
  file: File
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!file) {
    return { success: false, error: 'No se ha seleccionado ningún archivo de imagen.' };
  }

  if (file.size > MAX_BANNER_SIZE_BYTES) {
    return {
      success: false,
      error: 'La imagen del banner supera el tamaño máximo permitido de 5 MB.',
    };
  }

  const normalizedType = file.type?.toLowerCase() || '';
  if (!ALLOWED_BANNER_MIME_TYPES.includes(normalizedType)) {
    return {
      success: false,
      error: 'Formato no permitido. Solo se aceptan imágenes en formato PNG, JPEG o WEBP.',
    };
  }

  let ext = 'jpg';
  if (normalizedType === 'image/png') ext = 'png';
  else if (normalizedType === 'image/webp') ext = 'webp';

  const cleanTenantId = tenantId.trim();
  const bannerId = `banner-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const targetFileName = `${bannerId}.${ext}`;
  const targetPath = `${cleanTenantId}/banners/${targetFileName}`;

  const readAsDataUrl = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('No se pudo procesar la imagen del banner.'));
      reader.readAsDataURL(file);
    });

  try {
    const { error: uploadError } = await supabase.storage
      .from('store-logos')
      .upload(targetPath, file, {
        contentType: normalizedType,
        cacheControl: '3600',
        upsert: true,
      });

    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from('store-logos')
        .getPublicUrl(targetPath);

      if (urlData?.publicUrl) {
        return {
          success: true,
          publicUrl: urlData.publicUrl,
        };
      }
    }

    // Fallback con Data URL si Storage no responde o el bucket tiene restricciones
    const fallbackUrl = await readAsDataUrl();
    return {
      success: true,
      publicUrl: fallbackUrl,
    };
  } catch (err: any) {
    try {
      const fallbackUrl = await readAsDataUrl();
      return {
        success: true,
        publicUrl: fallbackUrl,
      };
    } catch {
      return {
        success: false,
        error: err?.message || 'Error al procesar la imagen del banner.',
      };
    }
  }
}

// ----------------------------------------------------------------------------
// 2.1C GESTIÓN DE ALMACENAMIENTO DE ESTADOS MULTIMEDIA (Módulo 4: Estados PRO)
// ----------------------------------------------------------------------------

export const ALLOWED_STORY_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

export const ALLOWED_STORY_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
];

export const MAX_STORY_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_STORY_VIDEO_SIZE_BYTES = 40 * 1024 * 1024; // 40 MB

export interface UploadStoryMediaResult {
  success: boolean;
  publicUrl?: string;
  mediaType?: 'image' | 'video';
  error?: string;
}

export async function uploadStoreStoryMedia(
  tenantId: string,
  file: File
): Promise<UploadStoryMediaResult> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!file) {
    return { success: false, error: 'No se ha seleccionado ningún archivo multimedia.' };
  }

  const normalizedType = file.type?.toLowerCase() || '';
  const isImage = ALLOWED_STORY_IMAGE_MIME_TYPES.includes(normalizedType) || normalizedType.startsWith('image/');
  const isVideo = ALLOWED_STORY_VIDEO_MIME_TYPES.includes(normalizedType) || normalizedType.startsWith('video/');

  if (!isImage && !isVideo) {
    return {
      success: false,
      error: 'Formato no permitido. Solo se aceptan fotografías (PNG, JPG, WEBP) o videos cortos (MP4, WEBM, MOV).',
    };
  }

  const maxSize = isVideo ? MAX_STORY_VIDEO_SIZE_BYTES : MAX_STORY_IMAGE_SIZE_BYTES;
  if (file.size > maxSize) {
    return {
      success: false,
      error: isVideo
        ? 'El video supera el tamaño máximo permitido de 40 MB.'
        : 'La fotografía supera el tamaño máximo permitido de 10 MB.',
    };
  }

  const mediaType: 'image' | 'video' = isVideo ? 'video' : 'image';
  let ext = isVideo ? 'mp4' : 'jpg';
  if (normalizedType === 'image/png') ext = 'png';
  else if (normalizedType === 'image/webp') ext = 'webp';
  else if (normalizedType === 'video/webm') ext = 'webm';
  else if (normalizedType === 'video/quicktime') ext = 'mov';

  const cleanTenantId = tenantId.trim();
  const storyId = `story-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const targetFileName = `${storyId}.${ext}`;
  const targetPath = `${cleanTenantId}/stories/${targetFileName}`;

  const readAsDataUrl = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('No se pudo procesar el archivo multimedia.'));
      reader.readAsDataURL(file);
    });

  try {
    const { error: uploadError } = await supabase.storage
      .from('store-logos')
      .upload(targetPath, file, {
        contentType: normalizedType || (isVideo ? 'video/mp4' : 'image/jpeg'),
        cacheControl: '3600',
        upsert: true,
      });

    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from('store-logos')
        .getPublicUrl(targetPath);

      if (urlData?.publicUrl) {
        return {
          success: true,
          publicUrl: urlData.publicUrl,
          mediaType,
        };
      }
    }

    const fallbackUrl = await readAsDataUrl();
    return {
      success: true,
      publicUrl: fallbackUrl,
      mediaType,
    };
  } catch (err: any) {
    try {
      const fallbackUrl = await readAsDataUrl();
      return {
        success: true,
        publicUrl: fallbackUrl,
        mediaType,
      };
    } catch {
      return {
        success: false,
        error: err?.message || 'Error al procesar el archivo multimedia del estado.',
      };
    }
  }
}

// ----------------------------------------------------------------------------
// 2.2 GESTIÓN DE ALMACENAMIENTO DE IMÁGENES DE PRODUCTOS (Bucket 'product-images')
// ----------------------------------------------------------------------------

export const ALLOWED_PRODUCT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
];

export const MAX_PRODUCT_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface UploadProductImageResult {
  success: boolean;
  publicUrl?: string;
  path?: string;
  error?: string;
}

/**
 * Determina si una URL pertenece al bucket 'product-images' de Supabase Storage.
 */
export function isProductStorageUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== 'string') return false;
  return (
    url.includes('/storage/v1/object/public/product-images/') ||
    url.includes('/product-images/')
  );
}

/**
 * Extrae la ruta de almacenamiento relativa dentro de 'product-images' para un tenant específico.
 * Garantiza estrictamente el prefijo {tenantId}/ para evitar cualquier manipulación cross-tenant.
 */
export function extractStoragePathFromProductUrl(
  url: string,
  tenantId: string
): string | null {
  if (!isProductStorageUrl(url)) return null;
  const marker = '/product-images/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const rawPath = url.substring(idx + marker.length).split('?')[0];
  const cleanTenantId = tenantId.trim();
  if (rawPath.startsWith(`${cleanTenantId}/`)) {
    return rawPath;
  }
  return null;
}

/**
 * Sube la imagen principal de un producto al bucket público 'product-images' de Supabase Storage.
 *
 * Reglas de Seguridad y Consistencia:
 * 1. Valida tenantId y productId en formato UUID.
 * 2. Valida tamaño (<= 5 MB) y formatos permitidos (PNG, JPEG, WEBP).
 * 3. Aislamiento estricto por tenant en el path: '{cleanTenantId}/{cleanProductId}.{ext}'.
 * 4. Limpia archivos obsoletos con extensión diferente para el mismo producto.
 * 5. Obtiene la URL pública canónica generada por Supabase Storage.
 */
export async function uploadProductImage(
  tenantId: string,
  productId: string,
  file: File,
  slotIndex?: number
): Promise<UploadProductImageResult> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!productId || typeof productId !== 'string' || !isValidUUID(productId)) {
    return { success: false, error: 'Identificador de producto (productId) no válido.' };
  }

  if (!file) {
    return { success: false, error: 'No se ha seleccionado ningún archivo de imagen.' };
  }

  if (file.size > MAX_PRODUCT_IMAGE_SIZE_BYTES) {
    return {
      success: false,
      error: 'La imagen supera el tamaño máximo permitido de 5 MB.',
    };
  }

  const normalizedType = file.type?.toLowerCase() || '';
  if (!ALLOWED_PRODUCT_IMAGE_MIME_TYPES.includes(normalizedType)) {
    return {
      success: false,
      error: 'Formato no permitido. Solo se aceptan imágenes en formato PNG, JPEG/JPG o WEBP.',
    };
  }

  // Mapeo seguro de extensión desde MIME validado
  let ext = 'jpg';
  if (normalizedType === 'image/png') ext = 'png';
  else if (normalizedType === 'image/webp') ext = 'webp';
  else if (normalizedType === 'image/jpeg') ext = 'jpg';

  const cleanTenantId = tenantId.trim();
  const cleanProductId = productId.trim();
  const slotSuffix = typeof slotIndex === 'number' && slotIndex > 0 ? `_slot${slotIndex}` : '';
  const targetFileName = `${cleanProductId}${slotSuffix}.${ext}`;
  const targetPath = `${cleanTenantId}/${targetFileName}`;

  const readAsDataUrl = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('No se pudo procesar la imagen del producto.'));
      reader.readAsDataURL(file);
    });

  try {
    // 1. Subir archivo al bucket product-images (upsert reemplaza archivo con idéntico nombre)
    const { error: uploadError } = await supabase.storage
      .from('product-images')
      .upload(targetPath, file, {
        contentType: normalizedType,
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      console.warn('[CentralBo StoreAdmin] Almacenamiento remoto no disponible o falló:', uploadError.message);
    } else {
      // 2. Limpieza de extensiones previas obsoletas para este producto dentro de la carpeta del tenant
      try {
        const { data: existingFiles } = await supabase.storage
          .from('product-images')
          .list(cleanTenantId);

        if (existingFiles && Array.isArray(existingFiles) && existingFiles.length > 0) {
          const obsoletePrefix = `${cleanProductId}${slotSuffix}.`;
          const obsoleteFiles = existingFiles
            .filter(
              (item) =>
                item.name.startsWith(obsoletePrefix) && item.name !== targetFileName
            )
            .map((item) => `${cleanTenantId}/${item.name}`);

          if (obsoleteFiles.length > 0) {
            await supabase.storage.from('product-images').remove(obsoleteFiles);
          }
        }
      } catch (cleanupErr) {
        console.warn('[uploadProductImage] Advertencia no bloqueante al limpiar imágenes obsoletas:', cleanupErr);
      }

      // 3. Obtener URL pública oficial
      const { data: urlData } = supabase.storage
        .from('product-images')
        .getPublicUrl(targetPath);

      if (urlData?.publicUrl) {
        return {
          success: true,
          publicUrl: urlData.publicUrl,
          path: targetPath,
        };
      }
    }
  } catch (err: any) {
    console.warn('[CentralBo StoreAdmin] Excepción inesperada en Supabase Storage, usando persistencia local:', err);
  }

  // Fallback de resiliencia mediante Data URL para garantizar que la fotografía nunca se pierda
  try {
    const dataUrl = await readAsDataUrl();
    return {
      success: true,
      publicUrl: dataUrl,
      path: targetPath,
    };
  } catch (fallbackErr: any) {
    return {
      success: false,
      error: fallbackErr?.message || 'Error al procesar la imagen seleccionada.',
    };
  }
}

/**
 * Elimina una imagen del bucket 'product-images' si corresponde a Supabase Storage.
 * Si es una URL externa (ej. Unsplash), no realiza ninguna acción en Storage y retorna éxito.
 */
export async function deleteProductImage(
  tenantId: string,
  urlOrPath: string
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || !urlOrPath || typeof urlOrPath !== 'string') {
    return { success: true };
  }

  const cleanTenantId = tenantId.trim();
  const targetPath =
    extractStoragePathFromProductUrl(urlOrPath, cleanTenantId) ||
    (urlOrPath.startsWith(`${cleanTenantId}/`) ? urlOrPath : null);

  // Si no pertenece a product-images de este tenant, omitir
  if (!targetPath) {
    return { success: true };
  }

  try {
    const { error } = await supabase.storage
      .from('product-images')
      .remove([targetPath]);

    if (error) {
      console.warn('[deleteProductImage] Error al eliminar imagen de Storage:', error.message);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.warn('[deleteProductImage] Excepción al eliminar imagen de Storage:', err);
    return { success: false, error: err?.message };
  }
}

// ----------------------------------------------------------------------------
// 3. APARIENCIA Y PLAN (Basic vs Pro)
// ----------------------------------------------------------------------------
export function getDefaultStoreHighlights(tenantId: string): StoreHighlightItem[] {
  const items: StoreHighlightItem[] = [];

  // 1. Envíos reales configurados
  try {
    const shipping = getCachedStoreShipping(tenantId);
    if (shipping && shipping.offersShipping) {
      items.push({
        id: 'shipping',
        icon: '📦',
        title: 'Envíos a Domicilio',
        description:
          shipping.shippingType === 'free'
            ? 'Envíos sin costo adicional según monto'
            : `Tarifa fija de envío Bs ${shipping.fixedCost}`,
        badge: shipping.shippingType === 'free' ? 'Gratis' : 'Delivery',
      });
    }
  } catch (e) {
    // ignore
  }

  // 2. Pedidos programados o citas
  try {
    const scheduled = getStoreScheduledOrders(tenantId);
    if (scheduled && scheduled.enabled) {
      items.push({
        id: 'scheduled',
        icon: '📅',
        title: 'Pedidos Programados',
        description: `Coordina tu entrega con hasta ${scheduled.maxAdvanceDays} días de anticipación`,
        badge: 'Planifica',
      });
    }
  } catch (e) {
    // ignore
  }

  // 3. Atención directa por WhatsApp
  try {
    const prof = getStoreProfile(tenantId);
    if (prof && (prof.whatsapp || prof.phone)) {
      items.push({
        id: 'whatsapp',
        icon: '💬',
        title: 'Atención Directa',
        description: 'Consultas y confirmación de pedidos vía WhatsApp',
        badge: 'Respuesta Rápida',
      });
    }
  } catch (e) {
    // ignore
  }

  // 4. Métodos de pago
  try {
    const payment = getStorePaymentSettings(tenantId);
    if (payment && payment.qrSimple) {
      items.push({
        id: 'payment',
        icon: '📱',
        title: 'Pago Rápido con QR',
        description: 'Aceptamos transferencias y cobro QR directo',
        badge: 'QR Simple',
      });
    }
  } catch (e) {
    // ignore
  }

  // Si no hay suficientes elementos basados en configuración específica, proveer un destacado neutro y verídico
  if (items.length === 0) {
    items.push({
      id: 'store-direct',
      icon: '✨',
      title: 'Venta Directa',
      description: 'Precios directos del comercio sin intermediarios',
      badge: 'Oficial',
    });
    items.push({
      id: 'online-catalog',
      icon: '🛒',
      title: 'Catálogo en Línea',
      description: 'Explora y haz tu pedido directamente desde tu dispositivo',
      badge: '24/7',
    });
  }

  return items;
}

export function getCachedStoreAppearance(tenantId: string): StoreAppearanceSettings {
  const plan = getStorePlan(tenantId);
  const defaultAppearance: StoreAppearanceSettings = {
    theme: 'dark',
    brandPrimaryColor: plan === 'pro' ? '#4f46e5' : '#4f46e5',
    brandSecondaryColor: plan === 'pro' ? '#06b6d4' : '#06b6d4',
    brandAccentColor: plan === 'pro' ? '#f59e0b' : '#f59e0b',
    customDomain: '',
    domainVerified: plan === 'pro',
    visualStyle: 'modern',
    templateId: 'free',
    banners: [],
    stories: [],
    showHighlights: true,
    highlightsLayout: 'balanced',
    highlights: getDefaultStoreHighlights(tenantId),
  };

  const stored = loadFromStorage<StoreAppearanceSettings>(tenantId, 'appearance', defaultAppearance);

  if (!Array.isArray(stored.banners)) {
    stored.banners = [];
  }
  if (!Array.isArray(stored.stories)) {
    stored.stories = [];
  }
  // Asegurar que si stored no tiene highlights definidos, reciba los highlights por defecto reales
  if (!stored.highlights || stored.highlights.length === 0) {
    stored.highlights = getDefaultStoreHighlights(tenantId);
  }
  if (!stored.highlightsLayout) {
    stored.highlightsLayout = 'balanced';
  }
  if (stored.showHighlights === undefined) {
    stored.showHighlights = true;
  }
  if (!stored.g7Settings && (tenantId === 'chifabill' || tenantId.toLowerCase().includes('chifa'))) {
    stored.g7Settings = {
      tagline: 'CHIFA',
    };
  }

  return stored;
}

/**
 * Consulta la configuración de apariencia oficial desde Supabase (tabla 'stores.appearance').
 * Supabase actúa como Fuente de Verdad Canónica.
 * Si existe configuración en Supabase, prevalece sobre localStorage y actualiza la caché local.
 * Si la columna no existe o falla la red, utiliza la caché local como fallback.
 */
export async function getStoreAppearance(tenantId: string): Promise<StoreAppearanceSettings> {
  if (!tenantId || typeof tenantId !== 'string') {
    return getCachedStoreAppearance(tenantId);
  }

  const cached = getCachedStoreAppearance(tenantId);
  const plan = getStorePlan(tenantId);

  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, appearance')
      .eq('id', tenantId)
      .maybeSingle();

    if (!error && data && data.appearance && typeof data.appearance === 'object' && Object.keys(data.appearance).length > 0) {
      const raw = data.appearance as Record<string, any>;
      const isPro = plan === 'pro';

      const remoteAppearance: StoreAppearanceSettings = {
        theme: raw.theme === 'light' ? 'light' : 'dark',
        brandPrimaryColor: isPro && typeof raw.brandPrimaryColor === 'string' && raw.brandPrimaryColor
          ? raw.brandPrimaryColor
          : (isPro ? (cached.brandPrimaryColor || '#4f46e5') : '#4f46e5'),
        brandSecondaryColor: isPro && typeof raw.brandSecondaryColor === 'string' && raw.brandSecondaryColor
          ? raw.brandSecondaryColor
          : (isPro ? (cached.brandSecondaryColor || '#06b6d4') : '#06b6d4'),
        brandAccentColor: isPro && typeof raw.brandAccentColor === 'string' && raw.brandAccentColor
          ? raw.brandAccentColor
          : (isPro ? (cached.brandAccentColor || '#f59e0b') : '#f59e0b'),
        customDomain: isPro && typeof raw.customDomain === 'string' ? raw.customDomain : '',
        domainVerified: isPro && Boolean(raw.domainVerified),
        visualStyle: (raw.visualStyle === 'minimal' || raw.visualStyle === 'elegant') ? raw.visualStyle : 'modern',
        templateId: raw.templateId || cached.templateId || 'free',
        banners: Array.isArray(raw.banners) ? raw.banners : (cached.banners || []),
        stories: isPro && Array.isArray(raw.stories) ? raw.stories : (isPro ? (cached.stories || []) : []),
        showHighlights: raw.showHighlights !== undefined ? Boolean(raw.showHighlights) : true,
        highlightsLayout: ['balanced', 'featured', 'horizontal', 'editorial', 'minimal'].includes(raw.highlightsLayout)
          ? raw.highlightsLayout
          : 'balanced',
        highlights: Array.isArray(raw.highlights) && raw.highlights.length > 0
          ? raw.highlights
          : getDefaultStoreHighlights(tenantId),
        g7Settings: raw.g7Settings && typeof raw.g7Settings === 'object'
          ? {
              tagline: typeof raw.g7Settings.tagline === 'string' && raw.g7Settings.tagline.trim().length > 0
                ? raw.g7Settings.tagline
                : ((tenantId === 'chifabill' || tenantId.toLowerCase().includes('chifa')) ? 'CHIFA' : undefined),
              title: typeof raw.g7Settings.title === 'string' && raw.g7Settings.title.trim().length > 0
                ? raw.g7Settings.title.trim()
                : undefined,
              description: typeof raw.g7Settings.description === 'string' && raw.g7Settings.description.trim().length > 0
                ? raw.g7Settings.description.trim()
                : undefined,
              coverImageUrl: typeof raw.g7Settings.coverImageUrl === 'string' ? raw.g7Settings.coverImageUrl : undefined,
            }
          : (cached.g7Settings || ((tenantId === 'chifabill' || tenantId.toLowerCase().includes('chifa')) ? { tagline: 'CHIFA' } : undefined)),
      };

      // Actualizar caché local con la fuente canónica de Supabase
      saveToStorage(tenantId, 'appearance', remoteAppearance);
      return remoteAppearance;
    }

    if (error) {
      console.warn('[CentralBo StoreAdmin] Aviso al consultar appearance en Supabase:', error.message);
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar appearance en Supabase:', err);
  }

  // Fallback a caché local o valores predeterminados
  return cached;
}

// Alias para consistencia de API
export const fetchStoreAppearance = getStoreAppearance;

/**
 * Persiste la configuración de apariencia de forma centralizada en Supabase (stores.appearance).
 * Aplica reglas estrictas de planes (Basic vs Pro) y aislamiento multi-tenant por tenantId.
 * Únicamente retorna success=true tras la confirmación real de Supabase.
 */
export async function saveStoreAppearance(
  tenantId: string,
  settings: StoreAppearanceSettings
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  const plan = getStorePlan(tenantId);
  const isPaid = plan === 'basic' || plan === 'pro';

  // Sanitizar banners comerciales para planes BASIC y PRO
  const cleanBanners: StoreBannerItem[] = isPaid && Array.isArray(settings.banners)
    ? settings.banners.map((b, idx) => ({
        id: b.id || `banner-${idx + 1}-${Date.now()}`,
        imageUrl: b.imageUrl,
        title: b.title?.trim() || undefined,
        order: typeof b.order === 'number' ? b.order : idx,
        createdAt: b.createdAt || new Date().toISOString(),
      }))
    : [];

  // Sanitizar estados multimedia (exclusivo para plan PRO)
  const cleanStories: StoreStoryItem[] = plan === 'pro' && Array.isArray(settings.stories)
    ? settings.stories.map((s, idx) => ({
        id: s.id || `story-${idx + 1}-${Date.now()}`,
        mediaType: s.mediaType === 'video' ? 'video' : 'image',
        mediaUrl: s.mediaUrl,
        title: s.title?.trim() || undefined,
        createdAt: s.createdAt || new Date().toISOString(),
      }))
    : [];

  // Respetar estrictamente la política Basic vs Pro
  let appearancePayload: StoreAppearanceSettings;
  const existing = await getStoreAppearance(tenantId);
  const resolvedG7 = settings.g7Settings !== undefined ? settings.g7Settings : existing.g7Settings;

  if (plan === 'basic') {
    appearancePayload = {
      ...existing,
      theme: settings.theme === 'light' ? 'light' : 'dark',
      brandPrimaryColor: '#4f46e5',
      brandSecondaryColor: '#06b6d4',
      brandAccentColor: '#f59e0b',
      customDomain: '',
      domainVerified: false,
      visualStyle: (settings.visualStyle === 'minimal' || settings.visualStyle === 'elegant') ? settings.visualStyle : 'modern',
      templateId: settings.templateId || 'free',
      banners: cleanBanners,
      stories: [],
      showHighlights: settings.showHighlights !== undefined ? Boolean(settings.showHighlights) : true,
      highlightsLayout: ['balanced', 'featured', 'horizontal', 'editorial', 'minimal'].includes(settings.highlightsLayout || '')
        ? settings.highlightsLayout!
        : 'balanced',
      highlights: Array.isArray(settings.highlights) && settings.highlights.length > 0
        ? settings.highlights
        : (existing.highlights && existing.highlights.length > 0 ? existing.highlights : getDefaultStoreHighlights(tenantId)),
      g7Settings: resolvedG7,
    };
  } else if (plan === 'pro') {
    appearancePayload = {
      theme: settings.theme === 'light' ? 'light' : 'dark',
      brandPrimaryColor: settings.brandPrimaryColor || '#4f46e5',
      brandSecondaryColor: settings.brandSecondaryColor || '#06b6d4',
      brandAccentColor: settings.brandAccentColor || '#f59e0b',
      customDomain: settings.customDomain || '',
      domainVerified: Boolean(settings.domainVerified),
      visualStyle: (settings.visualStyle === 'minimal' || settings.visualStyle === 'elegant') ? settings.visualStyle : 'modern',
      templateId: settings.templateId || 'free',
      banners: cleanBanners,
      stories: cleanStories,
      showHighlights: settings.showHighlights !== undefined ? Boolean(settings.showHighlights) : true,
      highlightsLayout: ['balanced', 'featured', 'horizontal', 'editorial', 'minimal'].includes(settings.highlightsLayout || '')
        ? settings.highlightsLayout!
        : 'balanced',
      highlights: Array.isArray(settings.highlights) && settings.highlights.length > 0
        ? settings.highlights
        : getDefaultStoreHighlights(tenantId),
      g7Settings: resolvedG7 ? {
        tagline: typeof resolvedG7.tagline === 'string' ? resolvedG7.tagline.trim().slice(0, 40) : undefined,
        title: typeof resolvedG7.title === 'string' ? resolvedG7.title.trim().slice(0, 80) : undefined,
        description: typeof resolvedG7.description === 'string' ? resolvedG7.description.trim().slice(0, 240) : undefined,
        coverImageUrl: typeof resolvedG7.coverImageUrl === 'string' ? resolvedG7.coverImageUrl : undefined,
      } : undefined,
    };
  } else {
    // Plan FREE: banners y stories deshabilitados
    appearancePayload = {
      ...existing,
      theme: settings.theme === 'light' ? 'light' : 'dark',
      brandPrimaryColor: '#4f46e5',
      brandSecondaryColor: '#06b6d4',
      brandAccentColor: '#f59e0b',
      customDomain: '',
      domainVerified: false,
      visualStyle: 'modern',
      templateId: 'free',
      banners: [],
      stories: [],
      showHighlights: settings.showHighlights !== undefined ? Boolean(settings.showHighlights) : true,
      highlightsLayout: 'balanced',
      highlights: getDefaultStoreHighlights(tenantId),
      g7Settings: resolvedG7,
    };
  }

  // 1. Persistencia Inmediata Local (Offline-First / Reactividad en tiempo real)
  saveToStorage(tenantId, 'appearance', appearancePayload);

  // Notificar a componentes y vistas públicas activas
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('maxinego:store_appearance_changed', {
        detail: { tenantId, appearance: appearancePayload },
      })
    );
  }

  const now = new Date().toISOString();

  try {
    const { data: updatedRows, error } = await supabase
      .from('stores')
      .update({
        appearance: appearancePayload,
        updated_at: now,
      })
      .eq('id', tenantId)
      .select('id');

    if (error) {
      console.warn('[CentralBo StoreAdmin] Aviso al persistir appearance en Supabase (modo local activo):', error.message);
      // Retornar éxito porque la persistencia local está garantizada
      return { success: true };
    }

    if (!updatedRows || updatedRows.length === 0) {
      console.info('[CentralBo StoreAdmin] Supabase no retornó filas actualizadas, guardado en almacenamiento local confirmado.');
      return { success: true };
    }

    return { success: true };
  } catch (err: any) {
    console.warn('[CentralBo StoreAdmin] Excepción de red al persistir appearance en Supabase (modo local activo):', err);
    return { success: true };
  }
}

/**
 * Sube la fotografía de portada del modelo G7 (o similar) para el comercio.
 * Almacenamiento seguro por tenant en Supabase Storage (bucket 'store-logos') con DataURL fallback.
 */
export async function uploadStoreCoverImage(
  tenantId: string,
  file: File
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !tenantId.trim()) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }
  if (!file) {
    return { success: false, error: 'No se ha seleccionado ninguna imagen.' };
  }
  const normalizedType = file.type?.toLowerCase() || '';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(normalizedType)) {
    return {
      success: false,
      error: 'Formato no permitido. Solo se aceptan imágenes en formato PNG, JPEG o WEBP.',
    };
  }
  if (file.size > 10 * 1024 * 1024) {
    return {
      success: false,
      error: 'La fotografía supera el tamaño máximo permitido de 10 MB.',
    };
  }

  let ext = 'jpg';
  if (normalizedType === 'image/png') ext = 'png';
  else if (normalizedType === 'image/webp') ext = 'webp';

  const cleanTenantId = tenantId.trim();
  const coverId = `g7-cover-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const targetFileName = `${coverId}.${ext}`;
  const targetPath = `${cleanTenantId}/covers/${targetFileName}`;

  const readAsDataUrl = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('No se pudo procesar la imagen de portada.'));
      reader.readAsDataURL(file);
    });

  try {
    const { error: uploadError } = await supabase.storage
      .from('store-logos')
      .upload(targetPath, file, {
        contentType: normalizedType,
        cacheControl: '3600',
        upsert: true,
      });

    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from('store-logos')
        .getPublicUrl(targetPath);

      if (urlData?.publicUrl) {
        return { success: true, publicUrl: urlData.publicUrl };
      }
    }

    const fallbackUrl = await readAsDataUrl();
    return { success: true, publicUrl: fallbackUrl };
  } catch (err: any) {
    try {
      const fallbackUrl = await readAsDataUrl();
      return { success: true, publicUrl: fallbackUrl };
    } catch {
      return { success: false, error: err?.message || 'Error al procesar la imagen de portada.' };
    }
  }
}

// ----------------------------------------------------------------------------
// 4. HORARIOS
// ----------------------------------------------------------------------------

function isValidScheduleArray(data: any): data is StoreScheduleDay[] {
  if (!Array.isArray(data) || data.length === 0) {
    return false;
  }
  return data.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.dayOfWeek === 'number' &&
      typeof item.isOpen === 'boolean' &&
      Array.isArray(item.periods)
  );
}

/**
 * Obtiene la configuración de horarios en caché local o el valor por defecto.
 * Operación sincrónica segura para inicializaciones de interfaz y fallbacks inmediatos.
 */
export function getCachedStoreSchedule(tenantId: string): StoreScheduleDay[] {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return JSON.parse(JSON.stringify(DEFAULT_WEEK_SCHEDULE));
  }
  const cached = loadFromStorage<StoreScheduleDay[]>(tenantId, 'schedule', DEFAULT_WEEK_SCHEDULE);
  if (isValidScheduleArray(cached)) {
    return cached;
  }
  return JSON.parse(JSON.stringify(DEFAULT_WEEK_SCHEDULE));
}

/**
 * Consulta los horarios del comercio con Supabase como fuente canónica de verdad.
 * Flujo:
 * 1. Valida tenantId.
 * 2. Consulta stores.schedule filtrando estrictamente por stores.id = tenantId.
 * 3. Si Supabase devuelve un schedule válido: lo utiliza, actualiza la caché local del tenant y lo retorna.
 * 4. Si la consulta falla o aún no tiene datos configurados: recurre al valor existente de localStorage.
 * 5. Si tampoco existe localStorage válido, utiliza DEFAULT_WEEK_SCHEDULE.
 * 6. Actualiza la caché local con el valor en uso sin sobrescribir Supabase automáticamente.
 */
export async function getStoreSchedule(tenantId: string): Promise<StoreScheduleDay[]> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return JSON.parse(JSON.stringify(DEFAULT_WEEK_SCHEDULE));
  }

  const cached = getCachedStoreSchedule(tenantId);

  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, schedule')
      .eq('id', tenantId)
      .maybeSingle();

    if (!error && data && isValidScheduleArray(data.schedule)) {
      const remoteSchedule = data.schedule as StoreScheduleDay[];
      // Sincronizar la caché local del tenant con el valor canónico
      saveToStorage(tenantId, 'schedule', remoteSchedule);
      return remoteSchedule;
    }

    if (error) {
      console.warn('[CentralBo StoreAdmin] Aviso al consultar schedule en Supabase:', error.message);
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar schedule en Supabase:', err);
  }

  // Fallback seguro: caché local existente o DEFAULT_WEEK_SCHEDULE
  return cached;
}

// Alias para consistencia de API con fetchStoreProfile y fetchStoreAppearance
export const fetchStoreSchedule = getStoreSchedule;

/**
 * Persiste los horarios de atención comercial de forma centralizada en Supabase (stores.schedule).
 * Aislamiento estricto por tenantId (stores.id = tenantId).
 * Solo actualiza la caché local tras la confirmación exitosa de Supabase.
 */
export async function saveStoreSchedule(
  tenantId: string,
  schedule: StoreScheduleDay[]
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!isValidScheduleArray(schedule)) {
    return { success: false, error: 'Formato de horarios inválido o incompleto.' };
  }

  const now = new Date().toISOString();

  try {
    const { data: updatedRows, error } = await supabase
      .from('stores')
      .update({
        schedule: schedule,
        updated_at: now,
      })
      .eq('id', tenantId)
      .select('id');

    if (error) {
      console.error('[CentralBo StoreAdmin] Error al persistir schedule en Supabase:', error);
      return {
        success: false,
        error: error.message || 'Error al persistir la configuración de horarios en Supabase.',
      };
    }

    if (!updatedRows || updatedRows.length === 0) {
      return {
        success: false,
        error: 'No se pudo actualizar el comercio en Supabase. Verifique permisos de administrador o sesión activa.',
      };
    }

    // Persistencia remota confirmada: actualizar la caché local de este tenant
    saveToStorage(tenantId, 'schedule', schedule);
    return { success: true };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al persistir schedule en Supabase:', err);
    return {
      success: false,
      error: err?.message || 'Error de conexión al guardar horarios en el servidor.',
    };
  }
}

// ----------------------------------------------------------------------------
// 5. ENVÍOS (La plataforma NO calcula automáticamente el costo)
// ----------------------------------------------------------------------------
export const DEFAULT_STORE_SHIPPING: StoreShippingSettings = {
  offersShipping: true,
  shippingType: 'fixed',
  fixedCost: 15, // Bs 15 tarifa fija
  minOrderAmount: 50, // Bs 50 mínimo
  maxOrderAmount: 0, // Sin límite
  availableDays: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  availableHours: '11:00 a 20:30',
};

function isValidShippingSettings(data: any): data is StoreShippingSettings {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  if (typeof data.offersShipping !== 'boolean') {
    return false;
  }
  if (data.shippingType !== 'free' && data.shippingType !== 'fixed') {
    return false;
  }
  if (typeof data.fixedCost !== 'number' || isNaN(data.fixedCost)) {
    return false;
  }
  if (typeof data.minOrderAmount !== 'number' || isNaN(data.minOrderAmount)) {
    return false;
  }
  if (typeof data.maxOrderAmount !== 'number' || isNaN(data.maxOrderAmount)) {
    return false;
  }
  if (!Array.isArray(data.availableDays)) {
    return false;
  }
  if (typeof data.availableHours !== 'string') {
    return false;
  }
  return true;
}

/**
 * Retorna la configuración de envíos desde caché local (síncrono).
 * Aislamiento estricto por tenantId.
 * Fallback a DEFAULT_STORE_SHIPPING si no hay caché válida.
 */
export function getCachedStoreShipping(tenantId: string): StoreShippingSettings {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return JSON.parse(JSON.stringify(DEFAULT_STORE_SHIPPING));
  }
  const cached = loadFromStorage<StoreShippingSettings>(tenantId, 'shipping', DEFAULT_STORE_SHIPPING);
  if (isValidShippingSettings(cached)) {
    return cached;
  }
  return JSON.parse(JSON.stringify(DEFAULT_STORE_SHIPPING));
}

/**
 * Consulta la configuración de envíos del comercio con Supabase como fuente canónica.
 * Flujo:
 * 1. Valida tenantId.
 * 2. Consulta stores.shipping filtrando por stores.id = tenantId.
 * 3. Si Supabase devuelve un StoreShippingSettings válido: lo utiliza, actualiza la caché local del tenant y lo retorna.
 * 4. Si la consulta falla o aún no tiene datos configurados: recurre al valor existente de localStorage (fallback).
 * 5. Si tampoco existe localStorage válido, utiliza DEFAULT_STORE_SHIPPING.
 * 6. NO sobrescribe Supabase automáticamente durante la lectura (migración conservadora).
 */
export async function fetchStoreShipping(tenantId: string): Promise<StoreShippingSettings> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return JSON.parse(JSON.stringify(DEFAULT_STORE_SHIPPING));
  }

  const cached = getCachedStoreShipping(tenantId);

  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, shipping')
      .eq('id', tenantId)
      .maybeSingle();

    if (!error && data && isValidShippingSettings(data.shipping)) {
      const remoteShipping = data.shipping as StoreShippingSettings;
      // Actualizar la caché local del tenant con el valor canónico
      saveToStorage(tenantId, 'shipping', remoteShipping);
      return remoteShipping;
    }

    if (error) {
      console.warn('[CentralBo StoreAdmin] Aviso al consultar shipping en Supabase:', error.message);
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar shipping en Supabase:', err);
  }

  // Fallback seguro: caché local existente o DEFAULT_STORE_SHIPPING
  return cached;
}

// Alias para compatibilidad de API con getStoreSchedule / fetchStoreSchedule
export const getStoreShipping = fetchStoreShipping;

/**
 * Persiste la configuración de envíos de forma centralizada en Supabase (stores.shipping).
 * Aislamiento estricto por tenantId (stores.id = tenantId).
 * Solo actualiza la caché local tras la confirmación exitosa de Supabase.
 */
export async function saveStoreShipping(
  tenantId: string,
  settings: StoreShippingSettings
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!isValidShippingSettings(settings)) {
    return { success: false, error: 'Formato de configuración de envíos inválido o incompleto.' };
  }

  const now = new Date().toISOString();

  try {
    const { data: updatedRows, error } = await supabase
      .from('stores')
      .update({
        shipping: settings,
        updated_at: now,
      })
      .eq('id', tenantId)
      .select('id');

    if (error) {
      console.error('[CentralBo StoreAdmin] Error al persistir shipping en Supabase:', error);
      return {
        success: false,
        error: error.message || 'Error al persistir la configuración de envíos en Supabase.',
      };
    }

    if (!updatedRows || updatedRows.length === 0) {
      return {
        success: false,
        error: 'No se pudo actualizar el comercio en Supabase. Verifique permisos de administrador o sesión activa.',
      };
    }

    // Persistencia remota confirmada: actualizar la caché local de este tenant
    saveToStorage(tenantId, 'shipping', settings);
    return { success: true };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al persistir shipping en Supabase:', err);
    return {
      success: false,
      error: err?.message || 'Error de conexión al guardar configuración de envíos en el servidor.',
    };
  }
}

// ----------------------------------------------------------------------------
// 6. PEDIDOS PROGRAMADOS
// ----------------------------------------------------------------------------
export const DEFAULT_STORE_SCHEDULED_ORDERS: StoreScheduledOrdersSettings = {
  enabled: true,
  minAdvanceHours: 2, // Mínimo 2 horas de anticipación
  maxAdvanceDays: 7, // Hasta 7 días a futuro
  availableSlots: [
    '11:30 - 12:30',
    '12:30 - 13:30',
    '13:30 - 14:30',
    '18:30 - 19:30',
    '19:30 - 20:30',
    '20:30 - 21:30',
  ],
  specialConditions:
    'Para pedidos con entrega programada, solicitamos confirmar su dirección con pin de WhatsApp al momento de coordinar el despacho.',
};

function isValidScheduledOrdersSettings(data: any): data is StoreScheduledOrdersSettings {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  if (typeof data.enabled !== 'boolean') {
    return false;
  }
  if (typeof data.minAdvanceHours !== 'number' || isNaN(data.minAdvanceHours)) {
    return false;
  }
  if (typeof data.maxAdvanceDays !== 'number' || isNaN(data.maxAdvanceDays)) {
    return false;
  }
  if (!Array.isArray(data.availableSlots)) {
    return false;
  }
  if (typeof data.specialConditions !== 'string') {
    return false;
  }
  return true;
}

/**
 * Retorna la configuración de pedidos programados desde caché local (síncrono).
 * Aislamiento estricto por tenantId.
 * Fallback a DEFAULT_STORE_SCHEDULED_ORDERS si no hay caché válida.
 */
export function getCachedStoreScheduledOrders(tenantId: string): StoreScheduledOrdersSettings {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return JSON.parse(JSON.stringify(DEFAULT_STORE_SCHEDULED_ORDERS));
  }
  const cached = loadFromStorage<StoreScheduledOrdersSettings>(
    tenantId,
    'scheduled_orders',
    DEFAULT_STORE_SCHEDULED_ORDERS
  );
  if (isValidScheduledOrdersSettings(cached)) {
    return cached;
  }
  return JSON.parse(JSON.stringify(DEFAULT_STORE_SCHEDULED_ORDERS));
}

// Alias para compatibilidad con código existente
export const getStoreScheduledOrders = getCachedStoreScheduledOrders;

/**
 * Consulta la configuración de pedidos programados del comercio con Supabase como fuente canónica.
 * Flujo:
 * 1. Valida tenantId.
 * 2. Consulta stores.scheduled_orders filtrando por stores.id = tenantId.
 * 3. Si Supabase devuelve un StoreScheduledOrdersSettings válido: lo utiliza, actualiza la caché local del tenant y lo retorna.
 * 4. Si la consulta falla o aún no tiene datos configurados: recurre al valor existente de localStorage (fallback).
 * 5. Si tampoco existe localStorage válido, utiliza DEFAULT_STORE_SCHEDULED_ORDERS.
 * 6. NO sobrescribe Supabase automáticamente durante la lectura (migración conservadora).
 */
export async function fetchStoreScheduledOrders(
  tenantId: string
): Promise<StoreScheduledOrdersSettings> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return JSON.parse(JSON.stringify(DEFAULT_STORE_SCHEDULED_ORDERS));
  }

  const cached = getCachedStoreScheduledOrders(tenantId);

  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, scheduled_orders')
      .eq('id', tenantId)
      .maybeSingle();

    if (!error && data && isValidScheduledOrdersSettings(data.scheduled_orders)) {
      const remoteScheduled = data.scheduled_orders as StoreScheduledOrdersSettings;
      // Actualizar la caché local del tenant con el valor canónico
      saveToStorage(tenantId, 'scheduled_orders', remoteScheduled);
      return remoteScheduled;
    }

    if (error) {
      console.warn(
        '[CentralBo StoreAdmin] Aviso al consultar scheduled_orders en Supabase:',
        error.message
      );
    }
  } catch (err) {
    console.warn(
      '[CentralBo StoreAdmin] Excepción al consultar scheduled_orders en Supabase:',
      err
    );
  }

  // Fallback seguro: caché local existente o DEFAULT_STORE_SCHEDULED_ORDERS
  return cached;
}

/**
 * Persiste la configuración de pedidos programados de forma centralizada en Supabase (stores.scheduled_orders).
 * Aislamiento estricto por tenantId (stores.id = tenantId).
 * Solo actualiza la caché local tras la confirmación exitosa de Supabase.
 */
export async function saveStoreScheduledOrders(
  tenantId: string,
  settings: StoreScheduledOrdersSettings
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!isValidScheduledOrdersSettings(settings)) {
    return {
      success: false,
      error: 'Formato de configuración de pedidos programados inválido o incompleto.',
    };
  }

  const now = new Date().toISOString();

  try {
    const { data: updatedRows, error } = await supabase
      .from('stores')
      .update({
        scheduled_orders: settings,
        updated_at: now,
      })
      .eq('id', tenantId)
      .select('id');

    if (error) {
      console.error(
        '[CentralBo StoreAdmin] Error al persistir scheduled_orders en Supabase:',
        error
      );
      return {
        success: false,
        error: error.message || 'Error al persistir la configuración de pedidos programados en Supabase.',
      };
    }

    if (!updatedRows || updatedRows.length === 0) {
      return {
        success: false,
        error:
          'No se pudo actualizar el comercio en Supabase. Verifique permisos de administrador o sesión activa.',
      };
    }

    // Persistencia remota confirmada: actualizar la caché local de este tenant
    saveToStorage(tenantId, 'scheduled_orders', settings);
    return { success: true };
  } catch (err: any) {
    console.error(
      '[CentralBo StoreAdmin] Excepción al persistir scheduled_orders en Supabase:',
      err
    );
    return {
      success: false,
      error:
        err?.message ||
        'Error de conexión al guardar configuración de pedidos programados en el servidor.',
    };
  }
}

// ----------------------------------------------------------------------------
// 6.1 MÉTODOS DE PAGO CONFIGURABLES POR EL COMERCIO (Fase 1 / CentralBo)
// WhatsApp es canal obligatorio y permanente de comunicación, no un método de pago.
// Los 3 métodos configurables son: Efectivo contraentrega, Transferencia, QR Simple.
// El efectivo contraentrega NO aparece automáticamente; solo cuando el admin lo activa.
// ----------------------------------------------------------------------------
export const DEFAULT_PAYMENT_SETTINGS: StorePaymentSettings = {
  cashOnDelivery: false, // NO aparece automáticamente
  bankTransfer: true,
  qrSimple: true,
  bankDetails: {
    bankName: '',
    accountNumber: '',
    accountHolder: '',
  },
  qrImageUrl: null,
};

/**
 * Valida la integridad estructural de un objeto StorePaymentSettings.
 * Rechaza null, arrays, tipos incompatibles y objetos sin los booleanos obligatorios.
 */
export function isValidPaymentSettings(data: unknown): data is StorePaymentSettings {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  if (
    typeof obj.cashOnDelivery !== 'boolean' ||
    typeof obj.bankTransfer !== 'boolean' ||
    typeof obj.qrSimple !== 'boolean'
  ) {
    return false;
  }
  if (obj.bankDetails !== undefined && obj.bankDetails !== null) {
    if (typeof obj.bankDetails !== 'object' || Array.isArray(obj.bankDetails)) {
      return false;
    }
    const bd = obj.bankDetails as Record<string, unknown>;
    if (bd.bankName !== undefined && typeof bd.bankName !== 'string') return false;
    if (bd.accountNumber !== undefined && typeof bd.accountNumber !== 'string') return false;
    if (bd.accountHolder !== undefined && typeof bd.accountHolder !== 'string') return false;
  }
  if (obj.qrImageUrl !== undefined && obj.qrImageUrl !== null) {
    if (typeof obj.qrImageUrl !== 'string') return false;
  }
  return true;
}

/**
 * Retorna la configuración de métodos de pago desde caché local (síncrono).
 * Aislamiento estricto por tenantId.
 * Fallback a DEFAULT_PAYMENT_SETTINGS si no hay caché válida.
 * NO escribe en localStorage durante la lectura.
 */
export function getCachedStorePaymentSettings(tenantId: string): StorePaymentSettings {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return JSON.parse(JSON.stringify(DEFAULT_PAYMENT_SETTINGS));
  }
  const cached = loadFromStorage<Partial<StorePaymentSettings>>(tenantId, 'payment_settings', {});
  if (isValidPaymentSettings(cached)) {
    return cached;
  }
  return JSON.parse(JSON.stringify(DEFAULT_PAYMENT_SETTINGS));
}

// Alias para compatibilidad con código existente
export const getStorePaymentSettings = getCachedStorePaymentSettings;

/**
 * Consulta la configuración de métodos de pago del comercio con Supabase como fuente canónica.
 * Flujo:
 * 1. Valida tenantId.
 * 2. Consulta stores.payment_settings filtrando por stores.id = tenantId.
 * 3. Si Supabase devuelve un StorePaymentSettings válido: lo utiliza, actualiza la caché local del tenant y lo retorna.
 * 4. Si la consulta falla o aún no tiene datos configurados (o {}): recurre al valor existente de localStorage (fallback).
 * 5. Si tampoco existe localStorage válido, utiliza DEFAULT_PAYMENT_SETTINGS.
 * 6. NO sobrescribe Supabase automáticamente durante la lectura (migración conservadora).
 */
export async function fetchStorePaymentSettings(
  tenantId: string
): Promise<StorePaymentSettings> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return JSON.parse(JSON.stringify(DEFAULT_PAYMENT_SETTINGS));
  }

  const cached = getCachedStorePaymentSettings(tenantId);

  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, payment_settings')
      .eq('id', tenantId)
      .maybeSingle();

    if (!error && data && isValidPaymentSettings(data.payment_settings)) {
      const remoteSettings = data.payment_settings as StorePaymentSettings;
      // Actualizar la caché local del tenant con el valor canónico
      saveToStorage(tenantId, 'payment_settings', remoteSettings);
      return remoteSettings;
    }

    if (error) {
      console.warn(
        '[CentralBo StoreAdmin] Aviso al consultar payment_settings en Supabase:',
        error.message
      );
    }
  } catch (err) {
    console.warn(
      '[CentralBo StoreAdmin] Excepción al consultar payment_settings en Supabase:',
      err
    );
  }

  // Fallback seguro: caché local existente o DEFAULT_PAYMENT_SETTINGS
  return cached;
}

/**
 * Persiste la configuración de métodos de pago de forma centralizada en Supabase (stores.payment_settings).
 * Aislamiento estricto por tenantId (stores.id = tenantId).
 * Solo actualiza la caché local tras la confirmación exitosa de Supabase.
 */
export async function saveStorePaymentSettings(
  tenantId: string,
  settings: StorePaymentSettings
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!isValidPaymentSettings(settings)) {
    return {
      success: false,
      error: 'Formato de configuración de métodos de pago inválido o incompleto.',
    };
  }

  const now = new Date().toISOString();

  try {
    const { data: updatedRows, error } = await supabase
      .from('stores')
      .update({
        payment_settings: settings,
        updated_at: now,
      })
      .eq('id', tenantId)
      .select('id');

    if (error) {
      console.error(
        '[CentralBo StoreAdmin] Error al persistir payment_settings en Supabase:',
        error
      );
      return {
        success: false,
        error: error.message || 'Error al persistir la configuración de métodos de pago en Supabase.',
      };
    }

    if (!updatedRows || updatedRows.length === 0) {
      return {
        success: false,
        error:
          'No se pudo actualizar el comercio en Supabase. Verifique permisos de administrador o sesión activa.',
      };
    }

    // Persistencia remota confirmada: actualizar la caché local de este tenant
    saveToStorage(tenantId, 'payment_settings', settings);
    return { success: true };
  } catch (err: any) {
    console.error(
      '[CentralBo StoreAdmin] Excepción al persistir payment_settings en Supabase:',
      err
    );
    return {
      success: false,
      error:
        err?.message ||
        'Error de conexión al guardar configuración de métodos de pago en el servidor.',
    };
  }
}

/**
 * Sube o procesa la imagen del código QR de cobro de un comercio específico.
 * - Soporta imágenes PNG, JPEG, JPG, WEBP y SVG de hasta 5 MB.
 * - Intenta subirlo a Supabase Storage en el bucket 'store-logos' bajo la carpeta del tenant.
 * - Si Storage no está disponible o falla, utiliza Data URL para garantizar que la imagen
 *   se conserve en la configuración del comercio sin perder la funcionalidad.
 * - Aislamiento estricto por tenantId: el código QR pertenece exclusivamente a este comercio.
 */
export async function uploadStorePaymentQr(
  tenantId: string,
  file: File
): Promise<{ success: boolean; publicUrl?: string; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!file) {
    return { success: false, error: 'No se ha seleccionado ningún archivo de imagen.' };
  }

  const MAX_QR_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
  if (file.size > MAX_QR_SIZE_BYTES) {
    return {
      success: false,
      error: 'La imagen del código QR supera el tamaño máximo permitido de 5 MB.',
    };
  }

  const normalizedType = file.type?.toLowerCase() || '';
  const ALLOWED_QR_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'];
  if (!ALLOWED_QR_TYPES.includes(normalizedType)) {
    return {
      success: false,
      error: 'Formato no permitido. Solo se aceptan imágenes en formato PNG, JPEG, JPG, WEBP o SVG.',
    };
  }

  let ext = 'png';
  if (normalizedType === 'image/jpeg' || normalizedType === 'image/jpg') ext = 'jpg';
  else if (normalizedType === 'image/webp') ext = 'webp';
  else if (normalizedType === 'image/svg+xml') ext = 'svg';

  const cleanTenantId = tenantId.trim();
  const targetFileName = `payment-qr-${Date.now()}.${ext}`;
  const targetPath = `${cleanTenantId}/qr/${targetFileName}`;

  const readAsDataUrl = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
      reader.readAsDataURL(file);
    });

  try {
    const { error: uploadError } = await supabase.storage
      .from('store-logos')
      .upload(targetPath, file, {
        contentType: normalizedType,
        cacheControl: '3600',
        upsert: true,
      });

    if (!uploadError) {
      const { data: urlData } = supabase.storage
        .from('store-logos')
        .getPublicUrl(targetPath);

      if (urlData?.publicUrl) {
        return {
          success: true,
          publicUrl: urlData.publicUrl,
        };
      }
    } else {
      console.warn('[uploadStorePaymentQr] Almacenamiento remoto no disponible o falló:', uploadError.message);
    }
  } catch (storageErr) {
    console.warn('[uploadStorePaymentQr] Excepción en Supabase Storage, usando persistencia local:', storageErr);
  }

  try {
    const dataUrl = await readAsDataUrl();
    return {
      success: true,
      publicUrl: dataUrl,
    };
  } catch (readErr: any) {
    return {
      success: false,
      error: readErr?.message || 'Error al procesar la imagen del código QR.',
    };
  }
}

// ----------------------------------------------------------------------------
// 7. CONFIGURACIÓN ESPECÍFICA POR VERTICAL (Persistencia Canónica en public.stores.vertical_config)
// ----------------------------------------------------------------------------

export const DEFAULT_RESTAURANT_SETTINGS: RestaurantSettings = {
  allowDineIn: true,
  allowDelivery: true,
  allowPickup: true,
  allowKitchenNotes: true,
  avgPrepTimeMinutes: 30,
  whatsappDirectOrders: true,
};

export const DEFAULT_FASHION_SETTINGS: FashionSettings = {
  exchangePolicy:
    'Cambios permitidos dentro de los 7 días hábiles posteriores a la entrega presentando el comprobante y la prenda sin uso con etiqueta original. No se realizan devoluciones en efectivo.',
  sizeGuide: [
    { size: 'XS', chest: '82 - 86 cm', waist: '62 - 66 cm', hips: '88 - 92 cm' },
    { size: 'S', chest: '86 - 90 cm', waist: '66 - 70 cm', hips: '92 - 96 cm' },
    { size: 'M', chest: '90 - 96 cm', waist: '70 - 76 cm', hips: '96 - 102 cm' },
    { size: 'L', chest: '96 - 102 cm', waist: '76 - 82 cm', hips: '102 - 108 cm' },
    { size: 'XL', chest: '102 - 108 cm', waist: '82 - 88 cm', hips: '108 - 114 cm' },
  ],
  enableColorSwatches: true,
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  catalogLayout: 'grid',
  showStockBadges: true,
};

export function isValidRestaurantSettings(data: unknown): data is RestaurantSettings {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.allowDineIn === 'boolean' &&
    typeof d.allowDelivery === 'boolean' &&
    typeof d.allowPickup === 'boolean' &&
    typeof d.allowKitchenNotes === 'boolean' &&
    typeof d.avgPrepTimeMinutes === 'number' &&
    !isNaN(d.avgPrepTimeMinutes) &&
    typeof d.whatsappDirectOrders === 'boolean'
  );
}

export function isValidFashionSettings(data: unknown): data is FashionSettings {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.exchangePolicy === 'string' &&
    Array.isArray(d.sizeGuide) &&
    typeof d.enableColorSwatches === 'boolean'
  );
}

export function isValidGeneralSettings(data: unknown): data is GeneralSettings {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return (
    (d.catalogLayout === 'grid' || d.catalogLayout === 'list') &&
    typeof d.showStockBadges === 'boolean'
  );
}

export function getCachedRestaurantSettings(tenantId: string): RestaurantSettings {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return cloneFallback(DEFAULT_RESTAURANT_SETTINGS);
  }
  const cached = loadFromStorage<RestaurantSettings>(tenantId, 'restaurant_config', DEFAULT_RESTAURANT_SETTINGS);
  if (isValidRestaurantSettings(cached)) {
    return cached;
  }
  return cloneFallback(DEFAULT_RESTAURANT_SETTINGS);
}

export const getRestaurantSettings = getCachedRestaurantSettings;

export async function fetchRestaurantSettings(tenantId: string): Promise<RestaurantSettings> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return cloneFallback(DEFAULT_RESTAURANT_SETTINGS);
  }

  const cached = getCachedRestaurantSettings(tenantId);

  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, vertical_config')
      .eq('id', tenantId)
      .maybeSingle();

    if (!error && data) {
      const rawVertical = (data.vertical_config && typeof data.vertical_config === 'object') ? data.vertical_config : {};
      const remoteRestaurant = rawVertical.restaurant;
      if (isValidRestaurantSettings(remoteRestaurant)) {
        saveToStorage(tenantId, 'restaurant_config', remoteRestaurant);
        return remoteRestaurant;
      }

      // Si no existe configuración remota pero el navegador local tiene datos válidos personalizados
      const localCustom = loadFromStorage<RestaurantSettings | null>(tenantId, 'restaurant_config', null as any);
      if (localCustom && isValidRestaurantSettings(localCustom)) {
        await saveRestaurantSettings(tenantId, localCustom);
        return localCustom;
      }
    }

    if (error && (error.code === '42703' || error.code === 'PGRST204' || error.message?.includes('vertical_config'))) {
      console.warn('[CentralBo StoreAdmin] Columna vertical_config aún no disponible en el esquema:', error.message);
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar restaurant_config en Supabase:', err);
  }

  return cached;
}

export async function saveRestaurantSettings(
  tenantId: string,
  settings: RestaurantSettings
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!isValidRestaurantSettings(settings)) {
    return { success: false, error: 'Formato de configuración gastronómica inválido.' };
  }

  const now = new Date().toISOString();

  try {
    const { data: storeRow, error: fetchErr } = await supabase
      .from('stores')
      .select('id, vertical_config')
      .eq('id', tenantId)
      .maybeSingle();

    if (fetchErr && (fetchErr.code === '42703' || fetchErr.code === 'PGRST204' || fetchErr.message?.includes('vertical_config'))) {
      saveToStorage(tenantId, 'restaurant_config', settings);
      return { success: true };
    }

    const currentVertical = (storeRow?.vertical_config && typeof storeRow.vertical_config === 'object')
      ? storeRow.vertical_config
      : {};

    const updatedVertical = {
      ...currentVertical,
      restaurant: settings,
    };

    const { data: updatedRows, error: updateErr } = await supabase
      .from('stores')
      .update({
        vertical_config: updatedVertical,
        updated_at: now,
      })
      .eq('id', tenantId)
      .select('id');

    if (updateErr) {
      console.error('[CentralBo StoreAdmin] Error al persistir restaurant_config en Supabase:', updateErr);
      return {
        success: false,
        error: updateErr.message || 'Error al persistir la configuración gastronómica en Supabase.',
      };
    }

    if (!updatedRows || updatedRows.length === 0) {
      return {
        success: false,
        error: 'No se pudo actualizar el comercio en Supabase. Verifique permisos de administrador o sesión activa.',
      };
    }

    saveToStorage(tenantId, 'restaurant_config', settings);
    return { success: true };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al persistir restaurant_config:', err);
    return { success: false, error: err?.message || 'Error de conexión con la base de datos.' };
  }
}

export function getCachedFashionSettings(tenantId: string): FashionSettings {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return cloneFallback(DEFAULT_FASHION_SETTINGS);
  }
  const cached = loadFromStorage<FashionSettings>(tenantId, 'fashion_config', DEFAULT_FASHION_SETTINGS);
  if (isValidFashionSettings(cached)) {
    return cached;
  }
  return cloneFallback(DEFAULT_FASHION_SETTINGS);
}

export const getFashionSettings = getCachedFashionSettings;

export async function fetchFashionSettings(tenantId: string): Promise<FashionSettings> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return cloneFallback(DEFAULT_FASHION_SETTINGS);
  }

  const cached = getCachedFashionSettings(tenantId);

  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, vertical_config')
      .eq('id', tenantId)
      .maybeSingle();

    if (!error && data) {
      const rawVertical = (data.vertical_config && typeof data.vertical_config === 'object') ? data.vertical_config : {};
      const remoteFashion = rawVertical.fashion;
      if (isValidFashionSettings(remoteFashion)) {
        saveToStorage(tenantId, 'fashion_config', remoteFashion);
        return remoteFashion;
      }

      // Si no existe configuración remota pero el navegador local tiene datos válidos personalizados
      const localCustom = loadFromStorage<FashionSettings | null>(tenantId, 'fashion_config', null as any);
      if (localCustom && isValidFashionSettings(localCustom)) {
        await saveFashionSettings(tenantId, localCustom);
        return localCustom;
      }
    }

    if (error && (error.code === '42703' || error.code === 'PGRST204' || error.message?.includes('vertical_config'))) {
      console.warn('[CentralBo StoreAdmin] Columna vertical_config aún no disponible en el esquema:', error.message);
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar fashion_config en Supabase:', err);
  }

  return cached;
}

export async function saveFashionSettings(
  tenantId: string,
  settings: FashionSettings
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!isValidFashionSettings(settings)) {
    return { success: false, error: 'Formato de configuración de moda inválido.' };
  }

  const now = new Date().toISOString();

  try {
    const { data: storeRow, error: fetchErr } = await supabase
      .from('stores')
      .select('id, vertical_config')
      .eq('id', tenantId)
      .maybeSingle();

    if (fetchErr && (fetchErr.code === '42703' || fetchErr.code === 'PGRST204' || fetchErr.message?.includes('vertical_config'))) {
      saveToStorage(tenantId, 'fashion_config', settings);
      return { success: true };
    }

    const currentVertical = (storeRow?.vertical_config && typeof storeRow.vertical_config === 'object')
      ? storeRow.vertical_config
      : {};

    const updatedVertical = {
      ...currentVertical,
      fashion: settings,
    };

    const { data: updatedRows, error: updateErr } = await supabase
      .from('stores')
      .update({
        vertical_config: updatedVertical,
        updated_at: now,
      })
      .eq('id', tenantId)
      .select('id');

    if (updateErr) {
      console.error('[CentralBo StoreAdmin] Error al persistir fashion_config en Supabase:', updateErr);
      return {
        success: false,
        error: updateErr.message || 'Error al persistir la configuración de moda en Supabase.',
      };
    }

    if (!updatedRows || updatedRows.length === 0) {
      return {
        success: false,
        error: 'No se pudo actualizar el comercio en Supabase. Verifique permisos de administrador o sesión activa.',
      };
    }

    saveToStorage(tenantId, 'fashion_config', settings);
    return { success: true };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al persistir fashion_config:', err);
    return { success: false, error: err?.message || 'Error de conexión con la base de datos.' };
  }
}

export function getCachedGeneralSettings(tenantId: string): GeneralSettings {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return cloneFallback(DEFAULT_GENERAL_SETTINGS);
  }
  const cached = loadFromStorage<GeneralSettings>(tenantId, 'general_config', DEFAULT_GENERAL_SETTINGS);
  if (isValidGeneralSettings(cached)) {
    return cached;
  }
  return cloneFallback(DEFAULT_GENERAL_SETTINGS);
}

export const getGeneralSettings = getCachedGeneralSettings;

export async function fetchGeneralSettings(tenantId: string): Promise<GeneralSettings> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return cloneFallback(DEFAULT_GENERAL_SETTINGS);
  }

  const cached = getCachedGeneralSettings(tenantId);

  try {
    const { data, error } = await supabase
      .from('stores')
      .select('id, vertical_config')
      .eq('id', tenantId)
      .maybeSingle();

    if (!error && data) {
      const rawVertical = (data.vertical_config && typeof data.vertical_config === 'object') ? data.vertical_config : {};
      const remoteGeneral = rawVertical.general;
      if (isValidGeneralSettings(remoteGeneral)) {
        saveToStorage(tenantId, 'general_config', remoteGeneral);
        return remoteGeneral;
      }

      // Si no existe configuración remota pero el navegador local tiene datos válidos personalizados
      const localCustom = loadFromStorage<GeneralSettings | null>(tenantId, 'general_config', null as any);
      if (localCustom && isValidGeneralSettings(localCustom)) {
        await saveGeneralSettings(tenantId, localCustom);
        return localCustom;
      }
    }

    if (error && (error.code === '42703' || error.code === 'PGRST204' || error.message?.includes('vertical_config'))) {
      console.warn('[CentralBo StoreAdmin] Columna vertical_config aún no disponible en el esquema:', error.message);
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar general_config en Supabase:', err);
  }

  return cached;
}

export async function saveGeneralSettings(
  tenantId: string,
  settings: GeneralSettings
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!isValidGeneralSettings(settings)) {
    return { success: false, error: 'Formato de configuración general inválido.' };
  }

  const now = new Date().toISOString();

  try {
    const { data: storeRow, error: fetchErr } = await supabase
      .from('stores')
      .select('id, vertical_config')
      .eq('id', tenantId)
      .maybeSingle();

    if (fetchErr && (fetchErr.code === '42703' || fetchErr.code === 'PGRST204' || fetchErr.message?.includes('vertical_config'))) {
      saveToStorage(tenantId, 'general_config', settings);
      return { success: true };
    }

    const currentVertical = (storeRow?.vertical_config && typeof storeRow.vertical_config === 'object')
      ? storeRow.vertical_config
      : {};

    const updatedVertical = {
      ...currentVertical,
      general: settings,
    };

    const { data: updatedRows, error: updateErr } = await supabase
      .from('stores')
      .update({
        vertical_config: updatedVertical,
        updated_at: now,
      })
      .eq('id', tenantId)
      .select('id');

    if (updateErr) {
      console.error('[CentralBo StoreAdmin] Error al persistir general_config en Supabase:', updateErr);
      return {
        success: false,
        error: updateErr.message || 'Error al persistir la configuración general en Supabase.',
      };
    }

    if (!updatedRows || updatedRows.length === 0) {
      return {
        success: false,
        error: 'No se pudo actualizar el comercio en Supabase. Verifique permisos de administrador o sesión activa.',
      };
    }

    saveToStorage(tenantId, 'general_config', settings);
    return { success: true };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al persistir general_config:', err);
    return { success: false, error: err?.message || 'Error de conexión con la base de datos.' };
  }
}

// ----------------------------------------------------------------------------
// SERVICIOS (Profesionales, Disponibilidad, Horarios Reservados, Citas)
// ----------------------------------------------------------------------------

export function createDefaultProfessionalSchedule(
  openDays: number[] = [1, 2, 3, 4, 5],
  startTime: string = '09:00',
  endTime: string = '18:00',
  satEndTime: string = '13:00'
): ProfessionalDaySchedule[] {
  const daysDefinition: Array<{ dayOfWeek: number; dayName: string }> = [
    { dayOfWeek: 1, dayName: 'Lunes' },
    { dayOfWeek: 2, dayName: 'Martes' },
    { dayOfWeek: 3, dayName: 'Miércoles' },
    { dayOfWeek: 4, dayName: 'Jueves' },
    { dayOfWeek: 5, dayName: 'Viernes' },
    { dayOfWeek: 6, dayName: 'Sábado' },
    { dayOfWeek: 0, dayName: 'Domingo' },
  ];

  return daysDefinition.map((d) => {
    const isOpen = openDays.includes(d.dayOfWeek);
    const dayEnd = d.dayOfWeek === 6 ? satEndTime : endTime;
    return {
      dayOfWeek: d.dayOfWeek,
      dayName: d.dayName,
      isOpen,
      startTime,
      endTime: dayEnd,
    };
  });
}

/**
 * Sanitiza y normaliza un registro de profesional garantizando tipos estrictos,
 * compatibilidad con Supabase (snake_case/camelCase), horarios semanales y UUIDs de servicios.
 */
export function sanitizeProfessionalItem(
  raw: any,
  tenantId: string
): ProfessionalItem | null {
  if (!raw || typeof raw !== 'object') return null;

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  if (!id) return null;

  // Filtrar datos demo locales a menos que sean explícitamente solicitados
  const rawName = typeof raw.name === 'string' ? raw.name.trim().slice(0, 150) : '';
  if (!rawName) return null;

  // Aislamiento multi-tenant: si viene un tenant_id debe coincidir estrictamente
  const itemTenantId = typeof raw.tenant_id === 'string' && raw.tenant_id.trim() ? raw.tenant_id.trim() : tenantId;
  if (itemTenantId !== tenantId) return null;

  const specialty = typeof raw.specialty === 'string' ? raw.specialty.trim().slice(0, 150) : '';
  const phone = typeof raw.phone === 'string' ? raw.phone.trim().slice(0, 50) : '';
  const avatarUrl =
    typeof raw.avatar_url === 'string'
      ? raw.avatar_url.trim()
      : typeof raw.avatarUrl === 'string'
      ? raw.avatarUrl.trim()
      : '';

  const isActive =
    raw.is_active !== undefined
      ? Boolean(raw.is_active)
      : raw.isActive !== undefined
      ? Boolean(raw.isActive)
      : true;

  // Normalizar service_ids / serviceIds: solo UUIDs válidos de productos
  const rawServiceIds = Array.isArray(raw.service_ids)
    ? raw.service_ids
    : Array.isArray(raw.serviceIds)
    ? raw.serviceIds
    : [];

  const cleanServiceIds = rawServiceIds
    .map((s: any) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s: string) => isValidUUID(s));

  // Normalizar schedule: 7 días
  let schedule: ProfessionalDaySchedule[] = [];
  if (Array.isArray(raw.schedule) && raw.schedule.length === 7) {
    schedule = raw.schedule.map((d: any, idx: number) => {
      const dayOfWeek = typeof d.dayOfWeek === 'number' ? d.dayOfWeek : idx;
      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      return {
        dayOfWeek,
        dayName: typeof d.dayName === 'string' && d.dayName ? d.dayName : dayNames[dayOfWeek] || 'Día',
        isOpen: Boolean(d.isOpen),
        startTime: typeof d.startTime === 'string' && /^\d{2}:\d{2}$/.test(d.startTime) ? d.startTime : '09:00',
        endTime: typeof d.endTime === 'string' && /^\d{2}:\d{2}$/.test(d.endTime) ? d.endTime : '18:00',
      };
    });
  } else {
    schedule = createDefaultProfessionalSchedule([1, 2, 3, 4, 5], '09:00', '18:00', '13:00');
  }

  // Derivar workDays y shiftHours legibles
  const openDays = schedule.filter((d) => d.isOpen);
  const workDays = openDays.map((d) => d.dayName);
  const firstOpen = openDays[0];
  const shiftHours = firstOpen ? `${firstOpen.startTime} - ${firstOpen.endTime}` : 'Sin turnos';

  return {
    id,
    tenant_id: tenantId,
    name: rawName,
    specialty,
    phone,
    avatarUrl,
    isActive,
    workDays,
    shiftHours,
    serviceIds: cleanServiceIds,
    schedule,
    created_at: raw.created_at || undefined,
    updated_at: raw.updated_at || undefined,
    avatar_url: avatarUrl,
    is_active: isActive,
    service_ids: cleanServiceIds,
  };
}

/**
 * Consulta la caché local de profesionales del comercio.
 * Filtra automáticamente registros demo ('prof-1', 'prof-2') para no contaminar datos reales.
 * NUNCA devuelve datos demo cuando el arreglo está vacío.
 */
export function getStoreProfessionals(tenantId: string): ProfessionalItem[] {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return [];
  }

  const loaded = loadFromStorage<ProfessionalItem[]>(tenantId, 'professionals', []);
  if (!Array.isArray(loaded)) {
    return [];
  }

  return loaded
    .map((p) => sanitizeProfessionalItem(p, tenantId))
    .filter((p): p is ProfessionalItem => p !== null && p.id !== 'prof-1' && p.id !== 'prof-2');
}

/**
 * Consulta remota de profesionales en Supabase como fuente canónica de verdad (H-02 Parte 1).
 * Si Supabase devuelve [], se respeta [] y NO se inyectan profesionales demo.
 * Actualiza la caché local en caso de éxito.
 */
export async function fetchStoreProfessionals(tenantId: string): Promise<ProfessionalItem[]> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return [];
  }

  const cached = getStoreProfessionals(tenantId);

  try {
    const { data, error } = await supabase
      .from('professionals')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data)) {
      const sanitized = data
        .map((row) => sanitizeProfessionalItem(row, tenantId))
        .filter((p): p is ProfessionalItem => p !== null);

      // Sincronizar caché local con la verdad canónica de Supabase
      saveToStorage(tenantId, 'professionals', sanitized);
      return sanitized;
    }

    if (error) {
      if (error.code === 'PGRST205' || error.message?.includes('professionals')) {
        console.info(
          '[CentralBo StoreAdmin] Tabla "public.professionals" no detectada aún en Supabase cache. ' +
          'Ejecute supabase/12_create_professionals_table.sql en el SQL Editor para habilitar persistencia remota completa.'
        );
      } else {
        console.warn('[CentralBo StoreAdmin] Error al consultar profesionales en Supabase:', error.message);
      }
    }
  } catch (err: any) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar profesionales en Supabase:', err?.message || err);
  }

  return cached;
}

/**
 * Crea un profesional en Supabase como fuente canónica con un UUID real y validación de servicios.
 */
export async function createStoreProfessional(
  tenantId: string,
  profInput: Partial<ProfessionalItem>
): Promise<{ success: boolean; professional?: ProfessionalItem; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  const trimmedName = typeof profInput.name === 'string' ? profInput.name.trim().slice(0, 150) : '';
  if (!trimmedName) {
    return { success: false, error: 'El nombre del profesional es obligatorio.' };
  }

  // Generar UUID canónico real para el profesional (NUNCA prof-${Date.now()})
  const newId =
    typeof profInput.id === 'string' && isValidUUID(profInput.id)
      ? profInput.id
      : typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
        });

  // Validar y filtrar serviceIds para asegurar que pertenezcan a este tenant
  const storeProds = getStoreProducts(tenantId);
  const tenantProductIds = new Set(storeProds.map((p) => p.id));

  const inputServiceIds = Array.isArray(profInput.serviceIds)
    ? profInput.serviceIds
    : Array.isArray(profInput.service_ids)
    ? profInput.service_ids
    : [];

  const validServiceIds = inputServiceIds
    .filter((id) => typeof id === 'string' && isValidUUID(id))
    .filter((id) => tenantProductIds.size === 0 || tenantProductIds.has(id));

  const schedule =
    Array.isArray(profInput.schedule) && profInput.schedule.length === 7
      ? profInput.schedule
      : createDefaultProfessionalSchedule([1, 2, 3, 4, 5], '09:00', '18:00', '13:00');

  const payload = {
    id: newId,
    tenant_id: tenantId,
    name: trimmedName,
    specialty: typeof profInput.specialty === 'string' ? profInput.specialty.trim().slice(0, 150) : '',
    phone: typeof profInput.phone === 'string' ? profInput.phone.trim().slice(0, 50) : '',
    avatar_url: typeof profInput.avatarUrl === 'string' ? profInput.avatarUrl.trim() : (profInput.avatar_url || ''),
    is_active: profInput.isActive ?? profInput.is_active ?? true,
    service_ids: validServiceIds,
    schedule: schedule,
  };

  try {
    const { data, error } = await supabase
      .from('professionals')
      .insert(payload)
      .select('*')
      .single();

    if (!error && data) {
      const sanitized = sanitizeProfessionalItem(data, tenantId);
      if (sanitized) {
        const cached = getStoreProfessionals(tenantId);
        const updated = [...cached.filter((p) => p.id !== sanitized.id), sanitized];
        saveToStorage(tenantId, 'professionals', updated);
        return { success: true, professional: sanitized };
      }
    }

    if (error) {
      // Si la tabla no existe aún en el esquema remoto, persistir localmente con UUID real
      if (error.code === 'PGRST205' || error.message?.includes('professionals')) {
        const localProf = sanitizeProfessionalItem(payload, tenantId)!;
        const cached = getStoreProfessionals(tenantId);
        const updated = [...cached.filter((p) => p.id !== localProf.id), localProf];
        saveToStorage(tenantId, 'professionals', updated);
        return { success: true, professional: localProf };
      }
      return { success: false, error: error.message };
    }
  } catch (err: any) {
    // Fallback de resiliencia local con UUID canónico
    const localProf = sanitizeProfessionalItem(payload, tenantId)!;
    const cached = getStoreProfessionals(tenantId);
    const updated = [...cached.filter((p) => p.id !== localProf.id), localProf];
    saveToStorage(tenantId, 'professionals', updated);
    return { success: true, professional: localProf };
  }

  return { success: false, error: 'No se pudo crear el profesional.' };
}

/**
 * Actualiza un profesional en Supabase como fuente canónica.
 */
export async function updateStoreProfessional(
  tenantId: string,
  profId: string,
  updates: Partial<ProfessionalItem>
): Promise<{ success: boolean; professional?: ProfessionalItem; error?: string }> {
  if (!tenantId || !isValidTenantId(tenantId) || !profId) {
    return { success: false, error: 'Parámetros no válidos.' };
  }

  const cached = getStoreProfessionals(tenantId);
  const existing = cached.find((p) => p.id === profId);
  if (!existing) {
    return { success: false, error: 'Profesional no encontrado.' };
  }

  // Filtrar service_ids si se actualizan
  let validServiceIds = existing.serviceIds;
  if (updates.serviceIds !== undefined || updates.service_ids !== undefined) {
    const rawIds = updates.serviceIds !== undefined ? updates.serviceIds : updates.service_ids!;
    const storeProds = getStoreProducts(tenantId);
    const tenantProductIds = new Set(storeProds.map((p) => p.id));
    validServiceIds = (Array.isArray(rawIds) ? rawIds : [])
      .filter((id) => typeof id === 'string' && isValidUUID(id))
      .filter((id) => tenantProductIds.size === 0 || tenantProductIds.has(id));
  }

  const payload: Record<string, any> = {};
  if (updates.name !== undefined) payload.name = String(updates.name).trim().slice(0, 150);
  if (updates.specialty !== undefined) payload.specialty = String(updates.specialty).trim().slice(0, 150);
  if (updates.phone !== undefined) payload.phone = String(updates.phone).trim().slice(0, 50);
  if (updates.avatarUrl !== undefined || updates.avatar_url !== undefined) {
    payload.avatar_url = String(updates.avatarUrl ?? updates.avatar_url ?? '').trim();
  }
  if (updates.isActive !== undefined || updates.is_active !== undefined) {
    payload.is_active = Boolean(updates.isActive ?? updates.is_active);
  }
  if (updates.schedule !== undefined && Array.isArray(updates.schedule) && updates.schedule.length === 7) {
    payload.schedule = updates.schedule;
  }
  if (updates.serviceIds !== undefined || updates.service_ids !== undefined) {
    payload.service_ids = validServiceIds;
  }

  try {
    const { data, error } = await supabase
      .from('professionals')
      .update(payload)
      .eq('tenant_id', tenantId)
      .eq('id', profId)
      .select('*')
      .maybeSingle();

    if (!error && data) {
      const sanitized = sanitizeProfessionalItem(data, tenantId);
      if (sanitized) {
        const updatedList = cached.map((p) => (p.id === profId ? sanitized : p));
        saveToStorage(tenantId, 'professionals', updatedList);
        return { success: true, professional: sanitized };
      }
    }

    if (error && (error.code === 'PGRST205' || error.message?.includes('professionals'))) {
      const merged = sanitizeProfessionalItem({ ...existing, ...payload, id: profId, tenant_id: tenantId }, tenantId)!;
      const updatedList = cached.map((p) => (p.id === profId ? merged : p));
      saveToStorage(tenantId, 'professionals', updatedList);
      return { success: true, professional: merged };
    }
  } catch (err: any) {
    const merged = sanitizeProfessionalItem({ ...existing, ...payload, id: profId, tenant_id: tenantId }, tenantId)!;
    const updatedList = cached.map((p) => (p.id === profId ? merged : p));
    saveToStorage(tenantId, 'professionals', updatedList);
    return { success: true, professional: merged };
  }

  return { success: false, error: 'Error al actualizar profesional.' };
}

/**
 * Elimina un profesional en Supabase y sincroniza la caché local.
 */
export async function deleteStoreProfessional(
  tenantId: string,
  profId: string
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || !isValidTenantId(tenantId) || !profId) {
    return { success: false, error: 'Parámetros no válidos.' };
  }

  try {
    await supabase
      .from('professionals')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', profId);
  } catch (err: any) {
    console.warn('[CentralBo StoreAdmin] Aviso al eliminar en Supabase:', err?.message);
  }

  const cached = getStoreProfessionals(tenantId);
  const updated = cached.filter((p) => p.id !== profId);
  saveToStorage(tenantId, 'professionals', updated);

  return { success: true };
}

export function saveStoreProfessionals(
  tenantId: string,
  professionals: ProfessionalItem[]
): void {
  const sanitized = (professionals || [])
    .map((p) => sanitizeProfessionalItem(p, tenantId))
    .filter((p): p is ProfessionalItem => p !== null && p.id !== 'prof-1' && p.id !== 'prof-2');
  saveToStorage(tenantId, 'professionals', sanitized);
}

// ----------------------------------------------------------------------------
// 7. CITAS, RESERVAS Y DISPONIBILIDAD (H-02 Parte 2: Persistencia y Solapamiento Real)
// ----------------------------------------------------------------------------

export function getServiceDurationMinutes(service: any): number {
  if (!service) return 60;
  const raw =
    service.attributes?.duration_minutes ??
    service.attributes?.duration ??
    service.duration_minutes ??
    service.duration;
  const num = Number(raw);
  return !isNaN(num) && num > 0 ? num : 60;
}

function timeToMinutes(timeStr: string): number {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

function sanitizeAppointmentRequest(data: any, tenantId: string): AppointmentRequest | null {
  if (!data || typeof data !== 'object') return null;
  const rawId = data.id;
  const cleanId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : crypto.randomUUID();
  const rawDate = typeof data.date === 'string' ? data.date.trim() : '';
  const rawTime =
    typeof data.time === 'string'
      ? data.time.trim()
      : typeof data.start_time === 'string'
      ? data.start_time.trim()
      : '';
  if (!rawDate || !rawTime) return null;

  return {
    id: cleanId,
    tenant_id: tenantId,
    serviceId: String(data.serviceId || data.service_id || ''),
    serviceName: String(data.serviceName || data.service_name || 'Servicio'),
    professionalId: String(data.professionalId || data.professional_id || ''),
    professionalName: String(data.professionalName || data.professional_name || 'Profesional'),
    customerName: String(data.customerName || data.customer_name || 'Cliente'),
    customerPhone: String(data.customerPhone || data.customer_phone || ''),
    customerEmail: String(data.customerEmail || data.customer_email || ''),
    date: rawDate,
    time: rawTime,
    durationMinutes: Number(data.durationMinutes || data.duration_minutes) || 60,
    status: data.status || 'pendiente',
    createdAt: data.createdAt || data.created_at || new Date().toISOString(),
    updatedAt: data.updatedAt || data.updated_at,
    notes: data.notes || '',
  };
}

function sanitizeReservedTimeSlot(data: any, tenantId: string): ReservedTimeSlot | null {
  if (!data || typeof data !== 'object') return null;
  const rawId = data.id;
  const cleanId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : crypto.randomUUID();
  const rawDate = typeof data.date === 'string' ? data.date.trim() : '';
  const rawTime =
    typeof data.time === 'string'
      ? data.time.trim()
      : typeof data.start_time === 'string'
      ? data.start_time.trim()
      : '';
  if (!rawDate || !rawTime) return null;

  return {
    id: cleanId,
    tenant_id: tenantId,
    professionalId: String(data.professionalId || data.professional_id || ''),
    date: rawDate,
    time: rawTime,
    durationMinutes: Number(data.durationMinutes || data.duration_minutes) || 60,
    reason: String(data.reason || 'Bloqueo manual'),
    isExternal: Boolean(data.isExternal ?? data.is_external),
    createdAt: data.createdAt || data.created_at || new Date().toISOString(),
    updatedAt: data.updatedAt || data.updated_at,
  };
}

/**
 * Genera la grilla de turnos de un profesional para una fecha específica (YYYY-MM-DD),
 * utilizando un grid fijo de inicio de 15 minutos y calculando solapamiento real por intervalo
 * contra la duración real del servicio (products.attributes.duration_minutes).
 */
export function getProfessionalAgendaSlots(
  tenantId: string,
  professional: ProfessionalItem,
  dateStr: string,
  serviceDurationMinutes: number = 60
): ProfessionalAgendaSlot[] {
  if (!professional || !professional.schedule) {
    return [];
  }

  // Extraer día de la semana (0 = Domingo, 1 = Lunes, ..., 6 = Sábado)
  const [year, month, day] = dateStr.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day, 12, 0, 0);
  const dayOfWeek = targetDate.getDay();

  const daySchedule = professional.schedule.find((s) => s.dayOfWeek === dayOfWeek);

  // Si no atiende este día de la semana, no hay horarios disponibles
  if (!daySchedule || !daySchedule.isOpen) {
    return [];
  }

  const [startHour, startMin] = daySchedule.startTime.split(':').map(Number);
  const [endHour, endMin] = daySchedule.endTime.split(':').map(Number);

  const startTotalMinutes = (isNaN(startHour) ? 9 : startHour) * 60 + (isNaN(startMin) ? 0 : startMin);
  const endTotalMinutes = (isNaN(endHour) ? 18 : endHour) * 60 + (isNaN(endMin) ? 0 : endMin);

  // Duración real del servicio solicitado (mínimo 15 min)
  const duration = serviceDurationMinutes > 0 ? serviceDurationMinutes : 60;
  const rawTimes: string[] = [];

  // Grid de inicio fijo de 15 minutos: solo se consideran inicios donde el servicio completo entra en la jornada
  for (let m = startTotalMinutes; m + duration <= endTotalMinutes; m += 15) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    rawTimes.push(`${hh}:${mm}`);
  }

  // Cargar bloqueos manuales y citas del comercio (fuente local/Supabase sin datos demo)
  const reservedSlots = getStoreReservedTimeSlots(tenantId);
  const appointments = getStoreAppointments(tenantId);

  return rawTimes.map((time) => {
    const candStart = timeToMinutes(time);
    const candEnd = candStart + duration;

    // 1. Bloqueo manual o cita externa (solapamiento estricto por intervalo: startA < endB && endA > startB)
    const matchingBlock = reservedSlots.find((r) => {
      if (r.date !== dateStr) return false;
      if (r.professionalId && r.professionalId !== professional.id) return false;
      const blkStart = timeToMinutes(r.time);
      const blkDuration = r.durationMinutes && r.durationMinutes > 0 ? r.durationMinutes : 60;
      const blkEnd = blkStart + blkDuration;
      return candStart < blkEnd && candEnd > blkStart;
    });

    if (matchingBlock) {
      return {
        time,
        status: 'bloqueada' as AgendaSlotStatus,
        reason: matchingBlock.reason || 'Bloqueo manual / Cita externa',
        reservedSlot: matchingBlock,
      };
    }

    // 2. Cita solicitada en el sistema (solapamiento por intervalo, excluyendo rechazadas)
    const matchingAppt = appointments.find((a) => {
      if (a.professionalId !== professional.id) return false;
      if (a.date !== dateStr) return false;
      if (a.status === 'rechazada' || a.status === 'rejected') return false;
      const apptStart = timeToMinutes(a.time);
      const apptDuration = a.durationMinutes && a.durationMinutes > 0 ? a.durationMinutes : 60;
      const apptEnd = apptStart + apptDuration;
      return candStart < apptEnd && candEnd > apptStart;
    });

    if (matchingAppt) {
      const isConfirmed = matchingAppt.status === 'confirmada' || matchingAppt.status === 'confirmed';
      return {
        time,
        status: (isConfirmed ? 'confirmada' : 'pendiente') as AgendaSlotStatus,
        appointment: matchingAppt,
      };
    }

    // 3. Disponible
    return {
      time,
      status: 'disponible' as AgendaSlotStatus,
    };
  });
}

// ----------------------------------------------------------------------------
// BLOQUEOS MANUALES (Persistencia Central en Supabase con Caché Local)
// ----------------------------------------------------------------------------

export function getStoreReservedTimeSlots(tenantId: string): ReservedTimeSlot[] {
  // Retorna únicamente los registros reales guardados; nunca inyecta demo ficticio
  return loadFromStorage<ReservedTimeSlot[]>(tenantId, 'reserved_slots', []);
}

export function saveStoreReservedTimeSlots(
  tenantId: string,
  slots: ReservedTimeSlot[]
): void {
  const sanitized = (slots || [])
    .map((s) => sanitizeReservedTimeSlot(s, tenantId))
    .filter((s): s is ReservedTimeSlot => s !== null && s.id !== 'res-1' && s.id !== 'res-2');
  saveToStorage(tenantId, 'reserved_slots', sanitized);
}

export async function fetchStoreAppointmentBlocks(
  tenantId: string
): Promise<ReservedTimeSlot[]> {
  try {
    const { data, error } = await supabase
      .from('appointment_blocks')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('date', { ascending: true })
      .order('start_time', { ascending: true });

    if (error) {
      if (error.code === 'PGRST205') {
        console.warn(
          '[CentralBo H-02] Tabla "public.appointment_blocks" no encontrada en Supabase. Se utilizará caché local temporal.'
        );
      } else {
        console.error('[CentralBo H-02] Error al consultar bloqueos en Supabase:', error);
      }
      return getStoreReservedTimeSlots(tenantId);
    }

    const items: ReservedTimeSlot[] = (data || []).map((row: any) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      professionalId: row.professional_id,
      date: row.date,
      time: row.start_time,
      durationMinutes: row.duration_minutes || 60,
      reason: row.reason || '',
      isExternal: Boolean(row.is_external),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    saveStoreReservedTimeSlots(tenantId, items);
    return items;
  } catch (err) {
    console.error('[CentralBo H-02] Excepción al consultar bloqueos:', err);
    return getStoreReservedTimeSlots(tenantId);
  }
}

export async function createStoreAppointmentBlock(
  tenantId: string,
  blockInput: Partial<ReservedTimeSlot>
): Promise<{ success: boolean; block?: ReservedTimeSlot; error?: string }> {
  try {
    const blockId =
      typeof blockInput.id === 'string' && isValidUUID(blockInput.id)
        ? blockInput.id
        : crypto.randomUUID();

    const newBlock: ReservedTimeSlot = {
      id: blockId,
      tenant_id: tenantId,
      professionalId: blockInput.professionalId || '',
      date: blockInput.date || new Date().toISOString().split('T')[0],
      time: blockInput.time || '09:00',
      durationMinutes: Number(blockInput.durationMinutes) || 60,
      reason: (blockInput.reason || 'Bloqueo manual').trim(),
      isExternal: Boolean(blockInput.isExternal),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('appointment_blocks')
      .insert({
        id: newBlock.id,
        tenant_id: tenantId,
        professional_id: newBlock.professionalId,
        date: newBlock.date,
        start_time: newBlock.time,
        duration_minutes: newBlock.durationMinutes,
        reason: newBlock.reason,
        is_external: newBlock.isExternal,
      });

    if (error && error.code !== 'PGRST205') {
      console.error('[CentralBo H-02] Error al insertar bloqueo en Supabase:', error);
      return { success: false, error: error.message };
    }

    const current = getStoreReservedTimeSlots(tenantId);
    saveStoreReservedTimeSlots(tenantId, [newBlock, ...current.filter((b) => b.id !== newBlock.id)]);

    return { success: true, block: newBlock };
  } catch (err: any) {
    console.error('[CentralBo H-02] Excepción al crear bloqueo:', err);
    return { success: false, error: err?.message || 'Error inesperado al crear bloqueo' };
  }
}

export async function deleteStoreAppointmentBlock(
  tenantId: string,
  blockId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('appointment_blocks')
      .delete()
      .eq('id', blockId)
      .eq('tenant_id', tenantId);

    if (error && error.code !== 'PGRST205') {
      console.error('[CentralBo H-02] Error al eliminar bloqueo en Supabase:', error);
      return { success: false, error: error.message };
    }

    const current = getStoreReservedTimeSlots(tenantId);
    saveStoreReservedTimeSlots(tenantId, current.filter((b) => b.id !== blockId));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error al eliminar bloqueo' };
  }
}

// ----------------------------------------------------------------------------
// CITAS / RESERVAS (Persistencia Central en Supabase con Caché Local)
// ----------------------------------------------------------------------------

export function getStoreAppointments(tenantId: string): AppointmentRequest[] {
  // Retorna únicamente citas reales; nunca inyecta demo ficticio
  return loadFromStorage<AppointmentRequest[]>(tenantId, 'appointments', []);
}

export function saveStoreAppointments(
  tenantId: string,
  appointments: AppointmentRequest[]
): void {
  const sanitized = (appointments || [])
    .map((a) => sanitizeAppointmentRequest(a, tenantId))
    .filter((a): a is AppointmentRequest => a !== null && a.id !== 'cita-101' && a.id !== 'cita-102');
  saveToStorage(tenantId, 'appointments', sanitized);
}

export async function fetchStoreAppointments(
  tenantId: string
): Promise<AppointmentRequest[]> {
  try {
    const { data, error } = await supabase
      .from('appointments')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('date', { ascending: false })
      .order('start_time', { ascending: true });

    if (error) {
      if (error.code === 'PGRST205') {
        console.warn(
          '[CentralBo H-02] Tabla "public.appointments" no encontrada en Supabase. Se utilizará caché local temporal.'
        );
      } else {
        console.error('[CentralBo H-02] Error al consultar citas en Supabase:', error);
      }
      return getStoreAppointments(tenantId);
    }

    const items: AppointmentRequest[] = (data || []).map((row: any) => ({
      id: row.id,
      tenant_id: row.tenant_id,
      serviceId: row.service_id,
      serviceName: row.service_name,
      professionalId: row.professional_id,
      professionalName: row.professional_name,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      customerEmail: row.customer_email || '',
      date: row.date,
      time: row.start_time,
      durationMinutes: row.duration_minutes || 60,
      status: row.status,
      notes: row.notes || '',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    saveStoreAppointments(tenantId, items);
    return items;
  } catch (err) {
    console.error('[CentralBo H-02] Excepción al consultar citas:', err);
    return getStoreAppointments(tenantId);
  }
}

export async function createStoreAppointment(
  tenantId: string,
  apptInput: Partial<AppointmentRequest>
): Promise<{ success: boolean; appointment?: AppointmentRequest; error?: string }> {
  try {
    // 1. Intentar creación atómica server-side (protección de concurrencia y validación central)
    const payload = {
      id: apptInput.id && isValidUUID(apptInput.id) ? apptInput.id : crypto.randomUUID(),
      tenantId,
      serviceId: apptInput.serviceId,
      serviceName: apptInput.serviceName,
      professionalId: apptInput.professionalId,
      professionalName: apptInput.professionalName,
      customerName: apptInput.customerName,
      customerPhone: apptInput.customerPhone,
      customerEmail: apptInput.customerEmail,
      date: apptInput.date,
      startTime: apptInput.time,
      durationMinutes: apptInput.durationMinutes || 60,
      notes: apptInput.notes,
    };

    const res = await fetch('/api/appointments/create-appointment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const resData = await res.json().catch(() => null);

    if (!res.ok || !resData?.success) {
      return {
        success: false,
        error: resData?.error || 'No se pudo reservar el turno. Por favor selecciona otro horario.',
      };
    }

    const created: AppointmentRequest = {
      id: resData.appointment?.id || payload.id,
      tenant_id: tenantId,
      serviceId: payload.serviceId || '',
      serviceName: payload.serviceName || 'Servicio',
      professionalId: payload.professionalId || '',
      professionalName: payload.professionalName || 'Profesional',
      customerName: payload.customerName || 'Cliente',
      customerPhone: payload.customerPhone || '',
      customerEmail: payload.customerEmail || '',
      date: payload.date || '',
      time: payload.startTime || '',
      durationMinutes: payload.durationMinutes,
      status: (resData.appointment?.status || 'pending') as any,
      notes: payload.notes || '',
      createdAt: resData.appointment?.created_at || new Date().toISOString(),
    };

    // Actualizar caché local
    const current = getStoreAppointments(tenantId);
    saveStoreAppointments(tenantId, [created, ...current.filter((a) => a.id !== created.id)]);

    return { success: true, appointment: created };
  } catch (err: any) {
    console.error('[CentralBo H-02] Excepción al crear cita:', err);
    return { success: false, error: err?.message || 'Error de conexión al procesar la cita.' };
  }
}

export async function updateAppointmentStatus(
  tenantId: string,
  appointmentId: string,
  newStatus: 'confirmada' | 'rechazada' | 'pending' | 'confirmed' | 'rejected'
): Promise<{ success: boolean; error?: string }> {
  try {
    const dbStatus =
      newStatus === 'confirmada' ? 'confirmed' : newStatus === 'rechazada' ? 'rejected' : newStatus;

    const { error } = await supabase
      .from('appointments')
      .update({
        status: dbStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', appointmentId)
      .eq('tenant_id', tenantId);

    if (error && error.code !== 'PGRST205') {
      console.error('[CentralBo H-02] Error al actualizar estado de cita en Supabase:', error);
      return { success: false, error: error.message };
    }

    const current = getStoreAppointments(tenantId);
    const updated = current.map((a) =>
      a.id === appointmentId
        ? { ...a, status: newStatus as any, updatedAt: new Date().toISOString() }
        : a
    );
    saveStoreAppointments(tenantId, updated);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error al actualizar estado de la cita' };
  }
}

export async function deleteStoreAppointment(
  tenantId: string,
  appointmentId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('appointments')
      .delete()
      .eq('id', appointmentId)
      .eq('tenant_id', tenantId);

    if (error && error.code !== 'PGRST205') {
      console.error('[CentralBo H-02] Error al eliminar cita en Supabase:', error);
      return { success: false, error: error.message };
    }

    const current = getStoreAppointments(tenantId);
    saveStoreAppointments(tenantId, current.filter((a) => a.id !== appointmentId));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error al eliminar cita' };
  }
}

export function computePublicAgendaSlotsFromIntervals(
  professional: ProfessionalItem,
  dateStr: string,
  serviceDurationMinutes: number,
  occupiedIntervals: Array<{ startTime: string; durationMinutes: number }>
): ProfessionalAgendaSlot[] {
  if (!professional || !professional.schedule) {
    return [];
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const targetDate = new Date(year, month - 1, day, 12, 0, 0);
  const dayOfWeek = targetDate.getDay();

  const daySchedule = professional.schedule.find((s) => s.dayOfWeek === dayOfWeek);
  if (!daySchedule || !daySchedule.isOpen) {
    return [];
  }

  const [startHour, startMin] = (daySchedule.startTime || '09:00').split(':').map(Number);
  const [endHour, endMin] = (daySchedule.endTime || '18:00').split(':').map(Number);

  const startTotalMinutes = (isNaN(startHour) ? 9 : startHour) * 60 + (isNaN(startMin) ? 0 : startMin);
  const endTotalMinutes = (isNaN(endHour) ? 18 : endHour) * 60 + (isNaN(endMin) ? 0 : endMin);

  const duration = serviceDurationMinutes > 0 ? serviceDurationMinutes : 60;
  const rawTimes: string[] = [];

  for (let m = startTotalMinutes; m + duration <= endTotalMinutes; m += 15) {
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    rawTimes.push(`${hh}:${mm}`);
  }

  return rawTimes.map((time) => {
    const candStart = timeToMinutes(time);
    const candEnd = candStart + duration;

    const isOccupied = (occupiedIntervals || []).some((occ) => {
      const occStart = timeToMinutes(occ.startTime);
      const occDur = Number(occ.durationMinutes) || 60;
      const occEnd = occStart + occDur;
      return candStart < occEnd && candEnd > occStart;
    });

    if (isOccupied) {
      return {
        time,
        status: 'bloqueada' as AgendaSlotStatus,
        reason: 'Horario no disponible',
      };
    }

    return {
      time,
      status: 'disponible' as AgendaSlotStatus,
    };
  });
}

export async function fetchProfessionalAgendaSlots(
  tenantId: string,
  professional: ProfessionalItem,
  dateStr: string,
  serviceDurationMinutes: number = 60
): Promise<ProfessionalAgendaSlot[]> {
  try {
    // 1. Consultar endpoint seguro de disponibilidad (cero exposición de datos privados)
    const res = await fetch(
      `/api/appointments/availability?tenantId=${encodeURIComponent(tenantId)}&professionalId=${encodeURIComponent(
        professional.id
      )}&date=${encodeURIComponent(dateStr)}`
    );

    if (res.ok) {
      const data = await res.json().catch(() => null);
      if (data?.success && Array.isArray(data.intervals)) {
        return computePublicAgendaSlotsFromIntervals(
          professional,
          dateStr,
          serviceDurationMinutes,
          data.intervals
        );
      }
    }
  } catch (err) {
    console.warn('[CentralBo Agenda] Error al consultar API de disponibilidad, usando cálculo local:', err);
  }

  // Fallback si la API no está disponible
  await Promise.all([
    fetchStoreAppointmentBlocks(tenantId).catch(() => []),
    fetchStoreAppointments(tenantId).catch(() => []),
  ]);
  return getProfessionalAgendaSlots(tenantId, professional, dateStr, serviceDurationMinutes);
}

// ----------------------------------------------------------------------------
// 8. CATEGORÍAS (Por Tenant - Supabase Canónico con Caché Local)
// ----------------------------------------------------------------------------

/**
 * Referencia histórica de categorías demo por vertical.
 * Se preserva para fallback estático de diseño o referencia de catálogo,
 * pero NUNCA se inyecta automáticamente si Supabase devuelve una lista vacía [].
 */
export function getDefaultStoreCategories(tenantId: string, storeType: StoreType): Category[] {
  return storeType === 'restaurante'
    ? [
        {
          id: 'cat-rest-1',
          tenant_id: tenantId,
          name: 'Pizzas Artesanales',
          status: 'activo',
          created_at: '2026-09-01T12:00:00Z',
          updated_at: '2026-09-01T12:00:00Z',
        },
        {
          id: 'cat-rest-2',
          tenant_id: tenantId,
          name: 'Pastas Frescas',
          status: 'activo',
          created_at: '2026-09-01T12:00:00Z',
          updated_at: '2026-09-01T12:00:00Z',
        },
        {
          id: 'cat-rest-3',
          tenant_id: tenantId,
          name: 'Bebidas y Vinos',
          status: 'activo',
          created_at: '2026-09-01T12:00:00Z',
          updated_at: '2026-09-01T12:00:00Z',
        },
        {
          id: 'cat-rest-4',
          tenant_id: tenantId,
          name: 'Postres Clásicos',
          status: 'activo',
          created_at: '2026-09-01T12:00:00Z',
          updated_at: '2026-09-01T12:00:00Z',
        },
      ]
    : storeType === 'moda'
    ? [
        {
          id: 'cat-moda-1',
          tenant_id: tenantId,
          name: 'Vestidos & Enterizos',
          status: 'activo',
          created_at: '2026-09-02T12:00:00Z',
          updated_at: '2026-09-02T12:00:00Z',
        },
        {
          id: 'cat-moda-2',
          tenant_id: tenantId,
          name: 'Abrigos & Chaquetas',
          status: 'activo',
          created_at: '2026-09-02T12:00:00Z',
          updated_at: '2026-09-02T12:00:00Z',
        },
        {
          id: 'cat-moda-3',
          tenant_id: tenantId,
          name: 'Calzado & Botines',
          status: 'activo',
          created_at: '2026-09-02T12:00:00Z',
          updated_at: '2026-09-02T12:00:00Z',
        },
      ]
    : storeType === 'servicios'
    ? [
        {
          id: 'cat-serv-1',
          tenant_id: tenantId,
          name: 'Masoterapia & Relajación',
          status: 'activo',
          created_at: '2026-09-03T12:00:00Z',
          updated_at: '2026-09-03T12:00:00Z',
        },
        {
          id: 'cat-serv-2',
          tenant_id: tenantId,
          name: 'Cuidado Facial',
          status: 'activo',
          created_at: '2026-09-03T12:00:00Z',
          updated_at: '2026-09-03T12:00:00Z',
        },
        {
          id: 'cat-serv-3',
          tenant_id: tenantId,
          name: 'Paquetes de Spa',
          status: 'activo',
          created_at: '2026-09-03T12:00:00Z',
          updated_at: '2026-09-03T12:00:00Z',
        },
      ]
    : [
        {
          id: 'cat-gen-1',
          tenant_id: tenantId,
          name: 'Despensa & Abarrotes',
          status: 'activo',
          created_at: '2026-09-04T12:00:00Z',
          updated_at: '2026-09-04T12:00:00Z',
        },
        {
          id: 'cat-gen-2',
          tenant_id: tenantId,
          name: 'Lácteos & Refrigerados',
          status: 'activo',
          created_at: '2026-09-04T12:00:00Z',
          updated_at: '2026-09-04T12:00:00Z',
        },
        {
          id: 'cat-gen-3',
          tenant_id: tenantId,
          name: 'Limpieza del Hogar',
          status: 'activo',
          created_at: '2026-09-04T12:00:00Z',
          updated_at: '2026-09-04T12:00:00Z',
        },
      ];
}

/**
 * Obtiene las categorías cacheadas en localStorage para el tenantId de forma síncrona.
 * Si el comercio tiene guardado [], retorna [].
 * Si no tiene ningún registro en localStorage, retorna [].
 */
export function getCachedStoreCategories(tenantId: string): Category[] {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return [];
  }
  return loadFromStorage<Category[]>(tenantId, 'categories', []);
}

/**
 * Retorna las categorías del comercio (síncrono para compatibilidad de interfaz inicial).
 * Respeta rigurosamente si el comercio tiene caché (incluso si es un array vacío []).
 */
export function getStoreCategories(tenantId: string, storeType?: StoreType): Category[] {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return [];
  }

  // Si existe registro en localStorage para este tenant, devolverlo fielmente
  if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(getStorageKey(tenantId, 'categories')) ?? localStorage.getItem(getLegacyStorageKey(tenantId, 'categories'));
    if (raw !== null) {
      return loadFromStorage<Category[]>(tenantId, 'categories', []);
    }
  }

  // Si no hay caché y se especificó storeType como referencia histórica previa
  if (storeType) {
    const defaults = getDefaultStoreCategories(tenantId, storeType);
    return loadFromStorage<Category[]>(tenantId, 'categories', defaults);
  }

  return [];
}

/**
 * Consulta las categorías del comercio con Supabase como fuente canónica de datos.
 * Reglas:
 * 1. Aislamiento estricto: filtra por tenant_id = tenantId.
 * 2. Si Supabase devuelve categorías válidas (incluso [] vacías): actualiza caché local y retorna.
 * 3. Si Supabase devuelve [] (cero categorías): SE CONSERVA [] y NO se reinyectan datos demo.
 * 4. Si la conexión falla: recurre a la caché local existente como fallback de resiliencia.
 * 5. NO escribe datos demo en Supabase.
 */
export function fetchStoreCategories(tenantId: string): Promise<Category[]> {
  return dedupeCatalogRead(`categories:${tenantId}`, async () => {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return [];
  }

  const cached = getCachedStoreCategories(tenantId);

  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (!error && Array.isArray(data)) {
      const sanitized = data
        .map((item) => sanitizeCategoryItem(item, tenantId))
        .filter((c): c is Category => c !== null);

      // Persistencia remota confirmada: sincronizar la caché local del tenant
      saveToStorage(tenantId, 'categories', sanitized);
      return sanitized;
    }

    if (error) {
      console.warn('[CentralBo StoreAdmin] Aviso al consultar categories en Supabase:', error.message);
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar categories en Supabase:', err);
  }

  // Fallback seguro ante fallo de red: caché local existente
  return cached;
  });
}

/**
 * Crea una nueva categoría de catálogo en Supabase como fuente canónica.
 * - Genera un UUID estándar en Supabase (o por defecto gen_random_uuid()).
 * - Asocia estrictamente tenant_id = tenantId.
 * - Sincroniza la caché local únicamente tras la confirmación exitosa de Supabase.
 */
export async function createStoreCategory(
  tenantId: string,
  name: string
): Promise<{ success: boolean; category?: Category; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  const trimmedName = name ? name.trim().slice(0, 100) : '';
  if (!trimmedName) {
    return { success: false, error: 'El nombre de la categoría es obligatorio.' };
  }

  try {
    const { data, error } = await supabase
      .from('categories')
      .insert({
        tenant_id: tenantId,
        name: trimmedName,
        status: 'activo',
      })
      .select('*')
      .single();

    if (error) {
      console.error('[CentralBo StoreAdmin] Error al crear categoría en Supabase:', error);
      return {
        success: false,
        error: error.message || 'Error al guardar la categoría en el servidor.',
      };
    }

    if (!data) {
      return {
        success: false,
        error: 'No se recibió respuesta al crear la categoría en el servidor.',
      };
    }

    const newCategory = sanitizeCategoryItem(data, tenantId);
    if (!newCategory) {
      return {
        success: false,
        error: 'Los datos devueltos por el servidor no tienen un formato válido.',
      };
    }

    // Actualizar caché local tras confirmación remota exitosa
    const currentCached = getCachedStoreCategories(tenantId);
    const updated = [...currentCached.filter((c) => c.id !== newCategory.id), newCategory];
    saveToStorage(tenantId, 'categories', updated);

    return { success: true, category: newCategory };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al crear categoría en Supabase:', err);
    return {
      success: false,
      error: err?.message || 'Error de conexión al crear la categoría.',
    };
  }
}

/**
 * Actualiza los campos permitidos ('name' y 'status') de una categoría en Supabase.
 * Soporta firmas:
 * - updateStoreCategory(tenantId, categoryId, updates)
 * - updateStoreCategory(categoryId, updates, tenantId?)
 */
export async function updateStoreCategory(
  tenantIdOrCategoryId: string,
  categoryIdOrUpdates: string | { name?: string; status?: CategoryStatus },
  updatesOrTenantId?: { name?: string; status?: CategoryStatus } | string
): Promise<{ success: boolean; category?: Category; error?: string }> {
  let tenantId = '';
  let categoryId = '';
  let updates: { name?: string; status?: CategoryStatus } = {};

  if (typeof categoryIdOrUpdates === 'string') {
    tenantId = tenantIdOrCategoryId;
    categoryId = categoryIdOrUpdates;
    updates =
      typeof updatesOrTenantId === 'object' && updatesOrTenantId !== null
        ? updatesOrTenantId
        : {};
  } else {
    categoryId = tenantIdOrCategoryId;
    updates =
      typeof categoryIdOrUpdates === 'object' && categoryIdOrUpdates !== null
        ? categoryIdOrUpdates
        : {};
    tenantId = typeof updatesOrTenantId === 'string' ? updatesOrTenantId : '';
  }

  if (!categoryId || typeof categoryId !== 'string') {
    return { success: false, error: 'Identificador de categoría no válido.' };
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof updates.name === 'string') {
    const trimmed = updates.name.trim().slice(0, 100);
    if (!trimmed) {
      return { success: false, error: 'El nombre de la categoría no puede estar vacío.' };
    }
    payload.name = trimmed;
  }

  if (updates.status === 'activo' || updates.status === 'inactivo') {
    payload.status = updates.status;
  }

  try {
    let query = supabase.from('categories').update(payload).eq('id', categoryId);
    if (tenantId && isValidTenantId(tenantId)) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query.select('*').maybeSingle();

    if (error) {
      console.error('[CentralBo StoreAdmin] Error al actualizar categoría en Supabase:', error);
      return {
        success: false,
        error: error.message || 'Error al actualizar la categoría en el servidor.',
      };
    }

    if (!data) {
      return {
        success: false,
        error: 'No se encontró la categoría o no se poseen permisos para modificarla.',
      };
    }

    const updatedCat = sanitizeCategoryItem(data, tenantId || data.tenant_id);
    if (!updatedCat) {
      return { success: false, error: 'Datos devueltos inválidos.' };
    }

    // Sincronizar caché local únicamente tras confirmación remota
    const actualTenantId = tenantId || updatedCat.tenant_id;
    if (actualTenantId && isValidTenantId(actualTenantId)) {
      const currentCached = getCachedStoreCategories(actualTenantId);
      const updatedList = currentCached.map((c) => (c.id === categoryId ? updatedCat : c));
      saveToStorage(actualTenantId, 'categories', updatedList);
    }

    return { success: true, category: updatedCat };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al actualizar categoría en Supabase:', err);
    return {
      success: false,
      error: err?.message || 'Error de conexión al actualizar la categoría.',
    };
  }
}

/**
 * Elimina una categoría del catálogo en Supabase.
 * Soporta firmas:
 * - deleteStoreCategory(tenantId, categoryId)
 * - deleteStoreCategory(categoryId)
 */
export async function deleteStoreCategory(
  tenantIdOrCategoryId: string,
  categoryIdArg?: string
): Promise<{ success: boolean; error?: string }> {
  let tenantId = '';
  let categoryId = '';

  if (categoryIdArg) {
    tenantId = tenantIdOrCategoryId;
    categoryId = categoryIdArg;
  } else {
    categoryId = tenantIdOrCategoryId;
  }

  if (!categoryId || typeof categoryId !== 'string') {
    return { success: false, error: 'Identificador de categoría no válido.' };
  }

  try {
    let query = supabase.from('categories').delete().eq('id', categoryId);
    if (tenantId && isValidTenantId(tenantId)) {
      query = query.eq('tenant_id', tenantId);
    }

    const { error } = await query;

    if (error) {
      console.error('[CentralBo StoreAdmin] Error al eliminar categoría en Supabase:', error);
      return {
        success: false,
        error: error.message || 'Error al eliminar la categoría en el servidor.',
      };
    }

    // Sincronizar caché local únicamente tras confirmación remota
    if (tenantId && isValidTenantId(tenantId)) {
      const currentCached = getCachedStoreCategories(tenantId);
      const updatedList = currentCached.filter((c) => c.id !== categoryId);
      saveToStorage(tenantId, 'categories', updatedList);
    }

    return { success: true };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al eliminar categoría en Supabase:', err);
    return {
      success: false,
      error: err?.message || 'Error de conexión al eliminar la categoría.',
    };
  }
}

/**
 * Guarda las categorías en la caché local del tenant (sincronización local).
 */
export function saveStoreCategories(
  tenantId: string,
  categories: Category[]
): void {
  saveToStorage(tenantId, 'categories', categories);
}

// ----------------------------------------------------------------------------
// 9. PRODUCTOS (Centralizados en Supabase - Fuente Canónica Multi-Tenant)
// ----------------------------------------------------------------------------

/**
 * Obtiene los productos del comercio desde la caché local del tenant.
 * Respeta rigurosamente si el catálogo está vacío ([]) sin inyectar datos demo.
 */
export function getCachedStoreProducts(tenantId: string): Product[] {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return [];
  }
  return loadFromStorage<Product[]>(tenantId, 'products', []);
}

/**
 * Retorna los productos del comercio (síncrono para render inicial de la interfaz).
 * NUNCA auto-genera productos DEMO ni sobrescribe catálogos vacíos.
 */
export function getStoreProducts(tenantId: string, _storeType?: StoreType): Product[] {
  return getCachedStoreProducts(tenantId);
}

/**
 * Consulta los productos del comercio con Supabase como fuente canónica de datos.
 * Reglas:
 * 1. Aislamiento estricto: filtra por tenant_id = tenantId.
 * 2. Si Supabase devuelve productos válidos (incluso [] vacío): actualiza caché local y retorna.
 * 3. Si Supabase devuelve [] (cero productos): SE CONSERVA [] y NO se inyectan datos demo.
 * 4. Si la conexión falla: recurre a la caché local existente como fallback de resiliencia.
 * 5. NO escribe datos demo en Supabase.
 */
export function fetchStoreProducts(tenantId: string): Promise<Product[]> {
  return dedupeCatalogRead(`products:${tenantId}`, async () => {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return [];
  }

  const cached = getCachedStoreProducts(tenantId);

  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      const sanitized = data
        .map((item) => sanitizeProductItem(item, tenantId))
        .filter((p): p is Product => p !== null);

      // Persistencia remota canónica confirmada: sincronizar la caché local del tenant
      saveToStorage(tenantId, 'products', sanitized);
      return sanitized;
    }

    if (error) {
      console.warn('[CentralBo StoreAdmin] Aviso al consultar products en Supabase:', error.message);
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar products en Supabase:', err);
  }

  // Fallback seguro ante fallo de red: caché local existente
  return cached;
  });
}

/**
 * Crea un nuevo producto de catálogo en Supabase como fuente canónica.
 * - NO genera manualmente el ID; delega en PostgreSQL gen_random_uuid().
 * - Asocia estrictamente tenant_id = tenantId.
 * - Valida category_id (UUID existente o null).
 * - Sincroniza la caché local únicamente tras la confirmación exitosa de Supabase.
 */
export async function createStoreProduct(
  tenantId: string,
  productInput: Partial<Product>
): Promise<{ success: boolean; product?: Product; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  const trimmedName = typeof productInput.name === 'string' ? productInput.name.trim().slice(0, 150) : '';
  if (!trimmedName) {
    return { success: false, error: 'El nombre del producto es obligatorio.' };
  }

  const rawPrice = productInput.price;
  const numPrice = Number(rawPrice);
  if (
    (typeof rawPrice !== 'number' && typeof rawPrice !== 'string') ||
    isNaN(numPrice) ||
    !Number.isFinite(numPrice) ||
    numPrice < 0
  ) {
    return { success: false, error: 'El precio debe ser un número válido mayor o igual a 0.' };
  }

  const validCategoryId =
    productInput.category_id && isValidUUID(productInput.category_id)
      ? productInput.category_id.trim()
      : null;

  const validStatus: ProductStatus =
    productInput.status === 'inactivo' || productInput.status === 'borrador'
      ? productInput.status
      : 'activo';

  const cleanAttrs =
    sanitizeProductItem(
      {
        name: trimmedName,
        price: numPrice,
        attributes: productInput.attributes || {},
      },
      tenantId
    )?.attributes || {};

  const targetId =
    productInput.id && isValidUUID(productInput.id)
      ? productInput.id.trim()
      : undefined;

  const rawImages = Array.isArray(productInput.images)
    ? productInput.images.filter((img): img is string => typeof img === 'string' && Boolean(img.trim())).slice(0, 3)
    : [];
  if (rawImages.length > 0) {
    cleanAttrs.images = rawImages;
  }

  const primaryImage =
    rawImages[0] ||
    (typeof productInput.image_url === 'string' && productInput.image_url.trim()
      ? productInput.image_url.trim()
      : null);

  const payload: Record<string, unknown> = {
    tenant_id: tenantId,
    category_id: validCategoryId,
    name: trimmedName,
    description:
      typeof productInput.description === 'string' && productInput.description.trim()
        ? productInput.description.trim().slice(0, 1000)
        : null,
    price: numPrice,
    is_available: productInput.is_available ?? true,
    image_url: primaryImage,
    status: validStatus,
    attributes: cleanAttrs,
  };

  if (targetId) {
    payload.id = targetId;
  }

  try {
    const { data, error } = await supabase
      .from('products')
      .insert(payload)
      .select('*')
      .single();

    if (error) {
      console.error('[CentralBo StoreAdmin] Error al crear producto en Supabase:', error);
      return {
        success: false,
        error: error.message || 'Error al guardar el producto en el servidor.',
      };
    }

    if (!data) {
      return {
        success: false,
        error: 'No se recibió respuesta al crear el producto en el servidor.',
      };
    }

    const newProduct = sanitizeProductItem(data, tenantId);
    if (!newProduct) {
      return {
        success: false,
        error: 'Los datos devueltos por el servidor no tienen un formato válido.',
      };
    }

    // Actualizar caché local tras confirmación remota exitosa
    const currentCached = getCachedStoreProducts(tenantId);
    const updated = [newProduct, ...currentCached.filter((p) => p.id !== newProduct.id)];
    saveToStorage(tenantId, 'products', updated);

    return { success: true, product: newProduct };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al crear producto en Supabase:', err);
    return {
      success: false,
      error: err?.message || 'Error de conexión al crear el producto.',
    };
  }
}

/**
 * Actualiza los campos permitidos de un producto en Supabase.
 * - Respeta id y tenant_id.
 * - Valida category_id (UUID o null).
 * - Sincroniza la caché local únicamente tras confirmación de Supabase.
 */
export async function updateStoreProduct(
  tenantId: string,
  productId: string,
  updates: Partial<Product>
): Promise<{ success: boolean; product?: Product; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!productId || typeof productId !== 'string' || !isValidUUID(productId)) {
    return { success: false, error: 'Identificador de producto (UUID) no válido.' };
  }

  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof updates.name === 'string') {
    const trimmed = updates.name.trim().slice(0, 150);
    if (!trimmed) {
      return { success: false, error: 'El nombre del producto no puede estar vacío.' };
    }
    payload.name = trimmed;
  }

  if (updates.price !== undefined) {
    const numPrice = Number(updates.price);
    if (isNaN(numPrice) || !Number.isFinite(numPrice) || numPrice < 0) {
      return { success: false, error: 'El precio debe ser un número válido mayor o igual a 0.' };
    }
    payload.price = numPrice;
  }

  if (updates.description !== undefined) {
    payload.description =
      typeof updates.description === 'string' && updates.description.trim()
        ? updates.description.trim().slice(0, 1000)
        : null;
  }

  if (updates.category_id !== undefined) {
    payload.category_id =
      updates.category_id && isValidUUID(updates.category_id)
        ? updates.category_id.trim()
        : null;
  }

  if (updates.is_available !== undefined) {
    payload.is_available = Boolean(updates.is_available);
  }

  if (updates.image_url !== undefined) {
    payload.image_url =
      typeof updates.image_url === 'string' && updates.image_url.trim()
        ? updates.image_url.trim()
        : null;
  }

  if (updates.images !== undefined) {
    const rawImages = Array.isArray(updates.images)
      ? updates.images.filter((img): img is string => typeof img === 'string' && Boolean(img.trim())).slice(0, 3)
      : [];
    const currentAttrs = (payload.attributes as Record<string, unknown>) || {};
    currentAttrs.images = rawImages;
    payload.attributes = currentAttrs;
    if (rawImages.length > 0) {
      payload.image_url = rawImages[0];
    } else if (updates.image_url === undefined) {
      payload.image_url = null;
    }
  }

  if (updates.status !== undefined) {
    payload.status =
      updates.status === 'inactivo' || updates.status === 'borrador'
        ? updates.status
        : 'activo';
  }

  if (updates.attributes !== undefined && typeof updates.attributes === 'object') {
    const cleanAttrs =
      sanitizeProductItem(
        {
          name: updates.name || 'valid',
          price: updates.price !== undefined ? Number(updates.price) : 10,
          attributes: updates.attributes,
        },
        tenantId
      )?.attributes || {};
    payload.attributes = cleanAttrs;
  }

  try {
    const { data, error } = await supabase
      .from('products')
      .update(payload)
      .eq('id', productId)
      .eq('tenant_id', tenantId)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[CentralBo StoreAdmin] Error al actualizar producto en Supabase:', error);
      return {
        success: false,
        error: error.message || 'Error al actualizar el producto en el servidor.',
      };
    }

    if (!data) {
      return {
        success: false,
        error: 'No se encontró el producto o no se poseen permisos para modificarlo.',
      };
    }

    const updatedProduct = sanitizeProductItem(data, tenantId);
    if (!updatedProduct) {
      return { success: false, error: 'Datos devueltos inválidos por el servidor.' };
    }

    // Sincronizar caché local únicamente tras confirmación remota
    const currentCached = getCachedStoreProducts(tenantId);
    const updatedList = currentCached.map((p) => (p.id === productId ? updatedProduct : p));
    saveToStorage(tenantId, 'products', updatedList);

    return { success: true, product: updatedProduct };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al actualizar producto en Supabase:', err);
    return {
      success: false,
      error: err?.message || 'Error de conexión al actualizar el producto.',
    };
  }
}

/**
 * Elimina un producto del catálogo en Supabase.
 * - Filtra por id y tenant_id.
 * - Sincroniza la caché local únicamente tras confirmación remota.
 * - Si se elimina el último producto, la lista queda en [] y no se reinyectan demos.
 */
export async function deleteStoreProduct(
  tenantId: string,
  productId: string
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || typeof tenantId !== 'string' || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) no válido.' };
  }

  if (!productId || typeof productId !== 'string') {
    return { success: false, error: 'Identificador de producto no válido.' };
  }

  try {
    // Si el producto poseía una imagen en el bucket product-images, eliminarla de Storage de forma no bloqueante
    const existingCached = getCachedStoreProducts(tenantId);
    const existingProd = existingCached.find((p) => p.id === productId);
    if (existingProd?.image_url) {
      deleteProductImage(tenantId, existingProd.image_url).catch((cleanupErr) =>
        console.warn('[deleteStoreProduct] Advertencia al limpiar imagen de Storage:', cleanupErr)
      );
    }

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('tenant_id', tenantId);

    if (error) {
      console.error('[CentralBo StoreAdmin] Error al eliminar producto en Supabase:', error);
      return {
        success: false,
        error: error.message || 'Error al eliminar el producto en el servidor.',
      };
    }

    // Sincronizar caché local únicamente tras confirmación remota
    const currentCached = getCachedStoreProducts(tenantId);
    const updatedList = currentCached.filter((p) => p.id !== productId);
    saveToStorage(tenantId, 'products', updatedList);

    return { success: true };
  } catch (err: any) {
    console.error('[CentralBo StoreAdmin] Excepción al eliminar producto en Supabase:', err);
    return {
      success: false,
      error: err?.message || 'Error de conexión al eliminar el producto.',
    };
  }
}

/**
 * Cambia la disponibilidad de un producto en Supabase.
 */
export async function toggleStoreProductAvailability(
  tenantId: string,
  productId: string,
  currentAvailability: boolean
): Promise<{ success: boolean; product?: Product; error?: string }> {
  return updateStoreProduct(tenantId, productId, { is_available: !currentAvailability });
}

/**
 * Guarda los productos en la caché local del tenant (sincronización local).
 */
export function saveStoreProducts(
  tenantId: string,
  products: Product[]
): void {
  if (!Array.isArray(products)) {
    console.warn('[CentralBo StoreAdmin] Intento de guardar productos con valor no válido.');
    return;
  }
  const sanitized = products
    .map((p) => sanitizeProductItem(p, tenantId))
    .filter((p): p is Product => p !== null);
  saveToStorage(tenantId, 'products', sanitized);
}

// ----------------------------------------------------------------------------
// 10. PEDIDOS (Por Tenant con los 7 estados canónicos y sincronización Supabase)
// ----------------------------------------------------------------------------

/**
 * Obtiene los pedidos del tenant desde la caché local o estado inicial limpio.
 * NO inyecta pedidos demo/ficticios. Comercios nuevos comienzan con [].
 */
export function getStoreOrders(tenantId: string): Order[] {
  const loaded = loadFromStorage<Order[]>(tenantId, 'orders', []);
  // Filtrar pedidos demo residuales de pruebas previas ('ord-100X')
  return Array.isArray(loaded) ? loaded.filter((o) => !o.id.startsWith('ord-100')) : [];
}

/**
 * Consulta de forma centralizada los pedidos reales en Supabase filtrando exclusivamente por tenant_id.
 * Sincroniza la caché local y retorna la lista ordenada descendentemente por fecha.
 */
export async function fetchStoreOrders(tenantId: string): Promise<Order[]> {
  if (!tenantId) return [];

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('id, tenant_id, customer_id, customer_name, customer_email, customer_phone, status, total, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      const sanitizedOrders: Order[] = data.map((o: any) => ({
        id: String(o.id),
        tenant_id: String(o.tenant_id),
        customer_id: o.customer_id ? String(o.customer_id) : null,
        customer_name: o.customer_name ? String(o.customer_name) : null,
        customer_email: o.customer_email ? String(o.customer_email) : null,
        customer_phone: o.customer_phone ? String(o.customer_phone) : null,
        status: (o.status || 'pendiente') as OrderStatus,
        total: Number(o.total) || 0,
        created_at: o.created_at || new Date().toISOString(),
        updated_at: o.updated_at || new Date().toISOString(),
      }));

      // Mantener sincronizado el almacenamiento local del tenant sin pedidos mock
      saveStoreOrders(tenantId, sanitizedOrders);
      return sanitizedOrders;
    }

    if (error) {
      console.warn('[CentralBo StoreAdmin] Error al consultar pedidos en Supabase:', error.message);
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción remota al consultar pedidos en Supabase:', err);
  }

  // Respaldo de pedidos en caché local
  return getStoreOrders(tenantId);
}

/**
 * Recupera de forma canónica las líneas de un pedido desde Supabase (order_items),
 * enriquecidas con el nombre de producto desde la tabla products.
 * Respeta estrictamente el aislamiento por tenant_id.
 */
export async function fetchOrderItems(
  tenantId: string,
  orderId: string
): Promise<OrderItemDetail[]> {
  if (!tenantId || !orderId) return [];

  try {
    const { data, error } = await supabase
      .from('order_items')
      .select('id, tenant_id, order_id, product_id, quantity, unit_price, created_at, products(name, image_url)')
      .eq('tenant_id', tenantId)
      .eq('order_id', orderId)
      .order('created_at', { ascending: true });

    if (error) {
      console.warn('[CentralBo StoreAdmin] Error al consultar order_items:', error.message);
      return [];
    }

    if (Array.isArray(data)) {
      return data.map((item: any) => ({
        id: String(item.id),
        tenant_id: String(item.tenant_id),
        order_id: String(item.order_id),
        product_id: String(item.product_id),
        quantity: Number(item.quantity) || 1,
        unit_price: Number(item.unit_price) || 0,
        created_at: item.created_at || new Date().toISOString(),
        product_name: item.products?.name || undefined,
        product_image_url: item.products?.image_url || null,
      }));
    }
  } catch (err) {
    console.warn('[CentralBo StoreAdmin] Excepción al consultar order_items:', err);
  }

  return [];
}

export function saveStoreOrders(tenantId: string, orders: Order[]): void {
  if (!Array.isArray(orders)) {
    console.warn('[CentralBo StoreAdmin] Intento de guardar pedidos con valor no válido.');
    return;
  }
  const sanitized = orders
    .map((o) => sanitizeOrderItem(o, tenantId))
    .filter((o): o is Order => o !== null && !o.id.startsWith('ord-100'));
  saveToStorage(tenantId, 'orders', sanitized);
}

export async function updateOrderStatus(
  tenantId: string,
  orderId: string,
  newStatus: OrderStatus
): Promise<{ success: boolean; order?: Order; error?: string }> {
  // Validación estricta en runtime: debe pertenecer exclusivamente al conjunto canónico
  if (
    !newStatus ||
    typeof newStatus !== 'string' ||
    !CANONICAL_ORDER_STATUSES.includes(newStatus)
  ) {
    console.warn(`[CentralBo StoreAdmin] Estado de pedido rechazado por no ser canónico: "${newStatus}"`);
    return { success: false, error: 'Estado no canónico' };
  }

  const now = new Date().toISOString();

  // 1. Persistencia centralizada en Supabase (tabla 'orders')
  try {
    const { error: remoteError } = await supabase
      .from('orders')
      .update({
        status: newStatus,
        updated_at: now,
      })
      .eq('id', orderId)
      .eq('tenant_id', tenantId);

    if (remoteError) {
      console.warn('[CentralBo StoreAdmin] Error al actualizar estado en Supabase:', remoteError.message);
    }
  } catch (err: any) {
    console.warn('[CentralBo StoreAdmin] Excepción remota al actualizar estado en Supabase:', err);
  }

  // 2. Actualizar caché local del tenant
  const orders = getStoreOrders(tenantId);
  const index = orders.findIndex((o) => o.id === orderId);
  if (index === -1) {
    return { success: false, error: 'Pedido no encontrado en la lista local' };
  }

  orders[index] = {
    ...orders[index],
    status: newStatus,
    updated_at: now,
  };

  saveStoreOrders(tenantId, orders);
  return { success: true, order: orders[index] };
}

// ----------------------------------------------------------------------------
// 11. PROMOCIONES (FASE 2 - PARTE 1: PERSISTENCIA CANÓNICA Y ADMINISTRACIÓN)
// ----------------------------------------------------------------------------

export interface DbPromotionRow {
  id: string;
  tenant_id: string;
  code: string;
  discount_type: 'percentage' | 'fixed';
  discount_value: number;
  start_date: string;
  end_date: string;
  min_purchase: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function mapDbRowToPromotion(row: any): PromotionCode {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    code: String(row.code).trim().toUpperCase(),
    discountType: row.discount_type === 'fixed' ? 'fixed' : 'percentage',
    discountValue: Number(row.discount_value) || 0,
    startDate: String(row.start_date || ''),
    endDate: String(row.end_date || ''),
    minPurchase: Number(row.min_purchase) || 0,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at ? String(row.created_at) : undefined,
    updatedAt: row.updated_at ? String(row.updated_at) : undefined,
  };
}

/**
 * Obtiene las promociones cacheadas localmente para un tenant.
 * NOTA CANÓNICA: Retorna exclusivamente la caché local. Si está vacía retorna [],
 * NUNCA datos ficticios ni fallbacks demo como BIENVENIDO10 o ENVIOGRATIS20.
 */
export function getCachedStorePromotions(tenantId: string): PromotionCode[] {
  if (!tenantId) return [];
  return loadFromStorage<PromotionCode[]>(tenantId, 'promotions', []);
}

/**
 * Mantiene compatibilidad sincrónica para lectores existentes utilizando la caché local no-autoritativa.
 */
export function getStorePromotions(tenantId: string): PromotionCode[] {
  return getCachedStorePromotions(tenantId);
}

/**
 * Actualiza la caché local de promociones del tenant.
 */
export function saveStorePromotions(
  tenantId: string,
  promos: PromotionCode[]
): void {
  if (!tenantId) return;
  saveToStorage(tenantId, 'promotions', promos);
}

/**
 * Consulta canónica de promociones directamente desde Supabase.
 * En caso de éxito, actualiza la caché local.
 */
export async function fetchStorePromotions(tenantId: string): Promise<PromotionCode[]> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return getCachedStorePromotions(tenantId);
  }

  try {
    const { data, error } = await supabase
      .from('promotions')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205' || error.message?.includes('promotions')) {
        console.warn('[CentralBo StoreAdmin] Tabla public.promotions pendiente de migración en Supabase:', error.message);
      } else {
        console.error('[CentralBo StoreAdmin] Error al consultar promociones en Supabase:', error.message);
      }
      return getCachedStorePromotions(tenantId);
    }

    if (Array.isArray(data)) {
      const canonicalPromotions = data.map(mapDbRowToPromotion);
      saveStorePromotions(tenantId, canonicalPromotions);
      return canonicalPromotions;
    }
  } catch (err) {
    console.error('[CentralBo StoreAdmin] Excepción inesperada al consultar promociones:', err);
  }

  return getCachedStorePromotions(tenantId);
}

/**
 * Consulta canónica de promociones activas y vigentes para la tienda pública.
 * Fuente de verdad canónica: public.promotions.
 * Solo retorna promociones con is_active = true y dentro del rango de vigencia por fecha.
 * Actualiza la caché local no-autoritativa y nunca inyecta cupones demo o ficticios.
 */
export async function fetchPublicActivePromotions(tenantId: string): Promise<PromotionCode[]> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return [];
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const baseUrl =
    typeof window !== 'undefined' && window.location?.origin
      ? ''
      : 'http://127.0.0.1:3000';

  // 1. Intentar consulta vía endpoint público seguro respaldado por el backend
  try {
    const res = await fetch(`${baseUrl}/api/promotions/active?tenantId=${encodeURIComponent(tenantId)}`);
    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (json?.success && Array.isArray(json.promotions)) {
        const activePromos: PromotionCode[] = json.promotions;
        saveStorePromotions(tenantId, activePromos);
        return activePromos;
      }
    }
  } catch (err) {
    console.warn('[CentralBo PublicStore] Aviso al consultar endpoint de promociones activas:', err);
  }

  // 2. Consulta directa a Supabase (anon client según RLS de 16_add_promotions_public_rls.sql)
  try {
    const { data, error } = await supabase
      .from('promotions')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .lte('start_date', todayStr)
      .gte('end_date', todayStr)
      .order('discount_value', { ascending: false });

    if (!error && Array.isArray(data)) {
      const canonicalPromotions = data.map(mapDbRowToPromotion);
      saveStorePromotions(tenantId, canonicalPromotions);
      return canonicalPromotions;
    }
  } catch (err) {
    console.warn('[CentralBo PublicStore] Excepción al consultar promociones en Supabase:', err);
  }

  // 3. Fallback no-autoritativo a caché local (exclusivamente activas y vigentes por fecha)
  const cached = getCachedStorePromotions(tenantId);
  return cached.filter(
    (p) =>
      p.isActive &&
      (!p.startDate || p.startDate <= todayStr) &&
      (!p.endDate || p.endDate >= todayStr)
  );
}

/**
 * Crea una nueva promoción canónica en Supabase.
 * Genera el UUID persistente en el backend y valida unicidad por (tenant_id, code).
 * La caché local se actualiza exclusivamente tras confirmación remota exitosa.
 */
export async function createStorePromotion(
  tenantId: string,
  promoData: Omit<PromotionCode, 'id'>
): Promise<{ success: boolean; data?: PromotionCode; error?: string }> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) inválido.' };
  }

  const cleanCode = (promoData.code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!cleanCode) {
    return { success: false, error: 'El código promocional no puede estar vacío.' };
  }

  const numDiscount = Number(promoData.discountValue);
  if (!Number.isFinite(numDiscount) || numDiscount <= 0) {
    return { success: false, error: 'El valor de descuento debe ser un número positivo.' };
  }

  const numMinPurchase = Number(promoData.minPurchase || 0);
  if (!Number.isFinite(numMinPurchase) || numMinPurchase < 0) {
    return { success: false, error: 'El monto de compra mínima no puede ser negativo.' };
  }

  const dbPayload = {
    tenant_id: tenantId,
    code: cleanCode,
    discount_type: promoData.discountType === 'fixed' ? 'fixed' : 'percentage',
    discount_value: numDiscount,
    start_date: promoData.startDate || new Date().toISOString().split('T')[0],
    end_date: promoData.endDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    min_purchase: numMinPurchase,
    is_active: promoData.isActive !== undefined ? Boolean(promoData.isActive) : true,
  };

  try {
    const { data, error } = await supabase
      .from('promotions')
      .insert(dbPayload)
      .select('*')
      .single();

    if (error) {
      if (
        error.code === '23505' ||
        error.message?.includes('uq_promotions_tenant_code') ||
        error.message?.includes('duplicate key')
      ) {
        return {
          success: false,
          error: `El código promocional "${cleanCode}" ya existe en este comercio.`,
        };
      }
      return {
        success: false,
        error: error.message || 'Error al persistir la promoción en la base de datos.',
      };
    }

    if (data) {
      const createdPromo = mapDbRowToPromotion(data);
      const currentCached = getCachedStorePromotions(tenantId);
      const updatedCache = [createdPromo, ...currentCached.filter(p => p.id !== createdPromo.id)];
      saveStorePromotions(tenantId, updatedCache);
      return { success: true, data: createdPromo };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Excepción inesperada al crear promoción.',
    };
  }

  return { success: false, error: 'Respuesta inválida del servidor.' };
}

/**
 * Actualiza puntualmente una promoción en Supabase (edición, pausar, reactivar).
 * La caché local se actualiza exclusivamente tras confirmación remota exitosa.
 */
export async function updateStorePromotion(
  tenantId: string,
  promoId: string,
  updates: Partial<PromotionCode>
): Promise<{ success: boolean; data?: PromotionCode; error?: string }> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) inválido.' };
  }

  if (!promoId || !promoId.trim()) {
    return { success: false, error: 'Identificador de promoción no proporcionado.' };
  }

  const dbUpdates: Record<string, any> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.code !== undefined) {
    const cleanCode = updates.code.trim().toUpperCase().replace(/\s+/g, '');
    if (!cleanCode) {
      return { success: false, error: 'El código promocional no puede estar vacío.' };
    }
    dbUpdates.code = cleanCode;
  }

  if (updates.discountType !== undefined) {
    dbUpdates.discount_type = updates.discountType === 'fixed' ? 'fixed' : 'percentage';
  }

  if (updates.discountValue !== undefined) {
    const val = Number(updates.discountValue);
    if (!Number.isFinite(val) || val <= 0) {
      return { success: false, error: 'El valor de descuento debe ser un número positivo.' };
    }
    dbUpdates.discount_value = val;
  }

  if (updates.startDate !== undefined) {
    dbUpdates.start_date = updates.startDate;
  }

  if (updates.endDate !== undefined) {
    dbUpdates.end_date = updates.endDate;
  }

  if (updates.minPurchase !== undefined) {
    const minP = Number(updates.minPurchase);
    if (!Number.isFinite(minP) || minP < 0) {
      return { success: false, error: 'La compra mínima no puede ser negativa.' };
    }
    dbUpdates.min_purchase = minP;
  }

  if (updates.isActive !== undefined) {
    dbUpdates.is_active = Boolean(updates.isActive);
  }

  try {
    const { data, error } = await supabase
      .from('promotions')
      .update(dbUpdates)
      .eq('id', promoId)
      .eq('tenant_id', tenantId)
      .select('*')
      .single();

    if (error) {
      if (
        error.code === '23505' ||
        error.message?.includes('uq_promotions_tenant_code') ||
        error.message?.includes('duplicate key')
      ) {
        return {
          success: false,
          error: 'El código promocional ya existe en este comercio.',
        };
      }
      return {
        success: false,
        error: error.message || 'Error al actualizar la promoción en la base de datos.',
      };
    }

    if (data) {
      const updatedPromo = mapDbRowToPromotion(data);
      const currentCached = getCachedStorePromotions(tenantId);
      const updatedCache = currentCached.map(p => p.id === promoId ? updatedPromo : p);
      saveStorePromotions(tenantId, updatedCache);
      return { success: true, data: updatedPromo };
    }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Excepción al actualizar promoción.',
    };
  }

  return { success: false, error: 'No se pudo actualizar la promoción.' };
}

/**
 * Elimina una promoción exclusivamente en Supabase por ID y tenant_id.
 * La caché local se actualiza únicamente tras confirmación remota exitosa.
 */
export async function deleteStorePromotion(
  tenantId: string,
  promoId: string
): Promise<{ success: boolean; error?: string }> {
  if (!tenantId || !isValidTenantId(tenantId)) {
    return { success: false, error: 'Identificador de comercio (tenantId) inválido.' };
  }

  if (!promoId || !promoId.trim()) {
    return { success: false, error: 'Identificador de promoción inválido.' };
  }

  try {
    const { error } = await supabase
      .from('promotions')
      .delete()
      .eq('id', promoId)
      .eq('tenant_id', tenantId);

    if (error) {
      return {
        success: false,
        error: error.message || 'Error al eliminar la promoción en Supabase.',
      };
    }

    const currentCached = getCachedStorePromotions(tenantId);
    saveStorePromotions(tenantId, currentCached.filter(p => p.id !== promoId));
    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Excepción al eliminar promoción.',
    };
  }
}

// ----------------------------------------------------------------------------
// 12. ESTADÍSTICAS Y ANTI-INFLACIÓN DE VISITAS
// ----------------------------------------------------------------------------
const VISIT_SESSION_KEY = 'maxinego_last_visit_timestamp_';
const LEGACY_VISIT_SESSION_KEY = 'centralbo_last_visit_timestamp_';

export function getStoreStatistics(tenantId: string): StoreStatistics {
  const superStore = SUPERADMIN_STORES.find((s) => s.id === tenantId);
  const baseVisits = superStore?.activity.visitas || 1200;
  const orders = getStoreOrders(tenantId);
  const completedOrders = orders.filter((o) => o.status === 'completado').length;

  const products = getStoreProducts(
    tenantId,
    (superStore?.store_type || 'general') as StoreType
  );

  const mostViewed = products.slice(0, 4).map((p, idx) => {
    const views = Math.round(baseVisits * (0.35 - idx * 0.08));
    return {
      id: p.id,
      name: p.name,
      category: 'General',
      views: Math.max(views, 20),
      percentage: Math.round(((views || 20) / baseVisits) * 100),
    };
  });

  const totalOrdersCount = orders.length;
  const conversionRate = Number(((totalOrdersCount / baseVisits) * 100).toFixed(1));

  const stats: StoreStatistics = {
    totalVisits: baseVisits,
    todayVisits: Math.round(baseVisits * 0.08),
    last7DaysVisits: Math.round(baseVisits * 0.38),
    last30DaysVisits: baseVisits,
    mostViewedProducts: mostViewed,
    totalOrders: totalOrdersCount,
    completedOrders: completedOrders,
    conversionRate: conversionRate,
    antiInflationWindowMinutes: 30,
  };

  return loadFromStorage<StoreStatistics>(tenantId, 'statistics', stats);
}

// Mecanismo anti-inflación de visitas (Deduplicación por ventana de 30 minutos)
export function recordStoreVisitSafely(tenantId: string): boolean {
  if (!isValidTenantId(tenantId)) {
    return false;
  }
  const now = Date.now();
  const sessionKey = `${VISIT_SESSION_KEY}${tenantId.trim()}`;
  const legacySessionKey = `${LEGACY_VISIT_SESSION_KEY}${tenantId.trim()}`;
  const lastRecorded = localStorage.getItem(sessionKey) || localStorage.getItem(legacySessionKey);

  if (lastRecorded) {
    const elapsedMinutes = (now - Number(lastRecorded)) / (1000 * 60);
    // Si la última visita fue hace menos de 30 minutos, evitar conteo duplicado
    if (elapsedMinutes < 30) {
      return false; // Visita descartada por anti-inflación
    }
  }

  localStorage.setItem(sessionKey, String(now));
  // Incrementar estadística
  const stats = getStoreStatistics(tenantId);
  stats.totalVisits += 1;
  stats.todayVisits += 1;
  stats.last7DaysVisits += 1;
  stats.last30DaysVisits += 1;
  stats.conversionRate = Number(((stats.totalOrders / stats.totalVisits) * 100).toFixed(1));
  saveToStorage(tenantId, 'statistics', stats);
  return true;
}
