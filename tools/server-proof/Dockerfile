# The image for the one-off "Ready to send from a server" proof (spec 2026-10-17-ready-to-send.md): Chromium + a small server, our own fake form, no secrets, no user data.
FROM mcr.microsoft.com/playwright:v1.49.1-noble
WORKDIR /proof
COPY tools/server-proof/package.json ./
RUN npm install --no-audit --no-fund --omit=dev
COPY tools/server-proof/server.mjs tools/server-proof/fake.mjs tools/server-proof/apply.mjs ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.mjs"]
