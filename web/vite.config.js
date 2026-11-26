import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const server = process.env.ROVER_SERVER || 'http://localhost:5000';

// Dev only: print every picture request (who asked, what answer, how big, how long, and whether the browser gave up
// part-way). If a phone's picture never shows, this says whether its request reached the server at all.
const imageLog = {
  name: 'agrirover-image-log',
  apply: 'serve',
  configureServer(devServer) {
    devServer.middlewares.use((req, res, next) => {
      if (!/\.(png|jpe?g|webp|gif|svg|ico|webmanifest)(\?|$)/i.test(req.url ?? '')) return next();
      const started = Date.now();
      const who = (req.socket.remoteAddress ?? '?').replace('::ffff:', '');
      const browser = /Brave/i.test(req.headers['user-agent'] ?? '') ? 'Brave' : /Firefox/i.test(req.headers['user-agent'] ?? '') ? 'Firefox' : /Chrome/i.test(req.headers['user-agent'] ?? '') ? 'Chrome' : /Safari/i.test(req.headers['user-agent'] ?? '') ? 'Safari' : 'other';
      let done = false;
      res.on('finish', () => {
        done = true;
        console.log(`[img] ${who} (${browser}) ${req.method} ${req.url} -> ${res.statusCode} ${res.getHeader('content-length') ?? '?'} B in ${Date.now() - started} ms`);
      });
      res.on('close', () => {
        if (!done) console.log(`[img] ${who} (${browser}) ${req.method} ${req.url} -> CUT OFF after ${Date.now() - started} ms (the browser or the network gave up)`);
      });
      next();
    });
  },
};

// `npm run dev:https` serves the dashboard over https with a throwaway self-signed certificate.
// Phones only share GPS with https pages, so this is how precise field conditions reach them.
export default defineConfig(({ mode }) => ({
  plugins: [imageLog, react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: {
    host: true,
    proxy: {
      '/api': server,
      '/ws': { target: server, ws: true },
    },
  },
}));
