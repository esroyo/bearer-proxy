import { dotenvLoad, serve } from '../deps.ts';

import { requestHandler } from './request-handler.ts';

dotenvLoad({ export: true });

serve(requestHandler, { port: 8000 });
