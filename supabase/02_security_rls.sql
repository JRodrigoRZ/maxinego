-- ============================================================================
-- FASE 1: BASE DE DATOS Y SEGURIDAD — SAAS MARKETPLACE VERTICALIZADO
-- 02_security_rls.sql: Row Level Security (RLS) y Políticas Multi-Tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. FUNCIONES HELPER DE SEGURIDAD (SECURITY DEFINER)
-- Se ejecutan con los privilegios del creador para evitar bucles recursivos en RLS.
-- ----------------------------------------------------------------------------

-- Retorna el conjunto de tenant_id asociados al usuario autenticado actual
CREATE OR REPLACE FUNCTION get_user_tenant_ids()
RETURNS TABLE (tenant_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN QUERY
    SELECT su.tenant_id
    FROM store_users su
    WHERE su.user_id = auth.uid()
      AND su.is_active = TRUE;
END;
$$;

-- Verifica si el usuario actual es SuperAdmin de la plataforma
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
STABLE
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.store_users su
        WHERE su.user_id = auth.uid()
          AND su.role = 'superadmin'
          AND su.is_active = TRUE
    );
END;
$$;

-- Verifica si el usuario actual es administrador de un comercio específico
CREATE OR REPLACE FUNCTION is_tenant_admin(check_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN (
        is_superadmin()
        OR EXISTS (
            SELECT 1
            FROM store_users su
            WHERE su.tenant_id = check_tenant_id
              AND su.user_id = auth.uid()
              AND su.role IN ('admin', 'superadmin')
              AND su.is_active = TRUE
        )
    );
END;
$$;

-- Verifica si el usuario actual pertenece a un comercio específico (cualquier rol activo)
CREATE OR REPLACE FUNCTION is_tenant_member(check_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
    RETURN (
        is_superadmin()
        OR EXISTS (
            SELECT 1
            FROM store_users su
            WHERE su.tenant_id = check_tenant_id
              AND su.user_id = auth.uid()
              AND su.is_active = TRUE
        )
    );
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. ACTIVACIÓN DE ROW LEVEL SECURITY (RLS) EN TODAS LAS TABLAS
-- ----------------------------------------------------------------------------
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE store_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 3. POLÍTICAS: COMERCIOS (stores)
-- ----------------------------------------------------------------------------

-- Público: Puede consultar comercios activos o en prueba para mostrarlos en el marketplace
CREATE POLICY "stores_public_read"
    ON stores FOR SELECT
    TO anon, authenticated
    USING (status IN ('activo', 'prueba'));

-- Administrador del comercio: Puede consultar los datos completos de su comercio
CREATE POLICY "stores_tenant_select"
    ON stores FOR SELECT
    TO authenticated
    USING (id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Administrador del comercio: Puede actualizar la información de su propio comercio
CREATE POLICY "stores_tenant_update"
    ON stores FOR UPDATE
    TO authenticated
    USING (id IN (SELECT get_user_tenant_ids()) OR is_superadmin())
    WITH CHECK (id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- SuperAdmin: Gestión total de inserción y borrado
CREATE POLICY "stores_superadmin_insert"
    ON stores FOR INSERT
    TO authenticated
    WITH CHECK (public.is_superadmin());

CREATE POLICY "stores_superadmin_delete"
    ON stores FOR DELETE
    TO authenticated
    USING (is_superadmin());

-- ----------------------------------------------------------------------------
-- 4. POLÍTICAS: USUARIOS DEL COMERCIO (store_users)
-- Ningún usuario no autenticado ni de otro comercio puede ver esta información.
-- ----------------------------------------------------------------------------

-- Miembros del comercio: Solo pueden consultar usuarios de su mismo comercio
CREATE POLICY "store_users_tenant_select"
    ON store_users FOR SELECT
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Las escrituras de asociaciones se realizan exclusivamente desde endpoints
-- autorizados que usan service_role. RLS no concede escritura directa al cliente.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.store_users
    FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, tenant_id, user_id, role, full_name, email, is_active, created_at, updated_at),
       UPDATE (id, tenant_id, user_id, role, full_name, email, is_active, created_at, updated_at)
    ON TABLE public.store_users
    FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.store_users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.store_users TO service_role;

-- ----------------------------------------------------------------------------
-- 5. POLÍTICAS: CATEGORÍAS (categories)
-- ----------------------------------------------------------------------------

-- Público: Puede consultar categorías activas de comercios habilitados
CREATE POLICY "categories_public_read"
    ON categories FOR SELECT
    TO anon, authenticated
    USING (
        status = 'activo'
        AND EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = categories.tenant_id
              AND s.status IN ('activo', 'prueba')
        )
    );

-- Miembros del comercio: Lectura de todas sus categorías (activas o inactivas)
CREATE POLICY "categories_tenant_select"
    ON categories FOR SELECT
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Miembros del comercio: Creación de categorías para su propio tenant
CREATE POLICY "categories_tenant_insert"
    ON categories FOR INSERT
    TO authenticated
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Miembros del comercio: Modificación exclusiva de categorías propias
CREATE POLICY "categories_tenant_update"
    ON categories FOR UPDATE
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin())
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Miembros del comercio: Eliminación de categorías propias
CREATE POLICY "categories_tenant_delete"
    ON categories FOR DELETE
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- ----------------------------------------------------------------------------
-- 6. POLÍTICAS: PRODUCTOS (products)
-- ----------------------------------------------------------------------------

-- Público: Consulta de productos activos y disponibles en tiendas habilitadas
CREATE POLICY "products_public_read"
    ON products FOR SELECT
    TO anon, authenticated
    USING (
        status = 'activo'
        AND is_available = TRUE
        AND EXISTS (
            SELECT 1 FROM stores s
            WHERE s.id = products.tenant_id
              AND s.status IN ('activo', 'prueba')
        )
    );

-- Miembros del comercio: Lectura de todo el inventario de su comercio
CREATE POLICY "products_tenant_select"
    ON products FOR SELECT
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Miembros del comercio: Inserción de productos exclusivamente en su tenant_id
CREATE POLICY "products_tenant_insert"
    ON products FOR INSERT
    TO authenticated
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Miembros del comercio: Actualización exclusiva de sus productos
CREATE POLICY "products_tenant_update"
    ON products FOR UPDATE
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin())
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Miembros del comercio: Eliminación de sus propios productos
CREATE POLICY "products_tenant_delete"
    ON products FOR DELETE
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- ----------------------------------------------------------------------------
-- 7. POLÍTICAS: PEDIDOS (orders)
-- ----------------------------------------------------------------------------

-- Miembros del comercio: Ver todos los pedidos de su comercio
CREATE POLICY "orders_tenant_select"
    ON orders FOR SELECT
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Miembros del comercio: Actualizar estado de pedidos de su comercio
CREATE POLICY "orders_tenant_update"
    ON orders FOR UPDATE
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin())
    WITH CHECK (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Clientes autenticados: Ver únicamente sus propios pedidos
CREATE POLICY "orders_customer_select"
    ON orders FOR SELECT
    TO authenticated
    USING (customer_id = auth.uid());

-- La creación de pedidos se realiza mediante /api/checkout/create-order con
-- service_role; los clientes no insertan cabeceras directamente.
REVOKE INSERT ON TABLE public.orders FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, tenant_id, customer_id, customer_name, customer_email,
               customer_phone, status, total, created_at, updated_at)
    ON TABLE public.orders
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO service_role;

-- ----------------------------------------------------------------------------
-- 8. POLÍTICAS: DETALLE DE PEDIDOS (order_items)
-- ----------------------------------------------------------------------------

-- Miembros del comercio: Ver los ítems de los pedidos de su propio comercio
CREATE POLICY "order_items_tenant_select"
    ON order_items FOR SELECT
    TO authenticated
    USING (tenant_id IN (SELECT get_user_tenant_ids()) OR is_superadmin());

-- Clientes autenticados: Ver ítems de sus propios pedidos
CREATE POLICY "order_items_customer_select"
    ON order_items FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM orders o
            WHERE o.id = order_items.order_id
              AND o.customer_id = auth.uid()
        )
    );

-- Los artículos se crean junto con la cabecera desde el endpoint servidor.
REVOKE INSERT ON TABLE public.order_items FROM PUBLIC, anon, authenticated;
REVOKE INSERT (id, tenant_id, order_id, product_id, quantity, unit_price, created_at)
    ON TABLE public.order_items
    FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.order_items TO service_role;
