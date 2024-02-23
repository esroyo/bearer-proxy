import {
    _internals,
    cloneHeaders,
    createFinalResponse,
    denyHeaders,
    retrieveCache,
} from './utils.ts';
import { denoKv } from './services.ts';
import { ScopedPerformance } from '../deps.ts';

export async function requestHandler(
    req: Request,
): Promise<Response> {
    const performance = new ScopedPerformance();
    performance.mark('total');
    const BASE_PATH = Deno.env.get('BASE_PATH');
    const CACHE = Deno.env.get('CACHE') === 'true';
    const UPSTREAM_ORIGIN = Deno.env.get('UPSTREAM_ORIGIN');
    const AUTH_TOKEN = Deno.env.get('AUTH_TOKEN');
    const UPSTREAM_AUTH_TOKEN = Deno.env.get('UPSTREAM_AUTH_TOKEN');
    if (
        AUTH_TOKEN &&
        req.headers.get('authorization') !== `Bearer ${AUTH_TOKEN}`
    ) {
        return new Response('', { status: 401, statusText: 'Unauthorized' });
    }

    const selfUrl = new URL(req.url);
    const basePath = `/${BASE_PATH}/`.replace(/\/+/g, '/');
    const upstreamOrigin = `${UPSTREAM_ORIGIN}/`.replace(/\/+$/, '/');
    const finalOriginUrl = new URL(req.headers.get('x-real-origin') ?? selfUrl);
    const selfOriginActual = `${selfUrl.origin}${basePath}`;
    const selfOriginFinal = `${finalOriginUrl.origin}${basePath}`;
    const upstreamUrl = new URL(
        req.url.replace(selfOriginActual, ''),
        upstreamOrigin,
    );
    const replaceOrigin = (() => {
        const upstreamOriginRegExp = new RegExp(upstreamOrigin, 'ig');
        return (str: string) =>
            str.replace(upstreamOriginRegExp, selfOriginFinal);
    })();
    const replaceOriginHeaders = (
        pair: [string, string] | null,
    ) => (pair === null ? pair : [
        pair[0],
        typeof pair[1] === 'string' ? replaceOrigin(pair[1]) : pair[1],
    ] as [string, string]);
    const publicSelfUrl = new URL(
        req.url.replace(selfUrl.origin, finalOriginUrl.origin),
    )
        .toString();
    if (CACHE) {
        performance.mark('cache-read');
        const value = await retrieveCache(denoKv, [
            publicSelfUrl,
        ]);
        performance.measure('cache-read', 'cache-read');
        if (value) {
            performance.measure('cache-hit', { start: performance.now() });
            return createFinalResponse(
                {
                    ...value,
                    headers: new Headers(value.headers),
                },
                performance,
                false,
            );
        }
        performance.measure('cache-miss', { start: performance.now() });
    }
    performance.mark('upstream');
    const upstreamHeaders = cloneHeaders(req.headers, denyHeaders);
    if (UPSTREAM_AUTH_TOKEN) {
        upstreamHeaders.set('authorization', `Bearer ${UPSTREAM_AUTH_TOKEN}`);
    }
    const upstreamResponse = await _internals.fetch(upstreamUrl.toString(), {
        headers: upstreamHeaders,
        redirect: 'manual',
    });
    performance.measure('upstream', 'upstream');
    const body = await upstreamResponse.text();
    return createFinalResponse(
        {
            url: publicSelfUrl,
            body,
            headers: cloneHeaders(
                upstreamResponse.headers,
                denyHeaders,
                replaceOriginHeaders,
            ),
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
        },
        performance,
        CACHE,
    );
}
