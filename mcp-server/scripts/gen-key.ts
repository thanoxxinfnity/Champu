#!/usr/bin/env node
/**
 * Mints one API key and prints both the raw key (give this to the tenant, once — it is not
 * recoverable afterwards) and its SHA-256 hash (put this in tenants.json's apiKeyHash field).
 * Deliberately independent of src/env.ts: provisioning a key should never require a full,
 * validated server configuration to be present.
 *
 * Usage: npx tsx scripts/gen-key.ts
 */
import { generateApiKey } from '../src/tenants/apiKey.ts';

const { key, hash } = generateApiKey();
console.log('API key (give this to the tenant — shown once):');
console.log(`  ${key}`);
console.log('\nSHA-256 hash (put this in tenants.json under "apiKeyHash"):');
console.log(`  ${hash}`);
