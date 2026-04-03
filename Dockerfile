# ── HRBP Production Dockerfile ──────────────────────────────────────────────
# Multi-stage build for minimal production image.
#
# Build:   docker build -t hrbp .
# Run:     docker run -p 7001:7001 hrbp
# Dev:     docker compose up

FROM node:20-alpine AS base
WORKDIR /app
COPY package.json ./

# ── Production stage ────────────────────────────────────────────────────────
FROM base AS production
ENV NODE_ENV=production
# No npm install needed — zero external dependencies!
COPY src/ src/
COPY bin/ bin/

# Create non-root user for security.
RUN addgroup -g 1001 hrbp && \
    adduser -u 1001 -G hrbp -s /bin/sh -D hrbp && \
    chown -R hrbp:hrbp /app
USER hrbp

# Default HRBP RPC server port.
EXPOSE 7001

# Health check using the built-in CLI.
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD node -e "const net = require('net'); const s = net.connect(7001, '127.0.0.1', () => { s.end(); process.exit(0); }); s.on('error', () => process.exit(1));"

# Entry point — users override CMD to run their own service.
CMD ["node", "bin/hrbp.js", "--help"]
