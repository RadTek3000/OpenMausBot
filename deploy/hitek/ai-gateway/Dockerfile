FROM node:24-bookworm-slim
WORKDIR /app
COPY --chown=root:root deploy/hitek/ai-gateway/server.mjs ./server.mjs
USER node
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+ (process.env.PORT || 8080) + '/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
