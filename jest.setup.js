/**
 * Jest Setup File
 * Carga variables de entorno del archivo .env antes de ejecutar tests.
 *
 * Los tests de integración (`*.integration.spec.js`) requieren un .env real
 * y no corren en el job de verify.
 */

require('dotenv').config({ quiet: true });
