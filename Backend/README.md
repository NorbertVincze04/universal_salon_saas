# Backend

This is the backend service for the template-driven app.

## Features

- Node.js + TypeScript server
- Express-style API setup
- PostgreSQL integration support
- Environment-based configuration

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file in this directory and add your environment variables, for example:

   ```env
    PORT=3000

    DB_HOST=localhost
    DB_PORT=5432
    DB_USER=postgres
    DB_PASSWORD=your_password
    DB_NAME=your_db_name

    JWT_SECRET=your_long_random_generated_code # at least 32 characters
    JWT_EXPIRES_IN=1d # can be changed
   CORS_ORIGIN=http://localhost:4200
   # Set to the number of reverse proxies in front of the API (e.g. 1) in
   # production, so rate limiting sees real client IPs. Leave unset locally.
   TRUST_PROXY=
   ```

3. Start the development server:
   ```bash
   npm start
   ```

## Project Structure

```bash
Backend/
├── src/
├── index.ts
├── package.json
├── tsconfig.json
├── .gitignore
├── README.md
```

## Scripts

- `npm start` — runs the backend server
- `npm run build` — compiles TypeScript

## Notes

Update the environment variables and database configuration to match your local or deployment setup.

## Database setup

Open `sql/001_multi_tenant_schema.sql` in pgAdmin Query Tool and execute it against
your application database. It creates the tenant-aware `shops`, `shop_domains`, and
`users` tables and seeds the `default` tenant for `localhost`.

For appointments and barber profiles, execute the migrations in order after the
initial schema:

```text
sql/002_profile_and_appointments.sql
sql/003_profile_image_position.sql
sql/004_barber_scheduling_and_guest_appointments.sql
sql/005_barber_services.sql
sql/006_bucharest_timezone.sql
sql/007_shared_services_compatibility.sql
sql/008_default_tenant_config.sql
sql/009_client_reviews.sql
sql/010_appointment_change_requests.sql
sql/011_phone_number_integrity.sql
sql/012_preserve_completed_appointments_on_profile_delete.sql
sql/013_notifications.sql
sql/014_notification_read_at.sql
sql/015_barber_ratings.sql
sql/016_update_default_location_cluj_napoca.sql
sql/017_barber_photo_gallery.sql
sql/018_barber_gallery_photo_position.sql
sql/019_owner_roles.sql
sql/020_barber_management_notes.sql
sql/021_layout_feature_toggles.sql
sql/022_password_reset_codes.sql
sql/023_password_reset_tokens.sql
sql/024_auth_hardening.sql
sql/025_tenant_integrity.sql
```

The later migrations create working hours, blocked periods, service prices,
barber-owned services, guest booking fields, appointment overlap protection,
Romanian local-time booking, shared-service compatibility, the default
tenant content used by the frontend, customer cancel/reschedule requests,
in-app notifications, customer ratings of barbers, barber photo galleries, and
gallery photo preview positioning, multi-role accounts, private barber management notes,
the quick-rebook/notifications/booking-page feature toggles, and email-based
password reset codes.

## Password reset emails

Forgot-password codes are sent through `MailService`, which uses SMTP when configured
via these optional `.env` variables:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM=no-reply@yoursalon.com
SMTP_SECURE=false
```

If `SMTP_HOST` is not set, the reset code is logged to the console instead of
emailed, so local development works without SMTP credentials.

To promote a user to admin for a tenant by email, run:

```sql
UPDATE users
SET role = 'ADMIN',
      roles = ARRAY['ADMIN']::TEXT[],
      updated_at = NOW()
WHERE shop_id = (SELECT id FROM shops WHERE slug = 'default')
   AND lower(email) = lower('admin@example.com');
```

If that admin should also appear and behave as a barber, use:

```sql
UPDATE users
SET role = 'ADMIN',
      roles = ARRAY['ADMIN', 'BARBER']::TEXT[],
      updated_at = NOW()
WHERE shop_id = (SELECT id FROM shops WHERE slug = 'default')
   AND lower(email) = lower('admin@example.com');
```

The `shops.config` JSONB column stores the website configuration. To add another
tenant, insert a shop and map one or more domains:

```sql
INSERT INTO shops (slug, name, config)
VALUES ('acme', 'Acme Salon', '{"tenantId":"acme","name":"Acme Salon"}');

INSERT INTO shop_domains (shop_id, domain, is_primary)
SELECT id, 'acme.example.com', TRUE FROM shops WHERE slug = 'acme';
```

## Tenant routing

The public tenant config endpoint is `GET /api/tenant/config`. The frontend sends
`X-Tenant-Domain` with the browser hostname. Authentication requests send
`X-Tenant-Slug`, which is resolved against the same tenant row.

Every authentication request must include the active salon slug:

```http
X-Tenant-Slug: joesbarber
```

The backend resolves that value against an active row in `shops`, then scopes every user lookup and insert by the resolved `shop_id`. A user can therefore use the same email address at different salons.

Custom domains are stored in `shop_domains`, so no reverse-proxy mapping is needed.
For a frontend and API on different hosts, keep the browser domain header on the
tenant config request and use the returned slug for auth. Do not accept a client-
supplied `shop_id`; only the server-resolved shop is trusted.

Public registration creates a `CUSTOMER`. `ADMIN` and `BARBER` accounts should be provisioned by a trusted shop-management flow.

Authenticated requests re-check the user's current `role` and `roles` values in
the database. If either changes from the values in the JWT, the API returns `401`
and the frontend clears the session, requiring the user to log in again.
