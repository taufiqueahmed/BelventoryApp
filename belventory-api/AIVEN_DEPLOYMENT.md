# Aiven deployment preparation

This folder contains the API that Railway currently runs. The Aiven files prepare a separate Runtime deployment so Railway can remain available during the database copy and cutover.

## Aiven service constraints

- The free MySQL plan has 1 GB of storage and 1 GB of RAM, runs as a single node, and does not allow selecting a region. Check the Railway database size before copying it.
- Aiven Runtime is billed separately from MySQL. Confirm the exact Runtime plan and price in the Aiven Console before creating it.
- The free MySQL plan has no Runtime integration. Configure the API's `DATABASE_URL` as an application secret using the Aiven MySQL service URI.

## Application configuration

Select `compose.aiven.yaml` when deploying this folder from the repository. The API listens on port 3000 and allows the `https://belventory.web.app` origin, which also covers the `/dev` route because it has the same origin.

Set these values in the Aiven Runtime application settings; do not commit them to this repository:

- `DATABASE_URL`: Aiven MySQL service URI, including its `ssl-mode=REQUIRED` parameter.
- `MYSQL_SSL_CA`: the Aiven project's downloaded CA certificate in PEM format. The API verifies the certificate when this is set.
- `MYSQL_SSL_MODE`: `VERIFY_IDENTITY` when using the CA certificate.
- `JWT_SECRET`: the existing Railway value, copied directly between consoles without sharing it in chat. Keeping it preserves the signing key for existing sessions.

## Data copy and cutover

1. Check the source database's used storage. Do not start the copy if it exceeds the free service's 1 GB limit.
2. Create the Aiven MySQL service and Runtime application only after reviewing their exact locations, plan sizes, and costs.
3. Export the Railway database with a consistent MySQL dump, including all locations, users, password hashes, items, and soft-deleted items. Keep the dump private and remove it securely after the migration is confirmed.
4. Import the dump into the Aiven database, then verify row counts and representative records before pointing the API at it.
5. Deploy this API to Aiven Runtime and verify login, store selection, item updates, requests, and Recently Deleted restore behavior against the copied data.
6. Change the frontend API URL for both the production and `/dev` builds only after the Aiven API and data are verified. Keep Railway available as rollback until the Aiven cutover is stable.

