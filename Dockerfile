FROM mcr.microsoft.com/playwright:v1.40.0-jammy

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Install Playwright browsers
RUN npx playwright install chromium
RUN npx playwright install-deps

# Copy all your code
COPY . .

# This is the port for health checks
EXPOSE 3000

# Start your scraper
CMD ["node", "index.js"]
