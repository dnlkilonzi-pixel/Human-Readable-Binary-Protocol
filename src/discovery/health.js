'use strict';

/**
 * HRBP Health Check
 *
 * Provides a standard health-check mechanism for HRBP servers.  The server
 * registers a built-in `__health` RPC method that returns status information.
 * Clients (or the registry sweeper) can call this to verify liveness.
 *
 * Usage:
 *
 *   const { attachHealthCheck } = require('./discovery/health');
 *
 *   const rpcServer = new HRBPRpcServer();
 *   attachHealthCheck(rpcServer, {
 *     serviceName: 'user-service',
 *     checks: {
 *       db: async () => { await db.ping(); return true; },
 *     },
 *   });
 */

const os = require('os');

/**
 * @typedef {Object} HealthCheckOptions
 * @property {string}                    [serviceName='unknown']
 * @property {Object<string, Function>}  [checks]  Named async functions returning boolean.
 */

/**
 * Attach a `__health` RPC handler to an `HRBPRpcServer`.
 *
 * The handler returns:
 *   {
 *     status: 'healthy' | 'degraded' | 'unhealthy',
 *     service: <string>,
 *     uptime: <number>,
 *     checks: { <name>: boolean, ... },
 *     timestamp: <number>,
 *     hostname: <string>,
 *     pid: <number>,
 *   }
 *
 * @param {import('../rpc/server').HRBPRpcServer} rpcServer
 * @param {HealthCheckOptions} [opts]
 */
function attachHealthCheck(rpcServer, opts = {}) {
  const { serviceName = 'unknown', checks = {} } = opts;
  const startedAt = Date.now();

  rpcServer.handle('__health', async () => {
    const results = {};
    let allOk = true;

    for (const [name, fn] of Object.entries(checks)) {
      try {
        results[name] = await fn();
        if (!results[name]) allOk = false;
      } catch (_) {
        results[name] = false;
        allOk = false;
      }
    }

    const hasChecks = Object.keys(checks).length > 0;
    let status = 'healthy';
    if (hasChecks && !allOk) {
      const anyOk = Object.values(results).some(Boolean);
      status = anyOk ? 'degraded' : 'unhealthy';
    }

    return {
      status,
      service: serviceName,
      uptime: Date.now() - startedAt,
      checks: results,
      timestamp: Date.now(),
      hostname: os.hostname(),
      pid: process.pid,
    };
  });
}

module.exports = { attachHealthCheck };
