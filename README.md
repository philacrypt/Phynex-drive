# PHYNEX RIDE

PHYNEX RIDE is a Nairobi ride-booking service with separate customer, driver, and operations portals. It uses Firebase phone authentication, Google Maps, PostgreSQL, and optional M-Pesa STK Push payments.

## Requirements

- Node.js 20 or newer
- PostgreSQL 13 or newer, with a database created for the service
- A Firebase project with Phone authentication enabled
- A Google Maps Platform project with billing and the Maps JavaScript, Places, Directions, and Routes APIs enabled
- Safaricom Daraja credentials and a publicly reachable HTTPS callback URL to accept M-Pesa payments

Provider usage may incur charges. Set spending limits and restrict API keys in each provider console.

## Configure and run

1. Copy `.env.example` to `.env` and set `DATABASE_URL` to the PostgreSQL database.
2. Create a Firebase service account and store its JSON file outside version control. Set `FIREBASE_SERVICE_ACCOUNT_PATH` to its path. Configure the Firebase web settings in `.env`, enable phone sign-in, and add the deployed host to Firebase's authorized domains.
3. Set `ADMIN_UIDS` and `DRIVER_UIDS` to comma-separated Firebase user IDs provisioned by operations. All other authenticated accounts receive the customer role; users cannot assign themselves privileged roles.
4. Set `GOOGLE_MAPS_BROWSER_API_KEY` and `GOOGLE_MAPS_SERVER_API_KEY`. Restrict the browser key to your deployed website and Maps JavaScript/Places APIs; restrict the server key to the Routes API and your server IPs.
5. To enable payments, set the `MPESA_*` values and register `MPESA_CALLBACK_URL` with Safaricom. Use Daraja sandbox credentials for integration testing before enabling production transactions. Until configured, customers can choose cash.
6. From the project directory, run:

   ```powershell
   npm install
   npm start
   ```

The server listens on the configured `HOST` and `PORT`. The welcome page is `/`, the customer booking app is `/customer.html`, the driver portal is `/driver`, and operations is `/admin`. Each portal requires a verified phone account; driver and admin access is provisioned using the UID allowlists.

## Data and fares

On startup, the service applies `database/schema.sql` to the configured PostgreSQL database. The schema updates earlier vehicle categories to cars; historical fares and rides are retained. The server still serves the welcome and portal pages when PostgreSQL is unavailable, but API actions return an explicit service-not-ready error. The health endpoint reports the database state.

The customer can use their GPS position as pickup, choose another pickup or destination from Google Maps, or select a point directly on the map. The map displays the road route, and the fare estimate includes expected driving time. When available, customers can select a nearby online driver or let PHYNEX match them automatically; driver availability is rechecked during assignment. The trip screen counts elapsed time after the driver starts the trip. Route distance and fare are calculated server-side with Google Routes; the browser cannot set the booking price. Starting rates are KSh 50 per billable kilometre for a car (KSh 250 minimum) and KSh 30 per billable kilometre for a bike (KSh 150 minimum). Billing rounds route distance up to the next kilometre. Configure rates with `CAR_FARE_PER_KM_KSH`, `CAR_MINIMUM_FARE_KSH`, `BIKE_FARE_PER_KM_KSH`, and `BIKE_MINIMUM_FARE_KSH`; review and approve them before public launch.

## Before public launch

This repository is not, by itself, a production launch approval. Configure and test every provider in the actual deployment environment, use HTTPS, restrict and rotate credentials, verify database backups and monitoring, and complete operational testing of booking, cancellation, driver location, cash reconciliation, and M-Pesa callbacks. Publish reviewed privacy and service terms, arrange customer support and incident handling, and meet applicable Kenyan transport, payment, and data-protection requirements before accepting real passengers.
