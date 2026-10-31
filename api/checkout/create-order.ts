import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  'https://wuerdwkcpurbtcwyqjep.supabase.co';
const supabaseServiceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckoutDeliveryMethod = 'delivery' | 'pickup';

interface CheckoutShippingSettings {
  offersShipping: boolean;
  shippingType: 'free' | 'fixed';
  fixedCost: number;
  minOrderAmount: number;
  maxOrderAmount: number;
  availableDays: string[];
  availableHours: string;
}

interface ConfirmedCheckoutModifier {
  name: string;
  price: number;
}

interface ConfirmedCheckoutItem {
  productId: string;
  quantity: number;
  basePrice: number;
  unitPrice: number;
  selectedSize: string | null;
  selectedColor: { name: string; hex: string } | null;
  selectedModifiers: ConfirmedCheckoutModifier[];
}

// Fallback vigente del checkout para comercios que aún no persistieron stores.shipping.
const DEFAULT_CHECKOUT_SHIPPING: CheckoutShippingSettings = {
  offersShipping: true,
  shippingType: 'fixed',
  fixedCost: 15,
  minOrderAmount: 50,
  maxOrderAmount: 0,
  availableDays: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  availableHours: '11:00 a 20:30',
};

function isValidUUID(str: unknown): boolean {
  return typeof str === 'string' && UUID_REGEX.test(str.trim());
}

function isValidShippingSettings(value: unknown): value is CheckoutShippingSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;

  const settings = value as Record<string, unknown>;
  return (
    typeof settings.offersShipping === 'boolean' &&
    (settings.shippingType === 'free' || settings.shippingType === 'fixed') &&
    typeof settings.fixedCost === 'number' &&
    Number.isFinite(settings.fixedCost) &&
    settings.fixedCost >= 0 &&
    typeof settings.minOrderAmount === 'number' &&
    Number.isFinite(settings.minOrderAmount) &&
    settings.minOrderAmount >= 0 &&
    typeof settings.maxOrderAmount === 'number' &&
    Number.isFinite(settings.maxOrderAmount) &&
    settings.maxOrderAmount >= 0 &&
    Array.isArray(settings.availableDays) &&
    typeof settings.availableHours === 'string'
  );
}

function calculateShippingCost(
  deliveryMethod: CheckoutDeliveryMethod,
  subtotal: number,
  storedSettings: unknown
): { cost: number; available: boolean } {
  if (deliveryMethod === 'pickup') return { cost: 0, available: true };

  const settings = isValidShippingSettings(storedSettings)
    ? storedSettings
    : DEFAULT_CHECKOUT_SHIPPING;

  if (!settings.offersShipping) return { cost: 0, available: false };

  // Conserva la regla vigente del CheckoutModal: para tarifa fija, el umbral
  // minOrderAmount convierte el envío en gratuito; por debajo se cobra fixedCost.
  const cost =
    settings.shippingType === 'fixed' &&
    !(settings.minOrderAmount > 0 && subtotal >= settings.minOrderAmount)
      ? settings.fixedCost
      : 0;

  return { cost: Number(cost.toFixed(2)), available: true };
}

export default async function handler(req: any, res: any) {
  // Configuración de encabezados CORS y de respuesta
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

  // FASE 2: Únicamente se acepta el método POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Método no permitido. Solo se admite POST.',
    });
  }

  // Verificación estricta de credencial de servicio en entorno del servidor
  if (!supabaseServiceRoleKey) {
    console.error('[CentralBo Checkout API] Error crítico: SUPABASE_SERVICE_ROLE_KEY no está configurada.');
    return res.status(500).json({
      success: false,
      error: 'Error de configuración del servidor. No se pueden procesar pedidos en este momento.',
    });
  }

  // Parseo del cuerpo de la petición
  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json({
        success: false,
        error: 'Cuerpo de solicitud inválido. Se requiere formato JSON válido.',
      });
    }
  }
  body = body || {};

  const {
    orderId,
    tenantId,
    customerId,
    customerName,
    customerPhone,
    customerEmail,
    total,
    status,
    items,
    promoCode,
    deliveryMethod,
  } = body;

  // FASE 4: Validaciones básicas de estructura
  if (!orderId || !isValidUUID(orderId)) {
    return res.status(400).json({
      success: false,
      error: 'El identificador del pedido (orderId) es obligatorio y debe ser un UUID válido.',
    });
  }

  if (!tenantId || !isValidUUID(tenantId)) {
    return res.status(400).json({
      success: false,
      error: 'El identificador del comercio (tenantId) es obligatorio y debe ser un UUID válido.',
    });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'El pedido debe contener al menos un producto (items no puede estar vacío).',
    });
  }

  if (deliveryMethod !== 'delivery' && deliveryMethod !== 'pickup') {
    return res.status(400).json({
      success: false,
      error: 'La modalidad de entrega debe ser delivery o pickup.',
    });
  }

  const cleanTotal = Number(total);
  if (isNaN(cleanTotal) || !Number.isFinite(cleanTotal) || cleanTotal < 0) {
    return res.status(400).json({
      success: false,
      error: 'El total del pedido debe ser un número válido mayor o igual a 0.',
    });
  }

  // Normalización estricta de promoCode (opcional)
  let cleanPromoCode: string | null = null;
  if (typeof promoCode === 'string' && promoCode.trim().length > 0) {
    cleanPromoCode = promoCode.trim().toUpperCase();
  }

  const cleanCustomerName = typeof customerName === 'string' ? customerName.trim() : '';
  if (!cleanCustomerName || cleanCustomerName.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'El nombre del cliente es obligatorio y no puede exceder 100 caracteres.',
    });
  }

  const cleanCustomerPhone = typeof customerPhone === 'string' ? customerPhone.trim() : '';
  if (!cleanCustomerPhone || cleanCustomerPhone.length < 7 || cleanCustomerPhone.length > 25) {
    return res.status(400).json({
      success: false,
      error: 'El teléfono del cliente es obligatorio y debe tener entre 7 y 25 caracteres.',
    });
  }

  const cleanCustomerEmail =
    typeof customerEmail === 'string' && customerEmail.trim()
      ? customerEmail.trim().toLowerCase().slice(0, 120)
      : null;

  // El checkout público vigente opera como invitado. No permite asociar el pedido
  // a un UUID aportado por el comprador sin una identidad autenticada verificable.
  if (customerId !== null && customerId !== undefined && customerId !== '') {
    return res.status(400).json({
      success: false,
      error: 'El checkout público no admite asociar manualmente un identificador de cliente.',
    });
  }
  const cleanCustomerId = null;

  if (status !== null && status !== undefined && status !== 'pendiente') {
    return res.status(400).json({
      success: false,
      error: 'El estado inicial del pedido debe ser pendiente.',
    });
  }
  const cleanStatus = 'pendiente';

  // Validación de cada item
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const pid = it.productId || it.product_id;
    const qty = it.quantity;

    if (!isValidUUID(pid)) {
      return res.status(400).json({
        success: false,
        error: `El producto en posición ${i + 1} posee un identificador (productId) inválido.`,
      });
    }

    if (typeof qty !== 'number' || !Number.isSafeInteger(qty) || qty <= 0) {
      return res.status(400).json({
        success: false,
        error: `La cantidad del producto en posición ${i + 1} debe ser un número entero mayor a 0.`,
      });
    }
  }

  // Cliente privilegiado Supabase con Service Role
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // FASE 4 & 16: Validación del comercio (tenant)
    const { data: store, error: storeError } = await supabase
      .from('stores')
      .select('id, name, status, shipping')
      .eq('id', tenantId)
      .single();

    if (storeError || !store) {
      return res.status(404).json({
        success: false,
        error: 'El comercio indicado no existe.',
      });
    }

    if (store.status !== 'activo' && store.status !== 'prueba') {
      return res.status(400).json({
        success: false,
        error: 'El comercio no se encuentra disponible para recibir pedidos actualmente.',
      });
    }

    // FASE 5 & 16: Validación estricta de productos pertenecientes al tenant y obtención de precio canónico
    const uniqueProductIds = Array.from(
      new Set(items.map((it: any) => String(it.productId || it.product_id).trim()))
    );

    const { data: dbProducts, error: prodsError } = await supabase
      .from('products')
      .select('id, tenant_id, name, status, is_available, price, attributes')
      .eq('tenant_id', tenantId)
      .in('id', uniqueProductIds);

    if (prodsError) {
      console.error('[CentralBo Checkout API] Error al validar productos del tenant:', prodsError);
      return res.status(500).json({
        success: false,
        error: 'Error al verificar la disponibilidad de los productos del comercio.',
      });
    }

    const foundProductMap = new Map((dbProducts || []).map((p: any) => [p.id, p]));
    const missingOrInvalid = uniqueProductIds.filter((pid) => !foundProductMap.has(pid));

    if (missingOrInvalid.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Uno o más productos no existen o no pertenecen a este comercio.',
      });
    }

    if ((dbProducts || []).some((product: any) => product.status !== 'activo')) {
      return res.status(400).json({
        success: false,
        error: 'Uno o más productos no están activos para la venta.',
      });
    }

    if ((dbProducts || []).some((product: any) => product.is_available !== true)) {
      return res.status(400).json({
        success: false,
        error: 'Uno o más productos no se encuentran disponibles.',
      });
    }

    // Cálculo canónico del subtotal server-side. El precio base y los recargos
    // permitidos proceden exclusivamente del producto persistido.
    let serverItemsSubtotal = 0;
    const confirmedItems: ConfirmedCheckoutItem[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const pid = String(it.productId || it.product_id).trim();
      const qty = it.quantity;
      const dbProd = foundProductMap.get(pid);
      const rawCanonicalPrice = Number(dbProd.price);
      if (!Number.isFinite(rawCanonicalPrice) || rawCanonicalPrice < 0) {
        console.error('[CentralBo Checkout API] Precio canónico inválido para producto:', pid);
        return res.status(500).json({
          success: false,
          error: 'No se pudo verificar el precio de uno o más productos.',
        });
      }
      const canonicalPrice = Number(rawCanonicalPrice.toFixed(2));
      const attributes =
        dbProd.attributes && typeof dbProd.attributes === 'object' && !Array.isArray(dbProd.attributes)
          ? (dbProd.attributes as Record<string, unknown>)
          : {};

      let selectedSize: string | null = null;
      if (it.selectedSize !== null && it.selectedSize !== undefined && it.selectedSize !== '') {
        if (typeof it.selectedSize !== 'string') {
          return res.status(400).json({ success: false, error: 'La talla seleccionada no es válida.' });
        }
        const canonicalSizes = Array.isArray(attributes.sizes)
          ? attributes.sizes.filter((size): size is string => typeof size === 'string')
          : [];
        selectedSize = canonicalSizes.find((size) => size === it.selectedSize) || null;
        if (!selectedSize) {
          return res.status(400).json({
            success: false,
            error: 'La talla seleccionada no existe para este producto.',
          });
        }
      }

      let selectedColor: { name: string; hex: string } | null = null;
      if (it.selectedColor !== null && it.selectedColor !== undefined) {
        const requestedColorName =
          it.selectedColor && typeof it.selectedColor === 'object'
            ? it.selectedColor.name
            : null;
        if (typeof requestedColorName !== 'string' || !requestedColorName) {
          return res.status(400).json({ success: false, error: 'El color seleccionado no es válido.' });
        }
        const canonicalColors = Array.isArray(attributes.colors)
          ? attributes.colors.filter(
              (color): color is { name: string; hex?: string } =>
                Boolean(color) &&
                typeof color === 'object' &&
                typeof (color as any).name === 'string'
            )
          : [];
        const canonicalColor = canonicalColors.find((color) => color.name === requestedColorName);
        if (!canonicalColor) {
          return res.status(400).json({
            success: false,
            error: 'El color seleccionado no existe para este producto.',
          });
        }
        selectedColor = {
          name: canonicalColor.name,
          hex: typeof canonicalColor.hex === 'string' ? canonicalColor.hex : '#000000',
        };
      }

      const requestedModifiers =
        it.selectedModifiers === null || it.selectedModifiers === undefined
          ? []
          : it.selectedModifiers;
      if (!Array.isArray(requestedModifiers)) {
        return res.status(400).json({
          success: false,
          error: 'Los extras seleccionados tienen un formato inválido.',
        });
      }

      const canonicalModifierMap = new Map<string, ConfirmedCheckoutModifier>();
      let modifierConfigurationInvalid = false;
      const rawModifiers = Array.isArray(attributes.modifiers) ? attributes.modifiers : [];
      for (const rawModifier of rawModifiers) {
        if (
          !rawModifier ||
          typeof rawModifier !== 'object' ||
          typeof (rawModifier as any).name !== 'string' ||
          !(rawModifier as any).name ||
          typeof (rawModifier as any).price !== 'number' ||
          !Number.isFinite((rawModifier as any).price) ||
          (rawModifier as any).price < 0
        ) {
          modifierConfigurationInvalid = true;
          continue;
        }

        const name = (rawModifier as any).name as string;
        if (canonicalModifierMap.has(name)) {
          modifierConfigurationInvalid = true;
          continue;
        }
        canonicalModifierMap.set(name, {
          name,
          price: Number(((rawModifier as any).price as number).toFixed(2)),
        });
      }

      if (requestedModifiers.length > 0 && modifierConfigurationInvalid) {
        console.error('[CentralBo Checkout API] Configuración ambigua o inválida de extras:', pid);
        return res.status(500).json({
          success: false,
          error: 'No se pudo verificar la configuración de extras del producto.',
        });
      }

      const selectedModifiers: ConfirmedCheckoutModifier[] = [];
      const requestedModifierNames = new Set<string>();
      for (const requestedModifier of requestedModifiers) {
        const name =
          requestedModifier && typeof requestedModifier === 'object'
            ? requestedModifier.name
            : null;
        if (typeof name !== 'string' || !name || requestedModifierNames.has(name)) {
          return res.status(400).json({
            success: false,
            error: 'Uno o más extras seleccionados no son válidos.',
          });
        }
        requestedModifierNames.add(name);

        const canonicalModifier = canonicalModifierMap.get(name);
        if (!canonicalModifier) {
          return res.status(400).json({
            success: false,
            error: 'Uno o más extras seleccionados no existen para este producto.',
          });
        }
        selectedModifiers.push(canonicalModifier);
      }

      const modifiersTotal = selectedModifiers.reduce((sum, modifier) => sum + modifier.price, 0);
      const rawConfirmedUnitPrice = canonicalPrice + modifiersTotal;
      if (!Number.isFinite(rawConfirmedUnitPrice) || rawConfirmedUnitPrice < 0) {
        console.error('[CentralBo Checkout API] Precio final inválido para producto:', pid);
        return res.status(500).json({
          success: false,
          error: 'No se pudo verificar el precio final de uno o más productos.',
        });
      }
      const confirmedUnitPrice = Number(rawConfirmedUnitPrice.toFixed(2));
      serverItemsSubtotal += qty * confirmedUnitPrice;
      confirmedItems.push({
        productId: pid,
        quantity: qty,
        basePrice: canonicalPrice,
        unitPrice: confirmedUnitPrice,
        selectedSize,
        selectedColor,
        selectedModifiers,
      });
    }
    if (!Number.isFinite(serverItemsSubtotal) || serverItemsSubtotal < 0) {
      return res.status(400).json({
        success: false,
        error: 'El importe del pedido excede el rango permitido.',
      });
    }
    serverItemsSubtotal = Number(serverItemsSubtotal.toFixed(2));

    // FASE PROMOCIONES: Validación server-side y aplicación real del descuento (Parte 3)
    let discountAmount = 0;
    let promoRecord: any = null;

    if (cleanPromoCode) {
      // 1. Consultar public.promotions restringida simultáneamente por tenant_id y code
      const { data: promoData, error: promoError } = await supabase
        .from('promotions')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('code', cleanPromoCode)
        .maybeSingle();

      if (promoError) {
        console.error('[CentralBo Checkout API] Error al consultar promoción:', promoError);
        return res.status(500).json({
          success: false,
          error: 'Error al verificar el cupón de descuento en el comercio.',
        });
      }

      // Si no existe la promoción para este comercio
      if (!promoData) {
        return res.status(400).json({
          success: false,
          error: 'El cupón no es válido para este comercio.',
        });
      }

      // 2. Validar que la promoción esté activa
      if (!promoData.is_active) {
        return res.status(400).json({
          success: false,
          error: 'La promoción ya no se encuentra activa.',
        });
      }

      // 3. Validar vigencia de fechas (formato YYYY-MM-DD en hora de Bolivia / UTC)
      const now = new Date();
      const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/La_Paz' }).format(now);

      if (promoData.start_date && todayStr < promoData.start_date) {
        return res.status(400).json({
          success: false,
          error: 'La promoción todavía no ha iniciado.',
        });
      }

      if (promoData.end_date && todayStr > promoData.end_date) {
        return res.status(400).json({
          success: false,
          error: 'La promoción ha expirado.',
        });
      }

      // 4. Validar compra mínima requerida (min_purchase) contra subtotal del servidor
      const minPurchase = Number(promoData.min_purchase || 0);
      if (minPurchase > 0 && serverItemsSubtotal < minPurchase) {
        return res.status(400).json({
          success: false,
          error: `El pedido no alcanza la compra mínima de Bs ${minPurchase.toFixed(2)} requerida para este cupón.`,
        });
      }

      // 5. Calcular discountAmount de forma autoritativa en servidor
      const discountVal = Number(promoData.discount_value || 0);
      if (promoData.discount_type === 'percentage') {
        discountAmount = (serverItemsSubtotal * discountVal) / 100;
      } else if (promoData.discount_type === 'fixed') {
        discountAmount = discountVal;
      }

      // Limitar descuento a no exceder el subtotal de productos ni ser negativo
      discountAmount = Math.max(0, Math.min(discountAmount, serverItemsSubtotal));
      discountAmount = Number(discountAmount.toFixed(2));
      promoRecord = promoData;
    }

    // Costo de envío calculado exclusivamente desde stores.shipping y la regla
    // vigente del checkout. El importe enviado por el comprador no se utiliza.
    const shippingResult = calculateShippingCost(
      deliveryMethod,
      serverItemsSubtotal,
      store.shipping
    );
    if (!shippingResult.available) {
      return res.status(400).json({
        success: false,
        error: 'Este comercio no ofrece envío a domicilio. Selecciona pickup.',
      });
    }
    const cleanShippingCost = shippingResult.cost;

    // Determinación autoritativa del total confirmado basado estrictamente en el subtotal canónico
    const confirmedTotal = Number(
      Math.max(0, serverItemsSubtotal - discountAmount + cleanShippingCost).toFixed(2)
    );

    // FASE 6: Creación del registro en public.orders
    const cleanOrderId = String(orderId).trim();
    const cleanTenantId = String(tenantId).trim();

    const { data: orderData, error: orderInsertError } = await supabase
      .from('orders')
      .insert({
        id: cleanOrderId,
        tenant_id: cleanTenantId,
        customer_id: cleanCustomerId,
        customer_name: cleanCustomerName.slice(0, 100),
        customer_email: cleanCustomerEmail,
        customer_phone: cleanCustomerPhone.slice(0, 25),
        status: cleanStatus,
        total: confirmedTotal,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (orderInsertError || !orderData) {
      console.error('[CentralBo Checkout API] Error al insertar en orders:', orderInsertError);
      return res.status(500).json({
        success: false,
        error: 'No se pudo registrar la cabecera del pedido en el comercio.',
      });
    }

    // FASE 7: Creación en lote de public.order_items con precio base y extras canónicos.
    const orderItemsPayload = confirmedItems.map((item) => {
      return {
        tenant_id: cleanTenantId,
        order_id: cleanOrderId,
        product_id: item.productId,
        quantity: item.quantity,
        unit_price: item.unitPrice,
      };
    });

    const { error: itemsInsertError } = await supabase
      .from('order_items')
      .insert(orderItemsPayload);

    // FASE 8: Rollback real y verificado si falla la inserción de order_items
    if (itemsInsertError) {
      console.error(
        '[CentralBo Checkout API] Error al registrar order_items, iniciando rollback de order:',
        itemsInsertError
      );

      let rollbackVerified = false;
      try {
        const { error: deleteOrderError } = await supabase
          .from('orders')
          .delete()
          .eq('id', cleanOrderId)
          .eq('tenant_id', cleanTenantId);

        if (!deleteOrderError) {
          const { data: verifyRow } = await supabase
            .from('orders')
            .select('id')
            .eq('id', cleanOrderId)
            .maybeSingle();

          if (!verifyRow) {
            rollbackVerified = true;
            console.log(
              `[CentralBo Checkout API] Rollback verificado exitosamente para orden huérfana ${cleanOrderId}`
            );
          }
        }
      } catch (rbEx) {
        console.error('[CentralBo Checkout API] Excepción al ejecutar rollback de orden:', rbEx);
      }

      if (rollbackVerified) {
        return res.status(500).json({
          success: false,
          error:
            'No se pudo registrar el detalle de los productos del pedido. La operación fue revertida de forma segura.',
        });
      } else {
        console.error(
          `[CentralBo Checkout API] ALERTA CRÍTICA: Fallo al confirmar eliminación de orden huérfana ${cleanOrderId}`
        );
        return res.status(500).json({
          success: false,
          error: 'No se pudo completar la creación del pedido.',
        });
      }
    }

    // FASE 9: Respuesta exitosa estructurada con montos confirmados autoritativamente
    return res.status(200).json({
      success: true,
      message: 'Pedido registrado con éxito',
      orderId: cleanOrderId,
      order: orderData,
      confirmedSubtotal: Number(serverItemsSubtotal.toFixed(2)),
      discountAmount: Number(discountAmount.toFixed(2)),
      confirmedShippingCost: cleanShippingCost,
      confirmedTotal: confirmedTotal,
      confirmedItems,
      appliedPromotion: promoRecord
        ? {
            id: promoRecord.id,
            code: promoRecord.code,
            discountType: promoRecord.discount_type,
            discountValue: Number(promoRecord.discount_value),
            minPurchase: Number(promoRecord.min_purchase || 0),
          }
        : null,
    });
  } catch (error: any) {
    console.error('[CentralBo Checkout API] Excepción no controlada en endpoint checkout:', error);
    return res.status(500).json({
      success: false,
      error: 'Error interno del servidor al procesar el pedido.',
    });
  }
}
