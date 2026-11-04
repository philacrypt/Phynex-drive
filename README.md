# PHYNEX RIDE

PHYNEX RIDE is a Kilifi County ride-booking service with separate customer, driver, and operations portals. Its map opens over Kilifi County and lets riders search for locations worldwide. It uses Firebase phone authentication, Google Maps, PostgreSQL, and optional M-Pesa STK Push payments.

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

## Deploy to Render

The root `render.yaml` defines a Node web service that serves the mobile-friendly welcome and booking pages over HTTPS. To create it, open the [Render Blueprint setup](https://render.com/deploy?repo=https://github.com/philacrypt/Phynex-drive) and create the `phynex-ride` service from the `main` branch. Render assigns the public `onrender.com` URL after the first deploy; use that URL on your phone.

The pages can load before the backend providers are configured, but ride booking requires production PostgreSQL (`DATABASE_URL`), Firebase web configuration and service-account secret file (`/etc/secrets/firebase-service-account.json`), and the Google Maps server key. Configure these in the Render service's Environment and Secret Files settings, then redeploy. Add the final Render hostname to Firebase's authorized domains and to the Google Maps browser-key website restrictions. Do not put provider credentials in this repository.

## Data and fares

On startup, the service applies `database/schema.sql` to the configured PostgreSQL database. The schema updates earlier vehicle categories to cars; historical fares and rides are retained. The server still serves the welcome and portal pages when PostgreSQL is unavailable, but API actions return an explicit service-not-ready error. The health endpoint reports the database state.

The customer can use their GPS position as pickup, choose another pickup or destination from Google Maps, search for worldwide locations, or select a point directly on the map. The booking map opens centered on Kilifi County. The trip map follows the driver's reported GPS position and shows directional green arrows on the remaining road route after the driver starts the ride. Location permission is requested only after the rider taps Use my current location. The fare estimate includes expected driving time. When available, customers can select a nearby online driver or let PHYNEX match them automatically; driver availability is rechecked during assignment. The trip screen counts elapsed time after the driver starts the trip. Route distance and fare are calculated server-side with Google Routes; the browser cannot set the booking price. If the Google Maps browser key is unavailable, the map uses OpenStreetMap and the public OSRM demo router for road geometry; use a hosted routing provider for production traffic. Starting rates are KSh 50 per billable kilometre for a car (KSh 250 minimum) and KSh 30 per billable kilometre for a bike (KSh 150 minimum). Billing rounds route distance up to the next kilometre. Configure rates with `CAR_FARE_PER_KM_KSH`, `CAR_MINIMUM_FARE_KSH`, `BIKE_FARE_PER_KM_KSH`, and `BIKE_MINIMUM_FARE_KSH`; review and approve them before public launch.

## Before public launch

This repository is not, by itself, a production launch approval. Configure and test every provider in the actual deployment environment, use HTTPS, restrict and rotate credentials, verify database backups and monitoring, and complete operational testing of booking, cancellation, driver location, cash reconciliation, and M-Pesa callbacks. Publish reviewed privacy and service terms, arrange customer support and incident handling, and meet applicable Kenyan transport, payment, and data-protection requirements before accepting real passengers.
