/**
 * Jest Setup File
 * Carga variables de entorno del archivo .env antes de ejecutar tests.
 *
 * Cuando no hay .env (CI corre `test:unit` sin servicios ni secrets), se
 * inyectan valores dummy para las variables que algunos módulos exigen en
 * import-time (p. ej. helius-client lanza sin HELIUS_API_KEY). Los tests de
 * integración (`*.integration.spec.js`) requieren un .env real y no corren
 * en el job de verify.
 */

require('dotenv').config({ quiet: true });

process.env.HELIUS_API_KEY ||= 'test-helius-key';
process.env.JUPITER_PRICE_URL ||= 'https://jupiter.test/price/v3';
process.env.JUPITER_SWAP_URL ||= 'https://jupiter.test/ultra/v1';
