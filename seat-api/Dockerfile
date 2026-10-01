# The recipe for the seat-api image. Each line is one step (a "layer").

# 1. Start from an existing image that already has Node.js on a tiny Linux.
FROM node:22-alpine

# 2. Everything below happens inside this folder in the image.
WORKDIR /app

# 3. Copy ONLY package.json first, then install dependencies.
#    Docker caches each step: if package.json didn't change, the next build
#    skips the slow npm install and reuses the cached layer.
COPY package.json ./
RUN npm install --omit=dev

# 4. Now copy the actual code (this changes often, so it comes last).
COPY server.js race.js ./

# 5. Document the port, and the command a container runs when it starts.
EXPOSE 3000
CMD ["node", "server.js"]
