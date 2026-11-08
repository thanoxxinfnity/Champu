# Chomugiri Terminal Bridge in a container: the bridge + a real Chromium + a private virtual screen (Xvfb) for computer use.
# Runs as an ordinary user, so the browser starts cleanly. Works on a VPS, with `docker run`, or as a Hugging Face Docker Space.
#
#   docker build -f agent/docker/Dockerfile -t chomugiri-bridge .
#   docker run -p 7717:7860 -e CHOMUGIRI_TOKEN=pick-a-long-secret chomugiri-bridge
#
# Hugging Face Space: put this Dockerfile and the agent/ folder in the Space, set `app_port: 7860` in its README header, and add a
# Space secret CHOMUGIRI_TOKEN. The Space URL plus "#<token>" is what you paste into Chomugiri.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium xvfb xdotool imagemagick ca-certificates curl git python3 \
      fonts-liberation fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*

# An ordinary user: files, the browser profile and the workspace belong to it, not to root.
RUN useradd -m -u 1000 app
USER app
WORKDIR /home/app

COPY --chown=app:app agent/*.mjs ./agent/

# Warm the browser server once so the first job does not wait for a download.
RUN npx -y @playwright/mcp@0.0.83 --help > /dev/null 2>&1 || true

ENV CHOMUGIRI_HOST=0.0.0.0 \
    CHOMUGIRI_PORT=7860 \
    CHOMUGIRI_WORKSPACE=/home/app/workspace \
    CHOMUGIRI_BROWSER_CHROMIUM=/usr/bin/chromium \
    CHOMUGIRI_SUPERVISED=1
EXPOSE 7860

# The bridge starts the private screen and the visible browser itself when a job asks for desktop mode.
CMD ["node", "agent/chomugiri-agent.mjs"]
