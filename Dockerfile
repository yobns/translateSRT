FROM node:20-bookworm AS base

# Install Python for the translator CLI
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Node deps first (better layer caching)
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN npm ci || npm install

# Copy app source
COPY . .

# Install Python dependencies
RUN pip3 install --no-cache-dir -r translate/requirements.txt

# Build Next.js
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "run", "start"]
