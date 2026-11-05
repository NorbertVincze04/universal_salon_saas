-- Database-level tenant isolation.
--
-- Every tenant-owned row carries shop_id, but the original foreign keys only
-- referenced users(id) / services(id) / appointments(id). That let a row in
-- shop A point at a barber, customer, service or appointment that belongs to
-- shop B if application code ever slipped. These composite foreign keys make
-- the database itself reject any cross-tenant reference.
--
-- The existing single-column foreign keys are kept, so delete behaviour
-- (CASCADE / RESTRICT / SET NULL) is unchanged; the composite keys mirror the
-- same actions. Safe to re-run.
--
-- If a VALIDATE step at the bottom fails, existing data already contains a
-- cross-tenant reference. Find it with, for example:
--   SELECT a.id FROM appointments a JOIN users u ON u.id = a.barber_id
--   WHERE u.shop_id <> a.shop_id;

CREATE OR REPLACE FUNCTION pg_temp.add_constraint_if_missing(
  target regclass,
  constraint_name text,
  definition text
) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = constraint_name AND conrelid = target
  ) THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', target, constraint_name, definition);
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Composite keys the foreign keys below point at.
SELECT pg_temp.add_constraint_if_missing('users', 'users_shop_id_id_key', 'UNIQUE (shop_id, id)');
SELECT pg_temp.add_constraint_if_missing('services', 'services_shop_id_id_key', 'UNIQUE (shop_id, id)');
SELECT pg_temp.add_constraint_if_missing('appointments', 'appointments_shop_id_id_key', 'UNIQUE (shop_id, id)');

-- Added NOT VALID first so new writes are enforced immediately; validated below.
SELECT pg_temp.add_constraint_if_missing('services', 'services_tenant_barber_fkey',
  'FOREIGN KEY (shop_id, barber_id) REFERENCES users(shop_id, id) ON DELETE CASCADE NOT VALID');

SELECT pg_temp.add_constraint_if_missing('appointments', 'appointments_tenant_barber_fkey',
  'FOREIGN KEY (shop_id, barber_id) REFERENCES users(shop_id, id) ON DELETE RESTRICT NOT VALID');
SELECT pg_temp.add_constraint_if_missing('appointments', 'appointments_tenant_service_fkey',
  'FOREIGN KEY (shop_id, service_id) REFERENCES services(shop_id, id) ON DELETE RESTRICT NOT VALID');

SELECT pg_temp.add_constraint_if_missing('barber_working_hours', 'barber_working_hours_tenant_barber_fkey',
  'FOREIGN KEY (shop_id, barber_id) REFERENCES users(shop_id, id) ON DELETE CASCADE NOT VALID');
SELECT pg_temp.add_constraint_if_missing('barber_blocked_periods', 'barber_blocked_periods_tenant_barber_fkey',
  'FOREIGN KEY (shop_id, barber_id) REFERENCES users(shop_id, id) ON DELETE CASCADE NOT VALID');
SELECT pg_temp.add_constraint_if_missing('barber_gallery_photos', 'barber_gallery_photos_tenant_barber_fkey',
  'FOREIGN KEY (shop_id, barber_id) REFERENCES users(shop_id, id) ON DELETE CASCADE NOT VALID');

SELECT pg_temp.add_constraint_if_missing('barber_ratings', 'barber_ratings_tenant_barber_fkey',
  'FOREIGN KEY (shop_id, barber_id) REFERENCES users(shop_id, id) ON DELETE CASCADE NOT VALID');
SELECT pg_temp.add_constraint_if_missing('barber_ratings', 'barber_ratings_tenant_customer_fkey',
  'FOREIGN KEY (shop_id, customer_id) REFERENCES users(shop_id, id) ON DELETE CASCADE NOT VALID');

SELECT pg_temp.add_constraint_if_missing('appointment_change_requests', 'appointment_change_requests_tenant_appointment_fkey',
  'FOREIGN KEY (shop_id, appointment_id) REFERENCES appointments(shop_id, id) ON DELETE CASCADE NOT VALID');
SELECT pg_temp.add_constraint_if_missing('appointment_change_requests', 'appointment_change_requests_tenant_requester_fkey',
  'FOREIGN KEY (shop_id, requested_by) REFERENCES users(shop_id, id) ON DELETE CASCADE NOT VALID');

SELECT pg_temp.add_constraint_if_missing('notifications', 'notifications_tenant_recipient_fkey',
  'FOREIGN KEY (shop_id, recipient_id) REFERENCES users(shop_id, id) ON DELETE CASCADE NOT VALID');

SELECT pg_temp.add_constraint_if_missing('password_reset_codes', 'password_reset_codes_tenant_user_fkey',
  'FOREIGN KEY (shop_id, user_id) REFERENCES users(shop_id, id) ON DELETE CASCADE NOT VALID');

-- appointments.customer_id is ON DELETE SET NULL. A composite SET NULL would
-- also try to null shop_id (needs PostgreSQL 15+ column lists), so the
-- customer's tenant is enforced with a trigger instead.
CREATE OR REPLACE FUNCTION enforce_appointment_customer_tenant()
RETURNS trigger AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = NEW.customer_id AND u.shop_id = NEW.shop_id
  ) THEN
    RAISE EXCEPTION 'Appointment customer % does not belong to shop %', NEW.customer_id, NEW.shop_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointments_customer_tenant_check ON appointments;
CREATE TRIGGER appointments_customer_tenant_check
  BEFORE INSERT OR UPDATE OF customer_id, shop_id ON appointments
  FOR EACH ROW EXECUTE FUNCTION enforce_appointment_customer_tenant();

-- Check existing rows. Fails loudly if any cross-tenant reference already exists.
ALTER TABLE services VALIDATE CONSTRAINT services_tenant_barber_fkey;
ALTER TABLE appointments VALIDATE CONSTRAINT appointments_tenant_barber_fkey;
ALTER TABLE appointments VALIDATE CONSTRAINT appointments_tenant_service_fkey;
ALTER TABLE barber_working_hours VALIDATE CONSTRAINT barber_working_hours_tenant_barber_fkey;
ALTER TABLE barber_blocked_periods VALIDATE CONSTRAINT barber_blocked_periods_tenant_barber_fkey;
ALTER TABLE barber_gallery_photos VALIDATE CONSTRAINT barber_gallery_photos_tenant_barber_fkey;
ALTER TABLE barber_ratings VALIDATE CONSTRAINT barber_ratings_tenant_barber_fkey;
ALTER TABLE barber_ratings VALIDATE CONSTRAINT barber_ratings_tenant_customer_fkey;
ALTER TABLE appointment_change_requests VALIDATE CONSTRAINT appointment_change_requests_tenant_appointment_fkey;
ALTER TABLE appointment_change_requests VALIDATE CONSTRAINT appointment_change_requests_tenant_requester_fkey;
ALTER TABLE notifications VALIDATE CONSTRAINT notifications_tenant_recipient_fkey;
ALTER TABLE password_reset_codes VALIDATE CONSTRAINT password_reset_codes_tenant_user_fkey;
